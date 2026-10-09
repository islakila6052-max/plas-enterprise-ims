-- ============================================================================
-- 0029 — Fix orphaned supervisor profiles (missing supervisors rows)
-- ============================================================================
-- DIAGNOSIS: 4 supervisor profiles have supervisor_id = NULL in their profile,
-- meaning they have no linked supervisors row. When these supervisors try to
-- create an intern, current_supervisor_id() returns NULL, and the INSERT RLS
-- policy blocks them with "new row violates row-level security policy".
--
-- FIX: Create supervisors rows for each orphaned profile and link them.
-- We assign them to the "Administration" department as a default.
-- ============================================================================

-- Get the Administration department id
do $$
declare
  v_dept_id uuid;
  v_sup_id uuid;
begin
  select id into v_dept_id from public.departments where name = 'Administration' limit 1;

  -- Fix each orphaned supervisor profile
  for v_sup_id in
    select p.id from public.profiles p
    where p.role = 'supervisor' and p.supervisor_id is null
  loop
    -- Create the supervisors row if it doesn't exist
    insert into public.supervisors (profile_id, department_id, full_name, email, created_by)
    select p.id, v_dept_id, p.full_name, p.email, p.id
    from public.profiles p
    where p.id = v_sup_id
    on conflict (profile_id) do nothing;

    -- Update the profile's supervisor_id to link it
    update public.profiles
    set supervisor_id = (select id from public.supervisors where profile_id = v_sup_id)
    where id = v_sup_id;
  end loop;
end $$;

-- Reload PostgREST schema cache.
notify pgrst, 'reload schema';