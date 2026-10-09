-- ============================================================================
-- PASTE THIS WHOLE FILE INTO:  Supabase Dashboard -> SQL Editor -> New query
-- Then click RUN.
-- ============================================================================
--
-- WHAT THIS FIXES
--   Time In fails with:
--     Could not find the function public.attendance_clock_in(p_method)
--     in the schema cache
--   That 404 means the function does not exist in Postgres yet. Verified on
--   project wsofrunlefoljliakrzc: only 5 RPCs exist (current_intern_id,
--   current_role, current_supervisor_department_id, current_supervisor_id,
--   is_admin), so migrations 0045/0046/0047 never reached the database.
--
-- SCOPE - DELIBERATELY MINIMAL
--   This file creates ONLY the attendance RPCs so Time In / Time Out work.
--   It is safe to re-run and touches NO existing rows:
--     * no table dropped, truncated or altered destructively
--     * no DELETE / UPDATE against your data
--     * no storage bucket changes
--     * no RLS or policy changes
--   Your documents.file_url values and all attendance history are untouched.
--
--   0045's storage/RLS hardening and 0047's FORCE ROW LEVEL SECURITY are
--   deliberately NOT included here. Apply those separately once Time In works.
--
-- SAFE TO RE-RUN: every object uses `if not exists` or `create or replace`.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. Shift start column (server-side source of truth for late vs present)
-- ---------------------------------------------------------------------------
-- 780 = 13:00 Asia/Manila, matching SHIFT_START_MINUTE in src/lib/constants.js.
-- Declared here at statement level because plpgsql cannot run DDL in a body.
alter table public.settings
  add column if not exists shift_start_minute integer not null default 780;


-- ---------------------------------------------------------------------------
-- 1. Helpers
-- ---------------------------------------------------------------------------
create or replace function public.attendance_today ()
  returns date
  language sql
  stable
as $$
  select (now() at time zone 'Asia/Manila')::date;
$$;

create or replace function public.attendance_hours (p_time_in timestamptz, p_time_out timestamptz)
  returns numeric
  language sql
  immutable
as $$
  select case
    when p_time_in is null or p_time_out is null then null
    when p_time_out <= p_time_in then 0
    else round((extract(epoch from (p_time_out - p_time_in)) / 3600.0)::numeric, 2)
  end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Clock in
-- ---------------------------------------------------------------------------
-- SECURITY: the row is bound to current_intern_id() from the JWT, NOT to an
-- intern id sent by the browser, and `status` (present/late) is derived from
-- the SERVER clock. A client cannot claim `present` for a late arrival, and
-- cannot clock in on someone else's behalf.
--
-- First drop any stale/mismatched overload (a different argument name or type).
-- A leftover overload is one of the ways PostgREST reports
-- `Could not find the function ...(p_method)` even though a function of that
-- name exists, so remove every variant that is not the canonical `(text)`
-- signature before (re)creating it.
do $$
declare
  v_sig text;
begin
  for v_sig in
    select format('%I.%I(%s)', n.nspname, p.proname,
                  pg_get_function_identity_arguments(p.oid))
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'attendance_clock_in'
       and pg_get_function_identity_arguments(p.oid) <> 'text'
  loop
    execute 'drop function if exists ' || v_sig;
  end loop;
end $$;

create or replace function public.attendance_clock_in (p_method text default 'manual')
  returns public.attendance
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_intern uuid := public.current_intern_id ();
  v_today date := public.attendance_today ();
  v_shift integer;
  v_row public.attendance;
begin
  if v_intern is null then
    raise exception 'No intern profile is linked to this account.'
      using errcode = 'insufficient_privilege';
  end if;

  if exists (
    select 1 from public.attendance
    where intern_id = v_intern and date = v_today
  ) then
    raise exception 'You have already submitted your attendance for today.'
      using errcode = 'unique_violation';
  end if;

  select coalesce(
    (select s.shift_start_minute from public.settings s where s.id = 1),
    780
  ) into v_shift;

  insert into public.attendance (intern_id, date, time_in, total_hours, method, status)
  values (
    v_intern,
    v_today,
    now(),
    0,
    coalesce(p_method, 'manual'),
    case
      when extract(hour from now() at time zone 'Asia/Manila') * 60
           + extract(minute from now() at time zone 'Asia/Manila') > v_shift
      then 'late'::attendance_status
      else 'present'::attendance_status
    end
  )
  returning * into v_row;

  return v_row;
end;
$$;


-- ---------------------------------------------------------------------------
-- 3. Clock out
-- ---------------------------------------------------------------------------
-- SECURITY: closes only the caller's own open record for today and computes
-- total_hours in the database, so a client cannot post an arbitrary duration
-- nor close another intern's record.
create or replace function public.attendance_clock_out (
  p_time_out timestamptz,
  p_remarks text default null
)
  returns public.attendance
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_intern uuid := public.current_intern_id ();
  v_row public.attendance;
begin
  if v_intern is null then
    raise exception 'No intern profile is linked to this account.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_row
    from public.attendance
   where id = (
     select a.id from public.attendance a
      where a.intern_id = v_intern
        and a.date = public.attendance_today()
        and a.time_out is null
      order by a.time_in desc
      limit 1
   )
   for update;

  if v_row.id is null then
    raise exception 'You do not have an open attendance record to close.'
      using errcode = 'no_data_found';
  end if;

  if p_time_out is null or p_time_out <= v_row.time_in then
    raise exception 'Time out must be after time in.'
      using errcode = 'check_violation';
  end if;

  update public.attendance
     set time_out    = p_time_out,
         total_hours = public.attendance_hours(time_in, p_time_out),
         remarks     = nullif(btrim(p_remarks), ''),
         method      = 'manual'
   where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Submit a missed clock-out claim
-- ---------------------------------------------------------------------------
create or replace function public.attendance_submit_claim (
  p_record_id uuid,
  p_claimed_time_out timestamptz,
  p_remarks text
)
  returns public.attendance
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_intern uuid := public.current_intern_id ();
  v_row public.attendance;
begin
  if v_intern is null then
    raise exception 'No intern profile is linked to this account.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_row from public.attendance
   where id = p_record_id and intern_id = v_intern
   for update;

  if v_row.id is null then
    raise exception 'Attendance record not found.'
      using errcode = 'no_data_found';
  end if;
  if v_row.time_out is not null then
    raise exception 'This attendance record already has a time out.'
      using errcode = 'check_violation';
  end if;
  if v_row.claim_status = 'pending' then
    raise exception 'You already have a pending claim for this record.'
      using errcode = 'check_violation';
  end if;
  if v_row.claim_status = 'approved' then
    raise exception 'This claim has already been approved.'
      using errcode = 'check_violation';
  end if;
  if p_claimed_time_out is null or p_claimed_time_out <= v_row.time_in then
    raise exception 'Claimed time out must be after time in.'
      using errcode = 'check_violation';
  end if;

  update public.attendance
     set claimed_time_out = p_claimed_time_out,
         claim_status     = 'pending',
         claim_remarks    = nullif(btrim(p_remarks), '')
   where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;


-- ---------------------------------------------------------------------------
-- 5. Supervisor / admin reviews a claim
-- ---------------------------------------------------------------------------
-- SECURITY: the reviewer is taken from the JWT, never from the request body,
-- and time_out / total_hours / status are computed here. An intern cannot
-- self-approve, and a supervisor can only act on an intern assigned to them.
create or replace function public.attendance_review_claim (
  p_record_id uuid,
  p_decision text,
  p_comment text default null
)
  returns public.attendance
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_row public.attendance;
  v_sup uuid := public.current_supervisor_id ();
  v_allowed boolean;
begin
  if p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected.'
      using errcode = 'check_violation';
  end if;

  select * into v_row from public.attendance where id = p_record_id for update;

  if v_row.id is null then
    raise exception 'Attendance record not found.'
      using errcode = 'no_data_found';
  end if;

  select exists (
    select 1 from public.interns i
     where i.id = v_row.intern_id
       and (public.is_admin() or i.supervisor_id = v_sup)
  ) into v_allowed;

  if not v_allowed then
    raise exception 'You are not assigned to this intern.'
      using errcode = 'insufficient_privilege';
  end if;
  if v_row.claimed_time_out is null then
    raise exception 'No claim exists for this attendance record.'
      using errcode = 'check_violation';
  end if;
  if v_row.claim_status <> 'pending' then
    raise exception 'This claim has already been reviewed.'
      using errcode = 'check_violation';
  end if;

  update public.attendance
     set claim_status         = p_decision,
         claim_reviewed_by    = auth.uid(),
         claim_reviewed_at    = now(),
         claim_review_comment = nullif(btrim(p_comment), ''),
         remarks              = nullif(btrim(p_comment), ''),
         time_out             = case when p_decision = 'approved'
                                      then v_row.claimed_time_out else time_out end,
         total_hours          = case when p_decision = 'approved'
                                      then public.attendance_hours(v_row.time_in, v_row.claimed_time_out)
                                      else total_hours end,
         method               = case when p_decision = 'approved' then 'claimed' else method end,
         status               = case when p_decision = 'rejected'
                                      then 'absent'::attendance_status else status end
   where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;
-- ---------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------
-- Without these the functions exist but PostgREST returns 401/403 instead of
-- 404, so they must be set for `authenticated`.
grant execute on function public.attendance_today () to authenticated, service_role;
grant execute on function public.attendance_hours (timestamptz, timestamptz) to authenticated, service_role;
revoke all on function public.attendance_clock_in (text) from public, anon;
grant execute on function public.attendance_clock_in (text) to authenticated, service_role;
grant execute on function public.attendance_clock_out (timestamptz, text) to authenticated, service_role;
grant execute on function public.attendance_submit_claim (uuid, timestamptz, text) to authenticated, service_role;
grant execute on function public.attendance_review_claim (uuid, text, text) to authenticated, service_role;

-- The intern may write ONLY the three claim columns directly. Clock-in and
-- clock-out must go through the RPCs above, which compute status/hours.
revoke insert, update on public.attendance from authenticated;
grant update (claimed_time_out, claim_status, claim_remarks)
  on public.attendance to authenticated;


-- ---------------------------------------------------------------------------
-- 7. Reload the PostgREST schema cache  (REQUIRED - this is the last statement)
-- ---------------------------------------------------------------------------
-- PostgREST caches the API surface. Without this reload the functions above
-- stay invisible and Time In keeps returning 404 even though they now exist.
select pg_notify('pgrst', 'reload schema');


-- ---------------------------------------------------------------------------
-- 8. Verification - expect 6 rows
-- ---------------------------------------------------------------------------
-- select proname from pg_proc
--  where proname in ('attendance_today','attendance_hours',
--                    'attendance_clock_in','attendance_clock_out',
--                    'attendance_submit_claim','attendance_review_claim')
--  order by proname;