-- ============================================================================
-- Internship Management System — Enforce one attendance record per intern per day
-- ============================================================================
-- Applied AFTER 0004_consistency.sql.
--
-- Changes:
--   1. Drop the partial unique index that only prevented duplicate OPEN records
--   2. Create a full unique index on (intern_id, date) to prevent ANY duplicate
--      attendance record per intern per day, regardless of time_out status.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Drop the old partial unique index (open records only)
-- ---------------------------------------------------------------------------
drop index if exists public.attendance_open_unique;

-- ---------------------------------------------------------------------------
-- 2. Create a full unique index — one record per intern per day
-- ---------------------------------------------------------------------------
create unique index if not exists attendance_unique_per_day
  on public.attendance (intern_id, date);
