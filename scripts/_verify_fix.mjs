// Simulate the FIXED handler logic against the live DB, with rate-limit logic
// exercised exactly as written in api/admin/setup-admin.js.
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

// --- copy of the limiter from _security.js ---------------------------------
const _buckets = new Map();
function rateLimit(req, key, limit, windowMs) {
  const ip =
    (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress ||
    "unknown";
  const now = Date.now();
  const id = `${key}:${ip}`;
  const entry = _buckets.get(id);
  if (!entry || entry.resetAt <= now) {
    _buckets.set(id, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }
  entry.count += 1;
  if (entry.count > limit)
    return { ok: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  return { ok: true, retryAfter: 0 };
}

async function adminExists() {
  const { data, error } = await svc
    .from("profiles")
    .select("id")
    .in("role", ["admin", "hr_staff"])
    .limit(1);
  if (error) throw error;
  return Boolean(data && data.length > 0);
}

// --- the FIXED handler shape ------------------------------------------------
async function handler(req) {
  if (req.method === "POST") {
    const limit = rateLimit(req, "setup-admin", 5, 60 * 60 * 1000);
    if (!limit.ok)
      return { status: 429, body: { error: "Too many requests..." } };
  }
  if (req.method === "GET") {
    try {
      const exists = await adminExists();
      return {
        status: 200,
        body: { setupRequired: !exists, adminExists: exists },
      };
    } catch (err) {
      return {
        status: 500,
        body: {
          error: "Could not determine setup status.",
          setupRequired: null,
        },
      };
    }
  }
  return { status: 405, body: { error: "Method not allowed" } };
}

console.log(line);
console.log("FIXED HANDLER — BEHAVIOUR TEST");
console.log(line);

// Simulate a user loading /login then /setup then /setup again, 30 times.
const req = { method: "GET", headers: { "x-forwarded-for": "203.0.113.9" } };
let ok200 = 0,
  notOk = 0,
  trueCount = 0;
for (let i = 0; i < 30; i++) {
  const r = await handler(req);
  if (r.status === 200) ok200++;
  else notOk++;
  if (r.body.setupRequired === true) trueCount++;
}
console.log(
  `\n[1] 30 consecutive GET checks (simulating page reloads/retries):`,
);
console.log(`    HTTP 200 : ${ok200}/30`);
console.log(`    non-200  : ${notOk}/30`);
console.log(`    setupRequired === true : ${trueCount}/30`);
console.log(
  `    => ${ok200 === 30 && trueCount === 30 ? "PASS" : "FAIL"} — reads are never throttled and always answer definitively`,
);

// The old bug: Boolean(undefined) on a 429 body.
console.log(`\n[2] The old frontend bug, for the record:`);
const old429Body = {
  error: "Too many requests. Please wait a moment and try again.",
};
console.log(
  `    Boolean(old429Body.setupRequired) = ${Boolean(old429Body.setupRequired)}  <-- rendered "Setup already completed"`,
);
const newCheck = typeof old429Body.setupRequired === "boolean";
console.log(
  `    new guard treats it as valid answer? ${newCheck}  <-- false, so it shows the retry screen instead`,
);

// POST still limited.
console.log(`\n[3] POST still rate-limited at 5/hour:`);
const postReq = {
  method: "POST",
  headers: { "x-forwarded-for": "203.0.113.9" },
};
const results = [];
for (let i = 0; i < 7; i++) results.push((await handler(postReq)).status);
console.log(`    7 POSTs -> ${results.join(", ")}`);
console.log(
  `    => ${results.slice(0, 5).every((s) => s === 405) && results.slice(5).every((s) => s === 429) ? "PASS" : "CHECK"} (405 = passed limiter, reached method check)`,
);

console.log(`\n[4] Current live DB state:`);
console.log(`    adminExists() = ${await adminExists()}`);
console.log(`    => setupRequired = ${!(await adminExists())}`);

console.log("\n" + line);
