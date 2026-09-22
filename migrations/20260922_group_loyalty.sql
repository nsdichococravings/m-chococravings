-- Loyalty Cards: shared-table groups. Staff can list dining companions'
-- phone numbers directly on a table order (customer_group_phones) so
-- everyone in the group gets stamped when the bill is collected, not
-- just the one phone number captured as customer_phone.
--
-- Reconstructed from tests/group-loyalty.test.cjs, which was already
-- committed and specifies this migration's exact behavior, but the
-- migration file itself was never committed.
-- Run this ENTIRE file as database owner AFTER 20260921g_loyalty_auto_stamp.sql.
begin;
do $$ begin
 if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='cc_loyalty_members') then
  raise exception 'Run migrations/20260921d_loyalty_cards.sql first — Loyalty Cards is not installed yet.';
 end if;
end $$;

alter table public.store_orders add column if not exists customer_group_phones jsonb not null default '[]'::jsonb;

-- Normalizes every entry to +91XXXXXXXXXX, dedupes, and rejects
-- anything that isn't a real 10-digit number. Only a staff/admin-
-- authored write may set a non-empty list — a customer placing their
-- own order can never add other people to it. Once an order is
-- collected or cancelled, its group list is frozen.
create or replace function public.cc_loyalty_group_phones_trigger() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_phones jsonb='[]'::jsonb; v_seen text[]='{}'; v_raw text; v_digits text; v_phone text; v_role text=public.cc_loyalty_role();
begin
 if jsonb_typeof(new.customer_group_phones) is distinct from 'array' then new.customer_group_phones='[]'::jsonb; end if;

 for v_raw in select value from jsonb_array_elements_text(new.customer_group_phones) loop
  v_digits=regexp_replace(v_raw,'[^0-9]','','g');
  if length(v_digits)=12 and left(v_digits,2)='91' then v_digits=right(v_digits,10); end if;
  if length(v_digits)<>10 then raise exception 'Each group phone number must contain 10 digits'; end if;
  v_phone='+91'||v_digits;
  if not v_phone=any(v_seen) then
   v_seen=array_append(v_seen,v_phone);
   v_phones=v_phones||to_jsonb(v_phone);
  end if;
 end loop;
 new.customer_group_phones=v_phones;

 if jsonb_array_length(v_phones)>0 and v_role not in ('staff','admin') then
  raise exception 'Only staff can add other customers to an order';
 end if;

 if tg_op='UPDATE' and old.status in ('collected','cancelled') and old.customer_group_phones is distinct from new.customer_group_phones then
  raise exception 'This order is closed — group phones can no longer be changed';
 end if;

 return new;
end $$;

drop trigger if exists cc_loyalty_group_phones on public.store_orders;
create trigger cc_loyalty_group_phones before insert or update on public.store_orders
 for each row execute function public.cc_loyalty_group_phones_trigger();

-- Extends the auto-stamp trigger (20260921g) to stamp every phone on
-- the order — customer_phone plus the whole group — not just
-- customer_phone alone. Same once-per-business-day dedup as before,
-- applied per member independently.
create or replace function public.cc_loyalty_order_trigger() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_member public.cc_loyalty_members; v_day date; v_phone text; v_phones jsonb; v_digits text;
begin
 if not (new.status='collected' and new.payment_status in ('paid','complimentary')) then return new; end if;
 if tg_op='UPDATE' and old.status=new.status and old.payment_status=new.payment_status then return new; end if;

 v_phones=coalesce(new.customer_group_phones,'[]'::jsonb);
 if new.customer_phone is not null then v_phones=v_phones||jsonb_build_array(new.customer_phone); end if;
 v_day=(now() at time zone 'Asia/Kolkata')::date;

 for v_phone in select value from jsonb_array_elements_text(v_phones) loop
  v_digits=regexp_replace(v_phone,'[^0-9]','','g');
  if length(v_digits)<10 then continue; end if;

  select * into v_member from public.cc_loyalty_members
   where right(regexp_replace(phone,'[^0-9]','','g'),10)=right(v_digits,10) and not suspended
   limit 1;
  if v_member.id is null or v_member.stamp_count>=100 then continue; end if;

  if exists(select 1 from public.cc_loyalty_stamp_log where member_id=v_member.id and (created_at at time zone 'Asia/Kolkata')::date=v_day) then
   continue; -- this member already got today's stamp, from this order or another
  end if;

  insert into public.cc_loyalty_stamp_log(member_id,from_count,to_count,staff_name,actor)
   values(v_member.id,v_member.stamp_count,v_member.stamp_count+1,'Auto — order collected',null);
  update public.cc_loyalty_members set stamp_count=stamp_count+1,updated_at=now() where id=v_member.id;
 end loop;
 return new;
end $$;

notify pgrst,'reload schema';
commit;
