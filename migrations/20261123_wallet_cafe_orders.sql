-- NSDI Cafe: customers pay their order from their NSDI Wallet.
--
-- At NSDI Cafe checkout the customer picks "Wallet". If the balance is
-- short they add money first (UPI top-up, as in the app). The page saves
-- the order, then calls cc_wallet_pay_store_order(order id), which:
--   * only pays the signed-in customer's own order (placed by them, or
--     with their mobile number),
--   * only an unpaid order from the last 24 hours that isn't cancelled,
--   * takes the whole order total from their wallet, or nothing if the
--     balance isn't enough,
--   * marks the order paid by wallet,
--   * pays each order once (a retry returns the first result).
--
-- Run AFTER 20261108_customer_wallet.sql. Safe to run more than once.
begin;
do $$ begin
 if not exists(select 1 from pg_proc where proname = 'cc_wallet_post') then
  raise exception 'Run migrations/20261108_customer_wallet.sql first.';
 end if;
end $$;

create or replace function public.cc_wallet_pay_store_order(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_phone text; o jsonb; t public.cc_wallet_txns; v_total numeric;
begin
 if auth.uid() is null then raise exception 'Please sign in to use your wallet' using errcode='42501'; end if;
 v_phone = public.cc_wallet_user_phone10(auth.uid());
 if v_phone is null then raise exception 'Add your mobile number to your profile to use the wallet'; end if;

 select to_jsonb(x) into o from public.store_orders x where x.id = p_order_id for update;
 if o is null or not (coalesce(o->>'customer_id','') = auth.uid()::text
                      or public.cc_wallet_phone10(o->>'customer_phone') = v_phone) then
  raise exception 'Order not found';
 end if;

 -- Already paid from a wallet: hand back the first result.
 select * into t from public.cc_wallet_txns where order_id = p_order_id::text and kind = 'spend' limit 1;
 if t.id is not null then
  return jsonb_build_object('amount', abs(t.amount), 'balance', (select balance from public.cc_wallets where phone10 = v_phone), 'repeat', true);
 end if;

 if (o->>'created_at')::timestamptz < now() - interval '1 day' then raise exception 'This order is too old to pay from the wallet'; end if;
 if coalesce(o->>'status','') in ('cancelled','canceled','rejected') then raise exception 'This order is cancelled'; end if;
 if coalesce(o->>'payment_status','') in ('paid','complimentary','refunded') then raise exception 'This order is already paid'; end if;

 v_total = round(coalesce((o->>'total')::numeric, 0), 2);
 if v_total <= 0 then raise exception 'Nothing to pay on this order'; end if;

 -- Raises "Wallet has only ₹X" when the balance is short; nothing changes then.
 t = public.cc_wallet_post(v_phone, 'spend', -v_total, p_order_id::text, null, null,
       'NSDI Cafe order ' || coalesce(o->>'token', ''), null);

 update public.store_orders set payment_status = 'paid', payment_method = 'wallet' where id = p_order_id;
 return jsonb_build_object('amount', v_total, 'balance', t.balance_after);
end $$;

revoke all on function public.cc_wallet_pay_store_order(uuid) from public, anon;
grant execute on function public.cc_wallet_pay_store_order(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
