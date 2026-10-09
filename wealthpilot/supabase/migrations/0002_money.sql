-- WealthPilot migration 0002: accounts, categories, transactions (partitioned by month)
-- Run the files in number order (Supabase > SQL Editor > paste > Run). Safe to re-run.
begin;
set local lock_timeout = '10s';

create table if not exists fin.accounts(
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references fin.households(id) on delete cascade,
  kind          text not null check (kind in ('bank','cash','wallet','credit_card','loan','investment')),
  name          text not null,
  institution   text,
  last4         char(4),                            -- never the full number
  balance_paise bigint not null default 0,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists accounts_household_idx on fin.accounts(household_id, kind) where is_active;

create table if not exists fin.categories(
  id           serial primary key,
  household_id uuid references fin.households(id) on delete cascade,  -- null = system default
  parent_id    int references fin.categories(id),
  name         text not null,
  bucket       text not null check (bucket in ('income','fixed','kids','daily','sinking','invest','discretionary','transfer')),
  unique nulls not distinct (household_id, name)
);

create table if not exists fin.transactions(
  id            uuid not null default gen_random_uuid(),
  household_id  uuid not null,
  account_id    uuid not null,
  txn_date      date not null,
  amount_paise  bigint not null,                    -- +income / -expense
  category_id   int,
  merchant      text,
  description   text,
  source        text not null default 'manual' check (source in ('manual','sms','email','aa','statement','import')),
  is_recurring  boolean not null default false,
  ai_confidence real,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  primary key (household_id, txn_date, id)          -- must include the partition key
) partition by range (txn_date);

-- List screen: newest first, keyset pagination, index-only for the list columns
create index if not exists transactions_list_idx on fin.transactions(household_id, txn_date desc, id desc)
  include (amount_paise, category_id, merchant);
-- Spend-by-category reports
create index if not exists transactions_category_idx on fin.transactions(household_id, category_id, txn_date);
-- Fuzzy merchant search ("swigy" finds "Swiggy")
create index if not exists transactions_merchant_trgm_idx on fin.transactions using gin (merchant gin_trgm_ops);
-- Categoriser queue: only the rows still waiting
create index if not exists transactions_uncategorised_idx on fin.transactions(household_id, created_at)
  where category_id is null;

-- Monthly partitions; pg_cron calls this on the 25th to create next month ahead of time
create or replace function fin.ensure_txn_partition(p_month date) returns void
language plpgsql security definer set search_path = fin as $$
declare
  s date := date_trunc('month', p_month);
  n text := 'transactions_' || to_char(s, 'YYYYMM');
begin
  execute format('create table if not exists fin.%I partition of fin.transactions for values from (%L) to (%L)',
                 n, s, (s + interval '1 month')::date);
  -- only reachable through fin.transactions, where Row Level Security applies
  execute format('revoke all on fin.%I from public', n);
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute format('revoke all on fin.%I from authenticated, anon', n);
  end if;
end $$;

create table if not exists fin.transactions_default partition of fin.transactions default;
select fin.ensure_txn_partition((date_trunc('month', current_date) + make_interval(months => m))::date)
from generate_series(-12, 2) m;

notify pgrst, 'reload schema';
commit;
