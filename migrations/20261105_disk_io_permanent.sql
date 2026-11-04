-- Permanent Disk IO fix.
--
-- What the live database showed (pg_stat_statements / pg_stat_all_tables, 4 Nov):
--  1. cc_store_menu_stats() was the query reading the most from disk (~0.7 s per call).
--     It runs every time anyone opens On Store and unpacked EVERY order ever placed.
--     → Now worked out at most once every 15 minutes and saved. It only looks at the
--       last 30 days of orders plus rated orders. Same function name and columns,
--       so store.html does not change.
--  2. customers was read in full 7,000+ times: staff/owner/loyalty checks match the
--     signed-in person with lower(email)=lower(...), which a plain email index can't use.
--     → Index on lower(email) (and on email, for the app's .eq('email', ...)).
--  3. Saving an On Store order took ~0.27 s: the loyalty trigger looks up the member
--     by the last 10 digits of the phone (full read of cc_loyalty_members) and checks
--     today's stamps.
--     → Indexes for both lookups.
--  4. store_orders read in full 650+ times.
--     → The indexes from 20261102 are included again here (safe if already there),
--       plus an index for rating lookups by order id.
--
-- Safe to run more than once. Each index is skipped (with a notice) if its table
-- or column does not exist. Nothing is deleted from your data.
-- Run in Supabase: SQL Editor → paste → Run.

set lock_timeout = '10s';

-- ── 1. Indexes ───────────────────────────────────────────────────────
do $$
declare ix record; missing text;
begin
  for ix in
    select * from (values
      -- from 20261102 (Kitchen, On Store, Tables board, reports, profile)
      ('cc_store_orders_created_idx', 'store_orders', array['created_at'],
       'create index if not exists cc_store_orders_created_idx on public.store_orders (created_at)'),
      ('cc_store_orders_status_created_idx', 'store_orders', array['status','created_at'],
       'create index if not exists cc_store_orders_status_created_idx on public.store_orders (status, created_at)'),
      ('cc_store_orders_open_idx', 'store_orders', array['status','created_at'],
       'create index if not exists cc_store_orders_open_idx on public.store_orders (created_at) where status not in (''collected'',''cancelled'')'),
      ('cc_store_orders_customer_idx', 'store_orders', array['customer_id','created_at'],
       'create index if not exists cc_store_orders_customer_idx on public.store_orders (customer_id, created_at desc)'),
      ('cc_store_orders_phone_idx', 'store_orders', array['customer_phone'],
       'create index if not exists cc_store_orders_phone_idx on public.store_orders (customer_phone)'),
      ('cc_store_orders_table_idx', 'store_orders', array['table_code'],
       'create index if not exists cc_store_orders_table_idx on public.store_orders (table_code) where table_code is not null'),
      ('cc_orders_customer_created_idx', 'orders', array['customer_id','created_at'],
       'create index if not exists cc_orders_customer_created_idx on public.orders (customer_id, created_at desc)'),
      ('cc_customer_addresses_customer_idx', 'customer_addresses', array['customer_id'],
       'create index if not exists cc_customer_addresses_customer_idx on public.customer_addresses (customer_id)'),
      ('cc_order_ratings_order_idx', 'cc_order_ratings', array['order_id'],
       'create index if not exists cc_order_ratings_order_idx on public.cc_order_ratings (order_id)'),
      ('cc_store_menu_available_idx', 'store_menu', array['available','sort_order'],
       'create index if not exists cc_store_menu_available_idx on public.store_menu (available, sort_order)'),
      ('cc_app_settings_key_idx', 'app_settings', array['key'],
       'create index if not exists cc_app_settings_key_idx on public.app_settings (key)'),
      -- new
      -- Rating lookups and the menu stats match store_orders.id as text.
      ('cc_store_orders_id_text_idx', 'store_orders', array['id'],
       'create index if not exists cc_store_orders_id_text_idx on public.store_orders ((id::text))'),
      -- Staff / owner / loyalty checks: lower(email) = lower(signed-in email).
      ('cc_customers_email_lower_idx', 'customers', array['email'],
       'create index if not exists cc_customers_email_lower_idx on public.customers (lower(email))'),
      -- The app's own .eq('email', ...) lookups (skipped below if an email index already exists).
      ('cc_customers_email_idx', 'customers', array['email'],
       'create index if not exists cc_customers_email_idx on public.customers (email)'),
      -- Loyalty: member by the last 10 digits of the phone (every order save).
      ('cc_loyalty_members_phone10_idx', 'cc_loyalty_members', array['phone'],
       'create index if not exists cc_loyalty_members_phone10_idx on public.cc_loyalty_members (right(regexp_replace(phone, ''[^0-9]'', '''', ''g''), 10))'),
      -- Loyalty: "already stamped today?" (every collected order).
      ('cc_loyalty_stamp_log_member_idx', 'cc_loyalty_stamp_log', array['member_id','created_at'],
       'create index if not exists cc_loyalty_stamp_log_member_idx on public.cc_loyalty_stamp_log (member_id, created_at desc)')
    ) as t(name, tbl, cols, ddl)
  loop
    if to_regclass('public.' || ix.tbl) is null then
      raise notice 'Skipped %: table % not found', ix.name, ix.tbl; continue;
    end if;
    select string_agg(c, ', ') into missing from unnest(ix.cols) c
     where not exists (select 1 from information_schema.columns where table_schema='public' and table_name=ix.tbl and column_name=c);
    if missing is not null then
      raise notice 'Skipped %: % has no column(s) %', ix.name, ix.tbl, missing; continue;
    end if;
    -- Don't add a second plain email index if one already exists under another name.
    if ix.name = 'cc_customers_email_idx' and exists (
      select 1 from pg_index i join pg_class t on t.oid=i.indrelid join pg_namespace n on n.oid=t.relnamespace
      join pg_attribute a on a.attrelid=t.oid and a.attnum=i.indkey[0]
      where n.nspname='public' and t.relname='customers' and a.attname='email' and i.indnatts=1 and i.indexprs is null and i.indpred is null) then
      raise notice 'Skipped %: customers.email already has an index', ix.name; continue;
    end if;
    execute ix.ddl;
    raise notice 'OK %', ix.name;
  end loop;
end $$;

-- ── 2. On Store menu stats: saved, refreshed at most every 15 minutes ──
begin;

create table if not exists public.cc_store_menu_stats_cache(
  name text, avg_stars numeric, rating_count int, sold_30d int);
create table if not exists public.cc_store_menu_stats_meta(
  id int primary key default 1 check (id = 1), refreshed_at timestamptz);
insert into public.cc_store_menu_stats_meta(id, refreshed_at) values (1, null) on conflict (id) do nothing;
alter table public.cc_store_menu_stats_cache enable row level security;
alter table public.cc_store_menu_stats_meta enable row level security;
revoke all on public.cc_store_menu_stats_cache from public, anon, authenticated;
revoke all on public.cc_store_menu_stats_meta from public, anon, authenticated;

-- Same results as before. Reads only orders from the last 30 days (for "sold")
-- and orders that have a rating (for stars), both found through indexes.
create or replace function public.cc_store_menu_stats_refresh() returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  delete from public.cc_store_menu_stats_cache where true;
  insert into public.cc_store_menu_stats_cache(name, avg_stars, rating_count, sold_30d)
  with ids as (
    select o.id from public.store_orders o where o.created_at >= now() - interval '30 days'
    union
    select o.id from public.cc_store_order_ratings r join public.store_orders o on o.id::text = r.order_id
  ),
  lines as (
    select o.id::text as order_id, o.created_at, o.status,
           lower(btrim(i->>'name')) as key, btrim(i->>'name') as name,
           coalesce(nullif(i->>'qty','')::numeric, 1) as qty
    from ids join public.store_orders o on o.id = ids.id
    cross join lateral jsonb_array_elements(public.cc_store_items(to_jsonb(o.items))) i
    where coalesce(i->>'name','') <> ''
  ),
  rated as (
    select l.key, round(avg(r.stars)::numeric, 1) as avg_stars, count(distinct r.order_id)::int as rating_count
    from public.cc_store_order_ratings r join lines l on l.order_id = r.order_id
    group by l.key
  ),
  sold as (
    select key, min(name) as name, sum(qty)::int as sold_30d
    from lines where created_at >= now() - interval '30 days' and status is distinct from 'cancelled'
    group by key
  )
  select coalesce(s.name, r.key), r.avg_stars, coalesce(r.rating_count, 0), coalesce(s.sold_30d, 0)
  from sold s full join rated r on r.key = s.key;
  update public.cc_store_menu_stats_meta set refreshed_at = now() where id = 1;
end $$;
revoke all on function public.cc_store_menu_stats_refresh() from public, anon, authenticated;

-- What On Store calls. If the saved copy is older than 15 minutes, one caller
-- refreshes it; everyone else gets the saved copy straight away.
create or replace function public.cc_store_menu_stats() returns table(name text, avg_stars numeric, rating_count int, sold_30d int)
language plpgsql volatile security definer set search_path=pg_catalog,public as $$
begin
  if coalesce((select m.refreshed_at from public.cc_store_menu_stats_meta m where m.id = 1), '-infinity'::timestamptz) < now() - interval '15 minutes'
     and pg_try_advisory_xact_lock(hashtext('cc_store_menu_stats_refresh')) then
    begin
      perform public.cc_store_menu_stats_refresh();
    exception when others then
      -- Never fail On Store over a ratings badge: fall back to the saved copy.
      raise notice 'menu stats refresh skipped: %', sqlerrm;
    end;
  end if;
  return query select c.name, c.avg_stars, c.rating_count, c.sold_30d from public.cc_store_menu_stats_cache c;
end $$;
revoke all on function public.cc_store_menu_stats() from public;
grant execute on function public.cc_store_menu_stats() to anon, authenticated;

-- A new rating shows within 15 minutes; refresh now so today's numbers are ready.
select public.cc_store_menu_stats_refresh();

notify pgrst, 'reload schema';
commit;

-- ── 3. Fresh statistics so the database uses the indexes ─────────────
do $$ declare t text; begin
  foreach t in array array['store_orders','orders','customers','customer_addresses','store_menu','app_settings',
                           'cc_loyalty_members','cc_loyalty_stamp_log','cc_store_order_ratings','cc_order_ratings'] loop
    if to_regclass('public.' || t) is not null then execute format('analyze public.%I', t); end if;
  end loop;
end $$;

-- ── Result: what is in place now ─────────────────────────────────────
select 'indexes installed' as item, count(*)::text || ' of 16 (a few may be skipped if a table does not exist or already has one)' as value
  from pg_indexes where schemaname='public' and indexname in (
   'cc_store_orders_created_idx','cc_store_orders_status_created_idx','cc_store_orders_open_idx','cc_store_orders_customer_idx',
   'cc_store_orders_phone_idx','cc_store_orders_table_idx','cc_orders_customer_created_idx','cc_customer_addresses_customer_idx',
   'cc_order_ratings_order_idx','cc_store_menu_available_idx','cc_app_settings_key_idx','cc_store_orders_id_text_idx',
   'cc_customers_email_lower_idx','cc_customers_email_idx','cc_loyalty_members_phone10_idx','cc_loyalty_stamp_log_member_idx')
union all
select 'menu stats saved rows', count(*)::text from public.cc_store_menu_stats_cache
union all
select 'live-update tables (realtime)', coalesce(string_agg(schemaname || '.' || tablename, ', ' order by tablename), 'none')
  from pg_publication_tables where pubname = 'supabase_realtime'
union all
select 'realtime publishes ALL tables?', coalesce((select puballtables::text from pg_publication where pubname='supabase_realtime'), 'no publication');
