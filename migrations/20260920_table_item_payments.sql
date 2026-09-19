-- Item-level table payment ledger. Run on the existing store database.
begin;
alter table public.store_orders add column if not exists paid_amount numeric not null default 0;
alter table public.store_orders add column if not exists paid_item_quantities jsonb not null default '{}';
alter table public.store_orders add column if not exists payment_split jsonb;
create table if not exists public.cc_table_payments (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.store_orders(id),
 command_key uuid not null unique, payload jsonb not null,
 amount numeric not null check(amount>0 and amount<100000000),
 allocations jsonb not null, payment_split jsonb not null,
 collected_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create index if not exists cc_table_payments_order on public.cc_table_payments(order_id);
create or replace function public.cc_table_payment_access() returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select auth.uid() is not null and (
   coalesce(public.cc_production_role() in ('admin','sales'),false) or exists(
    select 1 from auth.users u join public.customers c on lower(c.email)=lower(u.email)
    where u.id=auth.uid() and u.email_confirmed_at is not null and
      coalesce((to_jsonb(c)->>'is_employee')::boolean,false)))
$$;
create or replace function public.cc_table_items(p_items jsonb) returns jsonb
language sql immutable set search_path=pg_catalog as $$
 select case when jsonb_typeof(p_items)='string' then (p_items#>>'{}')::jsonb else p_items end
$$;
alter table public.cc_table_payments enable row level security;
revoke all on public.cc_table_payments from public,anon,authenticated;
grant select on public.cc_table_payments to authenticated;
drop policy if exists cc_table_payment_read on public.cc_table_payments;
create policy cc_table_payment_read on public.cc_table_payments for select to authenticated using ((select public.cc_table_payment_access()));

create or replace function public.cc_guard_table_payments() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_paid numeric; v_items jsonb; a record; item jsonb; quantities jsonb:='{}'; splits jsonb; methods integer;
begin
 select coalesce(sum(amount),0) into v_paid from public.cc_table_payments where order_id=new.id;
 if v_paid=0 then
   new.paid_amount:=0;new.paid_item_quantities:='{}';return new;
 end if;
 if new.status='cancelled' then raise exception 'Payments already collected. Review/refund payments before cancelling this order'; end if;
 if tg_op='UPDATE' and old.status='collected' and
    (new.total is distinct from old.total or new.items::jsonb is distinct from old.items::jsonb or new.status is distinct from old.status) then
   raise exception 'A settled table order cannot be edited';
 end if;
 v_items:=public.cc_table_items(new.items::jsonb);
 if jsonb_typeof(v_items) is distinct from 'array' then raise exception 'Order items must be an array'; end if;
 for a in select (l->>'index')::integer as idx,l->>'name' as name,(l->>'price')::numeric as price,sum((l->>'qty')::integer) as qty
   from public.cc_table_payments p cross join lateral jsonb_array_elements(p.allocations) l
   where p.order_id=new.id group by 1,2,3 loop
   item:=v_items->a.idx;
   if item is null or item->>'name' is distinct from a.name or (item->>'price')::numeric is distinct from a.price
     or coalesce((item->>'complimentary')::boolean,false) or item->>'qty' is null or (item->>'qty')::numeric<a.qty then
     raise exception 'Paid items cannot be removed, repriced, reordered or reduced below their paid quantity';
   end if;
   quantities:=jsonb_set(quantities,array[a.idx::text],to_jsonb(a.qty));
 end loop;
 if new.total is null or new.total<v_paid or new.total>=100000000 then raise exception 'Bill total cannot be lower than payments collected or invalid'; end if;
 -- Keep a partly paid bill consistent if new items are added by the old editor.
 if tg_op='UPDATE' and new.items::jsonb is distinct from old.items::jsonb and new.total is distinct from
   (select round(sum(case when coalesce((i->>'complimentary')::boolean,false) then 0 else (i->>'price')::numeric*(i->>'qty')::numeric end),2) from jsonb_array_elements(v_items) i) then
   raise exception 'Bill total must match item prices and quantities';
 end if;
 select jsonb_object_agg(method,amount),count(*) into splits,methods from (
   select e.key as method,sum(e.value::numeric) as amount from public.cc_table_payments p,
   lateral jsonb_each_text(p.payment_split) e where p.order_id=new.id group by e.key having sum(e.value::numeric)>0
 ) sums;
 new.paid_amount:=v_paid;new.paid_item_quantities:=quantities;new.payment_split:=splits;
 new.payment_method:=case when methods=1 then (select key from jsonb_each(splits) limit 1) else 'split' end;
 if v_paid=new.total then new.payment_status:='paid';new.status:='collected';
 else
   if new.status='collected' then raise exception 'Balance is still due; collect the remaining payment first'; end if;
   new.payment_status:='pending';
 end if;
 return new;
end $$;
drop trigger if exists cc_guard_table_payments on public.store_orders;
create trigger cc_guard_table_payments before insert or update on public.store_orders for each row execute function public.cc_guard_table_payments();

create or replace function public.cc_collect_table_payment(p_payload jsonb,p_key uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare o public.store_orders%rowtype; prior public.cc_table_payments%rowtype;
 v_items jsonb; item jsonb; allocations jsonb:='[]'; v_idx integer; v_qty integer; v_already integer;
 v_amount numeric; v_balance numeric; v_split jsonb:=p_payload->'split'; v_entered numeric:=0; v numeric;
 kv record; idx integer; q integer; receipt uuid; actor_name text;
begin
 if not public.cc_table_payment_access() then raise exception 'Staff payment access required' using errcode='42501'; end if;
 if p_key is null then raise exception 'Payment retry key required'; end if;
 select * into strict o from public.store_orders where id=(p_payload->>'order_id')::uuid for update;
 select * into prior from public.cc_table_payments where command_key=p_key;
 if found then
   if prior.payload<>p_payload or prior.collected_by<>auth.uid() then raise exception 'Payment key belongs to different input'; end if;
   return jsonb_build_object('receipt_id',prior.id,'paid_amount',o.paid_amount,'balance',o.total-o.paid_amount,'closed',o.status='collected');
 end if;
 if o.table_code is null or o.status in ('collected','cancelled') or o.payment_status in ('paid','complimentary') then raise exception 'This table order is not open for payment'; end if;
 v_items:=public.cc_table_items(o.items::jsonb);
 if jsonb_typeof(v_items) is distinct from 'array' then raise exception 'Invalid order items'; end if;
 v_balance:=round(o.total-o.paid_amount,2);
 if v_balance<=0 or v_balance>=100000000 then raise exception 'Invalid remaining balance'; end if;
 if (p_payload->>'expected_total')::numeric is distinct from o.total then raise exception 'Bill changed. Close and reopen the payment form'; end if;
 if p_payload->>'item_index' is not null then
   v_idx:=(p_payload->>'item_index')::integer;v_qty:=(p_payload->>'quantity')::integer;
   if v_idx<0 or v_qty is null or v_qty<=0 then raise exception 'Enter a positive whole quantity'; end if;
   item:=v_items->v_idx;
   if item is null or coalesce((item->>'complimentary')::boolean,false) or item->>'name' is distinct from p_payload->>'expected_name'
      or (item->>'price')::numeric is distinct from (p_payload->>'expected_price')::numeric then raise exception 'Item changed. Close and reopen the payment form'; end if;
   if o.total is distinct from (select round(sum(case when coalesce((i->>'complimentary')::boolean,false) then 0 else (i->>'price')::numeric*(i->>'qty')::numeric end),2) from jsonb_array_elements(v_items) i) then
     raise exception 'This bill includes adjustments. Use the remaining-bill payment option';
   end if;
   v_already:=coalesce((o.paid_item_quantities->>v_idx::text)::integer,0);
   if v_qty>(item->>'qty')::integer-v_already then raise exception 'That quantity is already paid or exceeds the unpaid quantity'; end if;
   v_amount:=round(v_qty*(item->>'price')::numeric,2);
   allocations:=jsonb_build_array(jsonb_build_object('index',v_idx,'name',item->>'name','price',(item->>'price')::numeric,'qty',v_qty));
 else
   v_amount:=v_balance;
   for idx in 0..jsonb_array_length(v_items)-1 loop
     item:=v_items->idx;q:=(item->>'qty')::integer-coalesce((o.paid_item_quantities->>idx::text)::integer,0);
     if q>0 and not coalesce((item->>'complimentary')::boolean,false) then
       allocations:=allocations||jsonb_build_array(jsonb_build_object('index',idx,'name',item->>'name','price',(item->>'price')::numeric,'qty',q));
     end if;
   end loop;
 end if;
 if v_amount<=0 or v_amount>v_balance then raise exception 'Invalid payment amount'; end if;
 if jsonb_typeof(v_split) is distinct from 'object' then raise exception 'Payment method amounts required'; end if;
 for kv in select * from jsonb_each_text(v_split) loop
   if kv.key not in ('cash','upi','upi_qr','card') then raise exception 'Unsupported payment method'; end if;
   v:=kv.value::numeric;
   if v is null or v<0 or v>=100000000 or round(v,2)<>v then raise exception 'Invalid payment amount'; end if;
   v_entered:=v_entered+v;
 end loop;
 if v_entered<>v_amount then raise exception 'Amount changed or does not match the quantity/balance. Reopen and verify before collecting'; end if;
 insert into public.cc_table_payments(order_id,command_key,payload,amount,allocations,payment_split,collected_by)
 values(o.id,p_key,p_payload,v_amount,allocations,v_split,auth.uid()) returning id into receipt;
 -- Optional legacy cash counter, in the same transaction, never on retry.
 if coalesce((v_split->>'cash')::numeric,0)>0 and to_regclass('public.cash_counter_entries') is not null then
   select email into actor_name from auth.users where id=auth.uid();
   execute 'insert into public.cash_counter_entries(entry_type,amount,note,staff_name) values($1,$2,$3,$4)'
   using 'order_payment',(v_split->>'cash')::numeric,'Table payment receipt '||receipt::text,actor_name;
 end if;
 update public.store_orders set paid_amount=paid_amount where id=o.id returning * into o;
 return jsonb_build_object('receipt_id',receipt,'paid_amount',o.paid_amount,'balance',o.total-o.paid_amount,'closed',o.status='collected');
end $$;
revoke all on function public.cc_table_payment_access(),public.cc_table_items(jsonb),public.cc_guard_table_payments(),public.cc_collect_table_payment(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.cc_table_payment_access(),public.cc_collect_table_payment(jsonb,uuid) to authenticated;
notify pgrst,'reload schema';
commit;
