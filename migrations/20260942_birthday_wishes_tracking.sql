-- Tracks whether staff has already wished a customer / sent them a
-- birthday card THIS year -- so the birthday report can show at a
-- glance who's still owed a wish today, and nobody gets double-wished
-- or missed. Keyed by (customer_id, occurrence_year) rather than a
-- plain boolean on the customer, so it automatically resets itself
-- next year without any cleanup job -- this year's "done" never
-- carries over to next year's birthday.
-- Run this ENTIRE file as database owner AFTER 20260940_customer_birthday_report.sql.
begin;
do $$ begin
 if not exists(select 1 from pg_proc where proname='cc_birthday_report') then
  raise exception 'Run migrations/20260940_customer_birthday_report.sql first.';
 end if;
end $$;

create table if not exists public.cc_birthday_wishes (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references public.customers(id),
 occurrence_year int not null,
 wishes_sent boolean not null default false,
 wishes_sent_at timestamptz,
 wishes_sent_by uuid references auth.users(id),
 card_sent boolean not null default false,
 card_sent_at timestamptz,
 card_sent_by uuid references auth.users(id),
 updated_at timestamptz not null default now(),
 unique (customer_id, occurrence_year)
);
alter table public.cc_birthday_wishes enable row level security;
revoke all on public.cc_birthday_wishes from public,anon,authenticated;
-- No direct grants — every read/write goes through cc_birthday_report /
-- cc_birthday_mark below, same as every other staff table in this app.

create or replace function public.cc_birthday_report() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_role text=public.cc_loyalty_role(); v_today date; v_year int; v_today_rows jsonb; v_upcoming_rows jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in to view this report'; end if;
 if v_role not in ('admin','staff') then raise exception 'Staff access required'; end if;

 v_today=(now() at time zone 'Asia/Kolkata')::date;
 v_year=extract(year from v_today)::int;

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
    'wishes_sent',coalesce(w.wishes_sent,false),'card_sent',coalesce(w.card_sent,false)
   ) as obj
  from public.customers c
  cross join generate_series(1,4) as n
  left join public.cc_birthday_wishes w on w.customer_id=c.id and w.occurrence_year=v_year
  where c.date_of_birth is not null and to_char(c.date_of_birth,'MM-DD')=to_char(v_today+n,'MM-DD')
 ) x;

 return jsonb_build_object('today',v_today_rows,'upcoming',v_upcoming_rows,'checked_date',v_today);
end $$;

-- Toggles wishes_sent or card_sent for a customer's CURRENT year
-- occurrence — creates the tracking row on first use (upsert).
create or replace function public.cc_birthday_mark(p_customer_id uuid, p_field text, p_value boolean) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_role text=public.cc_loyalty_role(); v_year int; v_row public.cc_birthday_wishes;
begin
 if auth.uid() is null then raise exception 'Sign in to use this'; end if;
 if v_role not in ('admin','staff') then raise exception 'Staff access required'; end if;
 if p_field not in ('wishes_sent','card_sent') then raise exception 'Unknown field'; end if;
 if not exists(select 1 from public.customers where id=p_customer_id) then raise exception 'Customer not found'; end if;

 v_year=extract(year from (now() at time zone 'Asia/Kolkata'))::int;

 insert into public.cc_birthday_wishes(customer_id,occurrence_year) values(p_customer_id,v_year)
  on conflict (customer_id,occurrence_year) do nothing;

 if p_field='wishes_sent' then
  update public.cc_birthday_wishes set
   wishes_sent=p_value,
   wishes_sent_at=case when p_value then now() else null end,
   wishes_sent_by=case when p_value then auth.uid() else null end,
   updated_at=now()
   where customer_id=p_customer_id and occurrence_year=v_year returning * into v_row;
 else
  update public.cc_birthday_wishes set
   card_sent=p_value,
   card_sent_at=case when p_value then now() else null end,
   card_sent_by=case when p_value then auth.uid() else null end,
   updated_at=now()
   where customer_id=p_customer_id and occurrence_year=v_year returning * into v_row;
 end if;

 return to_jsonb(v_row);
end $$;

revoke all on function public.cc_birthday_report() from public,anon,authenticated;
grant execute on function public.cc_birthday_report() to authenticated;
revoke all on function public.cc_birthday_mark(uuid,text,boolean) from public,anon,authenticated;
grant execute on function public.cc_birthday_mark(uuid,text,boolean) to authenticated;

notify pgrst,'reload schema';
commit;
