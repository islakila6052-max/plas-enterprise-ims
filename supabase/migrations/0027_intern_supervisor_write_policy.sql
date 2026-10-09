-- ============================================================================
-- 0027 — Restore + harden interns RLS so Supervisors can create interns
--        assigned to THEIR OWN supervisor record and THEIR OWN department.
-- ============================================================================
-- DIAGNOSIS:
--   The live interns RLS only had the admin ALL policy ("admins manage interns",
--   with_check is_admin()) plus SELECT policies. There was NO supervisor
--   INSERT/UPDATE/DELETE policy, so a Supervisor's insert failed with
--   "new row violates row-level security policy ... for table interns" (403).
--
--   Root cause: the canonical DATABASE_SCHEMA.sql (the file used to (re)build
--   the DB) omitted the "supervisor manages assigned interns" policy that the
--   migrations (0007/0015) intended. The only write policy that applied to a
--   Supervisor was the admin one, whose WITH CHECK (is_admin()) is false for a
--   supervisor -> RLS violation.
--
--   Additionally, the previous supervisor write design used
--       with check ( supervisor_id = current_supervisor_id()
--                    OR created_by = auth.uid() )
--   which is INSECURE: the OR let a supervisor insert an intern with ANY
--   supervisor_id / department_id as long as created_by = self. That violates
--   the requirement that a Supervisor may only create interns for their OWN
--   account and their OWN department.
--
-- FIX:
--   * Add a helper current_supervisor_department_id() for clarity/reuse.
--   * Create "supervisor manages assigned interns" with a STRICT with_check that
--     requires supervisor_id = own record AND department_id = own department AND
--     created_by = auth.uid(). This preserves isolation: a Supervisor cannot
--     assign an intern to another Supervisor or another department.
--   * Replace the over-permissive "interns readable" SELECT policy (using(true))
--     with the intended role-scoped SELECT (admin | own intern | assigned
--     supervisor | created_by).
--   * Keep "admins manage interns" (full) and "intern reads own row" intact so
--     HR/Admin functionality is unaffected.
-- ============================================================================

-- 0. Helper: the current user's supervisor department id.
create or replace function public.current_supervisor_department_id ()
  returns uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select s.department_id
  from public.supervisors s
  join public.profiles p on p.id = s.profile_id
  where p.id = auth.uid ();
$$;

-- 1. SELECT: role-scoped (replace the over-permissive using(true)).
drop policy if exists "interns readable" on public.interns;
create policy "interns readable"
  on public.interns for select to authenticated
  using (
    public.is_admin()
    or id = public.current_intern_id()
    or supervisor_id = public.current_supervisor_id()
    or created_by = auth.uid()
  );

-- 2. Supervisor write policy (INSERT/UPDATE/DELETE) — strict scoping.
--    A supervisor may only create/modify interns that are assigned to THEIR OWN
--    supervisor record, within THEIR OWN department, and recorded as created by
--    themselves. This blocks cross-supervisor / cross-department assignment.
drop policy if exists "supervisor manages assigned interns" on public.interns;
create policy "supervisor manages assigned interns"
  on public.interns for all to authenticated
  using (
    supervisor_id = public.current_supervisor_id()
    or created_by = auth.uid()
  )
  with check (
    supervisor_id = public.current_supervisor_id()
    and department_id = public.current_supervisor_department_id()
    and created_by = auth.uid()
  );

-- 3. Reload PostgREST schema cache.
notify pgrst, 'reload schema';
