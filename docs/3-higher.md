# 3 — Higher

Verify database consistency, then plan the frontend import cleanup.

---

## Task H4 — Cross-audit all migration files for remaining supervisor INSERT references

**Files to audit:**

| File | What to look for |
|---|---|
| `supabase/migrations/0002_rls.sql` | Any `"supervisor manages assigned interns"` policy on `public.interns` with INSERT scope |
| `supabase/migrations/0005_user_management.sql` | The `"supervisor creates interns"` INSERT-only policy. Confirm it is dropped in migration `0009`. |
| `supabase/migrations/0006_rbac_hardening.sql` | Already handled in Task F4. Verify the replacement was applied. |
| `supabase/migrations/0007_complete_schema_rbac.sql` | Check if it re-creates any supervisor INSERT policy on `public.interns`. |
| `DATABASE_SCHEMA.sql` | Already handled in Task F3. Verify the replacement was applied. |

### Expected state after all changes

Exactly these supervisor policies exist on `public.interns` across all files:

| Policy Name | Operation |
|---|---|
| `supervisor reads assigned interns` | SELECT |
| `supervisor modifies assigned interns` | UPDATE |
| `supervisor deletes assigned interns` | DELETE |

No supervisor INSERT policy exists anywhere.

### If mismatches found

Flag them for manual resolution. Do NOT silently overwrite files outside the original scope.

---

## Task H1 — Plan import pruning for `SupervisorInterns.jsx`

**File:** `src/pages/supervisor/SupervisorInterns.jsx`

After stripping the creation UI (Tasks F1–F2 in the next file), these imports will be unused. Identify them now so the Flash model can remove them mechanically.

| Remove | Source | Why |
|---|---|---|
| `useForm` | `react-hook-form` | Only used for creation form |
| `Button` | `@/components/ui/Button` | Only the "+ Add Intern" button |
| `{ Input }` | `@/components/ui/Input` | Only the create modal form |
| `SearchableSelect` | `@/components/ui/SearchableSelect` | Institution/program selectors |
| `{ userService }` | `@/services/userService` | Creating auth users for new interns |
| `{ institutionService }` | `@/services/institutionService` | Searching institutions in modal |
| `{ programService }` | `@/services/programService` | Searching programs in modal |
| `{ recordAudit, notify }` | `@/services/activityService` | Audit/notify on intern creation |
| `{ supervisorService }` | `@/services/supervisorService` | Only used inside `onSubmit` |

**Keep:**

| Import | Source | Why |
|---|---|---|
| `useEffect, useState, useCallback` | `react` | `load()` and `search` |
| `toast` | `react-hot-toast` | Error handling in `load()` |
| `PageHeader` | `@/components/ui/PageHeader` | Page title |
| `Card` | `@/components/ui/Card` | Layout wrapper |
| `Table` | `@/components/ui/Table` | Intern list |
| `Badge` | `@/components/ui/Badge` | Status display |
| `Spinner` | `@/components/ui/Spinner` | Loading state |
| `Modal` | `@/components/ui/Modal` | Detail view modal |
| `Avatar` | `@/components/ui/Avatar` | Detail view avatar |
| `{ internService }` | `@/services/internService` | `load()` |
| `{ useAuth }` | `@/contexts/AuthContext` | `profile, supervisorId, user` |
| `{ INTERN_STATUS_LABELS }` | `@/lib/constants` | Status Badge labels |
| `{ formatDate }` | `@/utils/format` | Table date columns |
