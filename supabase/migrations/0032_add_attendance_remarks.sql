-- ============================================================================
-- 0032 — Add remarks column to attendance table
-- ============================================================================
-- PURPOSE:
--   Allow interns to add remarks/reasons when timing out, especially for
--   forgotten timeouts. This provides documentation for why an attendance
--   record was completed late or with special circumstances.
--
-- CHANGES:
--   1. Add remarks TEXT column to attendance table
--   2. Add index for better performance when filtering by remarks
--   3. Add comment for documentation
-- ============================================================================

-- 1. Add remarks column to attendance table
alter table public.attendance 
add column if not exists remarks text;

-- 2. Add index for better performance when querying by remarks
--    (useful for admin reports on attendance remarks)
create index if not exists idx_attendance_remarks 
on public.attendance(remarks) 
where remarks is not null;

-- 3. Add column comment for documentation
comment on column public.attendance.remarks is 
  'Optional remarks or reason provided by intern when timing out. Required for forgotten timeouts.';

-- 4. Reload PostgREST schema cache
notify pgrst, 'reload schema';

-- ============================================================================
-- ROLLBACK (if needed):
--   drop index if exists idx_attendance_remarks;
--   alter table public.attendance drop column if exists remarks;
-- ============================================================================