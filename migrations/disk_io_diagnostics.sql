-- READ ONLY. Run these sections separately in Supabase SQL Editor.
-- No application-table scans, maintenance jobs, or EXPLAIN ANALYZE.

-- 1. Cumulative database IO counters (not the remaining Supabase burst budget).
select datname,stats_reset,blks_read,blks_hit,temp_files,temp_bytes,
       blk_read_time,blk_write_time
from pg_stat_database where datname=current_database();

-- 2. Check where the query-statistics extension is installed.
select e.extname,n.nspname as extension_schema
from pg_extension e join pg_namespace n on n.oid=e.extnamespace
where e.extname='pg_stat_statements';

-- 3. Run only if step 2 returns pg_stat_statements in public or extensions.
-- These are cumulative counters since statistics were reset, not a current rate.
-- Query IDs avoid printing customer values or SQL literals in shared results.
set search_path=public,extensions,pg_catalog;
select queryid,calls,total_exec_time,mean_exec_time,rows,
       shared_blks_read,shared_blks_hit,shared_blks_dirtied,shared_blks_written,
       temp_blks_read,temp_blks_written
from pg_stat_statements
where dbid=(select oid from pg_database where datname=current_database())
order by (shared_blks_read+shared_blks_written+temp_blks_read+temp_blks_written) desc
limit 15;

-- 4. Existing index definitions: inspection only, no index builds.
select tablename,indexname,indexdef from pg_indexes
where schemaname='public' and tablename in
('store_orders','material_purchases','cc_production_batches','cc_production_requests')
order by tablename,indexname;
