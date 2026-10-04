-- Rich store menu cards (store.html): photo, egg / eggless mark, NEW badge,
-- real customer ratings and an automatic Bestseller badge.
--
--  * store_menu gets image_url, egg_type ('eggless' | 'egg') and is_new.
--    Admins set them in Manage Menu; photos upload to the public
--    'menu-photos' storage bucket (only customers.is_admin users can write).
--  * Customers rate a store order 1-5 stars from their token screen once it
--    is collected (cc_rate_store_order). The order id is only known to the
--    phone that placed it; ratings close 3 days after the order.
--  * cc_store_menu_stats() gives each item (by name, as orders store names)
--    its average rating, rating count and units sold in the last 30 days,
--    which the menu uses for stars and the Bestseller badge.
--
-- store_orders.items may be a jsonb array or a JSON string (Tables board
-- writes JSON.stringify), so it's read through cc_store_items().
-- store_orders.id / store_menu are compared as text: no foreign keys.
--
-- Run this ENTIRE file as database owner. Safe to re-run. Until it runs,
-- store.html keeps working: cards show placeholders and no ratings.
begin;
do $$ begin
 if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='store_menu') then
  raise exception 'public.store_menu not found -- is this the right database?';
 end if;
 if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='store_orders') then
  raise exception 'public.store_orders not found -- is this the right database?';
 end if;
end $$;

alter table public.store_menu add column if not exists image_url text;
alter table public.store_menu add column if not exists egg_type text;
alter table public.store_menu add column if not exists is_new boolean not null default false;
do $$ begin
 alter table public.store_menu add constraint store_menu_egg_type_check check (egg_type is null or egg_type in ('eggless','egg'));
exception when duplicate_object then null;
end $$;

create table if not exists public.cc_store_order_ratings(
 order_id text primary key,
 stars smallint not null check (stars between 1 and 5),
 comment text check (char_length(comment) <= 500),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.cc_store_order_ratings enable row level security;
revoke all on public.cc_store_order_ratings from public, anon, authenticated;

-- items column -> jsonb array, whatever shape it was stored in.
create or replace function public.cc_store_items(p jsonb) returns jsonb
language plpgsql immutable as $$
begin
 if p is null then return '[]'::jsonb; end if;
 if jsonb_typeof(p)='string' then p := (p #>> '{}')::jsonb; end if;
 if jsonb_typeof(p)<>'array' then return '[]'::jsonb; end if;
 return p;
exception when others then
 return '[]'::jsonb;
end $$;

create or replace function public.cc_rate_store_order(p_order_id text, p_stars int, p_comment text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_status text; v_created timestamptz; v_comment text=nullif(btrim(coalesce(p_comment,'')),'');
begin
 if p_stars is null or p_stars not between 1 and 5 then raise exception 'Choose 1 to 5 stars'; end if;
 if char_length(v_comment) > 500 then raise exception 'Comment is too long (500 characters max)'; end if;
 select status, created_at into v_status, v_created from public.store_orders where id::text=p_order_id;
 if v_status is null then raise exception 'Order not found'; end if;
 if v_status not in ('ready','collected','delivered') then raise exception 'You can rate your order once it is ready'; end if;
 if v_created < now() - interval '3 days' then raise exception 'Rating for this order has closed'; end if;
 insert into public.cc_store_order_ratings(order_id,stars,comment) values(p_order_id,p_stars,v_comment)
  on conflict (order_id) do update set stars=excluded.stars, comment=excluded.comment, updated_at=now();
 return jsonb_build_object('ok',true,'stars',p_stars);
end $$;

-- The phone's own rating for an order (to show the stars it already gave).
create or replace function public.cc_store_order_rating(p_order_id text) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select jsonb_build_object('stars',stars,'comment',comment) from public.cc_store_order_ratings where order_id=p_order_id
$$;

create or replace function public.cc_store_menu_stats() returns table(name text, avg_stars numeric, rating_count int, sold_30d int)
language sql stable security definer set search_path=pg_catalog,public as $$
 with lines as (
  select o.id::text as order_id, o.created_at, o.status,
         lower(btrim(i->>'name')) as key, btrim(i->>'name') as name,
         coalesce(nullif(i->>'qty','')::numeric,1) as qty
  from public.store_orders o
  cross join lateral jsonb_array_elements(public.cc_store_items(to_jsonb(o.items))) i
  where coalesce(i->>'name','')<>''
 ),
 rated as (
  select l.key, round(avg(r.stars)::numeric,1) as avg_stars, count(distinct r.order_id)::int as rating_count
  from public.cc_store_order_ratings r join lines l on l.order_id=r.order_id
  group by l.key
 ),
 sold as (
  select key, min(name) as name, sum(qty)::int as sold_30d
  from lines where created_at >= now()-interval '30 days' and status is distinct from 'cancelled'
  group by key
 )
 select coalesce(s.name, r.key), r.avg_stars, coalesce(r.rating_count,0), coalesce(s.sold_30d,0)
 from sold s full join rated r on r.key=s.key
$$;

-- Photo storage: public read, admin-only write.
do $$ begin
 if exists(select 1 from information_schema.schemata where schema_name='storage') then
  insert into storage.buckets(id,name,public) values('menu-photos','menu-photos',true)
   on conflict (id) do update set public=true;
  drop policy if exists "cc menu photos admin insert" on storage.objects;
  drop policy if exists "cc menu photos admin update" on storage.objects;
  drop policy if exists "cc menu photos admin delete" on storage.objects;
  create policy "cc menu photos admin insert" on storage.objects for insert to authenticated
   with check (bucket_id='menu-photos' and exists(select 1 from public.customers c where c.email=auth.jwt()->>'email' and c.is_admin));
  create policy "cc menu photos admin update" on storage.objects for update to authenticated
   using (bucket_id='menu-photos' and exists(select 1 from public.customers c where c.email=auth.jwt()->>'email' and c.is_admin));
  create policy "cc menu photos admin delete" on storage.objects for delete to authenticated
   using (bucket_id='menu-photos' and exists(select 1 from public.customers c where c.email=auth.jwt()->>'email' and c.is_admin));
 end if;
end $$;

revoke all on function public.cc_rate_store_order(text,int,text) from public;
grant execute on function public.cc_rate_store_order(text,int,text) to anon, authenticated;
grant execute on function public.cc_store_order_rating(text) to anon, authenticated;
grant execute on function public.cc_store_menu_stats() to anon, authenticated;
commit;
