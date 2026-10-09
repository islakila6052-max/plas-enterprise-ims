-- ============================================================================
-- 0043 - Announcement likes
-- ============================================================================
-- Adds public.announcement_likes: one row per (announcement, user) pair so
-- interns (and any other signed-in user) can like announcements.
--
-- Design notes
--   * The UNIQUE (announcement_id, user_id) constraint makes a double-click,
--     a retry, or two tabs open at once idempotent at the database level —
--     a user can never register two likes for the same announcement.
--   * ON DELETE CASCADE on both FKs keeps the table clean: deleting an
--     announcement or a profile removes its likes automatically.
--   * RLS: every signed-in user may read likes (announcement totals are
--     public inside the app), a user may only insert/delete their OWN like,
--     and admins (is_admin()) keep full access for moderation/cleanup.
--     No UPDATE policy is needed — a like is never edited.
--
-- SAFE TO RE-RUN: every step is guarded with "if not exists" /
-- "drop policy if exists", so re-running repairs a partial creation.
-- ============================================================================

-- 1. Table -------------------------------------------------------------------
create table if not exists public.announcement_likes (
  id uuid primary key default gen_random_uuid (),
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now (),
  constraint announcement_likes_unique unique (announcement_id, user_id)
);

-- 2. Indexes -----------------------------------------------------------------
-- Unique constraint index covers (announcement_id, user_id) lookups.
create index if not exists announcement_likes_user_idx
  on public.announcement_likes (user_id);

-- 3. Row level security ------------------------------------------------------
alter table public.announcement_likes enable row level security;

drop policy if exists "announcement likes readable" on public.announcement_likes;
create policy "announcement likes readable"
  on public.announcement_likes for select to authenticated using (true);

drop policy if exists "users insert own announcement like" on public.announcement_likes;
create policy "users insert own announcement like"
  on public.announcement_likes for insert to authenticated
  with check (user_id = auth.uid ());

drop policy if exists "users delete own announcement like" on public.announcement_likes;
create policy "users delete own announcement like"
  on public.announcement_likes for delete to authenticated
  using (user_id = auth.uid ());

drop policy if exists "admins manage announcement likes" on public.announcement_likes;
create policy "admins manage announcement likes"
  on public.announcement_likes for all to authenticated
  using (public.is_admin ()) with check (public.is_admin ());
