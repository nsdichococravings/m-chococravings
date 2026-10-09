-- WealthPilot migration 0010 (optional): nightly jobs
-- Needs the pg_cron extension: Supabase > Database > Extensions > enable "pg_cron", then run this.
-- Times are UTC (00:15 UTC = 05:45 IST). Safe to re-run.

-- Create next months' transaction partitions ahead of time (25th of every month)
select cron.schedule('wealthpilot-partitions', '0 2 25 * *',
  $$select fin.ensure_txn_partition((date_trunc('month', current_date) + interval '1 month')::date);
    select fin.ensure_txn_partition((date_trunc('month', current_date) + interval '2 months')::date)$$);

-- Create upcoming bill dues and mark missed ones overdue (every night)
select cron.schedule('wealthpilot-bill-dues', '15 0 * * *', $$select fin.roll_bill_occurrences()$$);

-- Remove AI insights that have expired (every night)
select cron.schedule('wealthpilot-expire-insights', '30 0 * * *',
  $$update fin.ai_insights set status = 'expired' where status = 'new' and valid_until < now()$$);
