-- ============================================================================
-- 0053 - Lock down role assignment and profile links (audit S1 and S2)
-- ============================================================================
-- S1  handle_new_user() (0051) copied `role` from raw_user_meta_data. The
--     browser controls that field: `supabase.auth.signUp({ options: { data:
--     { role: 'admin' } } })` created an admin profile. The role now comes
--     from raw_app_meta_data, which only the service role can write (the
--     /api/admin functions pass it as `app_metadata`). Anything else is an
--     intern.
--
-- S2  A user could UPDATE their own profiles row directly. Policy
--     "profiles_update_own" (0008) never pinned `role`, and no policy pinned
--     `intern_id`, `supervisor_id` or `email`. current_intern_id() and
--     current_supervisor_id() trust those link columns, so:
--       * any user could set their own role to 'admin';
--       * an intern could copy their supervisor's id into
--         profiles.supervisor_id and approve their own work;
--       * a supervisor could copy an intern's id into profiles.intern_id and
--         act as that intern.
--     A trigger now rejects direct client changes to those columns, whatever
--     policies exist on the live database. The two helpers also check the
--     caller's role before they return a link.
--
-- Idempotent. Changes no data.
-- ============================================================================

begin;

-- 1. S1: the role of a new account comes only from trusted metadata --------
create or replace function public.handle_new_user ()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role public.user_role := 'intern';
  v_raw  text;
begin
  -- raw_app_meta_data is writable only with the service role.
  -- Never read the role from raw_user_meta_data: the client controls it.
  v_raw := new.raw_app_meta_data ->> 'role';
  if v_raw is not null then
    begin
      v_role := v_raw::public.user_role;
    exception when invalid_text_representation then
      v_role := 'intern';
    end;
  end if;

  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email,
    v_role
  )
  on conflict (id) do nothing;
  return new;
end;
$$;


-- 1b. S1: apply the trusted role when the admin API sets it ----------------
-- Recorded GoTrue behavior (v2.194.0): auth.admin.createUser() INSERTs the
-- auth.users row with app_metadata = { provider, providers } only, then
-- writes the custom app_metadata (our `role`) in a later UPDATE. So at INSERT
-- time handle_new_user() always sees no role and creates an intern, and
-- ensure_role_rows() creates an interns row for it. This trigger applies the
-- role when app_metadata.role changes, and removes that auto-created interns
-- row if it holds no data.
create or replace function public.apply_trusted_role ()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role public.user_role;
begin
  if (new.raw_app_meta_data ->> 'role') is null
     or (new.raw_app_meta_data ->> 'role') is not distinct from (old.raw_app_meta_data ->> 'role') then
    return new;
  end if;

  begin
    v_role := (new.raw_app_meta_data ->> 'role')::public.user_role;
  exception when invalid_text_representation then
    return new;
  end;

  update public.profiles set role = v_role
   where id = new.id and role is distinct from v_role;

  if v_role <> 'intern' then
    delete from public.interns i
     where i.profile_id = new.id
       and not exists (select 1 from public.attendance a where a.intern_id = i.id)
       and not exists (select 1 from public.daily_journals j where j.intern_id = i.id)
       and not exists (select 1 from public.documents d where d.intern_id = i.id)
       and not exists (select 1 from public.evaluations e where e.intern_id = i.id);
  end if;

  return new;
end;
$$;

revoke all on function public.apply_trusted_role () from public, anon, authenticated;

drop trigger if exists on_auth_user_app_role_changed on auth.users;
create trigger on_auth_user_app_role_changed
  after update of raw_app_meta_data on auth.users
  for each row execute function public.apply_trusted_role ();


-- 2. S2: reject direct client changes to privileged profile columns --------
-- Only direct writes from the browser run as `authenticated` or `anon`.
-- SECURITY DEFINER functions and triggers (sync_profile_links,
-- update_own_profile, ...) run as their owner, and the service role is
-- trusted, so those paths are not affected.
create or replace function public.guard_profile_privileged_columns ()
  returns trigger
  language plpgsql
  set search_path = public
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if new.id is distinct from old.id
     or new.email is distinct from old.email
     or new.intern_id is distinct from old.intern_id
     or new.supervisor_id is distinct from old.supervisor_id
     or new.role is distinct from old.role then
    if not public.is_admin() then
      raise exception 'Only an administrator can change role, email or account links.'
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  -- Granting or removing admin / hr_staff is for full admins only, so HR
  -- staff cannot promote themselves or anyone else to administrator.
  if new.role is distinct from old.role
     and (new.role in ('admin', 'hr_staff') or old.role in ('admin', 'hr_staff'))
     and not public.can_delete_users() then
    raise exception 'Only an administrator can grant or remove administrator roles.'
      using errcode = 'insufficient_privilege';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_profile_privileged_columns on public.profiles;
create trigger guard_profile_privileged_columns
  before update on public.profiles
  for each row execute function public.guard_profile_privileged_columns ();

-- Superseded by "users manage own profile" (0048), which pins the role.
drop policy if exists "profiles_update_own" on public.profiles;


-- 3. S2: resolve a link only for the matching role --------------------------
-- An intern never resolves to a supervisor row, and a supervisor never
-- resolves to an intern row, even if a link column is wrong.
create or replace function public.current_intern_id ()
  returns uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select case
    when (select p.role from public.profiles p where p.id = auth.uid()) = 'intern' then
      coalesce(
        (select i.id from public.interns i where i.profile_id = auth.uid() limit 1),
        (select p.intern_id from public.profiles p where p.id = auth.uid())
      )
  end;
$$;

create or replace function public.current_supervisor_id ()
  returns uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select case
    when (select p.role from public.profiles p where p.id = auth.uid()) = 'supervisor' then
      coalesce(
        (select s.id from public.supervisors s where s.profile_id = auth.uid() limit 1),
        (select p.supervisor_id from public.profiles p where p.id = auth.uid())
      )
  end;
$$;

revoke all on function public.current_intern_id () from public, anon;
revoke all on function public.current_supervisor_id () from public, anon;
grant execute on function public.current_intern_id () to authenticated, service_role;
grant execute on function public.current_supervisor_id () to authenticated, service_role;

commit;

notify pgrst, 'reload schema';
