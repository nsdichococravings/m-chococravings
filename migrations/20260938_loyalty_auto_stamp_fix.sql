-- "Bill Collected but stamp not updating" -- two possible causes, both
-- fixed here in one self-contained migration:
--
-- 1. The auto-stamp trigger (cc_loyalty_order_trigger, on store_orders)
--    was defined across two OLDER migrations from before Card Levels
--    existed (20260921g_loyalty_auto_stamp.sql, then superseded by
--    20260922b_auto_loyalty_cards.sql) -- neither was part of this
--    session's guidance, so it's entirely possible the CREATE TRIGGER
--    statement that actually attaches it to store_orders was never run
--    at all, even if the function itself exists. This migration
--    (re)creates cc_loyalty_ensure_member and DROPS + RE-CREATES the
--    trigger unconditionally, so it's guaranteed attached and current
--    regardless of what ran before.
--
-- 2. The trigger capped auto-stamping at a hardcoded 100, from before
--    cards could have their own shorter schedule (Card Levels). A
--    customer already at day 10 of a 10-day Card 1 would keep getting
--    auto-stamped past 10 on every later visit instead of stopping
--    until staff completes that cycle -- now caps at the card's OWN
--    schedule length, same fallback-to-100 convention complete_cycle
--    and set_cycle already use.
--
-- Run this ENTIRE file as database owner AFTER 20260927_loyalty_card_levels.sql.
begin;
do $$ begin
 if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='cc_loyalty_cycle_levels') then
  raise exception 'Run migrations/20260927_loyalty_card_levels.sql first.';
 end if;
 if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='store_orders') then
  raise exception 'store_orders table not found -- is this the right database?';
 end if;
end $$;

alter table public.cc_loyalty_members add column if not exists name_pending boolean not null default false;

-- Finds the existing card for a phone number, or creates a pending one
-- (placeholder name, empty schedule, stamps still count) if none
-- exists. Safe under concurrent calls for the same phone — the unique
-- constraint on phone settles any race, and the loser just returns the
-- winner's id instead of erroring.
create or replace function public.cc_loyalty_ensure_member(p_phone text) returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_digits text; v_phone text; v_id uuid; v_code text;
begin
 v_digits=regexp_replace(coalesce(p_phone,''),'[^0-9]','','g');
 if length(v_digits)=12 and left(v_digits,2)='91' then v_digits=right(v_digits,10); end if;
 if length(v_digits)<>10 then return null; end if;
 v_phone='+91'||v_digits;

 select id into v_id from public.cc_loyalty_members where right(regexp_replace(phone,'[^0-9]','','g'),10)=v_digits limit 1;
 if v_id is not null then return v_id; end if;

 v_code=public.cc_loyalty_make_code(v_phone);
 insert into public.cc_loyalty_members(name,phone,card_code,schedule,name_pending,issued_by)
  values('Pending',v_phone,v_code,'[]'::jsonb,true,auth.uid())
 on conflict (phone) do nothing
 returning id into v_id;

 if v_id is null then
  select id into v_id from public.cc_loyalty_members where phone=v_phone limit 1;
 end if;
 return v_id;
end $$;

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

  select coalesce(max((s->>'day')::int),100) into v_cycle_len from jsonb_array_elements(v_member.schedule) s;
  if v_member.stamp_count>=v_cycle_len then continue; end if;

  if exists(select 1 from public.cc_loyalty_stamp_log where member_id=v_member.id and (created_at at time zone 'Asia/Kolkata')::date=v_day) then
   continue;
  end if;

  insert into public.cc_loyalty_stamp_log(member_id,from_count,to_count,staff_name,actor)
   values(v_member.id,v_member.stamp_count,v_member.stamp_count+1,'Auto — order collected',null);
  update public.cc_loyalty_members set stamp_count=stamp_count+1,updated_at=now() where id=v_member.id;
 end loop;
 return new;
end $$;

drop trigger if exists cc_loyalty_order on public.store_orders;
create trigger cc_loyalty_order after insert or update on public.store_orders for each row execute function public.cc_loyalty_order_trigger();

notify pgrst,'reload schema';
commit;
