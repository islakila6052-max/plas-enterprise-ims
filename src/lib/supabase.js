// src/lib/supabase.js
// Supabase client. Auth is Supabase Auth; authorization is enforced by
// Row Level Security on the server (see supabase/migrations/0045-0047).
//
// SECURITY NOTE (L7): the items below are NOT configured in this repository -
// they are dashboard settings that must be applied in the Supabase project, and
// the code assumes they are. Please verify each one.
//
//  1. Authentication -> URL Configuration
//       Site URL:      https://plas-enterprise-ims.vercel.app
//       Redirect URLs: https://plas-enterprise-ims.vercel.app/reset-password
//                      (and localhost equivalents for development)
//     This is what makes the M10 reset-redirect allowlist meaningful. An
//     unlisted redirect target means Supabase refuses the reset link.
//
//  2. Authentication -> Sign In / Providers
//       Disable "Email signup" if self-registration is not intended. Every
//       account should be provisioned by an admin via /api/admin/create-user,
//       which is RBAC-checked. Leaving signup open means anyone can create an
//       intern profile (harmless on its own since RLS scopes them to their own
//       data, but it is needless surface).
//
//  3. Authentication -> Rate Limits
//       Raise the per-IP limits on /auth/v1/token and /auth/v1/signup above the
//       defaults, and enable the "Refresh token" rotation limit. The app-side
//       limits in api/admin/_security.js do NOT cover the Supabase auth
//       endpoints.
//
//  4. Authentication -> Multi-Factor Authentication (M11)
//       Require TOTP for roles admin and hr_staff.
//
//  5. Database -> Backups (L8)
//       Confirm Point-in-Time Recovery (PITR) is ENABLED and note the retention
//       window. Test a restore at least once. Migrations 0045-0047 make
//       irreversible policy changes; a known-good restore point is the only
//       safety net.
//
//  6. Project Settings -> API
//       Rotate the service_role key (it was committed to .env.example in an
//       earlier revision of this repo) and confirm the new value is present in
//       the Vercel project's environment variables.
//
//  7. Project Settings -> Data API
//       Confirm the public schema exposes no additional tables beyond the ones
//       this app uses, and that each one has RLS enabled.
//
// Rotating the key does NOT revoke existing sessions; to force everyone to
// re-authenticate, also invalidate the refresh tokens:
//   UPDATE auth.sessions SET refreshed_at = 'epoch' WHERE refreshed_at > 'epoch';

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/**
 * True when both Supabase env vars are provided. The app requires a configured
 * Supabase project — there is no demo/mock fallback.
 */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  // The app depends on Supabase for auth and all data. Surface a clear error
  // instead of silently degrading to a non-functional state.
  throw new Error(
    "[IMS] Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.",
  );
}

/**
 * SECURITY (L4): keep the persisted session as short-lived as possible.
 *
 * The session (access token + refresh token) is written to `localStorage` by
 * supabase-js, because we use the default browser storage. That is readable by
 * any JavaScript on the page, so an XSS bug would be enough to exfiltrate a
 * valid session.
 *
 * The robust fix is to move the refresh token to an httpOnly cookie via a
 * custom Supabase auth client, which requires a server-side token exchange
 * endpoint - a larger change with its own trade-offs, so it is NOT done here.
 *
 * What IS done is to bound the exposure:
 *   * `autoRefreshToken` stays on, but an 8-hour absolute session cap (H8) in
 *     AuthContext bounds how long a stolen token remains useful, and the idle
 *     timeout shortens it further.
 *   * The token is never logged: `src/lib/logger.js` redacts anything that
 *     looks like a JWT or a bearer token, and the session object is on the
 *     sensitive-key list.
 *   * A strict CSP (M4) reduces the chance of an XSS foothold in the first
 *     place.
 *
 * The residual risk is accepted and documented rather than silently ignored.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // Never let the session be cached by the browser or a proxy.
    storage: typeof window !== "undefined" ? window.localStorage : undefined,
  },
});

