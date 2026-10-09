# Attendance Error Analysis — Actual Implementation

> **Scope:** This document is a read-only analysis of the **actual** Attendance implementation, based
> strictly on the existing code. No source code was modified, nothing was fixed, no new flow was
> created, and no implementation plan is proposed.
>
> **Files inspected:**
> - `src/services/attendanceService.js`
> - `src/pages/intern/InternAttendance.jsx`
> - `src/pages/admin/AdminAttendance.jsx`
> - `src/pages/supervisor/SupervisorAttendance.jsx`
> - `src/components/attendance/TimeOutForm.jsx`, `ClaimTimeOutForm.jsx`, `ReviewClaimModal.jsx`
> - `src/services/dashboardService.js`, `src/pages/admin/AdminReports.jsx`
> - `api/admin/auto-timeout.js`, `vercel.json`
> - `src/utils/format.js`, `src/lib/constants.js`, `src/lib/supabase.js`, `src/services/activityService.js`
> - `DATABASE_SCHEMA.sql`, `DATABASE_SCHEMA.md`, `supabase/migrations/*` (attendance-related)
> - Docs: `docs/admin-attendance.md`, `ATTENDANCE_FLOW.md`, `ATTENDANCE_CLAIM_FLOW.md`

---

## 1. Actual Current Attendance Flow

Attendance is **client-driven CRUD against a Supabase `attendance` table** (PostgREST). There is
**no RPC/transaction and no database trigger** that computes attendance — the calendar **day**, the
**hours**, and the **status** are all decided in the **frontend** (plus one Vercel serverless
"auto-timeout" cron that closes forgotten records).

### 1.1 Database model
- Table **`public.attendance`** (`DATABASE_SCHEMA.sql:159-175`, `supabase/migrations/0001_init.sql:82-89`):
  `id uuid PK`, `intern_id uuid FK→interns(id) ON DELETE CASCADE`,
  `date date NOT NULL DEFAULT current_date`, `time_in timestamptz`, `time_out timestamptz`,
  `total_hours numeric NOT NULL DEFAULT 0 CHECK (total_hours >= 0)`, `method text DEFAULT 'manual'`,
  `status attendance_status NOT NULL DEFAULT 'present'`, `created_at`.
  Later columns (migrations): `remarks` (`0032/0033`); claim columns `claimed_time_out`,
  `claim_status`, `claim_remarks`, `claim_reviewed_by`, `claim_reviewed_at`, `claim_review_comment` (`0034`).
- **One attendance record per intern per day** — `attendance_unique_per_day (intern_id, date)`
  (`0005_one_attendance_per_day.sql:20-21`, `DATABASE_SCHEMA.sql:174-175`).
- **RLS on `attendance`** (`DATABASE_SCHEMA.sql:546-567`, `0034:55-69`):
  - `attendance readable` — SELECT for any authenticated user.
  - `admins manage attendance` — all (via `is_admin()`).
  - `intern manages own attendance` — all where `intern_id = current_intern_id()`.
  - `supervisor reads assigned attendance` — SELECT for assigned interns.
  - `supervisor reviews attendance claims` — UPDATE for assigned interns (migration `0034`).

### 1.2 Auth → intern relationship
- `auth.users` → `handle_new_user()` trigger creates a `profiles` row (`0002_rls.sql:66-87`).
- `current_intern_id()` resolves the intern id from `interns.profile_id` **or** cached
  `profiles.intern_id` (`0019_create_orphan_intern_rows.sql:46-63`); `sync_profile_links` keeps them in sync.
- Frontend: `internId = profile.intern_id` via `useAuth()` (`InternAttendance.jsx:28`, `AuthContext.jsx:79`).

### 1.3 Intern side (`InternAttendance.jsx` + `attendanceService.js`)
1. **Load** (`load`, lines 40-55): `getToday(internId)` + `list(internId, page 1, 30)`. Sets
   `open = todayRecord && !todayRecord.time_out ? todayRecord : null`.
   `getToday` (`attendanceService.js:40-51`) = `SELECT * … eq(date, today).maybeSingle()`.
2. **Time In** (`confirmTimeIn`, 63-111 → `timeIn`, `attendanceService.js:53-88`): existence check,
   then `INSERT (intern_id, date=today, time_in=now ISO, method='manual', status='present')`;
   on `23505` unique violation → "already submitted"; then audit + supervisor notification.
3. **Time Out** (`handleTimeOut`, 116-165 → `timeOut`, `attendanceService.js:94-123`): reads the row,
   `total = diffHours(time_in, timeOut)`, then `UPDATE time_out, total_hours, remarks, method='manual'`;
   then audit + supervisor notification.
4. **Claim / missed clock-out** (columns 224-272, `submitClaim` 132-163, supervisor `reviewClaim`
   173-227): open previous-day rows (or today after 5 PM) offer "Claim Time Out"; approval applies the
   claimed time as `time_out`; rejection sets `status='absent'`.

### 1.4 Time In/Out timing
- Times are stored as **UTC ISO instants** (`new Date().toISOString()`); the `date` day key is derived
  with `new Date().toISOString().slice(0, 10)` (**UTC date**).
- Display uses the **browser's local timezone** (`Intl` in `format.js`).

### 1.5 Status logic
- `timeIn` **always** writes `status: 'present'` (`attendanceService.js:73`). `'late'`/`'pending'`
  are never derived. `'absent'` is set **only** when a claim is rejected (`attendanceService.js:215-217`).

### 1.6 Automatic Time Out
- Vercel Cron `0 17 * * *` → `POST /api/admin/auto-timeout` (`vercel.json:6-11`).
- `api/admin/auto-timeout.js` (service-role client) finds today's open rows (`date=today`,
  `time_in NOT NULL`, `time_out IS NULL`), sets `time_out = <today>T17:00:00Z`, recomputes
  `total_hours`, `method='auto-timeout'` (lines 70-111).
- `attendanceService.js` exposes `triggerAutoTimeout()` (335-358) and `getAutoTimeoutRecords()`
  (307-327), but **neither is called by any page** — dead code; only the cron path is active.

### 1.7 Admin / Supervisor views + dashboard + reports
- **AdminAttendance.jsx**: `adminList({dateFrom,dateTo,page})` (`243-266`, server-side date filter +
  pagination) then **client-side** status/claim filters (45-57); CSV export (84-118).
- **SupervisorAttendance.jsx**: `adminList({supervisorId, pageSize:100})` + client filters (36-68);
  claim review (74-134).
- **AdminReports.jsx**: attendance report + "Hours Rendered" aggregate (41-50, 69-86).
- **Dashboards** (`dashboardService.js`): today's attendance counts by `eq(date, today)` (45, 63, 91);
  intern hours via `total_hours` sum (77-91).

---

## 2. Actual Attendance Error

No single end-user error string was supplied for this audit, so the "error" documented here is the
**concrete defect confirmed by tracing the code**. The primary defect is a
**timezone / UTC-vs-local calendar-date mismatch**:

- The attendance **day** (`date`) and all "today" filters are derived from **UTC**
  (`new Date().toISOString().slice(0, 10)`), while
- `time_in`/`time_out` are stored as UTC instants but **rendered in the local timezone**, and
- the automatic Time Out cutoff is **hardcoded to `17:00:00Z` (UTC)** with a UTC cron, while
- the intern UI uses a **local** 5 PM cutoff (`cutoff.setHours(17,0,0,0)`).

For any organization **east of UTC** (e.g. UTC+8), this produces:

1. **Morning clock-ins are filed under the previous UTC day.** A clock-in at local 00:00–07:59 in
   UTC+8 maps to the previous UTC day, so the record `date` is "yesterday" while the user is on "today".
2. **Time-in / time-out can straddle two `date` values**, and every `eq("date", today)` filter and
   the one-per-day uniqueness then reference a day that does not match the user's actual working day.
3. **The automatic Time Out closes records at the wrong instant** — `17:00Z` is 01:00 the next local
   day for UTC+8 — and computes hours through that instant.
4. The intern page mixes sources: it normalizes a row date from UTC but compares the 5 PM claim gate
   in local time (`InternAttendance.jsx:245-256`).

**Resulting symptoms:**

- An intern may see "You haven't timed in today" (or a duplicate-day "already submitted") at a day
  boundary, because `getToday`/`getOpen` filter on the UTC `date`.
- A record that should be "today" can be treated as a **previous-day** row by the claim/forgotten logic.
- Forgot-to-clock-out records get `time_out` set to 01:00 next-day local (in UTC+8), with hours counted
  to that instant instead of local 5 PM.
- Dashboard "attendance today" counts (`dashboardService.js:45,63,91`) can differ from the attendance
  screen in the same window.

---

## 3. Root Cause

The root cause is a **single architectural inconsistency in the date/time encoding**:

- The `date` (calendar day) value is produced **client-side from UTC**
  (`new Date().toISOString().slice(0, 10)`) and stored in a `date` column whose DB default is
  `current_date` (also server-timezone dependent),
- while the `time_in`/`time_out` instants are stored as `timestamptz` UTC and rendered back
  **in local time**,
- and the automatic Time Out end-of-day constant is **hardcoded to `17:00:00Z`** with a UTC cron.

These three sources (UTC-derived calendar day, local rendering, UTC end-of-day) are **not normalized
to one timezone**, so any non-UTC deployment produces day-boundary and end-of-day errors.

Secondary root causes (independent of timezone):

- **Client-side post-pagination filtering** in the admin/supervisor tables makes count + pagination
  incorrect when a status/claim filter is active.
- **`total_hours >= 0` CHECK paired with `diffHours(...)` returning `0`** silently turns any
  `time_out <= time_in` into a 0-hour record instead of raising a validation error.
- **The supervisor claim-review RLS `with check` only asserts intern ownership**, not which columns a
  supervisor may change (contradicting the migration's own comment).


---

## 4. Code Evidence

### 4.1 UTC-derived calendar day vs local rendering
- `src/services/attendanceService.js:27,42,54,275` — `const today = new Date().toISOString().slice(0, 10);` (UTC) in `getOpen`, `getToday`, `timeIn`, `getStats`.
- `src/utils/format.js:48` — `todayISO()` returns `new Date().toISOString().slice(0, 10)` (UTC).
- `src/utils/format.js:26-44` — `formatDate`/`formatTime` render via browser-local `Intl`.
- DB default `date date not null default current_date` (`DATABASE_SCHEMA.sql:162`; `0001_init.sql:84`).

### 4.2 Automatic Time Out — hardcoded UTC 17:00 + UTC cron
- `api/admin/auto-timeout.js:70-71` — `today = new Date().toISOString().slice(0,10)`; `fivePM = new Date(\`${today}T17:00:00Z\`)`.
- `api/admin/auto-timeout.js:77-80` — `.eq("date", today) .not("time_in","is",null) .is("time_out",null)`.
- `api/admin/auto-timeout.js:102-111` — `time_out = fivePM.toISOString()`, recompute `total_hours`, `method='auto-timeout'`.
- `vercel.json:6-11` — cron `"0 17 * * *"` (UTC) → `/api/admin/auto-timeout`.

### 4.3 Local vs UTC 5 PM gate mismatch in the intern UI
- `src/pages/intern/InternAttendance.jsx:245-256` — row date normalized with `String(r.date).slice(0,10)` + compared to `todayISO()` (UTC), but cutoff uses local `cutoff.setHours(17,0,0,0)`.
- `InternAttendance.jsx:48` — `setOpen(todayRecord && !todayRecord.time_out ? todayRecord : null)` (only today's UTC row).
- `InternAttendance.jsx:167-175` — `isForgotten = open?.date !== today` is always false because `open` only ever holds a today row.

### 4.4 Client-side post-pagination filtering (admin/supervisor)
- `src/pages/admin/AdminAttendance.jsx:45-57` — fetch server-paginated page, filter status/claim client-side; `setTotal(res.count)` (unfiltered).
- `src/pages/supervisor/SupervisorAttendance.jsx:39-62` — `pageSize:100`, client filters each 100-row snapshot.

### 4.5 `total_hours >= 0` + `diffHours` returning 0
- `DATABASE_SCHEMA.sql:165` — `total_hours numeric not null default 0 check (total_hours >= 0)`.
- `src/utils/format.js:55-61` — `diffHours` returns `0` when `end <= start` or invalid (no throw).
- `attendanceService.js:109` (`timeOut`), `:206-209` (`reviewClaim` approval) write that `0` into `total_hours`.

### 4.6 Status never derived
- `attendanceService.js:73` — `status: "present"` set unconditionally on time-in.
- `attendanceService.js:215-217` — `status: "absent"` only on claim rejection.
- No code computes `'late'`/`'pending'` for attendance despite the enum/labels (`constants.js:35-47`).

### 4.7 Supervisor claim-review RLS over-broad UPDATE
- `supabase/migrations/0034_missed_clockout_claim.sql:55-69` — `with check` only asserts `intern_id` in assigned; does not restrict columns or require a pending claim, despite comment (lines 52-54).

### 4.8 Dead manual-trigger code
- `attendanceService.js:307-358` — `getAutoTimeoutRecords` and `triggerAutoTimeout` defined but no UI caller.

---

## 5. Related Issues

- **Dashboard "today" counts are timezone-inconsistent** with the attendance screen (`dashboardService.js:45,63,91`).
- **One-record-per-day uniqueness can reject a legitimate clock-in** near local midnight due to the UTC `date` (`attendanceService.js:80-84`).
- **Automatic Time Out failure handling is partial** — per-record errors only accumulate in `errors[]`, no retry/notification (`auto-timeout.js:99-129`).
- **Admin CSV export** uses the already-paginated, client-filtered `rows` (`AdminAttendance.jsx:84-118`), so it may not export the full filtered dataset.
- **Reports "Hours Rendered"** sums `total_hours` (`AdminReports.jsx:69-86`), inheriting any 0-hour records and timezone misattribution.
- **Claim review** can be performed on any assigned intern's attendance row even with no pending claim (§4.7).

---

## 6. Unconfirmed Areas

These were **not verified** in this read-only audit (no DB access / build / runtime execution):

1. **Production database timezone** — whether the Supabase project runs in UTC, UTC+8, or another zone (`SHOW timezone`), and the actual browser/devices' timezone; the timezone error §2 is demonstrated algebraically for any non-UTC (east) deployment.
2. **Whether the auto-timeout cron is actually deployed/enabled** on Vercel, and its runtime timezone.
3. **Live presence** of the `total_hours >= 0` CHECK and `attendance_unique_per_day` index (assumed from migrations/schema).
4. **Which side of the auth link is populated** (`profiles.intern_id` vs `interns.profile_id`) in the live DB, affecting ownership RLS.
5. **No functional/UI reproduction** was run, so the exact runtime error text/stack a user sees is not captured.

---

## Stopping Point

This is the end of **Chunk 1**. No code was changed, nothing was fixed or redesigned, and no
implementation plan was produced. Awaiting the next instruction.

