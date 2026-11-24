-- Premium loyalty: after 100 days, a free coffee every 25 visits.
--
-- Until now a card hid itself from the customer's Home once its lifetime
-- total (completed_days + stamp_count) reached 100. Now it stays, as a
-- gold Premium card:
--   * every visit after 100 (once a day, as before) adds a premium stamp,
--   * the 25th premium stamp earns one free coffee and the count goes back
--     to 0, and so on for every 25 visits,
--   * staff give the coffee from the Kitchen ticket or Loyalty Cards, which
--     takes one off the coffees waiting.
--
-- New columns on cc_loyalty_members:
--   premium_count  0..24  visits towards the next free coffee
--   premium_ready         free coffees earned and not given yet
--   premium_given         free coffees given so far
--   premium_since         first premium visit
--
-- cc_loyalty_premium(action, payload)   staff / admin:
--   'give_coffee' {member_id}            one waiting coffee given
--   'set_count'   {member_id, count}     correct the visit count (0..24)
--
-- Cards hidden only because they reached 100 are shown again; a super
-- admin can still hide one from Command Center → Completed Loyalty Cards.
--
-- Run AFTER 20261107_loyalty_auto_hide.sql. Safe to run more than once.
begin;
do $$ begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='cc_loyalty_members' and column_name='home_hidden') then
  raise exception 'Run migrations/20261106_loyalty_completed_controls.sql first.';
 end if;
 if not exists(select 1 from pg_proc where proname='cc_loyalty_ensure_member') then
  raise exception 'Run migrations/20260938_loyalty_auto_stamp_fix.sql first.';
 end if;
end $$;

alter table public.cc_loyalty_members add column if not exists premium_count integer not null default 0;
alter table public.cc_loyalty_members add column if not exists premium_ready integer not null default 0;
alter table public.cc_loyalty_members add column if not exists premium_given integer not null default 0;
alter table public.cc_loyalty_members add column if not exists premium_since timestamptz;
alter table public.cc_loyalty_members drop constraint if exists cc_loyalty_members_premium_check;
alter table public.cc_loyalty_members add constraint cc_loyalty_members_premium_check
 check (premium_count between 0 and 24 and premium_ready >= 0 and premium_given >= 0);

-- Cards no longer hide at 100. Show the ones that only hid for that reason
-- (first run only, so a card a super admin hides later stays hidden).
do $$ begin
 if exists(select 1 from pg_trigger where tgname='cc_loyalty_auto_hide' and tgrelid='public.cc_loyalty_members'::regclass) then
  update public.cc_loyalty_members set home_hidden=false where home_hidden and completed_days+stamp_count>=100;
 end if;
end $$;
drop trigger if exists cc_loyalty_auto_hide on public.cc_loyalty_members;

-- A card taken back under 100 days (super admin reset) starts premium over.
create or replace function public.cc_loyalty_premium_sync() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.completed_days+new.stamp_count<100 then new.premium_count=0; end if;
 return new;
end $$;
drop trigger if exists cc_loyalty_premium_sync on public.cc_loyalty_members;
create trigger cc_loyalty_premium_sync before update on public.cc_loyalty_members
 for each row execute function public.cc_loyalty_premium_sync();

-- Order collected → stamp (unchanged), or a premium stamp once past 100 days.
create or replace function public.cc_loyalty_order_trigger() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_member public.cc_loyalty_members; v_day date; v_phone text; v_phones jsonb; v_digits text; v_role text=public.cc_loyalty_role(); v_cycle_len integer;
begin
 v_phones=coalesce(new.customer_group_phones,'[]'::jsonb);
 if new.customer_phone is not null then v_phones=v_phones||jsonb_build_array(new.customer_phone); end if;

 if v_role in ('staff','admin') then
  for v_phone in select value from jsonb_array_elements_text(v_phones) loop
   perform public.cc_loyalty_ensure_member(v_phone);
  end loop;
 end if;

 if not (new.status='collected' and new.payment_status in ('paid','complimentary')) then return new; end if;
 if tg_op='UPDATE' and old.status=new.status and old.payment_status=new.payment_status then return new; end if;

 v_day=(now() at time zone 'Asia/Kolkata')::date;
 for v_phone in select value from jsonb_array_elements_text(v_phones) loop
  v_digits=regexp_replace(v_phone,'[^0-9]','','g');
  if length(v_digits)<10 then continue; end if;

  select * into v_member from public.cc_loyalty_members
   where right(regexp_replace(phone,'[^0-9]','','g'),10)=right(v_digits,10) and not suspended
   limit 1;
  if v_member.id is null then continue; end if;

  if exists(select 1 from public.cc_loyalty_stamp_log where member_id=v_member.id and (created_at at time zone 'Asia/Kolkata')::date=v_day) then
   continue;
  end if;

  if v_member.completed_days+v_member.stamp_count>=100 then
   -- Premium: 25 visits = one free coffee, then back to 0.
   insert into public.cc_loyalty_stamp_log(member_id,from_count,to_count,staff_name,actor)
    values(v_member.id,v_member.premium_count,(v_member.premium_count+1)%25,
           case when v_member.premium_count+1>=25 then 'Auto — premium visit 25: free coffee earned' else 'Auto — premium visit' end,null);
   update public.cc_loyalty_members set
     premium_count=(premium_count+1)%25,
     premium_ready=premium_ready+case when premium_count+1>=25 then 1 else 0 end,
     premium_since=coalesce(premium_since,now()), updated_at=now()
    where id=v_member.id;
   continue;
  end if;

  select coalesce(max((s->>'day')::int),100) into v_cycle_len from jsonb_array_elements(v_member.schedule) s;
  if v_member.stamp_count>=v_cycle_len then continue; end if;

  insert into public.cc_loyalty_stamp_log(member_id,from_count,to_count,staff_name,actor)
   values(v_member.id,v_member.stamp_count,v_member.stamp_count+1,'Auto — order collected',null);
  update public.cc_loyalty_members set stamp_count=stamp_count+1,updated_at=now() where id=v_member.id;
 end loop;
 return new;
end $$;

drop trigger if exists cc_loyalty_order on public.store_orders;
create trigger cc_loyalty_order after insert or update on public.store_orders for each row execute function public.cc_loyalty_order_trigger();

create or replace function public.cc_loyalty_premium(p_action text, p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare m public.cc_loyalty_members; v_count integer; v_staff text=nullif(btrim(coalesce(p_payload->>'staff_name','')),'');
begin
 if auth.uid() is null or coalesce(public.cc_loyalty_role(),'') not in ('staff','admin') then
  raise exception 'Staff access required' using errcode='42501';
 end if;
 select * into m from public.cc_loyalty_members where id=(p_payload->>'member_id')::uuid for update;
 if m.id is null then raise exception 'Card not found'; end if;
 if m.completed_days+m.stamp_count<100 then raise exception 'This card is not Premium yet (needs 100 days)'; end if;

 if p_action='give_coffee' then
  if m.suspended then raise exception 'This card is suspended'; end if;
  if m.premium_ready<1 then raise exception 'No free coffee waiting on this card'; end if;
  insert into public.cc_loyalty_stamp_log(member_id,from_count,to_count,staff_name,actor)
   values(m.id,m.premium_count,m.premium_count,coalesce(v_staff,'Staff')||' — premium free coffee given',auth.uid());
  update public.cc_loyalty_members set premium_ready=premium_ready-1, premium_given=premium_given+1, updated_at=now()
   where id=m.id returning * into m;
 elsif p_action='set_count' then
  begin v_count=(p_payload->>'count')::int; exception when others then v_count=null; end;
  if v_count is null or v_count<0 or v_count>24 then raise exception 'Premium visits must be from 0 to 24'; end if;
  insert into public.cc_loyalty_stamp_log(member_id,from_count,to_count,staff_name,actor)
   values(m.id,m.premium_count,v_count,coalesce(v_staff,'Staff')||' — premium visits corrected',auth.uid());
  update public.cc_loyalty_members set premium_count=v_count, premium_since=coalesce(premium_since,now()), updated_at=now()
   where id=m.id returning * into m;
 else
  raise exception 'Unknown action: %', p_action;
 end if;
 return to_jsonb(m);
end $$;
revoke all on function public.cc_loyalty_premium(text,jsonb) from public,anon;
grant execute on function public.cc_loyalty_premium(text,jsonb) to authenticated;

notify pgrst,'reload schema';
commit;
