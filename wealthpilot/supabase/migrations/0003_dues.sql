-- WealthPilot migration 0003: bills, loans / EMIs, credit cards
-- Run the files in number order (Supabase > SQL Editor > paste > Run). Safe to re-run.
begin;
set local lock_timeout = '10s';

create table if not exists fin.recurring_bills(
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
create index if not exists recurring_bills_due_idx on fin.recurring_bills(household_id, next_due_date) where is_active;

create table if not exists fin.bill_occurrences(
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
create index if not exists bill_occurrences_open_idx on fin.bill_occurrences(household_id, due_date)
  include (bill_id, amount_paise) where status in ('due','overdue');

create table if not exists fin.loans(
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
  paid_through      date,                           -- EMI due date covered by the last payment
  status            text not null default 'active' check (status in ('active','closed'))
);
create index if not exists loans_active_idx on fin.loans(household_id) include (emi_paise, emi_day) where status = 'active';

create table if not exists fin.loan_schedule(
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
create index if not exists loan_schedule_unpaid_idx on fin.loan_schedule(due_date) include (loan_id, emi_paise) where not paid;

create table if not exists fin.credit_cards(
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
create index if not exists credit_cards_household_idx on fin.credit_cards(household_id);

create table if not exists fin.card_statements(
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
create index if not exists card_statements_open_idx on fin.card_statements(household_id, due_date)
  include (card_id, total_due_paise, min_due_paise) where status in ('open','partial','overdue');


alter table fin.loans add column if not exists paid_through date;

notify pgrst, 'reload schema';
commit;
