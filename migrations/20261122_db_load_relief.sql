-- Lighter database load (app was slow; pg_stat_statements showed why).
--
-- 1. cc_product_ratings ran on every app open, for every customer, and
--    joined ALL orders and order items on text-cast ids (no index can help),
--    ~260 ms of full-table reading each time. The answer only changes when
--    someone rates an order, so it is now kept in a small table and worked
--    out again only after a new rating (or at most every 30 minutes).
--    Same result shape, so the app needs no change.
--
-- 2. pg_cron's run history (cron.job_run_details) is never emptied, and its
--    writes were taking 0.5–13 s. Old history is removed now and every night.
--
-- Safe to run more than once.
begin;

create table if not exists public.cc_product_ratings_cache(
 product_id text primary key,
 avg_stars numeric,
 rating_count int
);
alter table public.cc_product_ratings_cache enable row level security;
revoke all on public.cc_product_ratings_cache from public, anon, authenticated;

create table if not exists public.cc_cache_meta(
 key text primary key,
 refreshed_at timestamptz
);
alter table public.cc_cache_meta enable row level security;
revoke all on public.cc_cache_meta from public, anon, authenticated;

create or replace function public.cc_product_ratings() returns table(product_id text, avg_stars numeric, rating_count int)
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_at timestamptz;
begin
 select refreshed_at into v_at from public.cc_cache_meta where key = 'product_ratings';
 -- Only one caller works it out; everyone else reads the saved copy.
 if (v_at is null or v_at < now() - interval '30 minutes') and pg_try_advisory_xact_lock(hashtext('cc_product_ratings')) then
  delete from public.cc_product_ratings_cache;
  insert into public.cc_product_ratings_cache(product_id, avg_stars, rating_count)
  select oi.product_id::text, round(avg(r.stars)::numeric, 1), count(distinct r.order_id)::int
    from public.cc_order_ratings r
    join public.order_items oi on oi.order_id::text = r.order_id
   where oi.product_id is not null
   group by oi.product_id::text;
  insert into public.cc_cache_meta(key, refreshed_at) values ('product_ratings', now())
   on conflict (key) do update set refreshed_at = excluded.refreshed_at;
 end if;
 return query select c.product_id, c.avg_stars, c.rating_count from public.cc_product_ratings_cache c;
end $$;
revoke all on function public.cc_product_ratings() from public;
grant execute on function public.cc_product_ratings() to anon, authenticated;

-- A new or changed rating makes the next call work it out again.
create or replace function public.cc_product_ratings_stale() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 update public.cc_cache_meta set refreshed_at = null where key = 'product_ratings';
 return null;
end $$;
drop trigger if exists cc_product_ratings_stale on public.cc_order_ratings;
create trigger cc_product_ratings_stale after insert or update or delete on public.cc_order_ratings
 for each statement execute function public.cc_product_ratings_stale();

-- Cron history: keep 2 days, clean up every night at 03:17.
do $$ begin
 if exists(select 1 from information_schema.tables where table_schema = 'cron' and table_name = 'job_run_details') then
  execute 'delete from cron.job_run_details where coalesce(end_time, start_time) < now() - interval ''2 days''';
  perform cron.schedule('cc-cron-history-cleanup', '17 3 * * *',
   $c$delete from cron.job_run_details where coalesce(end_time, start_time) < now() - interval '2 days'$c$);
 end if;
end $$;

commit;
