-- Kitchen: an admin merges one customer's open orders into ONE bill.
--
-- For a mobile number with several open NSDI Cafe orders, the Kitchen offers
-- "Merge into one bill". The oldest order becomes the bill: it gets every
-- item (same item + price lines added together) and the combined total. The
-- other orders are closed as cancelled with merged_into pointing at the bill,
-- so reports, today's totals and stock count everything once.
--
-- Only orders in the same payment state are merged: all unpaid, or all
-- paid. A paid and an unpaid order are never combined, so nobody is charged
-- twice. Staff table bills (table_code) are never merged here.
--
--   cc_admin_merge_orders(order_ids uuid[]) -> { order_id, token, merged, total }
--
-- Admins and super admins only (confirmed email). Safe to run more than once.
begin;

alter table public.store_orders add column if not exists merged_into uuid;
alter table public.store_orders add column if not exists merged_from jsonb;

create or replace function public.cc_phone10(p text) returns text
language sql immutable set search_path=pg_catalog as $$
 select nullif(right(regexp_replace(coalesce(p,''),'\D','','g'),10),'')
$$;

create or replace function public.cc_order_items(p jsonb) returns jsonb
language plpgsql immutable as $$
begin
 if p is null then return '[]'::jsonb; end if;
 if jsonb_typeof(p) = 'string' then p := (p #>> '{}')::jsonb; end if;
 if jsonb_typeof(p) <> 'array' then return '[]'::jsonb; end if;
 return p;
exception when others then return '[]'::jsonb;
end $$;

create or replace function public.cc_admin_merge_orders(p_order_ids uuid[]) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare ok boolean; n int; v_phones int; v_paid int; v_bills int; primary_o record; v_items jsonb; v_total numeric; v_status text; v_from jsonb;
begin
 select bool_or(coalesce((to_jsonb(c)->>'is_admin')::boolean,false) or coalesce((to_jsonb(c)->>'is_super_user')::boolean,false))
   into ok from auth.users u join public.customers c on lower(c.email)=lower(u.email)
  where u.id = auth.uid() and u.email_confirmed_at is not null;
 if not coalesce(ok,false) then raise exception 'Only an admin can merge orders' using errcode='42501'; end if;

 p_order_ids := array(select distinct x from unnest(coalesce(p_order_ids, '{}')) x where x is not null);
 if coalesce(array_length(p_order_ids,1),0) < 2 then raise exception 'Pick at least two orders to merge'; end if;

 -- Lock the orders, then check them.
 perform 1 from public.store_orders where id = any(p_order_ids) for update;
 select count(*), count(distinct public.cc_phone10(customer_phone)),
        count(*) filter (where payment_status in ('paid','complimentary')),
        count(*) filter (where table_code is not null)
   into n, v_phones, v_paid, v_bills
   from public.store_orders where id = any(p_order_ids) and status not in ('collected','cancelled');
 if n <> array_length(p_order_ids,1) then raise exception 'Some of these orders are already closed. Refresh and try again.'; end if;
 if v_phones <> 1 or exists(select 1 from public.store_orders where id = any(p_order_ids) and public.cc_phone10(customer_phone) is null) then
  raise exception 'Only orders from the same mobile number can be merged';
 end if;
 if v_bills > 0 then raise exception 'Staff table bills can''t be merged here'; end if;
 if v_paid not in (0, n) then raise exception 'A paid and an unpaid order can''t be merged into one bill'; end if;

 -- The oldest order becomes the bill.
 select * into primary_o from public.store_orders where id = any(p_order_ids) order by created_at, id limit 1;

 -- Every item; the same item at the same price on one line.
 select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('name', name, 'price', price, 'qty', qty,
           'paidQty', nullif(paid_qty,0), 'complimentary', case when comp then true end)) order by first_seen), '[]'::jsonb)
   into v_items
   from (
     select i->>'name' as name, (i->>'price')::numeric as price, coalesce((i->>'complimentary')::boolean,false) as comp,
            sum(coalesce(nullif(i->>'qty','')::numeric, nullif(i->>'quantity','')::numeric, 1)) as qty,
            sum(coalesce(nullif(i->>'paidQty','')::numeric, 0)) as paid_qty,
            min(o.created_at) as first_seen
       from public.store_orders o, jsonb_array_elements(public.cc_order_items(to_jsonb(o.items))) i
      where o.id = any(p_order_ids)
      group by 1, 2, 3
   ) lines;
 select coalesce(sum(total),0) into v_total from public.store_orders where id = any(p_order_ids);
 -- The bill is as far along as its least advanced order.
 select case when bool_or(status = 'pending') then 'pending' when bool_or(status = 'preparing') then 'preparing' else min(status) end
   into v_status from public.store_orders where id = any(p_order_ids);
 select jsonb_agg(jsonb_build_object('id', id, 'token', token, 'total', total, 'table', customer_table,
          'payment_method', payment_method, 'payment_status', payment_status, 'razorpay_payment_id', razorpay_payment_id) order by created_at)
   into v_from from public.store_orders where id = any(p_order_ids) and id <> primary_o.id;

 update public.store_orders set items = v_items, total = v_total, status = v_status,
   merged_from = coalesce(merged_from, '[]'::jsonb) || coalesce(v_from, '[]'::jsonb)
  where id = primary_o.id;
 update public.store_orders set status = 'cancelled', merged_into = primary_o.id
  where id = any(p_order_ids) and id <> primary_o.id;

 return jsonb_build_object('order_id', primary_o.id, 'token', primary_o.token, 'merged', n - 1, 'total', v_total);
end $$;

revoke all on function public.cc_admin_merge_orders(uuid[]) from public, anon;
grant execute on function public.cc_admin_merge_orders(uuid[]) to authenticated;

commit;
