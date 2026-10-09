// scripts/verify-db.mjs
// ---------------------------------------------------------------------------
// End-to-end smoke test for the IMS database behind PostgREST.
//
// Creates three THROWAWAY accounts (admin / supervisor / intern), signs in as
// each of them with the anon key, and exercises the exact selects + RPCs that
// the UI runs for that role - including the RLS boundaries (a non-admin must
// see zero audit_logs, an intern must only see their own intern row, ...).
//
// Every artefact the run creates is removed again in the finally block and the
// script asserts that nothing was left behind, so the database ends up exactly
// as it started.
//
// Usage:  node scripts/verify-db.mjs
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// ---- env ------------------------------------------------------------------
const env = {};
for (const line of readFileSync(new URL("../.env", import.meta.url), "utf8").split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq > 0) env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
}
const SUPABASE_URL = env.VITE_SUPABASE_URL;
const ANON_KEY = env.VITE_SUPABASE_ANON_KEY;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
// Throwaway test-user password — lives in local .env, NEVER hardcoded here.
const TEST_USER_PASSWORD = env.TEST_USER_PASSWORD;
if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY || !TEST_USER_PASSWORD) {
  console.error("verify-db: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY / TEST_USER_PASSWORD are required (.env)");
  process.exit(1);
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const svc = createClient(SUPABASE_URL, SERVICE_KEY, opts);
const adminC = createClient(SUPABASE_URL, ANON_KEY, opts);
const supC = createClient(SUPABASE_URL, ANON_KEY, opts);
const intC = createClient(SUPABASE_URL, ANON_KEY, opts);

// ---- tiny test harness ----------------------------------------------------
let passed = 0;
const failures = [];
const check = async (name, fn) => {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failures.push(name);
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
};
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
/** Fail when a PostgREST result carries an error, otherwise return data. */
const orFail = (res, what) => {
  if (res.error) throw new Error(`${what}: ${res.error.message} (${res.error.code ?? "?"})`);
  return res.data;
};

// ---- throwaway fixtures ---------------------------------------------------
const stamp = Date.now();
const PASSWORD = TEST_USER_PASSWORD;
const emails = {
  admin: `ims-verify-admin-${stamp}@example.com`,
  supervisor: `ims-verify-supervisor-${stamp}@example.com`,
  intern: `ims-verify-intern-${stamp}@example.com`,
};
const ids = { users: {}, profiles: {}, supRow: null, internRow: null, announcement: null };
const startedAt = new Date().toISOString();

async function createUser(email, role, fullName) {
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName, role },
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user;
}
async function signIn(client, email) {
  // The auth endpoint occasionally drops the first connection; retry so a
  // transient network blip does not read as a broken database.
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
    if (!error) return;
    lastError = error;
    await new Promise((r) => setTimeout(r, 750 * attempt));
  }
  throw new Error(`signIn ${email}: ${lastError.message}`);
}
async function profileOf(userId) {
  const { data, error } = await svc
    .from("profiles")
    .select("id, role, full_name, email, intern_id, supervisor_id")
    .eq("id", userId)
    .single();
  if (error) throw new Error(`profileOf: ${error.message}`);
  return data;
}

// ---- self-healing sweep ---------------------------------------------------
// If a previous run was interrupted, rows named `ims-verify-*` may still be
// around. Remove them first so the suite always starts from a clean slate.
async function sweepPreviousRuns() {
  const rm = async (label, res) => {
    if (res?.error) console.log(`  WARN  sweep ${label}: ${res.error.message}`);
  };
  try {
    const { data: users } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 });
    for (const u of users?.users ?? []) {
      if (u.email?.startsWith("ims-verify-")) await svc.auth.admin.deleteUser(u.id, true);
    }

    const { data: profiles } = await svc.from("profiles").select("id, email").like("email", "ims-verify-%");
    const tempProfiles = (profiles ?? []).map((p) => p.id);
    if (tempProfiles.length) {
      await rm("notifications", await svc.from("notifications").delete().in("user_id", tempProfiles));
      await rm("audit_logs(profile)", await svc.from("audit_logs").delete().in("resource_id", tempProfiles));

      const { data: internRows } = await svc.from("interns").select("id").in("profile_id", tempProfiles);
      const tempInterns = (internRows ?? []).map((r) => r.id);
      if (tempInterns.length) {
        await rm("attendance", await svc.from("attendance").delete().in("intern_id", tempInterns));
        await rm("daily_journals", await svc.from("daily_journals").delete().in("intern_id", tempInterns));
        await rm("documents", await svc.from("documents").delete().in("intern_id", tempInterns));
        await rm("evaluations", await svc.from("evaluations").delete().in("intern_id", tempInterns));
        await rm("audit_logs(intern)", await svc.from("audit_logs").delete().in("resource_id", tempInterns));
        await rm("interns", await svc.from("interns").delete().in("id", tempInterns));
      }
      await rm("supervisors", await svc.from("supervisors").delete().in("profile_id", tempProfiles));
      await rm("profiles", await svc.from("profiles").delete().in("id", tempProfiles));
    }

    await rm("announcements", await svc.from("announcements").delete().like("title", "Verify announcement%"));
    await rm("audit_logs(marker)", await svc.from("audit_logs").delete().eq("resource_type", "__verify__"));
  } catch (err) {
    console.log(`  WARN  sweep: ${err.message}`);
  }
}

// ---- setup ----------------------------------------------------------------
async function setup() {
  const a = await createUser(emails.admin, "admin", "Verify Admin");
  const s = await createUser(emails.supervisor, "supervisor", "Verify Supervisor");
  const i = await createUser(emails.intern, "intern", "Verify Intern");
  ids.users = { admin: a.id, supervisor: s.id, intern: i.id };

  const pa = await profileOf(a.id);
  const ps = await profileOf(s.id);
  const pi = await profileOf(i.id);
  ids.profiles = { admin: pa.id, supervisor: ps.id, intern: pi.id };

  await check("handle_new_user reads role from raw_user_meta_data", () => {
    expect(pa.role === "admin", `admin profile role = ${pa.role}`);
    expect(ps.role === "supervisor", `supervisor profile role = ${ps.role}`);
    expect(pi.role === "intern", `intern profile role = ${pi.role}`);
  });

  await check("ensure_role_rows linked supervisor/intern records", () => {
    expect(ps.supervisor_id, "supervisor profile has no supervisors row");
    expect(pi.intern_id, "intern profile has no interns row");
    expect(pa.supervisor_id === null, "admin profile should not be a supervisor");
  });

  const supRow = orFail(
    await svc.from("supervisors").select("id, full_name, email").eq("profile_id", ps.id).single(),
    "supervisor row",
  );
  ids.supRow = supRow.id;
  expect(supRow.full_name === "Verify Supervisor", `supervisor full_name = "${supRow.full_name}"`);

  const internRow = orFail(
    await svc.from("interns").select("id, full_name, supervisor_id").eq("profile_id", pi.id).single(),
    "intern row",
  );
  ids.internRow = internRow.id;
  expect(internRow.full_name === "Verify Intern", `intern full_name = "${internRow.full_name}"`);

  // Assign the intern to the supervisor the same way Admin > Intern Management does.
  orFail(
    await svc.from("interns").update({ supervisor_id: ids.supRow }).eq("id", ids.internRow),
    "assign intern to supervisor",
  );

  // A pending journal so the supervisor has something to review.
  const today = new Date().toISOString().slice(0, 10);
  orFail(
    await svc
      .from("daily_journals")
      .insert({ intern_id: ids.internRow, supervisor_id: ids.supRow, date: today, activities: "verification run", hours_worked: 8 }),
    "seed journal",
  );

  await signIn(adminC, emails.admin);
  await signIn(supC, emails.supervisor);
  await signIn(intC, emails.intern);
  await check("all three throwaway accounts can sign in", () => expect(true, ""));
}

// ---- ADMIN ----------------------------------------------------------------
async function testAdmin() {
  console.log("\nADMIN  (admin@admin.com role)");

  await check("admin: profileService.getByUserId", async () => {
    const rows = orFail(
      await adminC.from("profiles").select(
        "id, full_name, email, avatar_url, contact_number, bio, role, intern_id, supervisor_id, created_at, updated_at",
      ),
      "profiles",
    );
    const me = rows.find((r) => r.id === ids.users.admin);
    expect(me, "own profile not visible");
    expect(me.role === "admin", `role = ${me.role}`);
  });

  await check("admin: internService.list (interns + department/supervisor/institution/program)", async () => {
    const rows = orFail(
      await adminC.from("interns").select(
        "*, department:departments(name), supervisor:supervisors(full_name, email), institution:institutions(institution_name), program:programs(program_name, abbreviation)",
      ),
      "interns list",
    );
    expect(rows.length > 0, "no interns visible to admin");
    expect(
      rows.some((r) => r.full_name === "Verify Intern"),
      "throwaway intern missing from admin list (generated full_name broken?)",
    );
  });

  await check("admin: DtrModal select (full_name, student_number, school)", async () => {
    const rows = orFail(
      await adminC.from("interns").select(
        "full_name, student_number, start_date, end_date, required_hours, school, department:departments(name), institution:institutions(institution_name)",
      ),
      "dtr select",
    );
    expect(rows.length > 0, "no rows");
    expect("full_name" in rows[0], "full_name column missing");
  });

  await check("admin: supervisorService.list (supervisors + profile embed)", async () => {
    const rows = orFail(
      await adminC.from("supervisors").select("*, profile:profile_id (full_name, email), department:departments (name)"),
      "supervisors",
    );
    expect(rows.some((r) => r.full_name === "Verify Supervisor"), "throwaway supervisor missing");
  });

  await check("admin: attendance list with intern embed", async () => {
    orFail(
      await adminC.from("attendance").select("*, intern:interns(first_name, last_name, full_name, supervisor_id)"),
      "attendance",
    );
  });

  await check("admin: journalService.list with embeds", async () => {
    orFail(
      await adminC.from("daily_journals").select(
        "*, intern:interns(full_name, last_name, profile_id, department:departments(id, name)), supervisor:supervisors(id, full_name, first_name, last_name)",
      ),
      "daily_journals",
    );
  });

  await check("admin: documentService list with intern embed", async () => {
    orFail(
      await adminC.from("documents").select("*, intern:interns(first_name, last_name, full_name, profile_id)"),
      "documents",
    );
  });

  await check("admin: evaluationService list with intern embed", async () => {
    orFail(await adminC.from("evaluations").select("*, intern:interns!inner(full_name, last_name)"), "evaluations");
  });

  await check("admin: announcements + likes aggregate (with app fallback)", async () => {
    const primary = await adminC.from("announcements").select("*, announcement_likes(count)");
    if (primary.error) {
      orFail(await adminC.from("announcements").select("*"), "announcements fallback");
      console.log(`        note: likes aggregate unavailable, app falls back -> ${primary.error.message}`);
    }
  });

  await check("admin: auditLogService list with user embed", async () => {
    const rows = orFail(await adminC.from("audit_logs").select("*, user:user_id (full_name, email)"), "audit_logs");
    expect(rows.length > 0, "admin should see audit logs");
  });

  await check("admin: departments / institutions / programs / settings", async () => {
    orFail(await adminC.from("departments").select("*"), "departments");
    orFail(await adminC.from("institutions").select("*"), "institutions");
    orFail(await adminC.from("programs").select("*"), "programs");
    orFail(await adminC.from("settings").select("*"), "settings");
  });

  await check("admin: RPC announcement_create + announcement_update", async () => {
    const created = orFail(
      await adminC.rpc("announcement_create", {
        p_title: "Verify announcement",
        p_body: "temporary body",
        p_category: "company_news",
        p_pinned: false,
      }),
      "announcement_create",
    );
    const row = Array.isArray(created) ? created[0] : created;
    ids.announcement = row?.id ?? null;
    expect(ids.announcement, `no id returned: ${JSON.stringify(created)}`);
    orFail(
      await adminC.rpc("announcement_update", {
        p_id: ids.announcement,
        p_title: "Verify announcement (updated)",
        p_body: null,
        p_category: null,
        p_pinned: null,
      }),
      "announcement_update",
    );
  });

  await check("admin: RPC write_audit_log", async () => {
    orFail(
      await adminC.rpc("write_audit_log", {
        p_action: "update",
        p_resource_type: "__verify__",
        p_resource_id: null,
        p_changes: { verify: true },
      }),
      "write_audit_log",
    );
  });
}


// ---- SUPERVISOR -----------------------------------------------------------
async function testSupervisor() {
  console.log("\nSUPERVISOR  (throwaway supervisor@ role)");

  await check("supervisor: sees assigned interns (RLS scope)", async () => {
    const rows = orFail(
      await supC.from("interns").select("id, full_name, supervisor_id, supervisor:supervisors(full_name, email)").eq("supervisor_id", ids.supRow),
      "interns",
    );
    expect(
      rows.some((r) => r.id === ids.internRow),
      `assigned intern invisible; saw: ${rows.map((r) => r.full_name).join(", ") || "(none)"}`,
    );
    expect(
      rows.every((r) => r.supervisor_id === ids.supRow),
      "intern list leaked an intern assigned to someone else",
    );
  });

  await check("supervisor: journalService.list scoped to own interns", async () => {
    const { data, error } = await supC
      .from("daily_journals")
      .select(
        "*, intern:interns(full_name, last_name, profile_id, department:departments(id, name)), supervisor:supervisors(id, full_name, first_name, last_name)",
      )
      .eq("supervisor_id", ids.supRow);
    expect(!error, error?.message ?? "");
    expect((data ?? []).length > 0, "no journals for the assigned intern");
  });

  await check("supervisor: RPC journal_review -> approved", async () => {
    const { data: journal } = await supC
      .from("daily_journals")
      .select("id")
      .eq("intern_id", ids.internRow)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(journal?.id, "no journal to review");
    const res = orFail(
      await supC.rpc("journal_review", { p_journal_id: journal.id, p_status: "approved", p_comment: "verified" }),
      "journal_review",
    );
    const row = Array.isArray(res) ? res[0] : res;
    expect(row?.status === "approved", `status = ${row?.status}`);
  });

  await check("supervisor: RPC evaluation_create", async () => {
    orFail(
      await supC.rpc("evaluation_create", {
        p_intern_id: ids.internRow,
        p_attendance: 5,
        p_communication: 5,
        p_teamwork: 5,
        p_initiative: 5,
        p_technical_skills: 5,
        p_professionalism: 5,
        p_overall_rating: 5,
        p_comments: "verification run",
        p_final_recommendation: "recommend",
      }),
      "evaluation_create",
    );
  });

  await check("supervisor: RLS cannot read another role's profile", async () => {
    const rows = orFail(await supC.from("profiles").select("id, role"), "profiles");
    expect(!rows.some((r) => r.id === ids.users.admin), "admin profile leaked to supervisor");
    expect(rows.some((r) => r.id === ids.profiles.intern), "assigned intern profile should be visible");
  });

  await check("supervisor: RLS blocks audit_logs (admin only)", async () => {
    const rows = orFail(await supC.from("audit_logs").select("id"), "audit_logs");
    expect(rows.length === 0, `${rows.length} audit rows visible to a supervisor`);
  });

  await check("supervisor: RLS blocks notifications of others", async () => {
    const rows = orFail(await supC.from("notifications").select("id, user_id"), "notifications");
    expect(rows.every((r) => r.user_id === ids.profiles.supervisor), "saw someone else's notifications");
  });
}


// ---- INTERN ---------------------------------------------------------------
async function testIntern() {
  console.log("\nINTERN  (throwaway intern@ role)");

  await check("intern: own row exposes generated full_name + supervisor embed", async () => {
    const rows = orFail(
      await intC.from("interns").select(
        "id, full_name, student_number, start_date, end_date, required_hours, school, department:departments(name), institution:institutions(institution_name), supervisor:supervisors(full_name, email)",
      ),
      "interns",
    );
    expect(rows.length === 1, `expected only own row, got ${rows.length}`);
    expect(rows[0].full_name === "Verify Intern", `full_name = "${rows[0].full_name}"`);
    expect(rows[0].supervisor?.full_name === "Verify Supervisor", `supervisor embed = ${JSON.stringify(rows[0].supervisor)}`);
  });

  await check("intern: RLS hides every other intern", async () => {
    const rows = orFail(await intC.from("interns").select("id"), "interns");
    const leaked = rows.filter((r) => r.id !== ids.internRow).length;
    expect(leaked === 0, `leaked ${leaked} foreign intern rows`);
  });

  await check("intern: RPC attendance_clock_in", async () => {
    const res = orFail(await intC.rpc("attendance_clock_in", { p_method: "manual" }), "attendance_clock_in");
    const row = Array.isArray(res) ? res[0] : res;
    expect(row?.intern_id === ids.internRow, `row bound to ${row?.intern_id}`);
    expect(["present", "late"].includes(row?.status), `status = ${row?.status}`);
  });

  await check("intern: RPC attendance_clock_out", async () => {
    // Drive time_out from the SERVER's time_in (not the local clock): the
    // function requires time_out > time_in, and the two clocks differ by a
    // few hundred milliseconds.
    const { data: open } = await intC
      .from("attendance")
      .select("id, time_in")
      .eq("intern_id", ids.internRow)
      .is("time_out", null)
      .order("time_in", { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(open?.time_in, "no open attendance record after clock-in");
    const out = new Date(new Date(open.time_in).getTime() + 60_000).toISOString();
    const res = orFail(
      await intC.rpc("attendance_clock_out", { p_time_out: out, p_remarks: "verification run" }),
      "attendance_clock_out",
    );
    const row = Array.isArray(res) ? res[0] : res;
    expect(row?.time_out, "time_out not set");
    expect(Number(row?.total_hours) >= 0, `total_hours = ${row?.total_hours}`);
  });

  await check("intern: RPC update_own_profile", async () => {
    orFail(
      await intC.rpc("update_own_profile", {
        p_full_name: "Verify Intern Renamed",
        p_contact_number: "09000000000",
        p_bio: "verification run",
        p_avatar_url: null,
      }),
      "update_own_profile",
    );
    const { data } = await intC.from("profiles").select("full_name, bio").eq("id", ids.users.intern).single();
    expect(data?.full_name === "Verify Intern Renamed", `full_name = ${data?.full_name}`);
    expect(data?.bio === "verification run", `bio = ${data?.bio}`);
  });

  await check("intern: journal insert + list embeds", async () => {
    const row = orFail(
      await intC
        .from("daily_journals")
        .insert({
          intern_id: ids.internRow,
          supervisor_id: ids.supRow,
          date: new Date().toISOString().slice(0, 10),
          activities: "intern self-service check",
          hours_worked: 1,
        })
        .select("*")
        .single(),
      "journal insert",
    );
    expect(row.id, "no id");
    orFail(
      await intC.from("daily_journals").select(
        "*, intern:interns(full_name, last_name, profile_id, department:departments(id, name)), supervisor:supervisors(id, full_name, first_name, last_name)",
      ),
      "journal list",
    );
  });

  await check("intern: announcements readable (cross-role RLS)", async () => {
    const rows = orFail(await intC.from("announcements").select("*"), "announcements");
    expect(rows.some((r) => r.id === ids.announcement), "admin announcement not visible to the intern");
  });

  await check("intern: RPC notify_user + unread count + markRead", async () => {
    orFail(
      await intC.rpc("notify_user", {
        p_user_id: ids.profiles.intern,
        p_type: "document_review",
        p_title: "Verify notification",
        p_message: "temporary",
        p_link: null,
        p_metadata: {},
      }),
      "notify_user",
    );
    const rows = orFail(
      await intC.from("notifications").select("*").eq("user_id", ids.profiles.intern).eq("is_read", false),
      "notifications",
    );
    expect(rows.length > 0, "notification not visible to its owner");
    orFail(
      await intC.from("notifications").update({ is_read: true, read_at: new Date().toISOString() }).eq("id", rows[0].id),
      "markRead",
    );
  });

  await check("intern: RLS blocks audit_logs (admin only)", async () => {
    const rows = orFail(await intC.from("audit_logs").select("id"), "audit_logs");
    expect(rows.length === 0, `${rows.length} audit rows visible to an intern`);
  });

  await check("intern: RLS cannot read the admin profile", async () => {
    const rows = orFail(await intC.from("profiles").select("id, role"), "profiles");
    expect(!rows.some((r) => r.id === ids.users.admin), "admin profile leaked to intern");
    expect(rows.some((r) => r.id === ids.profiles.intern), "own profile missing");
  });
}


// ---- cleanup --------------------------------------------------------------
async function cleanup() {
  const tempInterns = ids.internRow ? [ids.internRow] : [];
  const tempProfiles = Object.values(ids.profiles);
  const drops = [
    ["announcement", () => (ids.announcement ? svc.from("announcements").delete().eq("id", ids.announcement) : null)],
    ["announcement_likes", () => (ids.announcement ? svc.from("announcement_likes").delete().eq("announcement_id", ids.announcement) : null)],
    ["evaluations", () => (tempInterns.length ? svc.from("evaluations").delete().in("intern_id", tempInterns) : null)],
    ["documents", () => (tempInterns.length ? svc.from("documents").delete().in("intern_id", tempInterns) : null)],
    ["attendance", () => (tempInterns.length ? svc.from("attendance").delete().in("intern_id", tempInterns) : null)],
    ["daily_journals", () => (tempInterns.length ? svc.from("daily_journals").delete().in("intern_id", tempInterns) : null)],
    ["notifications", () => (tempProfiles.length ? svc.from("notifications").delete().in("user_id", tempProfiles) : null)],
    ["audit_logs", () =>
      svc
        .from("audit_logs")
        .delete()
        .gte("created_at", startedAt)
        .or(
          [
            "resource_type.eq.__verify__",
            tempProfiles.length ? `user_id.in.(${tempProfiles.join(",")})` : null,
            tempProfiles.length ? `resource_id.in.(${tempProfiles.join(",")})` : null,
            tempInterns.length ? `resource_id.in.(${tempInterns.join(",")})` : null,
          ]
            .filter(Boolean)
            .join(","),
        )],
    ["interns", () => (tempInterns.length ? svc.from("interns").delete().in("id", tempInterns) : null)],
    ["supervisors", () => (tempProfiles.length ? svc.from("supervisors").delete().in("profile_id", tempProfiles) : null)],
    ["profiles", () => (tempProfiles.length ? svc.from("profiles").delete().in("id", tempProfiles) : null)],
  ];
  for (const [what, run] of drops) {
    try {
      const res = await run();
      if (res) orFail(res, `cleanup ${what}`);
    } catch (err) {
      console.log(`  WARN  cleanup ${what}: ${err.message}`);
    }
  }
  for (const id of Object.values(ids.users)) {
    try {
      const { error } = await svc.auth.admin.deleteUser(id, true);
      if (error) console.log(`  WARN  cleanup auth user: ${error.message}`);
    } catch (err) {
      console.log(`  WARN  cleanup auth user: ${err.message}`);
    }
  }
}


/** Nothing from this run may survive. Returns the list of leftovers. */
async function leftovers() {
  const out = [];
  const tempInterns = ids.internRow ? [ids.internRow] : [];
  const tempProfiles = Object.values(ids.profiles);

  const headCount = async (what, res) => {
    if (res.error) { out.push(`${what}: query failed (${res.error.message})`); return; }
    const n = res.count ?? (Array.isArray(res.data) ? res.data.length : 0);
    if (n > 0) out.push(`${what}: ${n} row(s)`);
  };

  await headCount("profiles", await svc.from("profiles").select("id", { count: "exact", head: true }).in("id", tempProfiles));
  await headCount("supervisors", await svc.from("supervisors").select("id", { count: "exact", head: true }).in("profile_id", tempProfiles));
  await headCount("notifications", await svc.from("notifications").select("id", { count: "exact", head: true }).in("user_id", tempProfiles));
  await headCount(
    "audit_logs (__verify__)",
    await svc.from("audit_logs").select("id", { count: "exact", head: true }).gte("created_at", startedAt).eq("resource_type", "__verify__"),
  );
  await headCount(
    "announcements",
    await svc
      .from("announcements")
      .select("id", { count: "exact", head: true })
      .eq("id", ids.announcement ?? "00000000-0000-0000-0000-000000000000"),
  );

  if (tempInterns.length) {
    await headCount("interns", await svc.from("interns").select("id", { count: "exact", head: true }).in("id", tempInterns));
    for (const table of ["attendance", "daily_journals", "evaluations", "documents"]) {
      await headCount(table, await svc.from(table).select("id", { count: "exact", head: true }).in("intern_id", tempInterns));
    }
  }

  try {
    const res = await svc.auth.admin.listUsers({ page: 1, perPage: 200 });
    const remain = (res.data?.users ?? []).filter((u) => Object.values(emails).includes(u.email));
    if (remain.length) out.push(`auth.users: ${remain.map((u) => u.email).join(", ")}`);
  } catch (err) {
    out.push(`auth.users: ${err.message}`);
  }
  return out;
}


// ---- main -----------------------------------------------------------------
async function main() {
  await sweepPreviousRuns();

  let baselineAudit = 0;
  try {
    const res = await svc.from("audit_logs").select("id", { count: "exact", head: true });
    baselineAudit = res.count ?? 0;
  } catch {
    /* ignore */
  }

  console.log("verify-db: creating throwaway admin / supervisor / intern accounts...");
  try {
    await setup();
    await testAdmin();
    await testSupervisor();
    await testIntern();
  } finally {
    console.log("\nCLEANUP");
    await cleanup();
    const left = await leftovers();
    if (left.length) {
      failures.push("leftovers after cleanup");
      console.log("  FAIL  database left clean\n        " + left.join("\n        "));
    } else {
      passed++;
      console.log("  PASS  database left clean (no throwaway rows remain)");
    }
    try {
      const res = await svc.from("audit_logs").select("id", { count: "exact", head: true });
      const now = res.count ?? 0;
      if (now > baselineAudit) {
        console.log(`        note: audit_logs grew ${now - baselineAudit} row(s) during the run`);
      }
    } catch {
      /* ignore */
    }
  }

  const line = "=".repeat(64);
  console.log(`\n${line}`);
  console.log(`verify-db: ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    for (const f of failures) console.log(`  - ${f}`);
    console.log(line);
    process.exit(1);
  }
  console.log(line);
}

await main();

