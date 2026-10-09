-- ============================================================================
-- 0011 — Drop redundant intern school/course columns
-- ============================================================================
-- Interns now link to an institution (school name) and a program (course /
-- program name) via institution_id / program_id, so the free-text `school`
-- and `course` columns on `interns` are redundant. Dropping them keeps a
-- single source of truth.
-- ============================================================================

alter table public.interns
  drop column if exists school;

alter table public.interns
  drop column if exists course;

-- Reload PostgREST schema cache so the removed columns are no longer exposed.
notify pgrst, 'reload schema';
