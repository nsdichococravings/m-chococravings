-- On Store festive theme (festive-theme.js).
--
-- app_settings.festive_theme = 'auto' (by festival date), 'off', or a theme id
-- (diwali, christmas, newyear, pongal, tamilnewyear, valentine, independence,
-- republic, holi, ganesh, navratri). Everyone already reads app_settings;
-- only admins can change this one, through cc_set_festive_theme().
-- Run this ENTIRE file as database owner. Safe to run more than once.
begin;
do $$ begin
 if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='app_settings') then
  raise exception 'app_settings table not found -- is this the right database?';
 end if;
 if not exists(select 1 from pg_proc where proname='cc_loyalty_role') then
  raise exception 'cc_loyalty_role() not found -- run the loyalty migrations first.';
 end if;
end $$;

insert into public.app_settings(key, value) select 'festive_theme', 'auto'
 where not exists(select 1 from public.app_settings where key='festive_theme');

create or replace function public.cc_set_festive_theme(p_value text) returns text
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null or public.cc_loyalty_role() <> 'admin' then
  raise exception 'Admin access required' using errcode='42501';
 end if;
 if p_value is null or p_value not in ('auto','off','diwali','christmas','newyear','pongal','tamilnewyear',
   'valentine','independence','republic','holi','ganesh','navratri') then
  raise exception 'Unknown theme';
 end if;
 update public.app_settings set value=p_value where key='festive_theme';
 if not found then insert into public.app_settings(key, value) values('festive_theme', p_value); end if;
 return p_value;
end $$;

revoke all on function public.cc_set_festive_theme(text) from public, anon;
grant execute on function public.cc_set_festive_theme(text) to authenticated;

notify pgrst,'reload schema';
commit;
