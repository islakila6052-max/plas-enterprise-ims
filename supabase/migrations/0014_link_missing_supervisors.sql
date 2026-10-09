-- ============================================================================
-- 0014 — Create missing supervisors rows and link them to profiles
-- ============================================================================
-- DIAGNOSIS: every profile with role = 'supervisor' had supervisor_id = NULL
-- on the profile AND no matching row in public.supervisors (supervisors.profile_id
-- was also NULL). As a result public.current_supervisor_id() returned NULL for
-- ALL supervisors, so every INSERT into evaluations / interns by a supervisor
-- was rejected with "new row violates row-level security policy".
--
-- ROOT CAUSE: the supervisors records were never created (or not linked) when
-- the supervisor accounts were made, so the supervisor<->profile link that RLS
-- depends on does not exist.
--
-- FIX: for each supervisor profile that has no supervisors row yet, insert one
-- and set BOTH sides of the link:
--   * supervisors.profile_id = profiles.id   (used by current_supervisor_id)
--   * profiles.supervisor_id  = supervisors.id (cached link, used by the app)
-- A department is assigned round-robin from existing departments so the FK is
-- satisfied. This is idempotent: re-running it inserts nothing new.
-- ============================================================================

-- 1. Insert a supervisors row for every supervisor profile missing one.
--    Departments are assigned round-robin via a CTE with row_number().
with sup_profiles as (
  select
    p.id as pid,
    p.full_name,
    p.email,
    row_number() over (order by p.id) as rn
  from public.profiles p
  where p.role = 'supervisor'
    and not exists (
      select 1 from public.supervisors s where s.profile_id = p.id
    )
),
dept_count as (
  select greatest(1, count(*)::int) as n from public.departments
),
dept_list as (
  select id, row_number() over (order by id) as drn from public.departments
)
insert into public.supervisors (id, profile_id, department_id, full_name, email, created_at)
select
  gen_random_uuid(),
  sp.pid,
  dl.id,
  sp.full_name,
  sp.email,
  now()
from sup_profiles sp
cross join dept_count dc
join dept_list dl on dl.drn = ((sp.rn - 1) % dc.n) + 1;

-- 2. Backfill the cached profiles.supervisor_id from the new rows.
update public.profiles
set supervisor_id = s.id
from public.supervisors s
where s.profile_id = public.profiles.id
  and public.profiles.supervisor_id is null;

-- 3. Reload PostgREST schema cache.
notify pgrst, 'reload schema';
