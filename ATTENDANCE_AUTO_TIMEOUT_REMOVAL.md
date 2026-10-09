# Automatic Time Out Removal & Timezone Standardization

> **Purpose:** Track the removal of the **Automatic Time Out** feature (Chunk 1 identification,
> Chunk 2 removal) and the standardization of Attendance to one timezone (**Asia/Manila, UTC+8**,
> Chunk 3), plus verification of normal Attendance / Claim flows (Chunks 4-6). Final result in
> **## Final Result** at the bottom.

---

## Chunk 1 — Everything connected to Automatic Time Out

Project-wide search for `auto-timeout`, `autoTimeout`, `auto_timeout`, `triggerAutoTimeout`,
`getAutoTimeoutRecords`, `method='auto-timeout'`, and Vercel cron references found the following
**runtime code / configuration** that exists specifically for Automatic Time Out:

| # | Connection | Location | Role |
|---|---|---|---|
| 1 | **Serverless function** | `api/admin/auto-timeout.js` (entire file) | Service-role function that closes today's open records at `17:00:00Z` and writes `method='auto-timeout'` |
| 2 | **Vercel Cron** | `vercel.json` `crons` block (`"0 17 * * *"` → `/api/admin/auto-timeout`) | Scheduled trigger for the function |
| 3 | **Unused service method** | `attendanceService.js` `getAutoTimeoutRecords()` (lines 303-327) | Reads `method='auto-timeout'` rows (no UI caller) |
| 4 | **Unused service method** | `attendanceService.js` `triggerAutoTimeout()` (lines 329-358) | `POST /api/admin/auto-timeout` (no UI caller) |
| 5 | `method='auto-timeout'` value | set by the serverless function; read only by `getAutoTimeoutRecords()` | No other consumer |

**Environment variables:** `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY` are
used by the auto-timeout function **but also** by `api/admin/create-user.js`, `api/admin/delete-user.js`,
and several `scripts/*` files — they are **NOT auto-timeout-only**, so they will **not** be removed.

**Database:** A search of all SQL migrations and `DATABASE_SCHEMA.sql` found **no** database
function, trigger, RPC, constraint, or index created specifically for Automatic Time Out. The auto
time-out writes `public.attendance.time_out` using the ordinary UPDATE path. Therefore **no database
schema change is needed**.

**No other imports/calls:** Neither `getAutoTimeoutRecords` nor `triggerAutoTimeout` is imported or
called by any page/component; they are standalone methods on the `attendanceService` object.

### Chunk 1 summary
Automatic Time Out consists of exactly: the serverless function file, its Vercel cron entry, and the
two unused service methods (`getAutoTimeoutRecords`, `triggerAutoTimeout`). Everything else
(env vars, DB) is shared or non-existent for this feature.

---

## Chunk 2 — What was removed

(Removal performed in this change.)

- Deleted `api/admin/auto-timeout.js`.
- Removed the `crons` block from `vercel.json` (rewrites kept).
- Removed `getAutoTimeoutRecords()` and `triggerAutoTimeout()` from `src/services/attendanceService.js`.

Kept intact: normal Time In, normal Time Out, Claim submission/approval/rejection, attendance history,
attendance records, dashboard attendance, and attendance reports.

---

## Chunk 3 — Timezone standardization (Asia/Manilla, UTC+8)

(Changes performed in this change.)

### 3.1 Where timezone handling differed before (identified)
- `attendanceService.js` derived the attendance **day** (`date`) and "today" with
  `new Date().toISOString().slice(0, 10)` — **UTC**.
- `dashboardService.js` filtered attendance "today" with the same **UTC** date.
- `InternAttendance.jsx` used `todayISO()` (UTC) for claim/previous-day detection but a **browser
  local** `setHours(17,0,0,0)` cutoff.
- `TimeOutForm.jsx` / `ClaimTimeOutForm.jsx` interpreted the chosen **wall-clock** time in the
  **browser local** timezone.
- Display (`formatDate`/`formatTime`) was **browser local**.

### 3.2 Standardization applied (minimum changes, Attendance-only)
- Added an attendance timezone constant `ATTENDANCE_TIMEZONE = "Asia/Manila"` to `src/utils/format.js`
  with helpers:
  - `todayDateInAttendanceTZ()` — today's date `YYYY-MM-DD` in Manila.
  - `formatDateInAttendanceTZ / formatTimeInAttendanceTZ / formatDateTimeInAttendanceTZ` — display in Manila.
  - `manilaWallTimeToISO(dateStr, hhmm)` — interpret a chosen wall-clock time as Manila and return the UTC ISO instant.
  - `nowMinuteInAttendanceTZ()` — current minute-of-day in Manila (for the 5 PM claim gate).
- `attendanceService.js` and `dashboardService.js` now use Manila "today" for the attendance `date`
  and today-detection / dashboard date filters.
- `InternAttendance.jsx` now uses Manila for today, previous-day detection, the 5 PM claim gate, and
  Attendance display.
- `AdminAttendance.jsx`, `SupervisorAttendance.jsx`, `TimeOutForm.jsx`, `ClaimTimeOutForm.jsx`,
  `ReviewClaimModal.jsx`, and `AdminReports.jsx` now display attendance dates/times in Manila, and
  the forms build the time-out/claim instant in Manila.
- `time_in`/`time_out` remain stored as UTC instants (`timestamptz`) — an instant is timezone-neutral;
  every attendance date comparison and display now uses Asia/Manila, so there is **one** attendance
  timezone and **no** UTC/local mixing.

### 3.3 Preserved behavior
- Yesterday's open record and today's record remain **separate rows/dates** (per `(intern_id, date)`
  unique index). Yesterday's Claim (`submitClaim`) writes only yesterday's row; today's Time In
  (`timeIn`) and Time Out (`timeOut`) write only today's row. Claim approval/rejection unchanged.

---
