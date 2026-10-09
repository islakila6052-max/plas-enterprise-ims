# User Management Workflow — Implementation Notes

**Feature:** HR Admin creates Supervisors · Supervisor creates Interns
**Status:** Implemented & pushed (`730292c` → `origin/main`)
**Build:** ✅ passes (`npm run build`)

---

## 1. Overview

Two role-gated workflows were added to the Internship Management System:

| Workflow | Actor | Page | Creates |
| --- | --- | --- | --- |
| HR Admin → Supervisor | `admin` / `hr_staff` | `/admin/supervisors` | Auth user + `profiles` (role=`supervisor`) + `supervisors` row |
| Supervisor → Intern | `supervisor` | `/supervisor/interns` | Auth user + `profiles` (role=`intern`) + `interns` row |

Both flows call a **backend API** (`/api/admin/create-user`) that uses the Supabase
**service-role** key to create auth users. The frontend never sees the service-role key.

---

## 2. Backend API Endpoint

**File:** `api/admin/create-user.js`

- `POST` only. Accepts `{ email, password, user_metadata: { full_name, role } }`.
- Uses `supabase.auth.admin.createUser({ email, password, email_confirm: true, user_metadata })`.
- Returns `{ success: true, user: { id, email } }` or `{ error }`.
- Validates: email+password required, password ≥ 8 chars.
- Maps duplicate-email Supabase errors → HTTP `409` with a friendly message.
- Reads `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from environment (server-only).

> **Local dev note:** Vite does not serve `/api/*`. The route runs on Vercel (serverless).
> For local testing you need a dev proxy/middleware or the deployed environment.

---

## 3. New / Modified Frontend Files

### New: `src/pages/admin/AdminSupervisors.jsx`
- Page header "Supervisor Management" + "+ Create Supervisor" button.
- Table: Name, Email, Department, Created, Actions (Edit / Delete).
- Empty state when no supervisors.
- **Create modal:** Full Name (req), Email (req, valid), Temporary Password (req, min 8), Department (req dropdown).
  - Flow: `fetch('/api/admin/create-user')` → update `profiles.role='supervisor'` → `supervisorService.create({ profile_id, department_id, full_name, email, created_by })`.
- **Edit modal:** same fields, password optional; updates supervisor + linked profile.
- **Delete:** confirm dialog → `supervisorService.remove(id)`.
- `created_by` = current admin's `user.id`.

### Modified: `src/pages/supervisor/SupervisorInterns.jsx`
- Added "+ Add Intern" button (PageHeader action).
- **Create modal:** Full Name, Email (valid), Temporary Password (min 8), Student Number, Contact Number, Emergency Contact, Institution (searchable), Program (searchable, requires institution), Start Date (req), End Date (optional), Required Hours.
  - Flow: `fetch('/api/admin/create-user', { role: 'intern' })` → resolve supervisor's `department_id` via `supervisorService.getById` → `internService.create({ profile_id, full_name, email, student_number, contact_number, emergency_contact, department_id, supervisor_id, institution_id, program_id, created_by, start_date, end_date, required_hours, status: 'active' })`.
  - Note: the legacy `school` / `course` columns were dropped (migration `0011_drop_intern_school_course.sql`); they are replaced by `institution_id` + `program_id`.
- **List view:** interns where `supervisor_id = current supervisor` **OR** `created_by = current supervisor`.
- Detail modal unchanged.

### Modified: `src/services/internService.js`
- `list()` now accepts `supervisorId` **and** `createdBy`. In Supabase mode uses `.or('supervisor_id.eq.X,created_by.eq.Y')`; in demo mode filters the mock array.

### Modified: `src/services/supervisorService.js`
- Added `getById(id)` (returns supervisor + department).
- `create`, `update`, `remove` already present; `update` also syncs `profiles.full_name/email`.

### Modified: `src/lib/mockBackend.js` (demo mode)
- Added `createSupervisor`, `updateSupervisor`, `removeSupervisor`.
- `createIntern` now defaults `status='active'` and accepts `created_by`.
- `listInterns` supports `createdBy` + `supervisorId` OR-logic.

### Modified: `src/App.jsx`
- Added route `/admin/supervisors` gated by `<RoleRoute roles={["admin","hr_staff"]}>`.

### Modified: `src/components/layout/navigation.js`
- Added "Supervisors" nav link (`/admin/supervisors`) for `admin` and `hr_staff`.

### Modified: `vercel.json`
- Added `/api/*` rewrite so the serverless function is reachable in production.

### Modified: `.env` / `.env.example`
- Added `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (server-only).
- `.env` has a `PASTE_YOUR_SERVICE_ROLE_KEY_HERE` placeholder — **must be filled with the real key.**

---

## 4. Database Schema (SQL to run)

Saved as **`supabase/migrations/0005_user_management.sql`**. Run in Supabase SQL Editor.

```sql
-- Track who created each record
ALTER TABLE public.supervisors ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.interns     ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_supervisors_created_by ON public.supervisors(created_by);
CREATE INDEX IF NOT EXISTS idx_interns_created_by     ON public.interns(created_by);

-- Supervisors readable by all authenticated users
DROP POLICY IF EXISTS "supervisors readable" ON public.supervisors;
CREATE POLICY "supervisors readable" ON public.supervisors FOR SELECT TO authenticated USING (true);

-- Admins manage supervisors
DROP POLICY IF EXISTS "admins manage supervisors" ON public.supervisors;
CREATE POLICY "admins manage supervisors" ON public.supervisors FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Supervisors manage interns assigned to them OR created by them
DROP POLICY IF EXISTS "supervisor reads assigned interns" ON public.interns;
CREATE POLICY "supervisor manages assigned interns" ON public.interns FOR ALL TO authenticated
  USING (supervisor_id = public.current_supervisor_id() OR created_by = public.current_supervisor_id())
  WITH CHECK (supervisor_id = public.current_supervisor_id() OR created_by = public.current_supervisor_id());

CREATE POLICY "supervisor creates interns" ON public.interns FOR INSERT TO authenticated
  WITH CHECK (public.current_supervisor_id() IS NOT NULL AND (supervisor_id = public.current_supervisor_id() OR created_by = public.current_supervisor_id()));
```

> **Prerequisite:** the helper functions `public.is_admin()` and `public.current_supervisor_id()`
> (and the `sync_profile_links` trigger) must already exist — see `DATABASE_SCHEMA.md` §15.

---

## 5. Environment Variables

| Var | Where | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | frontend | anon client |
| `VITE_SUPABASE_ANON_KEY` | frontend | anon client |
| `SUPABASE_URL` | **server only** | admin client |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** | admin client (creates auth users) |

⚠️ The service-role key bypasses RLS. Never expose it to the browser.

---

## 6. Testing Checklist

- [ ] Run `0005_user_management.sql` in Supabase.
- [ ] Paste real `SUPABASE_SERVICE_ROLE_KEY` into `.env`.
- [ ] HR Admin → `/admin/supervisors` → create supervisor → appears in list.
- [ ] Supervisor logs in → `/supervisor/interns` → "+ Add Intern" → appears in list.
- [ ] Verify DB: `supervisors.created_by` = admin id; `interns.created_by` & `interns.supervisor_id` = supervisor id.
- [ ] Security: intern/supervisor hitting `/admin/*` → redirected.

---

## 7. Known Limitations

1. **Local dev:** `/api/admin/create-user` is not served by Vite. Test on Vercel or add a dev proxy.
2. **Auth-user deletion:** deleting a supervisor/intern removes the DB row but **not** the Supabase auth user (would need the admin API in the backend route).
3. **`npm run lint`** is currently broken in this repo (ESLint v9 config missing) — unrelated to this feature; build is the validation used.
