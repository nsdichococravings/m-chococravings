-- NSDI Store: online payments are confirmed with Razorpay before an order is paid.
--
-- Before: grocery_record_payment() was callable by any signed-in customer
-- and marked their order paid using whatever payment id the browser sent.
-- A made-up id would have placed the order as paid.
--
-- Now: the grocery-payment edge function asks Razorpay for the payment,
-- checks it is captured, belongs to the Razorpay order made for THIS store
-- order (its notes.order_number / receipt), and is for the order total.
-- Only then it calls grocery_record_verified_payment() (service_role only),
-- which does what grocery_record_payment did: place the order, take the
-- stock, or mark a refund due if the hold ran out and the stock was sold.
--
-- grocery_record_payment() is no longer callable by customers or staff.
-- Run this ENTIRE file as database owner AFTER 20261104_grocery_store.sql.
-- Safe to run more than once.
begin;
do $$ begin
 if not exists(select 1 from pg_proc where proname='grocery_record_payment') then
  raise exception 'Run migrations/20261104_grocery_store.sql first.';
 end if;
end $$;

revoke all on function public.grocery_record_payment(uuid,text,text) from public, anon, authenticated;

create or replace function public.grocery_record_verified_payment(p_user uuid, p_order_id uuid, p_payment_id text,
 p_rzp_order_id text, p_paise bigint, p_order_ref text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.grocery_orders; i record; v_other uuid; ok boolean := true;
begin
 if p_user is null then raise exception 'Please sign in' using errcode='42501'; end if;
 if coalesce(length(p_payment_id),0) not between 6 and 64 then raise exception 'Missing payment id'; end if;
 select * into o from public.grocery_orders where id=p_order_id for update;
 if o.id is null or o.user_id <> p_user then raise exception 'Order not found'; end if;
 select order_id into v_other from public.grocery_payments where rzp_payment_id=p_payment_id;
 if v_other is not null then
  if v_other <> o.id then raise exception 'This payment belongs to another order'; end if;
  return public.grocery_order_json(o);                     -- already recorded
 end if;
 if o.payment_method <> 'online' then raise exception 'This order is Cash at pickup'; end if;
 if o.payment_status <> 'pending' then raise exception 'This order is already paid'; end if;
 -- The Razorpay order must have been made for this store order, for its total
 -- (the app asks for the total rounded to whole rupees, at least ₹1).
 -- A Razorpay order with no reference is accepted (amount and one-use payment id still apply).
 if p_order_ref is not null and p_order_ref <> o.order_no then raise exception 'This payment was not made for this order'; end if;
 if p_paise <> greatest(1, round(o.total))::bigint * 100 then raise exception 'Paid amount does not match this order'; end if;

 insert into public.grocery_payments(order_id, method, amount, rzp_payment_id, rzp_order_id, recorded_by)
 values (o.id, 'online', o.total, p_payment_id, p_rzp_order_id, p_user);

 if o.status = 'awaiting_payment' then
  for i in select product_id, qty from public.grocery_order_items where order_id=o.id order by product_id loop
   if not public.grocery_move_stock(i.product_id, 'sale', i.qty, o.id, null) then raise exception 'Stock record is out of step for this order. Please tell the outlet.'; end if;
  end loop;
  update public.grocery_orders set status='placed', payment_status='paid', paid_at=now(), hold_until=null,
    rzp_order_id=coalesce(p_rzp_order_id, rzp_order_id), updated_at=now() where id=o.id returning * into o;
  perform public.grocery_log(o.id, 'paid', p_payment_id);
 else
  -- Paid after the hold ran out: keep the order if the packs are still free, otherwise refund.
  if o.status = 'expired' then
   for i in select product_id, qty from public.grocery_order_items where order_id=o.id order by product_id loop
    if ok and not public.grocery_move_stock(i.product_id, 'sale_direct', i.qty, o.id, 'late payment') then ok := false; end if;
   end loop;
  else ok := false; end if;
  if ok then
   update public.grocery_orders set status='placed', payment_status='paid', paid_at=now(), closed_at=null, cancel_reason=null,
     rzp_order_id=coalesce(p_rzp_order_id, rzp_order_id), updated_at=now() where id=o.id returning * into o;
   perform public.grocery_log(o.id, 'paid', 'late payment, stock still free');
  else
   raise exception using message = 'LATE_PAYMENT', errcode = 'P0002';
  end if;
 end if;
 return public.grocery_order_json(o);
exception when sqlstate 'P0002' then
 -- The insert above was rolled back with the exception; record the payment again so staff can refund it.
 insert into public.grocery_payments(order_id, method, amount, rzp_payment_id, rzp_order_id, recorded_by)
 values (o.id, 'online', o.total, p_payment_id, p_rzp_order_id, p_user);
 update public.grocery_orders set payment_status='refund_due', paid_at=now(), updated_at=now(),
   cancel_reason=coalesce(cancel_reason,'') || ' · Paid after the hold ran out and the stock was sold. Refund due.'
  where id=o.id returning * into o;
 perform public.grocery_log(o.id, 'refund_due', 'late payment, stock gone');
 return public.grocery_order_json(o);
end $$;

revoke all on function public.grocery_record_verified_payment(uuid,uuid,text,text,bigint,text) from public, anon, authenticated;
do $$ begin
 if exists(select 1 from pg_roles where rolname='service_role') then
  grant execute on function public.grocery_record_verified_payment(uuid,uuid,text,text,bigint,text) to service_role;
 end if;
end $$;

notify pgrst,'reload schema';
commit;
