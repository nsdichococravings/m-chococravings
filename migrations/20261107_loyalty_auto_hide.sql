-- Loyalty cards hide themselves from the customer's Home at 100 days.
--
-- When a card's lifetime total (completed_days + stamp_count) goes from
-- under 100 to 100 or more, home_hidden is switched on. A super admin
-- can still show it again from Command Center -> Completed Loyalty Cards;
-- it then stays shown, because the rule only fires when a card crosses
-- 100, not on every update. Reset brings the card back under 100, so it
-- hides again the next time it reaches 100.
--
-- The first run also hides cards that are already at 100 or more.
-- Running the file again does not re-hide cards a super admin showed.
-- Run this ENTIRE file as database owner AFTER
-- 20261106_loyalty_completed_controls.sql.
begin;
do $$ begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='cc_loyalty_members' and column_name='home_hidden') then
  raise exception 'Run migrations/20261106_loyalty_completed_controls.sql first.';
 end if;
end $$;

-- One-time catch-up for cards already past 100 (only before the rule exists).
do $$ begin
 if not exists(select 1 from pg_trigger where tgname='cc_loyalty_auto_hide' and tgrelid='public.cc_loyalty_members'::regclass) then
  update public.cc_loyalty_members set home_hidden=true
   where completed_days+stamp_count>=100 and not home_hidden;
 end if;
end $$;

create or replace function public.cc_loyalty_auto_hide() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
 if new.completed_days+new.stamp_count>=100
    and (tg_op='INSERT' or old.completed_days+old.stamp_count<100) then
  new.home_hidden=true;
 end if;
 return new;
end $$;

drop trigger if exists cc_loyalty_auto_hide on public.cc_loyalty_members;
create trigger cc_loyalty_auto_hide before insert or update on public.cc_loyalty_members
 for each row execute function public.cc_loyalty_auto_hide();

notify pgrst,'reload schema';
commit;
