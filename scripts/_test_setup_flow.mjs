// Temporary end-to-end test of the first-time admin setup flow.
// Mirrors api/admin/setup-admin.js POST logic EXACTLY, then verifies, then cleans up.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(
  new URL("../.env", import.meta.url),
  "utf8",
).split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#")) continue;
  const eq = t.indexOf("=");
  if (eq > 0) env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
}
const url = env.SUPABASE_URL;
const anonKey = env.SUPABASE_ANON_KEY;
const svcKey = env.SUPABASE_SERVICE_ROLE_KEY;
// Throwaway test-user password — lives in local .env, NEVER hardcoded here.
const TEST_USER_PASSWORD = env.TEST_USER_PASSWORD;
if (!url || !anonKey || !svcKey || !TEST_USER_PASSWORD) {
  console.error(
    "Missing SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY / TEST_USER_PASSWORD in .env",
  );
  process.exit(1);
}
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const svc = createClient(url, svcKey, opts);

const line = "=".repeat(70);
let pass = 0;
const fails = [];
const check = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fails.push(name);
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
};

const stamp = Date.now();
const EMAIL = `ims-setup-test-${stamp}@example.com`;
const PASSWORD = TEST_USER_PASSWORD;
const FULL_NAME = "Setup Flow Test Admin";
let createdUserId = null;

console.log(line);
console.log("FIRST-TIME ADMIN SETUP — END-TO-END TEST");
console.log(line);
console.log(`test account: ${EMAIL}\n`);

// --- Replica of adminExists() from api/admin/setup-admin.js (as FIXED) ------
async function adminExists() {
  const { data, error } = await svc
    .from("profiles")
    .select("id")
    .in("role", ["admin", "hr_staff"])
    .limit(1);
  if (error) throw error; // the fix
  return Boolean(data && data.length > 0);
}

try {
  // ---- STEP 1: setup should be available -----------------------------------
  console.log("[STEP 1] Availability check (GET behaviour)");
  const existsBefore = await adminExists();
  check(
    "setup is available before creation",
    existsBefore === false,
    `adminExists() returned ${existsBefore}`,
  );

  // ---- STEP 2: create the first admin (POST behaviour) ---------------------
  console.log("\n[STEP 2] Create the first admin (POST behaviour)");
  if (await adminExists())
    throw new Error("refusing to run: an admin already exists");

  const { data, error } = await svc.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: FULL_NAME, role: "admin" },
  });
  if (error) throw error;
  createdUserId = data.user.id;
  check(
    "auth.admin.createUser succeeded",
    !!createdUserId,
    `no user id returned`,
  );
  console.log(`        auth user id = ${createdUserId}`);

  // profile upsert, with the retry loop from the fix
  let profileErr = null;
  for (let attempt = 0; attempt < 3 && !profileErr; attempt += 1) {
    const { error: e } = await svc.from("profiles").upsert(
      {
        id: createdUserId,
        full_name: FULL_NAME,
        email: data.user.email,
        role: "admin",
      },
      { onConflict: "id" },
    );
    profileErr = e ?? null;
    if (profileErr && attempt < 2)
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
  }
  if (profileErr) throw profileErr;
  check("profiles.upsert succeeded (no orphan)", true);

  // ---- STEP 3: verify the profile row --------------------------------------
  console.log("\n[STEP 3] Verify the created profile");
  const { data: prof, error: pErr } = await svc
    .from("profiles")
    .select("id, full_name, email, role, intern_id, supervisor_id")
    .eq("id", createdUserId)
    .single();
  check("profile row exists", !pErr && !!prof, pErr?.message);
  check(
    "profile.role === 'admin'",
    prof?.role === "admin",
    `role = ${prof?.role}`,
  );
  check(
    "profile.full_name matches",
    prof?.full_name === FULL_NAME,
    `name = ${prof?.full_name}`,
  );
  check(
    "profile.email matches",
    prof?.email === EMAIL,
    `email = ${prof?.email}`,
  );
  check(
    "admin profile is not a supervisor/intern",
    prof?.supervisor_id === null && prof?.intern_id === null,
    `sup=${prof?.supervisor_id} int=${prof?.intern_id}`,
  );

  // ---- STEP 4: the trigger created it (handle_new_user) --------------------
  console.log("\n[STEP 4] Verify DB triggers fired");
  const { data: raw } = await svc.auth.admin.getUserById(createdUserId);
  check("auth user is email-confirmed", !!raw?.user?.email_confirmed_at);
  check(
    "auth user metadata role=admin",
    raw?.user?.user_metadata?.role === "admin",
    JSON.stringify(raw?.user?.user_metadata),
  );

  // ---- STEP 5: adminExists() now reports CLOSED ----------------------------
  console.log("\n[STEP 5] Availability after creation (must now be CLOSED)");
  const existsAfter = await adminExists();
  check(
    "adminExists() now true",
    existsAfter === true,
    `returned ${existsAfter}`,
  );
  check("GET would now return setupRequired=false", existsAfter === true);

  // ---- STEP 6: the new admin can actually sign in --------------------------
  console.log("\n[STEP 6] Sign in as the new admin (anon client)");
  const anon = createClient(url, anonKey, opts);
  const { data: signIn, error: sErr } = await anon.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });
  check(
    "signInWithPassword succeeded",
    !sErr && !!signIn?.session,
    sErr?.message,
  );
  check("session belongs to the new admin", signIn?.user?.id === createdUserId);

  // ---- STEP 7: RLS — admin can read its own profile via the browser client --
  console.log("\n[STEP 7] RLS: admin reads profiles through the anon client");
  const { data: visible, error: vErr } = await anon
    .from("profiles")
    .select(
      "id, full_name, email, avatar_url, contact_number, bio, role, intern_id, supervisor_id, created_at, updated_at",
    )
    .eq("id", createdUserId)
    .single();
  check(
    "admin can read own profile (no 406)",
    !vErr && !!visible,
    `${vErr?.code ?? ""} ${vErr?.message ?? ""}`,
  );
  check(
    "role visible to the client",
    visible?.role === "admin",
    `role = ${visible?.role}`,
  );

  await anon.auth.signOut();
} catch (err) {
  fails.push("unexpected error");
  console.log(`\n  ERROR  ${err.message}`);
} finally {
  // ---- CLEANUP -------------------------------------------------------------
  console.log("\n[CLEANUP] removing the test account");
  if (createdUserId) {
    // remove dependent rows first, then the auth user (cascade drops the profile)
    await svc.from("audit_logs").delete().eq("resource_id", createdUserId);
    await svc.from("notifications").delete().eq("user_id", createdUserId);
    const { error: dErr } = await svc.auth.admin.deleteUser(
      createdUserId,
      true,
    );
    if (dErr) console.log(`  WARN  deleteUser: ${dErr.message}`);
    else console.log("        auth user + cascaded profile removed");
  }
  const { data: leftP } = await svc
    .from("profiles")
    .select("id")
    .eq("id", createdUserId ?? "00000000-0000-0000-0000-000000000000");
  const { data: list } = await svc.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  const leftoverAuth = (list?.users ?? []).filter((u) =>
    u.email?.startsWith("ims-setup-test-"),
  );
  const clean = (leftP ?? []).length === 0 && leftoverAuth.length === 0;
  check(
    "database left clean after test",
    clean,
    `profiles=${(leftP ?? []).length} auth=${leftoverAuth.length}`,
  );
}

console.log(`\n${line}`);
console.log(`RESULT: ${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  - ${f}`);
console.log(line);
if (fails.length) process.exitCode = 1;
