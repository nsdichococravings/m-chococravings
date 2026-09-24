-- Gives the "Advance Birthday Wishes" promo a real, staff-checkable offer
-- code instead of just words on a card. The SAME code that prints on the
-- poster also shows on the customer's row in the Birthday Report, so when
-- a customer turns up quoting a code, staff can look them up in the
-- report and confirm it matches before honouring it. It's also a real,
-- redeemable promo code at checkout via index.html's existing applyPromo()
-- flow (db.from('offers')...), same as every other code.
--
-- public.offers already exists in this database (created outside this
-- repo's migrations, like customers) and already backs that checkout
-- flow -- this file does NOT create or alter that table, only inserts
-- one new row into it, matching its real columns/constraints. It also
-- deliberately leaves the table's existing RLS/grants untouched, since
-- applyPromo() already reads it directly as anon/authenticated and
-- touching that could break it.
--
-- (First cut of this file assumed a table shape that doesn't match the
-- real one and errored out mid-transaction -- nothing from it ever
-- applied, confirmed via the exact error reported. Corrected in place
-- rather than as a new file, same as 20260942's customers.id fix.)
--
-- Deliberately NOT attached to the actual-birthday-date card/report row
-- -- that one stays exactly as it already is, per how it was asked for:
-- the free treat is what's redeemed that day, the code is what gets them
-- there.
-- Run this ENTIRE file as database owner AFTER 20260942_birthday_wishes_tracking.sql.
begin;
do $$ begin
 if not exists(select 1 from pg_proc where proname='cc_birthday_mark') then
  raise exception 'Run migrations/20260942_birthday_wishes_tracking.sql first.';
 end if;
 if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='offers') then
  raise exception 'public.offers not found -- is this the right database?';
 end if;
end $$;

insert into public.offers (code, name, description, type, discount_value, banner_text, emoji, show_on_home)
values (
 'NSDI-TREAT-5', 'Advance Birthday Treat',
 'Free classic brownie or ice cream on their birthday, plus 5% off if they order today.',
 'percentage', 5.00,
 'Birthday coming up? Order today for 5% off — plus a free treat on the day!', '🎂',
 false
)
on conflict (code) do nothing;

-- Adds the active advance-birthday offer's code to each UPCOMING row
-- only -- today's rows are untouched (unchanged shape/values).
create or replace function public.cc_birthday_report() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_role text=public.cc_loyalty_role(); v_today date; v_year int; v_offer_code text; v_today_rows jsonb; v_upcoming_rows jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in to view this report'; end if;
 if v_role not in ('admin','staff') then raise exception 'Staff access required'; end if;

 v_today=(now() at time zone 'Asia/Kolkata')::date;
 v_year=extract(year from v_today)::int;

 select code into v_offer_code from public.offers
  where code='NSDI-TREAT-5' and is_active
   and (valid_from is null or valid_from<=now()) and (valid_until is null or valid_until>now())
  limit 1;

 select coalesce(jsonb_agg(jsonb_build_object(
   'id',c.id,'name',c.name,'phone',c.phone,'email',c.email,'date_of_birth',c.date_of_birth,
   'wishes_sent',coalesce(w.wishes_sent,false),'card_sent',coalesce(w.card_sent,false)
  ) order by c.name), '[]'::jsonb)
 into v_today_rows
 from public.customers c
 left join public.cc_birthday_wishes w on w.customer_id=c.id and w.occurrence_year=v_year
 where c.date_of_birth is not null and to_char(c.date_of_birth,'MM-DD')=to_char(v_today,'MM-DD');

 select coalesce(jsonb_agg(x.obj order by x.days_until, x.name), '[]'::jsonb)
 into v_upcoming_rows
 from (
  select c.name, n as days_until,
   jsonb_build_object(
    'id',c.id,'name',c.name,'phone',c.phone,'email',c.email,'date_of_birth',c.date_of_birth,'days_until',n,
    'wishes_sent',coalesce(w.wishes_sent,false),'card_sent',coalesce(w.card_sent,false),
    'offer_code',v_offer_code
   ) as obj
  from public.customers c
  cross join generate_series(1,4) as n
  left join public.cc_birthday_wishes w on w.customer_id=c.id and w.occurrence_year=v_year
  where c.date_of_birth is not null and to_char(c.date_of_birth,'MM-DD')=to_char(v_today+n,'MM-DD')
 ) x;

 return jsonb_build_object('today',v_today_rows,'upcoming',v_upcoming_rows,'checked_date',v_today);
end $$;

revoke all on function public.cc_birthday_report() from public,anon,authenticated;
grant execute on function public.cc_birthday_report() to authenticated;

notify pgrst,'reload schema';
commit;
