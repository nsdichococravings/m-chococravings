-- Fix "new row violates row-level security policy" when an admin uploads a
-- menu or product photo.
--
-- 1. The menu-photos rules only let in customers.is_admin users whose email
--    matched exactly (same capital letters). Super admins, or an email saved
--    with different capitals, were refused. Now both buckets use one check:
--    admin or super admin, confirmed email, any capitals.
-- 2. Admins can also read the objects in both buckets (Supabase needs this
--    for replacing a file). The app now uploads with a new name each time,
--    so this is just a safety net.
--
-- Safe to run more than once.
begin;

create or replace function public.cc_is_admin_user() returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(bool_or(coalesce((to_jsonb(c)->>'is_admin')::boolean,false) or coalesce((to_jsonb(c)->>'is_super_user')::boolean,false)), false)
 from auth.users u join public.customers c on lower(c.email)=lower(u.email)
 where u.id = auth.uid() and u.email_confirmed_at is not null
$$;
revoke all on function public.cc_is_admin_user() from public, anon;
grant execute on function public.cc_is_admin_user() to authenticated;

do $$ begin
 if exists(select 1 from information_schema.tables where table_schema='storage' and table_name='objects') then
  insert into storage.buckets(id, name, public) values ('menu-photos', 'menu-photos', true)
   on conflict (id) do update set public = true;
  insert into storage.buckets(id, name, public) values ('product-images', 'product-images', true)
   on conflict (id) do update set public = true;

  drop policy if exists "cc menu photos admin insert" on storage.objects;
  drop policy if exists "cc menu photos admin update" on storage.objects;
  drop policy if exists "cc menu photos admin delete" on storage.objects;
  drop policy if exists "cc menu photos admin select" on storage.objects;
  create policy "cc menu photos admin insert" on storage.objects for insert to authenticated
   with check (bucket_id = 'menu-photos' and public.cc_is_admin_user());
  create policy "cc menu photos admin update" on storage.objects for update to authenticated
   using (bucket_id = 'menu-photos' and public.cc_is_admin_user());
  create policy "cc menu photos admin delete" on storage.objects for delete to authenticated
   using (bucket_id = 'menu-photos' and public.cc_is_admin_user());
  create policy "cc menu photos admin select" on storage.objects for select to authenticated
   using (bucket_id = 'menu-photos' and public.cc_is_admin_user());

  drop policy if exists "product images admin select" on storage.objects;
  create policy "product images admin select" on storage.objects for select to authenticated
   using (bucket_id = 'product-images' and public.cc_is_admin_user());
 end if;
end $$;

commit;
