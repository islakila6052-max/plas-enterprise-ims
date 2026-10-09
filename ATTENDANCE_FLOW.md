# Attendance Flow — Current Implementation

> **Scope:** Read-only documentation of the **existing** Attendance system. No code was modified,
> no new flow was created, and no improvements are suggested.
> Traced from: frontend pages/components, `attendanceService`, Supabase tables, migrations, RLS,
> the serverless auto-timeout cron, dashboards, and reports.

---

## 1. What the Attendance system actually is

Attendance is **client-driven CRUD against a Supabase `attendance` table** (PostgREST). There is
**no transaction/RPC and no database trigger** that computes attendance — the day key, the hours,
and the status are all decided in the **frontend** (except the automatic Time Out, which is a Vercel
serverless cron that also runs from a serverless function in Node).

The flow is:

**Intern (student) → Time In → save attendance record → Time Out → compute hours/status → result**

---

## 2. The data (database)

Table **`public.attendance`** (`DATABASE_SCHEMA.sql:159-175`, `supabase/migrations/0001_init.sql:82-89`):

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `intern_id` | uuid FK → `interns(id)` | ON DELETE CASCADE |
| `date` | date | NOT NULL, default `current_date` — the "day" |
| `time_in` | timestamptz | clock-in instant |
| `time_out` | timestamptz | clock-out instant (null = still open) |
| `total_hours` | numeric | NOT NULL default 0, `CHECK (total_hours >= 0)` |
| `method` | text | default `'manual'` (also `'auto-timeout'`, `'claimed'`) |
| `status` | `attendance_status` | default `'present'` (`present/late/absent/pending`) |
| `created_at` | timestamptz | default `now()` |

Extra columns (added by migrations): `remarks` (`0032/0033`), and the missed-clock-out claim columns
`claimed_time_out`, `claim_status`, `claim_remarks`, `claim_reviewed_by`, `claim_reviewed_at`,
`claim_review_comment` (`0034`).

**Constraints / indexes**

- `attendance_unique_per_day (intern_id, date)` — **one record per intern per day**
  (`0005_one_attendance_per_day.sql:20-21`).
- Indexes: `attendance_intern_idx`, `attendance_date_idx`, `idx_attendance_remarks`,
  `idx_attendance_claim_status`.

**Row Level Security (RLS)** (`DATABASE_SCHEMA.sql:546-567`, `0034:55-69`)

- SELECT: any authenticated user.
- Write: admins (`is_admin()`), the intern's own rows (`intern_id = current_intern_id()`),
  and assigned supervisors for claims (`intern_id` in their assigned interns).

---

## 3. Files involved

| Layer | File | Purpose |
|---|---|---|
| Client init | `src/lib/supabase.js` | Supabase client (anon key). Throws if unconfigured. |
| Auth | `src/contexts/AuthContext.jsx` | Exposes `profile`, `internId`, `supervisorId`. |
| Service | `src/services/attendanceService.js` | All attendance queries/writes. |
| Format | `src/utils/format.js` | `diffHours()` (hour math), `todayISO()`, `formatDate/Time/Hours`. |
| Intern UI | `src/pages/intern/InternAttendance.jsx` | Time In / Time Out / claim + history. |
| Forms | `src/components/attendance/TimeOutForm.jsx`, `ClaimTimeOutForm.jsx`, `ReviewClaimModal.jsx` | Modal inputs. |
| Admin UI | `src/pages/admin/AdminAttendance.jsx` | Org-wide view + CSV export. |
| Supervisor UI | `src/pages/supervisor/SupervisorAttendance.jsx` | Assigned interns + claim review. |
| Dashboards | `src/services/dashboardService.js` | Attendance KPIs. |
| Reports | `src/pages/admin/AdminReports.jsx` | Attendance + Hours Rendered exports. |
| Auto Time Out | `api/admin/auto-timeout.js` + `vercel.json` cron | Automatic Time Out at 5 PM. |
| In-app events | `src/services/activityService.js` | Audit log + supervisor notification. |

## 4. Actual step-by-step trace

### 4.1 Login → identity (precondition)
- `AuthContext.bootstrap` → `authService.getCurrentUser()` → loads `profiles` row
  → `internId = profile.intern_id` (`AuthContext.jsx:79`).
- If `internId` is null, the attendance page bails out (no attendance flows run).

### 4.2 Attendance page load (`InternAttendance.jsx` `load()` lines 40-55)
- Calls `attendanceService.getToday(internId)` and `attendanceService.list({internId, page:1, pageSize:30})`.
- `getToday` (`attendanceService.js:40-51`): `SELECT * FROM attendance WHERE intern_id=? AND date=today .maybeSingle()`.
- `list` (`attendanceService.js:229-241`): newest-30 history.
- Sets `open = today's row if it has no time_out`, else button shows "Time In" / "Attendance Completed".

### 4.3 Time In (`InternAttendance.jsx` `confirmTimeIn` lines 63-111 → `attendanceService.timeIn` lines 53-88)
1. ConfirmDialog "Yes, Time In".
2. Existence check: `SELECT * ... WHERE intern_id=? AND date=today .maybeSingle()`; if found → error
   "You have already submitted your attendance for today."
3. `INSERT (intern_id, date=today, time_in=now ISO, method='manual', status='present')` `.select().single()`.
4. On unique violation (`23505`) → same "already submitted" message.
5. After save: `recordAudit(...)` (audit_logs) + `notify(supervisor, 'attendance_update')` (best-effort).

### 4.4 Time Out (`InternAttendance.jsx` `handleTimeOut` lines 116-165 → `attendanceService.timeOut` lines 94-123)
1. `TimeOutForm` is filled (date + local HH:mm; remarks optional).
2. `timeOut` fetches the row (`SELECT time_out, time_in`); if already `time_out` → error
   "You have already timed out for today."
3. `total = diffHours(time_in, timeOut)` (client-side math, `format.js:55-61`).
4. `UPDATE time_out, total_hours, remarks, method='manual'` `.select().single()`.
5. After save: `recordAudit(...)` + `notify(supervisor, 'attendance_update')`.

### 4.5 Missed-clock-out claim (fallback, `InternAttendance.jsx` columns 224-272; `submitClaim` 132-163)
- A row with `time_in` but no `time_out` shows "Claim Time Out" for previous-day rows (or today after 5 PM).
- `submitClaim` → `UPDATE claimed_time_out, claim_status='pending', claim_remarks`.
- `ReviewClaimModal` (supervisor) → `reviewClaim` (`173-227`): on approve sets
  `time_out = claimed_time_out`, recompute `total_hours`, `method='claimed'`; on reject sets `status='absent'`.

### 4.6 Admin / Supervisor views (`AdminAttendance.jsx`, `SupervisorAttendance.jsx`)
- `attendanceService.adminList({dateFrom,dateTo,supervisorId,page})` (`243-266`) joins `interns` for
  name/student number, orders newest-first, paginates server-side; page applies client-side status/claim filters.
- Supervisor reviews pending claims via `reviewClaim`.

### 4.7 Automatic Time Out (`api/admin/auto-timeout.js` + `vercel.json` cron `0 17 * * *`)
- Serverless function (service-role client, bypasses RLS) finds today's open rows
  (`date=today`, `time_in NOT NULL`, `time_out IS NULL`), sets
  `time_out = <today>T17:00:00Z`, recomputes `total_hours`, `method='auto-timeout'`.
- Manual trigger helpers exist in `attendanceService` (`triggerAutoTimeout`, `getAutoTimeoutRecords`)
  but are **not called by any page** (dead code); only the cron path is active.

### 4.8 Dashboards / Reports (consumers)
- `dashboardService.adminStats` — counts today's attendance (`eq('date', today)`).
- `dashboardService.supervisorStats` — counts today's attendance for assigned interns.
- `dashboardService.internStats` — sums `total_hours` vs `required_hours`.
- `AdminReports` — Attendance report + "Hours Rendered" aggregate (sums `total_hours`).

---

## 5. Current Flow (simple visual)

The actual flow, step by step:

```
STUDENT (Intern)
   │  logs in → AuthContext resolves internId (profile.intern_id)
   ▼
ATTENDANCE PAGE LOADS
   │  InternAttendance.jsx  load()
   │    → attendanceService.getToday(internId)         ← is there a record for today?
   │    → attendanceService.list({internId})            ← history
   ▼
   Today's record exists?  no  →  [Time In] button
                          yes →  record has time_out?  no → [Time Out] button
                                                     yes → [Attendance Completed] (disabled)
   ▼
═══  TIME IN  ════════════════════════════════════════════════════
   [Time In] clicked → ConfirmDialog (InternAttendance.jsx confirmTimeIn)
      → attendanceService.timeIn(internId, 'manual')      (attendanceService.js:53-88)
          │ 1) SELECT * … WHERE intern_id=? AND date=today   (already submitted? → error)
          │ 2) INSERT INTO attendance
          │      (intern_id, date=today, time_in=now, method='manual', status='present')
          │ 3) on 23505 (unique intern_id+date) → "already submitted"
          ▼
   ATTENDANCE RECORD IS SAVED  (public.attendance new row; status = present)
      → recordAudit()  +  notify(supervisor, 'attendance_update')   (best-effort)
      → toast "Timed in." → page reloads → button now [Time Out]
   ▼
═══  TIME OUT  ════════════════════════════════════════════════════
   [Time Out] clicked → TimeOutForm (date + local HH:mm + optional remarks)
      → attendanceService.timeOut(recordId, timeOut, remarks)   (attendanceService.js:94-123)
          │ 1) SELECT time_out, time_in …                      (already timed out? → error)
          │ 2) total = diffHours(time_in, timeOut)             (client-side math, format.js)
          │ 3) UPDATE attendance
          │      SET time_out=…, total_hours=total, remarks=…, method='manual'
          │      WHERE id=recordId
          ▼
   SYSTEM CALCULATES / UPDATES ATTENDANCE  (total_hours stored; record now closed)
      → recordAudit()  +  notify(supervisor, 'attendance_update')
      → toast "Timed out." → page reloads → button [Attendance Completed]
   ▼
ATTENDANCE RESULT
   │  visible in: InternAttendance history table (Date, Time In, Time Out, Hours, Status, Claim)
   │              SupervisorAttendance.jsx (assigned interns) + ReviewClaimModal for claims
   │              AdminAttendance.jsx (org-wide + CSV) ; AdminReports.jsx (PDF/CSV)
   │              Dashboards via dashboardService (today count + total_hours aggregated)
   ▼
AUTOMATIC TIME OUT (fallback, if intern forgot)
      vercel.json cron 0 17 * * *  →  api/admin/auto-timeout.js
         │ finds today's rows with time_in but NO time_out
         │ UPDATE time_out=<today>T17:00:00Z, total_hours=…, method='auto-timeout'
         ▼
   record closed automatically (no status change — stays 'present')
```

**Key files/functions used above:** `InternAttendance.jsx` (`load`, `confirmTimeIn`, `handleTimeOut`),
`attendanceService.js` (`getToday`, `timeIn`, `timeOut`, `list`), `utils/format.js` (`diffHours`),
`activityService.js` (`recordAudit`, `notify`), table `public.attendance`,
`api/admin/auto-timeout.js` + `vercel.json`.


---

## Current Attendance Problem

### What happens now

The app decides the attendance **"day"** using **UTC**: everywhere the code computes "today" with
`new Date().toISOString().slice(0, 10)` (in `attendanceService.js` and `todayISO()` in
`utils/format.js`). That UTC date string is stored in the `attendance.date` column and used for the
"one record per intern per day" rule, `getToday()`, the dashboard "today" counts, and the claim after-5PM check.

But the **times are stored as UTC instants and shown back in the user's local timezone**
(`formatDate`/`formatTime` use the browser's local `Intl`), and the automatic Time Out is hardcoded
to **`17:00:00Z` (UTC)** with a UTC cron (`vercel.json`).

The result for any organization **east of UTC** (e.g. the Philippines, UTC+8):

- A morning clock-in before ~8:00 AM local is filed under the **previous UTC date**.
  Example (verified): local 06:00 on Aug 10 → `toISOString().slice(0,10)` = `2026-08-09`
  → the record is dated **yesterday**, even though the intern is on Aug 10.
- The automatic Time Out writes `time_out = <today>T17:00:00Z`, which for UTC+8 is **1:00 AM the next
  day local**, and it counts hours up to that 1 AM instant instead of local 5 PM.

### Where the problem occurs

- **Attendance "day" is chosen in UTC** — `src/services/attendanceService.js` (`timeIn`, `getToday`)
  and `src/utils/format.js` `todayISO()`.
- **Display is local** — `src/utils/format.js` `formatDate`/`formatTime` (`Intl`, local timezone).
- **Auto Time Out uses UTC 17:00** — `api/admin/auto-timeout.js:70-71,102-111` and `vercel.json`.
- **The intern page mixes both** — `InternAttendance.jsx:245-256` compares a UTC-normalized row date
  to `todayISO()` but uses local `setHours(17,0,0,0)` for the 5 PM claim cutoff.

### Why it happens

The day key (`date`), the clock-in/out instants (`time_in`/`time_out`), the on-screen rendering, and
the end-of-day cutoff are each derived in **different timezones** (UTC vs local) and are never
normalized to one zone. The DB simply stores whatever the frontend computes for `date`, so the
mis-dating happens before the data even reaches Supabase.

### What the expected behavior appears to be

The attendance record's `date`, the displayed day/time, and the 5 PM automatic time-out should all
refer to the **user's actual working (local) day and end-of-day** — i.e. a clock-in at 06:00 on
Aug 10 (local) should be recorded under Aug 10, and "forgot to time out" should close the record at
local 5:00 PM. Currently they can be shifted by the UTC/local difference.

> Note: this is the most consequential defect confirmed from the code. It is provable mathematically
> for any east-of-UTC deployment; whether a user sees it today depends on the live server/browser
> timezone (the exact production timezone has not been confirmed — see the unconfirmed areas in the
> analysis). It is not being fixed here.

**CHUNK 3 complete.** The problem is identified above; it is **not** being fixed or redesigned.

---

## Chunk 4 — Status

The Attendance flow is documented (Chunks 1-2) and the problem is identified (Chunk 3) in this file.

**No code was modified. Nothing was implemented. Nothing was redesigned.**
The project is left ready for the next instruction. Awaiting further instructions.

