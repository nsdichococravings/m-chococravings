-- NSDI Cafe: keep all of one customer's open orders at one table.
--
-- When a customer orders again with the same mobile number, the app asks
-- "You already have an order at T2. Add this order to T2?". If yes, the new
-- order goes to T2 and every other open order from that number moves to T2
-- too, so the other tables are free again. Each order keeps its own payment
-- and kitchen ticket; only the table (store_orders.customer_table) changes.
--
--   cc_customer_open_table(phone)  -> { table, token, orders } or null
--   cc_merge_customer_table(order) -> { table, moved }
--
-- Only customer self-orders (customer_table) are moved. Staff table bills
-- (table_code on the Tables board) are never changed, but their table is
-- offered first, so the customer joins the table they are sitting at.
-- Safe to run more than once.
begin;

create or replace function public.cc_phone10(p text) returns text
language sql immutable set search_path=pg_catalog as $$
 select nullif(right(regexp_replace(coalesce(p,''),'\D','','g'),10),'')
$$;

create or replace function public.cc_customer_open_table(p_phone text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v text := public.cc_phone10(p_phone); r record; n int;
begin
 if v is null or length(v) <> 10 then return null; end if;
 select count(*) into n from public.store_orders o
  where public.cc_phone10(o.customer_phone) = v
    and o.status not in ('collected','cancelled')
    and (o.table_code is not null or (o.customer_table is not null and o.customer_table <> 'TAKEAWAY'
         and o.created_at > now() - interval '4 hours'));
 if n = 0 then return null; end if;
 -- A staff table bill wins (that's where they are seated), then their newest self-order.
 select coalesce(upper(o.table_code), o.customer_table) as tbl, o.token into r
  from public.store_orders o
  where public.cc_phone10(o.customer_phone) = v
    and o.status not in ('collected','cancelled')
    and (o.table_code is not null or (o.customer_table is not null and o.customer_table <> 'TAKEAWAY'
         and o.created_at > now() - interval '4 hours'))
  order by (o.table_code is not null) desc, o.created_at desc
  limit 1;
 return jsonb_build_object('table', r.tbl, 'token', r.token, 'orders', n);
end $$;

create or replace function public.cc_merge_customer_table(p_order_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare o record; v text; n int := 0;
begin
 select id, customer_phone, customer_table, created_at into o from public.store_orders where id = p_order_id;
 if not found then raise exception 'Order not found'; end if;
 v := public.cc_phone10(o.customer_phone);
 -- Only right after placing it, and only for a real table.
 if v is null or o.customer_table is null or o.customer_table = 'TAKEAWAY' or o.created_at < now() - interval '30 minutes' then
  return jsonb_build_object('table', o.customer_table, 'moved', 0);
 end if;
 update public.store_orders s set customer_table = o.customer_table
  where s.id <> o.id
    and public.cc_phone10(s.customer_phone) = v
    and s.status not in ('collected','cancelled')
    and s.table_code is null
    and s.customer_table is not null and s.customer_table <> 'TAKEAWAY'
    and s.customer_table <> o.customer_table
    and s.created_at > now() - interval '4 hours';
 get diagnostics n = row_count;
 return jsonb_build_object('table', o.customer_table, 'moved', n);
end $$;

revoke all on function public.cc_customer_open_table(text) from public;
revoke all on function public.cc_merge_customer_table(uuid) from public;
grant execute on function public.cc_customer_open_table(text) to anon, authenticated;
grant execute on function public.cc_merge_customer_table(uuid) to anon, authenticated;

commit;
