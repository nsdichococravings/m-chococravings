-- Loyalty Cards: automatic stamping. When an order with a customer
-- phone number is collected and paid (or complimentary), and that
-- phone matches an existing loyalty card, add one stamp automatically
-- - no staff action needed. Stamps at most once per business day per
-- member, however many orders they place that day, and never past 100
-- (staff completes the cycle explicitly once a card is full).
--
-- This is a database trigger on store_orders, not a hook in any one
-- "collect payment" button, so it fires no matter which code path
-- marks an order collected (table bill collection, item-level partial
-- collection, walk-in collection...) without needing every one of
-- those call sites updated by hand.
--
-- Staff can still open Loyalty Cards and set/correct a count by hand
-- at any time - this only adds the routine "each visit" case.
-- Run this ENTIRE file as database owner AFTER 20260921d_loyalty_cards.sql.
begin;
do $$ begin
 if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='cc_loyalty_members') then
  raise exception 'Run migrations/20260921d_loyalty_cards.sql first — Loyalty Cards is not installed yet.';
 end if;
end $$;

create or replace function public.cc_loyalty_order_trigger() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_member public.cc_loyalty_members; v_day date; v_digits text;
begin
 if new.customer_phone is null then return new; end if;
 if not (new.status='collected' and new.payment_status in ('paid','complimentary')) then return new; end if;
 if tg_op='UPDATE' and old.status=new.status and old.payment_status=new.payment_status then return new; end if;

 v_digits=regexp_replace(new.customer_phone,'[^0-9]','','g');
 if length(v_digits)<10 then return new; end if;

 select * into v_member from public.cc_loyalty_members
  where right(regexp_replace(phone,'[^0-9]','','g'),10)=right(v_digits,10) and not suspended
  limit 1;
 if v_member.id is null then return new; end if;
 if v_member.stamp_count>=100 then return new; end if;

 v_day=(now() at time zone 'Asia/Kolkata')::date;
 if exists(select 1 from public.cc_loyalty_stamp_log where member_id=v_member.id and (created_at at time zone 'Asia/Kolkata')::date=v_day) then
  return new; -- already stamped today, whatever order triggered it
 end if;

 insert into public.cc_loyalty_stamp_log(member_id,from_count,to_count,staff_name,actor)
  values(v_member.id,v_member.stamp_count,v_member.stamp_count+1,'Auto — order collected',null);
 update public.cc_loyalty_members set stamp_count=stamp_count+1,updated_at=now() where id=v_member.id;
 return new;
end $$;

drop trigger if exists cc_loyalty_order on public.store_orders;
create trigger cc_loyalty_order after insert or update on public.store_orders for each row execute function public.cc_loyalty_order_trigger();

notify pgrst,'reload schema';
commit;
