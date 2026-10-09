-- WealthPilot migration 0008: the money engine and the functions the screens call
--  * compute_earning_target  how much to earn per day / week / month (EARNING-TARGET.md)
--  * compute_freedom         FI number, Freedom %, Freedom Date
--  * get_home / get_dues     one call per screen
--  * pay_bill / pay_emi / pay_card   mark a due as paid and record the transaction
--  * roll_bill_occurrences   creates upcoming bill dues (also run nightly by 0010_cron.sql)
--  * bump_ai_usage           counts AI messages against the plan limit
-- All screen functions are security invoker, so Row Level Security still applies.
-- Run the files in number order (Supabase > SQL Editor > paste > Run). Safe to re-run.
begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- Date helpers
-- ---------------------------------------------------------------------------
-- Next date (on or after p_from) that falls on day p_day of a month; the 31st becomes the month's last day
create or replace function fin.next_day_of_month(p_day int, p_from date) returns date
language sql immutable as $$
  with m as (select date_trunc('month', p_from)::date as m0)
  select case when d0 >= p_from then d0 else d1 end
  from m, lateral (
    select (m0 + least(p_day, extract(day from (m0 + interval '1 month - 1 day'))::int) - 1) as d0,
           ((m0 + interval '1 month')::date
             + least(p_day, extract(day from (m0 + interval '2 months - 1 day'))::int) - 1) as d1
  ) x;
$$;

create or replace function fin.next_due(p_date date, p_frequency text) returns date
language sql immutable as $$
  select (p_date + case p_frequency when 'weekly' then interval '7 days' when 'monthly' then interval '1 month'
                     when 'quarterly' then interval '3 months' when 'half_yearly' then interval '6 months'
                     else interval '1 year' end)::date;
$$;

create or replace function fin.monthly_factor(p_frequency text) returns numeric
language sql immutable as $$
  select case p_frequency when 'weekly' then 52.0/12 when 'monthly' then 1 when 'quarterly' then 1/3.0
                          when 'half_yearly' then 1/6.0 else 1/12.0 end;
$$;

create or replace function fin.loan_next_due(l fin.loans) returns date
language sql stable as $$
  select fin.next_day_of_month(l.emi_day, coalesce(l.paid_through + 1, greatest(l.start_date, current_date)));
$$;

-- ---------------------------------------------------------------------------
-- Loans: a new loan is treated as paid up to its last EMI date
-- ---------------------------------------------------------------------------
create or replace function fin.trg_loan_defaults() returns trigger
language plpgsql as $$
begin
  if new.paid_through is null then
    new.paid_through := (fin.next_day_of_month(new.emi_day, current_date) - interval '1 month')::date;
    if new.paid_through < new.start_date then new.paid_through := new.start_date - 1; end if;
  end if;
  return new;
end $$;
drop trigger if exists loans_defaults on fin.loans;
create trigger loans_defaults before insert on fin.loans for each row execute function fin.trg_loan_defaults();

-- ---------------------------------------------------------------------------
-- Bills: create the dues for the next 35 days and mark missed ones overdue
-- ---------------------------------------------------------------------------
create or replace function fin.roll_bill_occurrences(p_household uuid default null) returns int
language plpgsql security definer set search_path = fin as $$
declare
  n int := 0;
  b record;
  d date;
begin
  -- signed-in callers may only roll their own household; cron (no user) rolls everyone
  if auth.uid() is not null and (p_household is null or not fin.can_write(p_household)) then
    raise exception 'not allowed';
  end if;
  for b in select id, household_id, frequency, amount_paise, next_due_date from fin.recurring_bills
            where is_active and next_due_date <= current_date + 35
              and (p_household is null or household_id = p_household)
            for update
  loop
    d := b.next_due_date;
    while d <= current_date + 35 loop
      insert into fin.bill_occurrences(household_id, bill_id, due_date, amount_paise)
      values (b.household_id, b.id, d, b.amount_paise)
      on conflict (bill_id, due_date) do nothing;
      n := n + 1;
      d := fin.next_due(d, b.frequency);
    end loop;
    update fin.recurring_bills set next_due_date = d where id = b.id;
  end loop;
  update fin.bill_occurrences set status = 'overdue'
   where status = 'due' and due_date < current_date
     and (p_household is null or household_id = p_household);
  return n;
end $$;
revoke execute on function fin.roll_bill_occurrences(uuid) from public, anon;
grant execute on function fin.roll_bill_occurrences(uuid) to authenticated, service_role;

create or replace function fin.trg_bill_roll() returns trigger
language plpgsql as $$
begin
  perform fin.roll_bill_occurrences(new.household_id);
  return null;
end $$;
drop trigger if exists recurring_bills_roll on fin.recurring_bills;
create trigger recurring_bills_roll after insert on fin.recurring_bills
  for each row execute function fin.trg_bill_roll();

-- ---------------------------------------------------------------------------
-- Goals: a contribution adds to the goal's saved amount
-- ---------------------------------------------------------------------------
create or replace function fin.trg_goal_contribution() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    select household_id into new.household_id from fin.goals where id = new.goal_id;
    update fin.goals set saved_paise = saved_paise + new.amount_paise,
           status = case when saved_paise + new.amount_paise >= target_paise then 'achieved' else status end
     where id = new.goal_id;
  end if;
  return new;
end $$;
drop trigger if exists goal_contributions_apply on fin.goal_contributions;
create trigger goal_contributions_apply before insert on fin.goal_contributions
  for each row execute function fin.trg_goal_contribution();

-- ---------------------------------------------------------------------------
-- Earning target engine (deterministic; the AI explains it, never computes it)
-- ---------------------------------------------------------------------------
create or replace function fin.compute_earning_target(p_household uuid)
returns jsonb language sql stable security invoker set search_path = fin as $$
with s as (
  select coalesce((settings->>'buffer_pct')::numeric, 5)                as buffer_pct,
         coalesce((settings->>'working_days_per_month')::numeric, 26)   as wd,
         coalesce((settings->>'daily_needs_per_day_paise')::numeric, 0) as daily_setting
  from fin.households where id = p_household
),
bills as (
  select coalesce(c.bucket, 'fixed') as bucket, sum(b.amount_paise * fin.monthly_factor(b.frequency)) as amt
  from fin.recurring_bills b left join fin.categories c on c.id = b.category_id
  where b.household_id = p_household and b.is_active
  group by 1
),
emi as (select coalesce(sum(emi_paise), 0) amt from fin.loans where household_id = p_household and status = 'active'),
hist as (  -- average daily-needs spend per month over the last 3 full months that have data
  select coalesce(sum(m.spend_paise) / nullif(count(distinct m.month), 0), 0) amt
  from fin.monthly_category_spend m join fin.categories c on c.id = m.category_id
  where m.household_id = p_household and c.bucket = 'daily'
    and m.month >= date_trunc('month', current_date) - interval '3 months'
    and m.month <  date_trunc('month', current_date)
),
goals as (  -- each dated goal: what is left ÷ months left
  select coalesce(sum(greatest(target_paise - saved_paise, 0)
         / greatest(1, (extract(year from age(target_date, current_date)) * 12
                        + extract(month from age(target_date, current_date)))::numeric)), 0) amt
  from fin.goals where household_id = p_household and status = 'active'
    and kind <> 'financial_freedom' and target_date > current_date
),
sip as (select coalesce(sum(sip_paise), 0) amt from fin.holdings where household_id = p_household),
t as (
  select coalesce((select sum(amt) from bills where bucket in ('fixed','discretionary','income','transfer')), 0) as fixed_bills,
         (select amt from emi) as emi,
         coalesce((select sum(amt) from bills where bucket = 'kids'), 0) as kids,
         case when s.daily_setting > 0 then s.daily_setting * 365 / 12 else (select amt from hist) end as daily,
         coalesce((select sum(amt) from bills where bucket = 'sinking'), 0) as sinking_bills,
         (select amt from goals) as goals,
         coalesce((select sum(amt) from bills where bucket = 'invest'), 0) + (select amt from sip) as invest,
         s.buffer_pct, s.wd
  from s
),
m as (
  select t.*, (fixed_bills + emi + kids + daily + sinking_bills + goals + invest) as subtotal from t
)
select jsonb_build_object(
  'breakdown_paise', jsonb_build_object(
      'fixed', round(fixed_bills + emi), 'emi', round(emi), 'kids', round(kids), 'daily', round(daily),
      'sinking', round(sinking_bills + goals), 'invest', round(invest)),
  'living_paise',  round(fixed_bills + daily + sinking_bills),   -- monthly cost that continues after loans and school end
  'invest_paise',  round(invest),
  'buffer_pct',    buffer_pct,
  'monthly_paise', round(subtotal * (1 + buffer_pct / 100)),
  'daily_paise',   ceil(subtotal * (1 + buffer_pct / 100) * 12 / 365),
  'weekly_paise',  ceil(subtotal * (1 + buffer_pct / 100) * 12 / 365) * 7,
  'working_day_paise', ceil(subtotal * (1 + buffer_pct / 100) / wd))
from m;
$$;

-- Financial freedom: FI number = living cost × 12 × 25, years solved with a real return
create or replace function fin.compute_freedom(p_household uuid, p_target jsonb default null)
returns jsonb language plpgsql stable security invoker set search_path = fin as $$
declare
  tgt jsonb := coalesce(p_target, fin.compute_earning_target(p_household));
  r numeric;
  mult numeric;
  fi numeric;
  corpus numeric;
  c numeric;
  yrs numeric;
begin
  select coalesce((settings->>'real_return_pct')::numeric, 5) / 100,
         coalesce((settings->>'swr_multiple')::numeric, 25)
    into r, mult from fin.households where id = p_household;
  fi := (tgt->>'living_paise')::numeric * 12 * mult;
  -- only money meant for freedom counts: holdings with no goal, or linked to the freedom goal
  -- (a college fund or emergency fund is spent, so it never pays for your life)
  select coalesce(sum(h.current_paise), 0), coalesce(sum(h.sip_paise), 0) * 12 into corpus, c
    from fin.holdings h left join fin.goals g on g.id = h.goal_id
   where h.household_id = p_household and h.asset_class <> 'real_estate'
     and (h.goal_id is null or g.kind = 'financial_freedom');
  if fi <= 0 then
    yrs := null;
  elsif corpus >= fi then
    yrs := 0;
  elsif r > 0 and (corpus + c / r) > 0 then
    yrs := ln((fi + c / r) / (corpus + c / r)) / ln(1 + r);
  elsif c > 0 then
    yrs := (fi - corpus) / c;
  end if;
  return jsonb_build_object(
    'fi_number_paise', round(fi),
    'corpus_paise', corpus,
    'pct', case when fi > 0 then round(least(corpus / fi, 1) * 100, 1) else 0 end,
    'years', round(yrs, 1),
    'freedom_date', case when yrs is not null then (current_date + (yrs * 365.25)::int) end,
    'freedom_invest_monthly_paise', round(c / 12),
    'real_return_pct', r * 100,
    'swr_multiple', mult);
end $$;

-- ---------------------------------------------------------------------------
-- Dues: bills, EMIs and card statements in one list
-- ---------------------------------------------------------------------------
create or replace function fin.get_dues(p_household uuid, p_days int default 30)
returns jsonb language sql stable security invoker set search_path = fin as $$
select coalesce(jsonb_agg(d order by d.due_date, d.amount_paise desc), '[]') from (
  select 'bill' as type, o.id, b.name, o.amount_paise, o.due_date, o.status, b.autopay
    from fin.bill_occurrences o join fin.recurring_bills b on b.id = o.bill_id
   where o.household_id = p_household and o.status in ('due','overdue') and o.due_date <= current_date + p_days
  union all
  select 'emi', l.id, initcap(l.loan_type) || ' loan · ' || l.lender, l.emi_paise, fin.loan_next_due(l),
         case when fin.loan_next_due(l) < current_date then 'overdue' else 'due' end, false
    from fin.loans l
   where l.household_id = p_household and l.status = 'active' and fin.loan_next_due(l) <= current_date + p_days
  union all
  select 'card', s.id, c.issuer || ' card ••' || c.last4, s.total_due_paise - s.paid_paise, s.due_date,
         case when s.due_date < current_date then 'overdue' else 'due' end, false
    from fin.card_statements s join fin.credit_cards c on c.id = s.card_id
   where s.household_id = p_household and s.status in ('open','partial','overdue') and s.due_date <= current_date + p_days
) d;
$$;

-- One round trip for the Home screen
create or replace function fin.get_home(p_household uuid)
returns jsonb language plpgsql stable security invoker set search_path = fin as $$
declare
  tgt jsonb := fin.compute_earning_target(p_household);
begin
  return jsonb_build_object(
    'household', (select jsonb_build_object('id', id, 'name', name, 'plan', plan_code, 'settings', settings)
                    from fin.households where id = p_household),
    'target', tgt,
    'freedom', fin.compute_freedom(p_household, tgt),
    'earned_this_week_paise', (select coalesce(sum(income_paise), 0) from fin.daily_household_summary
                                where household_id = p_household and day >= date_trunc('week', current_date)),
    'earned_this_month_paise', (select coalesce(sum(income_paise), 0) from fin.daily_household_summary
                                 where household_id = p_household and day >= date_trunc('month', current_date)),
    'spent_this_month_paise', (select coalesce(sum(expense_paise), 0) from fin.daily_household_summary
                                where household_id = p_household and day >= date_trunc('month', current_date)),
    'dues_7d', fin.get_dues(p_household, 7),
    'insights', (select coalesce(jsonb_agg(i), '[]') from (
        select id, title, body, saving_paise, severity from fin.ai_insights
         where household_id = p_household and status = 'new' and (valid_until is null or valid_until > now())
         order by severity desc, created_at desc limit 3) i));
end $$;

-- Spend by category for one month (Money screen)
create or replace function fin.get_month_spend(p_household uuid, p_month date default current_date)
returns jsonb language sql stable security invoker set search_path = fin as $$
select coalesce(jsonb_agg(jsonb_build_object('category', c.name, 'bucket', c.bucket, 'spend_paise', m.spend_paise,
                                             'count', m.txn_count) order by m.spend_paise desc), '[]')
from fin.monthly_category_spend m join fin.categories c on c.id = m.category_id
where m.household_id = p_household and m.month = date_trunc('month', p_month)::date and m.spend_paise > 0;
$$;

-- Keyset pagination for the transaction list (no OFFSET, same speed on every page)
create or replace function fin.list_transactions(p_household uuid, p_before_date date default null,
                                                 p_before_id uuid default null, p_limit int default 50)
returns setof fin.transactions language sql stable security invoker set search_path = fin as $$
  select * from fin.transactions
  where household_id = p_household
    and (p_before_date is null or (txn_date, id) < (p_before_date, p_before_id))
  order by txn_date desc, id desc
  limit least(greatest(p_limit, 1), 200);
$$;

-- ---------------------------------------------------------------------------
-- Pay a due: marks it paid and records the transaction in one step
-- ---------------------------------------------------------------------------
create or replace function fin.system_category(p_name text) returns int
language sql stable as $$ select id from fin.categories where household_id is null and name = p_name $$;

create or replace function fin.pay_bill(p_occurrence uuid, p_account uuid, p_amount_paise bigint default null)
returns uuid language plpgsql security invoker set search_path = fin as $$
declare o record; tid uuid := gen_random_uuid();
begin
  select o2.*, b.name, b.category_id into o
    from fin.bill_occurrences o2 join fin.recurring_bills b on b.id = o2.bill_id
   where o2.id = p_occurrence and o2.status in ('due','overdue');
  if not found then raise exception 'due not found or already paid'; end if;
  insert into fin.transactions(id, household_id, account_id, txn_date, amount_paise, category_id, merchant, description, is_recurring)
  values (tid, o.household_id, p_account, current_date, -coalesce(p_amount_paise, o.amount_paise), o.category_id, o.name, 'Bill payment', true);
  update fin.bill_occurrences set status = 'paid', paid_on = current_date, transaction_id = tid,
         amount_paise = coalesce(p_amount_paise, amount_paise)
   where id = p_occurrence;
  return tid;
end $$;

create or replace function fin.pay_emi(p_loan uuid, p_account uuid)
returns uuid language plpgsql security invoker set search_path = fin as $$
declare l fin.loans; due date; interest bigint; principal bigint; tid uuid := gen_random_uuid();
begin
  select * into l from fin.loans where id = p_loan and status = 'active' for update;
  if not found then raise exception 'loan not found'; end if;
  due := fin.loan_next_due(l);
  interest  := round(l.outstanding_paise * l.interest_rate_bps / 120000.0);   -- yearly rate ÷ 12
  principal := greatest(l.emi_paise - interest, 0);
  insert into fin.transactions(id, household_id, account_id, txn_date, amount_paise, category_id, merchant, description, is_recurring)
  values (tid, l.household_id, p_account, current_date, -l.emi_paise, fin.system_category('EMI'), l.lender,
          initcap(l.loan_type) || ' loan EMI for ' || to_char(due, 'DD Mon YYYY'), true);
  update fin.loans set paid_through = due,
         outstanding_paise = greatest(outstanding_paise - principal, 0),
         status = case when outstanding_paise - principal <= 0 then 'closed' else 'active' end
   where id = p_loan;
  return tid;
end $$;

create or replace function fin.pay_card(p_statement uuid, p_account uuid, p_amount_paise bigint default null)
returns uuid language plpgsql security invoker set search_path = fin as $$
declare s record; amt bigint; tid uuid := gen_random_uuid();
begin
  select st.*, c.issuer, c.last4 into s
    from fin.card_statements st join fin.credit_cards c on c.id = st.card_id
   where st.id = p_statement and st.status in ('open','partial','overdue') for update of st;
  if not found then raise exception 'statement not found or already paid'; end if;
  amt := coalesce(p_amount_paise, s.total_due_paise - s.paid_paise);
  if amt <= 0 then raise exception 'amount must be more than zero'; end if;
  -- a card payment is a transfer: the purchases were already counted as spending
  insert into fin.transactions(id, household_id, account_id, txn_date, amount_paise, category_id, merchant, description)
  values (tid, s.household_id, p_account, current_date, -amt, fin.system_category('Card payment'),
          s.issuer || ' card ••' || s.last4, 'Credit card bill payment');
  update fin.card_statements
     set paid_paise = paid_paise + amt,
         status = case when paid_paise + amt >= total_due_paise then 'paid' else 'partial' end
   where id = p_statement;
  return tid;
end $$;

-- AI usage metering for plan limits (called by the ai-assistant Edge Function with the service role)
create or replace function fin.bump_ai_usage(p_household uuid, p_tokens bigint default 0)
returns jsonb language plpgsql security definer set search_path = fin as $$
declare used int; lim int;
begin
  select coalesce((p.features->>'ai_msgs')::int, 0) into lim
    from fin.households h join fin.plans p on p.code = h.plan_code where h.id = p_household;
  insert into fin.ai_usage as u(household_id, month, messages, tokens)
  values (p_household, date_trunc('month', current_date)::date, 1, p_tokens)
  on conflict (household_id, month) do update
    set messages = u.messages + 1, tokens = u.tokens + excluded.tokens
  returning messages into used;
  return jsonb_build_object('used', used, 'limit', lim);
end $$;
revoke execute on function fin.bump_ai_usage(uuid, bigint) from public, anon, authenticated;
grant execute on function fin.bump_ai_usage(uuid, bigint) to service_role;

revoke execute on function fin.ensure_txn_partition(date) from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
