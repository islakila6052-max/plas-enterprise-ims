// Business writes use real PostgREST/RPCs; SQL only sets up or observes fixtures.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { openLocalStack } from "./local-client.mjs";

let stack;
const users = {};
const ids = {};
const internName = "Test event-intern";

before(async () => {
  stack = await openLocalStack();
  for (const [label, role] of Object.entries({ admin: "admin", hr: "hr_staff", supervisor: "supervisor", otherSupervisor: "supervisor", intern: "intern", otherIntern: "intern" })) {
    users[label] = await stack.createCaller(role, `event-${label}`);
  }
  for (const label of ["supervisor", "otherSupervisor", "intern", "otherIntern"]) {
    const table = label.toLowerCase().includes("supervisor") ? "supervisors" : "interns";
    const rows = await stack.db.query(`select id from public.${table} where profile_id=$1`, [users[label].id]);
    assert.equal(rows.rowCount, 1);
    ids[label] = rows.rows[0].id;
  }
  await patch("interns", ids.intern, { supervisor_id: ids.supervisor }, stack.service);
  await patch("interns", ids.otherIntern, { supervisor_id: ids.otherSupervisor }, stack.service);
});
after(async () => { await stack?.close(); });

async function rpc(name, actor, body) {
  return stack.rest(`/rpc/${name}`, users[actor].token, "POST", body);
}
async function patch(table, id, body, token = users.admin.token) {
  const result = await stack.rest(`/${table}?id=eq.${id}`, token, "PATCH", body);
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.length, 1);
  return result.data[0];
}
function successful(result, status = 200) {
  assert.equal(result.status, status, JSON.stringify(result.data));
  return Array.isArray(result.data) ? result.data[0] : result.data;
}
async function snapshot() {
  return (await stack.db.query("select id from public.notifications")).rows.map((row) => row.id);
}
function notification(user_id, type, title, message, link, metadata) {
  return { user_id, type, title, message, link, metadata };
}
async function expectDelta(previous, expected) {
  const rows = await stack.db.query(
    "select user_id,type::text,title,message,link,metadata from public.notifications where not (id=any($1::uuid[]))", [previous],
  );
  const canonical = (value) => value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
  const sorted = (values) => values.map((row) => JSON.stringify(canonical(row))).sort();
  assert.deepEqual(sorted(rows.rows), sorted(expected), "exact notification content and recipient set");
}
async function audience() {
  return (await stack.db.query("select id,role::text from public.profiles where role in ('admin','supervisor') order by id")).rows;
}

// Attendance: the real clock RPCs, including repeated/failed operations.
test("S5 events: clock-in notifies only the assigned supervisor, once", async () => {
  const prior = await snapshot();
  const row = successful(await rpc("attendance_clock_in", "intern", { p_method: "manual" }));
  await expectDelta(prior, [notification(users.supervisor.id, "attendance_update", "Time in recorded",
    `${internName} just timed in for ${row.date}.`, "/supervisor/attendance", { intern_id: ids.intern, attendance_id: row.id })]);
  const duplicate = await rpc("attendance_clock_in", "intern", { p_method: "manual" });
  assert.equal(duplicate.status, 409);
  await expectDelta(prior, [notification(users.supervisor.id, "attendance_update", "Time in recorded",
    `${internName} just timed in for ${row.date}.`, "/supervisor/attendance", { intern_id: ids.intern, attendance_id: row.id })]);
});

test("S5 events: clock-out notifies only the assigned supervisor, once", async () => {
  const existing = await stack.db.query("select * from public.attendance where intern_id=$1 and date=public.attendance_today()", [ids.intern]);
  const prior = await snapshot();
  const row = successful(await rpc("attendance_clock_out", "intern", {
    p_time_out: new Date(existing.rows[0].time_in.getTime() + 60000).toISOString(), p_remarks: "Completed shift",
  }));
  const expected = [notification(users.supervisor.id, "attendance_update", "Time out recorded",
    `${internName} timed out for ${row.date}.`, "/supervisor/attendance", { intern_id: ids.intern, attendance_id: row.id })];
  await expectDelta(prior, expected);
  const duplicate = await rpc("attendance_clock_out", "intern", { p_time_out: row.time_out });
  assert.ok(duplicate.status >= 400, "a closed attendance record must reject another clock-out");
  await expectDelta(prior, expected);
});

for (const [index, decision] of ["approved", "rejected"].entries()) {
  test(`S5 events: ${decision} clock-out claim notifies only its intern, without a second clock-out alert`, async () => {
    const created = successful(await stack.rest("/attendance", stack.service, "POST", {
      intern_id: ids.intern, date: `2020-01-0${index + 1}`, time_in: "2020-01-01T08:00:00Z",
    }), 201);
    successful(await rpc("attendance_submit_claim", "intern", { p_record_id: created.id, p_claimed_time_out: "2020-01-01T09:00:00Z", p_remarks: "Missed clock-out" }));
    const prior = await snapshot();
    const denied = await rpc("attendance_review_claim", "otherSupervisor", { p_record_id: created.id, p_decision: decision });
    assert.equal(denied.status, 403);
    await expectDelta(prior, []);
    successful(await rpc("attendance_review_claim", "supervisor", { p_record_id: created.id, p_decision: decision }));
    const expected = [notification(users.intern.id, "attendance_update", `Clock-out claim ${decision}`,
      `Your claimed clock-out for ${created.date} was ${decision}.`, "/intern/attendance", { attendance_id: created.id, decision })];
    await expectDelta(prior, expected);
    const duplicate = await rpc("attendance_review_claim", "supervisor", { p_record_id: created.id, p_decision: decision });
    assert.equal(duplicate.status, 400);
    await expectDelta(prior, expected);
  });
}

async function journal(date) {
  return successful(await stack.rest("/daily_journals", users.intern.token, "POST", {
    intern_id: ids.intern, supervisor_id: ids.supervisor, date, activities: "Recorded test work", hours_worked: 1,
  }), 201);
}

test("S5 events: journal submission notifies only the assigned supervisor", async () => {
  const prior = await snapshot();
  const row = await journal("2020-02-01");
  const expected = [notification(users.supervisor.id, "journal_submitted", "New journal entry",
    `${internName} submitted a journal entry for ${row.date}.`, "/supervisor/journals", { intern_id: ids.intern, journal_id: row.id })];
  await expectDelta(prior, expected);
  await patch("daily_journals", row.id, { activities: "Edited work" }, stack.service);
  await expectDelta(prior, expected);
});

for (const [index, actor] of ["admin", "supervisor"].entries()) {
  test(`S5 events: ${actor} journal reviews notify only the owner, once per changed decision`, async () => {
    const row = await journal(`2020-02-0${index + 2}`);
    const prior = await snapshot();
    const denied = await rpc("journal_review", "otherSupervisor", { p_journal_id: row.id, p_status: "approved" });
    assert.equal(denied.status, 403);
    await expectDelta(prior, []);
    successful(await rpc("journal_review", actor, { p_journal_id: row.id, p_status: "approved", p_comment: "Reviewed" }));
    const expected = [notification(users.intern.id, "journal_review", "Journal approved",
      `Your journal for ${row.date} was approved.`, "/intern/journal", { journal_id: row.id, status: "approved" })];
    await expectDelta(prior, expected);
    successful(await rpc("journal_review", actor, { p_journal_id: row.id, p_status: "approved", p_comment: "Edited comment" }));
    await expectDelta(prior, expected);
    successful(await rpc("journal_review", actor, { p_journal_id: row.id, p_status: "rejected" }));
    expected.push(notification(users.intern.id, "journal_review", "Journal rejected",
      `Your journal for ${row.date} was rejected.`, "/intern/journal", { journal_id: row.id, status: "rejected" }));
    await expectDelta(prior, expected);
  });
}

test("S5 events: evaluation creation notifies only its intern", async () => {
  const body = { p_intern_id: ids.intern, p_attendance: 4, p_communication: 4, p_teamwork: 4, p_initiative: 4,
    p_technical_skills: 4, p_professionalism: 4, p_overall_rating: 4, p_comments: "Recorded evaluation" };
  const prior = await snapshot();
  const denied = await rpc("evaluation_create", "otherSupervisor", body);
  assert.equal(denied.status, 403);
  await expectDelta(prior, []);
  const row = successful(await rpc("evaluation_create", "supervisor", body));
  const expected = [notification(users.intern.id, "evaluation_submitted", "New evaluation received",
    "Your supervisor submitted a new evaluation for you.", "/intern/evaluation", { intern_id: ids.intern, evaluation_id: row.id, overall_rating: 4 })];
  await expectDelta(prior, expected);
  await patch("evaluations", row.id, { comments: "Edited comment" }, stack.service);
  await expectDelta(prior, expected);
});

async function document() {
  return successful(await stack.rest("/documents", users.intern.token, "POST", {
    intern_id: ids.intern, type: "resume", file_name: "resume.pdf", file_path: `${ids.intern}/resume.pdf`, mime_type: "application/pdf", file_size: 100,
  }), 201);
}

test("S5 events: document submission reaches admins and only the assigned supervisor", async () => {
  const admins = (await audience()).filter((p) => p.role === "admin");
  const prior = await snapshot();
  const row = await document();
  const expected = [...admins.map((p) => notification(p.id, "document_review", "New document submitted",
    `${internName} submitted a document for review.`, "/admin/documents", { intern_id: ids.intern, document_id: row.id })),
  notification(users.supervisor.id, "document_review", "New document submitted",
    `${internName} submitted a document for review.`, "/supervisor/documents", { intern_id: ids.intern, document_id: row.id })];
  await expectDelta(prior, expected);
  await patch("documents", row.id, { file_size: 101 }, stack.service);
  await expectDelta(prior, expected);
});

test("S5 events: document review notifies only the owning intern, once per changed status", async () => {
  const row = await document();
  const prior = await snapshot();
  const denied = await rpc("document_review", "supervisor", { p_document_id: row.id, p_status: "approved" });
  assert.equal(denied.status, 403);
  await expectDelta(prior, []);
  const expected = [];
  for (const status of ["approved", "rejected"]) {
    successful(await rpc("document_review", "admin", { p_document_id: row.id, p_status: status }));
    expected.push(notification(users.intern.id, "document_review", `Document ${status}`,
      `Your document "resume.pdf" was ${status}.`, "/intern/documents", { document_id: row.id, status }));
    await expectDelta(prior, expected);
    successful(await rpc("document_review", "admin", { p_document_id: row.id, p_status: status }));
    await expectDelta(prior, expected);
  }
});

for (const [index, label] of ["assignment", "reassignment"].entries()) {
  test(`S5 events: intern ${label} notifies only the new supervisor`, async () => {
    const target = index === 0 ? ids.supervisor : ids.otherSupervisor;
    const recipient = index === 0 ? users.supervisor.id : users.otherSupervisor.id;
    if (index === 0) await patch("interns", ids.intern, { supervisor_id: null }, stack.service);
    const prior = await snapshot();
    await patch("interns", ids.intern, { supervisor_id: target });
    const expected = [notification(recipient, "intern_assigned", index === 0 ? "New intern assigned" : "Intern reassigned",
      `${internName} was ${index === 0 ? "assigned" : "reassigned"} to you.`, "/supervisor/interns", { intern_id: ids.intern })];
    await expectDelta(prior, expected);
    await patch("interns", ids.intern, { supervisor_id: target, contact_number: "000" });
    await expectDelta(prior, expected);
  });
}

for (const [status, title, message] of [
  ["archived", "Internship archived", "Your internship record has been archived."],
  ["active", "Internship restored", "Your internship record has been reactivated."],
]) {
  test(`S5 events: changing intern status to ${status} notifies only that intern, once`, async () => {
    const prior = await snapshot();
    await patch("interns", ids.intern, { status });
    const expected = [notification(users.intern.id, "intern_status", title, message, "/intern", { intern_id: ids.intern, status })];
    await expectDelta(prior, expected);
    await patch("interns", ids.intern, { status });
    await expectDelta(prior, expected);
  });
}

test("S5 events: supervisor detail changes notify only that supervisor, not for no-op or profile sync", async () => {
  const prior = await snapshot();
  const row = await patch("supervisors", ids.supervisor, { first_name: "Updated" });
  const expected = [notification(users.supervisor.id, "account_created", "Your account was updated",
    `${row.full_name}, your supervisor account details were updated by an admin.`, "/supervisor", { supervisor_id: row.id })];
  await expectDelta(prior, expected);
  await patch("supervisors", ids.supervisor, { first_name: "Updated" });
  await patch("profiles", users.supervisor.id, { full_name: row.full_name });
  await expectDelta(prior, expected);
});

for (const role of ["intern", "supervisor"]) {
  test(`S5 events: ${role} welcome follows final provisioning, with no transient intern welcome or duplicate`, async () => {
    const label = `s5-${role}-ready`;
    const prior = await snapshot();
    const result = successful(await stack.createAccount(users.admin.token, role, label));
    const userId = result.user.id;
    await expectDelta(prior, []); // GoTrue's intermediate role rows are not ready accounts.
    const table = role === "intern" ? "interns" : "supervisors";
    const body = { profile_id: userId, first_name: "New", last_name: label, email: result.user.email, created_by: users.admin.id };
    const row = successful(await stack.rest(`/${table}?on_conflict=profile_id`, users.admin.token, "POST", body,
      { Prefer: "resolution=merge-duplicates,return=representation" }));
    const expected = [notification(userId, "account_created", role === "intern" ? "Your account is ready" : "Your supervisor account is ready",
      role === "intern" ? "Your internship account was created. You can now log in." : `Welcome New ${label}! You have been created as a supervisor. You can now log in and manage interns.`,
      `/${role}`, { profile_id: userId })];
    if (role === "supervisor") {
      for (const recipient of await audience()) expected.push(notification(recipient.id, "announcement", "New supervisor created",
        `New ${label} has been created as a new supervisor.`, recipient.role === "admin" ? "/admin/supervisors" : "/supervisor",
        { supervisor_id: row.id, supervisor_name: `New ${label}` }));
      const stray = await stack.db.query("select id from public.interns where profile_id=$1", [userId]);
      assert.equal(stray.rowCount, 0);
    }
    await expectDelta(prior, expected);
    successful(await stack.rest(`/${table}?on_conflict=profile_id`, users.admin.token, "POST", body,
      { Prefer: "resolution=merge-duplicates,return=representation" }));
    await expectDelta(prior, expected);
  });
}

test("S5 events: announcement creation reaches only admins and supervisors with role-appropriate links", async () => {
  const recipients = await audience();
  const prior = await snapshot();
  const row = successful(await rpc("announcement_create", "admin", { p_title: "Recorded announcement", p_body: "Recorded announcement body", p_category: "company_news", p_pinned: false }));
  const expected = recipients.map((p) => notification(p.id, "announcement", "New announcement: Recorded announcement", "Recorded announcement body",
    p.role === "admin" ? "/admin/announcements" : "/supervisor", { announcement_id: row.id, category: "company_news" }));
  await expectDelta(prior, expected);
  successful(await rpc("announcement_update", "admin", { p_id: row.id, p_title: row.title, p_body: row.body, p_category: row.category, p_pinned: true }));
  await expectDelta(prior, expected);
});

test("S5 events: supervisor removal preserves notification cleanup without deleting another profile's notifications", async () => {
  for (const user of [users.supervisor, users.otherSupervisor]) {
    successful(await stack.rest("/notifications", stack.service, "POST", {
      user_id: user.id, type: "announcement", title: "Cleanup fixture", message: "Cleanup fixture",
    }), 201);
  }
  const others = await stack.db.query("select id from public.notifications where user_id=$1 order by id", [users.otherSupervisor.id]);
  // supervisorService.remove now delegates notification cleanup to the
  // authorized supervisor DELETE, not a browser notification write.
  const removed = await stack.rest(`/supervisors?id=eq.${ids.supervisor}`, users.admin.token, "DELETE");
  assert.equal(removed.status, 200, JSON.stringify(removed.data));
  assert.equal(removed.data.length, 1);
  const remaining = await stack.db.query("select id from public.notifications where user_id=$1", [users.supervisor.id]);
  assert.equal(remaining.rowCount, 0, "authorized supervisor deletion must still clean its notifications");
  assert.deepEqual((await stack.db.query("select id from public.notifications where user_id=$1 order by id", [users.otherSupervisor.id])).rows, others.rows);
});
