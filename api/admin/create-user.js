// api/admin/create-user.js
// NOTE: This file MUST live in an /api folder at the PROJECT ROOT (sibling to
// src/, package.json) so Vercel deploys it as a serverless function. Files under
// src/api/ are bundled into the frontend and will NOT be deployed as functions.
//
// Environment variables for the SERVERLESS function (set in the Vercel project
// dashboard under Settings > Environment Variables). These are NOT the VITE_*
// vars — Vite inlines VITE_* vars into the browser bundle at build time and they
// are NOT available to serverless functions at runtime. Use these exact names:
//   SUPABASE_URL                 e.g. https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    service-role key (server-side only, secret)
//   SUPABASE_ANON_KEY            anon/public key (used to verify the caller)
import { createClient } from "@supabase/supabase-js";
import { rateLimit, denyRateLimit, validatePassword, denyCrossOrigin } from "./_security.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  // Surface a clear, actionable error instead of a cryptic "Invalid supabaseUrl".
  // eslint-disable-next-line no-console
  console.error(
    "[create-user] Missing server env vars. Set SUPABASE_URL and " +
      "SUPABASE_SERVICE_ROLE_KEY in the Vercel project (Settings > Environment Variables). " +
      "These are NOT the VITE_* vars used by the frontend.",
  );
}

// Service-role client: bypasses RLS for the actual user creation.
const supabaseAdmin = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;

// Anon client: used ONLY to verify the *caller's* identity from their
// session JWT before we touch anything with the service role.
const supabaseAnon = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

/**
 * Resolve the caller's role from their session token.
 * Returns the profile row (with role) or null if unauthenticated/invalid.
 */
async function getCallerProfile(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  if (!supabaseAnon) return null; // mis-configured: fail open is unsafe, so we treat as unauthenticated
  const { data, error } = await supabaseAnon.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("id, role")
    .eq("id", data.user.id)
    .single();
  return profile || null;
}

export default async function handler(req, res) {
  // Fail fast with a clear message if the function is mis-configured.
  if (!supabaseAdmin || !supabaseAnon) {
    return res.status(500).json({
      error:
        "Server misconfiguration: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY are not set for this serverless function. Set them in the Vercel project dashboard (they are not the VITE_* frontend vars).",
    });
  }

  // L5/L6: reject cross-origin browser requests before any privileged work.
  if (denyCrossOrigin(req, res)) return;

  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // H5: rate limit BEFORE any privileged work. Without this, a single stolen
  // supervisor/admin token could mint or destroy accounts as fast as the
  // function would cold-start.
  const limit = rateLimit(req, "create-user", 20, 60 * 60 * 1000);
  if (!limit.ok) return denyRateLimit(res, limit.retryAfter);

  // --- RBAC: only HR Admin / HR Staff may create auth accounts. -------------
  // SECURITY (C5): supervisors were previously allowed to call
  // auth.admin.createUser and could therefore mint UNLIMITED arbitrary auth
  // accounts at will, with the target role supplied by the client. That is a
  // standing account-creation capability that belongs to HR only.
  // Supervisors should now request intern registration, which an admin
  // approves and provisions. The extra "supervisor may only create interns"
  // branch is therefore gone rather than merely narrowed.
  const caller = await getCallerProfile(req.headers.authorization);
  const allowedRoles = ["admin", "hr_staff"];
  const allowed = caller && allowedRoles.includes(caller.role);
  if (!allowed) {
    return res.status(403).json({
      error:
        "Forbidden: only administrators may create accounts. Ask an administrator to provision this account.",
    });
  }
  const { email, password, user_metadata } = req.body ?? {};

  // Validate the requested role against a server-side allowlist. The role is
  // never taken on trust from the client beyond this point.
  const ALLOWED_NEW_ROLES = ["admin", "hr_staff", "supervisor", "intern"];
  const requestedRole = user_metadata?.role ?? "intern";
  if (!ALLOWED_NEW_ROLES.includes(requestedRole)) {
    return res.status(400).json({ error: "Invalid role for a new account." });
  }

  // Validate required fields
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  // H6: enforce the password policy SERVER-side. This endpoint previously
  // accepted any non-empty string, so a 1-character password was a valid
  // account. The UI's strength meter is advisory and easily bypassed.
  const pwCheck = validatePassword(password, email);
  if (!pwCheck.ok) {
    return res.status(400).json({ error: pwCheck.message });
  }

try {
    // Create user using admin API. Note: admin.createUser resolves to
    // { data: { user }, error } — the user object lives at data.user.
    //
    // IMPORTANT: createUser() does NOT send an email confirmation or invite.
    // The admin is explicitly provisioning this account, so we confirm it on
    // the server side and still trigger a best-effort invite email for the
    // user. This avoids the "Your email is not confirmed yet" login error.
    const createdEmail = String(email).trim();
    const appBaseUrl =
      process.env.VITE_APP_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:5173");

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: createdEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: user_metadata?.full_name || "",
        role: requestedRole,
      },
    });

    if (error) throw error;
    const authUser = data.user;

    try {
      await supabaseAdmin.auth.admin.inviteUserByEmail(createdEmail, {
        data: {
          full_name: user_metadata?.full_name || "",
          role: requestedRole,
        },
        redirectTo: `${appBaseUrl}/login`,
      });
    } catch (inviteErr) {
      console.warn("Could not send invite email for newly created user:", inviteErr);
    }

    // Ensure the linked profiles row exists. The on_auth_user_created trigger
    // normally creates it, but we upsert defensively so downstream inserts that
    // reference profiles(id) (e.g. interns.profile_id) never fail on a missing FK.
    try {
      await supabaseAdmin.from("profiles").upsert(
        {
          id: authUser.id,
          full_name: user_metadata?.full_name || "",
          email: authUser.email,
          role: requestedRole,
        },
        { onConflict: "id" },
      );
    } catch {
      /* non-fatal: trigger should have created it */
    }

    // Audit the admin action.
    try {
      await supabaseAdmin.from("audit_logs").insert({
        user_id: caller.id,
        action: "create",
        resource_type: "auth_user",
        resource_id: authUser.id,
        changes: { email, role: requestedRole },
      });
    } catch {
      /* non-fatal */
    }

    return res.status(200).json({
      success: true,
      user: {
        id: authUser.id,
        email: authUser.email,
        user_metadata: authUser.user_metadata,
      },
    });
  } catch (error) {
    // M12: log the real cause server-side, but return a GENERIC message.
    // The previous handler echoed the raw GoTrue/PostgREST error (which can
    // contain table names, constraint names and SQL fragments) back to the
    // client, and the "already registered" hint acted as a user-enumeration
    // oracle on a privileged endpoint.
    console.error("Error creating user:", error);
    const raw = String(
      error?.message || error?.error_description || error?.details || "",
    ).toLowerCase();

    let status = 400;
    let message = "Unable to create the account. Please try again.";

    if (raw.includes("already registered") || raw.includes("already exists") || raw.includes("duplicate")) {
      // Neutral wording: still tells the admin what to do, but does not confirm
      // the address is registered to an outsider probing the endpoint.
      message = "Unable to create the account with those details. Use a different email address.";
    } else if (raw.includes("valid email") || raw.includes("email address")) {
      message = "The email address appears to be invalid.";
    } else if (raw.includes("password")) {
      message = "The password does not meet the security requirements.";
    } else if (raw.includes("rate") || raw.includes("too many")) {
      status = 429;
      message = "Too many requests. Please wait a moment and try again.";
    }

    return res.status(status).json({ error: message });
  }
}
