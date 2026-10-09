// Temporary diagnostic: reproduce exactly what /api/admin/setup-admin reads.
// Safe: READ-ONLY. Deletes nothing.
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
const svcKey = env.SUPABASE_SERVICE_ROLE_KEY;
const svc = createClient(url, svcKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const line = "=".repeat(70);
console.log(line);
console.log("SETUP STATE DIAGNOSTIC  (read-only)");
console.log(line);

// 1. auth.users
console.log("\n[1] auth.users (all accounts)");
let authUsers = [];
try {
  const { data, error } = await svc.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (error) throw error;
  authUsers = data?.users ?? [];
  if (!authUsers.length) console.log("    (none)");
  for (const u of authUsers) {
    console.log(
      `    ${u.email}  id=${u.id}  confirmed=${!!u.email_confirmed_at}  meta.role=${u.user_metadata?.role ?? "-"}`,
    );
  }
  console.log(`    -> ${authUsers.length} auth user(s)`);
} catch (e) {
  console.log(`    ERROR ${e.message}`);
}

// 2. profiles
console.log("\n[2] public.profiles (this is what adminExists() reads)");
let profiles = [];
try {
  const { data, error } = await svc
    .from("profiles")
    .select("id, email, role, full_name");
  if (error) throw error;
  profiles = data ?? [];
  if (!profiles.length) console.log("    (none)");
  for (const p of profiles)
    console.log(`    ${p.email}  role=${p.role}  name=${p.full_name}`);
  console.log(`    -> ${profiles.length} profile(s)`);
} catch (e) {
  console.log(`    ERROR ${e.code ?? ""} ${e.message}`);
}

// 3. The EXACT adminExists() query
console.log(
  "\n[3] adminExists() query: profiles where role in (admin, hr_staff)",
);
try {
  const { data, error } = await svc
    .from("profiles")
    .select("id")
    .in("role", ["admin", "hr_staff"])
    .limit(1);
  if (error) throw error;
  const exists = Boolean(data && data.length > 0);
  console.log(`    rows=${data?.length ?? 0}`);
  console.log(`    => adminExists() = ${exists}`);
  console.log(
    `    => GET /api/admin/setup-admin would return setupRequired = ${!exists}`,
  );
} catch (e) {
  console.log(`    ERROR ${e.code ?? ""} ${e.message}`);
}

// 4. The 406 profile select the browser runs (profileService.getByUserId shape)
console.log("\n[4] The browser's profiles select (profileService column list)");
try {
  const { data, error } = await svc
    .from("profiles")
    .select(
      "id, full_name, email, avatar_url, contact_number, bio, role, intern_id, supervisor_id, created_at, updated_at",
    )
    .limit(1);
  if (error) throw error;
  console.log(`    OK, ${data?.length ?? 0} row(s) returned`);
} catch (e) {
  console.log(`    ERROR ${e.code ?? ""} ${e.message}`);
}

// 5. Cross-reference: orphaned auth users with no profile
console.log("\n[5] Cross-reference (orphan detection)");
const profileIds = new Set(profiles.map((p) => p.id));
const orphans = authUsers.filter((u) => !profileIds.has(u.id));
if (!orphans.length) {
  console.log("    none - every auth user has a profile row");
} else {
  for (const o of orphans) {
    console.log(
      `    ORPHAN: ${o.email} id=${o.id} (auth user with NO profile row)`,
    );
  }
}

// 6. What the dashboard / role routing would see
console.log("\n[6] Summary for the setup flow");
const admins = profiles.filter(
  (p) => p.role === "admin" || p.role === "hr_staff",
);
console.log(`    auth users:        ${authUsers.length}`);
console.log(`    profiles:          ${profiles.length}`);
console.log(`    admin/hr_staff:    ${admins.length}`);
console.log(`    orphaned auth:     ${orphans.length}`);
console.log(
  `\n    VERDICT: setup is currently ${admins.length === 0 ? "OPEN (form should show)" : "CLOSED (setup already completed)"}`,
);
console.log(line);
