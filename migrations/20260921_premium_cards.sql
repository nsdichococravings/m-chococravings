-- Premium cards. Run this ENTIRE file as database owner after production migrations.
-- No historical stamps are inferred. No existing order/stock triggers are replaced.
begin;
do $$ begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='store_orders' and column_name='items' and udt_name='jsonb') then
  raise exception 'Premium Cards requires store_orders.items to be JSONB. Run the read-only preflight and reconcile the schema before installing.';
 end if;
end $$;
create table if not exists public.cc_premium_members (
 id uuid primary key default gen_random_uuid(), user_id uuid not null unique references auth.users(id),
 name text not null check(length(name) between 1 and 120), phone text not null unique,
 suspended boolean not null default false, issued_by uuid not null references auth.users(id), created_at timestamptz not null default now()
);
create table if not exists public.cc_premium_cards (
 id uuid primary key default gen_random_uuid(), member_id uuid not null references public.cc_premium_members(id),
 number text not null unique default ('CC-P-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,12))),
 cycle integer not null, minimum_spend numeric not null default 0 check(minimum_spend>=0 and minimum_spend<1000000),
 schedule jsonb not null, created_at timestamptz not null default now(), unique(member_id,cycle)
);
create table if not exists public.cc_premium_allocations (
 order_id uuid not null references public.store_orders(id), member_id uuid not null references public.cc_premium_members(id),
 item_index integer not null check(item_index>=0), quantity integer not null check(quantity>0), name text not null, price numeric not null check(price>0),
 created_at timestamptz not null default now(), primary key(order_id,member_id,item_index)
);
create table if not exists public.cc_premium_purchases (
 order_id uuid not null references public.store_orders(id), member_id uuid not null references public.cc_premium_members(id),
 business_day date not null, amount numeric not null, reversed boolean not null default false,
 primary key(order_id,member_id)
);
create index if not exists cc_premium_purchase_day on public.cc_premium_purchases(member_id,business_day) where not reversed;
create table if not exists public.cc_premium_stamps (
 id uuid primary key default gen_random_uuid(), member_id uuid not null references public.cc_premium_members(id),
 card_id uuid not null references public.cc_premium_cards(id), business_day date not null, created_at timestamptz not null default now(),
 unique(member_id,business_day)
);
create index if not exists cc_premium_stamps_card on public.cc_premium_stamps(card_id);
create table if not exists public.cc_premium_rewards (
 id uuid primary key default gen_random_uuid(), member_id uuid not null references public.cc_premium_members(id),
 card_id uuid not null references public.cc_premium_cards(id), milestone integer not null,
 item_name text not null, status text not null default 'available' check(status in ('available','reserved','redeemed','revoked','review')),
 order_id uuid references public.store_orders(id), redeemed_at timestamptz, unique(card_id,milestone)
);
create index if not exists cc_premium_reward_order on public.cc_premium_rewards(order_id) where order_id is not null;
create index if not exists cc_premium_reward_member on public.cc_premium_rewards(member_id);
create table if not exists public.cc_premium_codes (
 token uuid primary key default gen_random_uuid(), member_id uuid not null references public.cc_premium_members(id),
 reward_id uuid references public.cc_premium_rewards(id), expires_at timestamptz not null default now()+interval '5 minutes',
 used_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists cc_premium_codes_member on public.cc_premium_codes(member_id,created_at);
create table if not exists public.cc_premium_audit (
 id bigint generated always as identity primary key, actor uuid, action text not null, details jsonb not null,
 created_at timestamptz not null default now()
);
create table if not exists public.cc_premium_reviews (
 id uuid primary key default gen_random_uuid(), member_id uuid not null references public.cc_premium_members(id),
 order_id uuid references public.store_orders(id), reason text not null, status text not null default 'pending' check(status in ('pending','approved','rejected')),
 requested_by uuid, reviewed_by uuid, review_note text, created_at timestamptz not null default now(), reviewed_at timestamptz
);
alter table public.cc_premium_reviews add column if not exists reward_id uuid references public.cc_premium_rewards(id);
create index if not exists cc_premium_reviews_pending on public.cc_premium_reviews(created_at) where status='pending';

create or replace function public.cc_premium_role() returns text language sql stable security definer set search_path=pg_catalog,public as $$
 select case when auth.uid() is null then null
 when public.cc_production_role()='admin' then 'admin'
 when public.cc_production_role()='sales' or exists(select 1 from auth.users u join public.customers c on lower(c.email)=lower(u.email)
  where u.id=auth.uid() and u.email_confirmed_at is not null and coalesce((to_jsonb(c)->>'is_employee')::boolean,false)) then 'staff'
 else 'customer' end
$$;
create or replace function public.cc_premium_items(p_items jsonb) returns jsonb language sql immutable set search_path=pg_catalog as $$
 select case when jsonb_typeof(p_items)='string' then (p_items#>>'{}')::jsonb else coalesce(p_items,'[]'::jsonb) end
$$;
create or replace function public.cc_premium_schedule(p_schedule jsonb) returns boolean language plpgsql set search_path=pg_catalog,public as $$
declare x jsonb; seen integer[]='{}'; d integer;
begin
 if jsonb_typeof(p_schedule)<>'array' or jsonb_array_length(p_schedule) not between 1 and 100 then return false; end if;
 for x in select value from jsonb_array_elements(p_schedule) loop
  d=(x->>'day')::integer;
  if d is null or d not between 1 and 100 or d=any(seen) or not exists(select 1 from public.store_menu where name=x->>'item') then return false; end if;
  seen=array_append(seen,d);
 end loop; return true;
end $$;

-- Internal reconciliation. Caller holds the member row lock. Existing earned days keep their card.
create or replace function public.cc_premium_reconcile(p_member uuid,p_day date) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare c public.cc_premium_cards; n integer; spend numeric; s jsonb; v_card uuid;
begin
 perform 1 from public.cc_premium_members where id=p_member for update;
 select card_id into v_card from public.cc_premium_stamps where member_id=p_member and business_day=p_day;
 if v_card is null then select * into c from public.cc_premium_cards where member_id=p_member order by cycle desc limit 1;
 else select * into c from public.cc_premium_cards where id=v_card; end if;
 if c.id is null then return; end if;
 select coalesce(sum(amount),0) into spend from public.cc_premium_purchases where member_id=p_member and business_day=p_day and not reversed;
 if spend>0 and spend>=c.minimum_spend then
  if v_card is null then
   select count(*) into n from public.cc_premium_stamps where card_id=c.id;
   if n>=100 then
    insert into public.cc_premium_cards(member_id,cycle,minimum_spend,schedule) values(p_member,c.cycle+1,c.minimum_spend,c.schedule) returning * into c;
   end if;
   insert into public.cc_premium_stamps(member_id,card_id,business_day) values(p_member,c.id,p_day) on conflict(member_id,business_day) do nothing;
  end if;
 else delete from public.cc_premium_stamps where member_id=p_member and business_day=p_day; end if;
 select count(*) into n from public.cc_premium_stamps where card_id=c.id;
 for s in select value from jsonb_array_elements(c.schedule) loop
  if n>=(s->>'day')::integer then
   insert into public.cc_premium_rewards(member_id,card_id,milestone,item_name) values(p_member,c.id,(s->>'day')::integer,s->>'item')
    on conflict(card_id,milestone) do update set status='available' where cc_premium_rewards.status='revoked' and cc_premium_rewards.redeemed_at is null;
  end if;
 end loop;
 insert into public.cc_premium_reviews(member_id,order_id,reason,reward_id)
  select member_id,order_id,'Purchase reversal affects an already reserved or redeemed reward.',id from public.cc_premium_rewards
  where card_id=c.id and milestone>n and status in ('reserved','redeemed');
 update public.cc_premium_rewards set status=case when status in ('reserved','redeemed') then 'review' else 'revoked' end
  where card_id=c.id and milestone>n and status in ('reserved','redeemed','available');
end $$;

create or replace function public.cc_premium_order_trigger() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare items jsonb; a record; m uuid; item jsonb; idx integer; count_total numeric; amount numeric; day date; eligible boolean; oldjson jsonb;
begin
 items=public.cc_premium_items(to_jsonb(new)->'items');
 if tg_op='INSERT' then
  -- Only the authenticated customer's own order can auto-link; mobile text is not identity.
  if auth.uid() is not null and to_jsonb(new)->>'customer_id'=auth.uid()::text and public.cc_premium_role()='customer' then
   select pm.id into m from public.cc_premium_members pm join auth.users au on au.id=pm.user_id
    where pm.user_id=auth.uid() and not pm.suspended and au.phone=pm.phone and au.phone_confirmed_at is not null;
   if m is not null then
    for item,idx in select value,(ordinality-1)::int from jsonb_array_elements(items) with ordinality loop
     if not coalesce((item->>'complimentary')::boolean,false) and (item->>'price')::numeric>0 and (item->>'qty')::integer>0 then
      insert into public.cc_premium_allocations(order_id,member_id,item_index,quantity,name,price) values(new.id,m,idx,(item->>'qty')::int,item->>'name',(item->>'price')::numeric);
     end if;
    end loop;
   end if;
  end if;
  return new;
 end if;
 oldjson=to_jsonb(old);
 -- A closed order's financial lines cannot be rewritten after earning benefits.
 if exists(select 1 from public.cc_premium_purchases where order_id=new.id) and
  (public.cc_premium_items(oldjson->'items')<>items or (oldjson->>'total')::numeric<>(to_jsonb(new)->>'total')::numeric) then
  raise exception 'Premium-linked settled purchases cannot be edited. Cancel/refund and place a replacement order.';
 end if;
 -- Keep previously linked item identities and assigned quantities valid, including complimentary rewards.
 for a in select item_index,name,price,sum(quantity) qty from public.cc_premium_allocations where order_id=new.id group by item_index,name,price loop
  item=items->a.item_index;
  if item is null or item->>'name'<>a.name or (item->>'price')::numeric<>a.price or coalesce((item->>'complimentary')::boolean,false) or (item->>'qty')::numeric<a.qty then
   raise exception 'Unlink premium assignments before changing these items.';
  end if;
 end loop;
 for a in select * from public.cc_premium_rewards where order_id=new.id and status in ('reserved','review') and redeemed_at is null loop
  if not exists(select 1 from jsonb_array_elements(items) x where x->>'premium_reward_id'=a.id::text and x->>'name'=a.item_name and (x->>'qty')::int=1 and (x->>'price')::numeric=0 and (x->>'complimentary')::boolean) then
   raise exception 'Keep the reserved reward item, or cancel the order to release it.';
  end if;
 end loop;
 if oldjson->>'status'=to_jsonb(new)->>'status' and oldjson->>'payment_status'=to_jsonb(new)->>'payment_status' then return new; end if;
 if public.cc_premium_role() not in ('admin','staff') or public.cc_premium_role() is null then
  if exists(select 1 from public.cc_premium_allocations where order_id=new.id) or exists(select 1 from public.cc_premium_rewards where order_id=new.id) then
   raise exception 'Staff must confirm collection or cancellation for premium-linked orders.';
  end if;
  return new;
 end if;
 eligible=to_jsonb(new)->>'status'='collected' and to_jsonb(new)->>'payment_status'='paid';
 if eligible or (to_jsonb(new)->>'status'='collected' and to_jsonb(new)->>'payment_status'='complimentary') then
  update public.cc_premium_rewards set status=case when status='review' then 'review' else 'redeemed' end,redeemed_at=now() where order_id=new.id and status in ('reserved','review') and redeemed_at is null;
 elsif to_jsonb(new)->>'status'='cancelled' then
  update public.cc_premium_rewards set status='available',order_id=null where order_id=new.id and status='reserved';
 end if;
 select coalesce(sum((x->>'price')::numeric*(x->>'qty')::numeric) filter(where not coalesce((x->>'complimentary')::boolean,false)),0) into count_total from jsonb_array_elements(items) x;
 for m in select distinct member_id from public.cc_premium_allocations where order_id=new.id order by member_id loop
  perform 1 from public.cc_premium_members where id=m for update;
  select business_day into day from public.cc_premium_purchases where order_id=new.id and member_id=m;
  day=coalesce(day,(now() at time zone 'Asia/Kolkata')::date);
  if eligible and count_total>0 and not exists(select 1 from public.cc_premium_members where id=m and suspended) then
   select round(sum(quantity*price)*least(1,greatest(0,(to_jsonb(new)->>'total')::numeric)/count_total),2) into amount from public.cc_premium_allocations where order_id=new.id and member_id=m;
   insert into public.cc_premium_purchases(order_id,member_id,business_day,amount) values(new.id,m,day,amount)
    on conflict(order_id,member_id) do update set reversed=false;
  else update public.cc_premium_purchases set reversed=true where order_id=new.id and member_id=m; end if;
  perform public.cc_premium_reconcile(m,day);
 end loop;
 return new;
end $$;
drop trigger if exists cc_premium_order on public.store_orders;
create trigger cc_premium_order after insert or update on public.store_orders for each row execute function public.cc_premium_order_trigger();

create or replace function public.cc_premium_command(p_action text,p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare role text=public.cc_premium_role(); u auth.users; m public.cc_premium_members; c public.cc_premium_cards; r public.cc_premium_rewards;
code public.cc_premium_codes; o public.store_orders; items jsonb; v_updated_items jsonb; x jsonb; idx integer; qty integer; assigned integer; v_id uuid; outval jsonb; req public.cc_premium_reviews;
begin
 if auth.uid() is null then raise exception 'Sign in to use Premium Cards'; end if;
 if p_action='issue' then
  if role<>'admin' then raise exception 'Admin access required'; end if;
  select * into u from auth.users where lower(email)=lower(btrim(p_payload->>'email'));
  if u.id is null or u.phone_confirmed_at is null or nullif(u.phone,'') is null then raise exception 'Customer must verify their mobile number in My Premium Card first'; end if;
  if not public.cc_premium_schedule(p_payload->'schedule') then raise exception 'Choose valid menu items and unique milestone days from 1 to 100'; end if;
  insert into public.cc_premium_members(user_id,name,phone,issued_by) values(u.id,btrim(p_payload->>'name'),u.phone,auth.uid()) returning * into m;
  insert into public.cc_premium_cards(member_id,cycle,minimum_spend,schedule) values(m.id,1,coalesce((p_payload->>'minimum_spend')::numeric,0),p_payload->'schedule') returning * into c;
  outval=to_jsonb(c);
 elsif p_action='suspend' then
  if role<>'admin' then raise exception 'Admin access required'; end if;
  if length(btrim(coalesce(p_payload->>'reason','')))=0 then raise exception 'Reason required'; end if;
  update public.cc_premium_members set suspended=(p_payload->>'suspended')::boolean where id=(p_payload->>'member_id')::uuid returning * into m;
  if not found then raise exception 'Member not found'; end if; outval=jsonb_build_object('ok',true);
 elsif p_action='code' then
  select * into m from public.cc_premium_members where user_id=auth.uid() and not suspended for update;
  if m.id is null then raise exception 'Active premium membership required'; end if;
  if not exists(select 1 from auth.users where id=auth.uid() and phone=m.phone and phone_confirmed_at is not null) then raise exception 'Your verified mobile has changed. Ask admin to review your membership.'; end if;
  if exists(select 1 from public.cc_premium_codes where member_id=m.id and created_at>now()-interval '10 seconds') then raise exception 'Wait 10 seconds before generating another code'; end if;
  if p_payload->>'reward_id' is not null then
   select * into r from public.cc_premium_rewards where id=(p_payload->>'reward_id')::uuid and member_id=m.id and status='available';
   if r.id is null then raise exception 'Reward is not available'; end if;
  end if;
  update public.cc_premium_codes set used_at=now() where member_id=m.id and used_at is null;
  insert into public.cc_premium_codes(member_id,reward_id) values(m.id,r.id) returning * into code;
  return jsonb_build_object('code',code.token,'expires_at',code.expires_at);
 elsif p_action in ('assign','reserve') then
  if role not in ('admin','staff') then raise exception 'Staff access required'; end if;
  select * into o from public.store_orders where id=(p_payload->>'order_id')::uuid for update;
  if o.id is null or to_jsonb(o)->>'status' in ('collected','cancelled') then raise exception 'Select an open order'; end if;
  select * into code from public.cc_premium_codes where token=(p_payload->>'code')::uuid and used_at is null and expires_at>now() for update;
  if code.token is null then raise exception 'Code expired or already used. Ask customer for a new code.'; end if;
  select * into m from public.cc_premium_members where id=code.member_id and not suspended for update;
  if m.id is null then raise exception 'Membership suspended'; end if;
  if not exists(select 1 from auth.users where id=m.user_id and phone=m.phone and phone_confirmed_at is not null) then raise exception 'Verified mobile no longer matches membership'; end if;
  items=public.cc_premium_items(to_jsonb(o)->'items');
  if p_action='assign' then
   if code.reward_id is not null then raise exception 'Use a visit code, not a reward code'; end if;
   if jsonb_typeof(p_payload->'items')<>'array' or jsonb_array_length(p_payload->'items')=0 then raise exception 'Select at least one item quantity'; end if;
   for x in select value from jsonb_array_elements(p_payload->'items') loop
    idx=(x->>'index')::int; qty=(x->>'quantity')::int;
    if idx is null or qty is null or idx<0 or qty<=0 or items->idx is null or coalesce((items->idx->>'complimentary')::boolean,false) or (items->idx->>'price')::numeric<=0 then raise exception 'Invalid purchase allocation'; end if;
    select coalesce(sum(quantity),0) into assigned from public.cc_premium_allocations where order_id=o.id and item_index=idx;
    if assigned+qty>(items->idx->>'qty')::int then raise exception 'These pieces already belong to another premium customer'; end if;
    insert into public.cc_premium_allocations(order_id,member_id,item_index,quantity,name,price) values(o.id,m.id,idx,qty,items->idx->>'name',(items->idx->>'price')::numeric)
     on conflict(order_id,member_id,item_index) do update set quantity=cc_premium_allocations.quantity+excluded.quantity;
   end loop;
  else
   select * into r from public.cc_premium_rewards where id=code.reward_id and member_id=m.id and status='available' for update;
   if r.id is null then raise exception 'Reward unavailable'; end if;
   items=items||jsonb_build_array(jsonb_build_object('name',r.item_name,'qty',1,'price',0,'complimentary',true,'premium_reward_id',r.id));
   -- Retain the original array-vs-string representation used by this deployment.
   v_updated_items=case when jsonb_typeof(to_jsonb(o)->'items')='string' then to_jsonb(items::text) else items end;
   update public.store_orders set items=v_updated_items where id=o.id;
   update public.cc_premium_rewards set status='reserved',order_id=o.id where id=r.id;
  end if;
  update public.cc_premium_codes set used_at=now() where token=code.token;
  outval=jsonb_build_object('ok',true,'customer',m.name);
 elsif p_action='unlink' then
  if role not in ('admin','staff') then raise exception 'Staff access required'; end if;
  select * into o from public.store_orders where id=(p_payload->>'order_id')::uuid for update;
  if o.id is null or to_jsonb(o)->>'status' in ('collected','cancelled') or exists(select 1 from public.cc_premium_purchases where order_id=o.id) then raise exception 'Settled assignments require admin review'; end if;
  delete from public.cc_premium_allocations where order_id=o.id and member_id=(p_payload->>'member_id')::uuid;
  outval=jsonb_build_object('ok',true);
 elsif p_action='request_review' then
  if role not in ('admin','staff') then raise exception 'Staff access required'; end if;
  if length(btrim(coalesce(p_payload->>'reason','')))=0 then raise exception 'Reason required'; end if;
  insert into public.cc_premium_reviews(member_id,order_id,reason,requested_by) values((p_payload->>'member_id')::uuid,nullif(p_payload->>'order_id','')::uuid,p_payload->>'reason',auth.uid()) returning id into v_id;
  outval=jsonb_build_object('id',v_id);
 elsif p_action='review' then
  if role<>'admin' then raise exception 'Admin access required'; end if;
  if length(btrim(coalesce(p_payload->>'note','')))=0 then raise exception 'Review note required'; end if;
  select * into req from public.cc_premium_reviews where id=(p_payload->>'id')::uuid and status='pending' for update;
  if req.id is null then raise exception 'Pending request not found'; end if;
  if (p_payload->>'approve')::boolean then
   -- Only existing server-recorded purchase evidence can be reconciled. Never invent stamps.
   perform 1 from public.store_orders where id=req.order_id for update;
   perform 1 from public.cc_premium_members where id=req.member_id for update;
   if req.reward_id is not null then
    if p_payload->>'resolution' not in ('honor_reward','forfeit_reward') or p_payload->>'resolution' is null then raise exception 'Choose whether to honor or forfeit the affected reward'; end if;
    select * into r from public.cc_premium_rewards where id=req.reward_id and status='review' for update;
    if r.id is null then raise exception 'Reward has already been reviewed'; end if;
    if p_payload->>'resolution'='forfeit_reward' and r.redeemed_at is null and exists(select 1 from public.store_orders so where so.id=r.order_id and to_jsonb(so)->>'status'<>'cancelled') then raise exception 'Cancel the order containing the uncollected reward before forfeiting it'; end if;
    update public.cc_premium_rewards set status=case when p_payload->>'resolution'='forfeit_reward' then 'revoked' when r.redeemed_at is not null then 'redeemed'
      when exists(select 1 from public.store_orders so where so.id=r.order_id and to_jsonb(so)->>'status'<>'cancelled') then 'reserved' else 'available' end where id=r.id;
   else
   if p_payload->>'resolution' not in ('reconcile','exclude_purchase','restore_purchase') or p_payload->>'resolution' is null then raise exception 'Choose a purchase correction'; end if;
   if not exists(select 1 from public.cc_premium_purchases where order_id=req.order_id and member_id=req.member_id) then raise exception 'No recorded qualifying purchase exists for this request'; end if;
   if p_payload->>'resolution'='exclude_purchase' then
    update public.cc_premium_purchases set reversed=true where order_id=req.order_id and member_id=req.member_id;
   elsif p_payload->>'resolution'='restore_purchase' then
    if not exists(select 1 from public.store_orders so where so.id=req.order_id and to_jsonb(so)->>'status'='collected' and to_jsonb(so)->>'payment_status'='paid') then raise exception 'Only paid, collected purchase evidence can be restored'; end if;
    update public.cc_premium_purchases set reversed=false where order_id=req.order_id and member_id=req.member_id;
   end if;
   perform public.cc_premium_reconcile(req.member_id,(select business_day from public.cc_premium_purchases where order_id=req.order_id and member_id=req.member_id));
   end if;
  end if;
  update public.cc_premium_reviews set status=case when (p_payload->>'approve')::boolean then 'approved' else 'rejected' end,reviewed_by=auth.uid(),reviewed_at=now(),review_note=p_payload->>'note' where id=req.id;
  outval=jsonb_build_object('ok',true);
 else raise exception 'Unknown premium action'; end if;
 insert into public.cc_premium_audit(actor,action,details) values(auth.uid(),p_action,p_payload-'code');
 return outval;
end $$;

create or replace function public.cc_premium_view(p_order uuid default null) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare role text=public.cc_premium_role(); m uuid; result jsonb;
begin
 if auth.uid() is null then raise exception 'Sign in to view Premium Cards'; end if;
 select id into m from public.cc_premium_members where user_id=auth.uid();
 if p_order is not null then
  if role not in ('admin','staff') then raise exception 'Staff access required'; end if;
  return jsonb_build_object('order',(select jsonb_build_object('id',id,'items',items,'total',total,'status',status) from public.store_orders where id=p_order),
   'allocations',coalesce((select jsonb_agg(to_jsonb(a)||jsonb_build_object('customer_name',b.name,'phone','••••••'||right(b.phone,4))) from public.cc_premium_allocations a join public.cc_premium_members b on b.id=a.member_id where order_id=p_order),'[]'::jsonb));
 end if;
 result=jsonb_build_object('role',role,'member',(select to_jsonb(t)-'phone'||jsonb_build_object('phone','••••••'||right(t.phone,4)) from public.cc_premium_members t where id=m),
 'cards',coalesce((select jsonb_agg(to_jsonb(c)||jsonb_build_object('days',(select count(*) from public.cc_premium_stamps s where s.card_id=c.id)) order by cycle desc) from public.cc_premium_cards c where member_id=m),'[]'::jsonb),
 'stamps',coalesce((select jsonb_agg(to_jsonb(s) order by business_day desc) from (select * from public.cc_premium_stamps where member_id=m order by business_day desc limit 100) s),'[]'::jsonb),
 'rewards',coalesce((select jsonb_agg(to_jsonb(r) order by milestone) from public.cc_premium_rewards r where member_id=m and status<>'revoked'),'[]'::jsonb));
 if role='admin' then
  result=result||jsonb_build_object('members',coalesce((select jsonb_agg(to_jsonb(t)-'phone'||jsonb_build_object('phone','••••••'||right(t.phone,4))) from (select * from public.cc_premium_members order by created_at desc limit 200) t),'[]'::jsonb),
   'reviews',coalesce((select jsonb_agg(to_jsonb(r)) from (select * from public.cc_premium_reviews where status='pending' order by created_at limit 100) r),'[]'::jsonb));
 end if;
 if role in ('admin','staff') then result=result||jsonb_build_object('menu',coalesce((select jsonb_agg(name order by name) from public.store_menu),'[]'::jsonb)); end if;
 return result;
end $$;

-- All business writes run through the authenticated RPC or order trigger, never direct table grants.
do $$ declare t text; f text; begin
 foreach t in array array['members','cards','allocations','purchases','stamps','rewards','codes','audit','reviews'] loop
  execute format('alter table public.cc_premium_%I enable row level security',t);
  execute format('revoke all on public.cc_premium_%I from public,anon,authenticated',t);
 end loop;
 foreach f in array array['cc_premium_role()','cc_premium_items(jsonb)','cc_premium_schedule(jsonb)','cc_premium_reconcile(uuid,date)','cc_premium_order_trigger()','cc_premium_command(text,jsonb)','cc_premium_view(uuid)'] loop
  execute 'revoke all on function public.'||f||' from public,anon,authenticated';
 end loop;
end $$;
grant execute on function public.cc_premium_command(text,jsonb),public.cc_premium_view(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
