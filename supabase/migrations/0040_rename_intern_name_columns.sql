-- ============================================================================
-- 0040 - Rename intern name columns
-- ============================================================================
-- Renames interns.full_name -> interns.first_name and interns.student_number
-- -> interns.last_name. A `full_name` generated column (first_name ||
-- last_name) is re-added so all existing read paths that display a single
-- combined name keep working.
--
-- SAFE TO RE-RUN: every step is guarded by information_schema checks.
-- ============================================================================

-- 1. Add the new real columns.
alter table public.interns add column if not exists first_name text;
alter table public.interns add column if not exists last_name text;

-- 2. Backfill first_name from the legacy free-text full_name column
--    (only when full_name is still a plain, non-generated column).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'interns'
      and column_name = 'full_name'
      and is_generated = 'NEVER'
  ) then
    update public.interns
       set first_name = coalesce(first_name, full_name, '')
     where first_name is null;
  end if;

  -- Guarantee NOT NULL after the backfill.
  update public.interns set first_name = '' where first_name is null;
  alter table public.interns alter column first_name set not null;
  alter table public.interns alter column first_name set default '';
end $$;

-- 3. Backfill last_name from the legacy student_number column, then drop it.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'interns'
      and column_name = 'student_number'
  ) then
    update public.interns
       set last_name = coalesce(last_name, student_number)
     where student_number is not null;
    alter table public.interns drop column student_number;
  end if;
end $$;

-- 4. Replace the legacy plain full_name column with a generated one
--    (first_name || ' ' || last_name) so combined-name read paths keep working.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'interns'
      and column_name = 'full_name'
      and is_generated = 'ALWAYS'
  ) then
    alter table public.interns drop column if exists full_name;
    alter table public.interns
      add column full_name text generated always as (
        btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
      ) stored;
  end if;
end $$;
