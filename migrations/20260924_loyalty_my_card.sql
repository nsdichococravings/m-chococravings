-- Lets a signed-in customer read their OWN Loyalty Card (stamp count,
-- reward schedule, redeemed milestones) from the customer app's Home
-- page. Everything about cc_loyalty_members stays staff/admin-only via
-- cc_loyalty_command (20260921d_loyalty_cards.sql) -- this adds one
-- narrow, self-scoped read path alongside it: a customer can only ever
-- see the card matching their own signed-in identity, never anyone
-- else's, and never by passing a phone number of their choosing.
-- Run this ENTIRE file as database owner AFTER 20260921d_loyalty_cards.sql.
begin;
do $$ begin
 if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='cc_loyalty_members') then
  raise exception 'Run migrations/20260921d_loyalty_cards.sql first — Loyalty Cards is not installed yet.';
 end if;
end $$;

create or replace function public.cc_loyalty_my_card() returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_phone text; m public.cc_loyalty_members;
begin
 if auth.uid() is null then raise exception 'Sign in to view your loyalty card'; end if;

 select c.phone into v_phone from auth.users u join public.customers c on lower(c.email)=lower(u.email)
  where u.id=auth.uid() and u.email_confirmed_at is not null limit 1;
 if v_phone is null or length(regexp_replace(v_phone,'[^0-9]','','g'))<10 then return null; end if;

 select * into m from public.cc_loyalty_members
  where right(regexp_replace(phone,'[^0-9]','','g'),10) = right(regexp_replace(v_phone,'[^0-9]','','g'),10)
  limit 1;
 if m.id is null then return null; end if;

 return to_jsonb(m) - 'issued_by' - 'id';
end $$;

revoke all on function public.cc_loyalty_my_card() from public,anon,authenticated;
grant execute on function public.cc_loyalty_my_card() to authenticated;

notify pgrst,'reload schema';
commit;
