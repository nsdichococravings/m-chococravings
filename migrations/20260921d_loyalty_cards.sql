-- Loyalty Cards: replaces the login/code-based Premium Cards system.
-- No customer account, no email/phone verification, no order-item
-- linking at all. Staff already collects the customer's phone number
-- while taking an order; that phone is the card's real lookup key.
-- Each card also gets a short, sayable "NSDI-CARD-XXXX" code (last 4
-- digits of the phone) purely as a memorable label for the customer to
-- quote next visit - staff can always look up by full phone or name too
-- if two cards ever land on the same 4 digits.
--
-- Staff directly sets/corrects the visit (stamp) count each visit - no
-- automatic calculation from order amounts. Rewards unlock at the
-- milestones on the card's schedule once the stamp count reaches them;
-- staff marks a reward redeemed when they hand over the free item.
-- When a card reaches 100 days, staff explicitly completes the cycle
-- to start the next one.
--
-- This is a fresh, independent set of tables/functions (cc_loyalty_*)
-- - it does not touch or depend on the old cc_premium_* objects. Run
-- migrations/20260921e_drop_old_premium_cards.sql separately, and only
-- once you're sure you don't need any existing Premium Cards data, to
-- remove the old system.
begin;

create table if not exists public.cc_loyalty_members (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(name) between 1 and 120),
 phone text not null unique,
 card_code text not null unique,
 cycle integer not null default 1 check(cycle>=1),
 stamp_count integer not null default 0 check(stamp_count between 0 and 100),
 schedule jsonb not null,
 redeemed_days integer[] not null default '{}',
 suspended boolean not null default false,
 issued_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists cc_loyalty_members_phone on public.cc_loyalty_members(phone);
create index if not exists cc_loyalty_members_code on public.cc_loyalty_members(card_code);

create table if not exists public.cc_loyalty_stamp_log (
 id bigint generated always as identity primary key,
 member_id uuid not null references public.cc_loyalty_members(id),
 from_count integer not null,
 to_count integer not null,
 staff_name text,
 actor uuid,
 created_at timestamptz not null default now()
);
create index if not exists cc_loyalty_stamp_log_member on public.cc_loyalty_stamp_log(member_id,created_at);

create or replace function public.cc_loyalty_role() returns text language sql stable security definer set search_path=pg_catalog,public as $$
 select case when auth.uid() is null then null
 when public.cc_production_role()='admin' then 'admin'
 when public.cc_production_role()='sales' or exists(select 1 from auth.users u join public.customers c on lower(c.email)=lower(u.email)
  where u.id=auth.uid() and u.email_confirmed_at is not null and coalesce((to_jsonb(c)->>'is_employee')::boolean,false)) then 'staff'
 else 'customer' end
$$;

create or replace function public.cc_loyalty_schedule(p_schedule jsonb) returns boolean language plpgsql set search_path=pg_catalog,public as $$
declare x jsonb; seen integer[]='{}'; d integer;
begin
 if jsonb_typeof(p_schedule)<>'array' or jsonb_array_length(p_schedule) not between 1 and 100 then return false; end if;
 for x in select value from jsonb_array_elements(p_schedule) loop
  d=(x->>'day')::integer;
  if d is null or d not between 1 and 100 or d=any(seen) or not exists(select 1 from public.store_menu where name=x->>'item') then return false; end if;
  seen=array_append(seen,d);
 end loop; return true;
end $$;

-- Base code is the phone's last 4 digits; on a collision, appends A, B, C...
create or replace function public.cc_loyalty_make_code(p_phone text) returns text language plpgsql set search_path=pg_catalog,public as $$
declare v_base text; v_try text; v_n integer=0;
begin
 v_base='NSDI-CARD-'||right(regexp_replace(p_phone,'[^0-9]','','g'),4);
 v_try=v_base;
 while exists(select 1 from public.cc_loyalty_members where card_code=v_try) loop
  v_n=v_n+1;
  v_try=v_base||chr(64+v_n);
 end loop;
 return v_try;
end $$;

create or replace function public.cc_loyalty_command(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare role text=public.cc_loyalty_role(); m public.cc_loyalty_members; v_code text; v_phone text; v_count integer; v_day integer; v_query text; v_digits text;
begin
 if auth.uid() is null then raise exception 'Sign in to use Loyalty Cards'; end if;
 if role not in ('admin','staff') then raise exception 'Staff access required'; end if;

 if p_action='issue' then
  if role<>'admin' then raise exception 'Admin access required'; end if;
  if nullif(btrim(p_payload->>'name'),'') is null then raise exception 'Enter the customer''s name'; end if;
  -- Normalize to +91XXXXXXXXXX here (not just client-side) so phone
  -- stays comparable no matter how a caller formats it.
  v_digits=regexp_replace(coalesce(p_payload->>'phone',''),'[^0-9]','','g');
  if length(v_digits)=12 and left(v_digits,2)='91' then v_digits=right(v_digits,10); end if;
  v_phone=case when length(v_digits)=10 then '+91'||v_digits else null end;
  if v_phone is null then raise exception 'Enter a valid 10-digit mobile number'; end if;
  if exists(select 1 from public.cc_loyalty_members where phone=v_phone) then raise exception 'A card already exists for this mobile number'; end if;
  if not public.cc_loyalty_schedule(p_payload->'schedule') then raise exception 'Choose valid menu items and unique milestone days from 1 to 100'; end if;
  v_code=public.cc_loyalty_make_code(v_phone);
  insert into public.cc_loyalty_members(name,phone,card_code,schedule,issued_by)
   values(btrim(p_payload->>'name'),v_phone,v_code,p_payload->'schedule',auth.uid()) returning * into m;
  return to_jsonb(m);

 elsif p_action='lookup' then
  v_query=btrim(coalesce(p_payload->>'query',''));
  if v_query='' then raise exception 'Enter a mobile number or card code'; end if;
  v_digits=regexp_replace(v_query,'[^0-9]','','g');
  -- Priority: an exact full-number or card-code match always wins outright,
  -- even if other cards happen to share the same last 4 digits. Only fall
  -- back to the fuzzy last-4 match (which can return several candidates)
  -- when nothing matches exactly.
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

 else raise exception 'Unknown loyalty action'; end if;
end $$;

alter table public.cc_loyalty_members enable row level security;
alter table public.cc_loyalty_stamp_log enable row level security;
revoke all on public.cc_loyalty_members from public,anon,authenticated;
revoke all on public.cc_loyalty_stamp_log from public,anon,authenticated;
revoke all on function public.cc_loyalty_command(text,jsonb) from public,anon,authenticated;
grant execute on function public.cc_loyalty_command(text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
