-- ============================================================================
-- 0034 — Missed Clock-out Fallback (Claimed Time Out)
-- ============================================================================
-- PURPOSE:
--   Allow interns who forgot to clock out to submit a claimed time-out for a
--   specific attendance record. The claim is subject to supervisor approval.
--   Upon approval, the claimed time becomes the official time_out and total
--   hours are recomputed.
--
-- CHANGES:
--   1. Add claimed_time_out timestamptz column
--   2. Add claim_status text column (pending | approved | rejected)
--   3. Add claim_remarks text column (intern's reason)
--   4. Add claim_reviewed_by uuid column (supervisor who reviewed)
--   5. Add claim_reviewed_at timestamptz column
--   6. Add claim_review_comment text column (supervisor's comment)
--   7. Add RLS policy so supervisors can review claims on assigned interns
-- ============================================================================

-- 1. Add claimed_time_out column
alter table public.attendance
add column if not exists claimed_time_out timestamptz;

-- 2. Add claim_status column
alter table public.attendance
add column if not exists claim_status text
check (claim_status in ('pending', 'approved', 'rejected'));

-- 3. Add claim_remarks column (intern's reason for the claim)
alter table public.attendance
add column if not exists claim_remarks text;

-- 4. Add claim_reviewed_by column (supervisor who reviewed)
alter table public.attendance
add column if not exists claim_reviewed_by uuid
references public.profiles (id) on delete set null;

-- 5. Add claim_reviewed_at column
alter table public.attendance
add column if not exists claim_reviewed_at timestamptz;

-- 6. Add claim_review_comment column (supervisor's comment)
alter table public.attendance
add column if not exists claim_review_comment text;

-- 7. Add index for filtering by claim_status
create index if not exists idx_attendance_claim_status
on public.attendance(claim_status)
where claim_status is not null;

-- 8. Add RLS policy so supervisors can review claims on assigned interns' attendance.
--    Supervisors can UPDATE claim fields (claim_status, claim_reviewed_by,
--    claim_reviewed_at, claim_review_comment) and, on approval, set time_out
--    and total_hours. They cannot modify other fields.
drop policy if exists "supervisor reviews attendance claims" on public.attendance;
create policy "supervisor reviews attendance claims"
  on public.attendance for update to authenticated
  using (
    intern_id in (
      select id from public.interns
      where supervisor_id = public.current_supervisor_id()
    )
  )
  with check (
    intern_id in (
      select id from public.interns
      where supervisor_id = public.current_supervisor_id()
    )
  );

-- 9. Add column comments for documentation
comment on column public.attendance.claimed_time_out is
  'Time-out time claimed by the intern when they forgot to clock out. Subject to supervisor approval.';
comment on column public.attendance.claim_status is
  'Status of the missed clock-out claim: pending, approved, or rejected.';
comment on column public.attendance.claim_remarks is
  'Reason provided by the intern for the missed clock-out.';
comment on column public.attendance.claim_reviewed_by is
  'Profile id of the supervisor who reviewed the claim.';
comment on column public.attendance.claim_reviewed_at is
  'Timestamp when the claim was reviewed.';
comment on column public.attendance.claim_review_comment is
  'Optional comment from the supervisor when reviewing the claim.';

-- 10. Reload PostgREST schema cache
notify pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (if needed):
--   drop policy if exists "supervisor reviews attendance claims" on public.attendance;
--   drop index if exists idx_attendance_claim_status;
--   alter table public.attendance drop column if exists claim_review_comment;
--   alter table public.attendance drop column if exists claim_reviewed_at;
--   alter table public.attendance drop column if exists claim_reviewed_by;
--   alter table public.attendance drop column if exists claim_remarks;
--   alter table public.attendance drop column if exists claim_status;
--   alter table public.attendance drop column if exists claimed_time_out;
-- ============================================================================