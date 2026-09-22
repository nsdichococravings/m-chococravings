-- Loyalty Cards: auto-created cards. Staff no longer has to open Loyalty
-- Cards and "Issue" a card before a new customer's visit counts — the
-- moment staff enters a phone number on a table order (as customer_phone
-- or in the group list), a pending card is created automatically, with
-- stamps counting from day one. Staff fills in the name (and, admin
-- only, the reward schedule) afterward via the "Add name" button that
-- shows on the Kitchen ticket for any pending card.
--
-- Reconstructed from tests/auto-loyalty.test.cjs, which was already
-- committed and specifies this migration's exact behavior, but the
-- migration file itself was never committed.
-- Run this ENTIRE file as database owner AFTER 20260922_group_loyalty.sql.
begin;
do $$ begin
 if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='cc_loyalty_members') then
  raise exception 'Run migrations/20260921d_loyalty_cards.sql first — Loyalty Cards is not installed yet.';
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

-- Extends the order trigger once more: before the existing stamping
-- logic, auto-creates a pending card for every phone on the order that
-- doesn't have one yet. Runs on every insert/update (not just
-- collection) so the card — and its stamp — shows up in Kitchen right
-- away. Gated to staff/admin-authored writes only, same as the group-
-- phones rule, so a customer's own self-checkout order never silently
-- enrols them (or anyone else) without staff involvement.
create or replace function public.cc_loyalty_order_trigger() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_member public.cc_loyalty_members; v_day date; v_phone text; v_phones jsonb; v_digits text; v_role text=public.cc_loyalty_role();
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
  if v_member.id is null or v_member.stamp_count>=100 then continue; end if;

  if exists(select 1 from public.cc_loyalty_stamp_log where member_id=v_member.id and (created_at at time zone 'Asia/Kolkata')::date=v_day) then
   continue;
  end if;

  insert into public.cc_loyalty_stamp_log(member_id,from_count,to_count,staff_name,actor)
   values(v_member.id,v_member.stamp_count,v_member.stamp_count+1,'Auto — order collected',null);
  update public.cc_loyalty_members set stamp_count=stamp_count+1,updated_at=now() where id=v_member.id;
 end loop;
 return new;
end $$;

-- Staff-facing profile completion for a pending card, and an on-demand
-- backfill for orders whose phones didn't get auto-created for any
-- reason (e.g. placed before this migration existed).
create or replace function public.cc_loyalty_profile(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare role text=public.cc_loyalty_role(); m public.cc_loyalty_members; v_name text; v_order record; v_phone text;
begin
 if auth.uid() is null then raise exception 'Sign in to use Loyalty Cards'; end if;
 if role not in ('admin','staff') then raise exception 'Staff access required'; end if;

 if p_action='save' then
  select * into m from public.cc_loyalty_members where id=(p_payload->>'member_id')::uuid for update;
  if m.id is null then raise exception 'Member not found'; end if;
  v_name=btrim(coalesce(p_payload->>'name',''));
  if v_name='' then raise exception 'Enter a name for this customer'; end if;

  if p_payload->'schedule' is not null then
   if role<>'admin' then raise exception 'Only admin can set the reward schedule'; end if;
   if not public.cc_loyalty_schedule(p_payload->'schedule') then raise exception 'Choose valid menu items and unique milestone days from 1 to 100'; end if;
   update public.cc_loyalty_members set name=v_name,name_pending=false,schedule=p_payload->'schedule',updated_at=now() where id=m.id returning * into m;
  else
   update public.cc_loyalty_members set name=v_name,name_pending=false,updated_at=now() where id=m.id returning * into m;
  end if;
  return to_jsonb(m);

 elsif p_action='ensure_orders' then
  if jsonb_typeof(p_payload->'ids')<>'array' then raise exception 'ids must be an array'; end if;
  for v_order in
   select id,customer_phone,customer_group_phones from public.store_orders
   where id in (select value::uuid from jsonb_array_elements_text(p_payload->'ids'))
  loop
   if v_order.customer_phone is not null then perform public.cc_loyalty_ensure_member(v_order.customer_phone); end if;
   for v_phone in select value from jsonb_array_elements_text(coalesce(v_order.customer_group_phones,'[]'::jsonb)) loop
    perform public.cc_loyalty_ensure_member(v_phone);
   end loop;
  end loop;
  return jsonb_build_object('ok',true);

 else raise exception 'Unknown loyalty profile action'; end if;
end $$;

revoke all on function public.cc_loyalty_profile(text,jsonb) from public,anon,authenticated;
grant execute on function public.cc_loyalty_profile(text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
