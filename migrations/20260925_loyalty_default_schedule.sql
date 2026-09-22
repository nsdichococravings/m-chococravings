-- One shared reward schedule for every Loyalty Card, instead of each
-- admin picking their own interval (10 days for some customers, 15
-- for others) each time they issue a card. The cycle itself is always
-- 100 days (unchanged, cc_loyalty_members.stamp_count already caps
-- there) -- this is about which days within those 100 unlock a reward,
-- and making that the same for everyone by default.
--
-- Regular admin can still issue cards (unchanged); issuing no longer
-- takes a schedule from the client at all -- it always copies whatever
-- the current default is. Only a super user (customers.is_super_user,
-- the same flag cc_production_role() already treats as top-tier admin)
-- can change that default, or push it onto every existing card at once.
-- Run this ENTIRE file as database owner AFTER 20260921d_loyalty_cards.sql.
begin;
do $$ begin
 if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='cc_loyalty_members') then
  raise exception 'Run migrations/20260921d_loyalty_cards.sql first — Loyalty Cards is not installed yet.';
 end if;
end $$;

create table if not exists public.cc_loyalty_defaults (
 id boolean primary key default true check (id),
 schedule jsonb not null default '[]'::jsonb,
 updated_by uuid references auth.users(id),
 updated_at timestamptz not null default now()
);
insert into public.cc_loyalty_defaults(id) values (true) on conflict (id) do nothing;

alter table public.cc_loyalty_defaults enable row level security;
revoke all on public.cc_loyalty_defaults from public,anon,authenticated;
-- No direct grants at all — every read/write goes through cc_loyalty_command
-- below, same as cc_loyalty_members itself.

create or replace function public.cc_is_super_user() returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(
  (select coalesce((to_jsonb(c)->>'is_super_user')::boolean,false)
   from auth.users u join public.customers c on lower(c.email)=lower(u.email)
   where u.id=auth.uid() and u.email_confirmed_at is not null limit 1),
  false)
$$;

create or replace function public.cc_loyalty_command(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare role text=public.cc_loyalty_role(); m public.cc_loyalty_members; v_code text; v_phone text; v_count integer; v_day integer; v_query text; v_digits text; v_default jsonb; v_updated integer;
begin
 if auth.uid() is null then raise exception 'Sign in to use Loyalty Cards'; end if;
 if role not in ('admin','staff') then raise exception 'Staff access required'; end if;

 if p_action='issue' then
  if role<>'admin' then raise exception 'Admin access required'; end if;
  if nullif(btrim(p_payload->>'name'),'') is null then raise exception 'Enter the customer''s name'; end if;
  v_digits=regexp_replace(coalesce(p_payload->>'phone',''),'[^0-9]','','g');
  if length(v_digits)=12 and left(v_digits,2)='91' then v_digits=right(v_digits,10); end if;
  v_phone=case when length(v_digits)=10 then '+91'||v_digits else null end;
  if v_phone is null then raise exception 'Enter a valid 10-digit mobile number'; end if;
  if exists(select 1 from public.cc_loyalty_members where phone=v_phone) then raise exception 'A card already exists for this mobile number'; end if;
  select schedule into v_default from public.cc_loyalty_defaults where id=true;
  v_code=public.cc_loyalty_make_code(v_phone);
  insert into public.cc_loyalty_members(name,phone,card_code,schedule,issued_by)
   values(btrim(p_payload->>'name'),v_phone,v_code,coalesce(v_default,'[]'::jsonb),auth.uid()) returning * into m;
  return to_jsonb(m);

 elsif p_action='lookup' then
  v_query=btrim(coalesce(p_payload->>'query',''));
  if v_query='' then raise exception 'Enter a mobile number or card code'; end if;
  v_digits=regexp_replace(v_query,'[^0-9]','','g');
  return jsonb_build_object('members', coalesce(
   (select jsonb_agg(to_jsonb(t) order by t.name) from public.cc_loyalty_members t where length(v_digits)>=10 and right(regexp_replace(t.phone,'[^0-9]','','g'),10)=right(v_digits,10)),
   (select jsonb_agg(to_jsonb(t) order by t.name) from public.cc_loyalty_members t where upper(t.card_code)=upper(v_query)),
   (select jsonb_agg(to_jsonb(t) order by t.name) from public.cc_loyalty_members t where length(v_digits)>=4 and right(regexp_replace(t.phone,'[^0-9]','','g'),4)=right(v_digits,4)),
   '[]'::jsonb
  ));

 elsif p_action='set_stamp' then
  select * into m from public.cc_loyalty_members where id=(p_payload->>'member_id')::uuid for update;
  if m.id is null then raise exception 'Member not found'; end if;
  if m.suspended then raise exception 'This membership is suspended'; end if;
  v_count=(p_payload->>'count')::int;
  if v_count is null or v_count<0 or v_count>100 then raise exception 'Enter a stamp count from 0 to 100'; end if;
  insert into public.cc_loyalty_stamp_log(member_id,from_count,to_count,staff_name,actor) values(m.id,m.stamp_count,v_count,nullif(btrim(p_payload->>'staff_name'),''),auth.uid());
  update public.cc_loyalty_members set stamp_count=v_count,updated_at=now() where id=m.id returning * into m;
  return to_jsonb(m);

 elsif p_action='complete_cycle' then
  select * into m from public.cc_loyalty_members where id=(p_payload->>'member_id')::uuid for update;
  if m.id is null then raise exception 'Member not found'; end if;
  if m.stamp_count<100 then raise exception 'This card has not reached 100 days yet'; end if;
  update public.cc_loyalty_members set cycle=cycle+1,stamp_count=0,redeemed_days='{}',updated_at=now() where id=m.id returning * into m;
  return to_jsonb(m);

 elsif p_action='redeem' then
  select * into m from public.cc_loyalty_members where id=(p_payload->>'member_id')::uuid for update;
  if m.id is null then raise exception 'Member not found'; end if;
  v_day=(p_payload->>'day')::int;
  if v_day is null or not exists(select 1 from jsonb_array_elements(m.schedule) s where (s->>'day')::int=v_day) then raise exception 'That milestone is not on this card'; end if;
  if v_day>m.stamp_count then raise exception 'Not unlocked yet'; end if;
  if v_day=any(m.redeemed_days) then raise exception 'Already redeemed'; end if;
  update public.cc_loyalty_members set redeemed_days=array_append(redeemed_days,v_day),updated_at=now() where id=m.id returning * into m;
  return to_jsonb(m);

 elsif p_action='suspend' then
  if role<>'admin' then raise exception 'Admin access required'; end if;
  if length(btrim(coalesce(p_payload->>'reason','')))=0 then raise exception 'Reason required'; end if;
  update public.cc_loyalty_members set suspended=(p_payload->>'suspended')::boolean,updated_at=now() where id=(p_payload->>'member_id')::uuid returning * into m;
  if not found then raise exception 'Member not found'; end if;
  return to_jsonb(m);

 elsif p_action='get_default_schedule' then
  select to_jsonb(d) into v_default from public.cc_loyalty_defaults d where id=true;
  return v_default;

 elsif p_action='set_default_schedule' then
  if not public.cc_is_super_user() then raise exception 'Super admin access required'; end if;
  if not public.cc_loyalty_schedule(p_payload->'schedule') then raise exception 'Choose valid menu items and unique milestone days from 1 to 100'; end if;
  update public.cc_loyalty_defaults set schedule=p_payload->'schedule',updated_by=auth.uid(),updated_at=now() where id=true returning to_jsonb(cc_loyalty_defaults.*) into v_default;
  return v_default;

 elsif p_action='apply_default_to_all' then
  if not public.cc_is_super_user() then raise exception 'Super admin access required'; end if;
  select schedule into v_default from public.cc_loyalty_defaults where id=true;
  if v_default is null or jsonb_array_length(v_default)=0 then raise exception 'Set the default schedule first'; end if;
  update public.cc_loyalty_members set schedule=v_default,updated_at=now();
  get diagnostics v_updated = row_count;
  return jsonb_build_object('updated', v_updated);

 else raise exception 'Unknown loyalty action'; end if;
end $$;

revoke all on function public.cc_loyalty_command(text,jsonb) from public,anon,authenticated;
grant execute on function public.cc_loyalty_command(text,jsonb) to authenticated;

notify pgrst,'reload schema';
commit;
