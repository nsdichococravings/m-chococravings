-- Loyalty cards that reach 100 total days: super admin controls.
--
-- Once a customer's lifetime total (completed_days + stamp_count) reaches
-- 100, a super admin can, from Command Center -> "Completed Loyalty Cards":
--   * hide the card from the customer's Home screen (disable),
--   * show it again (enable),
--   * reset it: back to Card 1, 0 stamps, 0 total days, no rewards given,
--     Card 1's reward schedule, and visible again.
--
-- The customer's Home reads its card through cc_loyalty_my_card(), which
-- returns the whole row, so the new home_hidden column reaches the app
-- without changing that function. Staff stamping is unchanged.
--
-- cc_loyalty_super(p_action, p_payload):
--   'check'          -> {super: true|false}   (never raises; used to show the tool)
--   'list_completed' -> {members: [...]}       optional payload.query (name/phone/code)
--   'set_visible'    -> member row             payload {member_id, visible}
--   'reset'          -> member row             payload {member_id}
-- Every action but 'check' needs a super admin (customers.is_super_user).
-- Run this ENTIRE file as database owner. Safe to run more than once.
begin;
do $$ begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='cc_loyalty_members' and column_name='completed_days') then
  raise exception 'Run the loyalty total-days migration (completed_days) first.';
 end if;
 if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='cc_loyalty_cycle_levels') then
  raise exception 'Run migrations/20260927_loyalty_card_levels.sql first.';
 end if;
 if not exists(select 1 from pg_proc where proname='cc_is_super_user') then
  raise exception 'cc_is_super_user() not found -- run the loyalty migrations first.';
 end if;
end $$;

alter table public.cc_loyalty_members add column if not exists home_hidden boolean not null default false;

create or replace function public.cc_loyalty_super(p_action text, p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare m public.cc_loyalty_members; v_q text; v_digits text; v_schedule jsonb;
begin
 if p_action='check' then
  return jsonb_build_object('super', auth.uid() is not null and coalesce(public.cc_is_super_user(),false));
 end if;
 if auth.uid() is null or not coalesce(public.cc_is_super_user(),false) then
  raise exception 'Super admin access required' using errcode='42501';
 end if;

 if p_action='list_completed' then
  v_q=btrim(coalesce(p_payload->>'query',''));
  v_digits=regexp_replace(v_q,'[^0-9]','','g');
  return jsonb_build_object('members', coalesce((
   select jsonb_agg(jsonb_build_object(
     'id',t.id,'name',t.name,'phone',t.phone,'card_code',t.card_code,'cycle',t.cycle,
     'total_days',t.completed_days+t.stamp_count,'home_hidden',t.home_hidden,
     'suspended',t.suspended,'updated_at',t.updated_at) order by t.updated_at desc)
   from public.cc_loyalty_members t
   where t.completed_days+t.stamp_count>=100
     and (v_q='' or t.name ilike '%'||v_q||'%' or upper(t.card_code)=upper(v_q)
          or (length(v_digits)>=4 and right(regexp_replace(t.phone,'[^0-9]','','g'),length(v_digits))=v_digits))
  ),'[]'::jsonb));
 end if;

 select * into m from public.cc_loyalty_members where id=(p_payload->>'member_id')::uuid for update;
 if m.id is null then raise exception 'Card not found'; end if;
 if m.completed_days+m.stamp_count<100 then raise exception 'This card has not reached 100 days yet'; end if;

 if p_action='set_visible' then
  if p_payload->'visible' is null or jsonb_typeof(p_payload->'visible')<>'boolean' then
   raise exception 'Say whether the card should be visible';
  end if;
  update public.cc_loyalty_members set home_hidden=not (p_payload->>'visible')::boolean, updated_at=now()
   where id=m.id returning * into m;
  return to_jsonb(m);

 elsif p_action='reset' then
  select schedule into v_schedule from public.cc_loyalty_cycle_levels where level=1;
  insert into public.cc_loyalty_stamp_log(member_id,from_count,to_count,staff_name,actor)
   values(m.id,m.stamp_count,0,'Reset after 100 days by super admin',auth.uid());
  update public.cc_loyalty_members set
    cycle=1, stamp_count=0, completed_days=0, redeemed_days='{}',
    schedule=coalesce(v_schedule,m.schedule), home_hidden=false, updated_at=now()
   where id=m.id returning * into m;
  return to_jsonb(m);
 end if;

 raise exception 'Unknown action: %', p_action;
end $$;

revoke all on function public.cc_loyalty_super(text,jsonb) from public,anon,authenticated;
grant execute on function public.cc_loyalty_super(text,jsonb) to authenticated;

notify pgrst,'reload schema';
commit;
