-- ============================================================================
-- 0020 — Link missing supervisors rows to profiles + assign departments
-- ============================================================================
-- DIAGNOSIS: the supervisor<->profile link is broken on the live DB:
--   * ALL 8 supervisor-role profiles have profiles.supervisor_id = NULL
--   * the only supervisors row has profile_id = NULL
-- As a result, when a supervisor creates an intern, the frontend cannot resolve
-- the supervisor record (supervisorService.getByProfileId finds nothing) nor a
-- department_id, so the new intern is created with department_id = NULL and the
-- supervisor intern list shows "—" for Department.
-- This is the same broken-link class already fixed for interns in 0018/0019.
--
-- FIX (idempotent):
--   1. Link the existing supervisors row to its profile by email (both sides).
--   2. For every supervisor-role profile lacking a supervisors row, create one
--      and link both sides; assign a department round-robin from departments.
--   3. Reload PostgREST schema cache.
-- Re-running is safe.
-- ============================================================================

-- 1. Link existing supervisors rows to profiles by email (repair profile_id).
update public.supervisors s
set profile_id = p.id
from public.profiles p
where s.profile_id is null
  and lower(p.email) = lower(s.email)
  and p.role = 'supervisor';

-- 1b. Backfill profiles.supervisor_id from the now-linked supervisors rows.
update public.profiles p
set supervisor_id = s.id
from public.supervisors s
where p.supervisor_id is null
  and p.role = 'supervisor'
  and s.profile_id = p.id;

-- 2. Create supervisors rows for orphan supervisor profiles (no row yet).
--    Departments assigned round-robin so the FK is satisfied.
with sup_profiles as (
  select
    p.id as pid,
    p.full_name,
    p.email,
    row_number() over (order by p.id) as rn
  from public.profiles p
  where p.role = 'supervisor'
    and not exists (select 1 from public.supervisors s where s.profile_id = p.id)
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

-- 2b. Backfill profiles.supervisor_id from the newly created rows.
update public.profiles p
set supervisor_id = s.id
from public.supervisors s
where p.supervisor_id is null
  and p.role = 'supervisor'
  and s.profile_id = p.id;

-- 3. Reload PostgREST schema cache.
notify pgrst, 'reload schema';

-- 4. Backfill department_id on existing interns that were created with NULL.
--    Prefer the department of the supervisor who created them (created_by);
--    fall back to a round-robin department assignment for the rest.
update public.interns i
set department_id = s.department_id
from public.profiles p
join public.supervisors s on s.profile_id = p.id
where i.department_id is null
  and i.created_by = p.id
  and s.department_id is not null;

-- 4b. Any interns still missing a department get one round-robin.
with ranked as (
  select i.id as iid, (row_number() over (order by i.id) - 1) as rn
  from public.interns i
  where i.department_id is null
),
dc as (select greatest(1, count(*)::int) as n from public.departments),
dl as (select id, (row_number() over (order by id) - 1) as idx from public.departments)
update public.interns i
set department_id = dl.id
from ranked r
join dc on true
join dl on dl.idx = (r.rn % dc.n)
where i.id = r.iid;
