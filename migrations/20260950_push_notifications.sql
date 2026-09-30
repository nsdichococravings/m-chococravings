-- Push notifications for customers (Web Push; works in the installed app
-- and in Chrome/Android, and on iPhone once the app is added to the Home
-- Screen).
--
--  * The app saves each device's push subscription here
--    (cc_push_subscribe) once the customer allows notifications.
--  * When an online order's status changes, a trigger calls the
--    send-push Edge Function (supabase/functions/send-push) through
--    pg_net, which sends "Your order is out for delivery" etc. to that
--    customer's devices. This covers every place a status can change.
--  * Admins can also send an offer/announcement to everyone from the
--    Command Center ("Send Notification"); that goes straight from the
--    app to the Edge Function, which checks the caller is an admin.
--
-- Setup (once):
--  1. Run this file as database owner.
--  2. Generate VAPID keys:  npx web-push generate-vapid-keys
--  3. Save the PUBLIC key for the app:
--       update public.app_settings set value='<public key>' where key='vapid_public_key';
--  4. Deploy the function and set its secrets (Supabase CLI):
--       supabase functions deploy send-push --no-verify-jwt
--       supabase secrets set VAPID_PUBLIC_KEY=<public> VAPID_PRIVATE_KEY=<private> \
--         VAPID_SUBJECT=mailto:you@example.com \
--         PUSH_WEBHOOK_SECRET=<value of: select value from cc_push_config where key='webhook_secret'>
--  Until step 3 is done the app never asks for notification permission,
--  and until step 4 the trigger's calls just fail quietly -- order
--  updates are never blocked by push.
--
-- orders, customers and app_settings already exist (created outside this
-- repo's migrations). Safe to re-run.
begin;
do $$ begin
 if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='orders') then
  raise exception 'public.orders not found -- is this the right database?';
 end if;
end $$;

-- pg_net lets the database make the HTTP call to the Edge Function.
-- Enabled by default on Supabase; if it can't be created here the rest
-- still installs and only the automatic order updates are skipped.
do $$ begin
 create extension if not exists pg_net;
exception when others then
 raise notice 'pg_net not available (%). Enable it under Database > Extensions for order-status pushes.', sqlerrm;
end $$;

create table if not exists public.cc_push_subscriptions(
 endpoint text primary key,
 customer_id uuid not null references public.customers(id) on delete cascade,
 p256dh text not null,
 auth text not null,
 user_agent text,
 created_at timestamptz not null default now(),
 last_seen_at timestamptz not null default now()
);
create index if not exists idx_cc_push_subscriptions_customer on public.cc_push_subscriptions(customer_id);
alter table public.cc_push_subscriptions enable row level security;
revoke all on public.cc_push_subscriptions from public, anon, authenticated;

-- Private settings for the trigger -> Edge Function call.
create table if not exists public.cc_push_config(key text primary key, value text not null);
alter table public.cc_push_config enable row level security;
revoke all on public.cc_push_config from public, anon, authenticated;
insert into public.cc_push_config(key,value) values
 ('function_url','https://yjbfditboewwpgyqzryd.supabase.co/functions/v1/send-push'),
 ('webhook_secret', replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-',''))
on conflict (key) do nothing;

-- Public key the app needs to subscribe (empty = push turned off in the app).
do $$ begin
 if exists(select 1 from information_schema.tables where table_schema='public' and table_name='app_settings')
    and not exists(select 1 from public.app_settings where key='vapid_public_key') then
  insert into public.app_settings(key,value) values('vapid_public_key','');
 end if;
exception when others then
 raise notice 'Could not add vapid_public_key to app_settings (%). Add it by hand.', sqlerrm;
end $$;

create or replace function public.cc_push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_customer uuid;
begin
 if auth.uid() is null then raise exception 'Sign in to turn on notifications'; end if;
 select id into v_customer from public.customers where auth_id=auth.uid() limit 1;
 if v_customer is null then raise exception 'Customer profile not found'; end if;
 if coalesce(p_endpoint,'') !~ '^https://' or coalesce(p_p256dh,'')='' or coalesce(p_auth,'')='' then
  raise exception 'Invalid push subscription';
 end if;
 insert into public.cc_push_subscriptions(endpoint,customer_id,p256dh,auth,user_agent)
  values(p_endpoint,v_customer,p_p256dh,p_auth,left(p_user_agent,300))
  on conflict (endpoint) do update set customer_id=excluded.customer_id, p256dh=excluded.p256dh,
   auth=excluded.auth, user_agent=excluded.user_agent, last_seen_at=now();
 return jsonb_build_object('ok',true);
end $$;

create or replace function public.cc_push_unsubscribe(p_endpoint text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null then raise exception 'Sign in first'; end if;
 delete from public.cc_push_subscriptions s using public.customers c
  where s.endpoint=p_endpoint and c.id=s.customer_id and c.auth_id=auth.uid();
 return jsonb_build_object('ok',true);
end $$;

-- Order status -> Edge Function. Never blocks or fails the order update.
create or replace function public.cc_push_on_order_status() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_url text; v_secret text;
begin
 if new.customer_id is null or new.status is not distinct from old.status then return new; end if;
 if new.status not in ('confirmed','baking','packed','shipped','out_for_delivery','delivered','cancelled') then return new; end if;
 if not exists(select 1 from public.cc_push_subscriptions where customer_id::text=new.customer_id::text) then return new; end if;
 select value into v_url from public.cc_push_config where key='function_url';
 select value into v_secret from public.cc_push_config where key='webhook_secret';
 if coalesce(v_url,'')='' then return new; end if;
 begin
  perform net.http_post(
   url:=v_url,
   body:=jsonb_build_object('type','order_status','order_id',new.id,'status',new.status),
   headers:=jsonb_build_object('Content-Type','application/json','x-cc-push-secret',v_secret));
 exception when others then
  raise warning 'push notify skipped: %', sqlerrm;
 end;
 return new;
end $$;

drop trigger if exists cc_push_order_status on public.orders;
create trigger cc_push_order_status
 after update of status on public.orders
 for each row execute function public.cc_push_on_order_status();

revoke all on function public.cc_push_on_order_status() from public, anon, authenticated;
revoke all on function public.cc_push_subscribe(text,text,text,text) from public, anon;
revoke all on function public.cc_push_unsubscribe(text) from public, anon;
grant execute on function public.cc_push_subscribe(text,text,text,text) to authenticated;
grant execute on function public.cc_push_unsubscribe(text) to authenticated;
commit;
