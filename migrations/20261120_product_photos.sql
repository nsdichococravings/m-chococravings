-- Admins change product photos from the app (camera or gallery).
--
-- The app's product photos (brownies, Vibe Store) used to come from a fixed
-- list in index.html, keyed by SKU, so changing one needed a code change.
-- Now each product's photo is products.image_url; the app uses it first and
-- falls back to the old list. Admins tap "Change photo" on a product page,
-- the photo uploads to the public 'product-images' bucket, and this saves
-- the link.
--
--   cc_admin_set_product_image(product_id, url) -> { id, sku, image_url }
--
-- Admins and super admins only (confirmed email), for both the function and
-- uploads to the bucket. Safe to run more than once.
begin;

alter table public.products add column if not exists image_url text;

create or replace function public.cc_is_admin_user() returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(bool_or(coalesce((to_jsonb(c)->>'is_admin')::boolean,false) or coalesce((to_jsonb(c)->>'is_super_user')::boolean,false)), false)
 from auth.users u join public.customers c on lower(c.email)=lower(u.email)
 where u.id = auth.uid() and u.email_confirmed_at is not null
$$;
revoke all on function public.cc_is_admin_user() from public, anon;
grant execute on function public.cc_is_admin_user() to authenticated;

create or replace function public.cc_admin_set_product_image(p_product_id text, p_url text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r record; u text := nullif(trim(coalesce(p_url,'')),'');
begin
 if not public.cc_is_admin_user() then raise exception 'Only an admin can change product photos' using errcode='42501'; end if;
 if u is not null and (u !~* '^https://' or length(u) > 600) then raise exception 'That photo link is not valid'; end if;
 update public.products set image_url = u where id::text = p_product_id returning id::text as id, sku, image_url into r;
 if r.id is null then raise exception 'Product not found'; end if;
 return jsonb_build_object('id', r.id, 'sku', r.sku, 'image_url', r.image_url);
end $$;
revoke all on function public.cc_admin_set_product_image(text,text) from public, anon;
grant execute on function public.cc_admin_set_product_image(text,text) to authenticated;

-- Photos: anyone can view; only admins can upload or replace.
do $$ begin
 if exists(select 1 from information_schema.schemata where schema_name='storage')
    and exists(select 1 from information_schema.tables where table_schema='storage' and table_name='objects') then
  insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
   values ('product-images', 'product-images', true, 3145728, array['image/jpeg','image/png','image/webp'])
   on conflict (id) do update set public = true;
  drop policy if exists "product images admin insert" on storage.objects;
  drop policy if exists "product images admin update" on storage.objects;
  create policy "product images admin insert" on storage.objects for insert to authenticated
   with check (bucket_id = 'product-images' and public.cc_is_admin_user());
  create policy "product images admin update" on storage.objects for update to authenticated
   using (bucket_id = 'product-images' and public.cc_is_admin_user());
 end if;
end $$;

commit;
