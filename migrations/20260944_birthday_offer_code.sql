-- Gives the "Advance Birthday Wishes" promo a real, staff-checkable offer
-- code instead of just words on a card. The SAME code that prints on the
-- poster also shows on the customer's row in the Birthday Report, so when
-- a customer turns up quoting a code, staff can look them up in the
-- report and confirm it matches before honouring it.
--
-- Modelled as a small generic `offers` table (not a one-off column) so a
-- future offer can be added the same way -- just another row -- without
-- another migration. `kind` is how cc_birthday_report() finds the right
-- one; there's only one kind today ('birthday_advance').
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
end $$;

create table if not exists public.offers (
 id uuid primary key default gen_random_uuid(),
 code text not null unique,
 kind text not null,
 title text not null,
 description text,
 discount_percent numeric,
 active boolean not null default true,
 created_at timestamptz not null default now()
);
alter table public.offers enable row level security;
revoke all on public.offers from public,anon,authenticated;
-- No direct grants — read only via cc_birthday_report(), same pattern as
-- every other staff-facing table in this app.

insert into public.offers (code, kind, title, description, discount_percent)
values (
 'NSDI-TREAT-5', 'birthday_advance', 'Advance Birthday Treat',
 'Free classic brownie or ice cream on their birthday, plus 5% off if they order today.',
 5
)
on conflict (code) do nothing;

-- Adds the active birthday_advance offer's code to each UPCOMING row
-- only (jsonb -||- merge, no other output shape changes) — today's rows
-- are untouched.
create or replace function public.cc_birthday_report() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_role text=public.cc_loyalty_role(); v_today date; v_year int; v_offer_code text; v_today_rows jsonb; v_upcoming_rows jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in to view this report'; end if;
 if v_role not in ('admin','staff') then raise exception 'Staff access required'; end if;

 v_today=(now() at time zone 'Asia/Kolkata')::date;
 v_year=extract(year from v_today)::int;

 select code into v_offer_code from public.offers where kind='birthday_advance' and active limit 1;

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
