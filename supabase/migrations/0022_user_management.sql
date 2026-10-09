-- ============================================================================
-- Migration: User management workflow (HR creates supervisors, supervisors
-- create interns). Adds created_by tracking + RLS so supervisors can manage
-- interns they created or are assigned to.
-- Run in Supabase SQL Editor.
-- ============================================================================

-- 1. Track who created each record -------------------------------------------
alter table public.supervisors
  add column if not exists created_by uuid references public.profiles (id) on delete set null;

alter table public.interns
  add column if not exists created_by uuid references public.profiles (id) on delete set null;

create index if not exists idx_supervisors_created_by on public.supervisors (created_by);
create index if not exists idx_interns_created_by on public.interns (created_by);

-- 2. Supervisors: readable by all authenticated users ------------------------
drop policy if exists "supervisors readable" on public.supervisors;
create policy "supervisors readable"
  on public.supervisors for select to authenticated using (true);

-- 3. Admins manage supervisors ----------------------------------------------
drop policy if exists "admins manage supervisors" on public.supervisors;
create policy "admins manage supervisors"
  on public.supervisors for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- 4. Interns: supervisors manage assigned OR created-by interns --------------
drop policy if exists "supervisor reads assigned interns" on public.interns;
create policy "supervisor manages assigned interns"
  on public.interns for all to authenticated
  using (
    supervisor_id = public.current_supervisor_id()
    or created_by = public.current_supervisor_id()
  )
  with check (
    supervisor_id = public.current_supervisor_id()
    or created_by = public.current_supervisor_id()
  );

create policy "supervisor creates interns"
  on public.interns for insert to authenticated
  with check (
    public.current_supervisor_id() is not null
    and (
      supervisor_id = public.current_supervisor_id()
      or created_by = public.current_supervisor_id()
    )
  );
