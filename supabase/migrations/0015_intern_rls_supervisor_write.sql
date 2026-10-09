-- ============================================================================
-- 0015 — Fix interns RLS so supervisors can create/manage interns
-- ============================================================================
-- DIAGNOSIS: the live interns policies did NOT match the intended design in
-- 0006_rbac_hardening.sql. Only two stray policies existed:
--   * interns_admin_write        (ALL, admin only)
--   * interns_supervisor_insert (INSERT only; with_check required
--         current_role() = 'supervisor' AND created_by = auth.uid())
-- GAPS this caused:
--   * No SELECT policy for supervisors -> they could not list their interns.
--   * The INSERT with_check did NOT permit supervisor_id =
--     current_supervisor_id(), so setting the supervisor on a new intern was
--   rejected -> "new row violates row-level security policy for table interns".
--   * No UPDATE/DELETE policy for supervisors.
--
-- FIX: drop the two stray policies and recreate the full, correct set that
-- mirrors 0006 (and is consistent with the evaluations fix in 0013/0014):
--   * SELECT: admin | own intern | assigned supervisor | created_by
--   * Supervisor INSERT/UPDATE/DELETE: supervisor_id = current_supervisor_id()
--     OR created_by = auth.uid()
--   * Admin: full
--   * Intern: own row only
-- Role isolation is preserved.
-- ============================================================================

-- 1. Remove the stray policies.
drop policy if exists "interns_admin_write" on public.interns;
drop policy if exists "interns_supervisor_insert" on public.interns;

-- 2. SELECT (read) policy.
drop policy if exists "interns readable" on public.interns;
create policy "interns readable"
  on public.interns for select to authenticated
  using (
    public.is_admin()
    or id = public.current_intern_id()
    or supervisor_id = public.current_supervisor_id()
    or created_by = auth.uid()
  );

-- 3. Admin full management.
drop policy if exists "admins manage interns" on public.interns;
create policy "admins manage interns"
  on public.interns for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 4. Intern reads/owns only their own row.
drop policy if exists "intern reads own row" on public.interns;
create policy "intern reads own row"
  on public.interns for select to authenticated
  using (id = public.current_intern_id());

-- 5. Supervisor manages assigned interns (INSERT/UPDATE/DELETE).
drop policy if exists "supervisor reads assigned interns" on public.interns;
create policy "supervisor reads assigned interns"
  on public.interns for select to authenticated
  using (supervisor_id = public.current_supervisor_id());

drop policy if exists "supervisor manages assigned interns" on public.interns;
create policy "supervisor manages assigned interns"
  on public.interns for all to authenticated
  using (
    supervisor_id = public.current_supervisor_id()
    or created_by = auth.uid()
  )
  with check (
    -- A supervisor can only manage interns assigned to THEIR OWN supervisor record,
    -- within THEIR OWN department, and recorded as created by themselves.
    -- This blocks cross-supervisor / cross-department assignment.
    -- For INSERT operations, allow setting supervisor_id and department_id as long as
    -- they match the supervisor's own record. For UPDATE operations, require that
    -- the existing row matches the supervisor's own record.
    (
      -- INSERT: allow setting supervisor_id and department_id if they match the supervisor's own
      TG_OP = 'INSERT' AND
      (
        (supervisor_id = public.current_supervisor_id() AND (department_id IS NULL OR department_id = public.current_supervisor_department_id()))
        OR
        (created_by = auth.uid() AND supervisor_id IS NULL AND department_id IS NULL)
      )
    ) OR (
      -- UPDATE/DELETE: require that the existing row matches the supervisor's own
      TG_OP != 'INSERT' AND
      supervisor_id = public.current_supervisor_id() AND
      department_id = public.current_supervisor_department_id() AND
      created_by = auth.uid()
    )
  );

-- 6. Reload PostgREST schema cache.
notify pgrst, 'reload schema';
