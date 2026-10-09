# Recent Changes — Since 2026-07-17

> Auto-generated summary of commits from **2026-07-17** through **2026-07-18**.
> Purpose: give other agents a quick, accurate map of what changed recently so they
> can reason about the current state of the codebase without re-reading every commit.

## Summary

- **20 commits** since yesterday (2026-07-17 → 2026-07-18).
- Primary authors: `mikshts` (17), `IMS Agent` (2), plus minor/noise commits.
- Major themes: **Institutions module (new feature)**, **RBAC hardening + schema migrations**,
  **user-creation API fixes**, **attendance enforcement**, **notifications + audit logs UI**,
  **icon system unification**, and **layout/UX polish**.

## Themes

### 1. Institutions module (new admin feature)
- New admin page `src/pages/admin/AdminInstitutions.jsx` managing Institutions + Programs.
- New components: `InstitutionTable`, `InstitutionModal`, `ProgramTable`, `ProgramModal`, `DatabaseConnectionCard` (under `src/components/institutions/`).
- New services: `src/services/institutionService.js`, `src/services/programService.js`.
- New migration `supabase/migrations/0009_institutions_programs.sql`; `0008_profile_fk_repoint.sql` extended.
- Wired into `App.jsx`, `navigation.js`, and the new icon set.

### 2. RBAC hardening & database schema
- Added `supabase/migrations/0007_complete_schema_rbac.sql` — single pasteable from-scratch schema + RBAC.
- Added `supabase/migrations/0006_rbac_hardening.sql` — role isolation in RLS, audit + notifications wiring.
- Added `supabase/migrations/0008_profile_fk_repoint.sql` — repoint profile FK.
- `scripts/rbac_sanity.mjs` added to validate RBAC assumptions.
- `src/services/userService.js` and `src/services/activityService.js` introduced.
- Auth, intern, and several admin/supervisor pages updated to respect role isolation.

### 2. User-creation API fixes (serverless)
- Moved `src/api/admin/create-user.js` → `api/admin/create-user.js` (deploy path fix).
- Fixed env vars: read `SUPABASE_*` instead of `VITE_*`; fail clearly on missing config.
- Authorized requests and prevented evaluation double-create.
- Fixed intern creation for admin + supervisor and a profile-load 406.

### 3. Attendance
- Enforced one attendance per day; added "Time In" confirmation modal (`InternAttendance.jsx`).
- Sorted attendance history newest-first with `time_in` tiebreaker.
- `src/services/attendanceService.js` and `src/lib/mockBackend.js` updated accordingly.

### 4. Notifications & audit logs (frontend)
- Added `NotificationBell` layout component and `notificationService`, `auditLogService`.
- New `AdminAuditLogs.jsx` page; `DATABASE_SCHEMA.md` reconciled with new tables.
- `App.jsx` / `Navbar` / `navigation.js` wired for notifications.

### 5. Icon system unification
- New `src/components/ui/icons.jsx` — single professional stroke-based icon set.
- Replaced scattered icons across Navbar, Sidebar, Modal, StatCard, EmptyState, and most pages.

### 7. Layout & UX polish
- Sidebar fixed on desktop while page content scrolls.
- Cleaned up debug logging; hardened supervisor/department services.
- Switched lint to **oxlint**; fixed duplicate `ADMIN_ROLES` build error.

## Commit-by-commit (newest first)

| Date | Author | Subject | Key files |
|------|--------|---------|-----------|
| 2026-07-18 | mikshts | Add Institutions module to admin panel | `AdminInstitutions.jsx` (new), `institutions/*` components, `institutionService.js`, `programService.js`, `0009_institutions_programs.sql`, `App.jsx`, `navigation.js`, `icons.jsx` |
| 2026-07-18 | mikshts | Fix intern creation for admin + supervisor and profile load 406 | `api/admin/create-user.js`, `InternManagement.jsx`, `SupervisorInterns.jsx`, `profileService.js`, `supervisorService.js` |
| 2026-07-18 | mikshts | Unify app icons into one professional stroke-based icon set | `icons.jsx` (new), Navbar, Sidebar, navigation, Modal, StatCard, EmptyState, dashboards, document pages |
| 2026-07-18 | mikshts | adfadf | `.env.example` |
| 2026-07-18 | mikshts | Fix serverless create-user env vars: read SUPABASE_* (not VITE_*) and fail clearly | `.env.example`, `api/admin/create-user.js` |
| 2026-07-18 | mikshts | Fix user-creation API deploy path, authorize request, and evaluation double-create | `api/admin/create-user.js` (renamed), `SupervisorEvaluations.jsx`, `userService.js`, `0008_profile_fk_repoint.sql` |
| 2026-07-18 | IMS Agent | Add 0007_complete_schema_rbac.sql — single pasteable from-scratch schema + RBAC | `0007_complete_schema_rbac.sql` (new) |
| 2026-07-18 | IMS Agent | Harden RBAC: authorize user-creation API, enforce role isolation in RLS, wire audit + notifications | `package.json`, `rbac_sanity.mjs`, `create-user.js`, `mockBackend.js`, admin/supervisor/intern pages, `activityService.js`, `userService.js`, `0006_rbac_hardening.sql` |
| 2026-07-18 | mikshts | Keep sidebar fixed on desktop while page content scrolls | `Sidebar.jsx` |
| 2026-07-18 | mikshts | Sort attendance history newest-first with time_in tiebreaker | `mockBackend.js`, `attendanceService.js` |
| 2026-07-18 | mikshts | Enforce one attendance per day; add Time In confirmation modal | `mockBackend.js`, `InternAttendance.jsx`, `attendanceService.js` |
| 2026-07-18 | mikshts | Clean up debug logging; harden supervisor/department services | `AdminSupervisors.jsx`, `departmentService.js`, `supervisorService.js` |
| 2026-07-17 | mikshts | Add notifications + audit_logs to frontend; write reconciled DATABASE_SCHEMA.md | `DATABASE_SCHEMA.md`, `App.jsx`, `Navbar.jsx`, `NotificationBell.jsx` (new), `navigation.js`, `mockBackend.js`, `sampleData.js`, `AdminAuditLogs.jsx` (new), `auditLogService.js`, `notificationService.js` |
| 2026-07-17 | mikshts | Fix duplicate ADMIN_ROLES build error; switch lint to oxlint | `package-lock.json`, `package.json`, `constants.js` |
| 2026-07-17 | mikshts | asdf | `create-user.js`, `constants.js`, `supervisorService.js` |
| 2026-07-17 | mikshts | Final cleanup: fix demo-mode getById crash, add workflows doc | `IMS_WORKFLOWS_AND_DATABASE_PROMPT.md` (new), `mockBackend.js`, `supervisorService.js` |

## Notes for agents
- Two low-value commits (`adfadf`, `asdf`) are env/constant tweaks — safe to ignore for logic review.
- The serverless API now lives at `api/admin/create-user.js` (not under `src/`).
- RBAC is enforced both in Supabase migrations (`supabase/migrations/0006`, `0007`) and in app services.
- Run `node scripts/rbac_sanity.mjs` to validate RBAC state.
- `0008_profile_fk_repoint.sql` was edited twice today (repoint FK, then Institutions tweak) — confirm final state before deploying.
- New `0009_institutions_programs.sql` migration should be applied alongside `0008`.

## 2026-07-20 — Supervisor Add Intern: full data capture

- **Goal:** Supervisors can now fill in the same intern fields the admin can, so the
admin view shows complete data (Department, Supervisor, Required Hrs, Institution, Program,
Contact, Emergency contact) for supervisor-created interns.
- **Changed:** `src/pages/supervisor/SupervisorInterns.jsx`
- Add Intern form now collects: `contact_number`, `emergency_contact`, `institution_id`
  (searchable `SearchableSelect` + `institutionService`), `program_id` (searchable, filtered
  by institution, + `programService`), and `required_hours`.
- `onSubmit` now writes those fields into `internService.create(...)`.
- Supervisor intern table gained Program + Required Hrs columns; detail modal now
  shows Emergency, Institution, Program, Required Hrs.
- **Docs reconciled to current code:**
- `DATABASE_SCHEMA.md` — `interns` table (section 6.4 + Appendix A) now lists `institution_id` /
  `program_id` instead of the dropped `school` / `course` columns.
- `IMS_WORKFLOWS_AND_DATABASE_PROMPT.md` — Part B1.2, B2.2, C2 and Part D `interns` table
  updated to institution/program + contact/emergency/required_hours.
- `README.md` — Intern Profile lists Institution/Program instead of School/Course.
- **Note:** `supabase_schema.sql` is a legacy reference file (its own header says not to
maintain it separately); the authoritative schema is `DATABASE_SCHEMA.sql` + the migrations.
Migration `0011_drop_intern_school_course.sql` already removed `school`/`course` from the DB.