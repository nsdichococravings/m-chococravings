-- NSDI Store (grocery) — Phase 1: outlet pickup, one "5 KG Pack" to start.
--
-- Separate from On Store: every table and function here starts with grocery_.
-- Nothing in store_*, products, orders, loyalty or payments is read or changed.
--
-- Safe to run more than once. It ships switched OFF:
--   grocery_settings.enabled        = false  (customers do not see the store)
--   grocery_settings.online_enabled = false  (no Razorpay payments)
-- Admins can preview and test with "Cash at pickup" while it is off.
-- The owner turns it on from Admin → NSDI Store → Settings.
--
-- Roll back: set enabled=false. To remove entirely, run the drop block at the end
-- of this file (commented out).
--
-- How stock works
--   on_hand  = packs physically at the outlet
--   reserved = packs held for orders that are not paid yet
--   available to sell = on_hand - reserved   (never below 0, enforced by a check)
--   Place order   → reserved += qty   (only if enough is available; one SQL update, so
--                                       two people can never buy the last pack)
--   Paid online   → on_hand -= qty, reserved -= qty   ("sale")
--   Cash pickup   → same "sale" when staff tap "Paid & picked up"
--   Not paid in time (15 min online, 24 h cash) or cancelled → reserved -= qty
--   Cancel after paying → on_hand += qty, refund is recorded by staff
begin;

-- ── Tables ───────────────────────────────────────────────────────────
create table if not exists public.grocery_settings(
 id int primary key default 1 check (id = 1),
 enabled boolean not null default false,
 pilot_only boolean not null default true,
 online_enabled boolean not null default false,
 cash_enabled boolean not null default true,
 hold_minutes int not null default 15 check (hold_minutes between 5 and 60),
 cash_hold_hours int not null default 24 check (cash_hold_hours between 1 and 72),
 max_qty_per_item int not null default 5 check (max_qty_per_item between 1 and 50),
 outlet_name text not null default 'NSDI ChocoCravings outlet',
 outlet_address text not null default 'Outlet address (placeholder)',
 pickup_hours text not null default '10 am – 9 pm',
 notice text,
 updated_at timestamptz not null default now(),
 updated_by uuid
);
insert into public.grocery_settings(id) values (1) on conflict (id) do nothing;

create table if not exists public.grocery_pilot_customers(
 customer_id text primary key,   -- customers.id as text (live ids are text; no hard link so ids of any type work)
 added_at timestamptz not null default now(),
 added_by uuid
);

create table if not exists public.grocery_categories(
 id uuid primary key default gen_random_uuid(),
 name text not null unique,
 sort int not null default 0
);
insert into public.grocery_categories(name, sort) values ('Staples', 1) on conflict (name) do nothing;

create table if not exists public.grocery_products(
 id uuid primary key default gen_random_uuid(),
 name text not null check (length(trim(name)) between 2 and 80),
 brand text not null default 'NSDI',
 category_id uuid references public.grocery_categories(id) on delete set null,
 unit_label text not null default '5 kg',          -- shown on the card: "5 kg"
 description text,
 mrp numeric(10,2) not null check (mrp > 0),
 price numeric(10,2) not null check (price > 0 and price <= mrp),
 cost numeric(10,2) check (cost is null or cost >= 0),  -- admin only, for profit
 low_stock_level int not null default 10 check (low_stock_level >= 0),
 selling_fast_level int not null default 10 check (selling_fast_level >= 1),
 -- Legal Metrology declarations (needed before publishing)
 net_quantity text,
 manufacturer text,
 country_of_origin text default 'India',
 best_before text,
 fssai_license text,
 hsn_code text,
 gst_rate numeric(4,2) check (gst_rate is null or gst_rate between 0 and 28),
 -- Home carousel card
 featured boolean not null default false,
 slide_title text,
 slide_text text,
 slide_color text not null default 'peach' check (slide_color in ('peach','mint','sky','blush','lemon','lilac')),
 sort int not null default 0,
 is_published boolean not null default false,
 deleted_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.grocery_product_images(
 id uuid primary key default gen_random_uuid(),
 product_id uuid not null references public.grocery_products(id) on delete cascade,
 full_url text not null,
 thumb_url text not null,
 sort int not null default 0,
 created_at timestamptz not null default now()
);
create index if not exists grocery_product_images_product_idx on public.grocery_product_images(product_id, sort);

create table if not exists public.grocery_stock(
 product_id uuid not null references public.grocery_products(id) on delete cascade,
 outlet_code text not null default 'MAIN',
 on_hand int not null default 0 check (on_hand >= 0),
 reserved int not null default 0 check (reserved >= 0),
 updated_at timestamptz not null default now(),
 primary key (product_id, outlet_code),
 check (reserved <= on_hand)
);

create table if not exists public.grocery_orders(
 id uuid primary key default gen_random_uuid(),
 order_no text not null unique,
 user_id uuid not null,
 customer_id text,                -- customers.id as text
 name text,
 phone text,
 outlet_code text not null default 'MAIN',
 payment_method text not null check (payment_method in ('online','cash')),
 status text not null check (status in ('awaiting_payment','placed','ready','picked_up','cancelled','expired')),
 payment_status text not null default 'pending' check (payment_status in ('pending','paid','refund_due','refunded','partially_refunded')),
 mrp_total numeric(10,2) not null,
 total numeric(10,2) not null check (total > 0),
 hold_until timestamptz,
 idempotency_key text not null,
 rzp_order_id text,
 cancel_reason text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 paid_at timestamptz,
 ready_at timestamptz,
 picked_up_at timestamptz,
 closed_at timestamptz,
 unique (user_id, idempotency_key)
);
create index if not exists grocery_orders_user_idx on public.grocery_orders(user_id, created_at desc);
create index if not exists grocery_orders_status_idx on public.grocery_orders(status, created_at desc);
create index if not exists grocery_orders_hold_idx on public.grocery_orders(hold_until) where payment_status = 'pending' and status in ('awaiting_payment','placed');
create sequence if not exists public.grocery_order_seq;

create table if not exists public.grocery_order_items(
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.grocery_orders(id) on delete cascade,
 product_id uuid not null references public.grocery_products(id),
 name text not null,
 unit_label text not null,
 qty int not null check (qty > 0),
 price numeric(10,2) not null,
 mrp numeric(10,2) not null,
 cost numeric(10,2),
 line_total numeric(10,2) not null
);
create index if not exists grocery_order_items_order_idx on public.grocery_order_items(order_id);
create index if not exists grocery_order_items_product_idx on public.grocery_order_items(product_id);

create table if not exists public.grocery_payments(
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.grocery_orders(id) on delete cascade,
 method text not null check (method in ('online','cash')),
 amount numeric(10,2) not null,
 rzp_payment_id text unique,
 rzp_order_id text,
 recorded_by uuid,
 created_at timestamptz not null default now()
);
create index if not exists grocery_payments_order_idx on public.grocery_payments(order_id);

create table if not exists public.grocery_refunds(
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.grocery_orders(id) on delete cascade,
 amount numeric(10,2) not null check (amount > 0),
 reference text,
 reason text,
 recorded_by uuid,
 created_at timestamptz not null default now()
);

create table if not exists public.grocery_stock_movements(
 id bigint generated always as identity primary key,
 product_id uuid not null references public.grocery_products(id) on delete cascade,
 outlet_code text not null default 'MAIN',
 kind text not null check (kind in ('opening','restock','adjust','reserve','release','sale','return')),
 qty int not null,
 on_hand_after int not null,
 reserved_after int not null,
 order_id uuid references public.grocery_orders(id) on delete set null,
 note text,
 actor uuid,
 created_at timestamptz not null default now()
);
create index if not exists grocery_stock_movements_product_idx on public.grocery_stock_movements(product_id, created_at desc);

create table if not exists public.grocery_order_events(
 id bigint generated always as identity primary key,
 order_id uuid not null references public.grocery_orders(id) on delete cascade,
 event text not null,
 note text,
 actor uuid,
 created_at timestamptz not null default now()
);
create index if not exists grocery_order_events_order_idx on public.grocery_order_events(order_id, created_at);

create table if not exists public.grocery_item_requests(
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null,
 customer_id text,                -- customers.id as text
 item_key text not null check (length(item_key) between 1 and 70),
 label text not null check (length(label) between 1 and 60),
 note text check (note is null or length(note) <= 200),
 notify boolean not null default true,
 notified_at timestamptz,
 created_at timestamptz not null default now(),
 unique (user_id, item_key)
);
create index if not exists grocery_item_requests_key_idx on public.grocery_item_requests(item_key, created_at desc);

-- Everything goes through the functions below. No direct table access.
do $$ declare t text; begin
 foreach t in array array['grocery_settings','grocery_pilot_customers','grocery_categories','grocery_products',
   'grocery_product_images','grocery_stock','grocery_orders','grocery_order_items','grocery_payments',
   'grocery_refunds','grocery_stock_movements','grocery_order_events','grocery_item_requests'] loop
  execute format('alter table public.%I enable row level security', t);
  execute format('revoke all on public.%I from public, anon, authenticated', t);
 end loop;
end $$;
revoke all on sequence public.grocery_order_seq from public, anon, authenticated;

-- Placeholder product (draft, not visible to customers). Edit it in Admin before publishing.
insert into public.grocery_products(name, brand, category_id, unit_label, description, mrp, price, net_quantity,
  country_of_origin, featured, slide_title, slide_text, slide_color, sort)
select '5 KG Pack', 'NSDI', (select id from public.grocery_categories where name='Staples'), '5 kg',
  'Placeholder: add the real product name, photo and details before publishing.', 520, 465, '5 kg',
  'India', true, 'New: 5 KG Pack', 'Pick up at the outlet', 'peach', 1
where not exists (select 1 from public.grocery_products);
insert into public.grocery_stock(product_id) select id from public.grocery_products on conflict do nothing;

-- ── Who is calling ───────────────────────────────────────────────────
-- Staff roles use the same customers flags as the rest of the app, and need a
-- confirmed email (same rule as cc_prod_is_super).
create or replace function public.grocery_role() returns text
language sql stable security definer set search_path=pg_catalog,public as $$
 select case
   when bool_or(coalesce((to_jsonb(c)->>'is_super_user')::boolean,false)) then 'owner'
   when bool_or(coalesce((to_jsonb(c)->>'is_admin')::boolean,false)) then 'admin'
   when bool_or(coalesce((to_jsonb(c)->>'is_employee')::boolean,false)) then 'staff'
 end
 from auth.users u join public.customers c on lower(c.email)=lower(u.email)
 where u.id=auth.uid() and u.email_confirmed_at is not null
$$;

create or replace function public.grocery_customer_id() returns text
language sql stable security definer set search_path=pg_catalog,public as $$
 select c.id::text from auth.users u join public.customers c on lower(c.email)=lower(u.email)
 where u.id=auth.uid() order by c.id limit 1
$$;

create or replace function public.grocery_require(p_level text) returns text
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare r text := coalesce(public.grocery_role(), 'customer');
begin
 if auth.uid() is null then raise exception 'Please sign in first' using errcode='42501'; end if;
 if not (p_level='owner' and r='owner'
      or p_level='admin' and r in ('owner','admin')
      or p_level='staff' and r in ('owner','admin','staff')) then
  raise exception 'You do not have access to this' using errcode='42501';
 end if;
 return r;
end $$;

-- Can this person shop? Staff can always preview (Cash only while online is off).
create or replace function public.grocery_can_shop() returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select public.grocery_role() is not null
  or exists(select 1 from public.grocery_settings s where s.enabled and (not s.pilot_only
       or exists(select 1 from public.grocery_pilot_customers p where p.customer_id=public.grocery_customer_id())))
$$;

-- ── Stock helper: change stock and log it in one place ───────────────
create or replace function public.grocery_move_stock(p_product uuid, p_kind text, p_qty int, p_order uuid, p_note text)
returns boolean language plpgsql security definer set search_path=pg_catalog,public as $$
declare v public.grocery_stock;
begin
 if p_kind='reserve' then
  update public.grocery_stock set reserved=reserved+p_qty, updated_at=now()
   where product_id=p_product and outlet_code='MAIN' and on_hand-reserved>=p_qty returning * into v;
 elsif p_kind='release' then
  update public.grocery_stock set reserved=greatest(reserved-p_qty,0), updated_at=now()
   where product_id=p_product and outlet_code='MAIN' returning * into v;
 elsif p_kind='sale' then           -- a reserved pack leaves the shelf
  update public.grocery_stock set on_hand=on_hand-p_qty, reserved=reserved-p_qty, updated_at=now()
   where product_id=p_product and outlet_code='MAIN' and reserved>=p_qty and on_hand>=p_qty returning * into v;
 elsif p_kind='sale_direct' then    -- late payment after the hold ran out: take it if still free
  update public.grocery_stock set on_hand=on_hand-p_qty, updated_at=now()
   where product_id=p_product and outlet_code='MAIN' and on_hand-reserved>=p_qty returning * into v;
  p_kind := 'sale';
 elsif p_kind in ('opening','restock','adjust','return') then
  insert into public.grocery_stock(product_id) values (p_product) on conflict do nothing;
  update public.grocery_stock set on_hand=on_hand+p_qty, updated_at=now()
   where product_id=p_product and outlet_code='MAIN' and on_hand+p_qty>=reserved returning * into v;
 else
  raise exception 'Unknown stock change %', p_kind;
 end if;
 if v.product_id is null then return false; end if;
 insert into public.grocery_stock_movements(product_id, kind, qty, on_hand_after, reserved_after, order_id, note, actor)
 values (p_product, p_kind, p_qty, v.on_hand, v.reserved, p_order, p_note, auth.uid());
 return true;
end $$;
revoke all on function public.grocery_move_stock(uuid,text,int,uuid,text) from public, anon, authenticated;

create or replace function public.grocery_log(p_order uuid, p_event text, p_note text) returns void
language sql security definer set search_path=pg_catalog,public as $$
 insert into public.grocery_order_events(order_id, event, note, actor) values (p_order, p_event, p_note, auth.uid());
$$;
revoke all on function public.grocery_log(uuid,text,text) from public, anon, authenticated;

-- Release an unpaid order's held packs, or put back a paid order's packs.
create or replace function public.grocery_close_order(p_order uuid, p_status text, p_reason text)
returns public.grocery_orders language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.grocery_orders; i record;
begin
 select * into o from public.grocery_orders where id=p_order for update;
 if o.id is null then raise exception 'Order not found'; end if;
 if o.status in ('cancelled','expired','picked_up') then return o; end if;
 for i in select product_id, qty from public.grocery_order_items where order_id=o.id order by product_id loop
  if o.payment_status='pending' then
   perform public.grocery_move_stock(i.product_id, 'release', i.qty, o.id, p_status);
  else
   perform public.grocery_move_stock(i.product_id, 'return', i.qty, o.id, p_status);
  end if;
 end loop;
 update public.grocery_orders set status=p_status, cancel_reason=p_reason, hold_until=null, closed_at=now(), updated_at=now(),
   payment_status=case when payment_status='paid' then 'refund_due' else payment_status end
  where id=o.id returning * into o;
 perform public.grocery_log(o.id, p_status, p_reason);
 return o;
end $$;
revoke all on function public.grocery_close_order(uuid,text,text) from public, anon, authenticated;

create or replace function public.grocery_release_expired() returns int
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r record; n int := 0;
begin
 for r in select id from public.grocery_orders
   where payment_status='pending' and status in ('awaiting_payment','placed') and hold_until < now()
   order by hold_until limit 200 for update skip locked loop
  perform public.grocery_close_order(r.id, 'expired', 'Not paid in time');
  n := n + 1;
 end loop;
 return n;
end $$;
revoke all on function public.grocery_release_expired() from public, anon, authenticated;

-- Push a message to customers (reuses send-push "winback" type). Never fails the caller.
create or replace function public.grocery_push(p_messages jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_url text; v_secret text;
begin
 if p_messages is null or jsonb_array_length(p_messages)=0 then return false; end if;
 begin
  select value into v_url from public.cc_push_config where key='function_url';
  select value into v_secret from public.cc_push_config where key='webhook_secret';
  if coalesce(v_url,'')='' then return false; end if;
  perform net.http_post(url:=v_url,
   body:=jsonb_build_object('type','winback','messages',p_messages),
   headers:=jsonb_build_object('Content-Type','application/json','x-cc-push-secret',v_secret));
  return true;
 exception when others then return false;
 end;
end $$;
revoke all on function public.grocery_push(jsonb) from public, anon, authenticated;

-- ── Customer: entry tile, catalog ────────────────────────────────────
-- Small call for the home page: should this person see NSDI Store, and which cards?
create or replace function public.grocery_entry() returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select case when not public.grocery_can_shop() then jsonb_build_object('show', false) else jsonb_build_object('show', true,
   'preview', public.grocery_role() is not null and not coalesce((select enabled from public.grocery_settings),false),
   'slides', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'unit_label', p.unit_label,
       'title', coalesce(p.slide_title, p.name), 'text', p.slide_text, 'color', p.slide_color, 'price', p.price, 'mrp', p.mrp,
       'thumb', (select thumb_url from public.grocery_product_images g where g.product_id=p.id order by sort limit 1)) order by p.sort, p.created_at)
     from (select * from public.grocery_products where featured and deleted_at is null
            and (is_published or public.grocery_role() is not null) order by sort, created_at limit 6) p), '[]'::jsonb)) end
$$;

create or replace function public.grocery_product_json(p public.grocery_products, p_admin boolean)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 with st as (select coalesce(sum(on_hand),0)::int on_hand, coalesce(sum(reserved),0)::int reserved
              from public.grocery_stock where product_id=p.id),
 sold as (select coalesce(sum(i.qty),0)::int n from public.grocery_order_items i join public.grocery_orders o on o.id=i.order_id
          where i.product_id=p.id and o.status in ('awaiting_payment','placed','ready','picked_up')
            and o.created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata'))
 select jsonb_build_object(
   'id', p.id, 'name', p.name, 'brand', p.brand, 'unit_label', p.unit_label, 'description', p.description,
   'category', (select name from public.grocery_categories where id=p.category_id),
   'mrp', p.mrp, 'price', p.price,
   'available', greatest(st.on_hand-st.reserved,0),
   'low_stock_level', p.low_stock_level, 'selling_fast_level', p.selling_fast_level,
   'sold_today', sold.n,
   'net_quantity', p.net_quantity, 'manufacturer', p.manufacturer, 'country_of_origin', p.country_of_origin,
   'best_before', p.best_before, 'fssai_license', p.fssai_license,
   'featured', p.featured, 'slide_title', p.slide_title, 'slide_text', p.slide_text, 'slide_color', p.slide_color,
   'images', coalesce((select jsonb_agg(jsonb_build_object('full', full_url, 'thumb', thumb_url) order by sort)
                       from public.grocery_product_images where product_id=p.id), '[]'::jsonb))
  || case when p_admin then jsonb_build_object('cost', p.cost, 'on_hand', st.on_hand, 'reserved', st.reserved,
       'hsn_code', p.hsn_code, 'gst_rate', p.gst_rate, 'category_id', p.category_id, 'sort', p.sort,
       'is_published', p.is_published, 'deleted_at', p.deleted_at,
       'ever_ordered', exists(select 1 from public.grocery_order_items where product_id=p.id)) else '{}'::jsonb end
 from st, sold
$$;
revoke all on function public.grocery_product_json(public.grocery_products, boolean) from public, anon, authenticated;

create or replace function public.grocery_catalog() returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select jsonb_build_object(
   'open', public.grocery_can_shop(),
   'preview', public.grocery_role() is not null and not s.enabled,
   'signed_in', auth.uid() is not null,
   'settings', jsonb_build_object('outlet_name', s.outlet_name, 'outlet_address', s.outlet_address,
      'pickup_hours', s.pickup_hours, 'notice', s.notice, 'hold_minutes', s.hold_minutes,
      'cash_hold_hours', s.cash_hold_hours, 'max_qty_per_item', s.max_qty_per_item,
      'online_enabled', s.online_enabled, 'cash_enabled', s.cash_enabled),
   'products', case when public.grocery_can_shop() then coalesce((
      select jsonb_agg(public.grocery_product_json(p, false) order by p.sort, p.created_at)
      from public.grocery_products p
      where p.deleted_at is null and (p.is_published or public.grocery_role() is not null)), '[]'::jsonb)
    else '[]'::jsonb end)
 from public.grocery_settings s
$$;

-- ── Customer: place, pay, cancel, view ───────────────────────────────
create or replace function public.grocery_order_json(o public.grocery_orders) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select to_jsonb(o) - 'idempotency_key' - 'user_id'
  || jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object('product_id', i.product_id, 'name', i.name,
        'unit_label', i.unit_label, 'qty', i.qty, 'price', i.price, 'mrp', i.mrp, 'line_total', i.line_total,
        'thumb', (select thumb_url from public.grocery_product_images g where g.product_id=i.product_id order by sort limit 1)))
      from public.grocery_order_items i where i.order_id=o.id), '[]'::jsonb),
    'refunded', coalesce((select sum(amount) from public.grocery_refunds where order_id=o.id),0))
$$;
revoke all on function public.grocery_order_json(public.grocery_orders) from public, anon, authenticated;

create or replace function public.grocery_place_order(p_items jsonb, p_payment_method text, p_name text, p_phone text,
  p_idempotency_key text, p_expected_total numeric default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.grocery_settings; o public.grocery_orders; uid uuid := auth.uid(); it record;
 v_total numeric := 0; v_mrp numeric := 0; v_count int := 0; v_open int; v_lines jsonb;
begin
 if uid is null then raise exception 'Please sign in to order' using errcode='42501'; end if;
 if coalesce(length(p_idempotency_key),0) not between 8 and 80 then raise exception 'Missing order key'; end if;
 select * into o from public.grocery_orders where user_id=uid and idempotency_key=p_idempotency_key;
 if o.id is not null then return public.grocery_order_json(o); end if;   -- same tap sent twice
 if not public.grocery_can_shop() then raise exception 'NSDI Store is not open yet'; end if;
 select * into s from public.grocery_settings;
 if p_payment_method='online' and not s.online_enabled then raise exception 'Online payment is not available yet. Please choose Cash at pickup.'; end if;
 if p_payment_method='cash' and not s.cash_enabled then raise exception 'Cash at pickup is not available right now'; end if;
 if p_payment_method not in ('online','cash') then raise exception 'Choose a payment method'; end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 20 then raise exception 'Your bag is empty'; end if;

 perform public.grocery_release_expired();
 select count(*) into v_open from public.grocery_orders where user_id=uid and payment_status='pending' and status in ('awaiting_payment','placed');
 if v_open >= 3 then raise exception 'You already have 3 unpaid orders. Pay or cancel one first.'; end if;

 -- Combine repeated lines; check every price first so nothing is held if the total changed.
 select jsonb_agg(jsonb_build_object('product_id', product_id, 'qty', qty)) into v_lines from (
  select (e->>'product_id')::uuid product_id, sum(greatest(coalesce((e->>'qty')::int,0),0))::int qty
  from jsonb_array_elements(p_items) e group by 1) x;
 for it in select l.product_id, l.qty, p.name, p.price, p.mrp, p.is_published, p.deleted_at
   from jsonb_to_recordset(v_lines) l(product_id uuid, qty int) left join public.grocery_products p on p.id=l.product_id order by l.product_id loop
  if it.name is null or it.deleted_at is not null or (not it.is_published and public.grocery_role() is null) then
   raise exception 'An item in your bag is no longer sold. Please refresh.';
  end if;
  if it.qty < 1 then raise exception 'Choose at least 1 of %', it.name; end if;
  if it.qty > s.max_qty_per_item then raise exception 'You can buy up to % of % per order', s.max_qty_per_item, it.name; end if;
  v_total := v_total + it.price*it.qty; v_mrp := v_mrp + it.mrp*it.qty; v_count := v_count + 1;
 end loop;
 if p_expected_total is not null and round(p_expected_total,2) <> round(v_total,2) then
  raise exception 'PRICE_CHANGED: The price changed. New total is ₹%', trim(to_char(v_total,'FM999999990.00'));
 end if;

 insert into public.grocery_orders(order_no, user_id, customer_id, name, phone, payment_method, status, mrp_total, total, hold_until, idempotency_key)
 values ('NS' || to_char(now() at time zone 'Asia/Kolkata','YYMMDD') || '-' || lpad(nextval('public.grocery_order_seq')::text, 4, '0'),
   uid, public.grocery_customer_id(), left(trim(p_name),60), left(regexp_replace(coalesce(p_phone,''),'[^0-9+]','','g'),15),
   p_payment_method, case when p_payment_method='online' then 'awaiting_payment' else 'placed' end,
   v_mrp, v_total,
   case when p_payment_method='online' then now() + make_interval(mins => s.hold_minutes) else now() + make_interval(hours => s.cash_hold_hours) end,
   p_idempotency_key)
 returning * into o;

 for it in select l.product_id, l.qty, p.name, p.unit_label, p.price, p.mrp, p.cost
   from jsonb_to_recordset(v_lines) l(product_id uuid, qty int) join public.grocery_products p on p.id=l.product_id order by l.product_id loop
  if not public.grocery_move_stock(it.product_id, 'reserve', it.qty, o.id, null) then
   raise exception 'Sorry, only % left of %', (select greatest(on_hand-reserved,0) from public.grocery_stock where product_id=it.product_id and outlet_code='MAIN'), it.name;
  end if;
  insert into public.grocery_order_items(order_id, product_id, name, unit_label, qty, price, mrp, cost, line_total)
  values (o.id, it.product_id, it.name, it.unit_label, it.qty, it.price, it.mrp, it.cost, it.price*it.qty);
 end loop;
 perform public.grocery_log(o.id, 'placed', p_payment_method);
 return public.grocery_order_json(o);
end $$;

-- After Razorpay returns a payment id. Safe to call again with the same id.
create or replace function public.grocery_record_payment(p_order_id uuid, p_payment_id text, p_rzp_order_id text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.grocery_orders; i record; v_other uuid; ok boolean := true;
begin
 if auth.uid() is null then raise exception 'Please sign in' using errcode='42501'; end if;
 if coalesce(length(p_payment_id),0) not between 6 and 64 then raise exception 'Missing payment id'; end if;
 select * into o from public.grocery_orders where id=p_order_id for update;
 if o.id is null or (o.user_id <> auth.uid() and public.grocery_role() is null) then raise exception 'Order not found'; end if;
 select order_id into v_other from public.grocery_payments where rzp_payment_id=p_payment_id;
 if v_other is not null then
  if v_other <> o.id then raise exception 'This payment belongs to another order'; end if;
  return public.grocery_order_json(o);                     -- already recorded
 end if;
 if o.payment_method <> 'online' then raise exception 'This order is Cash at pickup'; end if;
 if o.payment_status <> 'pending' then raise exception 'This order is already paid'; end if;

 insert into public.grocery_payments(order_id, method, amount, rzp_payment_id, rzp_order_id, recorded_by)
 values (o.id, 'online', o.total, p_payment_id, p_rzp_order_id, auth.uid());

 if o.status = 'awaiting_payment' then
  for i in select product_id, qty from public.grocery_order_items where order_id=o.id order by product_id loop
   if not public.grocery_move_stock(i.product_id, 'sale', i.qty, o.id, null) then raise exception 'Stock record is out of step for this order. Please tell the outlet.'; end if;
  end loop;
  update public.grocery_orders set status='placed', payment_status='paid', paid_at=now(), hold_until=null,
    rzp_order_id=coalesce(p_rzp_order_id, rzp_order_id), updated_at=now() where id=o.id returning * into o;
  perform public.grocery_log(o.id, 'paid', p_payment_id);
 else
  -- Paid after the hold ran out: keep the order if the packs are still free, otherwise refund.
  if o.status = 'expired' then
   for i in select product_id, qty from public.grocery_order_items where order_id=o.id order by product_id loop
    if ok and not public.grocery_move_stock(i.product_id, 'sale_direct', i.qty, o.id, 'late payment') then ok := false; end if;
   end loop;
  else ok := false; end if;
  if ok then
   update public.grocery_orders set status='placed', payment_status='paid', paid_at=now(), closed_at=null, cancel_reason=null,
     rzp_order_id=coalesce(p_rzp_order_id, rzp_order_id), updated_at=now() where id=o.id returning * into o;
   perform public.grocery_log(o.id, 'paid', 'late payment, stock still free');
  else
   -- Put back anything taken above, then mark for refund.
   raise exception using message = 'LATE_PAYMENT', errcode = 'P0002';
  end if;
 end if;
 return public.grocery_order_json(o);
exception when sqlstate 'P0002' then
 -- The insert above was rolled back with the exception; record the payment again so staff can refund it.
 insert into public.grocery_payments(order_id, method, amount, rzp_payment_id, rzp_order_id, recorded_by)
 values (o.id, 'online', o.total, p_payment_id, p_rzp_order_id, auth.uid());
 update public.grocery_orders set payment_status='refund_due', paid_at=now(), updated_at=now(),
   cancel_reason=coalesce(cancel_reason,'') || ' · Paid after the hold ran out and the stock was sold. Refund due.'
  where id=o.id returning * into o;
 perform public.grocery_log(o.id, 'refund_due', 'late payment, stock gone');
 return public.grocery_order_json(o);
end $$;

create or replace function public.grocery_cancel_order(p_order_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.grocery_orders; staff boolean := public.grocery_role() is not null;
begin
 if auth.uid() is null then raise exception 'Please sign in' using errcode='42501'; end if;
 select * into o from public.grocery_orders where id=p_order_id;
 if o.id is null or (o.user_id <> auth.uid() and not staff) then raise exception 'Order not found'; end if;
 if o.status not in ('awaiting_payment','placed','ready') then raise exception 'This order can no longer be cancelled'; end if;
 if o.payment_status <> 'pending' and not staff then raise exception 'This order is paid. Please ask the outlet to cancel it.'; end if;
 o := public.grocery_close_order(o.id, 'cancelled', coalesce(nullif(trim(p_reason),''), case when staff then 'Cancelled by outlet' else 'Cancelled by customer' end));
 return public.grocery_order_json(o);
end $$;

create or replace function public.grocery_my_orders(p_limit int default 20) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(jsonb_agg(public.grocery_order_json(o) order by o.created_at desc), '[]'::jsonb)
 from (select * from public.grocery_orders where user_id=auth.uid() order by created_at desc limit least(greatest(p_limit,1),50)) o
$$;

create or replace function public.grocery_order(p_order_id uuid) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select public.grocery_order_json(o) || jsonb_build_object('events', coalesce((select jsonb_agg(jsonb_build_object('event',e.event,'at',e.created_at) order by e.created_at)
     from public.grocery_order_events e where e.order_id=o.id),'[]'::jsonb))
 from public.grocery_orders o where o.id=p_order_id and (o.user_id=auth.uid() or public.grocery_role() is not null)
$$;

-- ── Customer: "What should we stock for you?" ────────────────────────
create or replace function public.grocery_request_items(p_items jsonb, p_note text default null, p_notify boolean default true)
returns int language plpgsql security definer set search_path=pg_catalog,public as $$
declare e jsonb; k text; l text; n int := 0;
begin
 if auth.uid() is null then raise exception 'Please sign in to send your list' using errcode='42501'; end if;
 if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) not between 1 and 15 then raise exception 'Pick between 1 and 15 items'; end if;
 if (select count(*) from public.grocery_item_requests where user_id=auth.uid()) >= 60 then raise exception 'Thanks! You have sent a lot of requests already.'; end if;
 for e in select * from jsonb_array_elements(p_items) loop
  l := left(trim(regexp_replace(coalesce(e->>'label',''), '\s+', ' ', 'g')), 60);
  k := lower(left(trim(coalesce(nullif(e->>'key',''), 'other:' || l)), 70));
  if l = '' or k = '' then continue; end if;
  insert into public.grocery_item_requests(user_id, customer_id, item_key, label, note, notify)
  values (auth.uid(), public.grocery_customer_id(), k, l, left(nullif(trim(p_note),''),200), coalesce(p_notify,true))
  on conflict (user_id, item_key) do update set notify=excluded.notify, note=coalesce(excluded.note, grocery_item_requests.note);
  n := n + 1;
 end loop;
 return n;
end $$;

create or replace function public.grocery_my_requests() returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(jsonb_agg(item_key), '[]'::jsonb) from public.grocery_item_requests where user_id=auth.uid()
$$;

-- ── Admin: products and stock ────────────────────────────────────────
create or replace function public.grocery_admin_products(p_include_deleted boolean default false) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare r text := public.grocery_require('admin');
begin
 return jsonb_build_object('role', r,
  'categories', coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by sort, name) from public.grocery_categories), '[]'::jsonb),
  'products', coalesce((select jsonb_agg(public.grocery_product_json(p, true) order by p.deleted_at nulls first, p.sort, p.created_at)
    from public.grocery_products p where p_include_deleted or p.deleted_at is null), '[]'::jsonb));
end $$;

create or replace function public.grocery_admin_save_product(p jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v public.grocery_products; v_id uuid := nullif(p->>'id','')::uuid; v_new boolean; v_open int; img jsonb; n int := 0;
 v_publish boolean := coalesce((p->>'is_published')::boolean, false);
begin
 perform public.grocery_require('admin');
 if v_id is not null and not exists(select 1 from public.grocery_products where id=v_id and deleted_at is null) then raise exception 'Product not found'; end if;
 v_new := v_id is null;
 if coalesce(trim(p->>'name'),'') = '' then raise exception 'Add the product name'; end if;
 if coalesce((p->>'price')::numeric,0) <= 0 then raise exception 'Add the selling price'; end if;
 if coalesce((p->>'mrp')::numeric,0) < (p->>'price')::numeric then raise exception 'MRP must be at least the selling price'; end if;
 if v_publish then
  if coalesce(trim(p->>'net_quantity'),'')='' or coalesce(trim(p->>'manufacturer'),'')='' or coalesce(trim(p->>'country_of_origin'),'')='' then
   raise exception 'Before publishing, add net quantity, manufacturer/packer and country of origin (needed on the pack details)';
  end if;
 end if;

 if v_new then
  insert into public.grocery_products(name, mrp, price) values (trim(p->>'name'), (p->>'mrp')::numeric, (p->>'price')::numeric) returning id into v_id;
 end if;
 update public.grocery_products set
   name=left(trim(p->>'name'),80), brand=coalesce(nullif(trim(p->>'brand'),''),'NSDI'),
   category_id=coalesce(nullif(p->>'category_id','')::uuid, (select id from public.grocery_categories order by sort limit 1)),
   unit_label=coalesce(nullif(trim(p->>'unit_label'),''),'1 pack'), description=nullif(trim(p->>'description'),''),
   mrp=(p->>'mrp')::numeric, price=(p->>'price')::numeric, cost=nullif(p->>'cost','')::numeric,
   low_stock_level=coalesce(nullif(p->>'low_stock_level','')::int,10), selling_fast_level=coalesce(nullif(p->>'selling_fast_level','')::int,10),
   net_quantity=nullif(trim(p->>'net_quantity'),''), manufacturer=nullif(trim(p->>'manufacturer'),''),
   country_of_origin=nullif(trim(p->>'country_of_origin'),''), best_before=nullif(trim(p->>'best_before'),''),
   fssai_license=nullif(trim(p->>'fssai_license'),''), hsn_code=nullif(trim(p->>'hsn_code'),''), gst_rate=nullif(p->>'gst_rate','')::numeric,
   featured=coalesce((p->>'featured')::boolean,false), slide_title=nullif(trim(p->>'slide_title'),''), slide_text=nullif(trim(p->>'slide_text'),''),
   slide_color=coalesce(nullif(p->>'slide_color',''),'peach'), sort=coalesce(nullif(p->>'sort','')::int,0),
   is_published=v_publish, updated_at=now()
  where id=v_id returning * into v;

 if p ? 'images' then
  delete from public.grocery_product_images where product_id=v_id;
  for img in select * from jsonb_array_elements(p->'images') loop
   if coalesce(img->>'full','') !~ '^https://' or coalesce(img->>'thumb','') !~ '^https://' then raise exception 'Photo address must start with https://'; end if;
   insert into public.grocery_product_images(product_id, full_url, thumb_url, sort) values (v_id, img->>'full', img->>'thumb', n);
   n := n + 1;
  end loop;
 end if;

 if v_publish and not exists(select 1 from public.grocery_product_images where product_id=v_id) then
  raise exception 'Add a product photo before publishing';
 end if;
 insert into public.grocery_stock(product_id) values (v_id) on conflict do nothing;
 v_open := coalesce(nullif(p->>'opening_stock','')::int, 0);
 if v_new and v_open > 0 then perform public.grocery_move_stock(v_id, 'opening', v_open, null, 'Opening stock'); end if;
 return public.grocery_product_json(v, true);
end $$;

create or replace function public.grocery_admin_adjust_stock(p_product_id uuid, p_delta int, p_kind text, p_note text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare v public.grocery_products;
begin
 perform public.grocery_require('admin');
 if p_kind not in ('restock','adjust') then raise exception 'Choose Restock or Correct count'; end if;
 if p_delta = 0 then raise exception 'Enter how many packs'; end if;
 if p_kind='restock' and p_delta < 0 then raise exception 'Restock must add packs'; end if;
 select * into v from public.grocery_products where id=p_product_id and deleted_at is null;
 if v.id is null then raise exception 'Product not found'; end if;
 if not public.grocery_move_stock(p_product_id, p_kind, p_delta, null, nullif(trim(p_note),'')) then
  raise exception 'Stock cannot go below the packs held for unpaid orders';
 end if;
 return public.grocery_product_json(v, true);
end $$;

-- Delete: never ordered → removed completely (the app then deletes its photos).
-- Ordered before → hidden (kept for order history and reports); open unpaid orders are cancelled.
create or replace function public.grocery_admin_delete_product(p_product_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v public.grocery_products; r record; n int := 0; v_imgs jsonb;
begin
 perform public.grocery_require('admin');
 select * into v from public.grocery_products where id=p_product_id for update;
 if v.id is null then raise exception 'Product not found'; end if;
 if not exists(select 1 from public.grocery_order_items where product_id=v.id) then
  select coalesce(jsonb_agg(jsonb_build_array(full_url, thumb_url)), '[]'::jsonb) into v_imgs from public.grocery_product_images where product_id=v.id;
  delete from public.grocery_products where id=v.id;
  return jsonb_build_object('deleted','removed','images', v_imgs);
 end if;
 if v.deleted_at is not null then return jsonb_build_object('deleted','hidden','cancelled',0); end if;
 for r in select distinct o.id from public.grocery_orders o join public.grocery_order_items i on i.order_id=o.id
   where i.product_id=v.id and o.payment_status='pending' and o.status in ('awaiting_payment','placed','ready') loop
  perform public.grocery_close_order(r.id, 'cancelled', 'Item no longer sold');
  n := n + 1;
 end loop;
 update public.grocery_products set deleted_at=now(), is_published=false, featured=false, updated_at=now() where id=v.id;
 return jsonb_build_object('deleted','hidden','cancelled',n);
end $$;

create or replace function public.grocery_admin_restore_product(p_product_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v public.grocery_products;
begin
 perform public.grocery_require('owner');
 update public.grocery_products set deleted_at=null, updated_at=now() where id=p_product_id and deleted_at is not null returning * into v;
 if v.id is null then raise exception 'Product not found'; end if;
 return public.grocery_product_json(v, true);   -- comes back as a draft; publish again to show it
end $$;

create or replace function public.grocery_admin_stock_history(p_product_id uuid, p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 perform public.grocery_require('admin');
 return coalesce((select jsonb_agg(to_jsonb(m) order by m.id desc) from (select m.*, o.order_no from public.grocery_stock_movements m
   left join public.grocery_orders o on o.id=m.order_id where m.product_id=p_product_id order by m.id desc limit least(greatest(p_limit,1),200)) m), '[]'::jsonb);
end $$;

-- ── Admin: orders ────────────────────────────────────────────────────
create or replace function public.grocery_admin_orders(p_filter text default 'open', p_limit int default 100) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 perform public.grocery_require('staff');
 perform public.grocery_release_expired();
 return coalesce((select jsonb_agg(public.grocery_order_json(o) order by o.created_at desc) from (
   select * from public.grocery_orders where
    case p_filter when 'open' then status in ('awaiting_payment','placed','ready')
                  when 'refunds' then payment_status='refund_due'
                  when 'today' then created_at >= (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
                  else true end
   order by created_at desc limit least(greatest(p_limit,1),300)) o), '[]'::jsonb);
end $$;

-- ready: packed and waiting. picked_up: handed over (for cash, this is also when the cash is taken).
create or replace function public.grocery_admin_set_status(p_order_id uuid, p_status text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.grocery_orders; i record;
begin
 perform public.grocery_require('staff');
 select * into o from public.grocery_orders where id=p_order_id for update;
 if o.id is null then raise exception 'Order not found'; end if;
 if p_status='ready' then
  if o.status <> 'placed' then raise exception 'Only a placed order can be marked ready'; end if;
  update public.grocery_orders set status='ready', ready_at=now(), updated_at=now() where id=o.id returning * into o;
  perform public.grocery_log(o.id, 'ready', null);
  if o.customer_id is not null then
   perform public.grocery_push(jsonb_build_array(jsonb_build_object('customer_id', o.customer_id,
     'title', 'Your NSDI Store order is ready', 'body', 'Order ' || o.order_no || ' is packed. Show this number at the outlet to pick it up.')));
  end if;
 elsif p_status='picked_up' then
  if o.status not in ('placed','ready') then raise exception 'This order cannot be picked up'; end if;
  if o.payment_status='pending' then
   if o.payment_method <> 'cash' then raise exception 'This online order is not paid yet'; end if;
   for i in select product_id, qty from public.grocery_order_items where order_id=o.id order by product_id loop
    if not public.grocery_move_stock(i.product_id, 'sale', i.qty, o.id, 'cash at pickup') then raise exception 'Stock record is out of step for this order'; end if;
   end loop;
   insert into public.grocery_payments(order_id, method, amount, recorded_by) values (o.id, 'cash', o.total, auth.uid());
   update public.grocery_orders set payment_status='paid', paid_at=now() where id=o.id;
  elsif o.payment_status <> 'paid' then raise exception 'This order has a refund pending'; end if;
  update public.grocery_orders set status='picked_up', picked_up_at=now(), hold_until=null, closed_at=now(), updated_at=now()
   where id=o.id returning * into o;
  perform public.grocery_log(o.id, 'picked_up', null);
 else
  raise exception 'Unknown status';
 end if;
 return public.grocery_order_json(o);
end $$;

create or replace function public.grocery_admin_record_refund(p_order_id uuid, p_amount numeric, p_reference text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.grocery_orders; v_paid numeric; v_refunded numeric;
begin
 perform public.grocery_require('admin');
 select * into o from public.grocery_orders where id=p_order_id for update;
 if o.id is null then raise exception 'Order not found'; end if;
 select coalesce(sum(amount),0) into v_paid from public.grocery_payments where order_id=o.id;
 select coalesce(sum(amount),0) into v_refunded from public.grocery_refunds where order_id=o.id;
 if coalesce(p_amount,0) <= 0 then raise exception 'Enter the refund amount'; end if;
 if p_amount > v_paid - v_refunded then raise exception 'Refund is more than what was paid (₹%)', v_paid - v_refunded; end if;
 if coalesce(trim(p_reference),'') = '' then raise exception 'Add the Razorpay refund id or a note'; end if;
 insert into public.grocery_refunds(order_id, amount, reference, reason, recorded_by) values (o.id, p_amount, trim(p_reference), p_reason, auth.uid());
 update public.grocery_orders set payment_status=case when v_refunded + p_amount >= v_paid then 'refunded' else 'partially_refunded' end, updated_at=now()
  where id=o.id returning * into o;
 perform public.grocery_log(o.id, 'refund', p_amount::text || ' · ' || trim(p_reference));
 return public.grocery_order_json(o);
end $$;

-- ── Admin: what customers asked for ──────────────────────────────────
create or replace function public.grocery_admin_requests(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 perform public.grocery_require('admin');
 return coalesce((select jsonb_agg(x order by (x->>'count')::int desc, x->>'label') from (
  select jsonb_build_object('item_key', item_key, 'label', mode() within group (order by label), 'count', count(*),
    'waiting', count(*) filter (where notify and notified_at is null),
    'notified', count(*) filter (where notified_at is not null),
    'notes', (select jsonb_agg(distinct n.note) from (select note from public.grocery_item_requests r2
        where r2.item_key=r.item_key and r2.note is not null order by created_at desc limit 5) n),
    'last_at', max(created_at)) x
  from public.grocery_item_requests r
  where p_days is null or p_days <= 0 or created_at >= now() - make_interval(days => p_days)
  group by item_key) t), '[]'::jsonb);
end $$;

create or replace function public.grocery_admin_notify_request(p_item_key text, p_message text default null) returns int
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_label text; v_msgs jsonb; n int;
begin
 perform public.grocery_require('admin');
 select mode() within group (order by label) into v_label from public.grocery_item_requests where item_key=p_item_key;
 if v_label is null then raise exception 'No requests for this item'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('customer_id', customer_id, 'title', 'Now at NSDI Store: ' || left(v_label,50),
     'body', coalesce(nullif(trim(p_message),''), 'You asked for ' || v_label || '. It is now in stock for pickup at our outlet.'))), '[]'::jsonb),
        count(*)
   into v_msgs, n
 from (select distinct customer_id from public.grocery_item_requests where item_key=p_item_key and notify and notified_at is null and customer_id is not null) c;
 update public.grocery_item_requests set notified_at=now() where item_key=p_item_key and notify and notified_at is null;
 perform public.grocery_push(v_msgs);
 return n;
end $$;

-- ── Admin: settings, pilot customers, analytics ──────────────────────
create or replace function public.grocery_admin_settings() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare r text := public.grocery_require('admin');
begin
 return (select to_jsonb(s) || jsonb_build_object('role', r,
   'pilots', coalesce((select jsonb_agg(jsonb_build_object('customer_id', c.id, 'name', c.name, 'phone', c.phone) order by p.added_at desc)
     from public.grocery_pilot_customers p join public.customers c on c.id::text=p.customer_id), '[]'::jsonb))
  from public.grocery_settings s);
end $$;

create or replace function public.grocery_admin_save_settings(p jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r text := public.grocery_require('admin'); s public.grocery_settings;
begin
 select * into s from public.grocery_settings;
 -- Going live and taking online payments are owner decisions.
 if r <> 'owner' and (coalesce((p->>'enabled')::boolean, s.enabled) <> s.enabled
     or coalesce((p->>'pilot_only')::boolean, s.pilot_only) <> s.pilot_only
     or coalesce((p->>'online_enabled')::boolean, s.online_enabled) <> s.online_enabled) then
  raise exception 'Only the owner can open the store or turn on online payment' using errcode='42501';
 end if;
 update public.grocery_settings set
  enabled=coalesce((p->>'enabled')::boolean, enabled), pilot_only=coalesce((p->>'pilot_only')::boolean, pilot_only),
  online_enabled=coalesce((p->>'online_enabled')::boolean, online_enabled), cash_enabled=coalesce((p->>'cash_enabled')::boolean, cash_enabled),
  hold_minutes=coalesce(nullif(p->>'hold_minutes','')::int, hold_minutes), cash_hold_hours=coalesce(nullif(p->>'cash_hold_hours','')::int, cash_hold_hours),
  max_qty_per_item=coalesce(nullif(p->>'max_qty_per_item','')::int, max_qty_per_item),
  outlet_name=coalesce(nullif(trim(p->>'outlet_name'),''), outlet_name), outlet_address=coalesce(nullif(trim(p->>'outlet_address'),''), outlet_address),
  pickup_hours=coalesce(nullif(trim(p->>'pickup_hours'),''), pickup_hours),
  notice=case when p ? 'notice' then nullif(trim(p->>'notice'),'') else notice end,
  updated_at=now(), updated_by=auth.uid()
 where id=1;
 return public.grocery_admin_settings();
end $$;

create or replace function public.grocery_admin_set_pilot(p_phone text, p_add boolean) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_id text; v_digits text := right(regexp_replace(coalesce(p_phone,''),'\D','','g'),10);
begin
 perform public.grocery_require('admin');
 if length(v_digits) <> 10 then raise exception 'Enter a 10-digit phone number'; end if;
 select id::text into v_id from public.customers where right(regexp_replace(coalesce(phone,''),'\D','','g'),10)=v_digits order by id limit 1;
 if v_id is null then raise exception 'No customer with this phone number'; end if;
 if p_add then insert into public.grocery_pilot_customers(customer_id, added_by) values (v_id, auth.uid()) on conflict do nothing;
 else delete from public.grocery_pilot_customers where customer_id=v_id; end if;
 return public.grocery_admin_settings();
end $$;

create or replace function public.grocery_admin_analytics(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_from timestamptz := now() - make_interval(days => greatest(coalesce(p_days,30),1));
begin
 perform public.grocery_require('owner');
 return (with sold as (
   select i.*, o.created_at from public.grocery_order_items i join public.grocery_orders o on o.id=i.order_id
   where o.payment_status in ('paid','partially_refunded') and o.status <> 'cancelled' and o.created_at >= v_from)
  select jsonb_build_object(
   'days', greatest(coalesce(p_days,30),1),
   'orders', (select count(distinct order_id) from sold),
   'units', coalesce((select sum(qty) from sold),0),
   'revenue', coalesce((select sum(line_total) from sold),0),
   'cost', coalesce((select sum(cost*qty) from sold where cost is not null),0),
   'cost_missing_units', coalesce((select sum(qty) from sold where cost is null),0),
   'refunds', coalesce((select sum(amount) from public.grocery_refunds where created_at >= v_from),0),
   'refund_due', (select count(*) from public.grocery_orders where payment_status='refund_due'),
   'expired', (select count(*) from public.grocery_orders where status='expired' and created_at >= v_from),
   'requests', (select count(*) from public.grocery_item_requests where created_at >= v_from),
   'top', coalesce((select jsonb_agg(t order by (t->>'units')::int desc) from (
      select jsonb_build_object('name', name, 'units', sum(qty), 'revenue', sum(line_total),
        'profit', case when bool_and(cost is not null) then sum(line_total - cost*qty) end) t
      from sold group by product_id, name order by sum(qty) desc limit 10) x), '[]'::jsonb)));
end $$;

-- ── Grants ───────────────────────────────────────────────────────────
do $$ declare f text; begin
 foreach f in array array[
   'grocery_role()','grocery_customer_id()','grocery_require(text)','grocery_can_shop()'] loop
  execute format('revoke all on function public.%s from public, anon', f);
  execute format('grant execute on function public.%s to authenticated', f);
 end loop;
 foreach f in array array['grocery_entry()','grocery_catalog()'] loop
  execute format('revoke all on function public.%s from public', f);
  execute format('grant execute on function public.%s to anon, authenticated', f);
 end loop;
 foreach f in array array[
   'grocery_place_order(jsonb,text,text,text,text,numeric)',
   -- grocery_record_payment is not granted: payments are confirmed by the grocery-payment
   -- edge function (migrations/20261109_grocery_verified_payments.sql).
   'grocery_cancel_order(uuid,text)','grocery_my_orders(int)','grocery_order(uuid)',
   'grocery_request_items(jsonb,text,boolean)','grocery_my_requests()',
   'grocery_admin_products(boolean)','grocery_admin_save_product(jsonb)','grocery_admin_adjust_stock(uuid,int,text,text)',
   'grocery_admin_delete_product(uuid)','grocery_admin_restore_product(uuid)','grocery_admin_stock_history(uuid,int)',
   'grocery_admin_orders(text,int)','grocery_admin_set_status(uuid,text)','grocery_admin_record_refund(uuid,numeric,text,text)',
   'grocery_admin_requests(int)','grocery_admin_notify_request(text,text)',
   'grocery_admin_settings()','grocery_admin_save_settings(jsonb)','grocery_admin_set_pilot(text,boolean)',
   'grocery_admin_analytics(int)'] loop
  execute format('revoke all on function public.%s from public, anon', f);
  execute format('grant execute on function public.%s to authenticated', f);
 end loop;
 execute 'revoke all on function public.grocery_record_payment(uuid,text,text) from public, anon, authenticated';
end $$;

-- ── Product photos: public read, admin-only write ────────────────────
do $$ begin
 if exists(select 1 from information_schema.schemata where schema_name='storage') then
  insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   values('grocery-photos','grocery-photos',true,2097152,array['image/webp','image/jpeg','image/png'])
   on conflict (id) do update set public=true, file_size_limit=2097152, allowed_mime_types=array['image/webp','image/jpeg','image/png'];
  drop policy if exists "grocery photos admin insert" on storage.objects;
  drop policy if exists "grocery photos admin update" on storage.objects;
  drop policy if exists "grocery photos admin delete" on storage.objects;
  create policy "grocery photos admin insert" on storage.objects for insert to authenticated
   with check (bucket_id='grocery-photos' and public.grocery_role() in ('owner','admin'));
  create policy "grocery photos admin update" on storage.objects for update to authenticated
   using (bucket_id='grocery-photos' and public.grocery_role() in ('owner','admin'));
  create policy "grocery photos admin delete" on storage.objects for delete to authenticated
   using (bucket_id='grocery-photos' and public.grocery_role() in ('owner','admin'));
 end if;
end $$;

-- ── Free unpaid holds every 5 minutes (also done on each new order) ──
do $$ begin
 create extension if not exists pg_cron;
 perform cron.unschedule(jobid) from cron.job where jobname='grocery-release-expired';
 perform cron.schedule('grocery-release-expired', '*/5 * * * *', 'select public.grocery_release_expired()');
exception when others then
 raise notice 'pg_cron not available (%). Holds are still freed whenever a new order is placed or staff open the orders list.', sqlerrm;
end $$;

notify pgrst, 'reload schema';
commit;

-- ── Remove NSDI Store completely (only if you are sure; deletes its orders) ──
-- begin;
-- select cron.unschedule('grocery-release-expired');
-- drop table if exists public.grocery_item_requests, public.grocery_order_events, public.grocery_stock_movements,
--   public.grocery_refunds, public.grocery_payments, public.grocery_order_items, public.grocery_orders,
--   public.grocery_stock, public.grocery_product_images, public.grocery_products, public.grocery_categories,
--   public.grocery_pilot_customers, public.grocery_settings cascade;
-- drop sequence if exists public.grocery_order_seq;
-- commit;
