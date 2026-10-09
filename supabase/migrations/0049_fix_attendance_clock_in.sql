-- ============================================================================
-- 0049 - FIX: attendance_clock_in(p_method) missing from the PostgREST cache
-- ============================================================================
-- Symptom fixed by this migration (Intern Dashboard -> "Time In"):
--
--   API Error: Could not find the function public.attendance_clock_in(p_method)
--              in the schema cache
--   Network:   Failed to load resource: the server responded with a status of 404
--
-- The RPC is defined by migration 0046 and re-applied by the 0048 repair batch,
-- so on a healthy database this file is a no-op. The live project was missing
-- the RPC because those batches were never applied; and a partial apply can
-- leave behind an older overload with a different argument signature, which is
-- the other way PostgREST ends up unable to resolve the `p_method` argument.
--
-- This migration is the focused, safe repair. It:
--   * (re)creates the attendance helpers (clock-in needs attendance_today;
--     attendance_hours backs clock-out / claim review),
--   * removes any stale/mismatched attendance_clock_in overloads so the
--     canonical `(text)` signature is the only candidate,
--   * (re)creates public.attendance_clock_in(p_method text default 'manual'),
--   * restores the EXECUTE grants for `authenticated`,
--   * and reloads the PostgREST schema cache so the 404 stops.
--
-- APPLY WITH:  Supabase Dashboard -> SQL Editor, or `supabase db push`.
--
-- SAFE TO RE-RUN: every statement is create-or-replace / add-if-not-exists /
-- drop-if-exists. No table is dropped, truncated or altered destructively, and
-- no row is inserted, updated or deleted.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 0. Shift start column - server-side source of truth for late vs present.
--    780 = 13:00 Asia/Manila, mirroring SHIFT_START_MINUTE in
--    src/lib/constants.js. Declared at statement level because plpgsql cannot
--    run DDL inside a function body.
-- ---------------------------------------------------------------------------
alter table public.settings
  add column if not exists shift_start_minute integer not null default 780;


-- ---------------------------------------------------------------------------
-- 1. Attendance helpers (clock-in reads attendance_today; attendance_hours
--    backs clock-out and claim review)
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
-- 2. Drop any stale / mismatched overloads of attendance_clock_in
-- ---------------------------------------------------------------------------
-- A leftover overload (a different argument name or type) is exactly what
-- makes PostgREST report `Could not find the function ...(p_method)`. Every
-- variant whose identity signature is not `(text)` is removed here so the
-- canonical function below is the only one the schema cache can resolve.
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


-- ---------------------------------------------------------------------------
-- 3. Clock in  (the function the frontend calls via { p_method })
-- ---------------------------------------------------------------------------
-- SECURITY: the row is bound to current_intern_id() from the caller's JWT, NOT
-- to an intern id sent by the browser, and `status` (present/late) is derived
-- from the SERVER clock. A client cannot claim `present` for a late arrival,
-- and cannot clock in on someone else's behalf.
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

  -- The OJT shift start is read from settings.shift_start_minute (added in
  -- section 0 above). 780 = 13:00 Asia/Manila.
  select coalesce(
    (select s.shift_start_minute from public.settings s where s.id = 1),
    780
  )
    into v_shift;

  insert into public.attendance (intern_id, date, time_in, method, status)
  values (
    v_intern,
    v_today,
    now(),
    coalesce(nullif(btrim(p_method), ''), 'manual'),
    case
      when extract(hour from now() at time zone 'Asia/Manila') * 60
           + extract(minute from now() at time zone 'Asia/Manila')
           > v_shift
      then 'late'::attendance_status
      else 'present'::attendance_status
    end
  )
  returning * into v_row;

  return v_row;
end;
$$;


-- ---------------------------------------------------------------------------
-- 4. Grants / revokes
-- ---------------------------------------------------------------------------
-- Postgres grants EXECUTE to PUBLIC by default. PostgREST only exposes a
-- function to a role that holds EXECUTE, so without the grant below the
-- function exists but the endpoint returns 401/403 instead of 200.
revoke all on function public.attendance_clock_in (text) from public, anon;
grant execute on function public.attendance_clock_in (text) to authenticated, service_role;

revoke all on function public.attendance_today () from public, anon;
grant execute on function public.attendance_today () to authenticated, service_role;

revoke all on function public.attendance_hours (timestamptz, timestamptz) from public, anon;
grant execute on function public.attendance_hours (timestamptz, timestamptz) to authenticated, service_role;

-- NOTE: this migration is deliberately ADDITIVE. It does NOT revoke the
-- direct INSERT/UPDATE grants on public.attendance, because the app relies on
-- clock-out / claim RPCs that live in the same 0046 / 0048 batch. Locking the
-- table down here without those RPCs present would break Time Out on a
-- database that has only had this focused repair applied. The table-level
-- lockdown is part of 0046 / 0048 (and PASTE-IN-SQL-EDITOR.sql).


-- ---------------------------------------------------------------------------
-- 5. Reload the PostgREST schema cache  (REQUIRED - keep this last)
-- ---------------------------------------------------------------------------
-- PostgREST serves from a cached copy of the API surface. Without this reload
-- the newly created function stays invisible and Time In keeps returning 404
-- even though pg_proc now lists it.
notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------------
-- 6. Verification - expect one row: attendance_clock_in | text
-- ---------------------------------------------------------------------------
-- select p.proname, pg_get_function_identity_arguments(p.oid) as signature
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.proname = 'attendance_clock_in';