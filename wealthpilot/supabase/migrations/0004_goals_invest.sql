-- WealthPilot migration 0004: children, goals, budgets, investments
-- Run the files in number order (Supabase > SQL Editor > paste > Run). Safe to re-run.
begin;
set local lock_timeout = '10s';

create table if not exists fin.children(
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references fin.households(id) on delete cascade,
  name         text not null,
  birth_date   date,
  school       text,
  grade        text
);
create index if not exists children_household_idx on fin.children(household_id);
do $$ begin
  alter table fin.recurring_bills add constraint recurring_bills_child_fk
    foreign key (child_id) references fin.children(id) on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists fin.goals(
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
create index if not exists goals_active_idx on fin.goals(household_id, target_date) where status = 'active';

create table if not exists fin.goal_contributions(
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  goal_id      uuid not null references fin.goals(id) on delete cascade,
  contrib_date date not null,
  amount_paise bigint not null
);
create index if not exists goal_contributions_goal_idx on fin.goal_contributions(goal_id, contrib_date desc);

create table if not exists fin.budgets(
  household_id uuid not null references fin.households(id) on delete cascade,
  category_id  int not null references fin.categories(id),
  month        date not null check (month = date_trunc('month', month)),
  limit_paise  bigint not null,
  primary key (household_id, month, category_id)
);

create table if not exists fin.holdings(
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
create index if not exists holdings_household_idx on fin.holdings(household_id, asset_class) include (current_paise, sip_paise);
create index if not exists holdings_symbol_idx on fin.holdings(symbol) where symbol is not null;

create table if not exists fin.asset_prices(
  symbol      text not null,
  price_date  date not null,
  price       numeric(20,6) not null,
  primary key (symbol, price_date)
);

notify pgrst, 'reload schema';
commit;
