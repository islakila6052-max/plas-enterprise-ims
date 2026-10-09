// api/admin/setup-admin.js
// First-time admin account setup endpoint.
//
// SECURITY MODEL:
// This route is ONLY usable while the system has NO admin account yet.
// The check is performed SERVER-SIDE with the service-role key, so it cannot
// be bypassed from the browser. Once any admin/hr_staff profile exists, every
// request to this endpoint is rejected with 403 — preventing unauthorized
// users from creating additional initial admin accounts.
//
// Environment variables (same as create-user.js):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
import { createClient } from "@supabase/supabase-js";
import { rateLimit, denyRateLimit, validatePassword, denyCrossOrigin } from "./_security.js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseAdmin =
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    : null;

function configError(res) {
  return res.status(500).json({
    error:
      "Server misconfiguration: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set for this serverless function.",
  });
}

/**
 * True while no admin/hr_staff profile exists anywhere in the system.
 *
 * FIX: this previously destructured ONLY `data` and ignored `error`. Any
 * PostgREST failure (schema-cache miss, the 406 serialization error, a network
 * blip) leaves `data === null`, which made the function return `false` — i.e.
 * it reported "no admin exists" precisely when it could not tell. That is a
 * fail-OPEN bug on the one endpoint that mints administrators. The error is now
 * surfaced so the caller fails closed (500) instead of silently re-opening
 * first-time setup.
 */
async function adminExists() {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id")
    .in("role", ["admin", "hr_staff"])
    .limit(1);
  if (error) throw error;
  return Boolean(data && data.length > 0);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  if (!supabaseAdmin) return configError(res);

  // L5/L6: reject cross-origin browser requests. This endpoint is
  // UNAUTHENTICATED, so an off-site page must not be able to drive it at all.
  if (denyCrossOrigin(req, res)) return;

  // H5: this endpoint is unauthenticated by design, so it is the single most
  // attractive target in the app - whoever finds /api/admin/setup-admin while
  // no admin exists can mint themselves an administrator. Cap attempts hard.
  //
  // FIX (root cause of "Setup already completed" on an empty database):
  // the availability CHECK (GET) is a side-effect-free read that returns a
  // single boolean, so it is NOT rate-limited at all. Previously GET shared a
  // 5/hour bucket with POST, and the Login page and the Setup page each fire a
  // GET on every visit. Those reads alone exhausted the budget, so the endpoint
  // started answering 429 - whose body is `{ error: "Too many requests..." }`
  // with NO `setupRequired` field. The client read `Boolean(undefined)`, got
  // false, and rendered "Setup already completed" while the database was
  // completely empty and Supabase Auth had zero users.
  //
  // Rate limiting a read also bought nothing: `adminExists()` discloses only
  // "an admin exists", which is not a secret worth protecting, and an attacker
  // gains nothing by calling it - the POST below is the only mutating action
  // and it keeps the strict limit. The in-memory limiter is additionally
  // per-instance on Vercel, so counting reads on it was unreliable in both
  // directions: it blocked real users and would not have stopped an attacker
  // who landed on a fresh instance.
  if (req.method === "POST") {
    const limit = rateLimit(req, "setup-admin", 5, 60 * 60 * 1000);
    if (!limit.ok) return denyRateLimit(res, limit.retryAfter);
  }

  // ---- GET: report whether first-time setup is still available. ----------
  if (req.method === "GET") {
    try {
      const exists = await adminExists();
      // Always include the field so the client can never mistake an error
      // response for "setup is finished".
      return res.status(200).json({ setupRequired: !exists, adminExists: exists });
    } catch (err) {
      // M12: the raw error is logged, but the client only learns that the
      // check could not be completed - not the underlying database detail.
      console.error("Error checking setup availability:", err);
      return res.status(500).json({
        error: "Could not determine setup status.",
        setupRequired: null,
      });
    }
  }

  // ---- POST: create the very first admin account. ------------------------
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { full_name, email, password } = req.body ?? {};

  // Guard: refuse once ANY admin already exists. This closes the window even
  // if two requests race — see the re-check below right before creation.
  if (await adminExists()) {
    return res.status(403).json({
      error:
        "Setup is disabled: an administrator account already exists. Please sign in instead.",
    });
  }

  // Validate input.
  if (!full_name || String(full_name).trim().length < 2) {
    return res.status(400).json({ error: "Full name is required." });
  }
  if (!email || !EMAIL_RE.test(String(email))) {
    return res
      .status(400)
      .json({ error: "A valid email address is required." });
  }
  // H6: the bootstrap admin gets the STRONGEST policy, not the weakest one.
  // A first-run admin created with an 8-character password is a permanent
  // backdoor into the whole system, so the same 12-char server-side policy
  // enforced by create-user.js applies here too.
  const pwCheck = validatePassword(password, email);
  if (!pwCheck.ok) {
    return res.status(400).json({ error: pwCheck.message });
  }

  try {
    // Re-check immediately before creation to shrink the race window between
    // two simultaneous first-setup submissions.
    if (await adminExists()) {
      return res.status(403).json({
        error:
          "Setup is disabled: an administrator account already exists. Please sign in instead.",
      });
    }

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: String(email).trim(),
      password,
      email_confirm: true, // first admin is provisioned by an operator
      user_metadata: { full_name: String(full_name).trim(), role: "admin" },
    });
    if (error) throw error;
    const authUser = data.user;

    // Ensure the linked profiles row exists with the admin role.
    //
    // FIX: this upsert used to share the outer try/catch with createUser. When
    // it failed (e.g. the 406 serialization error on the circular profiles FK)
    // the handler returned 400 — but the auth user had ALREADY been created,
    // leaving an orphaned account with no profile row. The dashboard then showed
    // zero admins, so the operator tried again and eventually hit the rate
    // limit. We now retry a couple of times (the trigger on_auth_user_created
    // normally creates the row already) and, if it still fails, roll the auth
    // user back so the system is left exactly as it was before the attempt.
    let profileErr = null;
    for (let attempt = 0; attempt < 3 && !profileErr; attempt += 1) {
      const { error } = await supabaseAdmin.from("profiles").upsert(
        {
          id: authUser.id,
          full_name: String(full_name).trim(),
          email: authUser.email,
          role: "admin",
        },
        { onConflict: "id" },
      );
      profileErr = error ?? null;
      if (profileErr && attempt < 2) {
        await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
      }
    }

    if (profileErr) {
      // Compensating delete: never leave an admin-capable auth user without a
      // profile. Deleting here also keeps `adminExists()` (which reads profiles)
      // consistent with the real state, so setup stays available for a retry.
      try {
        await supabaseAdmin.auth.admin.deleteUser(authUser.id, true);
      } catch (cleanupErr) {
        console.error(
          "Failed to roll back orphaned admin auth user:",
          cleanupErr,
        );
      }
      throw profileErr;
    }

    // Audit the initial setup.
    try {
      await supabaseAdmin.from("audit_logs").insert({
        user_id: authUser.id,
        action: "create",
        resource_type: "auth_user",
        resource_id: authUser.id,
        changes: {
          email: authUser.email,
          role: "admin",
          note: "initial_admin_setup",
        },
      });
    } catch {
      /* non-fatal */
    }

    return res.status(200).json({
      success: true,
      user: { id: authUser.id, email: authUser.email },
    });
  } catch (error) {
    // M12: log the detail, return a generic message.
    console.error("Error creating the admin account:", error);
    return res.status(400).json({
      error: "Unable to create the administrator account. Please try again.",
    });
  }
}
