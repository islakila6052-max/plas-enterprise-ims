-- ============================================================================
-- 0028 — Restore missing daily_journals write policies (admin + supervisor)
-- ============================================================================
-- DIAGNOSIS (verified live via pg_policies):
--   The live daily_journals table only had TWO policies:
--     * "journals readable"        (SELECT)
--     * "journals_intern_insert"   (INSERT, with_check intern_id = current_intern_id())
--   There was NO admin ALL policy and NO supervisor UPDATE policy. So when an
--   admin (or supervisor) clicked Approve/Reject, PostgREST ran the UPDATE with
--   no UPDATE/ALL policy permitting the row -> 0 rows affected, NO error, and
--   the journal status silently stayed "pending" (the UI even showed success
--   because the client treated the empty result as a win). Interns could still
--   SUBMIT (INSERT policy existed) but nothing could ever be reviewed.
--
--   Documents worked because they still had "documents_review_update" etc.
--   The journal write policies were dropped/lost on the live DB at some point
--   (the migrations 0006/0007 create them, but the live state diverged).
--
-- FIX: idempotently (re)create the intended admin + supervisor write policies
--   so journal review works for admins and assigned supervisors, matching the
--   documents/attendance/evaluations pattern already live.
-- ============================================================================

-- 1. Admin full management (mirrors "admins manage documents" / "admins manage evaluations").
drop policy if exists "admins manage journals" on public.daily_journals;
create policy "admins manage journals"
  on public.daily_journals for all to authenticated
  using (public.is_admin ())
  with check (public.is_admin ());

-- 2. Supervisor can review (UPDATE) journals of THEIR assigned interns only.
drop policy if exists "supervisor reviews assigned journals" on public.daily_journals;
create policy "supervisor reviews assigned journals"
  on public.daily_journals for update to authenticated
  using (
    intern_id in (
      select id from public.interns
      where supervisor_id = public.current_supervisor_id ()
    )
  );

-- 3. Reload PostgREST schema cache.
notify pgrst, 'reload schema';
