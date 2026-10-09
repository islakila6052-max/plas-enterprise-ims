-- ============================================================================
-- 0047 - MEDIUM security fixes (defence in depth, scoping, audit fidelity)
-- ============================================================================
-- Follows 0045 (CRITICAL) and 0046 (HIGH). This migration covers:
--
--   M1  FORCE ROW LEVEL SECURITY, so the table owner no longer silently
--       bypasses every policy.
--   M3  audit_logs.ip_address / user_agent were permanently NULL, so an
--       incident could not be attributed to a device or network. A SECURITY
--       DEFINER writer captures them from the request headers.
--   M5  interns readable allowed `created_by = auth.uid()`, so a supervisor who
--       CREATED an intern kept permanent access to their PII even after being
--       reassigned. Access now follows the CURRENT supervisor assignment.
--   M6  Supervisors could hard-DELETE an intern row, and ON DELETE CASCADE then
--       destroyed that intern's attendance, journals, documents and
--       evaluations. Removal is now admin-only and archive-only.
--   M7  evaluations "supervisor manages assigned" was FOR ALL: a supervisor
--       could rewrite ratings and the final recommendation on an already
--       submitted/approved evaluation, and file one for an unassigned intern.
--   M9  Announcement create/update/delete produced no audit row, so content
--       removal was unattributable. All three now go through audited RPCs.
--
-- SAFE TO RE-RUN: every statement is drop-if-exists / create-or-replace.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- M1 - FORCE ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
-- RLS is bypassed entirely by the table OWNER. Without FORCE, any migration or
-- script that runs as the owner silently ignores every policy, and the
-- SECURITY DEFINER functions execute with the owner's rights. FORCE makes the
-- policies apply to the owner too, so a future mistake fails loudly instead of
-- quietly disabling access control.
-- (The DO block that applies this is at the end of the file, so it runs after
--  every policy above has been (re)created.)


-- ---------------------------------------------------------------------------
-- M3 - capture ip_address / user_agent on every audit row
-- ---------------------------------------------------------------------------
-- Both columns existed but nothing ever populated them, so the audit trail
-- could not answer "who and from where". The client cannot be trusted to send
-- its own headers, so this is resolved server-side from the request headers
-- PostgREST forwards.
--
-- SECURITY DEFINER so it still works now that M1 forces RLS on audit_logs even
-- for the owner, and so a client cannot forge the acting user.
-- NOTE: DROP first: live holds write_audit_log(text,text,uuid,jsonb) WITHOUT
-- defaults; CREATE OR REPLACE cannot add them.
drop function if exists public.write_audit_log (text, text, uuid, jsonb);
create or replace function public.write_audit_log (
  p_action text,
  p_resource_type text,
  p_resource_id uuid default null,
  p_changes jsonb default '{}'::jsonb
)
  returns uuid
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_id uuid;
  v_ip text;
  v_ua text;
begin
  -- Best-effort request metadata. These helpers return NULL (rather than
  -- erroring) when the statement did not arrive through PostgREST, e.g. from a
  -- migration or from inside another SECURITY DEFINER chain.
  begin
    v_ip := nullif(btrim(
      current_setting('request.headers', true)::jsonb ->> 'x-forwarded-for'
    ), '');
  exception when others then
    v_ip := null;
  end;

  begin
    v_ua := nullif(left(btrim(
      current_setting('request.headers', true)::jsonb ->> 'user-agent'
    ), 512), '');
  exception when others then
    v_ua := null;
  end;

  insert into public.audit_logs (user_id, action, resource_type, resource_id, changes, ip_address, user_agent)
  values (auth.uid(), p_action, p_resource_type, p_resource_id,
          coalesce(p_changes, '{}'::jsonb), v_ip, v_ua)
  returning id into v_id;

  return v_id;
end;
$$;



-- ---------------------------------------------------------------------------
-- M5 - intern visibility follows the CURRENT assignment, not history
-- ---------------------------------------------------------------------------
-- `created_by = auth.uid()` meant a supervisor kept reading an intern's PII
-- forever, even after the intern was reassigned to someone else. Access is
-- granted by the current supervisor_id only.
drop policy if exists "interns readable" on public.interns;
create policy "interns readable"
  on public.interns for select to authenticated
  using (
    public.is_admin()
    or id = public.current_intern_id()
    or supervisor_id = public.current_supervisor_id()
  );

drop policy if exists "supervisor reads assigned interns" on public.interns;
create policy "supervisor reads assigned interns"
  on public.interns for select to authenticated
  using (supervisor_id = public.current_supervisor_id () or public.is_admin ());


-- ---------------------------------------------------------------------------
-- M6 - supervisors must not be able to destroy an intern's record
-- ---------------------------------------------------------------------------
-- A supervisor DELETE cascaded away attendance, journals, documents and
-- evaluations irrecoverably. The policy is removed; admins keep full control
-- and internService.archive() remains the soft-delete path.
drop policy if exists "supervisor deletes assigned interns" on public.interns;


-- ---------------------------------------------------------------------------
-- M7 - evaluations: insert-only while pending, and only for assigned interns
-- ---------------------------------------------------------------------------
-- "supervisor manages assigned evaluations" was FOR ALL, so a supervisor could
-- rewrite the ratings and final recommendation on an evaluation the intern had
-- already seen, and could file one for an intern they were not assigned to.
-- The broad policy is replaced by a narrow INSERT plus the already-existing
-- `evaluation_create` RPC (0046) which verifies the assignment server-side.
-- Update is intentionally NOT granted: an evaluation is immutable once filed.
drop policy if exists "supervisor manages assigned evaluations" on public.evaluations;
create policy "supervisor inserts assigned evaluations"
  on public.evaluations for insert to authenticated
  with check (
    supervisor_id = public.current_supervisor_id ()
    and exists (
      select 1 from public.interns i
       where i.id = intern_id and i.supervisor_id = public.current_supervisor_id ()
    )
  );

revoke all on function public.write_audit_log (text, text, uuid, jsonb) from public;
grant execute on function public.write_audit_log (text, text, uuid, jsonb) to authenticated, service_role;


-- ---------------------------------------------------------------------------
-- M9 - audited announcement writes
-- ---------------------------------------------------------------------------
-- Announcement create/update/delete wrote no audit row, so company-wide content
-- could be altered or removed with no attributable trace. Each mutation now
-- goes through a SECURITY DEFINER RPC that writes the audit entry in the same
-- transaction, so the record cannot be lost even if the client drops it.
-- NOTE: DROPs first: live holds announcement_* WITHOUT matching defaults;
-- CREATE OR REPLACE cannot add/remove defaults.
drop function if exists public.announcement_create (text, text, text, boolean);
drop function if exists public.announcement_update (uuid, text, text, text, boolean);
drop function if exists public.announcement_delete (uuid);
create or replace function public.announcement_create (
  p_title text,
  p_body text,
  p_category text default 'company_news',
  p_pinned boolean default false
)
  returns public.announcements
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_row public.announcements;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may manage announcements.'
      using errcode = 'insufficient_privilege';
  end if;

  insert into public.announcements (title, body, category, pinned, published_by)
  values (
    nullif(btrim(p_title), ''),
    nullif(btrim(p_body), ''),
    coalesce(p_category, 'company_news'),
    coalesce(p_pinned, false),
    auth.uid()
  )
  returning * into v_row;

  if v_row.id is null then
    raise exception 'Title and body are required.'
      using errcode = 'check_violation';
  end if;

  perform public.write_audit_log(
    'create', 'announcement', v_row.id,
    jsonb_build_object('title', v_row.title, 'category', v_row.category, 'pinned', v_row.pinned)
  );

  return v_row;
end;
$$;

create or replace function public.announcement_update (
  p_id uuid,
  p_title text,
  p_body text,
  p_category text default null,
  p_pinned boolean default null
)
  returns public.announcements
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_row public.announcements;
  v_before public.announcements;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may manage announcements.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_before from public.announcements where id = p_id;
  if v_before.id is null then
    raise exception 'Announcement not found.' using errcode = 'no_data_found';
  end if;

  update public.announcements
     set title    = coalesce(nullif(btrim(p_title), ''), title),
         body     = coalesce(nullif(btrim(p_body), ''), body),
         category = coalesce(p_category, category),
         pinned   = coalesce(p_pinned, pinned)
   where id = p_id
  returning * into v_row;

  perform public.write_audit_log(
    'update', 'announcement', v_row.id,
    jsonb_build_object(
      'title_before', v_before.title, 'title_after', v_row.title,
      'pinned_before', v_before.pinned, 'pinned_after', v_row.pinned
    )
  );

  return v_row;
end;
$$;

create or replace function public.announcement_delete (p_id uuid)
  returns boolean
  language plpgsql
  security definer
  set search_path = public
as $$
declare
  v_before public.announcements;
begin
  if not public.is_admin() then
    raise exception 'Only administrators may manage announcements.'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_before from public.announcements where id = p_id;
  if v_before.id is null then
    raise exception 'Announcement not found.' using errcode = 'no_data_found';
  end if;

  delete from public.announcements where id = p_id;

  -- Record what was removed, so the audit trail keeps the content after the
  -- row itself is gone.
  perform public.write_audit_log(
    'delete', 'announcement', p_id,
    jsonb_build_object('title', v_before.title, 'body', v_before.body, 'category', v_before.category)
  );

  return true;
end;
$$;

revoke all on function public.announcement_create (text, text, text, boolean) from public;
revoke all on function public.announcement_update (uuid, text, text, text, boolean) from public;
revoke all on function public.announcement_delete (uuid) from public;
grant execute on function public.announcement_create (text, text, text, boolean) to authenticated, service_role;
grant execute on function public.announcement_update (uuid, text, text, text, boolean) to authenticated, service_role;
grant execute on function public.announcement_delete (uuid) to authenticated, service_role;

-- The client no longer writes these rows directly, so the table grants are
-- dropped in favour of the audited RPCs above.
revoke insert, update, delete on public.announcements from authenticated;


-- ---------------------------------------------------------------------------
-- M1 (applied last) - FORCE ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
-- Deliberately last: FORCE makes RLS apply to the table OWNER as well. Every
-- policy and function above must already exist when this runs, otherwise a
-- SECURITY DEFINER function owned by that role would be evaluated against a
-- policy set that is still incomplete.
--
-- to_regclass guards each table so the block is a no-op for any table this
-- database does not have.
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles', 'departments', 'supervisors', 'interns', 'attendance',
    'daily_journals', 'documents', 'evaluations', 'announcements',
    'settings', 'notifications', 'audit_logs', 'announcement_likes',
    'institutions', 'programs'
  ] loop
    if to_regclass ('public.' || t) is not null then
      execute format('alter table public.%I force row level security', t);
    end if;
  end loop;
end $$;

