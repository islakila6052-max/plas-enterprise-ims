// Reproduce exactly what the browser gets from GET /api/admin/setup-admin.
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
const svc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const line = "=".repeat(70);

console.log(line);
console.log("LIVE SETUP-STATE CHECK");
console.log(line);

const { data: profiles, error: pErr } = await svc
  .from("profiles")
  .select("id, email, role");
console.log(
  `\nprofiles query error : ${pErr ? `${pErr.code} ${pErr.message}` : "none"}`,
);
console.log(`profiles rows        : ${(profiles ?? []).length}`);
for (const p of profiles ?? []) console.log(`   ${p.id} ${p.role} ${p.email}`);

const { data: admins, error: aErr } = await svc
  .from("profiles")
  .select("id")
  .in("role", ["admin", "hr_staff"])
  .limit(1);
console.log(
  `\nadminExists query    : error=${aErr ? `${aErr.code} ${aErr.message}` : "none"}`,
);
console.log(`admin rows           : ${(admins ?? []).length}`);
console.log(`=> setupRequired     : ${!((admins ?? []).length > 0)}`);

const { data: au } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
console.log(`\nauth users           : ${(au?.users ?? []).length}`);
for (const u of au?.users ?? []) console.log(`   ${u.id} ${u.email}`);

// Check every table the dashboard/roles might read.
for (const t of [
  "interns",
  "supervisors",
  "departments",
  "settings",
  "institutions",
  "programs",
]) {
  const { count, error } = await svc
    .from(t)
    .select("id", { count: "exact", head: true });
  console.log(
    `table ${t.padEnd(14)}: ${error ? `ERROR ${error.code} ${error.message}` : `${count ?? 0} rows`}`,
  );
}
console.log("\n" + line);
