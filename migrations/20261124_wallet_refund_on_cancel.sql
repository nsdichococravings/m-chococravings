-- Wallet money goes back when an order is cancelled.
--
-- An order paid (fully or partly) from the NSDI Wallet that is then
-- cancelled now refunds that wallet amount automatically, once:
--   * NSDI Cafe orders (store_orders), paid by the customer at checkout or
--     by staff in the Kitchen,
--   * online app orders (orders) paid from the wallet.
-- Orders closed by "Merge into one bill" are NOT refunded: their money
-- moved to the bill.
--
-- The refund is a wallet entry of kind 'refund' on the same order, so it
-- shows in the customer's wallet history. An order paid only by wallet is
-- marked payment_status 'refunded'.
--
-- Also refunds wallet payments on orders cancelled in the last 30 days
-- before this ran (each once).
--
-- Run AFTER 20261108_customer_wallet.sql. Safe to run more than once.
begin;

alter table public.cc_wallet_txns drop constraint if exists cc_wallet_txns_kind_check;
alter table public.cc_wallet_txns add constraint cc_wallet_txns_kind_check
 check (kind in ('topup','change','spend','adjust','refund'));
create unique index if not exists cc_wallet_txns_order_refund_idx on public.cc_wallet_txns(order_id)
 where order_id is not null and kind = 'refund';

-- Refund what the wallet paid on one order, once. Returns the amount (0 if none).
create or replace function public.cc_wallet_refund_order(p_order_id text, p_label text) returns numeric
language plpgsql security definer set search_path=pg_catalog,public as $$
declare s public.cc_wallet_txns;
begin
 if p_order_id is null then return 0; end if;
 select * into s from public.cc_wallet_txns where order_id = p_order_id and kind = 'spend' limit 1;
 if s.id is null then return 0; end if;
 if exists(select 1 from public.cc_wallet_txns where order_id = p_order_id and kind = 'refund') then return 0; end if;
 perform public.cc_wallet_post(s.phone10, 'refund', abs(s.amount), p_order_id, null, null,
   'Refund · cancelled ' || coalesce(nullif(p_label, ''), 'order'), null);
 return abs(s.amount);
end $$;
revoke all on function public.cc_wallet_refund_order(text, text) from public, anon, authenticated;

create or replace function public.cc_wallet_refund_on_cancel() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_new jsonb = to_jsonb(new); v_amt numeric;
begin
 if coalesce(new.status, '') not in ('cancelled','canceled','rejected') then return null; end if;
 if coalesce(old.status, '') in ('cancelled','canceled','rejected') then return null; end if;
 if (v_new->>'merged_into') is not null then return null; end if; -- merged into a bill: money moved there
 begin
  v_amt = public.cc_wallet_refund_order(new.id::text,
    coalesce(v_new->>'token', v_new->>'order_number', left(new.id::text, 8)));
 exception when unique_violation then v_amt = 0; -- refunded at the same moment by another update
 end;
 if v_amt > 0 and coalesce(v_new->>'payment_method', '') = 'wallet' then
  begin
   execute format('update %I.%I set payment_status = %L where id = $1', tg_table_schema, tg_table_name, 'refunded') using new.id;
  exception when check_violation then null; -- table without a 'refunded' status: the wallet entry still shows it
  end;
 end if;
 return null;
end $$;

drop trigger if exists cc_wallet_refund_on_cancel on public.store_orders;
create trigger cc_wallet_refund_on_cancel after update of status on public.store_orders
 for each row execute function public.cc_wallet_refund_on_cancel();

do $$ begin
 if exists(select 1 from information_schema.tables where table_schema = 'public' and table_name = 'orders') then
  drop trigger if exists cc_wallet_refund_on_cancel on public.orders;
  create trigger cc_wallet_refund_on_cancel after update of status on public.orders
   for each row execute function public.cc_wallet_refund_on_cancel();
 end if;
end $$;

-- Orders already cancelled (last 30 days) whose wallet payment was never returned.
do $$ declare r record; v_amt numeric; begin
 for r in select o.id, to_jsonb(o) j from public.store_orders o
           where o.status in ('cancelled','canceled','rejected') and o.created_at > now() - interval '30 days'
             and (to_jsonb(o)->>'merged_into') is null
             and exists(select 1 from public.cc_wallet_txns t where t.order_id = o.id::text and t.kind = 'spend')
 loop
  v_amt = public.cc_wallet_refund_order(r.id::text, coalesce(r.j->>'token', left(r.id::text, 8)));
  if v_amt > 0 and coalesce(r.j->>'payment_method', '') = 'wallet' then
   begin update public.store_orders set payment_status = 'refunded' where id = r.id;
   exception when check_violation then null; end;
  end if;
 end loop;
 if exists(select 1 from information_schema.tables where table_schema = 'public' and table_name = 'orders') then
  for r in execute $q$select o.id, to_jsonb(o) j from public.orders o
           where o.status in ('cancelled','canceled','rejected') and o.created_at > now() - interval '30 days'
             and exists(select 1 from public.cc_wallet_txns t where t.order_id = o.id::text and t.kind = 'spend')$q$
  loop
   v_amt = public.cc_wallet_refund_order(r.id::text, coalesce(r.j->>'order_number', left(r.id::text, 8)));
   if v_amt > 0 and coalesce(r.j->>'payment_method', '') = 'wallet' then
    begin
     update public.orders set payment_status = 'refunded' where id = r.id;
    exception when check_violation then null; -- older orders table without 'refunded'
    end;
   end if;
  end loop;
 end if;
end $$;

commit;
