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
