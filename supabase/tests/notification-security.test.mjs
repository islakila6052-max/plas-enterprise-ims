import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openLocalStack } from "./local-client.mjs";

let stack;
const callers = {};
before(async () => {
  stack = await openLocalStack();
  for (const role of ["admin", "hr_staff", "supervisor", "intern"]) callers[role] = await stack.createCaller(role);
});

after(async () => { await stack?.close(); });

for (const role of ["admin", "hr_staff", "supervisor", "intern"]) {
  for (const rpc of ["notify_user", "notify_role"]) {
    test(`S5: ${role} cannot call ${rpc} with arbitrary content`, async () => {
      const title = `forged-${randomUUID()}`;
      const body = { p_type: "announcement", p_title: title, p_message: "Forged", p_link: "https://example.com", p_metadata: {} };
      if (rpc === "notify_user") body.p_user_id = callers.admin.id;
      else body.p_role = "admin";
      const result = await stack.rest(`/rpc/${rpc}`, callers[role].token, "POST", body);
      const rows = await stack.db.query("select id from public.notifications where title=$1", [title]);
      assert.equal(rows.rowCount, 0, "arbitrary RPC must not create notifications");
      assert.equal(result.status, 403, JSON.stringify(result.data));
    });
  }
  test(`S5: ${role} cannot insert a notification directly`, async () => {
    const id = randomUUID();
    const result = await stack.rest("/notifications", callers[role].token, "POST", {
      id, user_id: callers.admin.id, type: "announcement", title: "Forged", message: "Forged",
    }, { Prefer: "return=minimal" });
    const rows = await stack.db.query("select id from public.notifications where id=$1", [id]);
    assert.equal(rows.rowCount, 0, "direct INSERT must not create notifications");
    assert.equal(result.status, 403, JSON.stringify(result.data));
  });
  test(`S5: ${role} cannot edit even their own notification content`, async () => {
    const created = await stack.rest("/notifications", stack.service, "POST", {
      user_id: callers[role].id, type: "announcement", title: "Original title",
      message: "Original message", link: "/intern", metadata: { source: "fixture" },
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const seed = created.data[0];
    const result = await stack.rest(`/notifications?id=eq.${seed.id}`, callers[role].token, "PATCH", {
      title: "Forged", message: "Forged", link: "//example.com", metadata: { forged: true },
    });
    const rows = await stack.db.query("select user_id,title,message,link,metadata from public.notifications where id=$1", [seed.id]);
    assert.deepEqual(rows.rows[0], { user_id: seed.user_id, title: seed.title, message: seed.message, link: seed.link, metadata: seed.metadata });
    assert.equal(result.status, 403, JSON.stringify(result.data));
  });
  test(`S5: ${role} cannot move a notification to another recipient`, async () => {
    const created = await stack.rest("/notifications", stack.service, "POST", {
      user_id: callers[role].id, type: "announcement", title: "Original recipient", message: "Original recipient",
    });
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const seed = created.data[0];
    const other = role === "intern" ? callers.admin : callers.intern;
    const result = await stack.rest(`/notifications?id=eq.${seed.id}`, callers[role].token, "PATCH", { user_id: other.id });
    const rows = await stack.db.query("select user_id from public.notifications where id=$1", [seed.id]);
    assert.equal(rows.rows[0].user_id, callers[role].id, "notification recipient must stay unchanged");
    assert.equal(result.status, 403, JSON.stringify(result.data));
  });
  test(`S5: ${role} sees only own notifications and cannot mark another user's read`, async () => {
    const own = await stack.rest("/notifications", stack.service, "POST", {
      user_id: callers[role].id, type: "announcement", title: "Own", message: "Own",
    });
    assert.equal(own.status, 201);
    const list = await stack.rest("/notifications?select=id,user_id", callers[role].token, "GET");
    assert.equal(list.status, 200);
    assert.ok(list.data.some((row) => row.id === own.data[0].id));
    assert.ok(list.data.every((row) => row.user_id === callers[role].id), "only own notifications may be read");
    const other = role === "intern" ? callers.admin : callers.intern;
    const target = await stack.rest("/notifications", stack.service, "POST", {
      user_id: other.id, type: "announcement", title: "Other", message: "Other",
    });
    const marked = await stack.rest(`/notifications?id=eq.${target.data[0].id}`, callers[role].token, "PATCH", { is_read: true });
    assert.equal(marked.status, 200, JSON.stringify(marked.data));
    assert.deepEqual(marked.data, []);
    const persisted = await stack.db.query("select is_read from public.notifications where id=$1", [target.data[0].id]);
    assert.equal(persisted.rows[0].is_read, false);
  });
  test(`S5: ${role} can mark own notification read without changing content`, async () => {
    const own = await stack.rest("/notifications", stack.service, "POST", {
      user_id: callers[role].id, type: "announcement", title: "Own read", message: "Own read",
    });
    assert.equal(own.status, 201);
    const timestamp = "2026-01-01T12:00:00.000Z";
    const marked = await stack.rest(`/notifications?id=eq.${own.data[0].id}`, callers[role].token, "PATCH", { is_read: true, read_at: timestamp });
    assert.equal(marked.status, 200, JSON.stringify(marked.data));
    assert.equal(marked.data.length, 1);
    const persisted = await stack.db.query("select is_read,read_at,title,message from public.notifications where id=$1", [own.data[0].id]);
    assert.equal(persisted.rows[0].is_read, true);
    assert.equal(persisted.rows[0].read_at.toISOString(), timestamp);
    assert.equal(persisted.rows[0].title, "Own read");
    assert.equal(persisted.rows[0].message, "Own read");
  });
}

test("S5: anon cannot read notifications", async () => {
  const result = await stack.rest("/notifications", stack.anon, "GET");
  assert.equal(result.status, 401, JSON.stringify(result.data));
});

for (const rpc of ["notify_user", "notify_role"]) {
  test(`S5: anon cannot call ${rpc}`, async () => {
    const title = `anon-${randomUUID()}`;
    const result = await stack.rest(`/rpc/${rpc}`, stack.anon, "POST", {
      ...(rpc === "notify_user" ? { p_user_id: callers.admin.id } : { p_role: "admin" }),
      p_type: "announcement", p_title: title, p_message: "Anon",
    });
    const rows = await stack.db.query("select id from public.notifications where title=$1", [title]);
    assert.equal(rows.rowCount, 0, "anonymous RPC must not create notifications");
    assert.equal(result.status, 401, JSON.stringify(result.data));
  });
}

test("S5: anon cannot insert notifications", async () => {
  const id = randomUUID();
  const result = await stack.rest("/notifications", stack.anon, "POST", {
    id, user_id: callers.admin.id, type: "announcement", title: "Anon insert", message: "Anon insert",
  }, { Prefer: "return=minimal" });
  assert.equal((await stack.db.query("select id from public.notifications where id=$1", [id])).rowCount, 0);
  assert.equal(result.status, 401, JSON.stringify(result.data));
});

test("S5: anon cannot update notifications", async () => {
  const created = await stack.rest("/notifications", stack.service, "POST", {
    user_id: callers.admin.id, type: "announcement", title: "Original anon target", message: "Original anon target",
  });
  assert.equal(created.status, 201);
  const id = created.data[0].id;
  const result = await stack.rest(`/notifications?id=eq.${id}`, stack.anon, "PATCH", { title: "Anon forgery" }, { Prefer: "return=minimal" });
  const persisted = await stack.db.query("select title from public.notifications where id=$1", [id]);
  assert.equal(persisted.rows[0].title, "Original anon target");
  assert.equal(result.status, 401, JSON.stringify(result.data));
});

test("S5: service role retains trusted notify_user", async () => {
  const title = `trusted-${randomUUID()}`;
  const result = await stack.rest("/rpc/notify_user", stack.service, "POST", {
    p_user_id: callers.admin.id, p_type: "announcement", p_title: title, p_message: "Trusted", p_link: "/admin",
  });
  assert.equal(result.status, 204, JSON.stringify(result.data));
  const rows = await stack.db.query("select user_id,link from public.notifications where title=$1", [title]);
  assert.deepEqual(rows.rows, [{ user_id: callers.admin.id, link: "/admin" }]);
});

test("S5: service role retains trusted notify_role without other recipients", async () => {
  const title = `trusted-role-${randomUUID()}`;
  const expected = (await stack.db.query("select id from public.profiles where role='admin'")).rows.map((row) => row.id).sort();
  const result = await stack.rest("/rpc/notify_role", stack.service, "POST", {
    p_role: "admin", p_type: "announcement", p_title: title, p_message: "Trusted role", p_link: "/admin",
  });
  assert.equal(result.status, 204, JSON.stringify(result.data));
  const rows = await stack.db.query("select user_id,link from public.notifications where title=$1", [title]);
  assert.deepEqual(rows.rows.map((row) => row.user_id).sort(), expected);
  assert.ok(rows.rows.every((row) => row.link === "/admin"));
});
