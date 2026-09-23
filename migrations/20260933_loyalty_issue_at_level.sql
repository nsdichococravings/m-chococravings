-- Issuing a new card always started the customer on Card 1 -- no way to
-- issue directly onto Card 3 or Card 4 for a customer who should start
-- further along (e.g. matching a physical card number they already
-- hold, or a VIP starting point). Adds an optional starting card
-- number to "issue", alongside the existing starting stamp count --
-- defaults to Card 1 (unchanged) when omitted.
-- Run this ENTIRE file as database owner AFTER 20260931_loyalty_delete_member.sql.
begin;
do $$ begin
 if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='cc_loyalty_cycle_levels') then
  raise exception 'Run migrations/20260927_loyalty_card_levels.sql first.';
 end if;
end $$;

create or replace function public.cc_loyalty_command(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare role text=public.cc_loyalty_role(); m public.cc_loyalty_members; v_code text; v_phone text; v_count integer; v_day integer; v_query text; v_digits text; v_level int; v_schedule jsonb; v_updated integer; v_cycle_len integer; v_rows jsonb;
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
  v_level=coalesce((p_payload->>'cycle')::int,1);
  if v_level<1 then raise exception 'Enter a card number of 1 or more'; end if;
  v_count=coalesce((p_payload->>'starting_stamps')::int,0);
  if v_count<0 or v_count>100 then raise exception 'Starting stamp count must be from 0 to 100'; end if;
  select schedule into v_schedule from public.cc_loyalty_cycle_levels where level=v_level;
  v_code=public.cc_loyalty_make_code(v_phone);
  insert into public.cc_loyalty_members(name,phone,card_code,cycle,schedule,stamp_count,issued_by)
   values(btrim(p_payload->>'name'),v_phone,v_code,v_level,coalesce(v_schedule,'[]'::jsonb),v_count,auth.uid()) returning * into m;
  if v_count>0 then
   insert into public.cc_loyalty_stamp_log(member_id,from_count,to_count,staff_name,actor)
    values(m.id,0,v_count,'Issued with existing physical-card progress',auth.uid());
  end if;
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
  select coalesce(max((s->>'day')::int),100) into v_cycle_len from jsonb_array_elements(m.schedule) s;
  if m.stamp_count<v_cycle_len then raise exception 'This card has not reached day % yet', v_cycle_len; end if;
  select schedule into v_schedule from public.cc_loyalty_cycle_levels where level=m.cycle+1;
  update public.cc_loyalty_members set
   cycle=cycle+1, stamp_count=0, redeemed_days='{}',
   completed_days=completed_days+v_cycle_len,
   schedule=coalesce(v_schedule, m.schedule),
   updated_at=now()
   where id=m.id returning * into m;
  return to_jsonb(m);

 elsif p_action='set_cycle' then
  if role<>'admin' then raise exception 'Admin access required'; end if;
  select * into m from public.cc_loyalty_members where id=(p_payload->>'member_id')::uuid for update;
  if m.id is null then raise exception 'Member not found'; end if;
  if m.suspended then raise exception 'This membership is suspended'; end if;
  v_level=(p_payload->>'cycle')::int;
  if v_level is null or v_level<1 then raise exception 'Enter a card number of 1 or more'; end if;
  v_count=coalesce((p_payload->>'stamp_count')::int,0);
  if v_count<0 or v_count>100 then raise exception 'Enter a stamp count from 0 to 100'; end if;
  select schedule into v_schedule from public.cc_loyalty_cycle_levels where level=v_level;
  insert into public.cc_loyalty_stamp_log(member_id,from_count,to_count,staff_name,actor)
   values(m.id,m.stamp_count,v_count,'Moved to Card '||v_level,auth.uid());
  update public.cc_loyalty_members set
   cycle=v_level, stamp_count=v_count, redeemed_days='{}',
   schedule=coalesce(v_schedule, m.schedule),
   updated_at=now()
   where id=m.id returning * into m;
  return to_jsonb(m);

 elsif p_action='delete_member' then
  if not public.cc_is_super_user() then raise exception 'Super admin access required'; end if;
  select * into m from public.cc_loyalty_members where id=(p_payload->>'member_id')::uuid for update;
  if m.id is null then raise exception 'Member not found'; end if;
  delete from public.cc_loyalty_stamp_log where member_id=m.id;
  delete from public.cc_loyalty_members where id=m.id;
  return jsonb_build_object('deleted',true,'name',m.name,'card_code',m.card_code);

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

 elsif p_action='list_cycle_levels' then
  select coalesce(jsonb_agg(to_jsonb(l) order by l.level), '[]'::jsonb) into v_rows from public.cc_loyalty_cycle_levels l;
  return jsonb_build_object('levels', v_rows);

 elsif p_action='set_cycle_level' then
  if not public.cc_is_super_user() then raise exception 'Super admin access required'; end if;
  v_level=(p_payload->>'level')::int;
  if v_level is null or v_level<1 then raise exception 'Enter a card number of 1 or more'; end if;
  if not public.cc_loyalty_schedule(p_payload->'schedule') then raise exception 'Choose valid menu items and unique milestone days from 1 to 100'; end if;
  insert into public.cc_loyalty_cycle_levels(level,schedule,updated_by,updated_at)
   values(v_level,p_payload->'schedule',auth.uid(),now())
   on conflict (level) do update set schedule=excluded.schedule,updated_by=excluded.updated_by,updated_at=excluded.updated_at
   returning to_jsonb(cc_loyalty_cycle_levels.*) into v_schedule;
  return v_schedule;

 elsif p_action='apply_level_to_cards' then
  if not public.cc_is_super_user() then raise exception 'Super admin access required'; end if;
  v_level=(p_payload->>'level')::int;
  if v_level is null or v_level<1 then raise exception 'Enter a card number of 1 or more'; end if;
  select schedule into v_schedule from public.cc_loyalty_cycle_levels where level=v_level;
  if v_schedule is null then raise exception 'Set Card % first', v_level; end if;
  update public.cc_loyalty_members set schedule=v_schedule,updated_at=now() where cycle=v_level;
  get diagnostics v_updated = row_count;
  return jsonb_build_object('updated', v_updated, 'level', v_level);

 else raise exception 'Unknown loyalty action'; end if;
end $$;

revoke all on function public.cc_loyalty_command(text,jsonb) from public,anon,authenticated;
grant execute on function public.cc_loyalty_command(text,jsonb) to authenticated;

notify pgrst,'reload schema';
commit;
