// Remove the stuck test auth user left by the earlier deleteUser call.
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

const id = "8ad6a0b8-c4c5-435f-9fda-392f798fe838";
console.log("attempting deleteUser on stuck id:", id);
const r = await svc.auth.admin.deleteUser(id, true);
console.log("deleteUser error:", r.error?.message ?? "none");

const g = await svc.auth.admin.getUserById(id);
console.log(
  "getUserById:",
  g.error ? "ABSENT" : "STILL PRESENT " + g.data.user.email,
);

const list = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
console.log("remaining auth users:", (list.data?.users ?? []).length);
for (const u of list.data?.users ?? []) console.log("   ", u.id, u.email);

const p = await svc.from("profiles").select("id, email, role");
console.log("remaining profiles:", (p.data ?? []).length);
for (const row of p.data ?? []) console.log("   ", row.id, row.role, row.email);
