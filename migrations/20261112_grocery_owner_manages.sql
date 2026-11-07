-- NSDI Store: only the super admin (owner) manages the store.
--
-- Before: admins (customers.is_admin) could edit products, prices, stock and
-- photos, read customer requests, record refunds and change settings.
-- After:  all of that is owner-only (customers.is_super_user). Admins and staff
--         keep the pickup Orders list: mark an order ready, hand it over
--         ("picked up", which records cash at the counter) and cancel unpaid
--         orders. Customers are not affected.
--
-- How: every grocery_admin_* function already calls grocery_require('admin')
-- or grocery_require('staff'). The 'admin' level now means owner only, so one
-- small change covers all of them, including future ones.
--
-- Safe to run more than once. Roll back: re-run migrations/20261104_grocery_store.sql
-- (it restores the previous grocery_require and photo policies).
begin;

create or replace function public.grocery_require(p_level text) returns text
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare r text := coalesce(public.grocery_role(), 'customer');
begin
 if auth.uid() is null then raise exception 'Please sign in first' using errcode='42501'; end if;
 if not (p_level in ('owner','admin') and r='owner'
      or p_level='staff' and r in ('owner','admin','staff')) then
  raise exception 'You do not have access to this' using errcode='42501';
 end if;
 return r;
end $$;
revoke all on function public.grocery_require(text) from public, anon;
grant execute on function public.grocery_require(text) to authenticated;

-- Product photos: only the owner can upload, replace or delete them.
do $$ begin
 if exists(select 1 from information_schema.schemata where schema_name='storage')
    and exists(select 1 from information_schema.tables where table_schema='storage' and table_name='objects') then
  drop policy if exists "grocery photos admin insert" on storage.objects;
  drop policy if exists "grocery photos admin update" on storage.objects;
  drop policy if exists "grocery photos admin delete" on storage.objects;
  create policy "grocery photos admin insert" on storage.objects for insert to authenticated
   with check (bucket_id='grocery-photos' and public.grocery_role() = 'owner');
  create policy "grocery photos admin update" on storage.objects for update to authenticated
   using (bucket_id='grocery-photos' and public.grocery_role() = 'owner');
  create policy "grocery photos admin delete" on storage.objects for delete to authenticated
   using (bucket_id='grocery-photos' and public.grocery_role() = 'owner');
 end if;
end $$;

commit;
