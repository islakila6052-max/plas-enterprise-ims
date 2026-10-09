#!/usr/bin/env node
// =============================================================================
// test_sidebar_features.mjs
// =============================================================================
// End-to-end test of EVERY sidebar item for all three roles (Intern,
// Supervisor, Admin).  Creates throwaway accounts, signs in as each role,
// exercises the exact Supabase selects + RPCs that the UI calls for that
// role, and verifies RLS boundaries (a non-admin must see zero audit_logs,
// an intern must only see their own intern row, etc.).
//
// Every artefact the run creates is removed again in the finally block so
// the database ends up exactly as it started.
//
// Usage:  node scripts/test_sidebar_features.mjs
// =============================================================================

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// ---- env ------------------------------------------------------------------
const env = {};
for (const line of readFileSync(
  new URL("../.env", import.meta.url),
  "utf8",
).split(/\r?\n/)) {
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
  console.error(
    "Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY / TEST_USER_PASSWORD in .env",
  );
  process.exit(1);
}

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const svc = createClient(SUPABASE_URL, SERVICE_KEY, opts); // service-role (bypasses RLS)
const adminC = createClient(SUPABASE_URL, ANON_KEY, opts); // admin anon client
const supC = createClient(SUPABASE_URL, ANON_KEY, opts); // supervisor anon client
const intC = createClient(SUPABASE_URL, ANON_KEY, opts); // intern anon client

// ---- tiny test harness ----------------------------------------------------
let passed = 0,
  failed = 0;
const failures = [];

async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err) {
    failed++;
    failures.push(name);
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
}
function expect(cond, msg) {
  if (!cond) throw new Error(msg);
}
function orFail(res, what) {
  if (res.error)
    throw new Error(`${what}: ${res.error.message} (${res.error.code ?? "?"})`);
  return res.data;
}

// ---- throwaway fixtures ---------------------------------------------------
const stamp = Date.now();
const PASSWORD = TEST_USER_PASSWORD;
const emails = {
  admin: `ims-test-admin-${stamp}@example.com`,
  supervisor: `ims-test-supervisor-${stamp}@example.com`,
  intern: `ims-test-intern-${stamp}@example.com`,
};
const ids = {
  users: {},
  profiles: {},
  supRow: null,
  internRow: null,
  announcement: null,
  journal: null,
  document: null,
  evaluation: null,
  attendance: null,
};
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
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { error } = await client.auth.signInWithPassword({
      email,
      password: PASSWORD,
    });
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

// ---- setup ----------------------------------------------------------------
async function setup() {
  console.log("Creating throwaway admin / supervisor / intern accounts...");
  const a = await createUser(emails.admin, "admin", "Test Admin");
  const s = await createUser(
    emails.supervisor,
    "supervisor",
    "Test Supervisor",
  );
  const i = await createUser(emails.intern, "intern", "Test Intern");
  ids.users = { admin: a.id, supervisor: s.id, intern: i.id };

  const pa = await profileOf(a.id);
  const ps = await profileOf(s.id);
  const pi = await profileOf(i.id);
  ids.profiles = { admin: pa.id, supervisor: ps.id, intern: pi.id };

  // Verify handle_new_user read the role from raw_user_meta_data
  expect(pa.role === "admin", `admin profile role = ${pa.role}`);
  expect(ps.role === "supervisor", `supervisor profile role = ${ps.role}`);
  expect(pi.role === "intern", `intern profile role = ${pi.role}`);

  // ensure_role_rows should have created linked rows
  expect(ps.supervisor_id, "supervisor profile has no supervisors row");
  expect(pi.intern_id, "intern profile has no interns row");
  expect(pa.supervisor_id === null, "admin profile should not be a supervisor");

  // Grab the supervisor & intern row ids
  const supRow = orFail(
    await svc
      .from("supervisors")
      .select("id, full_name, email")
      .eq("profile_id", ps.id)
      .single(),
    "supervisor row",
  );
  ids.supRow = supRow.id;
  expect(
    supRow.full_name === "Test Supervisor",
    `supervisor full_name = "${supRow.full_name}"`,
  );

  const internRow = orFail(
    await svc
      .from("interns")
      .select("id, full_name, supervisor_id")
      .eq("profile_id", pi.id)
      .single(),
    "intern row",
  );
  ids.internRow = internRow.id;
  expect(
    internRow.full_name === "Test Intern",
    `intern full_name = "${internRow.full_name}"`,
  );

  // Assign the intern to the supervisor (same way Admin > Intern Management does)
  orFail(
    await svc
      .from("interns")
      .update({ supervisor_id: ids.supRow })
      .eq("id", ids.internRow),
  );

  // Seed a pending journal for the supervisor to review
  const today = new Date().toISOString().slice(0, 10);
  const { data: journal } = orFail(
    await svc
      .from("daily_journals")
      .insert({
        intern_id: ids.internRow,
        supervisor_id: ids.supRow,
        date: today,
        activities: "verification run",
        hours_worked: 8,
      })
      .select("*")
      .single(),
    "seed journal",
  );
  ids.journal = journal?.id ?? null;

  // Sign in all three clients
  await signIn(adminC, emails.admin);
  await signIn(supC, emails.supervisor);
  await signIn(intC, emails.intern);
}

// ---- ADMIN ----------------------------------------------------------------
async function testAdmin() {
  console.log(
    "\nADMIN  (sidebar: Dashboard, Interns, Supervisors, Attendance, Daily Journals, Documents, Evaluations, Announcements, Reports, Institutions, Audit Logs, Settings, Profile)",
  );

  // --- Dashboard ---
  await check("admin: profileService.getByUserId", async () => {
    const rows = orFail(
      await adminC
        .from("profiles")
        .select(
          "id, full_name, email, avatar_url, contact_number, bio, role, intern_id, supervisor_id, created_at, updated_at",
        ),
      "profiles",
    );
    const me = rows.find((r) => r.id === ids.users.admin);
    expect(me, "own profile not visible");
    expect(me.role === "admin", `role = ${me.role}`);
  });

  await check(
    "admin: dashboardService.adminStats (intern counts)",
    async () => {
      const [
        totalInterns,
        activeInterns,
        completed,
        archived,
        pendingEvals,
        attendanceToday,
      ] = await Promise.all([
        adminC.from("interns").select("*", { count: "exact", head: true }),
        adminC
          .from("interns")
          .select("*", { count: "exact", head: true })
          .eq("status", "active"),
        adminC
          .from("interns")
          .select("*", { count: "exact", head: true })
          .eq("status", "completed"),
        adminC
          .from("interns")
          .select("*", { count: "exact", head: true })
          .eq("status", "archived"),
        adminC
          .from("evaluations")
          .select("*", { count: "exact", head: true })
          .eq("status", "pending"),
        adminC
          .from("attendance")
          .select("*", { count: "exact", head: true })
          .eq("date", new Date().toISOString().slice(0, 10)),
      ]);
      expect(
        !totalInterns.error,
        `totalInterns error: ${totalInterns.error?.message}`,
      );
      expect(
        !pendingEvals.error,
        `pendingEvals error: ${pendingEvals.error?.message}`,
      );
      expect(
        !attendanceToday.error,
        `attendanceToday error: ${attendanceToday.error?.message}`,
      );
    },
  );

  // --- Interns ---
  await check(
    "admin: internService.list (interns + department/supervisor/institution/program)",
    async () => {
      const rows = orFail(
        await adminC
          .from("interns")
          .select(
            "*, department:departments(name), supervisor:supervisors(full_name, email), institution:institutions(institution_name), program:programs(program_name, abbreviation)",
          ),
        "interns list",
      );
      expect(rows.length > 0, "no interns visible to admin");
      expect(
        rows.some((r) => r.full_name === "Test Intern"),
        "throwaway intern missing from admin list",
      );
    },
  );

  await check(
    "admin: DtrModal select (full_name, student_number, school)",
    async () => {
      const rows = orFail(
        await adminC
          .from("interns")
          .select(
            "full_name, student_number, start_date, end_date, required_hours, school, department:departments(name), institution:institutions(institution_name)",
          ),
        "dtr select",
      );
      expect(rows.length > 0, "no rows");
      expect("full_name" in rows[0], "full_name column missing");
    },
  );

  // --- Supervisors ---
  await check(
    "admin: supervisorService.list (supervisors + profile embed)",
    async () => {
      const rows = orFail(
        await adminC
          .from("supervisors")
          .select(
            "*, profile:profile_id (full_name, email), department:departments (name)",
          ),
        "supervisors",
      );
      expect(
        rows.some((r) => r.full_name === "Test Supervisor"),
        "throwaway supervisor missing",
      );
    },
  );

  // --- Attendance ---
  await check("admin: attendance list with intern embed", async () => {
    orFail(
      await adminC
        .from("attendance")
        .select(
          "*, intern:interns(first_name, last_name, full_name, supervisor_id)",
        ),
      "attendance",
    );
  });

  // --- Daily Journals ---
  await check("admin: journalService.list with embeds", async () => {
    orFail(
      await adminC
        .from("daily_journals")
        .select(
          "*, intern:interns(full_name, last_name, profile_id, department:departments(id, name)), supervisor:supervisors(id, full_name, first_name, last_name)",
        ),
      "daily_journals",
    );
  });

  // --- Documents ---
  await check("admin: documentService list with intern embed", async () => {
    orFail(
      await adminC
        .from("documents")
        .select(
          "*, intern:interns(first_name, last_name, full_name, profile_id)",
        ),
      "documents",
    );
  });

  // --- Evaluations ---
  await check("admin: evaluationService list with intern embed", async () => {
    orFail(
      await adminC
        .from("evaluations")
        .select("*, intern:interns!inner(full_name, last_name)"),
      "evaluations",
    );
  });

  // --- Announcements ---
  await check(
    "admin: announcements + likes aggregate (with app fallback)",
    async () => {
      const primary = await adminC
        .from("announcements")
        .select("*, announcement_likes(count)");
      if (primary.error) {
        orFail(
          await adminC.from("announcements").select("*"),
          "announcements fallback",
        );
        console.log(
          "        note: likes aggregate unavailable, app falls back",
        );
      }
    },
  );

  // --- Reports (audit logs) ---
  await check("admin: auditLogService list with user embed", async () => {
    const rows = orFail(
      await adminC
        .from("audit_logs")
        .select("*, user:user_id (full_name, email)"),
      "audit_logs",
    );
    expect(rows.length > 0, "admin should see audit logs");
  });

  // --- Institutions / Programs / Settings ---
  await check(
    "admin: departments / institutions / programs / settings",
    async () => {
      orFail(await adminC.from("departments").select("*"), "departments");
      orFail(await adminC.from("institutions").select("*"), "institutions");
      orFail(await adminC.from("programs").select("*"), "programs");
      orFail(await adminC.from("settings").select("*"), "settings");
    },
  );

  // --- RPC: announcement CRUD ---
  await check(
    "admin: RPC announcement_create + announcement_update",
    async () => {
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
    },
  );

  // --- RPC: write_audit_log ---
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

  // --- Profile ---
  await check("admin: RPC update_own_profile", async () => {
    orFail(
      await adminC.rpc("update_own_profile", {
        p_full_name: "Test Admin Renamed",
        p_contact_number: "09000000001",
        p_bio: "verify run",
        p_avatar_url: null,
      }),
      "update_own_profile",
    );
    const { data } = await adminC
      .from("profiles")
      .select("full_name, bio")
      .eq("id", ids.users.admin)
      .single();
    expect(
      data?.full_name === "Test Admin Renamed",
      `full_name = ${data?.full_name}`,
    );
    expect(data?.bio === "verify run", `bio = ${data?.bio}`);
  });
}

// ---- SUPERVISOR -----------------------------------------------------------
async function testSupervisor() {
  console.log(
    "\nSUPERVISOR  (sidebar: Dashboard, Assigned Interns, Attendance, Daily Journals, Evaluations, Profile)",
  );

  // --- Dashboard ---
  await check("supervisor: sees assigned interns (RLS scope)", async () => {
    const rows = orFail(
      await supC
        .from("interns")
        .select(
          "id, full_name, supervisor_id, supervisor:supervisors(full_name, email)",
        )
        .eq("supervisor_id", ids.supRow),
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

  await check(
    "supervisor: journalService.list scoped to own interns",
    async () => {
      const { data, error } = await supC
        .from("daily_journals")
        .select(
          "*, intern:interns(full_name, last_name, profile_id, department:departments(id, name)), supervisor:supervisors(id, full_name, first_name, last_name)",
        )
        .eq("supervisor_id", ids.supRow);
      expect(!error, error?.message ?? "");
      expect((data ?? []).length > 0, "no journals for the assigned intern");
    },
  );

  // --- Attendance ---
  await check("supervisor: attendance scoped to own interns", async () => {
    const rows = orFail(
      await supC
        .from("attendance")
        .select("*, intern:interns(first_name, last_name, full_name)"),
      "attendance",
    );
    expect(
      rows.every(
        (r) =>
          r.intern?.supervisor_id === ids.supRow ||
          r.intern_id === ids.internRow,
      ),
      "attendance leaked for non-assigned intern",
    );
  });

  // --- Daily Journals ---
  await check("supervisor: journal review via RPC -> approved", async () => {
    const { data: journal } = await supC
      .from("daily_journals")
      .select("id")
      .eq("intern_id", ids.internRow)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(journal?.id, "no journal to review");
    const res = orFail(
      await supC.rpc("journal_review", {
        p_journal_id: journal?.id,
        p_status: "approved",
        p_comment: "verified",
      }),
      "journal_review",
    );
    const row = Array.isArray(res) ? res[0] : res;
    expect(row?.status === "approved", `status = ${row?.status}`);
  });

  // --- Evaluations ---
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

  await check(
    "supervisor: evaluationService.list scoped to own interns",
    async () => {
      const rows = orFail(
        await supC
          .from("evaluations")
          .select("*, intern:interns(full_name, last_name)"),
        "evaluations",
      );
      expect(
        rows.some((r) => r.intern_id === ids.internRow),
        "own evaluation missing",
      );
      expect(
        rows.every((r) => r.intern_id === ids.internRow),
        "evaluation leaked for non-assigned intern",
      );
    },
  );

  // --- Documents ---
  await check(
    "supervisor: documentService.list scoped to own interns",
    async () => {
      const rows = orFail(
        await supC
          .from("documents")
          .select("*, intern:interns(first_name, last_name, full_name)"),
        "documents",
      );
      expect(
        rows.every((r) => r.intern_id === ids.internRow),
        "document leaked for non-assigned intern",
      );
    },
  );

  // --- RLS boundaries ---
  await check(
    "supervisor: RLS cannot read another role's profile",
    async () => {
      const rows = orFail(
        await supC.from("profiles").select("id, role"),
        "profiles",
      );
      expect(
        !rows.some((r) => r.id === ids.users.admin),
        "admin profile leaked to supervisor",
      );
      expect(
        rows.some((r) => r.id === ids.profiles.intern),
        "assigned intern profile should be visible",
      );
    },
  );

  await check("supervisor: RLS blocks audit_logs (admin only)", async () => {
    const rows = orFail(
      await supC.from("audit_logs").select("id"),
      "audit_logs",
    );
    expect(
      rows.length === 0,
      `${rows.length} audit rows visible to a supervisor`,
    );
  });

  await check("supervisor: RLS blocks notifications of others", async () => {
    const rows = orFail(
      await supC.from("notifications").select("id, user_id"),
      "notifications",
    );
    expect(
      rows.every((r) => r.user_id === ids.profiles.supervisor),
      "saw someone else's notifications",
    );
  });

  // --- Profile ---
  await check("supervisor: RPC update_own_profile", async () => {
    orFail(
      await supC.rpc("update_own_profile", {
        p_full_name: "Test Supervisor Renamed",
        p_contact_number: "09000000002",
        p_bio: "verify supervisor",
        p_avatar_url: null,
      }),
      "update_own_profile",
    );
    const { data } = await supC
      .from("profiles")
      .select("full_name, bio")
      .eq("id", ids.users.supervisor)
      .single();
    expect(
      data?.full_name === "Test Supervisor Renamed",
      `full_name = ${data?.full_name}`,
    );
  });
}

// ---- INTERN ---------------------------------------------------------------
async function testIntern() {
  console.log(
    "\nINTERN  (sidebar: Dashboard, Attendance, Daily Journal, Documents, Evaluation, Announcements, Profile)",
  );

  // --- Dashboard ---
  await check(
    "intern: own row exposes generated full_name + supervisor embed",
    async () => {
      const rows = orFail(
        await intC
          .from("interns")
          .select(
            "id, full_name, student_number, start_date, end_date, required_hours, school, department:departments(name), institution:institutions(institution_name), supervisor:supervisors(full_name, email)",
          ),
        "interns",
      );
      expect(rows.length === 1, `expected only own row, got ${rows.length}`);
      expect(
        rows[0].full_name === "Test Intern",
        `full_name = "${rows[0].full_name}"`,
      );
      expect(
        rows[0].supervisor?.full_name === "Test Supervisor",
        `supervisor embed = ${JSON.stringify(rows[0].supervisor)}`,
      );
    },
  );

  await check("intern: RLS hides every other intern", async () => {
    const rows = orFail(await intC.from("interns").select("id"), "interns");
    const leaked = rows.filter((r) => r.id !== ids.internRow).length;
    expect(leaked === 0, `leaked ${leaked} foreign intern rows`);
  });

  // --- Attendance ---
  await check("intern: RPC attendance_clock_in", async () => {
    const res = orFail(
      await intC.rpc("attendance_clock_in", { p_method: "manual" }),
      "attendance_clock_in",
    );
    const row = Array.isArray(res) ? res[0] : res;
    expect(row?.intern_id === ids.internRow, `row bound to ${row?.intern_id}`);
    expect(
      ["present", "late"].includes(row?.status),
      `status = ${row?.status}`,
    );
    ids.attendance = row?.id;
  });

  await check("intern: RPC attendance_clock_out", async () => {
    const { data: open } = await intC
      .from("attendance")
      .select("id, time_in")
      .eq("intern_id", ids.internRow)
      .is("time_out", null)
      .order("time_in", { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(open?.time_in, "no open attendance record after clock-in");
    const out = new Date(
      new Date(open.time_in).getTime() + 60_000,
    ).toISOString();
    const res = orFail(
      await intC.rpc("attendance_clock_out", {
        p_time_out: out,
        p_remarks: "verification run",
      }),
      "attendance_clock_out",
    );
    const row = Array.isArray(res) ? res[0] : res;
    expect(row?.time_out, "time_out not set");
    expect(Number(row?.total_hours) >= 0, `total_hours = ${row?.total_hours}`);
  });

  // --- Daily Journal ---
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
    expect(row?.id, "no id");
    ids.journal = row?.id ?? null;
    orFail(
      await intC
        .from("daily_journals")
        .select(
          "*, intern:interns(full_name, last_name, profile_id, department:departments(id, name)), supervisor:supervisors(id, full_name, first_name, last_name)",
        ),
      "journal list",
    );
  });

  // --- Documents ---
  await check("intern: documentService.list scoped to own intern", async () => {
    const rows = orFail(
      await intC
        .from("documents")
        .select("*, intern:interns(full_name, last_name, profile_id)"),
      "documents",
    );
    expect(
      rows.every((r) => r.intern_id === ids.internRow),
      "document leaked for non-owned intern",
    );
  });

  // --- Evaluations ---
  await check(
    "intern: evaluationService.list scoped to own intern",
    async () => {
      const rows = orFail(
        await intC
          .from("evaluations")
          .select("*, intern:interns(full_name, last_name)"),
        "evaluations",
      );
      expect(
        rows.some((r) => r.intern_id === ids.internRow),
        "own evaluation missing",
      );
      expect(
        rows.every((r) => r.intern_id === ids.internRow),
        "evaluation leaked for non-owned intern",
      );
    },
  );

  // --- Announcements ---
  await check("intern: announcements readable (cross-role RLS)", async () => {
    const rows = orFail(
      await intC.from("announcements").select("*"),
      "announcements",
    );
    expect(
      rows.some((r) => r.id === ids.announcement),
      "admin announcement not visible to the intern",
    );
  });

  // --- Notifications ---
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
      await intC
        .from("notifications")
        .select("*")
        .eq("user_id", ids.profiles.intern)
        .eq("is_read", false),
      "notifications",
    );
    expect(rows.length > 0, "notification not visible to its owner");
    orFail(
      await intC
        .from("notifications")
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq("id", rows[0].id),
      "markRead",
    );
  });

  // --- RLS boundaries ---
  await check("intern: RLS blocks audit_logs (admin only)", async () => {
    const rows = orFail(
      await intC.from("audit_logs").select("id"),
      "audit_logs",
    );
    expect(rows.length === 0, `${rows.length} audit rows visible to an intern`);
  });

  await check("intern: RLS cannot read the admin profile", async () => {
    const rows = orFail(
      await intC.from("profiles").select("id, role"),
      "profiles",
    );
    expect(
      !rows.some((r) => r.id === ids.users.admin),
      "admin profile leaked to intern",
    );
    expect(
      rows.some((r) => r.id === ids.profiles.intern),
      "own profile missing",
    );
  });

  // --- Profile ---
  await check("intern: RPC update_own_profile", async () => {
    orFail(
      await intC.rpc("update_own_profile", {
        p_full_name: "Test Intern Renamed",
        p_contact_number: "09000000003",
        p_bio: "verify intern",
        p_avatar_url: null,
      }),
      "update_own_profile",
    );
    const { data } = await intC
      .from("profiles")
      .select("full_name, bio")
      .eq("id", ids.users.intern)
      .single();
    expect(
      data?.full_name === "Test Intern Renamed",
      `full_name = ${data?.full_name}`,
    );
    expect(data?.bio === "verify intern", `bio = ${data?.bio}`);
  });
}

// ---- cleanup --------------------------------------------------------------
async function cleanup() {
  console.log("\nCleaning up throwaway accounts...");
  const tempInterns = ids.internRow ? [ids.internRow] : [];
  const tempProfiles = Object.values(ids.profiles);
  const drops = [
    [
      "announcement",
      () =>
        ids.announcement
          ? svc.from("announcements").delete().eq("id", ids.announcement)
          : null,
    ],
    [
      "announcement_likes",
      () =>
        ids.announcement
          ? svc
              .from("announcement_likes")
              .delete()
              .eq("announcement_id", ids.announcement)
          : null,
    ],
    [
      "evaluations",
      () =>
        tempInterns.length
          ? svc.from("evaluations").delete().in("intern_id", tempInterns)
          : null,
    ],
    [
      "documents",
      () =>
        tempInterns.length
          ? svc.from("documents").delete().in("intern_id", tempInterns)
          : null,
    ],
    [
      "attendance",
      () =>
        tempInterns.length
          ? svc.from("attendance").delete().in("intern_id", tempInterns)
          : null,
    ],
    [
      "daily_journals",
      () =>
        tempInterns.length
          ? svc.from("daily_journals").delete().in("intern_id", tempInterns)
          : null,
    ],
    [
      "notifications",
      () =>
        tempProfiles.length
          ? svc.from("notifications").delete().in("user_id", tempProfiles)
          : null,
    ],
    [
      "audit_logs",
      () =>
        svc
          .from("audit_logs")
          .delete()
          .gte("created_at", startedAt)
          .or(
            [
              `resource_type.eq.__verify__`,
              tempProfiles.length
                ? `user_id.in.(${tempProfiles.join(",")})`
                : null,
              tempProfiles.length
                ? `resource_id.in.(${tempProfiles.join(",")})`
                : null,
              tempInterns.length
                ? `resource_id.in.(${tempInterns.join(",")})`
                : null,
            ]
              .filter(Boolean)
              .join(","),
          ),
    ],
    [
      "interns",
      () =>
        tempInterns.length
          ? svc.from("interns").delete().in("id", tempInterns)
          : null,
    ],
    [
      "supervisors",
      () =>
        tempProfiles.length
          ? svc.from("supervisors").delete().in("profile_id", tempProfiles)
          : null,
    ],
    [
      "profiles",
      () =>
        tempProfiles.length
          ? svc.from("profiles").delete().in("id", tempProfiles)
          : null,
    ],
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
      await svc.auth.admin.deleteUser(id, true);
    } catch (err) {
      console.log(`  WARN  cleanup auth user: ${err.message}`);
    }
  }
}

// ---- main -----------------------------------------------------------------
async function main() {
  console.log("============================================================");
  console.log("  IMS Sidebar Feature Test");
  console.log(`  Timestamp: ${new Date().toISOString()}`);
  console.log("============================================================");
  try {
    await setup();
    await testAdmin();
    await testSupervisor();
    await testIntern();
  } catch (err) {
    console.error("\nFATAL:", err.message);
    console.error(err.stack);
    process.exitCode = 1;
  } finally {
    await cleanup();
    console.log(
      "\n============================================================",
    );
    console.log(`  Results: ${passed} passed, ${failed} failed`);
    if (failures.length) {
      console.log("  Failures:");
      for (const f of failures) console.log(`    - ${f}`);
    }
    console.log("============================================================");
  }
}

main();
