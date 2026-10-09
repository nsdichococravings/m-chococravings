-- LOCAL TESTING ONLY. Run after local_supabase_stubs.sql and all migrations:
--   psql -v ON_ERROR_STOP=1 -d <test db> -f smoke_test.sql
-- Plays two users (Priya and a stranger), fills in a month of data and checks
-- the numbers, the payments and the security rules. Any failure stops with an error.
\set ON_ERROR_STOP 1
set client_min_messages = notice;
create or replace function pg_temp.check(ok boolean, what text) returns void language plpgsql as
  $$ begin if not coalesce(ok, false) then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;
grant execute on function pg_temp.check(boolean, text) to authenticated;

insert into auth.users values ('00000000-0000-0000-0000-0000000000a1', 'priya@example.test'),
                              ('00000000-0000-0000-0000-0000000000b2', 'stranger@example.test')
on conflict do nothing;

set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', false);
select fin.ensure_my_household('Priya') as hid \gset
select set_config('wp.priya_household', :'hid', false);
select pg_temp.check(fin.ensure_my_household('Priya') = :'hid', 'second login reuses the same household');
select id as bank from fin.accounts where household_id = :'hid' and kind = 'bank' \gset

-- the worked example from EARNING-TARGET.md
insert into fin.recurring_bills(household_id, name, category_id, frequency, amount_paise, next_due_date) values
  (:'hid', 'Electricity, water, gas', fin.system_category('Electricity'), 'monthly', 320000, current_date + 3),
  (:'hid', 'Phone, internet, OTT', fin.system_category('Mobile & internet'), 'monthly', 190000, current_date + 20),
  (:'hid', 'Term + health insurance', fin.system_category('Insurance'), 'yearly', 3600000, current_date + 60),
  (:'hid', 'School fees (2 kids)', fin.system_category('School fees'), 'yearly', 12000000, current_date + 90),
  (:'hid', 'Tuition, books, bus', fin.system_category('Tuition & classes'), 'monthly', 400000, current_date + 25),
  (:'hid', 'Holiday fund', fin.system_category('Holidays'), 'yearly', 9000000, current_date + 200),
  (:'hid', 'Festivals and gifts', fin.system_category('Festivals & gifts'), 'yearly', 3600000, current_date + 120),
  (:'hid', 'Emergency fund top-up', fin.system_category('Emergency fund'), 'monthly', 200000, current_date + 28);
insert into fin.loans(household_id, loan_type, lender, principal_paise, interest_rate_bps, tenure_months, emi_paise, emi_day, start_date, outstanding_paise) values
  (:'hid', 'home', 'SBI', 250000000, 865, 240, 2150000, extract(day from current_date + 4)::int, '2020-01-01', 200000000),
  (:'hid', 'car', 'HDFC Bank', 60000000, 950, 60, 980000, extract(day from current_date + 15)::int, '2024-01-01', 30000000);
insert into fin.goals(household_id, kind, name, target_paise, target_date, saved_paise)
  values (:'hid', 'education', 'Kids college', 250000000, current_date + 3650, 250000000) returning id as college \gset
insert into fin.holdings(household_id, asset_class, name, invested_paise, current_paise, sip_paise, goal_id) values
  (:'hid', 'equity_mf', 'Nifty 50 index fund', 300000000, 360000000, 800000, null),
  (:'hid', 'equity_mf', 'Kids college fund', 0, 0, 300000, :'college');
update fin.households set settings = settings || '{"daily_needs_per_day_paise": 55000}' where id = :'hid';

select fin.compute_earning_target(:'hid') as t \gset
-- ₹550/day × 365/12 = ₹16,729.17 for daily needs, so the total is ₹98,310.63 (doc rounds to ₹98,312)
select pg_temp.check((:'t'::jsonb->>'monthly_paise')::bigint = 9831063, 'monthly target is ₹98,310.63 (worked example)');
select pg_temp.check((:'t'::jsonb->>'daily_paise')::bigint = 323214, 'daily target is ₹3,232.14');
select pg_temp.check((:'t'::jsonb->>'weekly_paise')::bigint = 323214 * 7, 'weekly target is 7 × daily');
select fin.compute_freedom(:'hid') as f \gset
select pg_temp.check((:'f'::jsonb->>'pct')::numeric = 34.0, 'freedom is 34% (₹36 L of ₹1.06 Cr)');
select pg_temp.check((:'f'::jsonb->>'years')::numeric = 16.8, 'freedom in 16.8 years');

-- dues: electricity bill (3 days) + home EMI (4 days) are due this week
select fin.get_dues(:'hid', 7) as d \gset
select pg_temp.check(jsonb_array_length(:'d'::jsonb) = 2, 'two dues in the next 7 days');

-- credit card with an open statement
insert into fin.accounts(household_id, kind, name, last4) values (:'hid', 'credit_card', 'HDFC Millennia', '4321') returning id as card_acc \gset
insert into fin.credit_cards(household_id, account_id, issuer, last4, credit_limit_paise, statement_day, due_day)
  values (:'hid', :'card_acc', 'HDFC', '4321', 20000000, 20, 9) returning id as card \gset
insert into fin.card_statements(household_id, card_id, statement_date, due_date, total_due_paise, min_due_paise)
  values (:'hid', :'card', current_date - 15, current_date + 3, 1840000, 92000) returning id as stmt \gset
select pg_temp.check(jsonb_array_length(fin.get_dues(:'hid', 7)) = 3, 'card bill shows in dues');

-- income and spending update the summaries through the trigger
insert into fin.transactions(household_id, account_id, txn_date, amount_paise, category_id, merchant)
values (:'hid', :'bank', current_date, 2790000, fin.system_category('Salary'), 'Employer'),
       (:'hid', :'bank', current_date, -45000, fin.system_category('Groceries'), 'Swiggy Instamart');
select pg_temp.check((fin.get_home(:'hid')->>'earned_this_week_paise')::bigint = 2790000, 'income counted this week');

-- paying: card payment is a transfer, so it is NOT counted as spending
select fin.pay_card(:'stmt', :'bank') is not null as paid \gset
select pg_temp.check((select status from fin.card_statements where id = :'stmt') = 'paid', 'card statement marked paid');
select pg_temp.check((fin.get_home(:'hid')->>'spent_this_month_paise')::bigint = 45000, 'card payment not double-counted as spend');
select id as occ from fin.bill_occurrences where household_id = :'hid' and due_date = current_date + 3 \gset
select fin.pay_bill(:'occ', :'bank') is not null as paid \gset
select id as home_loan from fin.loans where household_id = :'hid' and loan_type = 'home' \gset
select fin.pay_emi(:'home_loan', :'bank') is not null as paid \gset
select pg_temp.check((select outstanding_paise from fin.loans where id = :'home_loan') = 200000000 - (2150000 - 1441667), 'EMI reduces the outstanding principal');
select pg_temp.check(jsonb_array_length(fin.get_dues(:'hid', 7)) = 0, 'nothing due after paying');

-- goals
insert into fin.goals(household_id, kind, name, target_paise, target_date) values (:'hid', 'holiday', 'Goa trip', 12000000, current_date + 200) returning id as goal \gset
insert into fin.goal_contributions(goal_id, contrib_date, amount_paise) values (:'goal', current_date, 1000000);
select pg_temp.check((select saved_paise from fin.goals where id = :'goal') = 1000000, 'goal contribution adds to saved');

-- ---------- security ----------
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b2', false);
select fin.ensure_my_household('Stranger') as other \gset
select pg_temp.check((select count(*) from fin.transactions where household_id = :'hid') = 0, 'stranger sees none of Priya''s transactions');
select pg_temp.check((select count(*) from fin.households where id = :'hid') = 0, 'stranger cannot see Priya''s household');
select pg_temp.check(fin.get_home(:'hid')->'household' = 'null'::jsonb, 'stranger gets an empty home screen for Priya');
do $$ declare ok boolean := false; begin
  begin
    insert into fin.transactions(household_id, account_id, txn_date, amount_paise)
    values (current_setting('wp.priya_household')::uuid, gen_random_uuid(), current_date, 1);
  exception when insufficient_privilege then ok := true; end;
  perform pg_temp.check(ok, 'stranger cannot add a transaction to Priya''s household');
end $$;
do $$ declare ok boolean := false; begin
  begin perform fin.roll_bill_occurrences(); exception when others then ok := true; end;
  perform pg_temp.check(ok, 'a user cannot run the job for every household');
end $$;
do $$ declare ok boolean := false; begin
  begin update fin.households set plan_code = 'pro'; exception when insufficient_privilege then ok := true; end;
  perform pg_temp.check(ok, 'a user cannot upgrade their own plan');
end $$;
do $$ declare ok boolean := false; begin
  begin update fin.profiles set platform_role = 'super_admin'; exception when insufficient_privilege then ok := true; end;
  perform pg_temp.check(ok, 'a user cannot make themselves super admin');
end $$;
do $$ declare ok boolean := false; begin
  begin insert into fin.daily_household_summary values (gen_random_uuid(), current_date, 1, 1); exception when insufficient_privilege then ok := true; end;
  perform pg_temp.check(ok, 'a user cannot write the summary tables');
end $$;
do $$ declare ok boolean := false; part text; begin
  select c.relname into part from pg_inherits i join pg_class c on c.oid = i.inhrelid where c.relname like 'transactions_2%' and c.relkind = 'r' limit 1;
  begin execute format('select 1 from fin.%I limit 1', part); exception when insufficient_privilege then ok := true; end;
  perform pg_temp.check(ok, 'monthly partitions cannot be read directly (bypassing RLS)');
end $$;
do $$ declare ok boolean := false; begin
  begin perform fin.is_login_locked(gen_random_uuid()); exception when insufficient_privilege then ok := true; end;
  perform pg_temp.check(ok, 'a user cannot probe other accounts'' lock status');
end $$;
do $$ declare ok boolean := false; begin
  begin perform fin.user_id_by_email('priya@example.test'); exception when insufficient_privilege then ok := true; end;
  perform pg_temp.check(ok, 'a user cannot look up accounts by email');
end $$;
reset role;
\echo 'ALL SMOKE TESTS PASSED'
