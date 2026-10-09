// Probe the GoTrue admin endpoints directly to see what is actually failing.
import { readFileSync } from "node:fs";

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
const URL_BASE = env.SUPABASE_URL;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
const id = "8ad6a0b8-c4c5-435f-9fda-392f798fe838";

const call = async (label, path, init = {}) => {
  const res = await fetch(`${URL_BASE}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  let body = "";
  try {
    body = await res.text();
  } catch {
    /* ignore */
  }
  console.log(`\n[${label}]  ${init.method ?? "GET"} ${path}`);
  console.log(`    HTTP ${res.status}`);
  console.log(`    body: ${body.slice(0, 400)}`);
  return { status: res.status, body };
};

console.log("=".repeat(70));
console.log("GOTRUE ADMIN API PROBE");
console.log("=".repeat(70));

await call("list users", "/auth/v1/admin/users?page=1&per_page=5");
await call("get user by id", `/auth/v1/admin/users/${id}`);
await call(
  "delete user (hard)",
  `/auth/v1/admin/users/${id}?should_soft_delete=false`,
  { method: "DELETE" },
);
await call("get user after delete", `/auth/v1/admin/users/${id}`);
await call("list users after delete", "/auth/v1/admin/users?page=1&per_page=5");

console.log("\n" + "=".repeat(70));
