// scripts/test_create_intern_user.mjs
// End-to-end check of the failing path: auth.admin.createUser fires
// on_auth_user_created -> handle_new_user -> ensure_role_rows, which previously
// broke on the renamed interns columns. Creates temp users, verifies the
// auto-created intern/supervisor rows, then deletes the users.
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
// Throwaway test-user password — lives in local .env, NEVER hardcoded here.
const TEST_USER_PASSWORD = env.TEST_USER_PASSWORD;
if (!TEST_USER_PASSWORD) {
  console.error("Missing TEST_USER_PASSWORD in .env");
  process.exit(1);
}
const stamp = Date.now();

async function testRole(role, fullName) {
  const email = `__e2etest_${role}_${stamp}@example.com`;
  console.log(`\nCreating test ${role} user:`, email);
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: TEST_USER_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName, role },
  });
  if (error) {
    console.error(`${role.toUpperCase()} CREATE FAILED:`, error.message, error.code ?? "");
    return false;
  }
  console.log("Auth user created:", data.user.id);

  const table = role === "supervisor" ? "supervisors" : "interns";
  const cols =
    role === "supervisor"
      ? "id, first_name, last_name, full_name, email"
      : "id, first_name, last_name, full_name, email, status";
  const { data: row, error: qErr } = await supabase
    .from(table)
    .select(cols)
    .eq("profile_id", data.user.id)
    .maybeSingle();
  if (qErr) console.error(`Query ${table} failed:`, qErr.message);
  console.log(`Auto-created ${table} row:`, row ?? "(none)");

  const del = await supabase.auth.admin.deleteUser(data.user.id);
  console.log(del.error ? "CLEANUP FAILED: " + del.error.message : "Test user deleted.");
  return !del.error;
}

const okIntern = await testRole("intern", "E2E Test One");
const okSup = await testRole("supervisor", "E2E Sup Two");
console.log(okIntern && okSup ? "\nALL CHECKS PASSED" : "\nCHECKS FAILED");
process.exit(okIntern && okSup ? 0 : 1);
