-- NSDI Store cash pickups go into the Cash Counter.
--
-- When staff tap "Cash ₹… taken · picked up" in Manage NSDI Store, the cash
-- goes into the same drawer as NSDI Cafe cash. This adds the same amount to
-- cash_counter_entries ("NSDI Store cash — NS…-0042"), so the Cash Counter
-- balance and today's "In" include it. Online payments are not cash and are
-- not added.
--
-- Uses a trigger on grocery_payments, so it covers every cash pickup however
-- it is recorded. If cash_counter_entries doesn't exist, nothing happens and
-- the pickup still works. Safe to run more than once.
-- Roll back: drop trigger if exists grocery_cash_to_counter on public.grocery_payments;
begin;

create or replace function public.grocery_cash_to_counter() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_no text; v_staff text;
begin
 if new.method <> 'cash' or coalesce(new.amount, 0) <= 0 then return null; end if;
 if to_regclass('public.cash_counter_entries') is null then return null; end if;
 select order_no into v_no from public.grocery_orders where id = new.order_id;
 select c.name into v_staff
   from auth.users u join public.customers c on lower(c.email) = lower(u.email)
  where u.id = new.recorded_by order by c.id::text limit 1;
 insert into public.cash_counter_entries(entry_type, amount, note, staff_name)
 values ('order_payment', new.amount, 'NSDI Store cash — ' || coalesce(v_no, 'order'), coalesce(v_staff, 'Staff'));
 return null;
exception when others then
 return null; -- never block a pickup because the Cash Counter couldn't be updated
end $$;
revoke all on function public.grocery_cash_to_counter() from public, anon, authenticated;

drop trigger if exists grocery_cash_to_counter on public.grocery_payments;
create trigger grocery_cash_to_counter after insert on public.grocery_payments
 for each row execute function public.grocery_cash_to_counter();

commit;
