-- Customer wallet.
--
-- Each customer has one wallet, keyed by the last 10 digits of their
-- phone number (the same way loyalty cards match customers), so the
-- Kitchen can find it from the order's phone and the customer app can
-- find it from the signed-in customer's phone.
--
-- Money comes in two ways:
--   * topup  - the customer adds money with UPI (Razorpay). Only the
--              wallet-topup edge function can credit it, after it has
--              checked with Razorpay that the payment was captured.
--   * change - in the Kitchen, cash change the customer did not take is
--              kept in their wallet (one credit per order).
-- Money goes out as:
--   * spend  - the Kitchen takes some or all of a bill from the wallet
--              (one spend per order).
--   * adjust - an admin correction, with a note.
-- Every movement is in cc_wallet_txns with the balance after it.
--
-- Customer:  cc_wallet_me()
-- Staff:     cc_wallet_staff(action, payload)  lookup | credit_change | spend | adjust (admin)
-- Edge fn:   cc_wallet_topup_record(...), cc_wallet_topup_settle(...)  (service_role only)
--
-- Run this ENTIRE file as database owner AFTER the loyalty migrations
-- (uses cc_loyalty_role()). Safe to run more than once.
begin;
do $$ begin
 if not exists(select 1 from pg_proc where proname='cc_loyalty_role') then
  raise exception 'cc_loyalty_role() not found -- run the loyalty migrations first.';
 end if;
 if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='store_orders') then
  raise exception 'store_orders table not found -- is this the right database?';
 end if;
end $$;

create table if not exists public.cc_wallets(
 phone10 text primary key check (phone10 ~ '^[0-9]{10}$'),
 balance numeric(12,2) not null default 0 check (balance >= 0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.cc_wallet_txns(
 id bigserial primary key,
 phone10 text not null references public.cc_wallets(phone10),
 kind text not null check (kind in ('topup','change','spend','adjust')),
 amount numeric(12,2) not null check (amount <> 0),
 balance_after numeric(12,2) not null check (balance_after >= 0),
 order_id text,
 rzp_payment_id text unique,
 rzp_order_id text,
 note text,
 staff_name text,
 actor uuid,
 created_at timestamptz not null default now()
);
create index if not exists cc_wallet_txns_phone_idx on public.cc_wallet_txns(phone10, created_at desc);
-- At most one change credit and one wallet spend per Kitchen order, so a retry never doubles it.
create unique index if not exists cc_wallet_txns_order_kind_idx on public.cc_wallet_txns(order_id, kind)
 where order_id is not null and kind in ('change','spend');

-- UPI top-ups the edge function started, waiting for Razorpay to confirm.
create table if not exists public.cc_wallet_topups(
 rzp_order_id text primary key,
 phone10 text not null check (phone10 ~ '^[0-9]{10}$'),
 user_id uuid not null,
 amount numeric(12,2) not null check (amount > 0),
 status text not null default 'created' check (status in ('created','paid')),
 rzp_payment_id text,
 created_at timestamptz not null default now(),
 paid_at timestamptz
);
create index if not exists cc_wallet_topups_user_idx on public.cc_wallet_topups(user_id, created_at desc);

alter table public.cc_wallets enable row level security;
alter table public.cc_wallet_txns enable row level security;
alter table public.cc_wallet_topups enable row level security;
revoke all on public.cc_wallets, public.cc_wallet_txns, public.cc_wallet_topups from public, anon, authenticated;
-- No direct table access at all: everything goes through the functions below.

-- '+91 98765 43210' -> '9876543210'; anything that is not 10 digits -> null.
create or replace function public.cc_wallet_phone10(p text) returns text
language sql immutable set search_path=pg_catalog,public as $$
 select case when length(d)>=10 then right(d,10) end
 from (select regexp_replace(coalesce(p,''),'[^0-9]','','g') d) x
$$;

-- Phone of a signed-in customer (confirmed email), as phone10.
create or replace function public.cc_wallet_user_phone10(p_user uuid) returns text
language sql stable security definer set search_path=pg_catalog,public as $$
 select public.cc_wallet_phone10(c.phone)
 from auth.users u join public.customers c on lower(c.email)=lower(u.email)
 where u.id=p_user and u.email_confirmed_at is not null
 order by (c.phone is null) limit 1
$$;

-- The one place a balance changes. Locks the wallet row, so two staff
-- phones (or a top-up and a spend) at the same moment can't race.
create or replace function public.cc_wallet_post(p_phone10 text, p_kind text, p_amount numeric,
 p_order_id text default null, p_payment_id text default null, p_rzp_order_id text default null,
 p_note text default null, p_staff text default null) returns public.cc_wallet_txns
language plpgsql security definer set search_path=pg_catalog,public as $$
declare w public.cc_wallets; t public.cc_wallet_txns; v_amount numeric(12,2)=round(p_amount,2);
begin
 if p_phone10 is null or p_phone10 !~ '^[0-9]{10}$' then raise exception 'Enter a valid 10-digit mobile number'; end if;
 if v_amount is null or v_amount=0 then raise exception 'Enter an amount'; end if;
 insert into public.cc_wallets(phone10) values(p_phone10) on conflict do nothing;
 select * into w from public.cc_wallets where phone10=p_phone10 for update;
 if w.balance+v_amount<0 then
  raise exception 'Wallet has only ₹% — not enough for ₹%', w.balance, abs(v_amount);
 end if;
 update public.cc_wallets set balance=balance+v_amount, updated_at=now() where phone10=p_phone10 returning * into w;
 insert into public.cc_wallet_txns(phone10,kind,amount,balance_after,order_id,rzp_payment_id,rzp_order_id,note,staff_name,actor)
  values(p_phone10,p_kind,v_amount,w.balance,p_order_id,p_payment_id,p_rzp_order_id,nullif(btrim(p_note),''),nullif(btrim(p_staff),''),auth.uid())
  returning * into t;
 return t;
end $$;
revoke all on function public.cc_wallet_post(text,text,numeric,text,text,text,text,text) from public, anon, authenticated;

create or replace function public.cc_wallet_txns_json(p_phone10 text, p_limit int) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'kind',kind,'amount',amount,'balance_after',balance_after,
   'order_id',order_id,'note',note,'created_at',created_at) order by created_at desc, id desc),'[]'::jsonb)
 from (select * from public.cc_wallet_txns where phone10=p_phone10 order by created_at desc, id desc limit p_limit) t
$$;
revoke all on function public.cc_wallet_txns_json(text,int) from public, anon, authenticated;

-- ── Customer: my wallet ──────────────────────────────────────────────
create or replace function public.cc_wallet_me() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_phone text;
begin
 if auth.uid() is null then raise exception 'Sign in to see your wallet' using errcode='42501'; end if;
 v_phone=public.cc_wallet_user_phone10(auth.uid());
 if v_phone is null then return jsonb_build_object('balance',0,'no_phone',true,'txns','[]'::jsonb); end if;
 return jsonb_build_object(
  'balance', coalesce((select balance from public.cc_wallets where phone10=v_phone),0),
  'phone_last4', right(v_phone,4),
  'txns', public.cc_wallet_txns_json(v_phone,30));
end $$;

-- ── Staff (Kitchen / Command Center) ─────────────────────────────────
create or replace function public.cc_wallet_staff(p_action text, p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_role text=public.cc_loyalty_role(); v_phone text; v_amount numeric; v_order text; t public.cc_wallet_txns;
begin
 if auth.uid() is null or v_role not in ('admin','staff') then raise exception 'Staff access required' using errcode='42501'; end if;
 v_phone=public.cc_wallet_phone10(p_payload->>'phone');
 if v_phone is null then raise exception 'Enter a valid 10-digit mobile number'; end if;
 v_order=nullif(btrim(coalesce(p_payload->>'order_id','')),'');
 begin v_amount=round((p_payload->>'amount')::numeric,2); exception when others then v_amount=null; end;

 if p_action='lookup' then
  return jsonb_build_object('phone10',v_phone,
   'balance',coalesce((select balance from public.cc_wallets where phone10=v_phone),0),
   'txns',public.cc_wallet_txns_json(v_phone,15));
 end if;

 if p_action in ('credit_change','spend') then
  if v_order is null or not exists(select 1 from public.store_orders where id::text=v_order) then
   raise exception 'Order not found';
  end if;
  -- Retry of the same order: hand back what is already there instead of doing it twice.
  select * into t from public.cc_wallet_txns where order_id=v_order and kind=case when p_action='spend' then 'spend' else 'change' end;
  if t.id is not null then
   if t.phone10<>v_phone then raise exception 'This order already used a different wallet'; end if;
   return jsonb_build_object('balance',(select balance from public.cc_wallets where phone10=v_phone),'amount',abs(t.amount),'repeat',true);
  end if;
 end if;

 if p_action='credit_change' then
  if v_amount is null or v_amount<=0 or v_amount>2000 then raise exception 'Change to keep must be from ₹0.01 to ₹2000'; end if;
  t=public.cc_wallet_post(v_phone,'change',v_amount,v_order,null,null,'Change kept from order',p_payload->>'staff_name');
 elsif p_action='spend' then
  if v_amount is null or v_amount<=0 then raise exception 'Enter the amount to take from the wallet'; end if;
  t=public.cc_wallet_post(v_phone,'spend',-v_amount,v_order,null,null,'Paid an order',p_payload->>'staff_name');
 elsif p_action='adjust' then
  if v_role<>'admin' then raise exception 'Admin access required' using errcode='42501'; end if;
  if v_amount is null or v_amount=0 or abs(v_amount)>10000 then raise exception 'Enter an amount from -₹10000 to ₹10000'; end if;
  if nullif(btrim(coalesce(p_payload->>'note','')),'') is null then raise exception 'Add a note saying why'; end if;
  t=public.cc_wallet_post(v_phone,'adjust',v_amount,null,null,null,p_payload->>'note',p_payload->>'staff_name');
 else
  raise exception 'Unknown action: %', p_action;
 end if;
 return jsonb_build_object('balance',t.balance_after,'amount',abs(t.amount),'txn_id',t.id);
end $$;

-- ── UPI top-up (wallet-topup edge function, service_role only) ───────
-- Step 1: the edge function created a Razorpay order for this customer.
create or replace function public.cc_wallet_topup_record(p_rzp_order_id text, p_user uuid, p_amount numeric) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_phone text=public.cc_wallet_user_phone10(p_user);
begin
 if v_phone is null then raise exception 'Add your mobile number to your profile first'; end if;
 if p_amount is null or p_amount<10 or p_amount>10000 then raise exception 'Add from ₹10 to ₹10000'; end if;
 insert into public.cc_wallet_topups(rzp_order_id,phone10,user_id,amount) values(p_rzp_order_id,v_phone,p_user,round(p_amount,2));
 return jsonb_build_object('ok',true);
end $$;

-- Step 2: Razorpay says this order has a captured payment of p_paise.
-- Credits the wallet once; calling it again returns the same result.
create or replace function public.cc_wallet_topup_settle(p_rzp_order_id text, p_user uuid, p_payment_id text, p_paise bigint) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare tp public.cc_wallet_topups; t public.cc_wallet_txns;
begin
 select * into tp from public.cc_wallet_topups where rzp_order_id=p_rzp_order_id for update;
 if tp.rzp_order_id is null or tp.user_id<>p_user then raise exception 'Top-up not found'; end if;
 if tp.status='paid' then
  return jsonb_build_object('status','paid','amount',tp.amount,'balance',(select balance from public.cc_wallets where phone10=tp.phone10),'repeat',true);
 end if;
 if p_paise<>round(tp.amount*100) then raise exception 'Paid amount does not match the top-up'; end if;
 t=public.cc_wallet_post(tp.phone10,'topup',tp.amount,null,p_payment_id,p_rzp_order_id,'Added with UPI',null);
 update public.cc_wallet_topups set status='paid', rzp_payment_id=p_payment_id, paid_at=now() where rzp_order_id=tp.rzp_order_id;
 return jsonb_build_object('status','paid','amount',tp.amount,'balance',t.balance_after);
end $$;

do $$ declare f text; begin
 foreach f in array array['cc_wallet_me()','cc_wallet_staff(text,jsonb)'] loop
  execute format('revoke all on function public.%s from public, anon', f);
  execute format('grant execute on function public.%s to authenticated', f);
 end loop;
 foreach f in array array['cc_wallet_topup_record(text,uuid,numeric)','cc_wallet_topup_settle(text,uuid,text,bigint)',
                          'cc_wallet_user_phone10(uuid)'] loop
  execute format('revoke all on function public.%s from public, anon, authenticated', f);
  if exists(select 1 from pg_roles where rolname='service_role') then
   execute format('grant execute on function public.%s to service_role', f);
  end if;
 end loop;
end $$;

notify pgrst,'reload schema';
commit;
