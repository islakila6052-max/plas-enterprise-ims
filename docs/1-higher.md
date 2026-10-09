# 1 — Higher

Database design comes first — it's the source of truth. Frontend depends on these being in place.

---

## Task H3 — Create new migration `0009_restrict_supervisor_create.sql`

**File (new):** `supabase/migrations/0009_restrict_supervisor_create.sql`

### Design decisions

1. **Which policies to drop:** The `"supervisor manages assigned interns"` policy (for ALL) from `0002_rls.sql` / `0006_rbac_hardening.sql`, and the `"supervisor creates interns"` INSERT-only policy from `0005_user_management.sql`. Both must be dropped before creating replacements.

2. **UPDATE `with check` scope:** Keep the existing constraint — supervisor must match both `supervisor_id` and `department_id`. This prevents a supervisor from reassigning an intern to a different department.

3. **DELETE scope:** Only `supervisor_id = current_supervisor_id()`. Do NOT include `created_by` — if an intern is reassigned to another supervisor, the original creator should not retain delete power.

4. **SELECT scope:** Include both `supervisor_id` and `created_by` so supervisors can still see interns they created even after reassignment. This matches the old SELECT behavior.

### SQL

```sql
-- ============================================================================
-- Restrict supervisor intern creation — admins only may INSERT interns.
-- ============================================================================
-- Supervisors retain SELECT, UPDATE, DELETE on their assigned interns.
-- INSERT is now exclusive to the "admins manage interns" policy.

-- Drop the old "for all" policy (INSERT-inclusive).
drop policy if exists "supervisor manages assigned interns" on public.interns;

-- Drop the old INSERT-only policy from 0005_user_management.sql.
drop policy if exists "supervisor creates interns" on public.interns;

-- Drop the old read-only policy (recreated below).
drop policy if exists "supervisor reads assigned interns" on public.interns;

-- Supervisor SELECT: assigned interns + those they created.
create policy "supervisor reads assigned interns"
  on public.interns for select to authenticated
  using (
    supervisor_id = public.current_supervisor_id()
    or created_by = auth.uid()
  );

-- Supervisor UPDATE: only assigned interns, same department.
create policy "supervisor modifies assigned interns"
  on public.interns for update to authenticated
  using (
    supervisor_id = public.current_supervisor_id()
  )
  with check (
    supervisor_id = public.current_supervisor_id()
    and department_id = public.current_supervisor_department_id()
  );

-- Supervisor DELETE: only assigned interns.
create policy "supervisor deletes assigned interns"
  on public.interns for delete to authenticated
  using (
    supervisor_id = public.current_supervisor_id()
  );
```

---

## Task H2 — Audit service/API layer for supervisor creation pathways

**Files to check:**
- `src/services/internService.js`
- `src/services/userService.js`
- `src/services/authService.js`
- `api/admin/create-user.*` (the serverless API route)

### internService.js

`internService.create()` uses `upsert` on `profile_id`. After RLS changes, a supervisor calling this will get a PostgREST error because no INSERT policy exists for supervisors. The function remains in use by admin's `InternManagement.jsx`. No code change needed.

### userService.js

`userService.createAuthUser()` calls `/api/admin/create-user`. The API endpoint already enforces admin-only access. No change needed.

### authService.js

No creation functionality. No change needed.

### Decision: No service-layer changes required.
