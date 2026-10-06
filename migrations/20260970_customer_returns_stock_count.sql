-- Customer returns report + win-back messages, and stock counts for
-- ingredients and packaging.
--
-- H. CUSTOMER RETURNS (owner only, customers.is_super_user)
--   cc_customer_returns(p_days)  -> new vs returning customers in the last
--     p_days, the 2nd-visit rate of recent first-timers, top regulars, and
--     "missing regulars": 3+ visits, nothing for 30-180 days. Customers are
--     matched by the last 10 digits of their phone (counter orders) and by
--     their account phone (app orders).
--   cc_winback_send(phones, title, body) -> push message to those of them
--     who have the app with notifications on ({name} and {item} are filled
--     in per customer). The rest come back in no_app so the owner can
--     WhatsApp them; cc_winback_mark(phone,'whatsapp') records that.
--     Every message is logged in cc_winback_log (shown as "messaged").
--
-- C. STOCK COUNT (admin / production staff)
--   cc_stock_count(lines, note) -> lines = [{kind:'raw'|'packaging', name,
--     counted}]. Each counted material is set to the counted quantity; the
--     gap (counted - expected) and its value at the current unit cost are
--     kept in cc_stock_counts / cc_stock_count_lines.
--
-- Needs 20260950 (push) and 20260964 (cc_prod_is_super). Redeploy send-push
-- after this. Safe to re-run.
begin;
set local lock_timeout = '10s';
do $$ begin
 if not exists(select 1 from pg_proc where proname='cc_prod_is_super') then raise exception 'Run migrations/20260964_super_user_overrides.sql first.'; end if;
 if to_regclass('public.cc_push_config') is null then raise exception 'Run migrations/20260950_push_notifications.sql first.'; end if;
 if not exists(select 1 from pg_proc where proname='cc_store_items') then raise exception 'Run migrations/20260954_store_menu_photos_ratings.sql first.'; end if;
end $$;

create or replace function public.cc_phone10(p text) returns text
language sql immutable as $$ select nullif(right(regexp_replace(coalesce(p,''),'\D','','g'),10),'') $$;

-- ── H. Customer returns ──────────────────────────────────────
create table if not exists public.cc_winback_log(
 id uuid primary key default gen_random_uuid(),
 phone text not null,
 channel text not null check (channel in ('push','whatsapp')),
 message text,
 sent_by uuid,
 created_at timestamptz not null default now()
);
create index if not exists cc_winback_log_phone_idx on public.cc_winback_log(phone, created_at desc);
alter table public.cc_winback_log enable row level security;
revoke all on public.cc_winback_log from public, anon, authenticated;

create or replace function public.cc_customer_visits() returns table(phone text, name text, visit_at timestamptz, total numeric, items jsonb)
language sql stable security definer set search_path=pg_catalog,public as $$
 select public.cc_phone10(o.customer_phone), nullif(btrim(o.customer_name),''), o.created_at, coalesce(o.total,0), o.items
 from public.store_orders o
 where coalesce(o.status,'')<>'cancelled' and public.cc_phone10(o.customer_phone) is not null
 union all
 select public.cc_phone10(c.phone), nullif(btrim(c.name),''), o.created_at, coalesce(o.total,0), null::jsonb
 from public.orders o join public.customers c on c.id::text=o.customer_id::text
 where coalesce(o.status,'')<>'cancelled' and public.cc_phone10(c.phone) is not null
$$;
revoke all on function public.cc_customer_visits() from public, anon, authenticated;

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

create or replace function public.cc_winback_send(p_phones text[], p_title text, p_body text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_url text; v_secret text; v_msgs jsonb := '[]'::jsonb; v_no_app jsonb := '[]'::jsonb; r record;
        v_title text := left(btrim(coalesce(p_title,'')),80); v_body text := left(btrim(coalesce(p_body,'')),300);
begin
 if auth.uid() is null or not public.cc_prod_is_super() then
  raise exception 'Only the owner can send win-back messages' using errcode='42501';
 end if;
 if v_title = '' or v_body = '' then raise exception 'Write a title and a message'; end if;
 if coalesce(array_length(p_phones,1),0) = 0 or array_length(p_phones,1) > 200 then raise exception 'Choose 1 to 200 customers'; end if;
 select value into v_url from public.cc_push_config where key='function_url';
 select value into v_secret from public.cc_push_config where key='webhook_secret';
 for r in
  select p.phone,
   (select c.id::text from public.customers c join public.cc_push_subscriptions s on s.customer_id=c.id::text
     where public.cc_phone10(c.phone)=p.phone limit 1) as customer_id,
   coalesce((select nullif(btrim(c.name),'') from public.customers c where public.cc_phone10(c.phone)=p.phone and nullif(btrim(c.name),'') is not null limit 1),
            (select nullif(btrim(o.customer_name),'') from public.store_orders o where public.cc_phone10(o.customer_phone)=p.phone and nullif(btrim(o.customer_name),'') is not null order by o.created_at desc limit 1)) as name,
   (select btrim(i->>'name') from public.store_orders o cross join lateral jsonb_array_elements(public.cc_store_items(o.items)) i
     where public.cc_phone10(o.customer_phone)=p.phone and coalesce(btrim(i->>'name'),'')<>'' group by 1
     order by sum(coalesce(nullif(i->>'qty','')::numeric,1)) desc limit 1) as fav
  from (select distinct public.cc_phone10(x) phone from unnest(p_phones) x where public.cc_phone10(x) is not null) p
 loop
  if r.customer_id is not null and coalesce(v_url,'') <> '' then
   v_msgs := v_msgs || jsonb_build_object('customer_id', r.customer_id,
     'title', replace(replace(v_title,'{name}',coalesce(split_part(r.name,' ',1),'friend')),'{item}',coalesce(r.fav,'favourite treat')),
     'body', replace(replace(v_body,'{name}',coalesce(split_part(r.name,' ',1),'friend')),'{item}',coalesce(r.fav,'favourite treat')));
   insert into public.cc_winback_log(phone,channel,message,sent_by) values(r.phone,'push',v_body,auth.uid());
  else
   v_no_app := v_no_app || jsonb_build_object('phone', r.phone, 'name', r.name, 'fav', r.fav);
  end if;
 end loop;
 if jsonb_array_length(v_msgs) > 0 then
  perform net.http_post(url:=v_url, body:=jsonb_build_object('type','winback','messages',v_msgs),
   headers:=jsonb_build_object('Content-Type','application/json','x-cc-push-secret',v_secret));
 end if;
 return jsonb_build_object('pushed', jsonb_array_length(v_msgs), 'no_app', v_no_app);
end $$;
revoke all on function public.cc_winback_send(text[],text,text) from public, anon;
grant execute on function public.cc_winback_send(text[],text,text) to authenticated;

create or replace function public.cc_winback_mark(p_phone text, p_channel text, p_message text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null or not public.cc_prod_is_super() then raise exception 'Only the owner can do this' using errcode='42501'; end if;
 if public.cc_phone10(p_phone) is null or p_channel not in ('push','whatsapp') then raise exception 'Invalid phone or channel'; end if;
 insert into public.cc_winback_log(phone,channel,message,sent_by) values(public.cc_phone10(p_phone),p_channel,left(p_message,300),auth.uid());
 return jsonb_build_object('ok', true);
end $$;
revoke all on function public.cc_winback_mark(text,text,text) from public, anon;
grant execute on function public.cc_winback_mark(text,text,text) to authenticated;

-- ── C. Stock count ───────────────────────────────────────────
create table if not exists public.cc_stock_counts(
 id uuid primary key default gen_random_uuid(),
 counted_by uuid not null,
 counted_by_name text,
 note text,
 lines_count int not null default 0,
 value_gap numeric not null default 0,
 created_at timestamptz not null default now()
);
create table if not exists public.cc_stock_count_lines(
 id uuid primary key default gen_random_uuid(),
 count_id uuid not null references public.cc_stock_counts(id) on delete cascade,
 kind text not null check (kind in ('raw','packaging')),
 name text not null,
 unit text,
 expected numeric not null,
 counted numeric not null,
 gap numeric not null,
 unit_cost numeric,
 value_gap numeric
);
create index if not exists cc_stock_count_lines_count_idx on public.cc_stock_count_lines(count_id);
alter table public.cc_stock_counts enable row level security;
alter table public.cc_stock_count_lines enable row level security;
revoke all on public.cc_stock_counts, public.cc_stock_count_lines from public, anon, authenticated;
grant select on public.cc_stock_counts, public.cc_stock_count_lines to authenticated;
drop policy if exists cc_stock_counts_read on public.cc_stock_counts;
create policy cc_stock_counts_read on public.cc_stock_counts for select to authenticated using (public.cc_production_access());
drop policy if exists cc_stock_count_lines_read on public.cc_stock_count_lines;
create policy cc_stock_count_lines_read on public.cc_stock_count_lines for select to authenticated using (public.cc_production_access());

create or replace function public.cc_stock_count(p_lines jsonb, p_note text default null, p_by text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_role text := public.cc_production_role(); v_id uuid; l jsonb; v_kind text; v_name text; v_counted numeric;
        v_unit text; v_stock numeric; v_cost numeric; v_n int := 0; v_value numeric := 0;
begin
 if auth.uid() is null or v_role not in ('admin','production') then
  raise exception 'Only admin or production staff can record a stock count' using errcode='42501';
 end if;
 if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'Enter at least one counted quantity'; end if;
 perform set_config('cc.system_write','on',true);
 insert into public.cc_stock_counts(counted_by,counted_by_name,note) values(auth.uid(), nullif(btrim(coalesce(p_by,'')),''), nullif(btrim(coalesce(p_note,'')),''))
  returning id into v_id;
 for l in select * from jsonb_array_elements(p_lines) loop
  v_kind := l->>'kind'; v_name := l->>'name';
  v_counted := nullif(l->>'counted','')::numeric;
  if v_counted is null then continue; end if;
  if v_counted < 0 or v_counted > 100000000 then raise exception 'Counted quantity for % must be 0 or more', v_name; end if;
  if v_kind = 'raw' then
   select unit, current_stock, cost_per_unit into v_unit, v_stock, v_cost from public.inventory_items where name=v_name for update;
  elsif v_kind = 'packaging' then
   select unit, current_stock, cost_per_unit into v_unit, v_stock, v_cost from public.packaging_materials where name=v_name for update;
  else raise exception 'Unknown material type for %', v_name;
  end if;
  if v_unit is null then raise exception 'Material not found: %', v_name; end if;
  if v_kind = 'raw' then update public.inventory_items set current_stock=v_counted, updated_at=now() where name=v_name;
  else update public.packaging_materials set current_stock=v_counted, updated_at=now() where name=v_name; end if;
  insert into public.cc_stock_count_lines(count_id,kind,name,unit,expected,counted,gap,unit_cost,value_gap)
   values(v_id, v_kind, v_name, v_unit, coalesce(v_stock,0), v_counted, v_counted - coalesce(v_stock,0), v_cost,
          case when v_cost is null then null else (v_counted - coalesce(v_stock,0)) * v_cost end);
  v_n := v_n + 1; v_value := v_value + coalesce((v_counted - coalesce(v_stock,0)) * v_cost, 0);
 end loop;
 if v_n = 0 then raise exception 'Enter at least one counted quantity'; end if;
 update public.cc_stock_counts set lines_count=v_n, value_gap=v_value where id=v_id;
 perform set_config('cc.system_write','off',true);
 return jsonb_build_object('ok', true, 'id', v_id, 'lines', v_n, 'value_gap', v_value);
end $$;
revoke all on function public.cc_stock_count(jsonb,text,text) from public, anon;
grant execute on function public.cc_stock_count(jsonb,text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
