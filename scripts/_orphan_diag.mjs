// Diagnose WHY a profile row survives auth user deletion.
// This is the mechanism behind the original "ghost admin" bug.
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

const ORPHAN_ID = "8ad6a0b8-c4c5-435f-9fda-392f798fe838";

console.log(line);
console.log("ORPHAN DIAGNOSIS");
console.log(line);

// A) Does the orphan profile still exist?
const { data: prof } = await svc
  .from("profiles")
  .select("id, email, role, full_name")
  .eq("id", ORPHAN_ID)
  .maybeSingle();
console.log(`\n[A] profile row for ${ORPHAN_ID}:`);
console.log(
  prof ? `    EXISTS  role=${prof.role}  email=${prof.email}` : "    gone",
);

// B) Does the corresponding auth user still exist?
const { data: au, error: auErr } = await svc.auth.admin.getUserById(ORPHAN_ID);
console.log(`\n[B] auth user for same id:`);
if (auErr) console.log(`    ABSENT (${auErr.message})`);
else console.log(`    EXISTS  email=${au?.user?.email}`);

// C) THE KEY TEST: can the orphan profile be deleted at all?
console.log(`\n[C] Can the orphan profile be deleted directly?`);
const { error: delErr } = await svc
  .from("profiles")
  .delete()
  .eq("id", ORPHAN_ID);
console.log(
  delErr
    ? `    DELETE FAILED: ${delErr.code ?? ""} ${delErr.message}`
    : "    delete accepted",
);

const { data: after } = await svc
  .from("profiles")
  .select("id")
  .eq("id", ORPHAN_ID)
  .maybeSingle();
console.log(
  after
    ? "    -> STILL PRESENT (delete was a no-op / blocked)"
    : "    -> removed",
);

// D) Is there a leftover auth identity (the weird hashed entry)?
console.log(`\n[D] auth.users listing (raw):`);
const { data: list } = await svc.auth.admin.listUsers({
  page: 1,
  perPage: 1000,
});
for (const u of list?.users ?? []) {
  console.log(`    id=${u.id}  email=${u.email}`);
}

console.log(`\n${line}`);
