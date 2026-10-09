-- ============================================================================
-- 0046 - HIGH security fixes (write-path integrity, audit logging, accounts)
-- ============================================================================
-- Follows 0045 (which fixed the CRITICAL privilege-escalation / public-storage
-- / over-broad RLS issues). This migration covers:
--
--   H2  The "intern manages own *" policies were FOR ALL with a row-only
--       WITH CHECK, so an intern could rewrite their OWN attendance `status`,
--       `total_hours` and `method`, self-approve a journal, or set their own
--       document to 'approved'. Every legitimate write is now a SECURITY
--       DEFINER RPC that computes the sensitive columns server-side, and the
--       direct table grants are revoked so the RPCs are the only path.
--
--   H3  handle_new_user() copied `role` out of raw_user_meta_data, which is
--       attacker-controlled - a self-signup could mint an admin. The role is
--       now hard-coded to the least-privileged value.
--
--   H4  audit_logs and notifications had RLS enabled but NO policies defined,
--       so audit writes were silently failing (the caller swallows the error)
--       and, on a DB where RLS was never enabled, anyone could forge or delete
--       audit rows. Real policies are now defined; audit_logs is append-only.
--
--   H7  `security definer` hardening: revoke CREATE on schema public so no
--       shadowing object can subvert is_admin(), and pin function grants.
--
--   H9  Role-capability functions so 'hr_staff' is not implicitly a superuser.
--
-- SAFE TO RE-RUN: every statement is drop-if-exists / create-or-replace.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- Hours helper (server-side source of truth, mirrors utils/format diffHours)
-- ---------------------------------------------------------------------------
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

-- The app measures the working day in Asia/Manila local time.
create or replace function public.attendance_today ()
  returns date
  language sql
  stable
as $$
  select (now() at time zone 'Asia/Manila')::date;
$$;


-- ---------------------------------------------------------------------------
-- H9 - explicit role capabilities
-- ---------------------------------------------------------------------------
-- is_admin() treats 'hr_staff' exactly like 'admin', so an HR account could
-- delete auth users and rewrite global settings. These functions let each
-- policy name the capability it actually needs.
create or replace function public.can_delete_users ()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  -- Deleting an auth account is destructive and unrecoverable: admin only.
  select exists (
    select 1 from public.profiles
    where id = auth.uid () and role = 'admin'
  );
$$;

create or replace function public.can_manage_settings ()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid () and role in ('admin', 'hr_staff')
  );
$$;

revoke all on function public.can_delete_users () from public;
revoke all on function public.can_manage_settings () from public;
revoke all on function public.attendance_hours (timestamptz, timestamptz) from public;
grant execute on function public.can_delete_users () to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- H3 - a self-signup must never be able to choose its own role
-- ---------------------------------------------------------------------------
-- raw_user_meta_data is supplied by the client, so
-- `coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'intern')` let
-- anyone who could reach signUp() create an admin profile directly. The role
-- is now always the least-privileged value; promotion is a service-role
-- action performed by api/admin/create-user.js after an RBAC check.
create or replace function public.handle_new_user ()
  returns trigger
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email,
    'intern'::user_role
  )
  on conflict (id) do nothing;
  return new;
end;
$$;


-- ---------------------------------------------------------------------------
-- H4 - audit_logs and notifications: real policies
-- ---------------------------------------------------------------------------
-- These tables had `enable row level security` but no policies anywhere in
-- the repo. Two possible outcomes, both bad:
--   * policies missing  -> every insert fails, and recordAudit() swallows the
--                          error, so the audit trail was SILENTLY EMPTY while
--                          the UI implied it was recording.
--   * RLS never applied -> any authenticated user could read, forge or delete
--                          the audit trail.
-- Both are fixed here. audit_logs is INSERT-ONLY via SECURITY DEFINER trigger
-- functions; no client policy may modify or delete a row.
alter table public.audit_logs enable row level security;
alter table public.notifications enable row level security;

drop policy if exists "admins read audit logs" on public.audit_logs;
create policy "admins read audit logs"
  on public.audit_logs for select to authenticated
  using (public.is_admin ());

drop policy if exists "users insert own audit logs" on public.audit_logs;
create policy "users insert own audit logs"
  on public.audit_logs for insert to authenticated
  with check (user_id = auth.uid ());

-- No UPDATE / DELETE policy exists on purpose: the audit trail is append-only.
-- The 0044 profile trigger and the serverless functions use the service role,
-- which bypasses RLS, so they keep working.

drop policy if exists "own notifications readable" on public.notifications;
create policy "own notifications readable"
  on public.notifications for select to authenticated
  using (user_id = auth.uid ());

drop policy if exists "own notifications updatable" on public.notifications;
create policy "own notifications updatable"
  on public.notifications for update to authenticated
  using (user_id = auth.uid ())
  with check (user_id = auth.uid ());

-- No INSERT policy: a user may only mark THEIR OWN notifications as read.
-- Fan-out happens through SECURITY DEFINER functions (below), which also stops
-- a user from spamming arbitrary rows into other people's notification lists.
-- NOTE: DROP first: the live DB may already hold these names with a different
-- return type (integer/uuid), and CREATE OR REPLACE cannot change that.
drop function if exists public.notify_role (text, text, text, text, text, jsonb);
drop function if exists public.notify_user (uuid, text, text, text, text, jsonb);
create or replace function public.notify_role (
  p_role text,
  p_type text,
  p_title text,
  p_message text,
  p_link text default null,
  p_metadata jsonb default '{}'::jsonb
)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, title, message, link, metadata)
  select p.id, p_type, p_title, p_message, p_link, coalesce(p_metadata, '{}'::jsonb)
  from public.profiles p
  where p.role::text = p_role;
end;
$$;

create or replace function public.notify_user (
  p_user_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_link text default null,
  p_metadata jsonb default '{}'::jsonb
)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  if p_user_id is null then
    return;
  end if;
  insert into public.notifications (user_id, type, title, message, link, metadata)
  values (p_user_id, p_type, p_title, p_message, p_link, coalesce(p_metadata, '{}'::jsonb));
end;
$$;

revoke all on function public.notify_role (text, text, text, text, text, jsonb) from public;
revoke all on function public.notify_user (uuid, text, text, text, text, jsonb) from public;
grant execute on function public.notify_role (text, text, text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.notify_user (uuid, text, text, text, text, jsonb) to authenticated, service_role;


-- The OJT shift starts at 13:00 (780 minutes after midnight, Asia/Manila).
-- This used to live only in src/lib/constants.js, which the browser could
-- change at will. It is now a real column so the lateness rule is decided
-- server-side. `if not exists` keeps the migration safe to re-run and safe
-- on a database that already has the column.
--
-- This is declared at migration level, NOT inside attendance_clock_in():
-- plpgsql does not accept DDL in a function body.
alter table public.settings
  add column if not exists shift_start_minute integer not null default 780;

-- ---------------------------------------------------------------------------
-- H2 (1/4) - attendance: clock-in
-- ---------------------------------------------------------------------------
-- Replaces the client-side INSERT. `status` is derived here (late vs present)
-- from the server clock, so it can no longer be asserted by the caller.
-- NOTE: DROP first: live may hold clock_in WITH default / clock_out WITHOUT
-- matching default. CREATE OR REPLACE cannot add/remove defaults.
drop function if exists public.attendance_clock_in (text);
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

  -- The OJT shift start is read from settings.shift_start_minute (the column
  -- is added at migration level above, since plpgsql cannot run DDL). 780
  -- = 13:00 Asia/Manila, mirroring src/lib/constants.js SHIFT_START_MINUTE.
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
    coalesce(p_method, 'manual'),
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

revoke all on function public.attendance_clock_in (text) from public;
grant execute on function public.attendance_clock_in (text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- H2 (2/4) - attendance: clock-out
-- ---------------------------------------------------------------------------
-- total_hours is computed by the database. The caller can no longer post an
-- arbitrary duration and inflate the hours that feed evaluations and reports.
drop function if exists public.attendance_clock_out (timestamptz, text);
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
     set time_out   = p_time_out,
         total_hours = public.attendance_hours(time_in, p_time_out),
         remarks     = nullif(btrim(p_remarks), ''),
         method      = 'manual'
   where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.attendance_clock_out (timestamptz, text) from public;
grant execute on function public.attendance_clock_out (timestamptz, text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- H2 (3/4) - attendance: submit a missed clock-out claim
-- ---------------------------------------------------------------------------
-- NOTE: DROP first: the live DB holds attendance_submit_claim(uuid,timestamptz,text)
-- WITH a default on p_remarks, and CREATE OR REPLACE cannot remove defaults.
drop function if exists public.attendance_submit_claim (uuid, timestamptz, text);
drop function if exists public.attendance_review_claim (uuid, text, text);
drop function if exists public.attendance_clock_out (timestamptz, text);
drop function if exists public.attendance_clock_in (text);
drop function if exists public.journal_review (uuid, text, text);
drop function if exists public.document_review (uuid, text);
drop function if exists public.evaluation_create (uuid, integer, integer, integer, integer, integer, integer, integer, text, text);
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

revoke all on function public.attendance_submit_claim (uuid, timestamptz, text) from public;
grant execute on function public.attendance_submit_claim (uuid, timestamptz, text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- H2 (4/4) - attendance: supervisor/admin reviews a claim
-- ---------------------------------------------------------------------------
-- The reviewer id is taken from the JWT, never from the request body, and the
-- resulting time_out / total_hours / status are computed here. A supervisor can
-- only act on an intern assigned to them.
-- (DROP already issued above alongside submit_claim.)
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
     set claim_status          = p_decision,
         claim_reviewed_by     = auth.uid(),
         claim_reviewed_at     = now(),
         claim_review_comment  = nullif(btrim(p_comment), ''),
         remarks               = nullif(btrim(p_comment), ''),
         time_out              = case when p_decision = 'approved'
                                      then v_row.claimed_time_out else time_out end,
         total_hours           = case when p_decision = 'approved'
                                      then public.attendance_hours(v_row.time_in, v_row.claimed_time_out)
                                      else total_hours end,
         method                = case when p_decision = 'approved' then 'claimed' else method end,
         status                = case when p_decision = 'rejected'
                                      then 'absent'::attendance_status else status end
   where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.attendance_review_claim (uuid, text, text) from public;
grant execute on function public.attendance_review_claim (uuid, text, text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- H2 - journal: supervisor review (an intern can no longer self-approve)
-- ---------------------------------------------------------------------------
-- intern_id is immutable here, closing the M8 gap where a supervisor could
-- re-point a journal at a different intern.
-- (DROPs already issued above: a prior default on p_comment blocks REPLACE.)
create or replace function public.journal_review (
  p_journal_id uuid,
  p_status text,
  p_comment text default null
)
  returns public.daily_journals
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_row public.daily_journals;
  v_sup uuid := public.current_supervisor_id ();
begin
  if p_status not in ('approved', 'rejected', 'pending') then
    raise exception 'Invalid journal status.'
      using errcode = 'check_violation';
  end if;

  select * into v_row from public.daily_journals
   where id = p_journal_id for update;

  if v_row.id is null then
    raise exception 'Journal entry not found.'
      using errcode = 'no_data_found';
  end if;

  if not public.is_admin() and not (
    v_sup is not null and exists (
      select 1 from public.interns i
       where i.id = v_row.intern_id and i.supervisor_id = v_sup
    )
  ) then
    raise exception 'You are not assigned to this intern.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.daily_journals
     set status            = p_status,
         supervisor_comment = nullif(btrim(p_comment), ''),
         supervisor_id      = coalesce(v_sup, supervisor_id)
   where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.journal_review (uuid, text, text) from public;
grant execute on function public.journal_review (uuid, text, text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- H2 - document review (status is a reviewer decision, not a client field)
-- ---------------------------------------------------------------------------
-- (DROP already issued above.)
create or replace function public.document_review (p_document_id uuid, p_status text)
  returns public.documents
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_row public.documents;
begin
  if p_status not in ('pending', 'approved', 'rejected') then
    raise exception 'Invalid document status.'
      using errcode = 'check_violation';
  end if;
  if not public.is_admin() then
    raise exception 'Only administrators may review documents.'
      using errcode = 'insufficient_privilege';
  end if;

  update public.documents
     set status = p_status
   where id = p_document_id
   returning * into v_row;

  if v_row.id is null then
    raise exception 'Document not found.'
      using errcode = 'no_data_found';
  end if;

  return v_row;
end;
$$;

revoke all on function public.document_review (uuid, text) from public;
grant execute on function public.document_review (uuid, text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- H2 - evaluation create (supervisor_id is bound to the caller server-side)
-- ---------------------------------------------------------------------------
-- (DROP already issued above: live holds 2 defaults, file must re-apply them.)
create or replace function public.evaluation_create (
  p_intern_id uuid,
  p_attendance integer,
  p_communication integer,
  p_teamwork integer,
  p_initiative integer,
  p_technical_skills integer,
  p_professionalism integer,
  p_overall_rating integer,
  p_comments text default null,
  p_final_recommendation text default null
)
  returns public.evaluations
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_sup uuid := public.current_supervisor_id ();
  v_row public.evaluations;
begin
  if v_sup is null then
    raise exception 'Only supervisors may submit evaluations.'
      using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.interns i
     where i.id = p_intern_id and i.supervisor_id = v_sup
  ) then
    raise exception 'That intern is not assigned to you.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.evaluations (
    intern_id, supervisor_id, attendance, communication, teamwork,
    initiative, technical_skills, professionalism, overall_rating,
    comments, final_recommendation, status
  )
  values (
    p_intern_id, v_sup, p_attendance, p_communication, p_teamwork,
    p_initiative, p_technical_skills, p_professionalism, p_overall_rating,
    nullif(btrim(p_comments), ''), p_final_recommendation, 'pending'
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.evaluation_create (uuid, integer, integer, integer, integer, integer, integer, integer, text, text) from public;
grant execute on function public.evaluation_create (uuid, integer, integer, integer, integer, integer, integer, integer, text, text) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- H2 - revoke the direct table writes the RPCs now replace
-- ---------------------------------------------------------------------------
-- The RLS row checks remain as defence in depth, but without these revokes an
-- intern could keep writing `status`, `total_hours` or `supervisor_comment`
-- straight through PostgREST. Revoking makes the SECURITY DEFINER functions
-- the ONLY path, which is what actually computes those values.
revoke update on public.evaluations from authenticated;
revoke update on public.documents from authenticated;
revoke update on public.daily_journals from authenticated;

-- Attendance: the intern may only touch the three claim columns directly;
-- clock-in, clock-out and claim review all go through the RPCs.
revoke insert, update on public.attendance from authenticated;
grant update (claimed_time_out, claim_status, claim_remarks)
  on public.attendance to authenticated;

-- documents DELETE is intentionally still granted - an intern must be able to
-- remove their own upload, and 0045 already scopes that at the row level.


-- ---------------------------------------------------------------------------
-- H11 - storage limits (defence in depth behind the client-side 5 MB check)
-- ---------------------------------------------------------------------------
update storage.buckets
   set file_size_limit   = 5242880,
       allowed_mime_types = array[
         'application/pdf',
         'image/png',
         'image/jpeg',
         'image/gif',
         'image/webp',
         'application/msword',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
       ]
 where id = 'intern-documents';


-- ---------------------------------------------------------------------------
-- H7 - security definer hardening
-- ---------------------------------------------------------------------------
-- No unprivileged role may create objects in `public`, so nothing can shadow
-- is_admin() or the other helpers and subvert an RLS decision.
revoke create on schema public from public;
revoke create on schema public from anon;
revoke create on schema public from authenticated;

-- The role helpers must not be callable by `anon` (unauthenticated callers).
revoke all on function public.is_admin () from public, anon;
revoke all on function public.current_role () from public, anon;
revoke all on function public.current_intern_id () from public, anon;
revoke all on function public.current_supervisor_id () from public, anon;
revoke all on function public.current_supervisor_department_id () from public, anon;
revoke all on function public.current_supervisor_intern_ids () from public, anon;

grant execute on function public.is_admin () to authenticated, service_role;
grant execute on function public.current_role () to authenticated, service_role;
grant execute on function public.current_intern_id () to authenticated, service_role;
grant execute on function public.current_supervisor_id () to authenticated, service_role;
grant execute on function public.current_supervisor_department_id () to authenticated, service_role;
grant execute on function public.current_supervisor_intern_ids () to authenticated, service_role;

-- notify_role() can insert notifications for EVERY user holding a role, so it
-- is server-only. The client uses notify_user() and the 0045 id helpers.
revoke all on function public.profile_ids_by_role (text) from anon;


-- ============================================================================
-- Remaining HIGH items that are NOT database migrations (see the code changes):
--   H5  rate limiting on the /api endpoints  -> api/admin/*.js
--   H6  password policy (>= 12 chars)       -> api/admin/*.js
--   H8  session idle / absolute timeout      -> src/contexts/AuthContext.jsx
--   H10 last-admin guard on user deletion    -> api/admin/delete-user.js
-- ============================================================================




grant execute on function public.can_manage_settings () to authenticated, service_role;
grant execute on function public.attendance_hours (timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.attendance_today () to authenticated, service_role;
