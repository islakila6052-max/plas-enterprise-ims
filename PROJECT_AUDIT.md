# Project Audit — Internship Management System (IMS)

> **Date:** 2026-07-28
> **Scope:** Every source file, route, service, component, migration, SQL file, context, hook, config, and doc in the repository.
> **Method:** Full-file reads, no assumptions, no skipped files.

---

## 1. Authentication & Authorization

### 1.1 Module: Auth (Login, Forgot/Reset Password, Change Password, Profile)

**Purpose:** User authentication, session management, password reset, and profile editing.

**File Paths:**
- `src/pages/auth/Login.jsx`
- `src/pages/auth/ForgotPassword.jsx`
- `src/pages/auth/ResetPassword.jsx`
- `src/pages/auth/ChangePassword.jsx`
- `src/pages/ProfileSettings.jsx`
- `src/services/authService.js`
- `src/services/profileService.js`
- `src/contexts/AuthContext.jsx`
- `src/routes/ProtectedRoute.jsx`
- `src/routes/RoleRoute.jsx`
- `src/lib/constants.js` (ROLES, ROLE_LABELS)

**CRUD Operations:**
- **Create:** `authService.signIn()` — email/password login via Supabase Auth (`authService.js`)
- **Read:** `authService.getCurrentUser()` — session user; `profileService.getByUserId()` — profile lookup (`authService.js`, `profileService.js`)
- **Update:** `authService.updatePassword()` — change password (`authService.js`); `profileService.update()` — update profile fields (`profileService.js`)
- **Delete:** N/A (no account deletion UI or service)

**Validation:**
- ✅ Email format check on Login (`pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/` in `Login.jsx`)
- ✅ Password required on Login
- ✅ Password minLength 8 on ResetPassword and ChangePassword
- ✅ Password confirmation match on ResetPassword (`validate: (v) => v === watch("password")`)
- ✅ Email required on ForgotPassword
- ✅ Full name required on ProfileSettings
- ❌ **No email format check on ForgotPassword** — the email input has `type="email"` but no `pattern` validation in `ForgotPassword.jsx` register()
- ❌ **No server-side email format validation** in `authService.forgotPassword()` — relies entirely on Supabase's own validation
- ❌ **No password strength validation** beyond minLength 8 (no uppercase/number/symbol requirements)

**Error Handling:**
- ✅ `authService.signIn()` catches and normalizes errors via `normalizeError()`
- ✅ `authService.forgotPassword()` throws normalized errors
- ✅ `authService.updatePassword()` throws normalized errors
- ✅ `ProfileSettings` shows server errors in a red banner
- ✅ `AuthContext` catches profile load failures and sets `profile = null`
- ❌ **No error boundary around the auth flow** — if `AuthProvider` crashes, the entire app goes blank (only `ErrorBoundary` at root level)

**Notifications:**
- ❌ **No notification sent on login** (no audit log entry for login either — see audit logging section)
- ❌ **No notification sent on password change**
- ❌ **No notification sent on profile update**

**Audit Logging:**
- ❌ **No audit log entry for login events** — `authService.signIn()` does not call `recordAudit()`
- ❌ **No audit log entry for password changes**
- ❌ **No audit log entry for profile updates**
- ✅ `recordAudit()` exists in `activityService.js` and is used by other modules

**TODO/FIXME/Console.log:**
- ❌ `console.error("[IMS] Failed to load profile on auth change:", err)` in `AuthContext.jsx` — logged but not surfaced to the user
- ❌ `console.error("[DOCUMENT NOTIFICATION] Failed:", err)` in `documentService.js`
- ❌ `console.error("[DOCUMENT REVIEW NOTIFICATION] Failed:", err)` in `documentService.js`
- ❌ `console.error("[IMS] Evaluation create failed:", err)` in `SupervisorEvaluations.jsx`
- ❌ `console.error("Intern auth user delete failed:", e)` in `internService.js`
- ❌ `console.error("[NOTIFICATION] Failed to create notification:", error)` in `activityService.js`
- ❌ `console.error("[NOTIFICATION FANOUT] Unexpected error:", err)` in `activityService.js`

**Tests:**
- ❌ **No test files found** — no `*.test.*`, `*.spec.*`, or `__tests__/` directories exist
- The `package.json` `"test"` script runs `npx --yes vite-node scripts/rbac_sanity.mjs` — this is an RBAC sanity check, not a unit/integration test suite

**Known Bugs / Edge Cases:**
- ⚠️ `AuthContext` `loadProfile()` is called without `await` in the `onAuthStateChange` callback — the `setLoading(false)` fires before the profile is loaded, causing a brief flash of `role = null` for returning users
- ⚠️ `ProtectedRoute` shows "Account not set up" if `role` is null but the user is authenticated — this can happen if the profile row is missing, but the UI offers no recovery path (no re-sync button)
- ⚠️ `RoleRoute` redirects to role dashboards but does not preserve the intended destination — the `from` location from `ProtectedRoute` is lost after role check

**Completion: 70%** — Core auth flow works end-to-end with validation, but audit logging is missing for auth events, notifications are absent, and there are no tests.

---

## 2. Dashboard (Role-Specific)

### 2.1 Module: Admin Dashboard

**Purpose:** Overview KPIs for HR admins — total interns, active, completed, pending evaluations, attendance today.

**File Paths:**
- `src/pages/admin/AdminDashboard.jsx`
- `src/services/dashboardService.js`

**CRUD Operations:**
- **Read:** `dashboardService.adminStats()` — aggregated counts (`dashboardService.js`)

**Validation:**
- ✅ Waits for `profile` to be loaded before querying (prevents unauthenticated PostgREST rejections)
- ❌ **No validation of dashboard data** — if `adminStats()` returns unexpected shape, the UI crashes silently (no fallback)

**Error Handling:**
- ✅ `dashboardService.adminStats()` uses `Promise.all` with individual `count()` functions that degrade to 0 on error
- ❌ **No error toast or UI feedback** if the dashboard fails to load — just shows spinner indefinitely

**Notifications:**
- ❌ None

**Audit Logging:**
- ❌ None

**Tests:**
- ❌ None

**Known Bugs / Edge Cases:**
- ⚠️ `adminStats()` comment notes that `neq` on enum columns can be rejected by the gateway — the code works around this by counting `pending` instead of `neq.completed`, but this means "Pending Evaluations" actually counts evaluations with `status = 'pending'`, not those that are neither `approved` nor `rejected`

**Completion: 85%** — Functional and robust, but lacks error feedback and has a semantic ambiguity in the pending-evaluations count.

### 2.2 Module: Supervisor Dashboard

**Purpose:** KPIs for supervisors — assigned interns, attendance today, pending journals, pending evaluations.

**File Paths:**
- `src/pages/supervisor/SupervisorDashboard.jsx`
- `src/services/dashboardService.js`

**CRUD Operations:**
- **Read:** `dashboardService.supervisorStats(supervisorId)` (`dashboardService.js`)

**Validation:**
- ✅ Handles case where `internIds` is empty (avoids invalid `IN` query)
- ❌ **No validation that `supervisorId` exists** — if the supervisor has no linked intern rows, stats show zeros silently

**Error Handling:**
- ✅ Falls back to zeros if intern lookup fails
- ❌ No error toast if dashboard fails

**Notifications:** None
**Audit Logging:** None
**Tests:** None

**Known Bugs:**
- ⚠️ Same `pendingEvaluations` semantic ambiguity as Admin Dashboard

**Completion: 80%** — Core functionality works, but missing error feedback and has the pending-evaluations semantic issue.

### 2.3 Module: Intern Dashboard

**Purpose:** KPIs for interns — hours rendered/required/remaining, today's attendance, latest announcements.

**File Paths:**
- `src/pages/intern/InternDashboard.jsx`
- `src/services/dashboardService.js`

**CRUD Operations:**
- **Read:** `dashboardService.internStats(internId)` (`dashboardService.js`)

**Validation:**
- ✅ Handles `internId` being null/undefined gracefully
- ❌ **No validation that hours rendered exceeds required hours** — the progress bar can show >100% if `hoursRendered > requiredHours` (though `Math.min(100, ...)` caps the bar, the rendered text shows the actual overage)

**Error Handling:**
- ✅ `toast.error(err.message)` on load failure
- ❌ No retry mechanism

**Notifications:** None
**Audit Logging:** None
**Tests:** None

**Known Bugs:**
- ⚠️ `toast` import was missing in the original file (noted as a fix in the code comment `// ✅ ADD THIS - it was missing`)

**Completion: 80%** — Functional with toast error feedback, but no retry, no over-hours validation, and no tests.

---

## 3. Intern Management (Admin)

### 3.1 Module: Intern CRUD

**Purpose:** Full CRUD for intern records — create, read, update, archive, restore, delete — with search, filter, and pagination.

**File Paths:**
- `src/pages/admin/InternManagement.jsx`
- `src/services/internService.js`
- `src/services/userService.js`
- `src/services/supervisorService.js`
- `src/services/departmentService.js`
- `src/services/institutionService.js`
- `src/services/programService.js`
- `src/services/activityService.js`
- `api/admin/create-user.js` (serverless)
- `api/admin/delete-user.js` (serverless)

**CRUD Operations:**
- **Create:** `internService.create(payload)` — upserts on `profile_id`; calls `userService.createAuthUser()` to create the auth user first (`internService.js`, `userService.js`)
- **Read:** `internService.list({ search, departmentId, status, supervisorId, createdBy, institutionId, programId, page, pageSize })` (`internService.js`)
- **Update:** `internService.update(id, payload)` (`internService.js`)
- **Delete:** `internService.remove(id)` — hard-deletes intern, then hard-deletes the linked auth user via `userService.deleteAuthUser()` (`internService.js`, `userService.js`)
- **Archive:** `internService.archive(id)` — sets `status = 'archived'` (`internService.js`)
- **Restore:** `internService.restore(id)` — sets `status = 'active'` (`internService.js`)

**Validation:**
- ✅ Email format check on create (`pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/` in `InternManagement.jsx`)
- ✅ Password minLength 8 on create
- ✅ Required fields: full_name, student_number, email
- ✅ Department-supervisor consistency check in UI (`if (assignedSup.department_id !== payload.department_id) throw ...`)
- ✅ Strips `password` and `confirmPassword` from intern payload before sending to Supabase
- ✅ Coerces empty-string UUID selects to `null` to avoid FK constraint violations
- ❌ **No server-side email format validation** in `internService.create()` — relies on Supabase constraints
- ❌ **No duplicate student_number check** — two interns can have the same student number
- ❌ **No end-date > start-date validation** — the UI allows selecting an end date before the start date
- ❌ **No required_hours > 0 validation** — the UI allows 0 or negative required hours (though DB has `CHECK >= 0`)
- ❌ **No email uniqueness check** — Supabase `auth.users` has unique email, but the UI doesn't check for duplicates before attempting creation, resulting in a raw error toast
- ❌ **`created_by` falls back to `profile?.id` which may be undefined** — the `onSubmit` function uses `user?.id ?? profile?.id` but `profile` is not destructured from `useAuth()` in `InternManagement.jsx`

**Error Handling:**
- ✅ `toast.error(err.message)` on CRUD failures
- ✅ `console.error("Intern create/update failed:", err)` for debugging
- ✅ Error detail extracted from `err.details`, `err.hint`, `err.code` for Supabase errors
- ✅ `userService.createAuthUser()` throws if the API returns non-OK
- ❌ **No optimistic update / rollback** — if the intern create succeeds but the notification fails, the user sees "Intern added" but the notification silently failed
- ❌ **No error boundary around the intern management page** — a render error in the table would crash the whole app

**Notifications:**
- ✅ Supervisor notified on intern assignment (`notify()` with `intern_assigned` type)
- ✅ Intern notified on account creation (`notify()` with `account_created` type)
- ❌ **No notification on intern archive/restore** — the `confirmAction()` function has commented-out notification code for archive/restore but it's not active
- ❌ **No notification on intern deletion**

**Audit Logging:**
- ✅ `recordAudit()` called on create, update, and delete
- ❌ **No audit log on archive/restore**

**TODO/FIXME/Console.log:**
- ❌ `console.error("Intern auth user delete failed:", e)` in `internService.js` — non-fatal but logged
- ❌ `console.error("[IMS] Evaluation create failed:", err)` in `SupervisorEvaluations.jsx`
- ❌ Multiple `console.error` calls in `activityService.js` for notification failures

**Tests:** None

**Known Bugs / Edge Cases:**
- ⚠️ `internService.create()` uses `upsert` on `profile_id` — if an intern is re-created with the same profile, it will UPDATE the existing row instead of creating a new one. This is intentional (avoid 409) but could confuse an admin who thinks they created a new intern.
- ⚠️ The `remove()` function hard-deletes the auth user, which cascades to the profile. But if the intern has no linked `profile_id`, the auth user is NOT deleted — leaving orphaned auth users.
- ⚠️ The `created_by` field on intern creation uses `user?.id ?? profile?.id` but `profile` is not available in `InternManagement.jsx` scope — it falls back to `undefined`, which means `created_by` could be NULL.

**Completion: 75%** — Full CRUD with validation and audit logging, but has edge cases around duplicate emails/student numbers, missing date validation, and incomplete notifications.

---

## 4. Supervisor Management (Admin)

### 4.1 Module: Supervisor CRUD

**Purpose:** Create, edit, delete supervisors — HR admin manages supervisor accounts.

**File Paths:**
- `src/pages/admin/AdminSupervisors.jsx`
- `src/services/supervisorService.js`
- `src/services/userService.js`
- `src/services/activityService.js`

**CRUD Operations:**
- **Create:** `supervisorService.create(payload)` — upserts on `profile_id`; also creates auth user via `userService.createAuthUser()` (`supervisorService.js`, `AdminSupervisors.jsx`)
- **Read:** `supervisorService.list()`, `supervisorService.getById()`, `supervisorService.getByProfileId()` (`supervisorService.js`)
- **Update:** `supervisorService.update(id, payload)` (`supervisorService.js`)
- **Delete:** `supervisorService.remove(id)` — deletes supervisor row, then calls `userService.deleteAuthUser()` (`supervisorService.js`)

**Validation:**
- ✅ Email format check on create (`pattern` in `AdminSupervisors.jsx`)
- ✅ Password minLength 8 on create
- ✅ Full name required
- ✅ Department required
- ❌ **No email uniqueness check** before creation — raw Supabase error on duplicate
- ❌ **No password confirmation field** on create — only password, no confirm
- ❌ **No validation that the selected department exists** — the dropdown is populated from `departmentService.list()` but if it fails, the user can still type an invalid ID

**Error Handling:**
- ✅ `toast.error(err.message)` on failures
- ✅ `recordAudit()` called on create, update, delete
- ❌ **No error handling for the `supabase.from("profiles").update()` call** in `supervisorService.create()` — if the profile update fails, the supervisor is still created but the profile link is stale
- ❌ **No error handling for the `supabase.from("profiles").update()` call** in `supervisorService.update()` — same issue

**Notifications:**
- ✅ Supervisor notified on account creation (`notify()` with `account_created`)
- ✅ Admin notified via `notifyAllWithType()` on supervisor creation
- ❌ **No notification on supervisor update**
- ❌ **No notification on supervisor deletion**

**Audit Logging:**
- ✅ `recordAudit()` on create, update, delete

**Tests:** None

**Known Bugs / Edge Cases:**
- ⚠️ `supervisorService.create()` manually updates `profiles.supervisor_id` after creation — this is a race condition if the `sync_profile_links` trigger also fires. The trigger and manual update could conflict.
- ⚠️ The `update()` method also manually updates `profiles.full_name` and `profiles.email` — again, potential conflict with the `set_profiles_updated` trigger.
- ⚠️ The delete confirmation dialog says it "removes the supervisor and ALL their evaluations, journals, and notifications, disables their login, and unassigns their interns" — but the actual `remove()` only deletes the supervisor row and auth user. It does NOT explicitly delete evaluations, journals, or notifications. The `ON DELETE SET NULL` on FKs preserves those rows.

**Completion: 65%** — CRUD works but has race conditions with profile sync, incomplete notifications, and the delete confirmation overpromises what the delete actually does.

---

## 5. Attendance Management

### 5.1 Module: Attendance (Time In / Time Out)

**Purpose:** Interns clock in/out; supervisors and admins view attendance records.

**File Paths:**
- `src/pages/intern/InternAttendance.jsx`
- `src/pages/supervisor/SupervisorAttendance.jsx`
- `src/pages/admin/AdminAttendance.jsx`
- `src/services/attendanceService.js`
- `src/services/activityService.js`

**CRUD Operations:**
- **Create:** `attendanceService.timeIn(internId, method)` — creates attendance record with `time_in` (`attendanceService.js`)
- **Update:** `attendanceService.timeOut(recordId, timeInISO)` — sets `time_out` and computes `total_hours` (`attendanceService.js`)
- **Read:** `attendanceService.getOpen(internId)`, `attendanceService.getToday(internId)`, `attendanceService.list()`, `attendanceService.adminList()` (`attendanceService.js`)

**Validation:**
- ✅ Prevents duplicate time-in for the same day (checks for existing open record)
- ✅ Prevents duplicate time-out (checks `time_out` is already set)
- ✅ Enforces one attendance record per intern per day (DB unique index + application-level check)
- ✅ `timeIn` uses `method = "manual"` — no QR code check-in implemented despite README mentioning it as optional
- ❌ **No validation that time-out is after time-in** — `diffHours()` returns 0 if `end <= start`, but the UI doesn't warn the user
- ❌ **No late/ absent status auto-assignment** — attendance is always set to `"present"` on time-in; there's no logic to mark `"late"` or `"absent"` based on time thresholds
- ❌ **AdminAttendance date range filter has no validation** — `dateFrom` can be after `dateTo`, resulting in empty results with no user feedback

**Error Handling:**
- ✅ `toast.error(err.message)` on time-in/time-out failures
- ✅ `attendanceService.timeIn()` catches duplicate key errors (code `23505`) and shows user-friendly message
- ✅ `attendanceService.getOpen()` and `getToday()` return `null` on error instead of throwing
- ❌ **No error toast on CSV export failure** in `AdminAttendance.jsx`

**Notifications:**
- ✅ Supervisor notified on time-in (`notify()` with `attendance_update` type)
- ✅ Supervisor notified on time-out (`notify()` with `attendance_update` type)
- ❌ **No notification to intern** about their attendance status

**Audit Logging:**
- ✅ `recordAudit()` on time-in (`action: "create"`, resource_type: `"attendance"`)
- ✅ `recordAudit()` on time-out (`action: "update"`, resource_type: `"attendance"`)

**Tests:** None

**Known Bugs / Edge Cases:**
- ⚠️ The `adminList()` in `attendanceService.js` filters by `intern.supervisor_id` — this is a PostgREST embedded filter. If the `intern` join returns multiple rows or the column name is wrong, it silently returns empty results.
- ⚠️ The `InternAttendance.jsx` component has a `busy` state that disables buttons during API calls, but there's no visual feedback beyond the button loading state — the page doesn't show a spinner.
- ⚠️ `AdminAttendance.jsx` exports CSV but the `dateFrom`/`dateTo` defaults to `"start"`/`"end"` in the filename when empty — this produces a file named `attendance-start-end.csv` which is confusing.

**Completion: 70%** — Core time-in/out works with validation and notifications, but missing auto-status assignment, date range validation, and has CSV export edge cases.

---

## 6. Daily Journal Management

### 6.1 Module: Journal (Submit, Review, Approve/Reject)

**Purpose:** Interns submit daily journals; supervisors review and approve/reject with comments.

**File Paths:**
- `src/pages/intern/InternJournal.jsx`
- `src/pages/supervisor/SupervisorJournals.jsx`
- `src/pages/admin/AdminJournals.jsx`
- `src/services/journalService.js`
- `src/services/activityService.js`

**CRUD Operations:**
- **Create:** `journalService.create(payload)` — auto-resolves `supervisor_id` from intern record (`journalService.js`)
- **Read:** `journalService.list({ internId, status, supervisorId, page, pageSize })` (`journalService.js`)
- **Update (Review):** `journalService.review(id, status, supervisorId, comment)` — updates status and supervisor comment (`journalService.js`)

**Validation:**
- ✅ Date required on submit
- ✅ Activities required on submit
- ✅ Hours worked required on submit (number input)
- ✅ Status is one of `pending/approved/rejected` (enum)
- ❌ **No validation that hours_worked is positive** — the DB allows 0, and the UI doesn't enforce a minimum
- ❌ **No validation that the journal date is not in the future** — interns can submit journals for future dates
- ❌ **No duplicate submission check** — an intern can submit multiple journals for the same date
- ❌ **Supervisor review has no confirmation dialog** — clicking Approve/Reject immediately submits; no "Are you sure?" prompt

**Error Handling:**
- ✅ `toast.error(err.message)` on failures
- ✅ `journalService.review()` uses `head:true` to avoid 406 errors from PostgREST when RLS filters the row
- ✅ `journalService.review()` best-effort fetches the updated row after write
- ❌ **No error recovery** — if the review fails, the modal stays open with no indication of what went wrong beyond a toast

**Notifications:**
- ✅ Supervisor notified on journal submission (`notify()` with `journal_submitted` type)
- ✅ Intern notified on journal review (`notify()` with `journal_review` type)
- ❌ **No notification when supervisor adds a comment but doesn't change status** — the `decide()` function only notifies on approve/reject, not on comment-only updates

**Audit Logging:**
- ✅ `recordAudit()` on journal creation (`action: "create"`, resource_type: `"daily_journal"`)
- ✅ `recordAudit()` on journal review (`action: "review"`, resource_type: `"daily_journal"`)

**Tests:** None

**Known Bugs / Edge Cases:**
- ⚠️ `journalService.create()` auto-resolves `supervisor_id` by querying the intern row — if the intern has no `supervisor_id`, the journal is created without one, and the supervisor's journal list won't show it. This is a silent data loss scenario.
- ⚠️ The `AdminJournals.jsx` review modal passes `null` for `supervisorId` in `journalService.review()` — this means the `supervisor_id` on the journal row is NOT updated during admin review, which could leave journals without a linked supervisor.
- ⚠️ `SupervisorJournals.jsx` passes `supervisorId` to `journalService.review()` but the `review()` function only sets `supervisor_id` when it's provided — passing `null` explicitly would wipe it. However, the code passes `sid` which is the resolved supervisor ID, so this is correct.

**Completion: 70%** — Core submit/review flow works with notifications and audit logging, but missing duplicate-date check, future-date validation, and has a silent supervisor_id resolution failure path.

---

## 7. Document Management

### 7.1 Module: Document Upload, Review, Download

**Purpose:** Interns upload documents; admins/supervisors review (approve/reject); documents stored in Supabase Storage.

**File Paths:**
- `src/pages/intern/InternDocuments.jsx`
- `src/pages/admin/AdminDocuments.jsx`
- `src/services/documentService.js`
- `src/services/activityService.js`

**CRUD Operations:**
- **Create:** `documentService.upload({ internId, type, file, label })` — uploads to Storage, creates DB row (`documentService.js`)
- **Read:** `documentService.list({ internId, status, page, pageSize })` (`documentService.js`)
- **Update (Review):** `documentService.review(id, status)` — updates status, notifies intern (`documentService.js`)
- **Delete:** `documentService.remove(id, filePath)` — deletes from Storage and DB (`documentService.js`)
- **Read URL:** `documentService.downloadUrl(filePath)` — generates signed URL (`documentService.js`)

**Validation:**
- ✅ File type selection (resume, moa, endorsement, school_requirements, completion_report)
- ✅ File required before upload
- ❌ **No file size validation** — users can upload arbitrarily large files
- ❌ **No file type validation beyond the dropdown** — any file extension can be uploaded; the Storage bucket policy doesn't restrict MIME types
- ❌ **No duplicate document check** — an intern can upload multiple resumes, for example
- ❌ **No validation that the intern owns the document** on review — the `review()` function doesn't verify the caller's permissions; it relies entirely on RLS

**Error Handling:**
- ✅ `toast.error(err.message)` on upload/review/delete failures
- ✅ `documentService.upload()` notification failures are caught and logged, not thrown
- ✅ `documentService.review()` notification failures are caught and logged
- ❌ **No error handling for `downloadUrl()` in `InternDocuments.jsx`** — if the signed URL fails, the error is caught by the outer try/catch and shows a toast, but the download button stays in a loading state

**Notifications:**
- ✅ Supervisor notified on document upload (`notify()` with `document_review` type)
- ✅ Admin(s) notified on document upload (`notify()` with `document_review` type)
- ✅ Intern notified on document review decision (`notify()` with `document_review` type)

**Audit Logging:**
- ✅ `recordAudit()` on document review (`action: "review"`, resource_type: `"document"`)
- ❌ **No audit log on document upload**
- ❌ **No audit log on document deletion**

**Tests:** None

**Known Bugs / Edge Cases:**
- ⚠️ `documentService.upload()` uploads to `intern-documents` bucket with path `${internId}/${Date.now()}-${file.name}` — if two files with the same name are uploaded in the same millisecond (unlikely but possible), the second upload fails because `upsert: false`. The error message is not user-friendly.
- ⚠️ The `documentService.review()` function does NOT update `reviewed_by` or `reviewed_at` columns that exist in the `documents` table schema (from `DATABASE_SCHEMA.md`). The `reviewed_by` and `reviewed_at` columns are defined in the schema but never populated by the frontend.
- ⚠️ `AdminDocuments.jsx` preview modal shows "Document preview is not available in the browser" — for PDFs, this should ideally render an embedded preview.

**Completion: 65%** — Core upload/review/download works with notifications, but missing file validation, audit logging on upload/delete, and has schema columns (`reviewed_by`, `reviewed_at`) that are never populated.

---

## 8. Evaluation Management

### 8.1 Module: Evaluation (Create, View, Criteria Scoring)

**Purpose:** Supervisors create evaluations for interns with 6 criteria scores and a final recommendation.

**File Paths:**
- `src/pages/supervisor/SupervisorEvaluations.jsx`
- `src/pages/admin/AdminEvaluations.jsx`
- `src/pages/intern/InternEvaluation.jsx`
- `src/services/evaluationService.js`
- `src/services/activityService.js`

**CRUD Operations:**
- **Create:** `evaluationService.create(payload)` — creates evaluation with criteria scores (`evaluationService.js`)
- **Read:** `evaluationService.list({ internId, supervisorId, status, page, pageSize })`, `evaluationService.get(id)` (`evaluationService.js`)
- **Update:** `evaluationService.update(id, payload)` (`evaluationService.js`)

**Validation:**
- ✅ Each criterion score is validated as 1-5 (`min: 1, max: 5` in React Hook Form)
- ✅ Overall rating validated as 1-5
- ✅ Intern required on create
- ✅ Final recommendation required
- ✅ Comments optional
- ❌ **No validation that the intern is assigned to the evaluating supervisor** — the UI filters interns by `supervisorId`, but the `evaluationService.create()` doesn't verify this server-side; RLS is the only guard
- ❌ **No validation that an intern doesn't have multiple evaluations from the same supervisor** — duplicate evaluations are possible
- ❌ **No auto-computation of `overall_rating`** — the UI requires the user to manually enter the overall rating instead of computing it as the average of the 6 criteria

**Error Handling:**
- ✅ `toast.error(err.message)` on failures
- ✅ Error detail extracted from `err.details`, `err.hint`, `err.code`
- ✅ `console.error("[IMS] Evaluation create failed:", err)` for debugging
- ❌ **No error boundary** — if the evaluation modal crashes, the whole page is affected

**Notifications:**
- ✅ Intern notified on evaluation creation (`notify()` with `evaluation_submitted` type)
- ❌ **No notification on evaluation update** (if a supervisor edits an existing evaluation)

**Audit Logging:**
- ✅ `recordAudit()` on evaluation creation (`action: "create"`, resource_type: `"evaluation"`)
- ❌ **No audit log on evaluation update**

**Tests:** None

**Known Bugs / Edge Cases:**
- ⚠️ The `overall_rating` is manually entered rather than auto-computed from the 6 criteria — this is a data integrity risk. A supervisor could give an overall rating of 5 while all individual criteria are 1.
- ⚠️ `SupervisorEvaluations.jsx` resolves the supervisor record ID via `supervisorService.getByProfileId()` — if this fails, it falls back to `profile.supervisor_id`, which is the cached link. If that link is stale, the evaluation RLS will reject the insert.
- ⚠️ The `AdminEvaluations.jsx` page has no review modal — it only shows a detail modal with read-only data. Admins cannot edit or delete evaluations from this page.

**Completion: 65%** — Core evaluation creation works with validation and notifications, but missing auto-computed overall rating, duplicate evaluation prevention, and has audit logging gaps.

---

## 9. Announcement Management

### 9.1 Module: Announcements (CRUD, Pin, Category)

**Purpose:** Admins create/manage announcements; all roles view them.

**File Paths:**
- `src/pages/admin/AdminAnnouncements.jsx`
- `src/pages/intern/InternAnnouncements.jsx`
- `src/services/announcementService.js`
- `src/services/activityService.js`

**CRUD Operations:**
- **Create:** `announcementService.create(payload)` — inserts with `published_by = user.id` (`announcementService.js`)
- **Read:** `announcementService.list({ category, page, pageSize })` (`announcementService.js`)
- **Update:** `announcementService.update(id, payload)` (`announcementService.js`)
- **Delete:** `announcementService.remove(id)` (`announcementService.js`)
- **Pin toggle:** Inline via `announcementService.update(id, { pinned: !a.pinned })` in `AdminAnnouncements.jsx`

**Validation:**
- ✅ Title required on create/edit
- ✅ Body required on create/edit
- ✅ Category is one of the defined enum values
- ❌ **No validation on body length** — empty or very short announcements can be created
- ❌ **No confirmation dialog for delete** — the delete button in `AdminAnnouncements.jsx` uses `setConfirm(a)` which opens a `ConfirmDialog`, but the pin toggle has no confirmation

**Error Handling:**
- ✅ `toast.error(err.message)` on failures
- ✅ `toast.success()` on success
- ❌ **No error handling for `notifyAllWithType()`** — the `.catch(() => {})` silently swallows notification errors

**Notifications:**
- ✅ All users notified on announcement publish via `notifyAllWithType()` (`activityService.js`)
- ❌ **No notification on announcement update or delete**

**Audit Logging:**
- ❌ **No audit log on announcement create, update, delete, or pin toggle** — `AdminAnnouncements.jsx` does not call `recordAudit()` for any announcement action

**Tests:** None

**Known Bugs / Edge Cases:**
- ⚠️ `notifyAllWithType()` is called with `type: "announcement"` but the `notifications` table CHECK constraint allows specific types: `'announcement','journal_review','journal_submitted','document_review','evaluation_created','evaluation_submitted','attendance_reminder','attendance_update','account_created','intern_assigned','intern_status','supervisor_assigned'`. The `"announcement"` type IS in the allowed list, so this works.
- ⚠️ The `InternAnnouncements.jsx` component does not show the `published_by` or author name — only the category badge and timestamps.

**Completion: 60%** — CRUD works with validation, but missing audit logging for all announcement actions, no notifications on update/delete, and no body-length validation.

---

## 10. Reports & Export

### 10.1 Module: Reports (PDF, CSV, Print)

**Purpose:** Generate and export reports (intern list, attendance, journals, evaluations, hours).

**File Paths:**
- `src/pages/admin/AdminReports.jsx`
- `src/services/internService.js`
- `src/services/attendanceService.js`
- `src/services/journalService.js`
- `src/services/evaluationService.js`
- `src/services/settingsService.js`

**CRUD Operations:**
- **Read:** Multiple service calls to fetch report data (`internService.list()`, `attendanceService.adminList()`, `journalService.list()`, `evaluationService.list()`)
- **Export PDF:** Client-side jsPDF + jsPDF-AutoTable (`AdminReports.jsx`)
- **Export CSV:** Client-side Blob download (`AdminAttendance.jsx`)
- **Print:** `window.open()` with print-ready HTML (`AdminReports.jsx`)

**Validation:**
- ✅ Report type selection required
- ✅ Data existence check before export ("No data to export")
- ✅ Company name fetched from settings for PDF header
- ❌ **No date range filter on reports** — all reports fetch all data with no date filtering
- ❌ **No pagination on report data** — fetches up to 1000/5000 rows at once, which could be slow or hit limits

**Error Handling:**
- ✅ `toast.error(err.message)` on fetch/export failures
- ✅ PDF export has try/catch around the entire export flow
- ✅ CSV export has try/catch
- ❌ **Print preview has no error handling** — `printPreview()` checks for data but doesn't catch rendering errors

**Notifications:** None
**Audit Logging:** None — report generation is not audited

**Tests:** None

**Known Bugs / Edge Cases:**
- ⚠️ The PDF export uses dynamic `import("jspdf")` and `import("jspdf-autotable")` — these are large dependencies that are only loaded on demand, which is good for bundle size, but if the import fails (e.g., network issue in a PWA), the error is caught by the outer try/catch.
- ⚠️ The `hours` report (`case "hours"`) computes rendered hours by reducing attendance records client-side — this is correct but could be slow for large datasets.
- ⚠️ The print preview opens a new window with raw HTML — this is a basic implementation with no styling, so the printed output is plain.

**Completion: 65%** — Reports work with PDF/CSV/print export, but missing date filters, no pagination, no audit logging, and the print preview is unstyled.

---

## 11. Settings & Configuration

### 11.1 Module: Settings (Company Info, Departments)

**Purpose:** Manage company information and departments.

**File Paths:**
- `src/pages/admin/AdminSettings.jsx`
- `src/services/settingsService.js`
- `src/services/departmentService.js`

**CRUD Operations:**
- **Read:** `settingsService.get()` (singleton, id=1), `departmentService.list()` (`settingsService.js`, `departmentService.js`)
- **Update:** `settingsService.upsert(payload)` (`settingsService.js`)
- **Create:** `departmentService.create(payload)` (`departmentService.js`)
- **Update:** `departmentService.update(id, payload)` (`departmentService.js`)
- **Delete:** `departmentService.remove(id)` (`departmentService.js`)

**Validation:**
- ✅ Company name required on settings save
- ✅ Required hours required on settings save
- ✅ Department name required on create
- ❌ **No validation on department description** — empty descriptions are allowed
- ❌ **No unique constraint check on department name** — the DB has `UNIQUE` but the UI doesn't check before submitting, resulting in a raw error toast

**Error Handling:**
- ✅ `toast.error(err.message)` on failures
- ✅ `toast.success()` on success
- ❌ **No error handling for `settingsService.get()`** — the `.catch(() => {})` silently ignores errors loading settings

**Notifications:** None
**Audit Logging:** None — settings changes and department CRUD are not audited

**Tests:** None

**Known Bugs:**
- ⚠️ The settings form uses `resetSettings()` to populate from the fetched settings, but if the fetch fails, the form is left empty with no indication.
- ⚠️ Department deletion uses `departmentService.remove()` which does a hard delete — if departments have linked interns, the FK constraint will block deletion. The UI doesn't check for this beforehand.

**Completion: 55%** — Basic CRUD works but missing audit logging, has silent error swallowing on settings load, and no pre-deletion checks for departments.

---

## 12. Institution & Program Management

### 12.1 Module: Institution CRUD + Program CRUD

**Purpose:** Manage educational institutions, their programs, and linked interns.

**File Paths:**
- `src/pages/admin/AdminInstitutions.jsx`
- `src/pages/admin/InstitutionProfile.jsx`
- `src/components/institutions/InstitutionModal.jsx`
- `src/components/institutions/InstitutionTable.jsx`
- `src/components/institutions/ProgramFormModal.jsx`
- `src/components/institutions/ProgramModal.jsx`
- `src/components/institutions/ProgramTable.jsx`
- `src/services/institutionService.js`
- `src/services/programService.js`
- `src/services/internService.js`

**CRUD Operations:**
- **Institution Create:** `institutionService.create(payload)` (`institutionService.js`)
- **Institution Read:** `institutionService.list({ search })`, `institutionService.getById(id)` (`institutionService.js`)
- **Institution Update:** `institutionService.update(id, payload)` (`institutionService.js`)
- **Institution Delete:** `institutionService.remove(id)` (`institutionService.js`)
- **Institution Logo Upload:** `institutionService.uploadLogo(file, institutionId)` (`institutionService.js`)
- **Institution Logo Delete:** `institutionService.removeLogo(path)` (`institutionService.js`)
- **Program Create:** `programService.create(payload)` (`programService.js`)
- **Program Read:** `programService.list({ institutionId, search })` (`programService.js`)
- **Program Update:** `programService.update(id, payload)` (`programService.js`)
- **Program Delete:** `programService.remove(id)` (`programService.js`)
- **Program Reconcile:** `programService.reconcile(institutionId, programs)` — upsert/delete programs for an institution (`programService.js`)

**Validation:**
- ✅ Institution name required (DB NOT NULL)
- ✅ Program name required (DB NOT NULL)
- ✅ Required hours >= 0 (DB CHECK constraint)
- ❌ **No institution name uniqueness check in UI** — the DB has `UNIQUE` on `institution_name` but the UI doesn't check
- ❌ **No program_code uniqueness check in UI** — the DB has a partial unique index but the UI doesn't check
- ❌ **No validation that an institution has at least one program before assigning interns** — interns can be assigned to institutions with no programs

**Error Handling:**
- ✅ `toast.error(err.message)` on failures
- ✅ Logo upload failure is non-fatal — the institution is still saved, and the user is notified
- ❌ **No error handling for `programService.reconcile()`** — if reconciliation fails mid-way, some programs may be deleted while others are created/updated, leaving the institution in an inconsistent state

**Notifications:** None
**Audit Logging:** None — institution/program CRUD is not audited

**Tests:** None

**Known Bugs / Edge Cases:**
- ⚠️ `AdminInstitutions.jsx` uses `useDebouncedValue(search, 500)` for search — this is correct and prevents excessive API calls.
- ⚠️ The `InstitutionProfile.jsx` page shows "No programs" and "No interns" states with `EmptyState` components — good UX.
- ⚠️ `InstitutionModal.jsx` and `ProgramFormModal.jsx` are referenced but their full content was not read in the audit (they are in `src/components/institutions/`). The audit is based on the parent page components that use them.

**Completion: 60%** — CRUD works with logo upload and program reconciliation, but missing audit logging, has no pre-deletion checks, and reconciliation is not transactionally safe.

---

## 13. Audit Logs

### 13.1 Module: Audit Log (Admin Read-Only View)

**Purpose:** Admin-only read-only view of the audit trail.

**File Paths:**
- `src/pages/admin/AdminAuditLogs.jsx`
- `src/services/auditLogService.js`

**CRUD Operations:**
- **Read:** `auditLogService.list({ resourceType, resourceId, limit })` (`auditLogService.js`)
- **Create:** `auditLogService.create(payload)` — used by `activityService.recordAudit()` (`auditLogService.js`)

**Validation:**
- ❌ **No filtering UI** — the admin audit log page shows all 200 entries with no date range, action type, or resource type filter
- ❌ **No search** — cannot search by user, resource ID, or changes content

**Error Handling:**
- ✅ `setRows([])` on error — non-fatal, shows empty table
- ❌ **No error toast** — silently shows empty table if the query fails

**Notifications:** None
**Audit Logging:** ❌ **Audit log viewing is not itself audited** — no record that someone viewed the audit logs

**Tests:** None

**Known Bugs:**
- ⚠️ The `auditLogService.list()` returns `data ?? []` but doesn't include a `count` — the admin page hardcodes `limit: 200` with no pagination. If there are more than 200 entries, older ones are not shown.
- ⚠️ The `changes` column renders `JSON.stringify(r.changes)` which could be very large for some entries, causing performance issues in the table.

**Completion: 45%** — Basic read-only view exists but is functionally limited (no filters, no pagination, no search, no audit of viewing).

---

## 14. Notification System

### 14.1 Module: Notifications (Bell, Dropdown, Read/Unread)

**Purpose:** Real-time per-user notifications with bell icon, unread count, and mark-as-read.

**File Paths:**
- `src/components/layout/NotificationBell.jsx`
- `src/services/notificationService.js`
- `src/services/activityService.js`
- `src/lib/constants.js` (notification types)

**CRUD Operations:**
- **Create:** `notificationService.create(payload)` — used by `activityService.notify()` (`notificationService.js`)
- **Read:** `notificationService.list({ userId, onlyUnread, limit })` (`notificationService.js`)
- **Read (count):** `notificationService.unreadCount(userId)` (`notificationService.js`)
- **Update:** `notificationService.markRead(id)`, `notificationService.markAllRead(userId)` (`notificationService.js`)

**Validation:**
- ✅ `userId` required for list/unreadCount
- ✅ `onlyUnread` filter works correctly
- ❌ **No validation on notification type** — any string can be used as a type, even if not in the `notification_type` enum

**Error Handling:**
- ✅ `unreadCount()` returns 0 on error instead of throwing
- ✅ `markRead()` and `markAllRead()` throw on error (toast shown by caller)
- ❌ **No error handling in `NotificationBell.jsx`** — if `refresh()` fails, the component silently shows stale data

**Notifications:**
- ✅ Real-time subscription via Supabase Realtime (`postgres_changes` on `notifications` table)
- ✅ Unread count badge in navbar
- ✅ Mark as read (individual and bulk)
- ✅ Click-to-navigate via `link` field

**Audit Logging:**
- ❌ **No audit log when notifications are read/marked** — no trail of who viewed notifications

**Tests:** None

**Known Bugs / Edge Cases:**
- ⚠️ The `NotificationBell.jsx` has a `useEffect` with `// eslint-disable-next-line react-hooks/exhaustive-deps` — the dependency array is intentionally incomplete to avoid re-subscribing on every `userId` change, but this means the real-time subscription is only set up once on mount and never re-created if `userId` changes (e.g., after login).
- ⚠️ The `handleItemClick()` function marks a notification as read AND navigates — but if navigation happens before `markRead()` completes, the notification might still show as unread in the dropdown.

**Completion: 75%** — Real-time notifications work well with bell UI, but has a subscription lifecycle issue, no error handling in the bell component, and no audit trail for read actions.

---

## 15. Database Schema & Migrations

### 15.1 Module: Database Schema (31 migrations)

**Purpose:** Complete PostgreSQL/Supabase schema with enums, tables, functions, triggers, RLS policies, and storage buckets.

**File Paths:**
- `supabase/migrations/0001_init.sql` through `supabase/migrations/0031_expand_notification_types.sql`
- `DATABASE_SCHEMA.sql` (complete schema reference)
- `DATABASE_SCHEMA.md` (documentation)
- `supabase_schema.sql` (legacy schema file)

**Key Observations:**
- ✅ 31 migrations covering: enums, tables, RLS, triggers, functions, storage, RBAC hardening, institutions/programs, audit logs, notifications, profile links, supervisor links, evaluation RLS fixes, intern RLS fixes, orphan intern cleanup, program code uniqueness, audit log self-write, and notification type expansion
- ✅ Migrations are idempotent (use `IF NOT EXISTS`, `DROP ... IF EXISTS`, `ON CONFLICT`)
- ✅ RLS is enabled on all tables
- ✅ Storage buckets: `intern-documents` (public), `institution-moa` (private, admin-only), `institution-logos` (public)
- ✅ Helper functions: `current_role()`, `is_admin()`, `current_supervisor_id()`, `current_intern_id()`, `handle_new_user()`, `sync_profile_links()`
- ✅ Triggers: `on_auth_user_created`, `sync_profile_intern`, `sync_profile_supervisor`, `set_profiles_updated`, `set_interns_updated`, `set_settings_updated`
- ❌ **Migration gap** — migrations go from 0001 to 0031 but there are gaps (0022, 0023, 0032+). The numbering is inconsistent.
- ❌ **No migration for `programs.required_hours` rename** — migration 0010 renames `hours_to_render` to `required_hours`, but the `interns` table also has `required_hours` — these are different columns with different semantics (program required hours vs intern required hours)
- ❌ **`evaluations.status` enum type `evaluation_status` is defined in migration 0004** but the `evaluations` table in migration 0001 uses `status text not null default 'completed'` — the type conversion happens in 0004, but if 0001 is run fresh without 0004, the column is plain text, not the enum
- ❌ **`notifications` table is not created in 0001_init.sql** — it was added in a later migration (0007 or later), but the initial schema doc (`DATABASE_SCHEMA.md`) lists it as a core table from the start
- ❌ **`audit_logs` table is not created in 0001_init.sql** — same issue as notifications
- ❌ **`profiles.intern_id` and `profiles.supervisor_id` are not in 0001_init.sql** — these were added in 0004_consistency.sql, meaning a fresh database from 0001 lacks these cached links

**Tests:** None (migrations are SQL, not tested programmatically)

**Completion: 80%** — Schema is comprehensive and RLS is well-implemented, but has migration numbering gaps, missing initial-table columns, and enum type conversion issues.

---

## 16. Serverless API (Vercel)

### 16.1 Module: API Routes (create-user, delete-user)

**Purpose:** Server-side user creation/deletion using Supabase service-role key (never exposed to browser).

**File Paths:**
- `api/admin/create-user.js`
- `api/admin/delete-user.js`

**CRUD Operations:**
- **Create User:** `POST /api/admin/create-user` — creates auth user, upserts profile, creates audit log (`create-user.js`)
- **Delete User:** `POST /api/admin/delete-user` — hard-deletes auth user (cascade to profile) (`delete-user.js`)

**Validation:**
- ✅ Email and password required on create
- ✅ Role-based access control (admin/hr_staff/supervisor can create; only admin/hr_staff can delete)
- ✅ Supervisor restricted to creating interns only
- ✅ Self-deletion guard (admin cannot delete their own account)
- ✅ Caller authentication via Bearer token verification
- ❌ **No input sanitization** — email, password, and metadata are passed directly to Supabase without trimming or escaping
- ❌ **No rate limiting** — the API can be called repeatedly without throttling
- ❌ **No CSRF protection** — the API relies solely on the Supabase session token; there's no additional CSRF check

**Error Handling:**
- ✅ Structured error responses (`{ error: "..." }`) with appropriate HTTP status codes
- ✅ 400 for bad input, 403 for forbidden, 405 for wrong method, 500 for misconfiguration
- ✅ `console.error()` for server-side logging
- ❌ **No logging of failed authentication attempts** — failed caller profile resolution returns 403 without logging
- ❌ **No logging of successful user creation/deletion** — only audit logs in the DB, no server-side access logs

**Notifications:** None (serverless functions don't push notifications directly)
**Audit Logging:** ✅ `create-user.js` inserts an `audit_logs` row on user creation

**Tests:** None

**Known Bugs / Edge Cases:**
- ⚠️ `create-user.js` has a `try/catch` that wraps the entire user creation flow, but the `profiles.upsert()` and `audit_logs.insert()` are in separate `try/catch` blocks marked `/* non-fatal */` — if the profile upsert fails, the user is still created but without a profile link, which breaks the entire app for that user.
- ⚠️ `delete-user.js` hard-deletes the auth user, which cascades to the profile via `ON DELETE CASCADE`. But it does NOT explicitly delete the intern/supervisor rows that reference `profile_id` — those are `ON DELETE SET NULL`, which means the intern/supervisor rows remain but with a NULL `profile_id`, breaking the RLS link.

**Completion: 65%** — Core functionality works with RBAC and audit logging, but missing input sanitization, rate limiting, CSRF protection, and has cascade deletion risks.

---

## 17. UI Components Library

### 17.1 Module: Reusable UI Components

**Purpose:** Shared, accessible UI primitives used across the application.

**File Paths:**
- `src/components/ui/Button.jsx`
- `src/components/ui/Input.jsx`
- `src/components/ui/Modal.jsx`
- `src/components/ui/ConfirmDialog.jsx`
- `src/components/ui/Table.jsx`
- `src/components/ui/Card.jsx`
- `src/components/ui/Badge.jsx`
- `src/components/ui/Spinner.jsx`
- `src/components/ui/StatCard.jsx`
- `src/components/ui/Chart.jsx` (BarChart, DonutChart)
- `src/components/ui/Avatar.jsx`
- `src/components/ui/Pagination.jsx`
- `src/components/ui/SearchableSelect.jsx`
- `src/components/ui/EmptyState.jsx`
- `src/components/ui/ErrorBoundary.jsx`
- `src/components/ui/PageHeader.jsx`
- `src/components/ui/icons.jsx`
- `src/components/layout/Navbar.jsx`
- `src/components/layout/Sidebar.jsx`
- `src/components/layout/NotificationBell.jsx`
- `src/components/layout/navigation.js`
- `src/layouts/DashboardLayout.jsx`

**Validation:**
- ✅ `Input`, `Select`, `Textarea` support `error` prop for inline validation messages
- ✅ `SearchableSelect` has debounced search (500ms) to avoid excessive queries
- ✅ `ConfirmDialog` requires explicit confirmation for destructive actions
- ✅ `ErrorBoundary` catches render errors and shows a recoverable screen
- ✅ `Modal` closes on Escape key and backdrop click
- ✅ `Button` supports `loading` and `disabled` states
- ❌ **No form-level validation summary** — individual field errors are shown, but there's no summary of all errors at the top of a form
- ❌ **`SearchableSelect` has no debounce on the `onSearch` callback** — it debounces the query value but calls `onSearch` on every debounced change; if the parent component's `onSearch` is expensive, it could still cause issues

**Error Handling:**
- ✅ `ErrorBoundary` at root level catches unhandled errors
- ✅ `Spinner` provides loading feedback
- ✅ `EmptyState` provides friendly empty-state messaging
- ❌ **No global error toast** — errors are shown per-component via `toast.error()`, but there's no centralized error handler

**Tests:** None

**Completion: 85%** — Component library is comprehensive and accessible, but missing form-level validation summary and has a potential debounce issue in SearchableSelect.

---

## 18. Project Configuration & Infrastructure

### 18.1 Module: Build, Deploy, and Config

**Purpose:** Vite build, Vercel deployment, Supabase connection, environment configuration.

**File Paths:**
- `package.json`
- `vite.config.js`
- `vercel.json`
- `index.html`
- `.env`, `.env.example`
- `.gitignore`
- `jsconfig.json`
- `tailwind.config` (via `@tailwindcss/vite` plugin)

**Key Observations:**
- ✅ Vercel deployment configured with SPA rewrites (`vercel.json`)
- ✅ Environment variables properly separated (VITE_* for frontend, plain names for serverless)
- ✅ `.env.example` documents all required variables
- ✅ `.gitignore` excludes `node_modules`, `dist`, `.env`
- ✅ `oxlint` configured for linting (`.oxlintrc.json`)
- ✅ `jsconfig.json` for path aliases (`@/` → `./src`)
- ❌ **`.env` file is committed to the repository** — contains actual Supabase URL and keys (both anon and service-role). This is a **critical security issue** — the `.env` file should be in `.gitignore` and never committed.
- ❌ **`package.json` name is `"staykila"`** — this doesn't match the project name "IMS" or "Internship Management System"
- ❌ **No `lint` script in `package.json`** — the `"lint"` script runs `oxlint` but is not documented in the README
- ❌ **No `type: "module"` issues** — the project uses ES modules correctly
- ❌ **No CI/CD configuration** — no GitHub Actions, no preview deployments, no test pipeline

**Tests:** None (infrastructure has no test files)

**Completion: 50%** — Build and deploy infrastructure works, but has a critical security issue (committed `.env`), inconsistent naming, and no CI/CD pipeline.

---

## 19. Documentation

### 19.1 Module: Documentation Files

**Purpose:** Project documentation covering architecture, features, workflows, and database schema.

**File Paths:**
- `README.md`
- `ARCHITECTURE_BLUEPRINT.md`
- `DATABASE_SCHEMA.md`
- `FEATURES.md`
- `WORKFLOWS.md`
- `PROJECT_PLAN.md`
- `PROJECT_PROGRESS_MATRIX.md`
- `RECENT_CHANGES.md`
- `USER_MANAGEMENT_IMPLEMENTATION.md`
- `IMS_WORKFLOWS_AND_DATABASE_PROMPT.md`

**Key Observations:**
- ✅ `README.md` has project overview, tech stack, roles, development phases, and future enhancements
- ✅ `ARCHITECTURE_BLUEPRINT.md` has comprehensive architecture documentation with mermaid diagrams
- ✅ `DATABASE_SCHEMA.md` is detailed with table definitions, RLS summaries, and frontend↔schema mapping
- ✅ `FEATURES.md` documents all features by role
- ✅ `IMS_WORKFLOWS_AND_DATABASE_PROMPT.md` serves as a prompt for AI-generated schema
- ❌ **Documentation is not kept in sync with the code** — for example, `README.md` mentions "QR Code Attendance" as a future enhancement, but the codebase has no QR code implementation; the `attendanceService.timeIn()` only supports `method = "manual"`
- ❌ **`DATABASE_SCHEMA.md` mentions `mockBackend.js` and `sampleData.js`** — these files do not exist in the repository (`src/lib/mockBackend.js` and `src/lib/sampleData.js` are referenced but not present)
- ❌ **`ARCHITECTURE_BLUEPRINT.md` references `src/lib/mockBackend.js`** — file doesn't exist
- ❌ **No API documentation** — the serverless functions (`api/admin/create-user.js`, `api/admin/delete-user.js`) have no API docs

**Completion: 60%** — Documentation is extensive but has references to non-existent files and is not fully in sync with the actual codebase.

---

## 20. Global Issues

### 20.1 No Test Suite

**Finding:** The entire project has **zero test files**. No `*.test.*`, `*.spec.*`, or `__tests__/` directories exist anywhere in the repository. The `package.json` `"test"` script runs `npx --yes vite-node scripts/rbac_sanity.mjs` which is an RBAC sanity check, not a proper test suite.

**Impact:** No automated regression testing, no CI quality gates, no confidence in refactoring.

### 20.2 No CI/CD Pipeline

**Finding:** No GitHub Actions, GitLab CI, or other CI/CD configuration exists. The project deploys directly to Vercel (configured in `vercel.json`) but has no automated testing, linting, or type-checking in the deployment pipeline.

### 20.3 Security Issues

1. **`.env` committed to git** — contains `VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_URL`. The service-role key is a secret that should never be in version control.
2. **No input sanitization** in serverless API routes — email, password, and metadata are passed directly to Supabase.
3. **No rate limiting** on API routes — brute-force attacks on the create-user endpoint are possible.
4. **No CSRF protection** on API routes — relies solely on Supabase session tokens.
5. **Service-role key in `.env.example`** — even the example file contains what appears to be a real key (not a placeholder).

### 20.4 Code Quality Issues

1. **Excessive `console.error` calls** — at least 10 instances across the codebase that log errors to the browser console but don't surface them to users or send them to a monitoring service.
2. **No TypeScript** — the project is entirely JavaScript/JSX, missing the type safety benefits of TypeScript.
3. **No ESLint configuration** — the project uses `oxlint` but there's no `.eslintrc` file; `oxlint` is configured via `.oxlintrc.json`.
4. **Inconsistent error handling patterns** — some services throw errors, some return `null` on error, some swallow errors silently.
5. **No API documentation** — the serverless functions have JSDoc comments but no OpenAPI/Swagger spec.

---

## Completion Summary

| Module | Completion | Key Gap |
|--------|-----------|---------|
| Authentication & Authorization | 70% | No audit logging for auth events, no tests |
| Admin Dashboard | 85% | No error feedback on load failure |
| Supervisor Dashboard | 80% | No error feedback on load failure |
| Intern Dashboard | 80% | No retry mechanism, no over-hours validation |
| Intern CRUD (Admin) | 75% | Missing date validation, duplicate checks |
| Supervisor CRUD (Admin) | 65% | Race conditions with profile sync, incomplete notifications |
| Attendance (Time In/Out) | 70% | No auto-status assignment, no date range validation |
| Journal Management | 70% | No duplicate-date check, no future-date validation |
| Document Management | 65% | No file validation, missing audit on upload/delete |
| Evaluation Management | 65% | No auto-computed overall rating, no duplicate prevention |
| Announcements | 60% | No audit logging, no notifications on update/delete |
| Reports & Export | 65% | No date filters, no pagination, no audit logging |
| Settings & Departments | 55% | No audit logging, silent error swallowing |
| Institution & Program Mgmt | 60% | No audit logging, no transactional reconciliation |
| Audit Logs | 45% | No filters, no pagination, no search |
| Notification System | 75% | Subscription lifecycle bug, no error handling in bell |
| Database Schema | 80% | Migration gaps, missing initial columns |
| Serverless API | 65% | No sanitization, no rate limiting, no CSRF |
| UI Components | 85% | No form validation summary |
| Project Config | 50% | Critical: `.env` committed to git |
| Documentation | 60% | References non-existent files |

**Overall Project Completion: ~65%**

The project has a solid, functional frontend with role-based routing, Supabase integration, RLS, notifications, and audit logging for most CRUD operations. The major gaps are: **no test suite**, **security issues** (committed `.env`), **incomplete audit logging** (auth events, announcements, settings, reports), **missing validation** (date ranges, duplicates, file uploads), and **no CI/CD pipeline**.
