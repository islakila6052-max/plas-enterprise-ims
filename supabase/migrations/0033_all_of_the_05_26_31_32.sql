-- ============================================================================
-- 0033 — Combined new migrations (0031 + 0032)
-- ============================================================================
-- This combines both new migrations into one file to avoid conflicts
-- ============================================================================

-- Part 1: Expand notification types (includes ALL existing types)
DO $$
BEGIN
  ALTER TABLE public.notifications
    DROP CONSTRAINT IF EXISTS notifications_type_check;

  ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
      -- Existing types from your database
      'account_created',
      'announcement',
      'document_review',
      'evaluation_submitted',
      'intern_assigned',
      'journal_review',
      'journal_reviewed',
      'supervisor_added',
      
      -- New types being added
      'evaluation_created',
      'attendance_reminder',
      'attendance_update',
      'intern_status',
      'journal_submitted',
      'supervisor_assigned'
    ));
END$$;

-- Part 2: Add remarks column to attendance
alter table public.attendance 
add column if not exists remarks text;

create index if not exists idx_attendance_remarks 
on public.attendance(remarks) 
where remarks is not null;

comment on column public.attendance.remarks is 
  'Optional remarks or reason provided by intern when timing out. Required for forgotten timeouts.';

-- Reload PostgREST schema cache
notify pgrst, 'reload schema';




