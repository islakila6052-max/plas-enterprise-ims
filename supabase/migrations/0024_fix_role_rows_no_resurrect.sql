-- ============================================================================
-- 0024 — Fix ensure_role_rows so deletes are permanent (no resurrection)
-- ============================================================================
-- DIAGNOSIS: the ensure_role_rows trigger (created by the now-reverted 0023)
-- is STILL present on the DB. It runs on EVERY INSERT/UPDATE of profiles and
-- re-creates an interns/supervisors row whenever a profile has role=
-- 'intern'/'supervisor' but no linked row. Consequence: when an admin deletes
-- an intern (intern row removed) but the profile survives (e.g. the auth-user
-- delete is non-fatal), any later touch of that profile re-creates the intern
-- row, so the admin dashboard count never drops -> "deleted account still
-- counts".
--
-- FIX: restrict the trigger to ONLY create the linked row on
--   * INSERT (new account provisioning), or
--   * UPDATE where the role CHANGED to 'intern'/'supervisor' (old.role IS
--     DISTINCT FROM new.role).
-- A plain profile update (name/email change) with the same role will NOT
-- resurrect a deleted row. This makes admin deletes permanent.
--
-- NOTE: supabase migration repair --status reverted does NOT drop objects, so
-- the old trigger/function still exist; we replace them here explicitly.
-- ============================================================================

create or replace function public.ensure_role_rows()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_dept uuid;
  should_create boolean := false;
begin
  -- Only create on INSERT, or when the role is being set TO intern/supervisor
  -- (not on every routine profile update, which would resurrect deletions).
  if tg_op = 'INSERT' then
    should_create := true;
  elsif tg_op = 'UPDATE' then
    should_create := (old.role IS DISTINCT FROM new.role);
  end if;

  if not should_create then
    return new;
  end if;

  if new.role = 'intern' then
    if not exists (select 1 from public.interns i where i.profile_id = new.id) then
      select d.id into v_dept from public.departments d order by d.id limit 1;
      insert into public.interns (id, profile_id, full_name, student_number, email, status, required_hours, department_id)
      values (
        gen_random_uuid(),
        new.id,
        new.full_name,
        'INT-' || replace(new.id::text, '-', ''),
        new.email,
        'active',
        300,
        v_dept
      );
    end if;
  end if;

  if new.role = 'supervisor' then
    if not exists (select 1 from public.supervisors s where s.profile_id = new.id) then
      select d.id into v_dept from public.departments d order by d.id limit 1;
      insert into public.supervisors (id, profile_id, full_name, email, department_id)
      values (
        gen_random_uuid(),
        new.id,
        new.full_name,
        new.email,
        v_dept
      );
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists ensure_role_rows_trg on public.profiles;
create trigger ensure_role_rows_trg
  after insert or update on public.profiles
  for each row execute function public.ensure_role_rows();

-- Reload PostgREST schema cache.
notify pgrst, 'reload schema';
