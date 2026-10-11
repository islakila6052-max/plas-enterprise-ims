-- S5: browser callers cannot manufacture notifications. Business writes emit
-- them inside their database transaction. Idempotent; emits no historical events.
begin;

-- The production create services upsert on profile_id. The migration-built
-- schema lacked the uniqueness those upserts require (PostgREST 42P10).
-- Abort on duplicate links rather than delete or relink existing accounts.
create unique index if not exists interns_profile_id_key on public.interns(profile_id);
create unique index if not exists supervisors_profile_id_key on public.supervisors(profile_id);

create schema if not exists ims_private;
revoke all on schema ims_private from public, anon, authenticated;

-- One welcome per account, even if provisioning is retried or relinked.
create table if not exists ims_private.notified_accounts (
  profile_id uuid primary key references public.profiles(id) on delete cascade
);
alter table ims_private.notified_accounts enable row level security;
revoke all on ims_private.notified_accounts from public, anon, authenticated;

-- Fix the recorded 42804 TEXT -> ENUM defect while retaining server-only RPCs.
create or replace function public.notify_user (
  p_user_id uuid, p_type text, p_title text, p_message text,
  p_link text default null, p_metadata jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = pg_catalog as $$
begin
  if p_user_id is not null then
    insert into public.notifications (user_id, type, title, message, link, metadata)
    values (p_user_id, p_type::public.notification_type, p_title, p_message, p_link,
            coalesce(p_metadata, '{}'::jsonb));
  end if;
end;
$$;

create or replace function public.notify_role (
  p_role text, p_type text, p_title text, p_message text,
  p_link text default null, p_metadata jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = pg_catalog as $$
begin
  insert into public.notifications (user_id, type, title, message, link, metadata)
  select p.id, p_type::public.notification_type, p_title, p_message, p_link,
         coalesce(p_metadata, '{}'::jsonb)
  from public.profiles p where p.role::text = p_role;
end;
$$;

-- Remove all public-schema overloads from browser reach, including PUBLIC
-- inheritance. Preserve trusted service access to the existing RPC interface.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as signature from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('notify_user', 'notify_role')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.signature);
    execute format('grant execute on function %s to service_role', f.signature);
  end loop;
end;
$$;

-- Broad grants and permissive policies survived older repairs. Close both.
revoke all on public.notifications from public, anon;
revoke all on public.notifications from authenticated;
grant select, delete on public.notifications to authenticated;
grant update (is_read, read_at) on public.notifications to authenticated;
grant all on public.notifications to service_role;
alter table public.notifications enable row level security;

do $$
declare p record; role_list text;
begin
  for p in select * from pg_catalog.pg_policies
    where schemaname = 'public' and tablename = 'notifications' and cmd <> 'DELETE'
  loop
    -- Keep the DELETE portion of old ALL policies, outside this write fix.
    if p.cmd = 'ALL' then
      select string_agg(quote_ident(r), ', ') into role_list from unnest(p.roles) r;
      execute format('drop policy if exists %I on public.notifications', p.policyname || ' delete');
      execute format('create policy %I on public.notifications for delete to %s using (%s)',
        p.policyname || ' delete', role_list, coalesce(p.qual, 'true'));
    end if;
    execute format('drop policy %I on public.notifications', p.policyname);
  end loop;
end;
$$;
create policy notifications_read_own on public.notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy notifications_mark_own_read on public.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- An invoker guard also protects the content if broad grants are reapplied.
create or replace function ims_private.guard_notification_write ()
returns trigger language plpgsql set search_path = pg_catalog as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      raise exception 'Notifications are created only by trusted events.' using errcode = 'insufficient_privilege';
    end if;
    if old.user_id is distinct from auth.uid()
       or (to_jsonb(new) - 'is_read' - 'read_at') is distinct from (to_jsonb(old) - 'is_read' - 'read_at') then
      raise exception 'Only your own notification read markers may change.' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_notification_write on public.notifications;
create trigger guard_notification_write before insert or update on public.notifications
  for each row execute function ims_private.guard_notification_write();

-- GoTrue's INSERT creates a temporary intern before app_metadata is applied.
-- The account is ready only after the UI's business upsert records created_by.
-- No welcome is emitted from auth/profile INSERTs or role synchronization.
create or replace function ims_private.notify_ready_account (
  p_profile_id uuid, p_role text, p_supervisor_id uuid, p_full_name text
) returns void language plpgsql security definer set search_path = pg_catalog as $$
begin
  if not exists (
    select 1 from public.profiles p join auth.users u on u.id = p.id
    where p.id = p_profile_id and p.role::text = p_role
      and u.raw_app_meta_data ->> 'role' = p_role and u.email_confirmed_at is not null
  ) then return; end if;
  insert into ims_private.notified_accounts(profile_id) values (p_profile_id) on conflict do nothing;
  if not found then return; end if;

  if p_role = 'intern' then
    perform public.notify_user(p_profile_id, 'account_created', 'Your account is ready',
      'Your internship account was created. You can now log in.', '/intern',
      jsonb_build_object('profile_id', p_profile_id));
  elsif p_role = 'supervisor' then
    perform public.notify_user(p_profile_id, 'account_created', 'Your supervisor account is ready',
      format('Welcome %s! You have been created as a supervisor. You can now log in and manage interns.', p_full_name),
      '/supervisor', jsonb_build_object('profile_id', p_profile_id));
    insert into public.notifications (user_id, type, title, message, link, metadata)
    select p.id, 'announcement', 'New supervisor created',
      format('%s has been created as a new supervisor.', p_full_name),
      case when p.role = 'admin' then '/admin/supervisors' else '/supervisor' end,
      jsonb_build_object('supervisor_id', p_supervisor_id, 'supervisor_name', p_full_name)
    from public.profiles p where p.role in ('admin', 'supervisor');
  end if;
end;
$$;

create or replace function ims_private.notify_intern_event ()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare v_supervisor uuid; v_previous_supervisor uuid; v_previous_status text;
begin
  if tg_op = 'UPDATE' then
    v_previous_supervisor := old.supervisor_id;
    v_previous_status := old.status::text;
  end if;
  if new.supervisor_id is not null and new.supervisor_id is distinct from v_previous_supervisor then
    select s.profile_id into v_supervisor from public.supervisors s
      join public.profiles p on p.id = s.profile_id and p.role = 'supervisor'
      where s.id = new.supervisor_id;
    perform public.notify_user(v_supervisor, 'intern_assigned',
      case when v_previous_supervisor is null then 'New intern assigned' else 'Intern reassigned' end,
      format('%s was %s to you.', new.full_name,
        case when v_previous_supervisor is null then 'assigned' else 'reassigned' end),
      '/supervisor/interns', jsonb_build_object('intern_id', new.id));
  end if;
  if tg_op = 'UPDATE' and new.status::text is distinct from v_previous_status then
    if new.status::text = 'archived' then
      perform public.notify_user(new.profile_id, 'intern_status', 'Internship archived',
        'Your internship record has been archived.', '/intern',
        jsonb_build_object('intern_id', new.id, 'status', new.status));
    elsif v_previous_status = 'archived' and new.status::text = 'active' then
      perform public.notify_user(new.profile_id, 'intern_status', 'Internship restored',
        'Your internship record has been reactivated.', '/intern',
        jsonb_build_object('intern_id', new.id, 'status', new.status));
    end if;
  end if;
  if new.created_by is not null and new.profile_id is not null
     and (tg_op = 'INSERT' or old.created_by is null or old.profile_id is distinct from new.profile_id) then
    perform ims_private.notify_ready_account(new.profile_id, 'intern', null, new.full_name);
  end if;
  return new;
end;
$$;

create or replace function ims_private.notify_supervisor_event ()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  if new.profile_id is null then return new; end if;
  if tg_op = 'UPDATE' and not (old.created_by is null and new.created_by is not null)
     and (new.first_name, new.last_name, new.email, new.department_id)
         is distinct from (old.first_name, old.last_name, old.email, old.department_id) then
    perform public.notify_user(new.profile_id, 'account_created', 'Your account was updated',
      format('%s, your supervisor account details were updated by an admin.', new.full_name),
      '/supervisor', jsonb_build_object('supervisor_id', new.id));
  end if;
  if new.created_by is not null
     and (tg_op = 'INSERT' or old.created_by is null or old.profile_id is distinct from new.profile_id) then
    perform ims_private.notify_ready_account(new.profile_id, 'supervisor', new.id, new.full_name);
  end if;
  return new;
end;
$$;

create or replace function ims_private.notify_attendance_event ()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare v_intern public.interns; v_supervisor uuid;
begin
  select * into v_intern from public.interns where id = new.intern_id;
  select s.profile_id into v_supervisor from public.supervisors s
    join public.profiles p on p.id = s.profile_id and p.role = 'supervisor'
    where s.id = v_intern.supervisor_id;
  if tg_op = 'INSERT' and new.time_in is not null then
    perform public.notify_user(v_supervisor, 'attendance_update', 'Time in recorded',
      format('%s just timed in for %s.', v_intern.full_name, new.date), '/supervisor/attendance',
      jsonb_build_object('intern_id', new.intern_id, 'attendance_id', new.id));
  elsif tg_op = 'UPDATE' then
    if new.claim_status is distinct from old.claim_status and new.claim_status in ('approved', 'rejected') then
      perform public.notify_user(v_intern.profile_id, 'attendance_update', 'Clock-out claim ' || new.claim_status,
        format('Your claimed clock-out for %s was %s.', new.date, new.claim_status), '/intern/attendance',
        jsonb_build_object('attendance_id', new.id, 'decision', new.claim_status));
    elsif old.time_out is null and new.time_out is not null then
      perform public.notify_user(v_supervisor, 'attendance_update', 'Time out recorded',
        format('%s timed out for %s.', v_intern.full_name, new.date), '/supervisor/attendance',
        jsonb_build_object('intern_id', new.intern_id, 'attendance_id', new.id));
    end if;
  end if;
  return new;
end;
$$;

create or replace function ims_private.notify_journal_event ()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare v_intern public.interns; v_supervisor uuid;
begin
  select * into v_intern from public.interns where id = new.intern_id;
  if tg_op = 'INSERT' then
    select s.profile_id into v_supervisor from public.supervisors s
      join public.profiles p on p.id = s.profile_id and p.role = 'supervisor'
      where s.id = v_intern.supervisor_id;
    perform public.notify_user(v_supervisor, 'journal_submitted', 'New journal entry',
      format('%s submitted a journal entry for %s.', v_intern.full_name, new.date), '/supervisor/journals',
      jsonb_build_object('intern_id', new.intern_id, 'journal_id', new.id));
  elsif new.status is distinct from old.status and new.status::text in ('approved', 'rejected') then
    perform public.notify_user(v_intern.profile_id, 'journal_review', 'Journal ' || new.status::text,
      format('Your journal for %s was %s.', new.date, new.status), '/intern/journal',
      jsonb_build_object('journal_id', new.id, 'status', new.status));
  end if;
  return new;
end;
$$;

create or replace function ims_private.notify_document_event ()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare v_intern public.interns; v_supervisor uuid;
begin
  select * into v_intern from public.interns where id = new.intern_id;
  if tg_op = 'INSERT' then
    select s.profile_id into v_supervisor from public.supervisors s
      join public.profiles p on p.id = s.profile_id and p.role = 'supervisor'
      where s.id = v_intern.supervisor_id;
    perform public.notify_user(v_supervisor, 'document_review', 'New document submitted',
      format('%s submitted a document for review.', v_intern.full_name), '/supervisor/documents',
      jsonb_build_object('intern_id', new.intern_id, 'document_id', new.id));
    perform public.notify_role('admin', 'document_review', 'New document submitted',
      format('%s submitted a document for review.', v_intern.full_name), '/admin/documents',
      jsonb_build_object('intern_id', new.intern_id, 'document_id', new.id));
  elsif new.status is distinct from old.status and new.status::text in ('approved', 'rejected') then
    perform public.notify_user(v_intern.profile_id, 'document_review', 'Document ' || new.status::text,
      format('Your document "%s" was %s.', coalesce(new.file_name, new.label, 'document'), new.status),
      '/intern/documents', jsonb_build_object('document_id', new.id, 'status', new.status));
  end if;
  return new;
end;
$$;

create or replace function ims_private.notify_evaluation_event ()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
declare v_profile uuid;
begin
  select i.profile_id into v_profile from public.interns i where i.id = new.intern_id;
  perform public.notify_user(v_profile, 'evaluation_submitted', 'New evaluation received',
    'Your supervisor submitted a new evaluation for you.', '/intern/evaluation',
    jsonb_build_object('intern_id', new.intern_id, 'evaluation_id', new.id, 'overall_rating', new.overall_rating));
  return new;
end;
$$;

create or replace function ims_private.notify_announcement_event ()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  insert into public.notifications (user_id, type, title, message, link, metadata)
  select p.id, 'announcement', 'New announcement: ' || new.title,
    left(new.body, 120) || case when length(new.body) > 120 then '…' else '' end,
    case when p.role = 'admin' then '/admin/announcements' else '/supervisor' end,
    jsonb_build_object('announcement_id', new.id, 'category', new.category)
  from public.profiles p where p.role in ('admin', 'supervisor');
  return new;
end;
$$;

-- Own-only SELECT prevents the old browser DELETE from seeing a supervisor's
-- notifications. Preserve that cleanup at the authorized business deletion.
create or replace function ims_private.remove_supervisor_notifications ()
returns trigger language plpgsql security definer set search_path = pg_catalog as $$
begin
  delete from public.notifications where user_id = old.profile_id;
  return old;
end;
$$;

revoke all on all functions in schema ims_private from public, anon, authenticated;

drop trigger if exists notify_intern_event on public.interns;
create trigger notify_intern_event after insert or update on public.interns
  for each row execute function ims_private.notify_intern_event();
drop trigger if exists notify_supervisor_event on public.supervisors;
create trigger notify_supervisor_event after insert or update on public.supervisors
  for each row execute function ims_private.notify_supervisor_event();
drop trigger if exists remove_supervisor_notifications on public.supervisors;
create trigger remove_supervisor_notifications after delete on public.supervisors
  for each row execute function ims_private.remove_supervisor_notifications();
drop trigger if exists notify_attendance_event on public.attendance;
create trigger notify_attendance_event after insert or update on public.attendance
  for each row execute function ims_private.notify_attendance_event();
drop trigger if exists notify_journal_event on public.daily_journals;
create trigger notify_journal_event after insert or update on public.daily_journals
  for each row execute function ims_private.notify_journal_event();
drop trigger if exists notify_document_event on public.documents;
create trigger notify_document_event after insert or update on public.documents
  for each row execute function ims_private.notify_document_event();
drop trigger if exists notify_evaluation_event on public.evaluations;
create trigger notify_evaluation_event after insert on public.evaluations
  for each row execute function ims_private.notify_evaluation_event();
drop trigger if exists notify_announcement_event on public.announcements;
create trigger notify_announcement_event after insert on public.announcements
  for each row execute function ims_private.notify_announcement_event();

commit;
notify pgrst, 'reload schema';
