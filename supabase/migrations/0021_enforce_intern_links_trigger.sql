-- ============================================================================
-- 0021 — Enforce intern<->profile link + department derivation on every write
-- ============================================================================
-- PROBLEM: previous fixes (0018/0019/0020) only repaired EXISTING data. They
-- did not prevent the bug from recurring whenever an intern is created with a
-- missing profile_id / department_id (which is exactly what happened: the app
-- created auth users but the interns row sometimes had profile_id = NULL and
-- department_id = NULL, breaking RLS and the supervisor list).
--
-- GOAL: make the database SELF-HEALING so the links are guaranteed on EVERY
-- insert/update, independent of the current data state or the app code. After
-- this migration, any intern row — created by admin OR supervisor — will always
-- have a valid profile_id (so current_intern_id() resolves -> attendance /
-- journal / documents RLS passes) and a department_id (so the supervisor list
-- shows a department), even if the client sends NULL for those columns.
--
-- APPROACH: a BEFORE INSERT OR UPDATE trigger on public.interns that:
--   1. Resolves profile_id when NULL:
--        a) from created_by if that profile has role='intern'
--        b) else by matching lower(email) to a profile with role='intern'
--   2. Derives department_id from the supervisor's department when the intern
--      has no department but has a supervisor.
--   3. Keeps profiles.intern_id in sync (mirrors sync_profile_link_intern).
-- The trigger runs with SECURITY DEFINER so it can read profiles/supervisors
-- regardless of the caller's RLS.
-- ============================================================================

create or replace function public.ensure_intern_links()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_profile uuid;
  v_dept    uuid;
begin
  -- 1. Resolve profile_id if missing.
  if new.profile_id is null then
    -- a) from created_by (the profile that created the intern)
    select p.id into v_profile
    from public.profiles p
    where p.id = new.created_by
      and p.role = 'intern';

    -- b) else by email match to an intern-profile
    if v_profile is null and new.email is not null then
      select p.id into v_profile
      from public.profiles p
      where p.role = 'intern'
        and lower(p.email) = lower(new.email)
      limit 1;
    end if;

    if v_profile is not null then
      new.profile_id := v_profile;
    end if;
  end if;

  -- 2. Derive department_id from the supervisor when missing.
  if new.department_id is null and new.supervisor_id is not null then
    select s.department_id into v_dept
    from public.supervisors s
    where s.id = new.supervisor_id;
    if v_dept is not null then
      new.department_id := v_dept;
    end if;
  end if;

  -- 3. profiles.intern_id sync is handled by the existing AFTER trigger
  --    (sync_profile_link_intern / on_intern_linked), which runs once the row
  --    exists and profile_id is populated. Doing it here would violate the
  --    profiles.intern_id -> interns(id) FK because the row isn't committed yet.

  return new;
end;
$$;

drop trigger if exists ensure_intern_links_trg on public.interns;
create trigger ensure_intern_links_trg
  before insert or update on public.interns
  for each row execute function public.ensure_intern_links();

-- Reload PostgREST schema cache.
notify pgrst, 'reload schema';

-- ============================================================================
-- Mirror the same guarantee for supervisors: keep profiles.supervisor_id in
-- sync and resolve profile_id when the app sends it NULL, so a supervisor's
-- record is always reachable (supervisorService.getByProfileId / RLS).
-- ============================================================================

create or replace function public.ensure_supervisor_links()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_profile uuid;
begin
  -- Resolve profile_id if missing (from created_by or email match).
  if new.profile_id is null then
    select p.id into v_profile
    from public.profiles p
    where p.id = new.created_by
      and p.role = 'supervisor';
    if v_profile is null and new.email is not null then
      select p.id into v_profile
      from public.profiles p
      where p.role = 'supervisor'
        and lower(p.email) = lower(new.email)
      limit 1;
    end if;
    if v_profile is not null then
      new.profile_id := v_profile;
    end if;
  end if;

  -- NOTE: we do NOT set profiles.supervisor_id here. Doing so in a BEFORE
  -- trigger violates the profiles.supervisor_id -> supervisors(id) FK, because
  -- the new supervisors row is not committed yet. The AFTER trigger
  -- on_supervisor_linked (sync_profile_links) handles that sync correctly.

  return new;
end;
$$;

drop trigger if exists ensure_supervisor_links_trg on public.supervisors;
create trigger ensure_supervisor_links_trg
  before insert or update on public.supervisors
  for each row execute function public.ensure_supervisor_links();

-- Reload PostgREST schema cache.
notify pgrst, 'reload schema';
