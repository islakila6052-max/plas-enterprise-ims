// supabase/tests/role-escalation.test.mjs
// Security regression tests for role assignment and profile link spoofing
// (audit findings S1 and S2).
//
// These tests run against a LOCAL Supabase stack only: a Supabase Postgres
// container plus a real GoTrue (Supabase Auth) container. User sign-up goes
// through GoTrue's HTTP API, exactly as `supabase.auth.signUp()` does in the
// browser. Database calls as a signed-in user use the same mechanism PostgREST
// uses: `SET LOCAL ROLE authenticated` plus the JWT claims as settings.
//
// Required environment (all must point at localhost):
//   TEST_DB_URL       e.g. postgres://postgres:postgres@127.0.0.1:54399/postgres
//   TEST_AUTH_URL     e.g. http://127.0.0.1:54398
//   TEST_JWT_SECRET   the GOTRUE_JWT_SECRET of that GoTrue container
//
// Start the stack with `bash supabase/tests/local-stack.sh`. It prints the
// exact command to run these tests (`npm run test:db`).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import pg from "pg";

const DB_URL = process.env.TEST_DB_URL;
const AUTH_URL = process.env.TEST_AUTH_URL;
const JWT_SECRET = process.env.TEST_JWT_SECRET;

// Refuse to touch anything that is not on this machine. These tests create
// users and rewrite roles, so they must never reach a hosted project.
function assertLocal(name, url) {
  if (!url) throw new Error(`${name} is not set. See the header of this file.`);
  const host = new URL(url).hostname;
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`${name} must point at localhost, got "${host}".`);
  }
}

function signJwt(payload) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64({ iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 600, ...payload });
  const sig = createHmac("sha256", JWT_SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}

async function auth(path, body, token) {
  const res = await fetch(`${AUTH_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`GoTrue ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

const PASSWORD = "Correct-Horse-Battery-9";
const runId = randomUUID().slice(0, 8);
const email = (label) => `${label}-${runId}@example.com`;

let db;

/** Run one statement as the service role, like the /api/admin functions. */
async function asService(sql, params = []) {
  await db.query("begin");
  try {
    await db.query("set local role service_role");
    const res = await db.query(sql, params);
    await db.query("commit");
    return res;
  } catch (err) {
    await db.query("rollback");
    throw err;
  }
}

/**
 * Run one statement as a signed-in browser user, the way PostgREST does it.
 * Returns { rows, rowCount } or { error } — never throws for SQL errors.
 */
async function asUser(userId, sql, params = []) {
  const claims = JSON.stringify({ sub: userId, role: "authenticated", aud: "authenticated" });
  await db.query("begin");
  try {
    await db.query("set local role authenticated");
    await db.query("select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)", [claims, userId]);
    const res = await db.query(sql, params);
    await db.query("commit");
    return { rows: res.rows, rowCount: res.rowCount };
  } catch (err) {
    await db.query("rollback");
    return { error: err };
  }
}

/** Create a user through the GoTrue admin API, like api/admin/create-user.js. */
async function adminCreateUser(label, role) {
  const service = signJwt({ role: "service_role" });
  const user = await auth("/admin/users", {
    email: email(label),
    password: PASSWORD,
    email_confirm: true,
    app_metadata: { role },
    user_metadata: { full_name: `Test ${label}` },
  }, service);
  // create-user.js also upserts the role with the service role. Keep that
  // step so setup works both before and after the fix.
  await asService("update public.profiles set role = $2 where id = $1", [user.id, role]);
  return user.id;
}

async function profileOf(id) {
  const { rows } = await asService("select role, intern_id, supervisor_id from public.profiles where id = $1", [id]);
  return rows[0];
}

const ids = {};

before(async () => {
  assertLocal("TEST_DB_URL", DB_URL);
  assertLocal("TEST_AUTH_URL", AUTH_URL);
  if (!JWT_SECRET) throw new Error("TEST_JWT_SECRET is not set.");
  db = new pg.Client({ connectionString: DB_URL });
  await db.connect();

  ids.admin = await adminCreateUser("admin", "admin");
  ids.hr = await adminCreateUser("hr", "hr_staff");
  ids.supervisor = await adminCreateUser("supervisor", "supervisor");
  ids.intern = await adminCreateUser("intern", "intern");

  // Assign the intern to the supervisor, as an admin would.
  const { rows } = await asService("select id from public.supervisors where profile_id = $1", [ids.supervisor]);
  assert.ok(rows[0], "setup: supervisor row was not created");
  ids.supervisorRow = rows[0].id;
  await asService("update public.interns set supervisor_id = $2 where profile_id = $1", [ids.intern, ids.supervisorRow]);
  const intern = await asService("select id from public.interns where profile_id = $1", [ids.intern]);
  ids.internRow = intern.rows[0].id;
});

after(async () => {
  await db?.end();
});

// --- S1: self-signup must not choose its own role -------------------------

test("S1: public sign-up with role=admin in user metadata gets role intern", async () => {
  const res = await auth("/signup", {
    email: email("attacker"),
    password: PASSWORD,
    data: { role: "admin", full_name: "Attacker" },
  });
  const id = res.user?.id ?? res.id;
  assert.ok(id, "sign-up returned no user id");
  const p = await profileOf(id);
  assert.equal(p.role, "intern");
});

test("S1: admin API sets the role through app_metadata, with no stray intern row", async () => {
  const service = signJwt({ role: "service_role" });
  const user = await auth("/admin/users", {
    email: email("new-supervisor"),
    password: PASSWORD,
    email_confirm: true,
    app_metadata: { role: "supervisor" },
    user_metadata: { full_name: "New Supervisor" },
  }, service);
  const p = await profileOf(user.id);
  assert.equal(p.role, "supervisor");
  const stray = await asService("select count(*)::int as n from public.interns where profile_id = $1", [user.id]);
  assert.equal(stray.rows[0].n, 0, "a supervisor account must not get an interns row");
});

// --- S2: users must not rewrite privileged profile columns -----------------

test("S2: an intern cannot set their own role to admin", async () => {
  await asUser(ids.intern, "update public.profiles set role = 'admin' where id = auth.uid()");
  assert.equal((await profileOf(ids.intern)).role, "intern");
});

test("S2: an intern cannot link themselves to their supervisor's row", async () => {
  await asUser(ids.intern, "update public.profiles set supervisor_id = $1 where id = auth.uid()", [ids.supervisorRow]);
  assert.equal((await profileOf(ids.intern)).supervisor_id, null);
  const r = await asUser(ids.intern, "select public.current_supervisor_id() as id");
  assert.equal(r.rows[0].id, null, "an intern must never resolve to a supervisor");
});

test("S2: a supervisor cannot link themselves to an intern's row", async () => {
  await asUser(ids.supervisor, "update public.profiles set intern_id = $1 where id = auth.uid()", [ids.internRow]);
  assert.equal((await profileOf(ids.supervisor)).intern_id, null);
  const r = await asUser(ids.supervisor, "select public.current_intern_id() as id");
  assert.equal(r.rows[0].id, null, "a supervisor must never resolve to an intern");
});

test("S2: HR staff cannot promote anyone to admin", async () => {
  const target = await adminCreateUser("hr-target", "intern");
  await asUser(ids.hr, "update public.profiles set role = 'admin' where id = $1", [target]);
  assert.equal((await profileOf(target)).role, "intern");
});

test("S2: a wrong link column is ignored when the role does not match", async () => {
  // Simulate a bad link written by a trusted path (a script, a manual SQL
  // edit). The helpers must still not hand an intern a supervisor identity.
  const target = await adminCreateUser("stale-link", "intern");
  await asService("update public.profiles set supervisor_id = $2 where id = $1", [target, ids.supervisorRow]);
  const r = await asUser(target, "select public.current_supervisor_id() as id");
  assert.equal(r.rows[0].id, null);
});

// --- Regression: legitimate paths keep working -----------------------------

test("regression: a user can still edit their own name through update_own_profile", async () => {
  const r = await asUser(ids.intern, "select full_name from public.update_own_profile(p_full_name => 'Renamed Intern')");
  assert.ifError(r.error);
  assert.equal(r.rows[0].full_name, "Renamed Intern");
});

test("regression: the intern and supervisor still resolve to their own rows", async () => {
  const i = await asUser(ids.intern, "select public.current_intern_id() as id");
  assert.equal(i.rows[0].id, ids.internRow);
  const s = await asUser(ids.supervisor, "select public.current_supervisor_id() as id");
  assert.equal(s.rows[0].id, ids.supervisorRow);
});

test("regression: an admin can still change another user's role", async () => {
  const target = await adminCreateUser("promote-me", "intern");
  const r = await asUser(ids.admin, "update public.profiles set role = 'supervisor' where id = $1", [target]);
  assert.ifError(r.error);
  assert.equal((await profileOf(target)).role, "supervisor");
});
