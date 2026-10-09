// src/services/userService.js
/**
 * User creation service.
 *
 * Creating an auth user requires the Supabase service-role key, which must never
 * be exposed to the browser. Therefore we delegate to the serverless API route
 * (/api/admin/create-user) which uses the service-role key server-side.
 *
 * Both methods return `{ id, email }` (or true) so callers can link the new auth
 * user to a supervisors / interns record via `profile_id`.
 */
import { supabase } from "@/lib/supabase";

export const userService = {
  /**
   * Create an auth user (and its linked profile row).
   * @param {{ email: string, password: string, full_name: string, role: string }} params
   * @returns {Promise<{ id: string, email: string }>}
   */
  async createAuthUser({ email, password, full_name, role }) {
    // Forward the caller's session token so the API can authorize the request.
    let token = null;
    try {
      const { data } = await supabase.auth.getSession();
      token = data?.session?.access_token ?? null;
    } catch {
      token = null;
    }
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const response = await fetch("/api/admin/create-user", {
      method: "POST",
      headers,
      body: JSON.stringify({
        email,
        password,
        user_metadata: { full_name, role },
      }),
    });
    if (!response.ok) {
      const message = await this._extractErrorMessage(response);
      throw new Error(message);
    }
    const { user } = await response.json();
    return { id: user.id, email: user.email };
  },

  /**
   * Parse a failed fetch response into a readable, human message. Supabase /
   * Vercel serverless errors don't always come back as { error: "..." } — the
   * body may be empty, plain text, or a nested object — so we dig out the real
   * reason instead of surfacing an unhelpful "Error: {}".
   * @param {Response} response
   * @returns {string}
   */
  async _extractErrorMessage(response) {
    const text = await response.text().catch(() => "");
    let body;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      const trimmed = text.trim();
      return (
        trimmed ||
        `Request failed (HTTP ${response.status} ${response.statusText.trim()})`.trim()
      );
    }
    const errorField = body?.error;
    const message =
      typeof errorField === "string"
        ? errorField
        : errorField?.message || body?.message || body?.details || "";
    return (
      message ||
      `Request failed (HTTP ${response.status} ${response.statusText || ""})`.trim()
    );
  },

  /**
   * Hard-delete an auth user (and, by cascade, their profiles row) via the
   * serverless admin API. Used when an admin removes an intern/supervisor so
   * the account can no longer log in. The caller's session token authorizes
   * the request server-side.
   * @param {string} userId
   */
  async deleteAuthUser(userId) {
    let token = null;
    try {
      const { data } = await supabase.auth.getSession();
      token = data?.session?.access_token ?? null;
    } catch {
      token = null;
    }
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const response = await fetch("/api/admin/delete-user", {
      method: "POST",
      headers,
      body: JSON.stringify({ userId }),
    });
    if (!response.ok) {
      const message = await this._extractErrorMessage(response);
      throw new Error(message);
    }
    return true;
  },
};
