-- Premium Cards: identity is the customer's verified account email, not
-- an SMS-verified phone. This app signs customers in by email, so
-- auth.users.phone_confirmed_at is never set for real customers — every
-- phone-match check in the original migration was unreachable and
-- blocked every action ("Your verified mobile has changed...") for
-- every member. The mobile number becomes a plain, admin-entered
-- contact detail (matches the "(not SMS-verified)" label already
-- shipped in premium-cards.js's Issue Card form).
-- Run this ENTIRE file as database owner AFTER 20260921_premium_cards.sql
-- and 20260921b_premium_group_codes.sql. Existing cards, stamps, reward
-- reservations and allocations are untouched — only identity checks
-- change.
begin;
do $$ begin
 if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='cc_premium_members') then
  raise exception 'Run migrations/20260921_premium_cards.sql first — Premium Cards is not installed yet.';
 end if;
end $$;

create or replace function public.cc_premium_order_trigger() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare items jsonb; a record; m uuid; item jsonb; idx integer; count_total numeric; amount numeric; day date; eligible boolean; oldjson jsonb;
begin
 items=public.cc_premium_items(to_jsonb(new)->'items');
 if tg_op='INSERT' then
  -- Only the authenticated customer's own order can auto-link.
  if auth.uid() is not null and to_jsonb(new)->>'customer_id'=auth.uid()::text and public.cc_premium_role()='customer' then
   select pm.id into m from public.cc_premium_members pm join auth.users au on au.id=pm.user_id
    where pm.user_id=auth.uid() and not pm.suspended and au.email_confirmed_at is not null;
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
v_companions uuid[]; v_phone text; v_groups jsonb; g jsonb; v_member uuid;
begin
 if auth.uid() is null then raise exception 'Sign in to use Premium Cards'; end if;
 if p_action='issue' then
  if role<>'admin' then raise exception 'Admin access required'; end if;
  select * into u from auth.users where lower(email)=lower(btrim(p_payload->>'email'));
  if u.id is null or u.email_confirmed_at is null then raise exception 'Customer must verify their account email first'; end if;
  if nullif(btrim(p_payload->>'phone'),'') is null then raise exception 'Enter the customer''s contact mobile number'; end if;
  if not public.cc_premium_schedule(p_payload->'schedule') then raise exception 'Choose valid menu items and unique milestone days from 1 to 100'; end if;
  insert into public.cc_premium_members(user_id,name,phone,issued_by) values(u.id,btrim(p_payload->>'name'),btrim(p_payload->>'phone'),auth.uid()) returning * into m;
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
  if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then raise exception 'Your account email is not verified. Ask admin to review your membership.'; end if;
  if exists(select 1 from public.cc_premium_codes where member_id=m.id and created_at>now()-interval '10 seconds') then raise exception 'Wait 10 seconds before generating another code'; end if;
  v_companions='{}'::uuid[];
  if p_payload->>'reward_id' is not null then
   select * into r from public.cc_premium_rewards where id=(p_payload->>'reward_id')::uuid and member_id=m.id and status='available';
   if r.id is null then raise exception 'Reward is not available'; end if;
  elsif jsonb_typeof(p_payload->'companion_phones')='array' then
   if jsonb_array_length(p_payload->'companion_phones')>9 then raise exception 'A visit code can cover at most 10 people'; end if;
   for v_phone in select value from jsonb_array_elements_text(p_payload->'companion_phones') loop
    select pm.id into v_id from public.cc_premium_members pm join auth.users au on au.id=pm.user_id
     where pm.phone=btrim(v_phone) and not pm.suspended and au.email_confirmed_at is not null;
    if v_id is null then raise exception 'No active premium member found for %',btrim(v_phone); end if;
    if v_id=m.id then raise exception 'You are already included — no need to add your own number'; end if;
    if not v_id=any(v_companions) then v_companions=array_append(v_companions,v_id); end if;
   end loop;
  end if;
  update public.cc_premium_codes set used_at=now() where member_id=m.id and used_at is null;
  insert into public.cc_premium_codes(member_id,reward_id,companion_member_ids) values(m.id,r.id,v_companions) returning * into code;
  select jsonb_agg(jsonb_build_object('id',pm.id,'name',pm.name)) into outval from public.cc_premium_members pm where pm.id=any(v_companions);
  return jsonb_build_object('code',code.token,'expires_at',code.expires_at,'companions',coalesce(outval,'[]'::jsonb));
 elsif p_action='peek_code' then
  if role not in ('admin','staff') then raise exception 'Staff access required'; end if;
  select * into code from public.cc_premium_codes where token=nullif(p_payload->>'code','')::uuid and used_at is null and expires_at>now();
  if code.token is null then raise exception 'Code expired or already used'; end if;
  select * into m from public.cc_premium_members where id=code.member_id;
  select jsonb_agg(jsonb_build_object('id',pm.id,'name',pm.name)) into outval from public.cc_premium_members pm where pm.id=any(code.companion_member_ids);
  return jsonb_build_object('member',jsonb_build_object('id',m.id,'name',m.name),'is_reward',code.reward_id is not null,'companions',coalesce(outval,'[]'::jsonb));
 elsif p_action in ('assign','reserve') then
  if role not in ('admin','staff') then raise exception 'Staff access required'; end if;
  select * into o from public.store_orders where id=(p_payload->>'order_id')::uuid for update;
  if o.id is null or to_jsonb(o)->>'status' in ('collected','cancelled') then raise exception 'Select an open order'; end if;
  select * into code from public.cc_premium_codes where token=(p_payload->>'code')::uuid and used_at is null and expires_at>now() for update;
  if code.token is null then raise exception 'Code expired or already used. Ask customer for a new code.'; end if;
  select * into m from public.cc_premium_members where id=code.member_id and not suspended for update;
  if m.id is null then raise exception 'Membership suspended'; end if;
  if not exists(select 1 from auth.users where id=m.user_id and email_confirmed_at is not null) then raise exception 'Member account email is not verified. Ask admin to review this membership.'; end if;
  items=public.cc_premium_items(to_jsonb(o)->'items');
  if p_action='assign' then
   if code.reward_id is not null then raise exception 'Use a visit code, not a reward code'; end if;
   v_groups=jsonb_build_array(jsonb_build_object('member_id',m.id,'items',coalesce(p_payload->'items','[]'::jsonb)));
   if jsonb_typeof(p_payload->'companions')='array' then
    for g in select value from jsonb_array_elements(p_payload->'companions') loop
     v_member=nullif(g->>'member_id','')::uuid;
     if v_member is null or not v_member=any(code.companion_member_ids) then raise exception 'That person is not part of this visit code'; end if;
     v_groups=v_groups||jsonb_build_array(jsonb_build_object('member_id',v_member,'items',coalesce(g->'items','[]'::jsonb)));
    end loop;
   end if;
   if not exists(select 1 from jsonb_array_elements(v_groups) gg where jsonb_array_length(gg->'items')>0) then raise exception 'Select at least one item quantity'; end if;
   for g in select value from jsonb_array_elements(v_groups) loop
    v_member=(g->>'member_id')::uuid;
    for x in select value from jsonb_array_elements(g->'items') loop
     idx=(x->>'index')::int; qty=(x->>'quantity')::int;
     if idx is null or qty is null or idx<0 or qty<=0 or items->idx is null or coalesce((items->idx->>'complimentary')::boolean,false) or (items->idx->>'price')::numeric<=0 then raise exception 'Invalid purchase allocation'; end if;
     select coalesce(sum(quantity),0) into assigned from public.cc_premium_allocations where order_id=o.id and item_index=idx;
     if assigned+qty>(items->idx->>'qty')::int then raise exception 'These pieces already belong to another premium customer'; end if;
     insert into public.cc_premium_allocations(order_id,member_id,item_index,quantity,name,price) values(o.id,v_member,idx,qty,items->idx->>'name',(items->idx->>'price')::numeric)
      on conflict(order_id,member_id,item_index) do update set quantity=cc_premium_allocations.quantity+excluded.quantity;
    end loop;
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

revoke all on function public.cc_premium_command(text,jsonb) from public,anon,authenticated;
grant execute on function public.cc_premium_command(text,jsonb) to authenticated;
notify pgrst,'reload schema';
commit;
