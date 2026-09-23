-- cc_loyalty_my_card() matched a customer's card with a bare `limit 1`
-- and no ordering -- if a customer somehow has more than one
-- cc_loyalty_members row sharing the same phone (last 10 digits), that
-- query could keep returning an OLD, untouched row forever, while staff
-- edits (including the new "Move to a different card") land on a
-- DIFFERENT row surfaced through Lookup -- exactly the bug just seen:
-- staff moved a customer to Card 2 and it stuck on the staff side, but
-- the customer's own Home page kept showing Card 1 even after a real
-- refresh, because it was reading a different, stale row for the same
-- phone number.
--
-- This makes the customer's own view always follow whichever matching
-- card staff most recently touched -- it doesn't find or remove any
-- duplicate row itself; use Loyalty Cards -> Lookup with the customer's
-- phone number to check for and clean up a duplicate ("Multiple cards
-- match" means there is one).
-- Run this ENTIRE file as database owner AFTER 20260924_loyalty_my_card.sql.
begin;
do $$ begin
 if not exists(select 1 from pg_proc where proname='cc_loyalty_my_card') then
  raise exception 'Run migrations/20260924_loyalty_my_card.sql first.';
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
  order by updated_at desc
  limit 1;
 if m.id is null then return null; end if;

 return to_jsonb(m) - 'issued_by' - 'id';
end $$;

revoke all on function public.cc_loyalty_my_card() from public,anon,authenticated;
grant execute on function public.cc_loyalty_my_card() to authenticated;

notify pgrst,'reload schema';
commit;
