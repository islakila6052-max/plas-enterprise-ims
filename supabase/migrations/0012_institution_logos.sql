-- ============================================================================
-- 0012 — Institution logo storage
-- ============================================================================
-- Admins can upload a logo/avatar per institution. The logo is stored in a
-- PUBLIC bucket so it can be rendered directly by <img src={logo_url}> without
-- signed URLs. Upload/delete are admin-only; reads are public.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('institution-logos', 'institution-logos', true)
on conflict (id) do nothing;

drop policy if exists "institution_logos_admin_upload" on storage.objects;
create policy "institution_logos_admin_upload" on storage.objects
  for insert to authenticated with check (
    bucket_id = 'institution-logos' and public.is_admin()
  );

drop policy if exists "institution_logos_public_read" on storage.objects;
create policy "institution_logos_public_read" on storage.objects
  for select using (bucket_id = 'institution-logos');

drop policy if exists "institution_logos_admin_delete" on storage.objects;
create policy "institution_logos_admin_delete" on storage.objects
  for delete to authenticated using (
    bucket_id = 'institution-logos' and public.is_admin()
  );

-- Reload PostgREST schema cache.
notify pgrst, 'reload schema';
