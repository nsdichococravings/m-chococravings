-- NSDI Store: alert staff when a customer order needs packing.
--
-- When an order becomes "to pack" — a Cash-at-pickup order is placed, or an
-- online order is paid — every staff phone (customers.is_employee / is_admin /
-- is_super_user) gets a push: "New NSDI Store order · NS…-0042 · ₹465 · 3 to pack".
-- The app also shows the "to pack" count and plays a chime (grocery-alerts.js).
--
-- Needs the send-push Edge Function redeployed (it gains type 'staff_alert').
-- If push is not set up, orders still work; only the push is skipped.
-- Safe to run more than once. Roll back:
--   drop trigger if exists grocery_orders_staff_alert on public.grocery_orders;
begin;

-- Orders waiting to be packed: placed, and either cash or already paid.
create or replace function public.grocery_to_pack_count() returns int
language sql stable security definer set search_path=pg_catalog,public as $$
 select count(*)::int from public.grocery_orders
 where status = 'placed' and (payment_method = 'cash' or payment_status = 'paid')
$$;

-- Small call for the app's badge: staff only.
create or replace function public.grocery_staff_alert_state() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 perform public.grocery_require('staff');
 return jsonb_build_object(
   'to_pack', public.grocery_to_pack_count(),
   'latest', (select jsonb_build_object('id', id, 'order_no', order_no, 'total', total, 'at', coalesce(paid_at, created_at))
              from public.grocery_orders
              where status = 'placed' and (payment_method = 'cash' or payment_status = 'paid')
              order by coalesce(paid_at, created_at) desc limit 1));
end $$;

create or replace function public.grocery_staff_push(p_title text, p_body text, p_count int) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_url text; v_secret text; v_msgs jsonb;
begin
 begin
  select value into v_url from public.cc_push_config where key = 'function_url';
  select value into v_secret from public.cc_push_config where key = 'webhook_secret';
  if coalesce(v_url, '') = '' then return false; end if;
  select coalesce(jsonb_agg(jsonb_build_object('customer_id', c.id::text, 'title', p_title, 'body', p_body,
           'url', '/grocery-admin.html#orders', 'count', p_count)), '[]'::jsonb)
    into v_msgs
    from public.customers c
   where coalesce((to_jsonb(c)->>'is_employee')::boolean, false)
      or coalesce((to_jsonb(c)->>'is_admin')::boolean, false)
      or coalesce((to_jsonb(c)->>'is_super_user')::boolean, false);
  if jsonb_array_length(v_msgs) = 0 then return false; end if;
  perform net.http_post(url := v_url,
    body := jsonb_build_object('type', 'staff_alert', 'messages', v_msgs),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cc-push-secret', v_secret));
  return true;
 exception when others then return false; -- push is optional; never block an order
 end;
end $$;

create or replace function public.grocery_orders_staff_alert() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_now boolean; v_before boolean := false; v_count int;
begin
 v_now := new.status = 'placed' and (new.payment_method = 'cash' or new.payment_status = 'paid');
 if tg_op = 'UPDATE' then
  v_before := old.status = 'placed' and (old.payment_method = 'cash' or old.payment_status = 'paid');
 end if;
 if v_now and not v_before then
  v_count := public.grocery_to_pack_count();
  perform public.grocery_staff_push(
    'New NSDI Store order',
    new.order_no || ' · ₹' || trim(to_char(new.total, 'FM999999990.##')) || ' · '
      || case when new.payment_method = 'cash' then 'Cash at pickup' else 'Paid online' end
      || ' · ' || v_count || ' to pack',
    v_count);
 end if;
 return null;
exception when others then return null;
end $$;

drop trigger if exists grocery_orders_staff_alert on public.grocery_orders;
create trigger grocery_orders_staff_alert after insert or update of status, payment_status on public.grocery_orders
 for each row execute function public.grocery_orders_staff_alert();

revoke all on function public.grocery_to_pack_count() from public, anon, authenticated;
revoke all on function public.grocery_staff_push(text, text, int) from public, anon, authenticated;
revoke all on function public.grocery_orders_staff_alert() from public, anon, authenticated;
revoke all on function public.grocery_staff_alert_state() from public, anon;
grant execute on function public.grocery_staff_alert_state() to authenticated;

commit;
