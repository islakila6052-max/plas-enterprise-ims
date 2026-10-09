-- ============================================================================
-- 0042 - Supervisor name columns (first_name / last_name)
-- ============================================================================
-- Mirrors migration 0040 for interns: supervisors.full_name becomes a
-- GENERATED column (first_name || ' ' || last_name), and real first_name /
-- last_name columns are added. Also rewrites ensure_role_rows() whose
-- supervisor branch still inserted supervisors(full_name, ...) directly,
-- which would fail once full_name is generated.
--
-- SAFE TO RE-RUN: every step is guarded by information_schema checks.
-- ============================================================================

-- 1. Add the new real columns.
alter table public.supervisors add column if not exists first_name text;
alter table public.supervisors add column if not exists last_name text;

-- 2. Backfill from the legacy free-text full_name column (only when it is
--    still a plain, non-generated column).
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'supervisors'
      and column_name = 'full_name'
      and is_generated = 'NEVER'
  ) then
    update public.supervisors
       set first_name = coalesce(nullif(split_part(btrim(coalesce(full_name, '')), ' ', 1), ''), '')
     where first_name is null;

    update public.supervisors
       set last_name = nullif(btrim(regexp_replace(coalesce(full_name, ''), '^\S+\s*', '')), '')
     where last_name is null;
  end if;

  -- Guarantee NOT NULL after the backfill.
  update public.supervisors set first_name = '' where first_name is null;
  alter table public.supervisors alter column first_name set not null;
  alter table public.supervisors alter column first_name set default '';
end $$;

-- 3. Replace the legacy plain full_name column with a generated one
--    (first_name || ' ' || last_name) so combined-name read paths keep working.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'supervisors'
      and column_name = 'full_name'
      and is_generated = 'ALWAYS'
  ) then
    alter table public.supervisors drop column if exists full_name;
    alter table public.supervisors
      add column full_name text generated always as (
        btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
      ) stored;
  end if;
end $$;

-- 4. Rewrite ensure_role_rows(): the supervisor branch must no longer insert
--    the generated full_name column directly.
CREATE OR REPLACE FUNCTION public.ensure_role_rows()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_dept uuid;
  should_create boolean := false;
  v_full_name text;
BEGIN
  -- Only create on INSERT, or when role changes TO intern/supervisor
  IF TG_OP = 'INSERT' THEN
    should_create := true;
  ELSIF TG_OP = 'UPDATE' THEN
    should_create := (OLD.role IS DISTINCT FROM NEW.role);
  END IF;

  IF NOT should_create THEN
    RETURN NEW;
  END IF;

  v_full_name := btrim(coalesce(NEW.full_name, ''));

  IF NEW.role = 'intern' THEN
    IF NOT EXISTS (SELECT 1 FROM public.interns i WHERE i.profile_id = NEW.id) THEN
      SELECT d.id INTO v_dept FROM public.departments d ORDER BY d.id LIMIT 1;
      -- interns.full_name is a GENERATED column (first_name || ' ' ||
      -- last_name) and interns.student_number no longer exists, so insert
      -- first_name / last_name split from the profile's full name.
      INSERT INTO public.interns (
        id, profile_id, first_name, last_name, email, status, required_hours, department_id
      ) VALUES (
        gen_random_uuid(),
        NEW.id,
        coalesce(nullif(split_part(v_full_name, ' ', 1), ''), ''),
        nullif(btrim(regexp_replace(v_full_name, '^\S+\s*', '')), ''),
        NEW.email,
        'active',
        300,
        v_dept
      );
    END IF;
  END IF;

  IF NEW.role = 'supervisor' THEN
    IF NOT EXISTS (SELECT 1 FROM public.supervisors s WHERE s.profile_id = NEW.id) THEN
      SELECT d.id INTO v_dept FROM public.departments d ORDER BY d.id LIMIT 1;
      -- supervisors.full_name is a GENERATED column, so insert
      -- first_name / last_name split from the profile's full name.
      INSERT INTO public.supervisors (id, profile_id, first_name, last_name, email, department_id)
      VALUES (
        gen_random_uuid(),
        NEW.id,
        coalesce(nullif(split_part(v_full_name, ' ', 1), ''), ''),
        nullif(btrim(regexp_replace(v_full_name, '^\S+\s*', '')), ''),
        NEW.email,
        v_dept
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
