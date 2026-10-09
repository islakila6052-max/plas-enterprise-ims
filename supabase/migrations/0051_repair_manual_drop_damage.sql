-- ============================================================================
-- 0051 - Repair manual DROP damage
-- ============================================================================
-- The live database was hand-edited through the Supabase SQL Editor:
--   * public.interns.full_name (GENERATED) was dropped -> every query that
--     selects full_name (attendance, documents, evaluations, interns,
--     journals, DTR modal) returns 400 "column interns.full_name does not
--     exist".
--   * public.profiles was rebuilt on 2026-10-02 19:39 UTC, which reset every
--     row to role = 'intern' (handle_new_user hard-coded 'intern'), so the
--     admin and supervisor accounts lost their role -> RoleRoute blocks the
--     admin/supervisor dashboards and is_admin()/current_supervisor_id()
--     return false/null.
--   * public.supervisors ended up empty and interns.supervisor_id all NULL,
--     so supervisors could not see any assigned interns.
--
-- Everything below is idempotent and deletes NO row that owns data.
-- ============================================================================


-- 1. interns.full_name (GENERATED, mirrors supervisors.full_name) -----------
do $$
begin
  -- If a plain (non-generated) full_name exists, drop it: the value is
  -- recomputable from first_name/last_name, and GENERATED ALWAYS cannot be
  -- inserted into, which would break the ensure_role_rows trigger.
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'interns'
       and column_name = 'full_name' and is_generated <> 'ALWAYS'
  ) then
    alter table public.interns drop column full_name;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'interns'
       and column_name = 'full_name'
  ) then
    alter table public.interns
      add column full_name text generated always as (
        btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, ''))
      ) stored;
  end if;
end $$;


-- 2. handle_new_user must honour raw_user_meta_data.role --------------------
-- The previous version hard-coded 'intern', so any account that was
-- re-provisioned (profiles rebuild) silently lost admin/supervisor.
create or replace function public.handle_new_user()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_role public.user_role := 'intern';
  v_raw  text;
begin
  v_raw := new.raw_user_meta_data ->> 'role';
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


-- 3. Restore profiles.role from auth.users (the surviving source of truth) ---
do $$
declare
  r      record;
  v_role public.user_role;
begin
  for r in
    select u.id,
           u.raw_user_meta_data ->> 'role' as meta_role,
           p.role                          as current_role
      from auth.users u
      join public.profiles p on p.id = u.id
  loop
    continue when r.meta_role is null;

    v_role := null;
    begin
      v_role := r.meta_role::public.user_role;
    exception when invalid_text_representation then
      v_role := null;
    end;

    if v_role is not null and v_role is distinct from r.current_role then
      update public.profiles set role = v_role where id = r.id;
    end if;
  end loop;
end $$;


-- 4. Every supervisor profile must own a supervisors row --------------------
-- ensure_role_rows normally creates it when the role flips; this is a safety
-- net in case the trigger was dropped during the manual editing.
do $$
declare
  r      record;
  v_dept uuid;
  v_full text;
begin
  select d.id into v_dept from public.departments d order by d.id limit 1;

  for r in
    select p.id, p.full_name, p.email
      from public.profiles p
     where p.role = 'supervisor'
       and not exists (select 1 from public.supervisors s where s.profile_id = p.id)
  loop
    v_full := btrim(coalesce(r.full_name, ''));
    insert into public.supervisors (profile_id, first_name, last_name, email, department_id)
    values (
      r.id,
      coalesce(nullif(split_part(v_full, ' ', 1), ''), ''),
      nullif(btrim(regexp_replace(v_full, '^\S+\s*', '')), ''),
      r.email,
      v_dept
    );
  end loop;
end $$;



-- 5. Re-link unassigned interns to the primary supervisor -------------------
-- interns.supervisor_id was wiped together with the supervisors table, which
-- left every supervisor dashboard empty. Only real interns (profile role =
-- 'intern') that are still unassigned are touched, so this stays reversible
-- from Admin > Intern Management.
do $$
declare
  v_sup uuid;
begin
  select s.id into v_sup
    from public.supervisors s
    join public.profiles p on p.id = s.profile_id
   where p.email = 'supervisor@supervisor.com'
   limit 1;

  if v_sup is null then
    select s.id into v_sup
      from public.supervisors s
     order by s.created_at, s.id
     limit 1;
  end if;

  if v_sup is not null then
    update public.interns i
       set supervisor_id = v_sup
      from public.profiles p
     where i.supervisor_id is null
       and p.id = i.profile_id
       and p.role = 'intern';
  end if;
end $$;


-- 6. Remove leftover intern rows for accounts that are no longer interns -----
-- Guarded: only rows that own ZERO attendance/journal/document/evaluation
-- rows are deleted, so no data is ever lost. profiles.intern_id is
-- ON DELETE SET NULL, and sync_profile_links clears the link.
do $$
declare
  r record;
begin
  for r in
    select i.id
      from public.interns i
      join public.profiles p on p.id = i.profile_id
     where p.role in ('admin', 'hr_staff', 'supervisor')
       and not exists (select 1 from public.attendance    a where a.intern_id = i.id)
       and not exists (select 1 from public.daily_journals j where j.intern_id = i.id)
       and not exists (select 1 from public.documents      d where d.intern_id = i.id)
       and not exists (select 1 from public.evaluations     e where e.intern_id = i.id)
  loop
    delete from public.interns where id = r.id;
  end loop;
end $$;



-- 7. RPC execute grants (PostgREST only exposes granted functions) ----------
-- The frontend always calls these while signed in; anon must not.
revoke execute on function public.attendance_clock_in (text) from public, anon;
grant  execute on function public.attendance_clock_in (text) to authenticated, service_role;
revoke execute on function public.attendance_clock_out (timestamptz, text) from public, anon;
grant  execute on function public.attendance_clock_out (timestamptz, text) to authenticated, service_role;
revoke execute on function public.attendance_submit_claim (uuid, timestamptz, text) from public, anon;
grant  execute on function public.attendance_submit_claim (uuid, timestamptz, text) to authenticated, service_role;
revoke execute on function public.attendance_review_claim (uuid, text, text) from public, anon;
grant  execute on function public.attendance_review_claim (uuid, text, text) to authenticated, service_role;
revoke execute on function public.journal_review (uuid, text, text) from public, anon;
grant  execute on function public.journal_review (uuid, text, text) to authenticated, service_role;
revoke execute on function public.document_review (uuid, text) from public, anon;
grant  execute on function public.document_review (uuid, text) to authenticated, service_role;
revoke execute on function public.evaluation_create (uuid, integer, integer, integer, integer, integer, integer, integer, text, text) from public, anon;
grant  execute on function public.evaluation_create (uuid, integer, integer, integer, integer, integer, integer, integer, text, text) to authenticated, service_role;
revoke execute on function public.update_own_profile (text, text, text, text) from public, anon;
grant  execute on function public.update_own_profile (text, text, text, text) to authenticated, service_role;
revoke execute on function public.notify_user (uuid, text, text, text, text, jsonb) from public, anon;
grant  execute on function public.notify_user (uuid, text, text, text, text, jsonb) to authenticated, service_role;
revoke execute on function public.notify_role (text, text, text, text, text, jsonb) from public, anon;
grant  execute on function public.notify_role (text, text, text, text, text, jsonb) to authenticated, service_role;
revoke execute on function public.write_audit_log (text, text, uuid, jsonb) from public, anon;
grant  execute on function public.write_audit_log (text, text, uuid, jsonb) to authenticated, service_role;
revoke execute on function public.announcement_create (text, text, text, boolean) from public, anon;
grant  execute on function public.announcement_create (text, text, text, boolean) to authenticated, service_role;
revoke execute on function public.announcement_update (uuid, text, text, text, boolean) from public, anon;
grant  execute on function public.announcement_update (uuid, text, text, text, boolean) to authenticated, service_role;
revoke execute on function public.announcement_delete (uuid) from public, anon;
grant  execute on function public.announcement_delete (uuid) to authenticated, service_role;


-- 8. Reload the PostgREST schema cache ---------------------------------------
notify pgrst, 'reload schema';

