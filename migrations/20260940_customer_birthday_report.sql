-- Staff-facing report: which customers have a birthday today, and
-- which have one coming up in the next 4 days -- so staff can
-- proactively wish them or prep something, without anyone having to
-- remember to check a spreadsheet by hand.
--
-- "Runs automatically" here means the same thing every other staff
-- alert in this app already means: the moment an admin/staff opens
-- the app, birthday-report-patch.js calls this and surfaces a toast
-- if there's anything to report -- there is no server-side cron
-- anywhere in this app (confirmed: nothing in migrations/ touches
-- pg_cron), so this deliberately matches the existing new-order-chime
-- pattern rather than requiring pg_cron/Edge Functions, which aren't
-- guaranteed available on every Supabase plan.
--
-- Matches on month+day only (to_char 'MM-DD'), so it works across
-- year boundaries (a Dec 29 birthday with a 4-day window correctly
-- includes Jan 2). A customer born on Feb 29 simply won't match in a
-- non-leap year -- deliberately not special-cased, not worth the
-- complexity for a report like this.
-- Run this ENTIRE file as database owner AFTER 20260921d_loyalty_cards.sql
-- (reuses cc_loyalty_role() for the same admin/staff access tier
-- Loyalty Cards already uses).
begin;
do $$ begin
 if not exists(select 1 from pg_proc where proname='cc_loyalty_role') then
  raise exception 'Run migrations/20260921d_loyalty_cards.sql first.';
 end if;
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='customers' and column_name='date_of_birth') then
  raise exception 'customers.date_of_birth column not found -- is this the right database?';
 end if;
end $$;

create or replace function public.cc_birthday_report() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_role text=public.cc_loyalty_role(); v_today date; v_today_rows jsonb; v_upcoming_rows jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in to view this report'; end if;
 if v_role not in ('admin','staff') then raise exception 'Staff access required'; end if;

 v_today=(now() at time zone 'Asia/Kolkata')::date;

 select coalesce(jsonb_agg(jsonb_build_object(
   'id',c.id,'name',c.name,'phone',c.phone,'email',c.email,'date_of_birth',c.date_of_birth
  ) order by c.name), '[]'::jsonb)
 into v_today_rows
 from public.customers c
 where c.date_of_birth is not null and to_char(c.date_of_birth,'MM-DD')=to_char(v_today,'MM-DD');

 select coalesce(jsonb_agg(x.obj order by x.days_until, x.name), '[]'::jsonb)
 into v_upcoming_rows
 from (
  select c.name, n as days_until,
   jsonb_build_object('id',c.id,'name',c.name,'phone',c.phone,'email',c.email,'date_of_birth',c.date_of_birth,'days_until',n) as obj
  from public.customers c
  cross join generate_series(1,4) as n
  where c.date_of_birth is not null and to_char(c.date_of_birth,'MM-DD')=to_char(v_today+n,'MM-DD')
 ) x;

 return jsonb_build_object('today',v_today_rows,'upcoming',v_upcoming_rows,'checked_date',v_today);
end $$;

revoke all on function public.cc_birthday_report() from public,anon,authenticated;
grant execute on function public.cc_birthday_report() to authenticated;

notify pgrst,'reload schema';
commit;
