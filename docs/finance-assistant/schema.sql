-- WealthPilot: AI personal finance assistant, database schema (Supabase / Postgres 16)
-- Design notes are in ARCHITECTURE.md (sections 5 and 7).
--
-- Conventions
--  * Money is bigint PAISE (₹1 = 100). Exact maths, no float rounding.
--  * Every tenant row has household_id. Indexes lead with household_id so the
--    RLS filter and the query filter use the same index.
--  * High-volume tables are range-partitioned by month.
--  * RLS on every table; membership checked once per query through
--    is_member()/can_write() (security definer, stable).
-- Requires: pgcrypto (gen_random_uuid), pg_trgm. Optional on Supabase: pg_cron, pgmq.

begin;

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;

create schema if not exists fin;
set local search_path = fin, public;

-- ---------------------------------------------------------------------------
-- 1. Plans, households, members, subscriptions
-- ---------------------------------------------------------------------------
create table fin.plans(
  code          text primary key,                 -- free | plus | family | pro
  name          text not null,
  price_paise   bigint not null default 0,
  billing_cycle text not null default 'month' check (billing_cycle in ('month','year')),
  features      jsonb not null default '{}',      -- {"max_members":6,"ai_msgs":1000,"agents":["cost_cutter"]}
  active        boolean not null default true
);

create table fin.profiles(
  user_id        uuid primary key,                 -- = auth.users.id
  full_name      text,
  phone          text,
  currency       char(3) not null default 'INR',
  timezone       text not null default 'Asia/Kolkata',
  platform_role  text not null default 'user' check (platform_role in ('user','support','super_admin')),
  ai_consent     boolean not null default false,
  created_at     timestamptz not null default now()
);

create table fin.households(
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_id    uuid not null references fin.profiles(user_id),
  plan_code   text not null default 'free' references fin.plans(code),
  settings    jsonb not null default '{"buffer_pct":5,"working_days_per_month":26,"real_return_pct":5,"swr_multiple":25}',
  created_at  timestamptz not null default now()
);
create index households_owner_idx on fin.households(owner_id);

create table fin.household_members(
  household_id uuid not null references fin.households(id) on delete cascade,
  user_id      uuid not null references fin.profiles(user_id) on delete cascade,
  role         text not null check (role in ('owner','partner','member','viewer','advisor')),
  expires_at   timestamptz,                         -- advisor access is time-boxed
  created_at   timestamptz not null default now(),
  primary key (household_id, user_id)
);
-- "which households am I in?" is asked on every request
create index household_members_user_idx on fin.household_members(user_id) include (household_id, role);

create table fin.subscriptions(
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references fin.households(id) on delete cascade,
  plan_code          text not null references fin.plans(code),
  status             text not null check (status in ('trialing','active','past_due','cancelled')),
  provider           text not null check (provider in ('razorpay','stripe','manual')),
  provider_sub_id    text unique,
  current_period_end timestamptz not null,
  created_at         timestamptz not null default now()
);
create unique index subscriptions_one_live_idx on fin.subscriptions(household_id)
  where status in ('trialing','active','past_due');

-- ---------------------------------------------------------------------------
-- 2. Accounts, categories, transactions (partitioned)
-- ---------------------------------------------------------------------------
create table fin.accounts(
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
create index accounts_household_idx on fin.accounts(household_id, kind) where is_active;

create table fin.categories(
  id           serial primary key,
  household_id uuid references fin.households(id) on delete cascade,  -- null = system default
  parent_id    int references fin.categories(id),
  name         text not null,
  bucket       text not null check (bucket in ('income','fixed','kids','daily','sinking','invest','discretionary','transfer')),
  unique nulls not distinct (household_id, name)
);

create table fin.transactions(
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
  created_by    uuid,
  created_at    timestamptz not null default now(),
  primary key (household_id, txn_date, id)          -- must include the partition key
) partition by range (txn_date);

-- List screen: newest first, keyset pagination, index-only for the list columns
create index transactions_list_idx on fin.transactions(household_id, txn_date desc, id desc)
  include (amount_paise, category_id, merchant);
-- Spend-by-category reports
create index transactions_category_idx on fin.transactions(household_id, category_id, txn_date);
-- Fuzzy merchant search ("swigy" finds "Swiggy")
create index transactions_merchant_trgm_idx on fin.transactions using gin (merchant gin_trgm_ops);
-- Categoriser queue: only the rows still waiting
create index transactions_uncategorised_idx on fin.transactions(household_id, created_at)
  where category_id is null;

-- Monthly partitions; pg_cron calls this on the 25th to create next month ahead of time
create or replace function fin.ensure_txn_partition(p_month date) returns void
language plpgsql as $$
declare
  s date := date_trunc('month', p_month);
  n text := 'transactions_' || to_char(s, 'YYYYMM');
begin
  execute format('create table if not exists fin.%I partition of fin.transactions for values from (%L) to (%L)',
                 n, s, (s + interval '1 month')::date);
end $$;

create table fin.transactions_default partition of fin.transactions default;
select fin.ensure_txn_partition((date_trunc('month', current_date) + make_interval(months => m))::date)
from generate_series(-12, 2) m;

-- ---------------------------------------------------------------------------
-- 3. Bills, loans/EMIs, credit cards
-- ---------------------------------------------------------------------------
create table fin.recurring_bills(
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references fin.households(id) on delete cascade,
  name          text not null,                      -- "Electricity", "Netflix", "School fee - Aarav"
  category_id   int references fin.categories(id),
  frequency     text not null check (frequency in ('weekly','monthly','quarterly','half_yearly','yearly')),
  amount_paise  bigint not null,                    -- expected; AI predicts variable ones
  due_day       smallint check (due_day between 1 and 31),
  next_due_date date not null,
  autopay       boolean not null default false,
  child_id      uuid,                               -- set for school bills
  is_active     boolean not null default true
);
create index recurring_bills_due_idx on fin.recurring_bills(household_id, next_due_date) where is_active;

create table fin.bill_occurrences(
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references fin.households(id) on delete cascade,
  bill_id        uuid not null references fin.recurring_bills(id) on delete cascade,
  due_date       date not null,
  amount_paise   bigint not null,
  status         text not null default 'due' check (status in ('due','paid','skipped','overdue')),
  paid_on        date,
  transaction_id uuid,
  unique (bill_id, due_date)
);
-- The hottest query: "what's due soon?". Partial index stays tiny.
create index bill_occurrences_open_idx on fin.bill_occurrences(household_id, due_date)
  include (bill_id, amount_paise) where status in ('due','overdue');

create table fin.loans(
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references fin.households(id) on delete cascade,
  account_id        uuid references fin.accounts(id),
  loan_type         text not null check (loan_type in ('home','car','personal','education','gold','business','other')),
  lender            text not null,
  principal_paise   bigint not null,
  interest_rate_bps int not null,                   -- 8.65% = 865
  tenure_months     int not null,
  emi_paise         bigint not null,
  emi_day           smallint not null check (emi_day between 1 and 31),
  start_date        date not null,
  outstanding_paise bigint not null,
  status            text not null default 'active' check (status in ('active','closed'))
);
create index loans_active_idx on fin.loans(household_id) include (emi_paise, emi_day) where status = 'active';

create table fin.loan_schedule(
  loan_id          uuid not null references fin.loans(id) on delete cascade,
  installment_no   int not null,
  due_date         date not null,
  emi_paise        bigint not null,
  principal_paise  bigint not null,
  interest_paise   bigint not null,
  balance_paise    bigint not null,
  paid             boolean not null default false,
  primary key (loan_id, installment_no)
);
create index loan_schedule_unpaid_idx on fin.loan_schedule(due_date) include (loan_id, emi_paise) where not paid;

create table fin.credit_cards(
  id                uuid primary key default gen_random_uuid(),
  household_id      uuid not null references fin.households(id) on delete cascade,
  account_id        uuid not null references fin.accounts(id) on delete cascade,
  issuer            text not null,
  last4             char(4) not null,
  credit_limit_paise bigint not null,
  statement_day     smallint not null check (statement_day between 1 and 31),
  due_day           smallint not null check (due_day between 1 and 31),
  annual_fee_paise  bigint not null default 0,
  apr_bps           int                              -- interest if not paid in full
);
create index credit_cards_household_idx on fin.credit_cards(household_id);

create table fin.card_statements(
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references fin.households(id) on delete cascade,
  card_id         uuid not null references fin.credit_cards(id) on delete cascade,
  statement_date  date not null,
  due_date        date not null,
  total_due_paise bigint not null,
  min_due_paise   bigint not null,
  paid_paise      bigint not null default 0,
  status          text not null default 'open' check (status in ('open','paid','partial','overdue')),
  pdf_path        text,                              -- Storage object
  unique (card_id, statement_date)
);
create index card_statements_open_idx on fin.card_statements(household_id, due_date)
  include (card_id, total_due_paise, min_due_paise) where status in ('open','partial','overdue');

-- ---------------------------------------------------------------------------
-- 4. Kids, goals, budgets, investments
-- ---------------------------------------------------------------------------
create table fin.children(
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references fin.households(id) on delete cascade,
  name         text not null,
  birth_date   date,
  school       text,
  grade        text
);
create index children_household_idx on fin.children(household_id);
alter table fin.recurring_bills add constraint recurring_bills_child_fk
  foreign key (child_id) references fin.children(id) on delete set null;

create table fin.goals(
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references fin.households(id) on delete cascade,
  kind               text not null check (kind in ('financial_freedom','emergency','education','holiday','festival','purchase','debt_free','other')),
  name               text not null,                 -- "Goa trip May 2027", "Aarav college 2036"
  child_id           uuid references fin.children(id) on delete set null,
  target_paise       bigint not null,
  target_date        date,
  inflation_bps      int not null default 600,
  saved_paise        bigint not null default 0,
  monthly_plan_paise bigint not null default 0,     -- computed by the engine
  priority           smallint not null default 3,
  status             text not null default 'active' check (status in ('active','achieved','paused'))
);
create index goals_active_idx on fin.goals(household_id, target_date) where status = 'active';

create table fin.goal_contributions(
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  goal_id      uuid not null references fin.goals(id) on delete cascade,
  contrib_date date not null,
  amount_paise bigint not null
);
create index goal_contributions_goal_idx on fin.goal_contributions(goal_id, contrib_date desc);

create table fin.budgets(
  household_id uuid not null references fin.households(id) on delete cascade,
  category_id  int not null references fin.categories(id),
  month        date not null check (month = date_trunc('month', month)),
  limit_paise  bigint not null,
  primary key (household_id, month, category_id)
);

create table fin.holdings(
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references fin.households(id) on delete cascade,
  asset_class   text not null check (asset_class in ('equity_mf','debt_mf','stock','fd','rd','ppf','epf','nps','gold','real_estate','crypto','other')),
  symbol        text,                               -- ISIN / ticker / scheme code
  name          text not null,
  units         numeric(20,6),
  invested_paise bigint not null,
  current_paise bigint not null,                    -- refreshed from prices nightly
  goal_id       uuid references fin.goals(id) on delete set null,
  sip_paise     bigint not null default 0,
  sip_day       smallint,
  updated_at    timestamptz not null default now()
);
create index holdings_household_idx on fin.holdings(household_id, asset_class) include (current_paise, sip_paise);
create index holdings_symbol_idx on fin.holdings(symbol) where symbol is not null;

create table fin.asset_prices(
  symbol      text not null,
  price_date  date not null,
  price       numeric(20,6) not null,
  primary key (symbol, price_date)
);

-- ---------------------------------------------------------------------------
-- 5. Pre-aggregated tables (dashboards read these, not raw transactions)
-- ---------------------------------------------------------------------------
create table fin.daily_household_summary(
  household_id  uuid not null,
  day           date not null,
  income_paise  bigint not null default 0,
  expense_paise bigint not null default 0,
  primary key (household_id, day)
);

create table fin.monthly_category_spend(
  household_id uuid not null,
  month        date not null,
  category_id  int not null,
  spend_paise  bigint not null default 0,
  txn_count    int not null default 0,
  primary key (household_id, month, category_id)
);

-- Keep both summaries current on every write (one row upsert, cheap)
create or replace function fin.apply_rollup(p_household uuid, p_day date, p_category int,
                                            p_amount bigint, p_sign int) returns void
language sql as $$
  insert into fin.daily_household_summary as d(household_id, day, income_paise, expense_paise)
  values (p_household, p_day, p_sign * greatest(p_amount, 0), p_sign * greatest(-p_amount, 0))
  on conflict (household_id, day) do update
    set income_paise  = d.income_paise  + excluded.income_paise,
        expense_paise = d.expense_paise + excluded.expense_paise;
  insert into fin.monthly_category_spend as m(household_id, month, category_id, spend_paise, txn_count)
  select p_household, date_trunc('month', p_day)::date, p_category, p_sign * -p_amount, p_sign
  where p_category is not null and p_amount < 0
  on conflict (household_id, month, category_id) do update
    set spend_paise = m.spend_paise + excluded.spend_paise,
        txn_count   = m.txn_count   + excluded.txn_count;
$$;

create or replace function fin.trg_txn_rollup() returns trigger
language plpgsql as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    perform fin.apply_rollup(old.household_id, old.txn_date, old.category_id, old.amount_paise, -1);
  end if;
  if tg_op in ('UPDATE','INSERT') then
    perform fin.apply_rollup(new.household_id, new.txn_date, new.category_id, new.amount_paise, 1);
  end if;
  return null;
end $$;
create trigger transactions_rollup after insert or update or delete on fin.transactions
  for each row execute function fin.trg_txn_rollup();

-- ---------------------------------------------------------------------------
-- 6. AI, notifications, audit (append-only, partitioned, BRIN on time)
-- ---------------------------------------------------------------------------
create table fin.ai_agent_runs(
  id            uuid not null default gen_random_uuid(),
  household_id  uuid not null,
  agent         text not null,                      -- categoriser | bill_sentinel | cost_cutter | forecaster | earning_coach | advisor | chat
  input_hash    text not null,                      -- skip the run if inputs did not change
  model         text not null,
  status        text not null check (status in ('queued','running','done','failed')),
  input_tokens  int, output_tokens int, cache_read_tokens int,
  cost_micro_usd bigint,
  duration_ms   int,
  error         text,
  created_at    timestamptz not null default now(),
  primary key (created_at, id)
) partition by range (created_at);
create table fin.ai_agent_runs_default partition of fin.ai_agent_runs default;
create index ai_agent_runs_household_idx on fin.ai_agent_runs(household_id, agent, created_at desc);
create index ai_agent_runs_time_brin on fin.ai_agent_runs using brin (created_at);

create table fin.ai_insights(
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references fin.households(id) on delete cascade,
  agent        text not null,
  kind         text not null,                       -- saving | due_alert | forecast | coach | invest
  title        text not null,
  body         text not null,
  payload      jsonb not null default '{}',         -- structured output from the agent
  saving_paise bigint,                              -- monthly ₹ the insight can save
  severity     smallint not null default 2,         -- 1 info, 2 tip, 3 warning, 4 urgent
  status       text not null default 'new' check (status in ('new','accepted','dismissed','expired')),
  valid_until  timestamptz,
  created_at   timestamptz not null default now()
);
create index ai_insights_feed_idx on fin.ai_insights(household_id, severity desc, created_at desc) where status = 'new';

create table fin.ai_usage(
  household_id uuid not null references fin.households(id) on delete cascade,
  month        date not null,
  messages     int not null default 0,
  tokens       bigint not null default 0,
  primary key (household_id, month)
);

create table fin.notifications(
  id           uuid not null default gen_random_uuid(),
  household_id uuid not null,
  user_id      uuid not null,
  channel      text not null check (channel in ('push','email','whatsapp','in_app')),
  title        text not null,
  body         text not null,
  link         text,
  read_at      timestamptz,
  created_at   timestamptz not null default now(),
  primary key (created_at, id)
) partition by range (created_at);
create table fin.notifications_default partition of fin.notifications default;
create index notifications_unread_idx on fin.notifications(user_id, created_at desc) where read_at is null;

create table fin.audit_log(
  id          bigint generated always as identity,
  household_id uuid,
  actor_id    uuid,
  table_name  text not null,
  op          text not null,
  row_id      text,
  diff        jsonb,
  created_at  timestamptz not null default now(),
  primary key (created_at, id)
) partition by range (created_at);
create table fin.audit_log_default partition of fin.audit_log default;
create index audit_log_time_brin on fin.audit_log using brin (created_at);
create index audit_log_household_idx on fin.audit_log(household_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 7. Security: membership helpers + RLS on every tenant table
-- ---------------------------------------------------------------------------
-- Supabase provides auth.uid(). Wrapped as (select auth.uid()) so Postgres
-- evaluates it once per statement instead of once per row.
create or replace function fin.is_member(p_household uuid) returns boolean
language sql stable security definer set search_path = fin as $$
  select exists(select 1 from fin.household_members m
                where m.household_id = p_household and m.user_id = (select auth.uid())
                  and (m.expires_at is null or m.expires_at > now()));
$$;

create or replace function fin.can_write(p_household uuid) returns boolean
language sql stable security definer set search_path = fin as $$
  select exists(select 1 from fin.household_members m
                where m.household_id = p_household and m.user_id = (select auth.uid())
                  and m.role in ('owner','partner','member'));
$$;

create or replace function fin.has_feature(p_household uuid, p_feature text) returns boolean
language sql stable security definer set search_path = fin as $$
  select coalesce((p.features -> 'flags' ? p_feature), false)
  from fin.households h join fin.plans p on p.code = h.plan_code where h.id = p_household;
$$;

do $$
declare t text;
begin
  foreach t in array array['accounts','transactions','recurring_bills','bill_occurrences','loans',
    'credit_cards','card_statements','children','goals','goal_contributions','budgets','holdings',
    'daily_household_summary','monthly_category_spend','ai_insights','ai_usage','subscriptions']
  loop
    execute format('alter table fin.%I enable row level security', t);
    execute format('create policy %I on fin.%I for select to authenticated using (fin.is_member(household_id))', t||'_read', t);
    execute format('create policy %I on fin.%I for all to authenticated using (fin.can_write(household_id)) with check (fin.can_write(household_id))', t||'_write', t);
  end loop;
end $$;

alter table fin.households enable row level security;
create policy households_read on fin.households for select to authenticated using (fin.is_member(id));
create policy households_owner on fin.households for all to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

alter table fin.household_members enable row level security;
create policy members_read on fin.household_members for select to authenticated using (fin.is_member(household_id));

alter table fin.profiles enable row level security;
create policy profiles_self on fin.profiles for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table fin.notifications enable row level security;
create policy notifications_self on fin.notifications for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- Child tables without household_id are only reachable through their parent
alter table fin.loan_schedule enable row level security;
create policy loan_schedule_read on fin.loan_schedule for select to authenticated
  using (exists (select 1 from fin.loans l where l.id = loan_id and fin.is_member(l.household_id)));

-- ai_agent_runs, audit_log, asset_prices: service role only (RLS on, no policies),
-- except prices which everyone may read.
alter table fin.ai_agent_runs enable row level security;
alter table fin.audit_log enable row level security;
alter table fin.asset_prices enable row level security;
create policy asset_prices_read on fin.asset_prices for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- 8. Earning target engine (deterministic, see EARNING-TARGET.md)
-- ---------------------------------------------------------------------------
create or replace function fin.compute_earning_target(p_household uuid)
returns jsonb language sql stable security invoker set search_path = fin as $$
with s as (
  select (settings->>'buffer_pct')::numeric           as buffer_pct,
         (settings->>'working_days_per_month')::numeric as wd
  from fin.households where id = p_household
),
freq as (  -- monthly equivalent of each recurring bill, split by bucket
  select coalesce(c.bucket, 'fixed') as bucket,
         sum(b.amount_paise * case b.frequency when 'weekly' then 52.0/12 when 'monthly' then 1
                                when 'quarterly' then 1/3.0 when 'half_yearly' then 1/6.0 else 1/12.0 end) as amt
  from fin.recurring_bills b left join fin.categories c on c.id = b.category_id
  where b.household_id = p_household and b.is_active
  group by 1
),
emi   as (select coalesce(sum(emi_paise),0) amt from fin.loans where household_id = p_household and status = 'active'),
daily as (  -- average daily-needs spend over the last 90 days × 365/12
  select coalesce(sum(m.spend_paise),0) / 3.0 amt
  from fin.monthly_category_spend m join fin.categories c on c.id = m.category_id
  where m.household_id = p_household and c.bucket = 'daily'
    and m.month >= date_trunc('month', current_date) - interval '3 months'
    and m.month <  date_trunc('month', current_date)
),
sink  as (  -- what each dated goal needs per month from now
  select coalesce(sum(greatest(target_paise - saved_paise, 0)
         / greatest(1, (extract(year from age(target_date, current_date))*12
                        + extract(month from age(target_date, current_date)))::numeric)), 0) amt
  from fin.goals where household_id = p_household and status = 'active'
    and kind <> 'financial_freedom' and target_date > current_date
),
inv   as (select coalesce(sum(sip_paise),0) amt from fin.holdings where household_id = p_household),
tot as (
  select (select coalesce(sum(amt) filter (where bucket in ('fixed','discretionary')),0) from freq) + (select amt from emi) as fixed,
         (select coalesce(sum(amt) filter (where bucket = 'kids'),0) from freq)  as kids,
         (select amt from daily) as daily,
         (select coalesce(sum(amt) filter (where bucket = 'sinking'),0) from freq) + (select amt from sink) as sinking,
         (select coalesce(sum(amt) filter (where bucket = 'invest'),0) from freq)  + (select amt from inv)  as invest
)
select jsonb_build_object(
  'breakdown_paise', jsonb_build_object('fixed', round(fixed), 'kids', round(kids), 'daily', round(daily),
                                        'sinking', round(sinking), 'invest', round(invest)),
  'monthly_paise', round(m),
  'daily_paise',   ceil(m * 12 / 365),
  'weekly_paise',  ceil(m * 12 / 365) * 7,
  'working_day_paise', ceil(m / s.wd))
from tot, s,
     lateral (select (fixed + kids + daily + sinking + invest) * (1 + s.buffer_pct / 100) as m) x;
$$;

-- One round trip for the Home screen
create or replace function fin.get_home(p_household uuid)
returns jsonb language sql stable security invoker set search_path = fin as $$
select jsonb_build_object(
  'target', fin.compute_earning_target(p_household),
  'earned_this_week_paise', (select coalesce(sum(income_paise),0) from fin.daily_household_summary
                             where household_id = p_household and day >= date_trunc('week', current_date)),
  'dues_7d', (select coalesce(jsonb_agg(d order by d.due_date), '[]') from (
      select 'bill' as type, b.name, o.amount_paise, o.due_date
        from fin.bill_occurrences o join fin.recurring_bills b on b.id = o.bill_id
       where o.household_id = p_household and o.status in ('due','overdue') and o.due_date <= current_date + 7
      union all
      select 'card', c.issuer || ' ••' || c.last4, s.total_due_paise - s.paid_paise, s.due_date
        from fin.card_statements s join fin.credit_cards c on c.id = s.card_id
       where s.household_id = p_household and s.status in ('open','partial','overdue') and s.due_date <= current_date + 7
    ) d),
  'insights', (select coalesce(jsonb_agg(i), '[]') from (
      select id, title, body, saving_paise, severity from fin.ai_insights
       where household_id = p_household and status = 'new'
       order by severity desc, created_at desc limit 3) i)
);
$$;

-- Keyset pagination for the transaction list (no OFFSET)
create or replace function fin.list_transactions(p_household uuid, p_before_date date default null,
                                                 p_before_id uuid default null, p_limit int default 50)
returns setof fin.transactions language sql stable security invoker set search_path = fin as $$
  select * from fin.transactions
  where household_id = p_household
    and (p_before_date is null or (txn_date, id) < (p_before_date, p_before_id))
  order by txn_date desc, id desc
  limit least(p_limit, 200);
$$;

commit;

-- ---------------------------------------------------------------------------
-- Scheduled jobs (Supabase pg_cron), run after the schema is in place
-- ---------------------------------------------------------------------------
-- select cron.schedule('txn-partitions', '0 2 25 * *',
--   $$select fin.ensure_txn_partition((date_trunc('month', current_date) + interval '2 months')::date)$$);
-- select cron.schedule('bill-occurrences', '15 0 * * *', $$select fin.roll_bill_occurrences()$$);  -- phase 1: creates next due rows
-- select cron.schedule('agent-bill-sentinel', '30 1 * * *', $$select pgmq.send('ai_jobs', '{"agent":"bill_sentinel"}')$$);  -- 07:00 IST
-- select cron.schedule('agent-cost-cutter',   '30 2 * * 0', $$select pgmq.send('ai_jobs', '{"agent":"cost_cutter"}')$$);
-- select cron.schedule('agent-forecaster',    '30 21 * * *', $$select pgmq.send('ai_jobs', '{"agent":"forecaster"}')$$);
