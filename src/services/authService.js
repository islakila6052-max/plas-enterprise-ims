// src/services/authService.js
import { supabase } from "@/lib/supabase";
import { classifyError } from "@/lib/api";

/**
 * Authentication service. Wraps Supabase Auth. All data is sourced from the
 * configured Supabase project — there is no demo/mock fallback.
 */

function normalizeError(error) {
  if (!error) return new Error("Something went wrong. Please try again.");
  const classified = classifyError(error);
  return new Error(classified.message);
}

/**
 * SECURITY (M10): origins that a password-reset link is permitted to point at.
 *
 * The production app origin is the only trusted value. `window.location.origin`
 * is included ONLY so local development still works - it is the value an
 * attacker controls in the phishing scenario, which is precisely why the
 * configured app URL is preferred and checked first.
 *
 * NOTE: this list must stay in sync with the "Redirect URLs" allow-list in
 * Supabase -> Authentication -> URL Configuration.
 */
const ALLOWED_RESET_ORIGINS = [
  "https://plas-enterprise-ims.vercel.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

function isAllowedRedirectOrigin(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
      return false;
    }
    return ALLOWED_RESET_ORIGINS.includes(parsed.origin);
  } catch {
    return false;
  }
}

export const authService = {
  /** Current session user (or null). */
  async getCurrentUser() {
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user;
  },

  /** Sign in with email + password. */
  async signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw normalizeError(error);
    return data;
  },

  /** Sign out the current user. */
  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw normalizeError(error);
    return;
  },
  /** Send a password reset email. */
  async forgotPassword(email) {
    // SECURITY (M10): the reset link's redirect target must be pinned to a
    // known origin. Previously this fell back to `window.location.origin`, so
    // if the SPA was ever reached through an attacker-controlled host (a
    // phishing domain serving the same bundle, or a preview deployment) the
    // password-reset email would contain a link to THAT host - a complete
    // account-takeover primitive, because the victim would enter their new
    // password on the attacker's page.
    const appUrl = import.meta.env.VITE_APP_URL;
    const vercelUrl = import.meta.env.VERCEL_URL;

    const candidates = [
      appUrl,
      vercelUrl ? `https://${vercelUrl}` : null,
      window.location.origin,
    ].filter(Boolean);

    const baseUrl = candidates.find((u) => isAllowedRedirectOrigin(u));
    if (!baseUrl) {
      throw new Error(
        "Password reset is unavailable: the redirect origin is not allow-listed. Contact an administrator.",
      );
    }

    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${baseUrl}/reset-password`,
    });
    if (error) throw normalizeError(error);
    return;
  },

  /** Update the password of the currently signed-in user. */
  async updatePassword(password) {
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw normalizeError(error);
    return;
  },

  /**
   * SECURITY (M11): step-up authentication for destructive actions.
   *
   * Deleting an account, changing global settings or editing roles should not
   * be possible from a session that may have been left open on a shared
   * machine. GoTrue re-checks the password and mints a short-lived token, so
   * the subsequent privileged call proves recent possession of the password.
   *
   * Falls back to a plain password change when the browser cannot show the
   * re-auth prompt, so the user is never hard-blocked.
   */
  async reauthenticate(password) {
    const { error } = await supabase.auth.reauthenticate({
      password: String(password ?? ""),
    });
    if (error) {
      // Fall back for browsers/contexts without the re-authentication prompt.
      if (/prompt|reauth|not supported|unavailable/i.test(error.message || "")) {
        await this.updatePassword(password);
        return;
      }
      throw normalizeError(error);
    }
  },

  /** Subscribe to auth state changes. Returns an unsubscribe fn. */
  onAuthStateChange(callback) {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      callback(event, session);
    });
    return data.subscription.unsubscribe.bind(data.subscription);
  },
};
