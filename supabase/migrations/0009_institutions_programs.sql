-- ============================================================================
-- 0009 — Institutions & Programs (master setup data)
-- ============================================================================
-- Run in the Supabase SQL Editor. Idempotent (IF NOT EXISTS / DROP ... IF EXISTS).
-- Depends on 0008 (profiles FK repoint) being applied first.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- institutions
-- ----------------------------------------------------------------------------
create table if not exists public.institutions (
  institution_id   uuid primary key default gen_random_uuid(),
  institution_name text not null,
  abbreviation     text,
  campus           text,
  address          text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_institutions_name on public.institutions (institution_name);

-- ----------------------------------------------------------------------------
-- programs (many per institution; cascade delete)
-- ----------------------------------------------------------------------------
create table if not exists public.programs (
  program_id        uuid primary key default gen_random_uuid(),
  institution_id    uuid not null references public.institutions (institution_id) on delete cascade,
  program_name      text not null,
  abbreviation      text,
  hours_to_render   numeric not null default 300 check (hours_to_render > 0),
  memo_of_agreement text, -- storage object path (PDF) or URL
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_programs_institution on public.programs (institution_id);
create index if not exists idx_programs_name on public.programs (program_name);

-- ----------------------------------------------------------------------------
-- updated_at helper (idempotent via CREATE OR REPLACE; do NOT drop — it is
-- shared by triggers on other tables such as settings and profiles).
-- ----------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- updated_at triggers
-- ----------------------------------------------------------------------------
drop trigger if exists touch_institutions on public.institutions;
create trigger touch_institutions before update on public.institutions
  for each row execute function public.touch_updated_at();

drop trigger if exists touch_programs on public.programs;
create trigger touch_programs before update on public.programs
  for each row execute function public.touch_updated_at();

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table public.institutions enable row level security;
alter table public.programs    enable row level security;

-- Read: any authenticated user may view institutions/programs (they are
-- reference/setup data used across the app).
drop policy if exists "institutions_select_all" on public.institutions;
create policy "institutions_select_all" on public.institutions
  for select using (auth.role() = 'authenticated');

drop policy if exists "programs_select_all" on public.programs;
create policy "programs_select_all" on public.programs
  for select using (auth.role() = 'authenticated');

-- Write: only HR Admin / HR Staff (mirrors departments_admin_write).
drop policy if exists "institutions_admin_write" on public.institutions;
create policy "institutions_admin_write" on public.institutions
  for all using (public.is_admin()) with check (public.is_admin());

drop policy if exists "programs_admin_write" on public.programs;
create policy "programs_admin_write" on public.programs
  for all using (public.is_admin()) with check (public.is_admin());

-- ----------------------------------------------------------------------------
-- Storage bucket for MOA (Memorandum of Agreement) PDFs
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('institution-moa', 'institution-moa', false)
on conflict (id) do nothing;

drop policy if exists "moa_admin_upload" on storage.objects;
create policy "moa_admin_upload" on storage.objects
  for insert with check (
    bucket_id = 'institution-moa' and public.is_admin()
  );

drop policy if exists "moa_admin_read" on storage.objects;
create policy "moa_admin_read" on storage.objects
  for select using (
    bucket_id = 'institution-moa' and public.is_admin()
  );

drop policy if exists "moa_admin_delete" on storage.objects;
create policy "moa_admin_delete" on storage.objects
  for delete using (
    bucket_id = 'institution-moa' and public.is_admin()
  );

-- Reload PostgREST schema cache so the new tables/relationships are visible.
notify pgrst, 'reload schema';
