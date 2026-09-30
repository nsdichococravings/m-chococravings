-- Makes the "Referral Code" box on the sign-up page (auth.html) actually
-- do something. Until now the code typed there was never read or saved.
--
-- How it works:
--  * A customer's referral code IS their existing customer_code
--    (CC-123456) -- the ID already shown on their card, so no new code to
--    generate or keep unique. Customers can also type just the digits.
--  * On sign-up, auth.html checks the code (cc_referral_check) before the
--    account is created, then links the new customer to the referrer
--    (cc_referral_apply) once the customer row exists.
--  * When the new customer's FIRST online order is marked 'delivered',
--    both people get cc_referral_reward_points() loyalty points (100 =
--    Rs 10 at the checkout's 50 pts = Rs 5 redemption rate). Paying on
--    delivery, not on sign-up, means fake sign-ups earn nothing.
--  * The Profile page shows the customer's code, a share button and how
--    many friends joined / completed their first order
--    (cc_referral_my_summary).
--
-- customers and orders already exist in this database (created outside
-- this repo's migrations). This file only ADDS columns if missing and
-- adds functions + one trigger on orders; it does not change existing
-- columns, RLS policies or grants on those tables.
--
-- In the live database orders.id AND customers.id are TEXT (not uuid),
-- and auth_id / customer_id types aren't guaranteed, so every id here is
-- compared as text, and the referrer is stored in a new text column
-- customers.cc_referred_by (not the older referred_by column, whose type
-- may not match). Earlier versions of this file assumed uuid; re-running
-- this version replaces their functions and trigger. A referred_by column
-- one of them may have added is left alone and unused.
--
-- To change the reward, edit cc_referral_reward_points() below and re-run
-- just that function.
--
-- Run this ENTIRE file as database owner. Safe to re-run.
begin;
do $$ begin
 if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='customers') then
  raise exception 'public.customers not found -- is this the right database?';
 end if;
 if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='orders') then
  raise exception 'public.orders not found -- is this the right database?';
 end if;
end $$;

alter table public.customers add column if not exists cc_referred_by text;
alter table public.customers add column if not exists referral_rewarded_at timestamptz;
alter table public.customers add column if not exists lifetime_points integer default 0;
create index if not exists idx_customers_cc_referred_by on public.customers(cc_referred_by);

create or replace function public.cc_referral_reward_points() returns integer
language sql immutable as $$ select 100 $$;

-- 'cc-123456', ' CC 123456 ', '123456' -> 'CC-123456'; anything else -> null.
create or replace function public.cc_referral_normalize(p_code text) returns text
language sql immutable as $$
 select case when d ~ '^[0-9]{6}$' then 'CC-' || d end
 from (select regexp_replace(upper(coalesce(p_code,'')), '^\s*(CC)?[\s-]*|\s+$', '', 'g') as d) s
$$;

-- Used before sign-up (anon), so it only says yes/no -- never who.
create or replace function public.cc_referral_check(p_code text) returns boolean
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_code text=public.cc_referral_normalize(p_code);
begin
 if v_code is null then return false; end if;
 return exists(select 1 from public.customers where customer_code=v_code and coalesce(is_active,true));
end $$;

-- Links the signed-in customer to the owner of p_code. Only allowed
-- once, and only before the customer has placed any order.
create or replace function public.cc_referral_apply(p_code text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 v_code text=public.cc_referral_normalize(p_code);
 v_me public.customers%rowtype;
 v_ref public.customers%rowtype;
begin
 if auth.uid() is null then raise exception 'Sign in to use a referral code'; end if;
 select * into v_me from public.customers where auth_id::text=auth.uid()::text limit 1 for update;
 if v_me.id is null then raise exception 'Customer profile not found'; end if;
 if v_code is null then raise exception 'Invalid referral code'; end if;
 select * into v_ref from public.customers where customer_code=v_code and coalesce(is_active,true);
 if v_ref.id is null then raise exception 'Invalid referral code'; end if;
 if v_ref.id::text=v_me.id::text then raise exception 'You cannot use your own referral code'; end if;
 if v_me.cc_referred_by is not null then
  if v_me.cc_referred_by=v_ref.id::text then return jsonb_build_object('ok',true,'referrer_name',split_part(v_ref.name,' ',1)); end if;
  raise exception 'A referral code is already applied to this account';
 end if;
 if exists(select 1 from public.orders where customer_id::text=v_me.id::text) then
  raise exception 'Referral codes can only be used before your first order';
 end if;
 update public.customers set cc_referred_by=v_ref.id::text where id::text=v_me.id::text;
 return jsonb_build_object('ok',true,'referrer_name',split_part(v_ref.name,' ',1),'reward_points',public.cc_referral_reward_points());
end $$;

-- Profile card data for the signed-in customer.
create or replace function public.cc_referral_my_summary() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_me public.customers%rowtype; v_joined int; v_rewarded int;
begin
 if auth.uid() is null then raise exception 'Sign in to see your referrals'; end if;
 select * into v_me from public.customers where auth_id::text=auth.uid()::text limit 1;
 if v_me.id is null then raise exception 'Customer profile not found'; end if;
 select count(*), count(referral_rewarded_at) into v_joined, v_rewarded from public.customers where cc_referred_by=v_me.id::text;
 return jsonb_build_object(
  'code', v_me.customer_code,
  'joined', v_joined,
  'rewarded', v_rewarded,
  'points_earned', v_rewarded*public.cc_referral_reward_points(),
  'reward_points', public.cc_referral_reward_points());
end $$;

-- Adds points to one customer and logs it. Logging is best-effort: the
-- live points_transactions table may restrict "type", and a failed log
-- line must never undo the reward or the delivery update.
drop function if exists public.cc_referral_credit(uuid,uuid,text);
drop function if exists public.cc_referral_credit(uuid,text,text);
create or replace function public.cc_referral_credit(p_customer text, p_order text, p_desc text) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_pts int=public.cc_referral_reward_points(); v_bal int;
begin
 update public.customers
  set loyalty_points=coalesce(loyalty_points,0)+v_pts,
      lifetime_points=coalesce(lifetime_points,0)+v_pts
  where id::text=p_customer returning loyalty_points into v_bal;
 if v_bal is null then return; end if;
 begin
  perform public.cc_referral_log(p_customer, p_order, v_pts, v_bal, p_desc);
 exception when others then
  raise warning 'referral points log skipped: %', sqlerrm;
 end;
end $$;

-- Writes the points_transactions line. Uses that table's own column types
-- (%type) so text ids convert to whatever it stores; tries type
-- 'referral', then 'earned' in case "type" is restricted.
create or replace function public.cc_referral_log(p_customer text, p_order text, p_pts int, p_bal int, p_desc text) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_cust public.points_transactions.customer_id%type; v_order public.points_transactions.order_id%type;
begin
 v_cust := p_customer;
 begin v_order := p_order; exception when others then v_order := null; end;
 begin
  insert into public.points_transactions(customer_id,order_id,type,points,balance_after,description)
  values(v_cust,v_order,'referral',p_pts,p_bal,p_desc);
 exception when others then
  insert into public.points_transactions(customer_id,order_id,type,points,balance_after,description)
  values(v_cust,v_order,'earned',p_pts,p_bal,p_desc);
 end;
end $$;

-- Pays both sides once, on the referred customer's first delivered order.
create or replace function public.cc_referral_on_order_delivered() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_referrer text; v_name text; v_customer text=new.customer_id::text;
begin
 if new.status is distinct from 'delivered' or new.customer_id is null then return new; end if;
 if tg_op='UPDATE' and old.status is not distinct from 'delivered' then return new; end if;
 -- Only the FIRST delivered order counts.
 if exists(select 1 from public.orders where customer_id::text=v_customer and status='delivered' and id::text<>new.id::text) then return new; end if;
 -- Claim the reward atomically so two deliveries at once can't pay twice.
 update public.customers set referral_rewarded_at=now()
  where id::text=v_customer and cc_referred_by is not null and cc_referred_by<>id::text and referral_rewarded_at is null
  returning cc_referred_by, split_part(name,' ',1) into v_referrer, v_name;
 if v_referrer is null then return new; end if;
 perform public.cc_referral_credit(v_customer, new.id::text, 'Referral welcome bonus');
 perform public.cc_referral_credit(v_referrer, new.id::text, 'Referral reward: ' || coalesce(v_name,'a friend') || ' placed their first order');
 return new;
end $$;

drop trigger if exists cc_referral_order_delivered on public.orders;
create trigger cc_referral_order_delivered
 after insert or update of status on public.orders
 for each row execute function public.cc_referral_on_order_delivered();

revoke all on function public.cc_referral_credit(text,text,text) from public, anon, authenticated;
revoke all on function public.cc_referral_log(text,text,int,int,text) from public, anon, authenticated;
revoke all on function public.cc_referral_on_order_delivered() from public, anon, authenticated;
revoke all on function public.cc_referral_apply(text) from public, anon;
revoke all on function public.cc_referral_my_summary() from public, anon;
grant execute on function public.cc_referral_check(text) to anon, authenticated;
grant execute on function public.cc_referral_apply(text) to authenticated;
grant execute on function public.cc_referral_my_summary() to authenticated;
commit;
