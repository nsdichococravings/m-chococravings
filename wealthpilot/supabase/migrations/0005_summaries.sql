-- WealthPilot migration 0005: pre-aggregated summary tables kept by trigger
-- Run the files in number order (Supabase > SQL Editor > paste > Run). Safe to re-run.
begin;
set local lock_timeout = '10s';

-- Dashboards read these small tables instead of scanning raw transactions.
create table if not exists fin.daily_household_summary(
  household_id  uuid not null,
  day           date not null,
  income_paise  bigint not null default 0,
  expense_paise bigint not null default 0,
  primary key (household_id, day)
);

create table if not exists fin.monthly_category_spend(
  household_id uuid not null,
  month        date not null,
  category_id  int not null,
  spend_paise  bigint not null default 0,
  txn_count    int not null default 0,
  primary key (household_id, month, category_id)
);

-- Kept current on every transaction write (one-row upserts, cheap).
-- Transfers (card payments, moving money between accounts) are not income or spend.
-- security definer: users can read the summaries but never write them directly.
create or replace function fin.apply_rollup(p_household uuid, p_day date, p_category int,
                                            p_amount bigint, p_sign int) returns void
language plpgsql security definer set search_path = fin as $$
begin
  if p_category is not null and exists (select 1 from fin.categories where id = p_category and bucket = 'transfer') then
    return;
  end if;
  insert into fin.daily_household_summary as d(household_id, day, income_paise, expense_paise)
  values (p_household, p_day, p_sign * greatest(p_amount, 0), p_sign * greatest(-p_amount, 0))
  on conflict (household_id, day) do update
    set income_paise  = d.income_paise  + excluded.income_paise,
        expense_paise = d.expense_paise + excluded.expense_paise;
  if p_category is not null and p_amount < 0 then
    insert into fin.monthly_category_spend as m(household_id, month, category_id, spend_paise, txn_count)
    values (p_household, date_trunc('month', p_day)::date, p_category, p_sign * -p_amount, p_sign)
    on conflict (household_id, month, category_id) do update
      set spend_paise = m.spend_paise + excluded.spend_paise,
          txn_count   = m.txn_count   + excluded.txn_count;
  end if;
end $$;
revoke execute on function fin.apply_rollup(uuid, date, int, bigint, int) from public;

create or replace function fin.trg_txn_rollup() returns trigger
language plpgsql security definer set search_path = fin as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    perform fin.apply_rollup(old.household_id, old.txn_date, old.category_id, old.amount_paise, -1);
  end if;
  if tg_op in ('UPDATE','INSERT') then
    perform fin.apply_rollup(new.household_id, new.txn_date, new.category_id, new.amount_paise, 1);
  end if;
  return null;
end $$;
drop trigger if exists transactions_rollup on fin.transactions;
create trigger transactions_rollup after insert or update or delete on fin.transactions
  for each row execute function fin.trg_txn_rollup();

notify pgrst, 'reload schema';
commit;
