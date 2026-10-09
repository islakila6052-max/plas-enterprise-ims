-- ============================================================================
-- 0016 — Scope program_code uniqueness per institution
-- ============================================================================
-- DIAGNOSIS: the unique index programs_program_code_unique was created
-- GLOBALLY (on public.programs (program_code)), so a program_code could
-- not be reused across DIFFERENT institutions. The UI lets an admin type any
-- code, and client-side validation only checks duplicates WITHIN the same
-- institution's form. Result: adding a program whose code already exists on
-- a program in ANOTHER institution failed with
--   "duplicate key value violates unique constraint
--    \"programs_program_code_unique\"".
--
-- FIX: replace the global unique index with a per-institution one
-- (institution_id, program_code). This matches the real-world model: a
-- course code like "BSIT-01" is unique WITHIN a school but may legitimately
-- exist at multiple schools. Client validation (within-institution) already
-- aligns with this.
--
-- Idempotent: drops the old index if present, creates the new one. The
-- new index only fires when (institution_id, program_code) repeats, which
-- the live data does not (verified before applying).
-- ============================================================================

-- 1. Drop the global unique index.
drop index if exists public.programs_program_code_unique;

-- 2. Create a per-institution unique index (ignores null/empty codes).
create unique index if not exists programs_program_code_per_inst_unique
  on public.programs (institution_id, program_code)
  where program_code is not null and program_code <> '';

-- 3. Reload PostgREST schema cache.
notify pgrst, 'reload schema';
