# Attendance Claim / Missed Time-Out — Flow Analysis

> **Scope:** Read-only analysis of the **actual** `Claim Time Out` feature. No code modified,
> nothing fixed or redesigned. All behavior below is traced from the existing code.

---

## Overview — how the Claim feature fits the flow

The Claim feature is a **fallback for an attendance record that has a `time_in` but no `time_out`**
(an "open" record). Interns cannot edit that record directly the next day; instead they submit a
**Claim Time Out** which a **supervisor** must approve or reject. On approval the claimed time becomes
the official `time_out`; on rejection the record is marked absent.

Actual flow:

```text
YESTERDAY
Time In  (InternAttendance → attendanceService.timeIn → INSERT attendance: time_in, date=yesterday, status='present')
   ↓
Forgot Time Out → record stays OPEN (time_out = null)
   ↓
NEXT DAY
Intern opens My Attendance → History table shows yesterday's OPEN row with a "Claim Time Out" button
   ↓
Intern clicks Claim → ClaimTimeOutForm → attendanceService.submitClaim
   → UPDATE attendance: claimed_time_out, claim_status='pending', claim_remarks
   ↓
Supervisor Attendance page shows "Pending" + "Review" button
   ↓
ReviewClaimModal → attendanceService.reviewClaim
   ↓
APPROVED  → time_out = claimed_time_out ; total_hours recomputed ; method='claimed' ; claim_status='approved'
REJECTED  → status='absent' ; time_out stays null ; claim_status='rejected'


TODAY (independent)
Time In  (separate attendance row for today's date)
   ↓
Work
   ↓
Time Out (separate attendance row for today's date)
```

---

## 1. The Claim flow (intern side)

### 1.1 When the Claim button appears, is clickable, or is disabled

The Claim button is rendered **inside the History table's "Claim" column** on
`src/pages/intern/InternAttendance.jsx` (claim render logic, lines 224-272). It is **not** part of
the main "Today" card (that card only shows Time In / Time Out / Completed).

For each history row `r` the column logic evaluates in this order:

| Condition (checked first → last) | Result |
|---|---|
| `r.claim_status === "pending"` | **No button** — shows amber "Claim Pending" badge |
| `r.claim_status === "approved"` | **No button** — shows green "Claim Approved" badge |
| `r.claim_status === "rejected"` | **No button** — shows red "Claim Rejected" badge |
| `r.time_out` is set (closed record) | **No button** — shows "—" |
| `open?.id === r.id` (row = currently-open record that has the Time Out button) | **No button** — shows "—" (intern can use the normal Time Out button) |
| row date **is today** and now **before 5 PM local** | **No button** — shows "—" |
| row date **is a previous day** (or today after 5 PM) and has no `time_out` | **Clickable** "Claim Time Out" button |

So the button is **clickable** when: the record has a `time_in`, no `time_out`, no claim status yet,
is **not** the currently open record, and is **from a previous day** (or today past 5 PM local).

### 1.2 Which record the button belongs to

The button belongs to the **specific open attendance row** shown in that History row (identified by
`r.id`). It is attached to **yesterday's (previous-day) open record**, not today's.

### 1.3 How the system decides the record is "yesterday"

Each row's `date` is normalized to `YYYY-MM-DD` (`String(r.date).slice(0,10)`, line 245) and compared
with `todayISO()` (line 246). If they differ → the record is treated as a **previous-day** record →
Claim button is offered. If they are equal → it's today, and the button only appears **after 5 PM
local** (`cutoff.setHours(17,0,0,0)`, line 254).

### 1.4 What happens when the intern clicks Claim

1. `onClick` sets `claimRecord = r` and `showClaimForm = true` (lines 263-266).
2. `ClaimTimeOutForm.jsx` opens with the record's date + time_in, a **Claimed Time Out** time picker,
   and a required **Reason** field.
3. On submit it calls `handleClaimSubmit({ claimedTimeOut, remarks })`
   (`InternAttendance.jsx:177-194`) which calls **`attendanceService.submitClaim(recordId, claimedTimeOut, remarks)`**.

### 1.5 What data is submitted and what claim status is created

`attendanceService.submitClaim` (`src/services/attendanceService.js:132-163`):

1. Reads the row (`time_out, time_in, claim_status`).
2. Guards: record must exist; **if `time_out` set → error**; if `claim_status === "pending"` → error
   "You already have a pending claim"; if `claim_status === "approved"` → error. (Note: it does **not**
   check `"rejected"`.)
3. `UPDATE attendance SET claimed_time_out = <claimed ISO>, claim_status = 'pending', claim_remarks = <reason>`

So a claim creates status **`pending`** and stores the **claimed time-out** + the **reason**.

### 1.6 What happens after submitting

- Toast "Claim submitted. Awaiting supervisor approval.", form closes, `load()` re-runs.
- The History row now shows the amber **"Claim Pending"** badge (no more Claim button).
- The row is otherwise unchanged: `time_out` is still null, `total_hours` still 0, `status` still whatever it was (`present`).

---

**Files / functions:** `src/pages/intern/InternAttendance.jsx` (`load` 40-55, claim column 224-272,
`handleClaimSubmit` 177-194), `src/components/attendance/ClaimTimeOutForm.jsx`,
`src/services/attendanceService.js` (`submitClaim` 132-163).

---

## 2. Approval flow (supervisor)

The claim is reviewed from the **Supervisor Attendance** page
(`src/pages/supervisor/SupervisorAttendance.jsx`). Pending claims show a **"Review"** button
(lines 168-193) → `ReviewClaimModal.jsx` → `handleReview(decision, comment)`
(lines 74-134) → **`attendanceService.reviewClaim(recordId, decision, reviewerProfileId, comment)`**.

> Note: the **Admin** Attendance page (`src/pages/admin/AdminAttendance.jsx`) only shows the claim
> as a badge in its "Claim" column — it does **not** offer a Review action. Only a **supervisor**
> (of the assigned intern) can review through the UI.
>
> DB permission is granted by the RLS policy `supervisor reviews attendance claims`
> (`supabase/migrations/0034_missed_clockout_claim.sql:55-69`) — any UPDATE by a supervisor whose
> `intern_id` is one of their assigned interns.

`reviewClaim` (`src/services/attendanceService.js:173-227`) first reads
`time_out, time_in, claimed_time_out, claim_status`. Guards:
- record must exist;
- if no `claimed_time_out` → error "No claim exists for this attendance record.";
- if `claim_status !== "pending"` → error "This claim has already been reviewed."

It always writes: `claim_status = decision`, `claim_reviewed_by = reviewer id`,
`claim_reviewed_at = now`, `claim_review_comment = comment`, and if a comment was given it also
copies it into the row `remarks`.

### 2.1 When a claim is APPROVED

On `approved`, the patch additionally sets:

- **The old attendance record:** updated **in place** (same row `id`), not duplicated/deleted.
- **`time_out`:** set to the intern's **claimed_time_out** (`patch.time_out = existing.claimed_time_out`).
- **`total_hours`:** recomputed **`diffHours(time_in, claimed_time_out)`** (client-side math,
  `src/utils/format.js`).
- **`status`:** **not changed** — it stays whatever it was, i.e. `present` (set at Time In). Approval
  does **not** set `late`/`present`.
- **`method`:** set to **`'claimed'`**.
- **`claim_status`:** set to **`'approved'`**.
- `remarks` possibly set to the reviewer's comment.

Record now looks closed (`time_out` set, `total_hours` filled) with `method = 'claimed'`,
`claim_status = 'approved'`; History shows green "Claim Approved".

### 2.2 When a claim is REJECTED

On `rejected`, the patch additionally sets:

- **The old attendance record:** updated **in place**.
- **`time_out`:** **not set** — stays `null` (the record remains open).
- **`total_hours`:** **not recomputed** — stays `0` (the insert default).
- **`status`:** set to **`'absent'`** (`patch.status = "absent"`).
- **`claim_status`:** set to **`'rejected'`**.
- `method`: **not changed** — stays `'manual'`.
- `remarks` possibly set to the reviewer's comment.

**Can the intern still take action on that record?**
- **Via the UI:** No. The History row now shows the red "Claim Rejected" badge (line 233-234 returns
  before the claim-button branch), so there is no Claim button and no Time Out button for that
  previous-day row.
- **Via the service (code-level):** `submitClaim` only blocks `pending` and `approved`; it does **not**
  block `"rejected"` when `time_out` is still null, so a *code* call could technically resubmit. But
  **no UI element exposes that**, so in practice the intern cannot re-claim a rejected record.

### 2.3 After review (both outcomes)

- Supervisor gets toast "Claim approved. Time out recorded." / "Claim rejected." and the list reloads.
- A notification is sent to the intern (`attendance_update` type) with the decision
  (`SupervisorAttendance.jsx:105-120`), and an audit log is written (`recordAudit`).
- On approval, `time_out` and `total_hours` are now set, so the record is no longer counted as open.


---

## 3. NEXT-DAY scenario — can yesterday's Claim and today's Time In coexist?

Scenario: intern was timed in **yesterday**, forgot to time out (yesterday's record is OPEN), logs in
**today**, and needs to (a) Claim yesterday's missed time-out, and (b) Time In today, and later
(c) Time Out today.

### 3.1 How the code separates the two records

- Yesterday's open record: `date = yesterday`, `time_in` set, `time_out = null`.
- Today's record: a **different** row with `date = today`.

The separation is enforced by:

1. **`open` (the editable record) is ONLY today's row.**
   `load()` runs `attendanceService.getToday(internId)` (`attendanceService.js:40-51`) which filters
   `.eq("date", today)`, then `setOpen(todayRecord && !todayRecord.time_out ? todayRecord : null)`
   (`InternAttendance.jsx:48`). So `open` can never be yesterday's row.
2. **`timeIn()` only checks today's date.**
   `timeIn` (`attendanceService.js:53-88`) checks for an existing row with `.eq("date", today)`; an
   open **yesterday** row has a different date and does **not** trigger the "already submitted" error.
3. **The unique index is per (intern_id, date).**
   `attendance_unique_per_day (intern_id, date)` (`0005_one_attendance_per_day.sql`) — yesterday and
   today are different dates, so today's INSERT cannot collide with yesterday's open row.

### 3.2 The exact sequence the intern can perform today

1. **Claim yesterday** — find yesterday's OPEN row in the History table → "Claim Time Out" button
   (yesterday's date ≠ today, not `open`, no claim yet) → submit → yesterday's row gets
   `claim_status = 'pending'`.
2. **Time In today** — the main card still shows the **"Time In"** button (because `open`/`todayRec`
   refer only to today, which has no record yet) → `timeIn` inserts a new row for **today's** date.
   This is **not** blocked by yesterday's open row or by the pending claim.
3. **Time Out today** — later, `open` is today's row → **"Time Out"** button → `timeOut` updates
   **today's** row's `time_out`/`total_hours`. Yesterday's claim row is untouched.

### 3.3 Result

Yesterday's Claim and today's Time In/Time Out operate on **different rows, different dates, and
different service functions** (`submitClaim` vs `timeIn`/`timeOut`). There is **no conflict or
blocking** between them in the current code.


---

## 4. The Claim button — detailed answers

- **Why it appears:** for a **previous-day (or today-past-5PM)** attendance row that has `time_in`
  but **no `time_out`** and **no claim status** — i.e. an open record the intern can no longer time
  out normally.
- **Which record it is attached to:** the specific open History row (`r.id`); for the desired
  next-day flow that is **yesterday's** open record.
- **What makes it clickable:** previous-day date (or today after 5 PM local) + `time_out` is null +
  no `claim_status` + the row is **not** the currently-open editable record (`open?.id !== r.id`).
- **What prevents it from being clicked (shown):**
  - the row already has `claim_status` pending/approved/rejected → badge only;
  - the row has a `time_out` (closed) → "—";
  - the row **is** the currently open record → "—";
  - the row is **today** and it is still **before 5 PM** → "—".
- **Whether claiming yesterday blocks today's Time In:** **No.** `submitClaim` writes only to
  yesterday's row; `timeIn` checks only today's date.
- **Whether today's Time In is independent from yesterday's Claim:** **Yes.** Different rows, dates,
  and functions.
- **Whether the UI correctly shows both actions when appropriate:** **Yes.** When the intern returns
  today (yesterday's record open, no today record), the main card shows **Time In** while the History
  table shows **Claim Time Out** on yesterday's row. Both are visible/usable at the same time.

### 4.1 Any behavior that could interfere with the desired scenario

- The **Claim button lives in the History table**, not the main "Today" card — the intern must
  scroll to the History section to find/claim yesterday's open record (cosmetic, not a blocker).
- The main card's "Previous day" hint (`InternAttendance.jsx:295-299`) is effectively unreachable in
  normal operation, because `open` is always today's record — but this does not prevent the claim.
- A **rejected** claim leaves `time_out` null and gives no UI path to re-claim or to time out that
  previous-day row.
- The date/`today` comparisons mix UTC-derived dates with a **local** 5 PM cutoff (see the separate
  flow analysis in `ATTENDANCE_FLOW.md`) — which can mis-file a record near a day boundary, but does
  **not** couple yesterday's claim to today's time-in.

---

## Conclusion

**Can the intern claim yesterday while still timing in today?**

**Yes — based strictly on the current implementation.**

Yesterday's missed time-out (Claim) and today's Time In/Time Out are handled as **independent
attendance records**: different rows, different `date` values, different service functions
(`submitClaim` vs `timeIn`/`timeOut`), a per-`(intern_id, date)` unique index, and an `open` variable
that always refers to today only. The UI shows both actions at the same time when appropriate (Time
In on the card, Claim on yesterday's History row), and submitting/approving yesterday's claim does
not touch or block today's record.

The one thing to be aware of (not a blocker): the Claim button is only reachable from the History
table, and there is **no UI way to re-claim a rejected** record.

---

*End of analysis. No code was modified; nothing was implemented or redesigned.*

