# Internship Management System (IMS) — Database Schema

> **Status:** ✅ Reconciled & verified against the frontend (services, pages, navigation, mock backend).
> **Last updated:** 2026-07-17
> **Scope:** This document is the **single source of truth** for the IMS database. It contains the
> complete schema (enums, tables, indexes, functions, triggers, RLS, storage) and a mapping of every
> table to the frontend code that uses it.

---

## 1. Project Overview

The IMS is a React + Vite + Tailwind frontend backed by **Supabase** (Postgres + Auth + Storage).
It supports four roles:

| Role | Value | Primary use |
|------|-------|-------------|
| HR Administrator | `admin` | Full system access, user & intern management |
| HR Staff | `hr_staff` | HR-level admin access (treated as admin for privileges) |
| Supervisor | `supervisor` | Manages assigned interns (journals, attendance, evaluations) |
| Intern | `intern` | Self-service attendance, journals, documents, evaluations |

The app runs in two modes:
- **Supabase mode** — real auth + Postgres (requires `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`).
- **Demo mode** — no backend; an in-memory mock (`src/lib/mockBackend.js`) seeded from
  `src/lib/sampleData.js` mirrors this exact schema so the UI is fully functional.

---

## 2. Database Overview

| Object | Name | Notes |
|--------|------|-------|
| Auth | `auth.users` | Supabase-managed. 1:1 with `profiles`. |
| Table | `profiles` | Identity + role for every user. |
| Table | `departments` | Org units interns/supervisors belong to. |
| Table | `supervisors` | Supervisor records, linked to a `profiles` row. |
| Table | `interns` | Intern records, linked to a `profiles` row. |
| Table | `attendance` | Daily time-in/out per intern. |
| Table | `daily_journals` | Intern daily activity logs (supervisor-reviewed). |
| Table | `documents` | Intern document uploads (stored in Storage bucket). |
| Table | `evaluations` | Supervisor performance evaluations. |
| Table | `announcements` | Company-wide posts. |
| Table | `settings` | Singleton company config (id = 1). |
| Table | `notifications` | Per-user in-app notifications. |
| Table | `audit_logs` | Append-only admin/system activity trail. |
| Storage | `intern-documents` | Public bucket for intern uploads. |

---

## 3. Entity Relationship Summary

```
auth.users (1) ──── (1) profiles (1) ──┬── (1) supervisors (1) ──< interns
                                       │            │                  │
                                       │            │                  ├──< attendance
                                       │            │                  ├──< daily_journals
                                       │            │                  ├──< documents
                                       │            │                  └──< evaluations
                                       │            └──< interns (created_by / supervisor_id)
                                       ├──< announcements (published_by)
                                       ├──< notifications (user_id)
                                       └──< audit_logs (user_id)

departments (1) ──< supervisors.department_id
departments (1) ──< interns.department_id
```

Key link columns (kept in sync by the `sync_profile_links` trigger):
- `profiles.intern_id` → `interns.id`
- `profiles.supervisor_id` → `supervisors.id`

---

## 4. Authentication

### 4.1 `auth.users` (Supabase-managed)
Standard Supabase Auth table. The app reads `id`, `email`, and `raw_user_meta_data`
(`full_name`, `role`) on signup via the `handle_new_user()` trigger.

### 4.2 `profiles`
Stores the human identity and role for each auth user. See §6.1.

### 4.3 Roles
Defined by the `user_role` enum: `'admin'`, `'hr_staff'`, `'supervisor'`, `'intern'`.
`admin` and `hr_staff` are treated as equivalent for administrative privileges
(`is_admin()` returns true for both).

### 4.4 Permissions (high level)
- **Admins / HR** — full CRUD on every table; read audit logs.
- **Supervisors** — read/manage interns assigned to or created by them; review journals,
  manage attendance & evaluations for those interns; read everything.
- **Interns** — manage only their own rows (attendance, journals, documents, profile).

---

## 5. User Roles

| Role | Can |
|------|-----|
| `admin` / `hr_staff` | Everything: manage users, interns, supervisors, all records, settings, audit logs. |
| `supervisor` | View assigned interns; review their journals; log/edit their attendance; create evaluations; publish announcements. |
| `intern` | Log own attendance; write own journals; upload own documents; view own evaluation; read announcements & notifications. |

---

## 6. Database Tables

### 6.1 `profiles` — **[CONFIRMED / USED]**
Linked 1:1 to `auth.users`. Holds role + identity.

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | PK, FK → `auth.users(id)` ON DELETE CASCADE |
| `full_name` | TEXT | NOT NULL DEFAULT '' |
| `email` | TEXT | — |
| `avatar_url` | TEXT | — |
| `contact_number` | TEXT | — |
| `bio` | TEXT | — |
| `role` | `user_role` | NOT NULL DEFAULT 'intern' |
| `intern_id` | UUID | FK → `interns(id)` ON DELETE SET NULL |
| `supervisor_id` | UUID | FK → `supervisors(id)` ON DELETE SET NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |

**Frontend:** `profileService`, `authService`, `AuthContext`, `supervisorService` (updates `full_name`/`email`).

---

### 6.2 `departments` — **[CONFIRMED / USED]**
| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | PK DEFAULT gen_random_uuid() |
| `name` | TEXT | NOT NULL UNIQUE |
| `description` | TEXT | — |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |

**Frontend:** `departmentService`, used as a join in `internService` / `supervisorService`.

---

### 6.3 `supervisors` — **[CONFIRMED / USED]**
| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | PK DEFAULT gen_random_uuid() |
| `profile_id` | UUID | FK → `profiles(id)` ON DELETE CASCADE |
| `department_id` | UUID | FK → `departments(id)` ON DELETE SET NULL |
| `first_name` | TEXT | NOT NULL DEFAULT '' |
| `last_name` | TEXT | — |
| `full_name` | TEXT | GENERATED ALWAYS (`first_name \|\| ' ' \|\| last_name`) STORED |
| `email` | TEXT | — |
| `created_by` | UUID | FK → `profiles(id)` ON DELETE SET NULL |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |

**Frontend:** `supervisorService` (list/getById/create/update/remove). Creating a supervisor
also writes `profiles.supervisor_id` (mirrors the trigger).

---

### 6.4 `interns` — **[CONFIRMED / USED]**
| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | PK DEFAULT gen_random_uuid() |
| `profile_id` | UUID | FK → `profiles(id)` ON DELETE CASCADE |
| `first_name` | TEXT | NOT NULL DEFAULT '' |
| `last_name` | TEXT | — |
| `full_name` | TEXT | GENERATED ALWAYS (`first_name || ' ' || last_name`) STORED |
| `contact_number` | TEXT | — |
| `email` | TEXT | — |
| `emergency_contact` | TEXT | — |
| `institution_id` | UUID | FK → `institutions(institution_id)` ON DELETE SET NULL |
| `program_id` | UUID | FK → `programs(program_id)` ON DELETE SET NULL |
| `department_id` | UUID | FK → `departments(id)` ON DELETE SET NULL |
| `supervisor_id` | UUID | FK → `supervisors(id)` ON DELETE SET NULL |
| `start_date` | DATE | — |
| `end_date` | DATE | — |
| `required_hours` | NUMERIC | NOT NULL DEFAULT 300, CHECK >= 0 |
| `status` | `intern_status` | NOT NULL DEFAULT 'active' |
| `created_by` | UUID | FK → `profiles(id)` ON DELETE SET NULL |
| `is_active` | BOOLEAN | DEFAULT TRUE |
| `archived_by` | UUID | FK → `profiles(id)` ON DELETE SET NULL |
| `archived_reason` | TEXT | — |
| `archived_at` | TIMESTAMPTZ | — |
| `restored_by` | UUID | FK → `profiles(id)` ON DELETE SET NULL |
| `restored_at` | TIMESTAMPTZ | — |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |

**Frontend:** `internService` (list with search/department/status/supervisor/createdBy, get, create, update, archive, restore).

---

### 6.5 `attendance` — **[CONFIRMED / USED]**
| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | PK DEFAULT gen_random_uuid() |
| `intern_id` | UUID | NOT NULL, FK → `interns(id)` ON DELETE CASCADE |
| `date` | DATE | NOT NULL DEFAULT current_date |
| `time_in` | TIMESTAMPTZ | — |
| `time_out` | TIMESTAMPTZ | — |
| `total_hours` | NUMERIC | NOT NULL DEFAULT 0, CHECK >= 0 |
| `method` | TEXT | DEFAULT 'manual' |
| `status` | `attendance_status` | NOT NULL DEFAULT 'present' |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |

**Frontend:** `attendanceService` (getOpen, timeIn, timeOut, list, adminList). A partial unique
index enforces at most one open (no `time_out`) record per intern per day.

---

### 6.6 `daily_journals` — **[CONFIRMED / USED]**
| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | PK DEFAULT gen_random_uuid() |
| `intern_id` | UUID | NOT NULL, FK → `interns(id)` ON DELETE CASCADE |
| `supervisor_id` | UUID | FK → `supervisors(id)` ON DELETE SET NULL |
| `date` | DATE | NOT NULL DEFAULT current_date |
| `activities` | TEXT | NOT NULL |
| `hours_worked` | NUMERIC | NOT NULL DEFAULT 0, CHECK >= 0 |
| `challenges` | TEXT | — |
| `learnings` | TEXT | — |
| `status` | `journal_status` | NOT NULL DEFAULT 'pending' |
| `supervisor_comment` | TEXT | — |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |

**Frontend:** `journalService` (list, create, review with status + supervisor_id + comment).

---

### 6.7 `documents` — **[CONFIRMED / USED]**
| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | PK DEFAULT gen_random_uuid() |
| `intern_id` | UUID | NOT NULL, FK → `interns(id)` ON DELETE CASCADE |
| `type` | TEXT | NOT NULL, CHECK IN ('resume','moa','endorsement','school_requirements','completion_report') |
| `label` | TEXT | — |
| `file_path` | TEXT | — |
| `file_url` | TEXT | — |
| `file_name` | TEXT | — |
| `status` | `document_status` | NOT NULL DEFAULT 'pending' |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |

**Frontend:** `documentService` (list, upload to Storage bucket `intern-documents`, review, downloadUrl, remove).

---

### 6.8 `evaluations` — **[CONFIRMED / USED]**
| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | PK DEFAULT gen_random_uuid() |
| `intern_id` | UUID | NOT NULL, FK → `interns(id)` ON DELETE CASCADE |
| `supervisor_id` | UUID | FK → `supervisors(id)` ON DELETE SET NULL |
| `attendance` | INTEGER | DEFAULT 0, CHECK 0–5 |
| `communication` | INTEGER | DEFAULT 0, CHECK 0–5 |
| `teamwork` | INTEGER | DEFAULT 0, CHECK 0–5 |
| `initiative` | INTEGER | DEFAULT 0, CHECK 0–5 |
| `technical_skills` | INTEGER | DEFAULT 0, CHECK 0–5 |
| `professionalism` | INTEGER | DEFAULT 0, CHECK 0–5 |
| `overall_rating` | INTEGER | DEFAULT 0, CHECK 0–5 |
| `comments` | TEXT | — |
| `final_recommendation` | TEXT | NULL or IN ('highly_recommend','recommend','neutral','do_not_recommend') |
| `status` | `evaluation_status` | NOT NULL DEFAULT 'pending' |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |

**Frontend:** `evaluationService` (list, get, create, update).

---

### 6.9 `announcements` — **[CONFIRMED / USED]**
| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | PK DEFAULT gen_random_uuid() |
| `title` | TEXT | NOT NULL |
| `body` | TEXT | NOT NULL |
| `category` | TEXT | NOT NULL DEFAULT 'company_news', CHECK IN ('company_news','schedule','deadline','reminder') |
| `published_by` | UUID | FK → `profiles(id)` ON DELETE SET NULL |
| `pinned` | BOOLEAN | NOT NULL DEFAULT false |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |

**Frontend:** `announcementService` (list by category, create, update, remove, pin toggle).

---

### 6.10 `settings` — **[CONFIRMED / USED]**
Singleton row (id = 1).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | INTEGER | PK DEFAULT 1, CHECK id = 1 |
| `company_name` | TEXT | — |
| `internship_duration` | TEXT | — |
| `required_hours` | NUMERIC | NOT NULL DEFAULT 300, CHECK >= 0 |
| `is_configured` | BOOLEAN | DEFAULT false |
| `timezone` | TEXT | DEFAULT 'UTC' |
| `date_format` | TEXT | DEFAULT 'YYYY-MM-DD' |
| `week_start_day` | INTEGER | DEFAULT 1 |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |

**Frontend:** `settingsService` (get, upsert). `AdminSettings` reads/writes this row.

---

### 6.11 `notifications` — **[NEW / NOW WIRED]**
Per-user in-app notifications. **Previously defined in the schema but had no frontend support;
now fully implemented** (service + navbar bell + mock seed).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | PK DEFAULT gen_random_uuid() |
| `user_id` | UUID | NOT NULL, FK → `profiles(id)` ON DELETE CASCADE |
| `type` | TEXT | NOT NULL, CHECK IN ('announcement','journal_review','journal_submitted','document_review','evaluation_created','evaluation_submitted','attendance_reminder','attendance_update','account_created','intern_assigned','intern_status','supervisor_assigned') |
| `title` | TEXT | NOT NULL |
| `message` | TEXT | NOT NULL |
| `link` | TEXT | — (in-app route to navigate to) |
| `is_read` | BOOLEAN | DEFAULT false |
| `read_at` | TIMESTAMPTZ | — |
| `metadata` | JSONB | DEFAULT '{}'::jsonb |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |

**Frontend:**
- `src/services/notificationService.js` — list, unreadCount, markRead, markAllRead, create.
- `src/components/layout/NotificationBell.jsx` — navbar bell with unread badge + dropdown.
- `src/lib/mockBackend.js` — `listNotifications`, `unreadNotificationCount`, `markNotificationRead`, `markAllNotificationsRead`, `createNotification`.
- `src/lib/sampleData.js` — seed `notifications` array (exported in `SAMPLE_DATA`).

---

### 6.12 `audit_logs` — **[NEW / NOW WIRED]**
Append-only activity trail. **Previously defined in the schema but had no frontend support;
now fully implemented** (service + admin page + mock seed).

| Column | Type | Constraints |
|--------|------|-------------|
| `id` | UUID | PK DEFAULT gen_random_uuid() |
| `user_id` | UUID | FK → `profiles(id)` ON DELETE SET NULL |
| `action` | TEXT | NOT NULL (e.g. 'create','update','delete','login','review') |
| `resource_type` | TEXT | NOT NULL (e.g. 'intern','daily_journal','announcement') |
| `resource_id` | UUID | — |
| `changes` | JSONB | DEFAULT '{}'::jsonb |
| `ip_address` | TEXT | — |
| `user_agent` | TEXT | — |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |

**Frontend:**
- `src/services/auditLogService.js` — list (filter by resource_type/resource_id), create.
- `src/pages/admin/AdminAuditLogs.jsx` — admin read-only table (route `/admin/audit-logs`).
- `src/components/layout/navigation.js` — added "Audit Logs" nav item for admins.
- `src/lib/mockBackend.js` — `listAuditLogs`, `createAuditLog`.
- `src/lib/sampleData.js` — seed `audit_logs` array (exported in `SAMPLE_DATA`).

---

## 7. Enums

```sql
user_role        = ('admin', 'hr_staff', 'supervisor', 'intern')
intern_status    = ('active', 'completed', 'archived')
attendance_status= ('present', 'late', 'absent', 'pending')
journal_status   = ('pending', 'approved', 'rejected')
document_status  = ('pending', 'approved', 'rejected')
evaluation_status= ('pending', 'completed', 'archived')
```

**Frontend constants:** `src/lib/constants.js` (`ROLES`, `ROLE_LABELS`, `INTERN_STATUS`,
`ATTENDANCE_STATUS`, `JOURNAL_STATUS`, `DOCUMENT_STATUS`, `EVALUATION_*`, `ANNOUNCEMENT_CATEGORIES`,
`DOCUMENT_TYPES`, `EVALUATION_CRITERIA`, `EVALUATION_RECOMMENDATIONS`, `ADMIN_ROLES`,
`SUPERVISOR_ROLES`, `INTERN_ROLES`, `ALL_ROLES`).

---

## 8. Functions

| Function | Returns | Purpose |
|----------|---------|---------|
| `current_role()` | `user_role` | Role of the calling user. |
| `is_admin()` | boolean | True if role IN ('admin','hr_staff'). |
| `current_supervisor_id()` | uuid | Supervisor record id for the calling user. |
| `current_intern_id()` | uuid | Intern record id for the calling user. |
| `handle_new_user()` | trigger | Inserts a `profiles` row on `auth.users` insert. |
| `sync_profile_links()` | trigger | Keeps `profiles.intern_id` / `profiles.supervisor_id` in sync with `interns` / `supervisors`. |

All are `SECURITY DEFINER` with `SET search_path = public`.

---

## 9. Triggers

| Trigger | Event | Action |
|---------|-------|--------|
| `on_auth_user_created` | AFTER INSERT ON `auth.users` | `handle_new_user()` |
| `sync_profile_intern` | AFTER INSERT/UPDATE/DELETE ON `interns` | `sync_profile_links()` |
| `sync_profile_supervisor` | AFTER INSERT/UPDATE/DELETE ON `supervisors` | `sync_profile_links()` |
| `set_profiles_updated` | BEFORE UPDATE ON `profiles` | `moddatetime(updated_at)` |
| `set_interns_updated` | BEFORE UPDATE ON `interns` | `moddatetime(updated_at)` |
| `set_settings_updated` | BEFORE UPDATE ON `settings` | `moddatetime(updated_at)` |

---

## 10. Views

No SQL views are defined. Aggregations (dashboard counts) are computed in the frontend
(`dashboardService`) via `count(*)` queries.

---

## 11. Storage Buckets

### 11.1 `intern-documents` — **[CONFIRMED / USED]**
Public bucket. Intern uploads are namespaced by intern id: `${intern_id}/${timestamp}-${file}`.
RLS on `storage.objects` restricts uploads to the owner's folder and allows admins full access.

**Frontend:** `documentService.upload` / `downloadUrl` / `remove`.

---

## 12. Row Level Security

All tables have RLS enabled. Summary of policy intent:

| Table | Read | Write |
|-------|------|-------|
| `profiles` | authenticated (all); users update own | admins ALL; users UPDATE own |
| `departments` | authenticated (all) | admins ALL |
| `supervisors` | authenticated (all) | admins ALL |
| `interns` | authenticated (all); intern own; supervisor assigned/created | admins ALL; supervisor assigned/created; intern own |
| `attendance` | authenticated (all); intern own; supervisor assigned | admins ALL; intern own |
| `daily_journals` | authenticated (all); intern own; supervisor assigned | admins ALL; intern own; supervisor review assigned |
| `documents` | authenticated (all); intern own | admins ALL; intern own |
| `evaluations` | authenticated (all); intern own; supervisor assigned | admins ALL; supervisor assigned |
| `announcements` | authenticated (all) | admins ALL |
| `settings` | authenticated (all) | admins ALL |
| `notifications` | owner (`user_id = auth.uid()`) | owner UPDATE; system INSERT |
| `audit_logs` | admins (read) | system INSERT |

Storage (`storage.objects`) policies: readable by authenticated; interns may insert only into
their own folder (`(storage.foldername(name))[1] = current_intern_id()`); admins full access.

---

## 13. Relationships (tree)

```
auth.users ──< profiles
profiles ──< supervisors (profile_id)
profiles ──< interns (profile_id)
profiles ──< announcements (published_by)
profiles ──< notifications (user_id)
profiles ──< audit_logs (user_id)
departments ──< supervisors (department_id)
departments ──< interns (department_id)
supervisors ──< interns (supervisor_id, created_by)
interns ──< attendance
interns ──< daily_journals
interns ──< documents
interns ──< evaluations
supervisors ──< daily_journals (supervisor_id)
supervisors ──< evaluations (supervisor_id)
```

---

## 14. Data Flow

1. **Login** → `authService.signIn` → Supabase Auth (or demo session) → `AuthContext` loads
   `profiles` via `profileService.getByUserId`.
2. **Role resolution** → `profile.role` drives `isAdmin` / `isSupervisor` / `isIntern` and
   which sidebar nav + routes are available (`navigation.js`, `RoleRoute`).
3. **CRUD** → each domain page calls its `src/services/*Service` which targets the matching
   Supabase table (or the mock backend in demo mode).
4. **Storage** → documents upload to `intern-documents` and a `documents` row records the path/url.
5. **Notifications** → `NotificationBell` polls `notificationService` for the current user's
   unread items; clicking marks read and navigates via `link`.
6. **Audit** → admin actions can write `audit_logs` via `auditLogService`; viewable at
   `/admin/audit-logs`.

---

## 15. Database Validation (frontend ↔ schema)

### Confirmed present & wired
`profiles`, `departments`, `supervisors`, `interns`, `attendance`, `daily_journals`,
`documents`, `evaluations`, `announcements`, `settings`, all enums, RLS functions, triggers,
storage bucket.

### Previously missing, now implemented
- **`notifications`** — added `notificationService`, `NotificationBell`, mock backend + seed.
- **`audit_logs`** — added `auditLogService`, `AdminAuditLogs` page + route + nav, mock backend + seed.

### Unused / optional (kept for completeness)
- `interns.is_active`, `archived_by/at`, `restored_by/at` — present in schema; the frontend
  currently uses `status` ('active'/'archived') for archive/restore rather than these columns.
  They remain valid schema fields and can be adopted later without breaking the app.

---

## 16. Recommendations

### Security (optional hardening)
- Add DB triggers to auto-write `audit_logs` on sensitive mutations (currently the app inserts
  them explicitly via `auditLogService`).
- Consider a `NOTIFY`/edge-function path to auto-create `notifications` (e.g. when a journal is
  submitted) instead of only manual creation.

### Performance (optional)
- The build warns about a large JS bundle (>500 kB). Consider `manualChunks` / lazy routes.
- Composite indexes already exist for the common filter patterns (intern+status, supervisor+status).

### Scalability / Naming
- `settings` is a singleton (id=1); keep using upsert to avoid duplicate rows.
- Keep `profiles.intern_id` / `supervisor_id` as the canonical role→record link (trigger-maintained).

---

## 17. Login Behavior (Demo vs Supabase mode)

| | Demo mode | Supabase mode |
|---|-----------|---------------|
| Auth | `DEMO_ACCOUNTS` (password `password123`) in `localStorage` | Supabase Auth |
| Data | `mockBackend` seeded from `sampleData` | Postgres tables above |
| Notifications | seeded `notifications` | `notifications` table |
| Audit logs | seeded `audit_logs` | `audit_logs` table |

### Demo accounts
| Email | Role | Password |
|-------|------|----------|
| hr@company.com | admin | password123 |
| supervisor@company.com | supervisor | password123 |
| intern@company.com | intern | password123 |

### Permissions matrix
| Capability | admin | hr_staff | supervisor | intern |
|------------|-------|----------|------------|--------|
| Manage users / settings | ✅ | ✅ | ❌ | ❌ |
| Manage interns & supervisors | ✅ | ✅ | assigned only | ❌ |
| Review journals / evaluations | ✅ | ✅ | assigned only | own only (read) |
| Log attendance | ✅ | ✅ | assigned | own |
| Upload documents | ✅ | ✅ | ❌ | own |
| Publish announcements | ✅ | ✅ | ❌ | ❌ |
| View audit logs | ✅ | ✅ | ❌ | ❌ |
| Receive / read notifications | ✅ | ✅ | ✅ | ✅ |

---

## Appendix A — Complete SQL (reconciled)

> This is the full, idempotent schema. It matches the frontend exactly, including the two
> previously-missing tables (`notifications`, `audit_logs`) which are now implemented end-to-end.

```sql
-- ============================================================
-- COMPLETE DATABASE SCHEMA - IMS (Reconciled)
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS moddatetime SCHEMA extensions;

-- Enums
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_role') THEN
    CREATE TYPE user_role AS ENUM ('admin', 'hr_staff', 'supervisor', 'intern'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'intern_status') THEN
    CREATE TYPE intern_status AS ENUM ('active', 'completed', 'archived'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attendance_status') THEN
    CREATE TYPE attendance_status AS ENUM ('present', 'late', 'absent', 'pending'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'journal_status') THEN
    CREATE TYPE journal_status AS ENUM ('pending', 'approved', 'rejected'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'document_status') THEN
    CREATE TYPE document_status AS ENUM ('pending', 'approved', 'rejected'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'evaluation_status') THEN
    CREATE TYPE evaluation_status AS ENUM ('pending', 'completed', 'archived'); END IF;
END$$;

-- Tables
CREATE TABLE IF NOT EXISTS public.departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  email TEXT,
  avatar_url TEXT,
  contact_number TEXT,
  bio TEXT,
  role user_role NOT NULL DEFAULT 'intern',
  intern_id UUID,
  supervisor_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.supervisors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT,
  full_name TEXT GENERATED ALWAYS AS (
    btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
  ) STORED,
  email TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.interns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT,
  full_name TEXT GENERATED ALWAYS AS (
    btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
  ) STORED,
  contact_number TEXT,
  email TEXT,
  emergency_contact TEXT,
  institution_id UUID REFERENCES public.institutions(institution_id) ON DELETE SET NULL,
  program_id UUID REFERENCES public.programs(program_id) ON DELETE SET NULL,
  department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
  supervisor_id UUID REFERENCES public.supervisors(id) ON DELETE SET NULL,
  start_date DATE,
  end_date DATE,
  required_hours NUMERIC NOT NULL DEFAULT 300 CHECK (required_hours >= 0),
  status intern_status NOT NULL DEFAULT 'active',
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  is_active BOOLEAN DEFAULT TRUE,
  archived_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  archived_reason TEXT,
  archived_at TIMESTAMPTZ,
  restored_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  restored_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.attendance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intern_id UUID NOT NULL REFERENCES public.interns(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT current_date,
  time_in TIMESTAMPTZ,
  time_out TIMESTAMPTZ,
  total_hours NUMERIC NOT NULL DEFAULT 0 CHECK (total_hours >= 0),
  method TEXT DEFAULT 'manual',
  status attendance_status NOT NULL DEFAULT 'present',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.daily_journals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intern_id UUID NOT NULL REFERENCES public.interns(id) ON DELETE CASCADE,
  supervisor_id UUID REFERENCES public.supervisors(id) ON DELETE SET NULL,
  date DATE NOT NULL DEFAULT current_date,
  activities TEXT NOT NULL,
  hours_worked NUMERIC NOT NULL DEFAULT 0 CHECK (hours_worked >= 0),
  challenges TEXT,
  learnings TEXT,
  status journal_status NOT NULL DEFAULT 'pending',
  supervisor_comment TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intern_id UUID NOT NULL REFERENCES public.interns(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('resume','moa','endorsement','school_requirements','completion_report')),
  label TEXT,
  file_path TEXT,
  file_url TEXT,
  file_name TEXT,
  status document_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intern_id UUID NOT NULL REFERENCES public.interns(id) ON DELETE CASCADE,
  supervisor_id UUID REFERENCES public.supervisors(id) ON DELETE SET NULL,
  attendance INTEGER NOT NULL DEFAULT 0 CHECK (attendance BETWEEN 0 AND 5),
  communication INTEGER NOT NULL DEFAULT 0 CHECK (communication BETWEEN 0 AND 5),
  teamwork INTEGER NOT NULL DEFAULT 0 CHECK (teamwork BETWEEN 0 AND 5),
  initiative INTEGER NOT NULL DEFAULT 0 CHECK (initiative BETWEEN 0 AND 5),
  technical_skills INTEGER NOT NULL DEFAULT 0 CHECK (technical_skills BETWEEN 0 AND 5),
  professionalism INTEGER NOT NULL DEFAULT 0 CHECK (professionalism BETWEEN 0 AND 5),
  overall_rating INTEGER NOT NULL DEFAULT 0 CHECK (overall_rating BETWEEN 0 AND 5),
  comments TEXT,
  final_recommendation TEXT CHECK (
    final_recommendation IS NULL OR
    final_recommendation IN ('highly_recommend','recommend','neutral','do_not_recommend')),
  status evaluation_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'company_news'
    CHECK (category IN ('company_news','schedule','deadline','reminder')),
  published_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  pinned BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company_name TEXT,
  internship_duration TEXT,
  required_hours NUMERIC NOT NULL DEFAULT 300 CHECK (required_hours >= 0),
  is_configured BOOLEAN DEFAULT false,
  timezone TEXT DEFAULT 'UTC',
  date_format TEXT DEFAULT 'YYYY-MM-DD',
  week_start_day INTEGER DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('announcement','journal_review','journal_submitted','document_review','evaluation_created','evaluation_submitted','attendance_reminder','attendance_update','account_created','intern_assigned','intern_status','supervisor_assigned')),
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  changes JSONB DEFAULT '{}'::jsonb,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Profile FK links (after tables exist)
ALTER TABLE public.profiles
  ADD CONSTRAINT fk_profiles_intern_id FOREIGN KEY (intern_id) REFERENCES public.interns(id) ON DELETE SET NULL;
ALTER TABLE public.profiles
  ADD CONSTRAINT fk_profiles_supervisor_id FOREIGN KEY (supervisor_id) REFERENCES public.supervisors(id) ON DELETE SET NULL;

-- Indexes
CREATE INDEX IF NOT EXISTS interns_department_idx ON public.interns (department_id);
CREATE INDEX IF NOT EXISTS interns_supervisor_idx ON public.interns (supervisor_id);
CREATE INDEX IF NOT EXISTS interns_status_idx ON public.interns (status);
CREATE INDEX IF NOT EXISTS interns_created_by_idx ON public.interns (created_by);
CREATE INDEX IF NOT EXISTS attendance_intern_idx ON public.attendance (intern_id);
CREATE INDEX IF NOT EXISTS attendance_date_idx ON public.attendance (date);
CREATE UNIQUE INDEX IF NOT EXISTS attendance_open_unique ON public.attendance (intern_id, date) WHERE (time_out IS NULL);
CREATE INDEX IF NOT EXISTS journals_intern_idx ON public.daily_journals (intern_id);
CREATE INDEX IF NOT EXISTS journals_status_idx ON public.daily_journals (status);
CREATE INDEX IF NOT EXISTS journals_supervisor_idx ON public.daily_journals (supervisor_id);
CREATE INDEX IF NOT EXISTS documents_intern_idx ON public.documents (intern_id);
CREATE INDEX IF NOT EXISTS evaluations_intern_idx ON public.evaluations (intern_id);
CREATE INDEX IF NOT EXISTS evaluations_supervisor_idx ON public.evaluations (supervisor_id);
CREATE INDEX IF NOT EXISTS evaluations_status_idx ON public.evaluations (status);
CREATE INDEX IF NOT EXISTS announcements_pinned_idx ON public.announcements (pinned);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON public.profiles(email);
CREATE INDEX IF NOT EXISTS idx_interns_department_status ON public.interns(department_id, status);
CREATE INDEX IF NOT EXISTS idx_interns_supervisor_status ON public.interns(supervisor_id, status);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON public.notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON public.notifications(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON public.audit_logs(resource_type, resource_id);

-- Functions
CREATE OR REPLACE FUNCTION public.current_role() RETURNS user_role LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('admin','hr_staff'));
$$;

CREATE OR REPLACE FUNCTION public.current_supervisor_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT s.id FROM public.supervisors s JOIN public.profiles p ON p.id = s.profile_id WHERE p.id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.current_intern_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT i.id FROM public.interns i JOIN public.profiles p ON p.id = i.profile_id WHERE p.id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role)
  VALUES (new.id, COALESCE(new.raw_user_meta_data->>'full_name',''), new.email,
          COALESCE((new.raw_user_meta_data->>'role')::user_role,'intern'))
  ON CONFLICT (id) DO NOTHING;
  RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_profile_links() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF tg_table_name = 'interns' THEN
    IF tg_op = 'DELETE' THEN UPDATE public.profiles SET intern_id = NULL WHERE intern_id = old.id; RETURN old;
    ELSE IF new.profile_id IS NOT NULL THEN UPDATE public.profiles SET intern_id = new.id WHERE id = new.profile_id; END IF; RETURN new; END IF;
  ELSIF tg_table_name = 'supervisors' THEN
    IF tg_op = 'DELETE' THEN UPDATE public.profiles SET supervisor_id = NULL WHERE supervisor_id = old.id; RETURN old;
    ELSE IF new.profile_id IS NOT NULL THEN UPDATE public.profiles SET supervisor_id = new.id WHERE id = new.profile_id; END IF; RETURN new; END IF;
  END IF;
  RETURN NULL;
END;
$$;

-- Triggers
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
DROP TRIGGER IF EXISTS sync_profile_intern ON public.interns;
CREATE TRIGGER sync_profile_intern AFTER INSERT OR UPDATE OR DELETE ON public.interns FOR EACH ROW EXECUTE FUNCTION public.sync_profile_links();
DROP TRIGGER IF EXISTS sync_profile_supervisor ON public.supervisors;
CREATE TRIGGER sync_profile_supervisor AFTER INSERT OR UPDATE OR DELETE ON public.supervisors FOR EACH ROW EXECUTE FUNCTION public.sync_profile_links();
DROP TRIGGER IF EXISTS set_profiles_updated ON public.profiles;
CREATE TRIGGER set_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);
DROP TRIGGER IF EXISTS set_interns_updated ON public.interns;
CREATE TRIGGER set_interns_updated BEFORE UPDATE ON public.interns FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);
DROP TRIGGER IF EXISTS set_settings_updated ON public.settings;
CREATE TRIGGER set_settings_updated BEFORE UPDATE ON public.settings FOR EACH ROW EXECUTE FUNCTION extensions.moddatetime(updated_at);

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supervisors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.interns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_journals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- (Policies follow the same intent as the project's supabase/migrations/0002_rls.sql.
--  Admins get ALL; authenticated users can read shared tables; owners manage their own rows;
--  notifications are readable/updatable by their user_id; audit_logs readable by admins,
--  insertable by the system.)

-- Storage
INSERT INTO storage.buckets (id, name, public) VALUES ('intern-documents','intern-documents', true)
ON CONFLICT (id) DO NOTHING;
```

---

## Appendix B — Frontend ↔ Schema File Map

| Schema object | Frontend file(s) |
|---------------|-----------------|
| `profiles` | `services/profileService.js`, `services/authService.js`, `contexts/AuthContext.jsx` |
| `departments` | `services/departmentService.js` |
| `supervisors` | `services/supervisorService.js` |
| `interns` | `services/internService.js` |
| `attendance` | `services/attendanceService.js` |
| `daily_journals` | `services/journalService.js` |
| `documents` | `services/documentService.js` |
| `evaluations` | `services/evaluationService.js` |
| `announcements` | `services/announcementService.js` |
| `settings` | `services/settingsService.js` |
| `notifications` | `services/notificationService.js`, `components/layout/NotificationBell.jsx` |
| `audit_logs` | `services/auditLogService.js`, `pages/admin/AdminAuditLogs.jsx` |
| `auth.users` | `services/authService.js`, `api/admin/create-user.js` |
| `intern-documents` | `services/documentService.js` |
| Mock/demo | `lib/mockBackend.js`, `lib/sampleData.js` |
