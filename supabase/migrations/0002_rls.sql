-- ============================================================================
-- Row Level Security + Policies + Triggers
-- ============================================================================

-- Helper: returns the role of the current user from profiles.
create or replace function public.current_role ()
  returns user_role
  language sql
  stable
  security definer
  set search_path = public
as $$
  select role
  from public.profiles
  where id = auth.uid ();
$$;

-- Helper: true if current user is admin or hr_staff.
create or replace function public.is_admin ()
  returns boolean
  language sql
  stable
  security definer
  set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid ()
      and role in ('admin', 'hr_staff')
  );
$$;

-- Helper: returns the supervisor row id for the current user (if supervisor).
create or replace function public.current_supervisor_id ()
  returns uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select s.id
  from public.supervisors s
  join public.profiles p on p.id = s.profile_id
  where p.id = auth.uid ();
$$;

-- Helper: returns the intern row id for the current user (if intern).
create or replace function public.current_intern_id ()
  returns uuid
  language sql
  stable
  security definer
  set search_path = public
as $$
  select i.id
  from public.interns i
  join public.profiles p on p.id = i.profile_id
  where p.id = auth.uid ();
$$;

-- ---------------------------------------------------------------------------
-- Auto-create a profile row when a new auth user signs up.
-- ---------------------------------------------------------------------------
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
    coalesce((new.raw_user_meta_data ->> 'role')::user_role, 'intern')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user ();

-- ---------------------------------------------------------------------------
-- Enable RLS on all tables
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.departments enable row level security;
alter table public.supervisors enable row level security;
alter table public.interns enable row level security;
alter table public.attendance enable row level security;
alter table public.daily_journals enable row level security;
alter table public.documents enable row level security;
alter table public.evaluations enable row level security;
alter table public.announcements enable row level security;
alter table public.settings enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy "profiles readable by authenticated"
  on public.profiles for select
  to authenticated
  using (true);

create policy "users manage own profile"
  on public.profiles for update
  to authenticated
  using (id = auth.uid ());

create policy "admins manage profiles"
  on public.profiles for all
  to authenticated
  using (public.is_admin ())
  with check (public.is_admin ());

-- ---------------------------------------------------------------------------
-- departments
-- ---------------------------------------------------------------------------
create policy "departments readable"
  on public.departments for select to authenticated using (true);
create policy "admins manage departments"
  on public.departments for all to authenticated
  using (public.is_admin ()) with check (public.is_admin ());

-- ---------------------------------------------------------------------------
-- supervisors
-- ---------------------------------------------------------------------------
create policy "supervisors readable"
  on public.supervisors for select to authenticated using (true);
create policy "admins manage supervisors"
  on public.supervisors for all to authenticated
  using (public.is_admin ()) with check (public.is_admin ());

-- ---------------------------------------------------------------------------
-- interns
-- ---------------------------------------------------------------------------
create policy "interns readable"
  on public.interns for select to authenticated using (true);
create policy "admins manage interns"
  on public.interns for all to authenticated
  using (public.is_admin ()) with check (public.is_admin ());
create policy "intern reads own row"
  on public.interns for select to authenticated
  using (id = public.current_intern_id ());
create policy "supervisor reads assigned interns"
  on public.interns for select to authenticated
  using (supervisor_id = public.current_supervisor_id ());

-- ---------------------------------------------------------------------------
-- attendance
-- ---------------------------------------------------------------------------
create policy "attendance readable"
  on public.attendance for select to authenticated using (true);
create policy "admins manage attendance"
  on public.attendance for all to authenticated
  using (public.is_admin ()) with check (public.is_admin ());
create policy "intern manages own attendance"
  on public.attendance for all to authenticated
  using (intern_id = public.current_intern_id ())
  with check (intern_id = public.current_intern_id ());
create policy "supervisor reads assigned attendance"
  on public.attendance for select to authenticated
  using (
    intern_id in (
      select id from public.interns
      where supervisor_id = public.current_supervisor_id ()
    )
  );

-- ---------------------------------------------------------------------------
-- daily_journals
-- ---------------------------------------------------------------------------
create policy "journals readable"
  on public.daily_journals for select to authenticated using (true);
create policy "admins manage journals"
  on public.daily_journals for all to authenticated
  using (public.is_admin ()) with check (public.is_admin ());
create policy "intern manages own journals"
  on public.daily_journals for all to authenticated
  using (intern_id = public.current_intern_id ())
  with check (intern_id = public.current_intern_id ());
create policy "supervisor reviews assigned journals"
  on public.daily_journals for update to authenticated
  using (
    intern_id in (
      select id from public.interns
      where supervisor_id = public.current_supervisor_id ()
    )
  );

-- ---------------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------------
create policy "documents readable"
  on public.documents for select to authenticated using (true);
create policy "admins manage documents"
  on public.documents for all to authenticated
  using (public.is_admin ()) with check (public.is_admin ());
create policy "intern manages own documents"
  on public.documents for all to authenticated
  using (intern_id = public.current_intern_id ())
  with check (intern_id = public.current_intern_id ());

-- ---------------------------------------------------------------------------
-- evaluations
-- ---------------------------------------------------------------------------
create policy "evaluations readable"
  on public.evaluations for select to authenticated using (true);
create policy "admins manage evaluations"
  on public.evaluations for all to authenticated
  using (public.is_admin ()) with check (public.is_admin ());
create policy "supervisor manages assigned evaluations"
  on public.evaluations for all to authenticated
  using (supervisor_id = public.current_supervisor_id ())
  with check (supervisor_id = public.current_supervisor_id ());
create policy "intern reads own evaluation"
  on public.evaluations for select to authenticated
  using (intern_id = public.current_intern_id ());

-- ---------------------------------------------------------------------------
-- announcements
-- ---------------------------------------------------------------------------
create policy "announcements readable"
  on public.announcements for select to authenticated using (true);
create policy "admins manage announcements"
  on public.announcements for all to authenticated
  using (public.is_admin ()) with check (public.is_admin ());

-- ---------------------------------------------------------------------------
-- settings
-- ---------------------------------------------------------------------------
create policy "settings readable"
  on public.settings for select to authenticated using (true);
create policy "admins manage settings"
  on public.settings for all to authenticated
  using (public.is_admin ()) with check (public.is_admin ());

-- ---------------------------------------------------------------------------
-- Storage bucket for intern documents
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('intern-documents', 'intern-documents', true)
on conflict (id) do nothing;

create policy "documents storage readable"
  on storage.objects for select to authenticated
  using (bucket_id = 'intern-documents');

create policy "intern uploads own documents"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'intern-documents'
    and (storage.foldername (name))[1] = public.current_intern_id ()::text
  );

create policy "admins manage storage"
  on storage.objects for all to authenticated
  using (bucket_id = 'intern-documents')
  with check (bucket_id = 'intern-documents');
