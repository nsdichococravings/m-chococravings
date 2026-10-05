-- Automatic stock & restock, built on the existing Production workspace
-- (inventory_items / packaging_materials / display_stock / recipes /
-- production requests). Nothing here replaces existing behaviour.
--
--  1. SALES USE MATERIALS. When a store order is placed, every made-to-order
--     item (a menu item NOT tracked as counter stock) that has an active
--     recipe in Production > Recipes takes its ingredients & packaging off
--     Materials: recipe quantity × items sold ÷ recipe yield. A recipe with
--     yield 1 = "per cup / per plate". Items added later (Tables board) are
--     deducted then; cancelling the order puts everything back. What was
--     taken per order is kept in cc_sales_usage so restores are exact.
--     Counter items are skipped: baking a batch already used their
--     materials, and the existing display-stock trigger handles their sale.
--     Stock may go below zero if sales outpace recorded stock -- that shows
--     up on the To-buy list rather than ever blocking a sale.
--
--  2. COUNTER STOCK REFILLS ITSELF. When an Outlet item drops to its reorder
--     level, a sales production request is created automatically (source
--     'auto', quantity = up to twice the reorder level), unless one is
--     already open. It goes through the normal approve -> bake -> collect
--     flow. Per-item switch: display_stock.auto_restock.
--
--  3. BOOKINGS GO TO THE KITCHEN. A custom booking with a "cake for kitchen"
--     product (custom_bookings.production_product + production_qty) creates
--     a production request due on the booking date (source 'booking').
--     Editing the booking updates it while still pending; cancelling the
--     booking cancels it if baking hasn't started. Booked cake products are
--     set to auto_restock=false so they're never auto-baked for the counter.
--     Marking the booking Delivered takes the cake(s) out of Outlet stock.
--
--  4. cc_set_reorder_level() lets the Production screen edit reorder levels
--     (and the Outlet auto switch). The To-buy list itself is computed in the
--     screen from stock <= reorder level.
--
-- Requires the Production workspace migrations (20260918*, 20260920) to
-- have been run -- checked below. customers.id / orders ids are text in
-- this database, so ids are handled as text.
--
-- Run this ENTIRE file as database owner. Safe to re-run.
begin;
do $$ begin
 if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='cc_production_requests') then
  raise exception 'cc_production_requests not found -- run the Production workspace migrations first.';
 end if;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='cc_production_recipes' and column_name='deleted_at') then
  raise exception 'cc_production_recipes.deleted_at not found -- run migrations/20260920_approvals.sql first.';
 end if;
 if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='store_orders') then
  raise exception 'store_orders not found -- is this the right database?';
 end if;
end $$;

alter table public.cc_production_requests add column if not exists source text not null default 'manual';
alter table public.cc_production_requests add column if not exists booking_id text;
alter table public.cc_production_requests add column if not exists notes text;
create unique index if not exists cc_production_requests_booking_uq on public.cc_production_requests(booking_id) where booking_id is not null;
alter table public.display_stock add column if not exists auto_restock boolean not null default true;
alter table public.packaging_materials add column if not exists low_stock_threshold numeric not null default 0;
alter table public.store_menu add column if not exists track_display_stock boolean not null default false;

create table if not exists public.cc_sales_usage(
 order_id text not null,
 kind text not null check (kind in ('raw','packaging')),
 name text not null,
 unit text not null,
 quantity numeric not null,
 updated_at timestamptz not null default now(),
 primary key(order_id, kind, name)
);
alter table public.cc_sales_usage enable row level security;
revoke all on public.cc_sales_usage from public, anon, authenticated;

-- items column -> jsonb array, whatever shape it was stored in (also defined in 20260954).
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

create or replace function public.cc_today_ist() returns date
language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- The account automatic requests are filed under (requested_by is required):
-- the first production admin, else the first confirmed admin customer.
create or replace function public.cc_auto_actor() returns uuid
language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(
  (select user_id from public.cc_production_members where role='admin' order by created_at limit 1),
  (select u.id from auth.users u join public.customers c on lower(c.email)=lower(u.email)
    where c.is_admin and u.email_confirmed_at is not null order by u.created_at limit 1))
$$;

-- Same rule as before, plus: system writes made by these triggers (marked
-- with the cc.system_write setting) may cancel a pending request.
create or replace function public.cc_guard_sales_approval() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if coalesce(current_setting('cc.system_write', true),'')='on' then return new; end if;
 if old.status='pending' and new.status in ('approved','cancelled') and not public.cc_can_review_approvals() then
   raise exception 'Only admin or super admin can approve or reject sales requests';
 end if;
 return new;
end $$;

-- ── 1. Sales use materials ─────────────────────────────────────
create or replace function public.cc_apply_sales_usage(p_order_id text, p_items jsonb, p_status text) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r record; v_unit text;
begin
 create temp table if not exists cc_tmp_usage(kind text, name text, unit text, quantity numeric) on commit drop;
 delete from cc_tmp_usage;
 if coalesce(p_status,'') <> 'cancelled' then
  insert into cc_tmp_usage(kind,name,unit,quantity)
  select l.kind, l.name, l.unit, sum(l.qty)
  from (
   select lower(btrim(i->>'name')) as key, sum(coalesce(nullif(i->>'qty','')::numeric, nullif(i->>'quantity','')::numeric, 1)) as sold
   from jsonb_array_elements(public.cc_store_items(p_items)) i
   where coalesce(btrim(i->>'name'),'')<>''
   group by 1
  ) s
  join lateral (
   select m.name from public.store_menu m
   where lower(btrim(m.name))=s.key and not coalesce(m.track_display_stock,false)
   limit 1
  ) mm on true
  join lateral (
   select rc.* from public.cc_production_recipes rc
   where lower(btrim(rc.product_name))=s.key and rc.deleted_at is null
   order by rc.created_at desc limit 1
  ) rc on true
  cross join lateral (
   select 'raw' as kind, x->>'name' as name, x->>'unit' as unit, (x->>'quantity')::numeric * s.sold / rc.yield_qty as qty
   from jsonb_array_elements(rc.ingredients) x
   union all
   select 'packaging', x->>'name', x->>'unit', (x->>'quantity')::numeric * s.sold / rc.yield_qty
   from jsonb_array_elements(coalesce(rc.packaging,'[]'::jsonb)) x
  ) l
  where s.sold > 0
  group by l.kind, l.name, l.unit;
 end if;

 -- Apply the difference between what this order should use now and what it already used.
 for r in
  select coalesce(t.kind,u.kind) as kind, coalesce(t.name,u.name) as name, coalesce(t.unit,u.unit) as unit,
         coalesce(t.quantity,0) as want, coalesce(u.quantity,0) as had
  from cc_tmp_usage t
  full join (select * from public.cc_sales_usage where order_id=p_order_id) u on u.kind=t.kind and u.name=t.name
 loop
  continue when r.want = r.had;
  if r.kind='raw' then
   select unit into v_unit from public.inventory_items where name=r.name;
   if v_unit is not null and v_unit=r.unit then
    update public.inventory_items set current_stock=current_stock-(r.want-r.had), updated_at=now() where name=r.name;
   else continue; end if;
  else
   select unit into v_unit from public.packaging_materials where name=r.name;
   if v_unit is not null and v_unit=r.unit then
    update public.packaging_materials set current_stock=current_stock-(r.want-r.had), updated_at=now() where name=r.name;
   else continue; end if;
  end if;
  if r.want = 0 then
   delete from public.cc_sales_usage where order_id=p_order_id and kind=r.kind and name=r.name;
  else
   insert into public.cc_sales_usage(order_id,kind,name,unit,quantity) values(p_order_id,r.kind,r.name,r.unit,r.want)
    on conflict (order_id,kind,name) do update set quantity=excluded.quantity, unit=excluded.unit, updated_at=now();
  end if;
 end loop;
end $$;

create or replace function public.cc_sales_usage_trigger() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 begin
  if tg_op='DELETE' then
   perform public.cc_apply_sales_usage(old.id::text, '[]'::jsonb, 'cancelled');
   return old;
  end if;
  perform public.cc_apply_sales_usage(new.id::text, to_jsonb(new.items), new.status);
 exception when others then
  raise warning 'sales stock usage skipped for order %: %', coalesce(new.id::text, old.id::text), sqlerrm; -- never block an order
 end;
 return coalesce(new, old);
end $$;

drop trigger if exists cc_sales_usage on public.store_orders;
create trigger cc_sales_usage after insert or update of items, status or delete on public.store_orders
 for each row execute function public.cc_sales_usage_trigger();

-- ── 2. Counter stock refills itself ────────────────────────────
create or replace function public.cc_auto_outlet_request(p_item text) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare d public.display_stock%rowtype; v_actor uuid; v_qty integer;
begin
 select * into d from public.display_stock where item_name=p_item;
 if d.id is null or not d.auto_restock or coalesce(d.low_stock_threshold,0) <= 0 or d.current_stock > d.low_stock_threshold then return; end if;
 if exists(select 1 from public.cc_production_requests where product_name=p_item and status not in ('fulfilled','cancelled')) then return; end if;
 if (select count(*) from public.store_menu where name=p_item) <> 1 then return; end if;
 v_actor := public.cc_auto_actor();
 if v_actor is null then raise warning 'No admin account to file automatic production requests under'; return; end if;
 v_qty := greatest(ceil(d.low_stock_threshold*2 - greatest(d.current_stock,0))::integer, 1);
 insert into public.cc_production_requests(product_name,quantity,due_date,requested_by,source,notes)
  values(p_item, v_qty, public.cc_today_ist(), v_actor, 'auto',
         'Outlet stock ' || trim(to_char(d.current_stock,'FM999999990.##')) || ' (reorder level ' || trim(to_char(d.low_stock_threshold,'FM999999990.##')) || ')');
end $$;

create or replace function public.cc_outlet_low_trigger() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 begin
  perform public.cc_auto_outlet_request(new.item_name);
 exception when others then
  raise warning 'auto production request skipped for %: %', new.item_name, sqlerrm; -- never block a sale or count
 end;
 return new;
end $$;

drop trigger if exists cc_outlet_low on public.display_stock;
create trigger cc_outlet_low after insert or update of current_stock, low_stock_threshold, auto_restock on public.display_stock
 for each row execute function public.cc_outlet_low_trigger();

-- ── 3. Bookings go to the kitchen ──────────────────────────────
do $$ begin
 if exists(select 1 from information_schema.tables where table_schema='public' and table_name='custom_bookings') then
  alter table public.custom_bookings add column if not exists production_product text;
  alter table public.custom_bookings add column if not exists production_qty integer;
  alter table public.custom_bookings add column if not exists stock_released boolean not null default false;
 end if;
end $$;

create or replace function public.cc_booking_sync() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_product text := nullif(btrim(coalesce(new.production_product,'')),'');
        v_qty integer := greatest(coalesce(new.production_qty,1),1);
        v_req public.cc_production_requests%rowtype; v_actor uuid; v_note text;
begin
 begin
  perform set_config('cc.system_write','on',true);
  select * into v_req from public.cc_production_requests where booking_id=new.id::text;
  v_note := 'Booking: ' || coalesce(new.customer_name,'') || coalesce(' · ' || nullif(new.cake_name_text,''),'');

  if new.status='cancelled' or v_product is null then
   if v_req.id is not null and v_req.status in ('pending','approved') then
    update public.cc_production_requests set status='cancelled', review_note='Booking cancelled or cake removed' where id=v_req.id;
   end if;
  elsif v_req.id is null or v_req.status='cancelled' then
   if (select count(*) from public.store_menu where name=v_product) = 1 then
    v_actor := public.cc_auto_actor();
    if v_actor is not null then
     if v_req.id is not null then delete from public.cc_production_requests where id=v_req.id and status='cancelled'
      and not exists(select 1 from public.cc_production_batches b where b.request_id=v_req.id); end if;
     insert into public.cc_production_requests(product_name,quantity,due_date,requested_by,source,booking_id,notes)
      values(v_product, v_qty, new.booking_date::date, v_actor, 'booking', new.id::text, v_note)
      on conflict (booking_id) where booking_id is not null do nothing;
    end if;
    -- Booked cakes are made to order: never auto-bake them for the counter.
    insert into public.display_stock(item_name,category,current_stock,low_stock_threshold,auto_restock)
     select name, category, 0, 0, false from public.store_menu where name=v_product
     on conflict (item_name) do update set auto_restock=false;
   end if;
  elsif v_req.status='pending' then
   update public.cc_production_requests set product_name=case when (select count(*) from public.store_menu where name=v_product)=1 then v_product else product_name end,
    quantity=v_qty, due_date=new.booking_date::date, notes=v_note where id=v_req.id;
  else
   update public.cc_production_requests set due_date=new.booking_date::date, notes=v_note where id=v_req.id;
  end if;

  -- Delivered: the cake leaves the outlet (it was collected into Outlet stock).
  if new.status='delivered' and not coalesce(new.stock_released,false) and v_product is not null then
   update public.display_stock set current_stock=greatest(current_stock - v_qty, 0), updated_at=now() where item_name=v_product;
   update public.custom_bookings set stock_released=true where id=new.id;
  end if;
  perform set_config('cc.system_write','off',true);
 exception when others then
  perform set_config('cc.system_write','off',true);
  raise warning 'booking % kitchen sync skipped: %', new.id, sqlerrm; -- never block saving a booking
 end;
 return new;
end $$;

do $$ begin
 if exists(select 1 from information_schema.tables where table_schema='public' and table_name='custom_bookings') then
  drop trigger if exists cc_booking_sync on public.custom_bookings;
  create trigger cc_booking_sync after insert or update of status, booking_date, production_product, production_qty, customer_name, cake_name_text
   on public.custom_bookings for each row execute function public.cc_booking_sync();
 end if;
end $$;

-- ── 4. Reorder levels from the Production screen ───────────────
create or replace function public.cc_set_reorder_level(p_kind text, p_name text, p_level numeric, p_auto boolean default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_role text := public.cc_production_role(); v_n int;
begin
 if auth.uid() is null or v_role is null then raise exception 'Production access required' using errcode='42501'; end if;
 if p_level is null or p_level < 0 or p_level > 1000000 then raise exception 'Enter a reorder level of 0 or more'; end if;
 if p_kind='raw' then
  update public.inventory_items set low_stock_threshold=p_level, updated_at=now() where name=p_name;
 elsif p_kind='packaging' then
  update public.packaging_materials set low_stock_threshold=p_level, updated_at=now() where name=p_name;
 elsif p_kind='outlet' then
  update public.display_stock set low_stock_threshold=p_level, auto_restock=coalesce(p_auto,auto_restock), updated_at=now() where item_name=p_name;
 else raise exception 'Unknown stock type'; end if;
 get diagnostics v_n = row_count;
 if v_n = 0 then raise exception 'Item not found: %', p_name; end if;
 return jsonb_build_object('ok',true);
end $$;

revoke all on function public.cc_apply_sales_usage(text,jsonb,text), public.cc_sales_usage_trigger(), public.cc_auto_outlet_request(text),
 public.cc_outlet_low_trigger(), public.cc_booking_sync(), public.cc_auto_actor() from public, anon, authenticated;
revoke all on function public.cc_set_reorder_level(text,text,numeric,boolean) from public, anon;
grant execute on function public.cc_set_reorder_level(text,text,numeric,boolean) to authenticated;
notify pgrst, 'reload schema';
commit;
