-- NSDI Wallet for online orders (customer app checkout).
--
-- At checkout the customer can switch on "Use wallet". If the balance
-- covers the order, the whole order is paid from the wallet; otherwise
-- the wallet pays part and the rest goes through UPI (Razorpay) as before.
--
-- The app saves the order, then calls cc_wallet_pay_order(order id, amount):
--   * only the signed-in customer's own order (same customer row or phone),
--   * placed in the last 24 hours and not cancelled,
--   * never more than the order's balance due,
--   * one wallet payment per order (a retry returns the first result).
-- It takes the money from the wallet and updates the order:
-- wallet_paid / amount_paid go up, balance_due goes down. An order paid
-- fully from the wallet becomes payment_status 'paid' (and payment_method
-- 'wallet' where the orders table allows that value).
--
-- Run this ENTIRE file as database owner AFTER 20261108_customer_wallet.sql.
-- Safe to run more than once.
begin;
do $$ begin
 if not exists(select 1 from pg_proc where proname='cc_wallet_post') then
  raise exception 'Run migrations/20261108_customer_wallet.sql first.';
 end if;
 if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='orders') then
  raise exception 'orders table not found -- is this the right database?';
 end if;
end $$;

alter table public.orders add column if not exists wallet_paid numeric(10,2) not null default 0;
alter table public.orders add column if not exists amount_paid numeric(10,2);
alter table public.orders add column if not exists balance_due numeric(10,2);

create or replace function public.cc_wallet_pay_order(p_order_id uuid, p_amount numeric) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_phone text; v_cust text; o jsonb; t public.cc_wallet_txns;
 v_total numeric; v_paid numeric; v_due numeric; v_amt numeric=round(p_amount,2); v_full boolean;
begin
 if auth.uid() is null then raise exception 'Please sign in' using errcode='42501'; end if;
 v_phone=public.cc_wallet_user_phone10(auth.uid());
 if v_phone is null then raise exception 'Add your mobile number to your profile to use the wallet'; end if;
 select c.id::text into v_cust from auth.users u join public.customers c on lower(c.email)=lower(u.email)
  where u.id=auth.uid() and u.email_confirmed_at is not null limit 1;

 select to_jsonb(x) into o from public.orders x where x.id=p_order_id for update;
 if o is null or not ((o->>'customer_id') is not null and (o->>'customer_id')=v_cust
                      or public.cc_wallet_phone10(o->>'customer_phone')=v_phone) then
  raise exception 'Order not found';
 end if;

 select * into t from public.cc_wallet_txns where order_id=p_order_id::text and kind='spend';
 if t.id is not null then
  return jsonb_build_object('amount',abs(t.amount),'balance',(select balance from public.cc_wallets where phone10=v_phone),'repeat',true);
 end if;

 if (o->>'created_at')::timestamptz < now()-interval '1 day' then raise exception 'This order is too old to pay from the wallet'; end if;
 if coalesce(o->>'status','') in ('cancelled','canceled','rejected') then raise exception 'This order is cancelled'; end if;
 if coalesce(o->>'payment_status','') in ('paid','refunded') then raise exception 'This order is already paid'; end if;

 v_total=coalesce((o->>'total')::numeric,0);
 v_paid=coalesce((o->>'amount_paid')::numeric,0);
 v_due=coalesce((o->>'balance_due')::numeric, v_total-v_paid);
 if v_amt is null or v_amt<=0 then raise exception 'Enter the wallet amount'; end if;
 if v_amt>v_due then raise exception 'Wallet amount is more than what is due on this order (₹%)', v_due; end if;

 t=public.cc_wallet_post(v_phone,'spend',-v_amt,p_order_id::text,null,null,'Online order '||coalesce(o->>'order_number',''),null);
 v_full = v_amt>=v_total;

 update public.orders set wallet_paid=coalesce(wallet_paid,0)+v_amt,
   amount_paid=coalesce(amount_paid,0)+v_amt, balance_due=greatest(0,v_due-v_amt)
  where id=p_order_id;
 if v_full then
  update public.orders set payment_status='paid' where id=p_order_id;
  begin
   update public.orders set payment_method='wallet' where id=p_order_id;
  exception when check_violation then null; -- older orders table without 'wallet': keep the method, wallet_paid shows it
  end;
 end if;
 return jsonb_build_object('amount',v_amt,'balance',t.balance_after,'paid_in_full',v_full);
end $$;

revoke all on function public.cc_wallet_pay_order(uuid,numeric) from public, anon;
grant execute on function public.cc_wallet_pay_order(uuid,numeric) to authenticated;

notify pgrst,'reload schema';
commit;
