-- WealthPilot migration 0009: subscription plans and the default categories
-- Change prices and limits here any time; the app reads them from the plans table.
-- Run the files in number order (Supabase > SQL Editor > paste > Run). Safe to re-run.
begin;
set local lock_timeout = '10s';

insert into fin.plans(code, name, price_paise, billing_cycle, features) values
  ('free',   'Free',             0,     'month', '{"max_members":2,"max_goals":3,"ai_msgs":20,"flags":[]}'),
  ('plus',   'Plus',             14900, 'month', '{"max_members":2,"max_goals":50,"ai_msgs":300,"flags":["import","cost_cutter","ai_insights"]}'),
  ('family', 'Family',           29900, 'month', '{"max_members":6,"max_goals":100,"ai_msgs":1000,"flags":["import","cost_cutter","ai_insights","education","all_agents"]}'),
  ('pro',    'Pro / Advisor',    99900, 'month', '{"max_members":25,"max_goals":500,"ai_msgs":5000,"flags":["import","cost_cutter","ai_insights","education","all_agents","advisor","export"]}')
on conflict (code) do update
  set name = excluded.name, price_paise = excluded.price_paise, features = excluded.features;

-- System categories (shared by every family). bucket decides where it counts in the earning target:
--   fixed, kids, daily, sinking (yearly / one-off), invest, discretionary, income, transfer (not spend)
insert into fin.categories(household_id, name, bucket) values
  (null, 'Salary', 'income'), (null, 'Business income', 'income'), (null, 'Rent received', 'income'),
  (null, 'Interest & dividends', 'income'), (null, 'Other income', 'income'),
  (null, 'Rent', 'fixed'), (null, 'EMI', 'fixed'), (null, 'Electricity', 'fixed'), (null, 'Water & gas', 'fixed'),
  (null, 'Mobile & internet', 'fixed'), (null, 'Insurance', 'fixed'), (null, 'Subscriptions', 'fixed'),
  (null, 'Maid & help', 'fixed'), (null, 'Society maintenance', 'fixed'),
  (null, 'School fees', 'kids'), (null, 'Tuition & classes', 'kids'), (null, 'Books & uniform', 'kids'),
  (null, 'School transport', 'kids'), (null, 'Kids activities', 'kids'),
  (null, 'Groceries', 'daily'), (null, 'Milk & vegetables', 'daily'), (null, 'Fuel', 'daily'),
  (null, 'Medicine', 'daily'), (null, 'Local travel', 'daily'), (null, 'Household items', 'daily'),
  (null, 'Holidays', 'sinking'), (null, 'Festivals & gifts', 'sinking'), (null, 'Big purchases', 'sinking'),
  (null, 'Repairs', 'sinking'),
  (null, 'SIP / mutual fund', 'invest'), (null, 'Emergency fund', 'invest'), (null, 'PPF / NPS / EPF', 'invest'),
  (null, 'Eating out', 'discretionary'), (null, 'Shopping', 'discretionary'), (null, 'Entertainment', 'discretionary'),
  (null, 'Personal care', 'discretionary'), (null, 'Other expense', 'discretionary'),
  (null, 'Card payment', 'transfer'), (null, 'Transfer', 'transfer')
on conflict (household_id, name) do update set bucket = excluded.bucket;

notify pgrst, 'reload schema';
commit;
