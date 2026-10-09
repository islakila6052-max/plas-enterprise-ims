# IMS — Workflows, Data Flows & Complete Database Prompt

**Project:** Internship Management System (IMS) — "PLAS Enterprise"
**Stack:** React + Vite + Tailwind, Supabase (Postgres + Auth + Storage), Vercel serverless API.
**Purpose of this file:** (1) Document every feature workflow for HR Admin, Supervisor, and Intern.
(2) Serve as a **prompt** another AI can use to (re)generate the *complete, consistent* database
(schema, enums, RLS, functions, triggers, seed data).

---

# PART A — ROLES & ACCESS MODEL

| Role | Enum value | Can access | Created by |
| --- | --- | --- | --- |
| HR Administrator | `admin` | Everything under `/admin/*` | Supabase Auth (manual) or seed |
| HR Staff | `hr_staff` | Subset of `/admin/*` (Interns, Documents, Announcements) | Supabase Auth (manual) or seed |
| Supervisor | `supervisor` | `/supervisor/*` + can create interns | HR Admin (via UI) |
| Intern | `intern` | `/intern/*` | Supervisor (via UI) or HR Admin |

- Auth is **Supabase Auth**. Each auth user has a 1:1 `profiles` row carrying `role`.
- `profiles.intern_id` / `profiles.supervisor_id` are **cached links** maintained by a DB trigger
  (`sync_profile_links`) so the app can resolve "who am I" without joins.
- Two runtime modes:
  - **Supabase mode** (`.env` has `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`): real backend.
  - **Demo mode** (vars absent): in-memory mock backend seeded from `src/lib/sampleData.js`.

---

# PART B — FEATURE WORKFLOWS

## B1. HR Admin workflows (`/admin/*`)

### B1.1 Dashboard (`/admin`)
- Stat cards: Total Interns, Active Interns, Completed Internships, Pending Evaluations, Attendance Today.
- Charts: Intern status donut, Attendance today bar.
- Quick actions → Interns, Attendance, Reports, Settings.

### B1.2 Manage Interns (`/admin/interns`) — `InternManagement.jsx`
- List/search/filter interns (name/student no/institution, department, status).
- **+ Add Intern** modal: full_name, student_number, contact, email, emergency contact,
  institution (searchable), program (searchable, filtered by institution), department, supervisor,
  start/end date, required_hours, status.
- Edit / Archive / Restore / Delete (confirm dialog).
- Detail modal with all fields.
- Data: `interns` (+ joins `departments`, `supervisors.profiles`, `institutions`, `programs`).

### B1.3 Manage Supervisors (`/admin/supervisors`) — `AdminSupervisors.jsx`  ← NEW
- List all supervisors (Name, Email, Department, Created, Actions).
- **+ Create Supervisor** → calls backend `/api/admin/create-user` (service-role) → sets
  `profiles.role='supervisor'` → inserts `supervisors` row with `created_by = admin.id`.
- Edit (name/email/department; syncs `profiles`), Delete (confirm).

### B1.4 Attendance (`/admin/attendance`) — `AdminAttendance.jsx`
- Org-wide attendance list, filter by date + status, **Export CSV**.
- Data: `attendance` joined to `interns`.

### B1.5 Journals (`/admin/journals`)
- All daily journals, review/approve/reject with supervisor comment.

### B1.6 Documents (`/admin/documents`)
- All intern documents, review (approve/reject), preview.

### B1.7 Evaluations (`/admin/evaluations`)
- All evaluations overview.

### B1.8 Announcements (`/admin/announcements`)
- CRUD announcements (pinned, category). `published_by = admin profile id`.

### B1.9 Reports (`/admin/reports`)
- Client-side aggregation → XLSX / PDF export.

### B1.10 Settings (`/admin/settings`)
- Singleton `settings` row (company_name, internship_duration, required_hours).

## B2. Supervisor workflows (`/supervisor/*`)

### B2.1 Dashboard (`/supervisor`)
- Cards: Assigned Interns, Attendance Today, Pending Journals, Pending Evaluations.

### B2.2 Assigned Interns (`/supervisor/interns`) — `SupervisorInterns.jsx`  ← ENHANCED
- List interns where `supervisor_id = my supervisor id` **OR** `created_by = my id`.
- **+ Add Intern** modal collects: full_name, email, password, student_number, contact_number,
  emergency_contact, institution (searchable), program (searchable, filtered by institution),
  start/end date, required_hours.
- On submit → `/api/admin/create-user` (role `intern`) → resolve my `department_id` →
  insert `interns` row with `supervisor_id = me`, `created_by = me`, `status='active'`,
  plus the contact/emergency/institution/program/required_hours fields.
- List + detail show Institution, Program, Department, Required Hrs so the supervisor can verify
  the data (which the admin also sees in `InternManagement`).

### B2.3 Attendance (`/supervisor/attendance`)
- Attendance for assigned interns only.

### B2.4 Journals (`/supervisor/journals`)
- Review journals of assigned interns (approve/reject + comment).

### B2.5 Evaluations (`/supervisor/evaluations`)
- Create/update evaluations for assigned interns (6 criteria 0–5, recommendation).

## B3. Intern workflows (`/intern/*`)

### B3.1 Dashboard (`/intern`)
- Hours Rendered / Required / Remaining (progress bar), Today's Attendance, Latest Announcements.

### B3.2 Attendance (`/intern/attendance`)
- Time In / Time Out (one open record per day; partial unique index enforces this).

### B3.3 Journal (`/intern/journal`)
- Submit daily journal (activities, hours, challenges, learnings).

### B3.4 Documents (`/intern/documents`)
- Upload documents to `intern-documents` storage bucket (folder = intern id).

### B3.5 Evaluation (`/intern/evaluation`)
- View own evaluation.

### B3.6 Announcements (`/intern/announcements`)
- Read company announcements.

---

# PART C — END-TO-END CREATE FLOWS (sequence)

### C1. HR Admin creates a Supervisor
```
Admin form (name, email, password≥8, department)
  → POST /api/admin/create-user  (service-role: supabase.auth.admin.createUser)
      returns { user: { id, email } }
  → UPDATE profiles SET role='supervisor', full_name=... WHERE id = newUserId
  → INSERT supervisors (profile_id, department_id, full_name, email, created_by = adminId)
  → list refreshes
```
RLS: `admins manage supervisors` (is_admin()).

### C2. Supervisor creates an Intern
```
Supervisor form (name, email, password≥8, student_no, contact_number, emergency_contact,
                institution, program, start, end?, required_hours)
  → POST /api/admin/create-user (role='intern')  → { user: { id, email } }
  → SELECT supervisors WHERE id = mySupervisorId  (get department_id)
  → INSERT interns (profile_id, full_name, email, student_number, contact_number, emergency_contact,
                    institution_id, program_id, department_id, supervisor_id = me, created_by = me,
                    start_date, end_date, required_hours, status='active')
  → list refreshes (admin sees Department, Supervisor, Required Hrs, Institution, Program)
```
RLS: `supervisor creates interns` + `supervisor manages assigned interns`.

### C3. Intern daily loop
```
Login → Time In (attendance insert, time_out=null)
       → Submit Journal (daily_journals insert, status='pending')
       → Upload Document (storage + documents insert, status='pending')
Supervisor → reviews journal/document/evaluation
```

---

# PART D — DATABASE SCHEMA (authoritative for regeneration)

> The following is the **complete target schema**. Use it as the prompt input to generate the
> full SQL migration. It reflects the app's actual queries (see `src/services/*`).

## D1. Enums
```sql
user_role       AS ENUM ('admin','hr_staff','supervisor','intern')
intern_status   AS ENUM ('active','completed','archived')
attendance_status AS ENUM ('present','late','absent','pending')
journal_status  AS ENUM ('pending','approved','rejected')
document_status AS ENUM ('pending','approved','rejected')
evaluation_status AS ENUM ('pending','completed','archived')
```

## D2. Tables & columns
```
profiles (
  id uuid PK references auth.users(id) on delete cascade,
  full_name text not null default '',
  email text,
  avatar_url text,
  contact_number text,
  bio text,
  role user_role not null default 'intern',
  intern_id uuid references interns(id) on delete set null,   -- cached link
  supervisor_id uuid references supervisors(id) on delete set null, -- cached link
  created_at timestamptz default now(),
  updated_at timestamptz default now()
)

departments (
  id uuid PK default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz default now()
)

supervisors (
  id uuid PK default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete cascade,
  department_id uuid references departments(id) on delete set null,
  full_name text,
  email text,
  created_by uuid references profiles(id) on delete set null,   -- who created this supervisor
  created_at timestamptz default now()
)

interns (
  id uuid PK default gen_random_uuid(),
  profile_id uuid references profiles(id) on delete cascade,
  full_name text not null,
  student_number text,
  contact_number text,
  email text,
  emergency_contact text,
  institution_id uuid references institutions(institution_id) on delete set null,
  program_id uuid references programs(program_id) on delete set null,
  department_id uuid references departments(id) on delete set null,
  supervisor_id uuid references supervisors(id) on delete set null,
  start_date date,
  end_date date,
  required_hours numeric not null default 300 check (required_hours >= 0),
  status intern_status not null default 'active',
  created_by uuid references profiles(id) on delete set null,   -- who created this intern
  created_at timestamptz default now(),
  updated_at timestamptz default now()
)

attendance (
  id uuid PK default gen_random_uuid(),
  intern_id uuid not null references interns(id) on delete cascade,
  date date not null default current_date,
  time_in timestamptz,
  time_out timestamptz,
  total_hours numeric not null default 0 check (total_hours >= 0),
  method text default 'manual',
  status attendance_status not null default 'present',
  created_at timestamptz default now(),
  UNIQUE (intern_id, date) WHERE (time_out IS NULL)   -- one open record per day
)

daily_journals (
  id uuid PK default gen_random_uuid(),
  intern_id uuid not null references interns(id) on delete cascade,
  supervisor_id uuid references supervisors(id) on delete set null,
  date date not null default current_date,
  activities text not null,
  hours_worked numeric not null default 0 check (hours_worked >= 0),
  challenges text,
  learnings text,
  status journal_status not null default 'pending',
  supervisor_comment text,
  created_at timestamptz default now()
)

documents (
  id uuid PK default gen_random_uuid(),
  intern_id uuid not null references interns(id) on delete cascade,
  type text not null check (type in ('resume','moa','endorsement','school_requirements','completion_report')),
  label text,
  file_path text,
  file_url text,
  file_name text,
  status document_status not null default 'pending',
  created_at timestamptz default now()
)

evaluations (
  id uuid PK default gen_random_uuid(),
  intern_id uuid not null references interns(id) on delete cascade,
  supervisor_id uuid references supervisors(id) on delete set null,
  attendance integer not null default 0 check (attendance between 0 and 5),
  communication integer not null default 0 check (communication between 0 and 5),
  teamwork integer not null default 0 check (teamwork between 0 and 5),
  initiative integer not null default 0 check (initiative between 0 and 5),
  technical_skills integer not null default 0 check (technical_skills between 0 and 5),
  professionalism integer not null default 0 check (professionalism between 0 and 5),
  overall_rating integer not null default 0 check (overall_rating between 0 and 5),
  comments text,
  final_recommendation text check (final_recommendation is null or final_recommendation
     in ('highly_recommend','recommend','neutral','do_not_recommend')),
  status evaluation_status not null default 'pending',
  created_at timestamptz default now()
)

announcements (
  id uuid PK default gen_random_uuid(),
  title text not null,
  body text not null,
  category text not null default 'company_news'
     check (category in ('company_news','schedule','deadline','reminder')),
  published_by uuid references profiles(id) on delete set null,
  pinned boolean not null default false,
  created_at timestamptz default now()
)

settings (
  id integer PK default 1,                 -- singleton
  company_name text,
  internship_duration text,
  required_hours numeric not null default 300 check (required_hours >= 0),
  updated_at timestamptz default now()
)
```

## D3. Functions (SECURITY DEFINER, search_path = public)
```sql
current_role()        → user_role   -- role of auth.uid()
is_admin()            → boolean     -- role in ('admin','hr_staff')
current_supervisor_id() → uuid      -- supervisor row for auth.uid()
current_intern_id()     → uuid      -- intern row for auth.uid()
handle_new_user()      → trigger on auth.users insert → insert profiles (role from metadata, default 'intern')
sync_profile_links()   → trigger keeping profiles.intern_id / profiles.supervisor_id in sync
```

## D4. Triggers
```
on_auth_user_created      (auth.users AFTER INSERT) → handle_new_user
sync_profile_intern       (interns AFTER INSERT/UPDATE/DELETE) → sync_profile_links
sync_profile_supervisor   (supervisors AFTER INSERT/UPDATE/DELETE) → sync_profile_links
set_profiles_updated      (profiles BEFORE UPDATE) → moddatetime(updated_at)
set_interns_updated       (interns BEFORE UPDATE) → moddatetime(updated_at)
set_settings_updated      (settings BEFORE UPDATE) → moddatetime(updated_at)
```

## D5. Row Level Security (summary)
- Enable RLS on all 10 tables.
- **profiles:** readable by authenticated; users update own; admins all.
- **departments / supervisors:** readable by authenticated; admins manage.
- **interns:** readable by authenticated; admins all; intern reads own; supervisor reads/manages
  assigned **OR** `created_by = current_supervisor_id()`.
- **attendance:** readable by authenticated; admins all; intern manages own; supervisor reads assigned.
- **daily_journals:** readable by authenticated; admins all; intern manages own; supervisor reviews assigned.
- **documents:** readable by authenticated; admins all; intern manages own.
- **evaluations:** readable by authenticated; admins all; supervisor manages assigned; intern reads own.
- **announcements / settings:** readable by authenticated; admins manage.

## D6. Storage
- Bucket `intern-documents` (public). Folder layout: `<intern_id>/<file>`.
- Policies: readable by authenticated; intern uploads to own folder; admins manage.

## D7. Indexes
```
interns(department_id), interns(supervisor_id), interns(status)
attendance(intern_id), attendance(date)
daily_journals(intern_id), daily_journals(status), daily_journals(supervisor_id)
documents(intern_id)
evaluations(intern_id), evaluations(supervisor_id), evaluations(status)
announcements(pinned)
supervisors(created_by), interns(created_by)
```

---

# PART E — PROMPT YOU CAN SEND TO ANOTHER AI

> **Copy everything below this line to the other AI.**

```
Build the complete PostgreSQL + Supabase schema for an Internship Management System (IMS)
called "PLAS Enterprise". Produce a single runnable SQL migration (Postgres 15+, Supabase).

Requirements:
1. Enums: user_role('admin','hr_staff','supervisor','intern'),
   intern_status('active','completed','archived'),
   attendance_status('present','late','absent','pending'),
   journal_status('pending','approved','rejected'),
   document_status('pending','approved','rejected'),
   evaluation_status('pending','completed','archived').

2. Tables (with exact columns, FKs, defaults, and checks from PART D2 above):
   profiles, departments, supervisors, interns, attendance, daily_journals,
   documents, evaluations, announcements, settings.
   - profiles has cached links intern_id -> interns(id) and supervisor_id -> supervisors(id)
     (ON DELETE SET NULL).
   - supervisors.created_by and interns.created_by reference profiles(id) (ON DELETE SET NULL)
     to track which admin/supervisor created the record.
   - attendance has a partial UNIQUE (intern_id, date) WHERE time_out IS NULL.
   - documents.type and announcements.category and evaluations.final_recommendation use
     the CHECK constraints listed.

3. Functions (SECURITY DEFINER, set search_path = public):
   current_role(), is_admin(), current_supervisor_id(), current_intern_id(),
   handle_new_user() (inserts profiles on auth.users insert, role from raw_user_meta_data
   default 'intern'), sync_profile_links() (keeps profiles.intern_id/supervisor_id synced
   from interns/supervisors).

4. Triggers: on_auth_user_created, sync_profile_intern, sync_profile_supervisor,
   set_profiles_updated, set_interns_updated, set_settings_updated (moddatetime).

5. Enable RLS on all tables. Implement policies exactly per PART D5:
   - admins (is_admin()) manage departments/supervisors/interns/attendance/journals/documents/
     evaluations/announcements/settings.
   - interns: user manages own row (intern_id = current_intern_id()).
   - supervisors: can SELECT/ALL interns where supervisor_id = current_supervisor_id()
     OR created_by = current_supervisor_id().
   - all authenticated users can SELECT profiles, departments, supervisors, attendance,
     daily_journals, documents, evaluations, announcements (scoped as above).

6. Storage bucket 'intern-documents' (public) with policies: authenticated read;
   intern insert to folder = current_intern_id(); admins manage.

7. Indexes per PART D7.

8. Seed (optional, for demo): one admin profile (role 'admin', email hr@company.com),
   one supervisor (role 'supervisor'), one intern (role 'intern'); a few departments,
   interns, attendance rows (one open today), journals, documents, evaluations, announcements,
   and a settings singleton (company_name 'PLAS Enterprise', required_hours 300).

Return the full SQL, ordered: extensions → enums → tables → indexes → functions → triggers
→ RLS → storage → (optional seed). Make it idempotent (use IF NOT EXISTS / CREATE OR REPLACE /
DROP POLICY IF EXISTS).
```

---

# PART F — KNOWN GAPS / TODO (from DATABASE_SCHEMA.md)
- The helper functions + `sync_profile_links` trigger + `moddatetime` triggers are **required**
  but were missing from the originally pasted schema. Ensure they exist (PART D3/D4).
- `created_by` columns + their RLS policies are in `supabase/migrations/0005_user_management.sql`.
- Service-role key (`SUPABASE_SERVICE_ROLE_KEY`) must be set server-side for `/api/admin/create-user`.
- Local `npm run dev` does NOT serve `/api/*` (Vercel-only); test create flows on deploy or add a proxy.
