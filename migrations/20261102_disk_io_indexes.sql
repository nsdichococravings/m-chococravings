-- Indexes for the tables the app reads all day.
--
-- Supabase warned that the project is using up its Disk IO budget, after
-- which the database slows to a crawl and stops answering (the 8:30 pm
-- freezes). The busiest table, store_orders (On Store, Kitchen, Tables
-- board, reports), had no indexes, so every Kitchen refresh, live update
-- and report read the whole order history from disk. These indexes let
-- the database read only the rows it needs.
--
-- Safe to run more than once. Each index is only created if its table and
-- columns exist, so a missing optional table or column is skipped with a
-- notice instead of failing. Run it in Supabase: SQL Editor -> paste -> Run.
-- Creating the indexes takes a few seconds on a small database; run it
-- outside the busiest hour if you can.

set lock_timeout = '10s';

do $$
declare
  ix record;
  missing text;
begin
  for ix in
    select * from (values
      -- Kitchen / On Store: today's open orders, newest last.
      ('cc_store_orders_created_idx', 'store_orders', array['created_at'],
       'create index if not exists cc_store_orders_created_idx on public.store_orders (created_at)'),
      ('cc_store_orders_status_created_idx', 'store_orders', array['status','created_at'],
       'create index if not exists cc_store_orders_status_created_idx on public.store_orders (status, created_at)'),
      -- Tables board: every order that is still open.
      ('cc_store_orders_open_idx', 'store_orders', array['status','created_at'],
       'create index if not exists cc_store_orders_open_idx on public.store_orders (created_at) where status not in (''collected'',''cancelled'')'),
      -- Customer's own On Store orders, and loyalty lookups by phone.
      ('cc_store_orders_customer_idx', 'store_orders', array['customer_id','created_at'],
       'create index if not exists cc_store_orders_customer_idx on public.store_orders (customer_id, created_at desc)'),
      ('cc_store_orders_phone_idx', 'store_orders', array['customer_phone'],
       'create index if not exists cc_store_orders_phone_idx on public.store_orders (customer_phone)'),
      ('cc_store_orders_table_idx', 'store_orders', array['table_code'],
       'create index if not exists cc_store_orders_table_idx on public.store_orders (table_code) where table_code is not null'),
      -- Online orders: a customer's orders by date, open ones by status.
      ('cc_orders_customer_created_idx', 'orders', array['customer_id','created_at'],
       'create index if not exists cc_orders_customer_created_idx on public.orders (customer_id, created_at desc)'),
      -- Profile: saved addresses.
      ('cc_customer_addresses_customer_idx', 'customer_addresses', array['customer_id'],
       'create index if not exists cc_customer_addresses_customer_idx on public.customer_addresses (customer_id)'),
      -- Ratings shown on My Orders and the menu.
      ('cc_order_ratings_order_idx', 'cc_order_ratings', array['order_id'],
       'create index if not exists cc_order_ratings_order_idx on public.cc_order_ratings (order_id)'),
      -- On Store menu.
      ('cc_store_menu_available_idx', 'store_menu', array['available','sort_order'],
       'create index if not exists cc_store_menu_available_idx on public.store_menu (available, sort_order)'),
      -- Settings looked up by key on every page.
      ('cc_app_settings_key_idx', 'app_settings', array['key'],
       'create index if not exists cc_app_settings_key_idx on public.app_settings (key)')
    ) as t(name, tbl, cols, ddl)
  loop
    if to_regclass('public.' || ix.tbl) is null then
      raise notice 'Skipped %: table % not found', ix.name, ix.tbl;
      continue;
    end if;
    select string_agg(c, ', ') into missing
    from unnest(ix.cols) as c
    where not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = ix.tbl and column_name = c
    );
    if missing is not null then
      raise notice 'Skipped %: %.% has no column(s) %', ix.name, 'public', ix.tbl, missing;
      continue;
    end if;
    execute ix.ddl;
    raise notice 'OK %', ix.name;
  end loop;
end $$;

-- Refresh the planner's statistics so it starts using the new indexes.
analyze public.store_orders;
analyze public.orders;
