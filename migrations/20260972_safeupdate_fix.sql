-- Fix: Supabase's safeupdate extension refuses "DELETE FROM t" without a
-- WHERE clause for requests coming from the app ("DELETE requires a WHERE
-- clause"). Two functions cleared a temporary work table that way:
--
--  * cc_customer_returns (Reports > Customer Returns) -- showed that error.
--  * cc_apply_sales_usage (automatic ingredient/packaging use from sales,
--    20260956/20260958). Its trigger never blocks an order, so for orders
--    placed from the app it skipped the stock reduction silently.
--
-- Same functions, with "where true" added. Run after 20260970. Safe to re-run.
begin;
set local lock_timeout = '10s';

create or replace function public.cc_apply_sales_usage(p_order_id text, p_items jsonb, p_status text) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r record; v_unit text; v_stock numeric; v_move numeric;
begin
 create temp table if not exists cc_tmp_usage(kind text, name text, unit text, quantity numeric) on commit drop;
 delete from cc_tmp_usage where true; -- Supabase safeupdate refuses a DELETE without WHERE
 if coalesce(p_status,'') <> 'cancelled' then
  insert into cc_tmp_usage(kind,name,unit,quantity)
  select l.kind, l.name, l.unit, sum(l.qty)
  from (
   select lower(btrim(i->>'name')) as key, sum(coalesce(nullif(i->>'qty','')::numeric, nullif(i->>'quantity','')::numeric, 1)) as sold
   from jsonb_array_elements(public.cc_store_items(p_items)) i
   where coalesce(btrim(i->>'name'),'')<>''
   group by 1
  ) s
  join lateral (
   select m.name from public.store_menu m
   where lower(btrim(m.name))=s.key and not coalesce(m.track_display_stock,false)
   limit 1
  ) mm on true
  join lateral (
   select rc.* from public.cc_production_recipes rc
   where lower(btrim(rc.product_name))=s.key and rc.deleted_at is null
   order by rc.created_at desc limit 1
  ) rc on true
  cross join lateral (
   select 'raw' as kind, x->>'name' as name, x->>'unit' as unit, (x->>'quantity')::numeric * s.sold / rc.yield_qty as qty
   from jsonb_array_elements(rc.ingredients) x
   union all
   select 'packaging', x->>'name', x->>'unit', (x->>'quantity')::numeric * s.sold / rc.yield_qty
   from jsonb_array_elements(coalesce(rc.packaging,'[]'::jsonb)) x
  ) l
  where s.sold > 0
  group by l.kind, l.name, l.unit;
 end if;

 for r in
  select coalesce(t.kind,u.kind) as kind, coalesce(t.name,u.name) as name, coalesce(t.unit,u.unit) as unit,
         coalesce(t.quantity,0) as want, coalesce(u.quantity,0) as had
  from cc_tmp_usage t
  full join (select * from public.cc_sales_usage where order_id=p_order_id) u on u.kind=t.kind and u.name=t.name
 loop
  continue when r.want = r.had;
  if r.kind='raw' then
   select unit, current_stock into v_unit, v_stock from public.inventory_items where name=r.name for update;
  else
   select unit, current_stock into v_unit, v_stock from public.packaging_materials where name=r.name for update;
  end if;
  continue when v_unit is null or v_unit <> r.unit;
  -- Taking more: only what's there. Giving back: what this order took.
  v_move := case when r.want > r.had then least(r.want - r.had, greatest(coalesce(v_stock,0),0)) else r.want - r.had end;
  if v_move <> 0 then
   if r.kind='raw' then
    update public.inventory_items set current_stock=current_stock - v_move, updated_at=now() where name=r.name;
   else
    update public.packaging_materials set current_stock=current_stock - v_move, updated_at=now() where name=r.name;
   end if;
  end if;
  if r.had + v_move = 0 then
   delete from public.cc_sales_usage where order_id=p_order_id and kind=r.kind and name=r.name;
  else
   insert into public.cc_sales_usage(order_id,kind,name,unit,quantity) values(p_order_id,r.kind,r.name,r.unit,r.had + v_move)
    on conflict (order_id,kind,name) do update set quantity=excluded.quantity, unit=excluded.unit, updated_at=now();
  end if;
 end loop;
end $$;

revoke all on function public.cc_apply_sales_usage(text,jsonb,text) from public, anon, authenticated;

create or replace function public.cc_customer_returns(p_days int default 30) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_days int := least(greatest(coalesce(p_days,30),7),365); v_since timestamptz := now() - make_interval(days=>least(greatest(coalesce(p_days,30),7),365));
        v_summary jsonb; v_second jsonb; v_missing jsonb; v_top jsonb;
begin
 if auth.uid() is null or not public.cc_prod_is_super() then
  raise exception 'Only the owner can see the customer report' using errcode='42501';
 end if;
 create temp table if not exists cc_tmp_cust(phone text primary key, name text, first_at timestamptz, last_at timestamptz,
   visits int, recent_visits int, spent numeric, fav text) on commit drop;
 delete from cc_tmp_cust where true; -- Supabase safeupdate refuses a DELETE without WHERE
 insert into cc_tmp_cust
 select v.phone,
  (array_agg(v.name order by v.visit_at desc) filter (where v.name is not null))[1],
  min(v.visit_at), max(v.visit_at),
  count(distinct (v.visit_at at time zone 'Asia/Kolkata')::date)::int,
  count(distinct (v.visit_at at time zone 'Asia/Kolkata')::date) filter (where v.visit_at >= now() - interval '90 days')::int,
  sum(v.total), null
 from public.cc_customer_visits() v group by v.phone;
 -- Favourite item: most pieces bought at the counter.
 update cc_tmp_cust t set fav = f.name from (
  select distinct on (phone) phone, name from (
   select public.cc_phone10(o.customer_phone) phone, btrim(i->>'name') name,
          sum(coalesce(nullif(i->>'qty','')::numeric, nullif(i->>'quantity','')::numeric, 1)) q
   from public.store_orders o cross join lateral jsonb_array_elements(public.cc_store_items(o.items)) i
   where coalesce(o.status,'')<>'cancelled' and public.cc_phone10(o.customer_phone) is not null and coalesce(btrim(i->>'name'),'')<>''
   group by 1,2) x order by phone, q desc, name) f
 where f.phone=t.phone;

 select jsonb_build_object(
   'days', v_days,
   'active', count(*) filter (where last_at >= v_since),
   'new', count(*) filter (where first_at >= v_since),
   'returning', count(*) filter (where last_at >= v_since and first_at < v_since),
   'total_known', count(*))
  into v_summary from cc_tmp_cust;

 -- First-timers from 30-60 days ago: how many came back at least once.
 select jsonb_build_object('first_timers', count(*), 'came_back', count(*) filter (where visits >= 2))
  into v_second from cc_tmp_cust where first_at >= now() - interval '60 days' and first_at < now() - interval '30 days';

 select coalesce(jsonb_agg(jsonb_build_object('phone',t.phone,'name',t.name,'visits',t.visits,'spent',round(t.spent),
   'last_at',t.last_at,'days_since',(now()::date - (t.last_at at time zone 'Asia/Kolkata')::date),'fav',t.fav,
   'has_app', exists(select 1 from public.customers c join public.cc_push_subscriptions s on s.customer_id=c.id::text where public.cc_phone10(c.phone)=t.phone),
   'messaged_at',(select max(l.created_at) from public.cc_winback_log l where l.phone=t.phone))
   order by t.spent desc),'[]'::jsonb)
  into v_missing
 from (select * from cc_tmp_cust where visits >= 3 and last_at < now() - interval '30 days' and last_at >= now() - interval '180 days' order by spent desc limit 150) t;

 select coalesce(jsonb_agg(jsonb_build_object('phone',phone,'name',name,'visits',recent_visits,'spent',round(spent),'fav',fav,'last_at',last_at) order by recent_visits desc, spent desc),'[]'::jsonb)
  into v_top from (select * from cc_tmp_cust where recent_visits >= 2 order by recent_visits desc, spent desc limit 15) t;

 return jsonb_build_object('summary', v_summary, 'second_visit', v_second, 'missing', v_missing, 'top', v_top);
end $$;
revoke all on function public.cc_customer_returns(int) from public, anon;
grant execute on function public.cc_customer_returns(int) to authenticated;

notify pgrst, 'reload schema';
commit;
