-- 10 pm owner summary.
--
-- cc_daily_summary(day)  -> one day's numbers (IST): store + online sales,
--   cash / UPI / other, top 5 items, wastage, materials at or below their
--   reorder level, staff still clocked in, and the same weekday last week.
--   Owner (customers.is_super_user) only; shown in Reports > Today's summary.
-- cc_send_daily_summary() -> sends it as a push notification to the owner's
--   phones through the send-push Edge Function (type 'daily_summary').
--   pg_cron runs it every day at 22:00 IST (16:30 UTC). The owner can also
--   send a test from the app.
--
-- Needs: 20260950 (push), 20260956 (cc_today_ist, cc_store_items),
-- 20260964 (cc_prod_is_super), 20260966 (cc_wastage). Redeploy send-push
-- after this (supabase functions deploy send-push --no-verify-jwt).
-- If pg_cron is not enabled, enable it under Database > Extensions and run
-- this file again. Safe to re-run.
begin;
-- Wait at most 10 s for a busy table instead of deadlocking with the live app.
set local lock_timeout = '10s';
do $$ begin
 if not exists(select 1 from pg_proc where proname='cc_prod_is_super') then raise exception 'Run migrations/20260964_super_user_overrides.sql first.'; end if;
 if not exists(select 1 from pg_proc where proname='cc_store_items') then raise exception 'Run migrations/20260954_store_menu_photos_ratings.sql first.'; end if;
 if to_regclass('public.cc_push_config') is null then raise exception 'Run migrations/20260950_push_notifications.sql first.'; end if;
end $$;

create or replace function public.cc_daily_summary(p_day date default null) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare
 v_day date := coalesce(p_day, (now() at time zone 'Asia/Kolkata')::date);
 v_from timestamptz := v_day::timestamp at time zone 'Asia/Kolkata';
 v_to timestamptz := (v_day + 1)::timestamp at time zone 'Asia/Kolkata';
 v_store jsonb; v_online jsonb := jsonb_build_object('orders',0,'revenue',0); v_last numeric := 0;
 v_top jsonb; v_waste jsonb := jsonb_build_object('pieces',0,'cost',0); v_buy jsonb; v_staff jsonb := '[]'::jsonb;
begin
 -- auth.uid() is null only for the scheduled job (anon has no execute grant).
 if auth.uid() is not null and not public.cc_prod_is_super() then
  raise exception 'Only the owner can see the daily summary' using errcode='42501';
 end if;

 select jsonb_build_object(
   'orders', count(*),
   'revenue', coalesce(sum(total),0),
   'cash', coalesce(sum(total) filter (where lower(coalesce(payment_method,''))='cash' and payment_status='paid'),0),
   'cash_pending', coalesce(sum(total) filter (where lower(coalesce(payment_method,''))='cash' and coalesce(payment_status,'')<>'paid' and coalesce(payment_status,'')<>'complimentary'),0),
   'upi', coalesce(sum(total) filter (where lower(coalesce(payment_method,'')) in ('upi','upi_qr') and coalesce(payment_status,'')<>'complimentary'),0),
   'complimentary', coalesce(sum(total) filter (where payment_status='complimentary'),0))
  into v_store
 from public.store_orders where created_at >= v_from and created_at < v_to and coalesce(status,'')<>'cancelled';
 v_store := v_store || jsonb_build_object('other', (v_store->>'revenue')::numeric - (v_store->>'cash')::numeric - (v_store->>'cash_pending')::numeric - (v_store->>'upi')::numeric - (v_store->>'complimentary')::numeric);

 if to_regclass('public.orders') is not null then
  select jsonb_build_object('orders', count(*), 'revenue', coalesce(sum(total),0)) into v_online
  from public.orders where created_at >= v_from and created_at < v_to and coalesce(status,'')<>'cancelled';
 end if;

 select coalesce(sum(total),0) into v_last from public.store_orders
  where created_at >= v_from - interval '7 days' and created_at < v_to - interval '7 days' and coalesce(status,'')<>'cancelled';
 if to_regclass('public.orders') is not null then
  v_last := v_last + (select coalesce(sum(total),0) from public.orders
   where created_at >= v_from - interval '7 days' and created_at < v_to - interval '7 days' and coalesce(status,'')<>'cancelled');
 end if;

 select coalesce(jsonb_agg(jsonb_build_object('name',name,'qty',qty) order by qty desc, name),'[]'::jsonb) into v_top from (
  select btrim(i->>'name') as name, sum(coalesce(nullif(i->>'qty','')::numeric, nullif(i->>'quantity','')::numeric, 1)) as qty
  from public.store_orders o cross join lateral jsonb_array_elements(public.cc_store_items(o.items)) i
  where o.created_at >= v_from and o.created_at < v_to and coalesce(o.status,'')<>'cancelled' and coalesce(btrim(i->>'name'),'')<>''
  group by 1 order by 2 desc, 1 limit 5) t;

 if to_regclass('public.cc_wastage') is not null then
  select jsonb_build_object('pieces', coalesce(sum(quantity),0), 'cost', coalesce(sum(quantity*unit_cost),0)) into v_waste
  from public.cc_wastage where created_at >= v_from and created_at < v_to;
 end if;

 select coalesce(jsonb_agg(name order by name),'[]'::jsonb) into v_buy from (
  select name from public.inventory_items where coalesce(low_stock_threshold,0) > 0 and current_stock <= low_stock_threshold
  union
  select name from public.packaging_materials where coalesce(low_stock_threshold,0) > 0 and current_stock <= low_stock_threshold) b;

 if to_regclass('public.staff_attendance') is not null then
  begin
   execute 'select coalesce(jsonb_agg(distinct staff_name),''[]''::jsonb) from public.staff_attendance where work_date=$1 and clock_out is null'
    into v_staff using v_day;
  exception when others then v_staff := '[]'::jsonb;
  end;
 end if;

 return jsonb_build_object('day', v_day, 'store', v_store, 'online', v_online,
  'revenue', (v_store->>'revenue')::numeric + (v_online->>'revenue')::numeric,
  'orders', (v_store->>'orders')::int + (v_online->>'orders')::int,
  'last_week_revenue', v_last, 'top_items', v_top, 'wastage', v_waste, 'to_buy', v_buy, 'still_clocked_in', v_staff);
end $$;
revoke all on function public.cc_daily_summary(date) from public, anon;
grant execute on function public.cc_daily_summary(date) to authenticated;

-- Short push text from a summary.
create or replace function public.cc_daily_summary_text(s jsonb) returns jsonb
language sql immutable set search_path=pg_catalog,public as $$
 with f as (select
   (select string_agg(x->>'name' || ' ×' || trim(to_char((x->>'qty')::numeric,'FM999990.##')), ', ') from jsonb_array_elements(s->'top_items') with ordinality e(x,n) where n<=3) as top,
   jsonb_array_length(s->'to_buy') as nbuy,
   (select string_agg(v, ', ') from jsonb_array_elements_text(s->'to_buy') with ordinality e(v,n) where n<=3) as buy,
   (select string_agg(v, ', ') from jsonb_array_elements_text(s->'still_clocked_in') v) as staff)
 select jsonb_build_object(
  'title', '₹' || trim(to_char((s->>'revenue')::numeric,'FM99,99,99,990')) || ' today · ' || (s->>'orders') || ' orders'
     || case when (s->>'last_week_revenue')::numeric > 0
        then ' (' || case when (s->>'revenue')::numeric >= (s->>'last_week_revenue')::numeric then '▲' else '▼' end
             || abs(round(((s->>'revenue')::numeric / (s->>'last_week_revenue')::numeric - 1) * 100))::text || '% vs last ' || to_char((s->>'day')::date,'Dy') || ')'
        else '' end,
  'body', concat_ws(' · ',
     'UPI ₹' || trim(to_char((s#>>'{store,upi}')::numeric,'FM99,99,99,990')) || ', Cash ₹' || trim(to_char((s#>>'{store,cash}')::numeric,'FM99,99,99,990'))
       || case when (s#>>'{online,revenue}')::numeric > 0 then ', Online ₹' || trim(to_char((s#>>'{online,revenue}')::numeric,'FM99,99,99,990')) else '' end,
     case when top is not null then 'Top: ' || top end,
     case when (s#>>'{wastage,pieces}')::numeric > 0 then 'Wasted ' || (s#>>'{wastage,pieces}') || ' pcs (₹' || trim(to_char((s#>>'{wastage,cost}')::numeric,'FM99,99,990')) || ')' end,
     case when nbuy > 0 then 'To buy: ' || buy || case when nbuy > 3 then ' +' || (nbuy-3) else '' end end,
     case when staff is not null then 'Not clocked out: ' || staff end))
 from f
$$;

create or replace function public.cc_send_daily_summary() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_url text; v_secret text; v_msg jsonb;
begin
 if auth.uid() is not null and not public.cc_prod_is_super() then
  raise exception 'Only the owner can send the daily summary' using errcode='42501';
 end if;
 select value into v_url from public.cc_push_config where key='function_url';
 select value into v_secret from public.cc_push_config where key='webhook_secret';
 if coalesce(v_url,'')='' then return jsonb_build_object('sent', false, 'reason', 'Push is not set up'); end if;
 v_msg := public.cc_daily_summary_text(public.cc_daily_summary(null));
 perform net.http_post(
  url:=v_url,
  body:=jsonb_build_object('type','daily_summary','title',v_msg->>'title','body',v_msg->>'body'),
  headers:=jsonb_build_object('Content-Type','application/json','x-cc-push-secret',v_secret));
 return jsonb_build_object('sent', true, 'title', v_msg->>'title', 'body', v_msg->>'body');
end $$;
revoke all on function public.cc_send_daily_summary() from public, anon;
grant execute on function public.cc_send_daily_summary() to authenticated;

-- Every day at 22:00 IST.
do $$ begin
 create extension if not exists pg_cron;
 perform cron.unschedule(jobid) from cron.job where jobname='cc-daily-summary';
 perform cron.schedule('cc-daily-summary', '30 16 * * *', 'select public.cc_send_daily_summary()');
exception when others then
 raise notice 'pg_cron not available (%). Enable it under Database > Extensions and run this file again for the 10 pm push.', sqlerrm;
end $$;

notify pgrst, 'reload schema';
commit;
