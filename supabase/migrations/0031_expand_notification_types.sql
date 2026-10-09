-- Migration 0031: Expand notification type CHECK constraint
-- The current CHECK only allows 5 types. The codebase uses additional types
-- (account_created, intern_assigned, etc.) that would fail on insert.

DO $$
BEGIN
  -- Drop the existing CHECK constraint. Postgres auto-names CHECK constraints;
  -- we need to find and drop the right one.
  ALTER TABLE public.notifications
    DROP CONSTRAINT IF EXISTS notifications_type_check;

  -- Re-create with the expanded list.
  ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
      'announcement',
      'journal_review',
      'document_review',
      'evaluation_created',
      'evaluation_submitted',
      'attendance_reminder',
      'attendance_update',
      'account_created',
      'intern_assigned',
      'intern_status',
      'journal_submitted',
      'supervisor_assigned'
    ));
END$$;
