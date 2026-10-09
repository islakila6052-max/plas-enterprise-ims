-- ============================================================================
-- 0025 — Add missing SELECT policies (fixes 403 on attendance/journals/docs)
-- ============================================================================
-- DIAGNOSIS: the live DB is missing the SELECT policies for attendance,
-- daily_journals and documents. With RLS enabled, a table with NO SELECT
-- policy denies ALL reads -> every dashboard/list that queries these tables
-- fails with HTTP 403 ("Failed to load resource: 403"). This breaks:
--   * Admin dashboard "attendance today" + Admin Attendance list
--   * Supervisor Attendance + Supervisor Journals lists
--   * Intern dashboard + Intern Attendance + Intern Journal + Intern Documents
--   * Admin Journals + Admin Documents lists
-- The INSERT/UPDATE/DELETE/ALL policies exist; only SELECT was lost (the
-- original 0006 design had these but they are absent on the live DB).
--
-- FIX: recreate the intended SELECT policies so each role can READ what it is
-- allowed to see, matching the existing write policies.
-- ============================================================================

-- 1. attendance: admin all, intern own, supervisor assigned interns' attendance.
drop policy if exists "attendance readable" on public.attendance;
create policy "attendance readable"
  on public.attendance for select to authenticated
  using (
    public.is_admin()
    or intern_id = public.current_intern_id()
    or intern_id in (
      select id from public.interns where supervisor_id = public.current_supervisor_id()
    )
  );

-- 2. daily_journals: admin all, intern own, supervisor assigned interns' journals.
drop policy if exists "journals readable" on public.daily_journals;
create policy "journals readable"
  on public.daily_journals for select to authenticated
  using (
    public.is_admin()
    or intern_id = public.current_intern_id()
    or intern_id in (
      select id from public.interns where supervisor_id = public.current_supervisor_id()
    )
  );

-- 3. documents: admin all, intern own, supervisor assigned interns' documents.
drop policy if exists "documents readable" on public.documents;
create policy "documents readable"
  on public.documents for select to authenticated
  using (
    public.is_admin()
    or intern_id = public.current_intern_id()
    or intern_id in (
      select id from public.interns where supervisor_id = public.current_supervisor_id()
    )
  );

-- Reload PostgREST schema cache.
notify pgrst, 'reload schema';
