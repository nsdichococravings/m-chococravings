-- How many customers / phones a "Send Notification" will reach, for the
-- admin Send Notification screen (push-broadcast-patch.js). Admin only.
-- Run after 20260950_push_notifications.sql. Safe to re-run.
begin;
set local lock_timeout = '10s';
do $$ begin
 if to_regclass('public.cc_push_subscriptions') is null then raise exception 'Run migrations/20260950_push_notifications.sql first.'; end if;
end $$;

create or replace function public.cc_push_reach() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
 if auth.uid() is null or public.cc_loyalty_role() <> 'admin' then
  raise exception 'Admin access required' using errcode='42501';
 end if;
 return (select jsonb_build_object('customers', count(distinct customer_id), 'devices', count(*),
   'new_7d', count(*) filter (where created_at >= now() - interval '7 days'))
  from public.cc_push_subscriptions);
end $$;
revoke all on function public.cc_push_reach() from public, anon;
grant execute on function public.cc_push_reach() to authenticated;

notify pgrst, 'reload schema';
commit;
