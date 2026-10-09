-- ============================================================================
-- 0026 — Fix supervisor intern create policy (INSERT)
-- ============================================================================
-- DIAGNOSIS: the current "supervisor manages assigned interns" policy has a
-- with_check clause that's too restrictive for INSERT operations.
--
-- The current policy requires that for INSERT operations, the row must already
-- have supervisor_id = current_supervisor_id() and department_id = current_supervisor_department_id().
--
-- But when a supervisor creates a new intern, they need to SET these values
-- during the INSERT, not have them pre-set.
--
-- FIX: Allow supervisors to create interns by setting supervisor_id and
-- department_id during INSERT, as long as they match the supervisor's own record.
-- ============================================================================

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

-- Reload PostgREST schema cache.
notify pgrst, 'reload schema';