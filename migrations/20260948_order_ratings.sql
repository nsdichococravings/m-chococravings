-- Real customer ratings, replacing the hard-coded "4.9" stars that every
-- product card showed (index.html used `p.rating || 4.9`, and products
-- has no rating column, so it was always 4.9).
--
--  * Customers rate a DELIVERED online order 1-5 stars (+ optional
--    comment) from My Orders. One rating per order; they can change it.
--  * Each product's score = average of the ratings of delivered orders
--    that contained it (via order_items.product_id). Products with no
--    ratings yet show no stars at all instead of a made-up number.
--  * Staff/admin get a "Customer Ratings" report (average, star split,
--    recent ratings with comments, low ratings flagged for follow-up).
--  * Optional: after 4-5 stars the app offers "Review us on Google" if
--    app_settings has a google_review_url value. Set it with:
--      update public.app_settings set value='https://g.page/r/XXXX/review'
--       where key='google_review_url';
--
-- orders, order_items, customers and app_settings already exist (created
-- outside this repo's migrations); this only adds one new table,
-- functions and grants. Access to cc_order_ratings is only through the
-- functions below (RLS on, no direct policies).
--
-- In the live database orders.id and customers.id are TEXT (not uuid), so
-- ids are stored and compared as text here, with no foreign keys (earlier
-- versions failed on them; nothing applied). A rating whose order is later
-- deleted simply stops showing (every read joins back to orders).
--
-- Run this ENTIRE file as database owner. Safe to re-run.
begin;
do $$ begin
 if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='orders') then
  raise exception 'public.orders not found -- is this the right database?';
 end if;
 if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='order_items') then
  raise exception 'public.order_items not found -- is this the right database?';
 end if;
 if not exists(select 1 from pg_proc where proname='cc_loyalty_role') then
  raise exception 'cc_loyalty_role() not found -- run the loyalty migrations first.';
 end if;
end $$;

create table if not exists public.cc_order_ratings(
 order_id text primary key,
 customer_id text not null,
 stars smallint not null check (stars between 1 and 5),
 comment text check (char_length(comment) <= 500),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists idx_cc_order_ratings_created on public.cc_order_ratings(created_at desc);
alter table public.cc_order_ratings enable row level security;
revoke all on public.cc_order_ratings from public, anon, authenticated;

-- Customer rates (or re-rates) one of their own delivered orders.
drop function if exists public.cc_rate_order(uuid,int,text);
create or replace function public.cc_rate_order(p_order_id text, p_stars int, p_comment text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_customer text; v_order public.orders%rowtype; v_comment text=nullif(btrim(coalesce(p_comment,'')),'');
begin
 if auth.uid() is null then raise exception 'Sign in to rate your order'; end if;
 if p_stars is null or p_stars not between 1 and 5 then raise exception 'Choose 1 to 5 stars'; end if;
 if char_length(v_comment) > 500 then raise exception 'Comment is too long (500 characters max)'; end if;
 select id::text into v_customer from public.customers where auth_id::text=auth.uid()::text limit 1;
 select * into v_order from public.orders where id::text=p_order_id;
 if v_order.id is null or v_customer is null or v_order.customer_id::text is distinct from v_customer then
  raise exception 'Order not found';
 end if;
 if v_order.status is distinct from 'delivered' then raise exception 'You can rate an order once it is delivered'; end if;
 insert into public.cc_order_ratings(order_id,customer_id,stars,comment)
  values(p_order_id,v_customer,p_stars,v_comment)
  on conflict (order_id) do update set stars=excluded.stars, comment=excluded.comment, updated_at=now();
 return jsonb_build_object('ok',true,'stars',p_stars);
end $$;

-- The signed-in customer's own ratings, for My Orders.
drop function if exists public.cc_my_order_ratings();
create or replace function public.cc_my_order_ratings() returns table(order_id text, stars smallint, comment text)
language sql stable security definer set search_path=pg_catalog,public as $$
 select r.order_id, r.stars, r.comment from public.cc_order_ratings r
 join public.customers c on c.id::text=r.customer_id
 join public.orders o on o.id::text=r.order_id
 where c.auth_id::text=auth.uid()::text
$$;

-- Public per-product averages for the menu (only products with ratings).
drop function if exists public.cc_product_ratings();
create or replace function public.cc_product_ratings() returns table(product_id text, avg_stars numeric, rating_count int)
language sql stable security definer set search_path=pg_catalog,public as $$
 select oi.product_id::text, round(avg(r.stars)::numeric,1), count(distinct r.order_id)::int
 from public.cc_order_ratings r
 join public.orders o on o.id::text=r.order_id
 join public.order_items oi on oi.order_id::text=r.order_id
 where oi.product_id is not null
 group by oi.product_id::text
$$;

-- Staff/admin report.
create or replace function public.cc_ratings_report(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_role text=public.cc_loyalty_role(); v_days int=least(greatest(coalesce(p_days,30),1),365); v_since timestamptz;
begin
 if auth.uid() is null then raise exception 'Sign in to view this report'; end if;
 if v_role not in ('admin','staff') then raise exception 'Staff access required'; end if;
 v_since=now()-make_interval(days=>v_days);
 return jsonb_build_object(
  'days', v_days,
  'count', (select count(*) from public.cc_order_ratings where updated_at>=v_since),
  'avg', (select round(avg(stars)::numeric,2) from public.cc_order_ratings where updated_at>=v_since),
  'split', (select coalesce(jsonb_object_agg(s, n),'{}'::jsonb) from (
     select stars::text s, count(*) n from public.cc_order_ratings where updated_at>=v_since group by stars) x),
  'low_7d', (select count(*) from public.cc_order_ratings where stars<=2 and updated_at>=now()-interval '7 days'),
  'products', (select coalesce(jsonb_agg(p order by p->>'avg', p->>'name'),'[]'::jsonb) from (
     select jsonb_build_object('name', min(oi.product_name), 'avg', round(avg(r.stars)::numeric,1), 'count', count(distinct r.order_id)) p
     from public.cc_order_ratings r join public.order_items oi on oi.order_id::text=r.order_id
     where r.updated_at>=v_since
     group by coalesce(oi.product_id::text, oi.product_name)) y),
  'recent', (select coalesce(jsonb_agg(x order by x->>'at' desc),'[]'::jsonb) from (
     select jsonb_build_object(
       'order_number', coalesce(o.order_number, left(o.id::text,8)),
       'name', c.name, 'phone', c.phone,
       'stars', r.stars, 'comment', r.comment, 'at', r.updated_at,
       'items', (select string_agg(oi.product_name || coalesce(' · '||oi.pack_label,''), ', ') from public.order_items oi where oi.order_id::text=r.order_id)) x
     from public.cc_order_ratings r
     join public.orders o on o.id::text=r.order_id
     join public.customers c on c.id::text=r.customer_id
     where r.updated_at>=v_since
     order by r.updated_at desc limit 100) z)
 );
end $$;

-- Placeholder for the optional Google review link (empty = button hidden).
do $$ begin
 if exists(select 1 from information_schema.tables where table_schema='public' and table_name='app_settings')
    and not exists(select 1 from public.app_settings where key='google_review_url') then
  insert into public.app_settings(key,value) values('google_review_url','');
 end if;
exception when others then
 raise notice 'Could not add google_review_url to app_settings (%). Add it by hand if you want the Google button.', sqlerrm;
end $$;

revoke all on function public.cc_rate_order(text,int,text) from public, anon;
revoke all on function public.cc_my_order_ratings() from public, anon;
revoke all on function public.cc_ratings_report(int) from public, anon;
grant execute on function public.cc_rate_order(text,int,text) to authenticated;
grant execute on function public.cc_my_order_ratings() to authenticated;
grant execute on function public.cc_ratings_report(int) to authenticated;
grant execute on function public.cc_product_ratings() to anon, authenticated;
commit;
