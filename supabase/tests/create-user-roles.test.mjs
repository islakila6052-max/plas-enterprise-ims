// S4: exercise the real handler, supabase-js, GoTrue and PostgREST locally.
// local-stack.sh prints the required TEST_* environment variables.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { createServer, request } from "node:http";
import pg from "pg";

const DB_URL = process.env.TEST_DB_URL;
const AUTH_URL = process.env.TEST_AUTH_URL;
const REST_URL = process.env.TEST_REST_URL;
const JWT_SECRET = process.env.TEST_JWT_SECRET;
const PASSWORD = "Correct-Horse-Battery-9";
const runId = randomUUID();
const email = (label) => `${label}-${runId}@example.com`;
const callers = {};
let db;
let proxy;
let handler;
let previousEnv;

function assertLocal(name, url) {
  if (!url) throw new Error(`${name} is not set. Run local-stack.sh.`);
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`${name} must point at localhost, got "${host}".`);
  }
}

function signJwt(role) {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ role, iat: now, exp: now + 600 });
  const signature = createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${signature}`;
}

async function auth(path, body, token) {
  const response = await fetch(`${AUTH_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  assert.equal(response.ok, true, `GoTrue ${path} returned ${response.status}`);
  return response.json();
}

before(async () => {
  assertLocal("TEST_DB_URL", DB_URL);
  assertLocal("TEST_AUTH_URL", AUTH_URL);
  assertLocal("TEST_REST_URL", REST_URL);
  if (!JWT_SECRET) throw new Error("TEST_JWT_SECRET is not set.");
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();

  // Only route and strip gateway prefixes. Do not replace upstream responses.
  proxy = createServer((req, res) => {
    const route = req.url.startsWith("/auth/v1/")
      ? ["/auth/v1", AUTH_URL]
      : req.url.startsWith("/rest/v1/") ? ["/rest/v1", REST_URL] : null;
    if (!route) {
      res.writeHead(404).end();
      return;
    }
    const target = new URL(req.url.slice(route[0].length), route[1]);
    const upstream = request(target, {
      method: req.method,
      headers: { ...req.headers, host: target.host },
    }, (response) => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(upstream);
  });
  await new Promise((resolve, reject) => {
    proxy.once("error", reject);
    proxy.listen(0, "127.0.0.1", resolve);
  });
  const env = {
    SUPABASE_URL: `http://127.0.0.1:${proxy.address().port}`,
    SUPABASE_SERVICE_ROLE_KEY: signJwt("service_role"),
    SUPABASE_ANON_KEY: signJwt("anon"),
  };
  previousEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  ({ default: handler } = await import("../../api/admin/create-user.js"));

  for (const role of ["admin", "hr_staff", "supervisor", "intern"]) {
    const address = email(`caller-${role}`);
    const user = await auth("/admin/users", {
      email: address,
      password: PASSWORD,
      email_confirm: true,
      app_metadata: { role },
      user_metadata: { full_name: `Caller ${role}` },
    }, env.SUPABASE_SERVICE_ROLE_KEY);
    const profile = await db.query("select role from public.profiles where id = $1", [user.id]);
    assert.equal(profile.rows[0]?.role, role, `setup: caller ${role} profile`);
    const session = await auth("/token?grant_type=password", { email: address, password: PASSWORD });
    assert.ok(session.access_token, "setup: GoTrue returned no session token");
    callers[role] = session.access_token;
  }
});

after(async () => {
  if (proxy?.listening) {
    await new Promise((resolve, reject) => proxy.close((error) => error ? reject(error) : resolve()));
  }
  await db?.end();
  if (previousEnv) {
    for (const [key, value] of Object.entries(previousEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

// Explicit expectations for all 16 caller/target combinations, not values
// derived from the handler's allowlist.
const cases = [
  ["admin", "admin", 200],
  ["admin", "hr_staff", 200],
  ["admin", "supervisor", 200],
  ["admin", "intern", 200],
  ["hr_staff", "admin", 403],
  ["hr_staff", "hr_staff", 403],
  ["hr_staff", "supervisor", 200],
  ["hr_staff", "intern", 200],
  ["supervisor", "admin", 403],
  ["supervisor", "hr_staff", 403],
  ["supervisor", "supervisor", 403],
  ["supervisor", "intern", 403],
  ["intern", "admin", 403],
  ["intern", "hr_staff", 403],
  ["intern", "supervisor", 403],
  ["intern", "intern", 403],
];

for (const [callerRole, targetRole, expectedStatus] of cases) {
  test(`S4: ${callerRole} creating ${targetRole} returns ${expectedStatus}`, async () => {
    const address = email(`${callerRole}-creates-${targetRole}`);
    const req = {
      method: "POST",
      headers: { authorization: `Bearer ${callers[callerRole]}` },
      socket: { remoteAddress: "127.0.0.1" },
      body: {
        email: address,
        password: PASSWORD,
        user_metadata: { role: targetRole, full_name: `New ${targetRole}` },
      },
    };
    const res = {
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
      setHeader() {},
    };
    await handler(req, res);
    const users = await db.query(
      "select id, raw_app_meta_data, raw_user_meta_data from auth.users where email = $1",
      [address],
    );
    if (expectedStatus === 403) {
      // Check side effects even if the returned status is also wrong.
      assert.equal(users.rowCount, 0, "denied request must not create an auth user");
      assert.equal(res.statusCode, 403);
      assert.equal(typeof res.body.error, "string");
      assert.ok(res.body.error.length > 0, "denial must include a plain message");
    } else {
      assert.equal(res.statusCode, 200, JSON.stringify(res.body));
      assert.equal(res.body.success, true);
      assert.equal(users.rowCount, 1);
      assert.equal(res.body.user.id, users.rows[0].id);
      assert.equal(users.rows[0].raw_app_meta_data.role, targetRole);
      assert.equal(users.rows[0].raw_user_meta_data.role, undefined);
      const profile = await db.query("select role from public.profiles where id = $1", [users.rows[0].id]);
      assert.equal(profile.rows[0]?.role, targetRole);
    }
  });
}
