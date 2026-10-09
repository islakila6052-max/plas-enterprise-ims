// api/admin/delete-user.js
// Serverless function (Vercel) that hard-deletes an auth user (and, by cascade,
// their profiles row). Placing this at /api/admin/delete-user (project root,
// sibling to src/) ensures Vercel deploys it as a function.
//
// Environment (server-only, NOT the VITE_* frontend vars):
//   SUPABASE_URL                 e.g. https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    service-role key (secret, bypasses RLS)
//   SUPABASE_ANON_KEY            anon/public key (verifies the caller's session)
import { createClient } from "@supabase/supabase-js";
import { rateLimit, denyRateLimit, denyCrossOrigin } from "./_security.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

const supabaseAdmin = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  : null;
const supabaseAnon = SUPABASE_URL && SUPABASE_ANON_KEY
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

async function getCallerProfile(authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  if (!supabaseAnon) return null;
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
  if (!supabaseAdmin || !supabaseAnon) {
    return res.status(500).json({
      error:
        "Server misconfiguration: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY are not set for this serverless function.",
    });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  // L5/L6: reject cross-origin browser requests before any privileged work.
  if (denyCrossOrigin(req, res)) return;

  // H5: deletions are the most destructive action in the system, so cap them.
  const limit = rateLimit(req, "delete-user", 30, 60 * 60 * 1000);
  if (!limit.ok) return denyRateLimit(res, limit.retryAfter);

  // H9: deleting an auth account is destructive and unrecoverable, so it is
  // admin-only. `hr_staff` can manage interns but cannot remove accounts.
  const caller = await getCallerProfile(req.headers.authorization);
  if (!caller || caller.role !== "admin") {
    return res.status(403).json({ error: "Forbidden: only administrators may delete users" });
  }

  const { userId } = req.body;
  if (!userId) {
    return res.status(400).json({ error: "userId is required" });
  }

  // Prevent an admin from deleting their own account (lockout guard).
  if (caller.id === userId) {
    return res.status(400).json({ error: "You cannot delete your own account." });
  }

  // H10: refuse to remove the LAST admin/hr_staff account. Deleting every admin
  // would both lock the company out of the system AND silently re-open
  // /api/admin/setup-admin, which mints a brand-new admin for whoever finds
  // the URL first. Fail closed if the count cannot be established.
  let privilegedCount = 0;
  try {
    const { count, error: countErr } = await supabaseAdmin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .in("role", ["admin", "hr_staff"]);
    if (countErr) throw countErr;
    privilegedCount = count ?? 0;
  } catch (e) {
    console.error("Could not verify remaining admin count:", e);
    return res.status(500).json({
      error: "Could not verify administrator accounts. Please try again.",
    });
  }

  // Refuse when this deletion would remove the final privileged account.
  if (privilegedCount <= 1) {
    return res.status(400).json({
      error:
        "Cannot delete the last remaining administrator account. Create another admin first.",
    });
  }

  // If the target is itself privileged, make sure one would remain afterwards.
  const { data: target } = await supabaseAdmin
    .from("profiles")
    .select("id, role")
    .eq("id", userId)
    .maybeSingle();

  if (target && ["admin", "hr_staff"].includes(target.role) && privilegedCount <= 1) {
    return res.status(400).json({
      error:
        "Cannot delete the last remaining administrator account. Create another admin first.",
    });
  }

  try {
    // Hard delete the auth user. profiles.id REFERENCES auth.users ON DELETE
    // CASCADE, so the profile row is removed too. Intern/supervisor rows that
    // reference profile_id are SET NULL (handled by their FKs), so callers must
    // delete those rows explicitly before/after this call as needed.
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId, true);
    if (error) throw error;

    return res.status(200).json({ success: true });
  } catch (error) {
    // M12: the raw GoTrue error is logged server-side but not returned - it can
    // expose internal identifiers and constraint names.
    console.error("Error deleting user:", error);
    return res.status(400).json({ error: "Unable to delete the account. Please try again." });
  }
}
