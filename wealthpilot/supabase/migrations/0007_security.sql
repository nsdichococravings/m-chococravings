-- WealthPilot migration 0007: permissions, Row Level Security, account setup
-- Each family (household) can only see and change its own data.
-- Users can never change their plan, platform role, or the summary tables directly.
-- Run the files in number order (Supabase > SQL Editor > paste > Run). Safe to re-run.
begin;
set local lock_timeout = '10s';

-- ---------------------------------------------------------------------------
-- Membership helpers. (select auth.uid()) is evaluated once per statement.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Table privileges
-- ---------------------------------------------------------------------------
grant usage on schema fin to authenticated, service_role;
revoke all on all tables in schema fin from anon;
grant all on all tables in schema fin to service_role;
grant all on all sequences in schema fin to service_role;
grant select on all tables in schema fin to authenticated;
grant usage, select on all sequences in schema fin to authenticated;

-- Monthly partitions are reached only through their parent table (where RLS applies)
do $$
declare r record;
begin
  for r in select i.inhrelid::regclass as t from pg_inherits i
           join pg_class c on c.oid = i.inhrelid join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'fin' and c.relkind in ('r','p')
  loop
    execute format('revoke all on %s from authenticated, anon', r.t);
  end loop;
end $$;

-- Family data: read + write (RLS below decides which rows)
grant insert, update, delete on
  fin.accounts, fin.categories, fin.transactions, fin.recurring_bills, fin.bill_occurrences,
  fin.loans, fin.loan_schedule, fin.credit_cards, fin.card_statements, fin.children, fin.goals,
  fin.goal_contributions, fin.budgets, fin.holdings
to authenticated;
grant update (status) on fin.ai_insights to authenticated;          -- accept / dismiss only
grant update (read_at) on fin.notifications to authenticated;
grant update (full_name, phone, currency, timezone, ai_consent) on fin.profiles to authenticated;
grant update (name, settings) on fin.households to authenticated;   -- never plan_code / owner_id

-- Read-only for users: plans, subscriptions, members, summaries, usage, AI runs, audit, prices
-- (writes happen only inside security definer functions or with the service role).

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  -- family tables users read and write
  foreach t in array array['accounts','transactions','recurring_bills','bill_occurrences','loans',
    'credit_cards','card_statements','children','goals','goal_contributions','budgets','holdings']
  loop
    execute format('alter table fin.%I enable row level security', t);
    execute format('drop policy if exists %I on fin.%I', t||'_read', t);
    execute format('drop policy if exists %I on fin.%I', t||'_write', t);
    execute format('create policy %I on fin.%I for select to authenticated using (fin.is_member(household_id))', t||'_read', t);
    execute format('create policy %I on fin.%I for all to authenticated using (fin.can_write(household_id)) with check (fin.can_write(household_id))', t||'_write', t);
  end loop;
  -- family tables users only read
  foreach t in array array['daily_household_summary','monthly_category_spend','ai_insights','ai_usage','subscriptions']
  loop
    execute format('alter table fin.%I enable row level security', t);
    execute format('drop policy if exists %I on fin.%I', t||'_read', t);
    execute format('drop policy if exists %I on fin.%I', t||'_write', t);
    execute format('create policy %I on fin.%I for select to authenticated using (fin.is_member(household_id))', t||'_read', t);
  end loop;
end $$;

drop policy if exists ai_insights_status on fin.ai_insights;
create policy ai_insights_status on fin.ai_insights for update to authenticated
  using (fin.can_write(household_id)) with check (fin.can_write(household_id));

alter table fin.households enable row level security;
drop policy if exists households_read on fin.households;
drop policy if exists households_owner on fin.households;
create policy households_read on fin.households for select to authenticated using (fin.is_member(id));
create policy households_owner on fin.households for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

alter table fin.household_members enable row level security;
drop policy if exists members_read on fin.household_members;
create policy members_read on fin.household_members for select to authenticated using (fin.is_member(household_id));

alter table fin.profiles enable row level security;
drop policy if exists profiles_self on fin.profiles;
drop policy if exists profiles_self_read on fin.profiles;
drop policy if exists profiles_self_update on fin.profiles;
create policy profiles_self_read on fin.profiles for select to authenticated using (user_id = (select auth.uid()));
create policy profiles_self_update on fin.profiles for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table fin.notifications enable row level security;
drop policy if exists notifications_self on fin.notifications;
create policy notifications_self on fin.notifications for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists notifications_read_mark on fin.notifications;
create policy notifications_read_mark on fin.notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

alter table fin.plans enable row level security;
drop policy if exists plans_read on fin.plans;
create policy plans_read on fin.plans for select to authenticated using (active);

-- System categories (household_id null) are shared; families add their own
alter table fin.categories enable row level security;
drop policy if exists categories_read on fin.categories;
drop policy if exists categories_write on fin.categories;
create policy categories_read on fin.categories for select to authenticated
  using (household_id is null or fin.is_member(household_id));
create policy categories_write on fin.categories for all to authenticated
  using (household_id is not null and fin.can_write(household_id))
  with check (household_id is not null and fin.can_write(household_id));

alter table fin.loan_schedule enable row level security;
drop policy if exists loan_schedule_read on fin.loan_schedule;
drop policy if exists loan_schedule_write on fin.loan_schedule;
create policy loan_schedule_read on fin.loan_schedule for select to authenticated
  using (exists (select 1 from fin.loans l where l.id = loan_id and fin.is_member(l.household_id)));
create policy loan_schedule_write on fin.loan_schedule for all to authenticated
  using (exists (select 1 from fin.loans l where l.id = loan_id and fin.can_write(l.household_id)))
  with check (exists (select 1 from fin.loans l where l.id = loan_id and fin.can_write(l.household_id)));

alter table fin.login_events enable row level security;
drop policy if exists login_events_self on fin.login_events;
create policy login_events_self on fin.login_events for select to authenticated using (user_id = (select auth.uid()));

-- Service role only (RLS on, no user policies), except prices which everyone may read
alter table fin.ai_agent_runs enable row level security;
alter table fin.audit_log enable row level security;
alter table fin.asset_prices enable row level security;
drop policy if exists asset_prices_read on fin.asset_prices;
create policy asset_prices_read on fin.asset_prices for select to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Account setup: the app calls this right after every login.
-- Creates the profile, the family (household) and two starter accounts the
-- first time. It does nothing for users who already have a household, and it
-- never touches users of other apps in the same Supabase project.
-- ---------------------------------------------------------------------------
create or replace function fin.ensure_my_household(p_full_name text default null)
returns uuid language plpgsql security definer set search_path = fin as $$
declare
  uid uuid := auth.uid();
  hid uuid;
begin
  if uid is null then raise exception 'not signed in'; end if;
  insert into fin.profiles(user_id, full_name)
  values (uid, nullif(trim(p_full_name), ''))
  on conflict (user_id) do update
    set full_name = coalesce(fin.profiles.full_name, excluded.full_name);

  select household_id into hid from fin.household_members
   where user_id = uid order by (role = 'owner') desc, created_at limit 1;
  if hid is not null then return hid; end if;

  insert into fin.households(name, owner_id)
  values (coalesce((select full_name from fin.profiles where user_id = uid), 'My') || '''s family', uid)
  returning id into hid;
  insert into fin.household_members(household_id, user_id, role) values (hid, uid, 'owner');
  insert into fin.accounts(household_id, kind, name) values (hid, 'cash', 'Cash'), (hid, 'bank', 'Main bank account');
  return hid;
end $$;
revoke execute on function fin.ensure_my_household(text) from public, anon;
grant execute on function fin.ensure_my_household(text) to authenticated;

-- Signed-in users may add their own safe events (the auth-login function
-- records successes, failures and locks with the service role).
create or replace function fin.log_my_login_event(p_event text, p_device text default null)
returns void language plpgsql security definer set search_path = fin as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_event not in ('password_changed','mfa_enabled','mfa_disabled','logout_all') then
    raise exception 'event not allowed';
  end if;
  insert into fin.login_events(user_id, event, device) values (auth.uid(), p_event, left(p_device, 200));
end $$;
revoke execute on function fin.log_my_login_event(text, text) from public, anon;
grant execute on function fin.log_my_login_event(text, text) to authenticated;

-- Used by the auth-login Edge Function only (service role)
create or replace function fin.user_id_by_email(p_email text) returns uuid
language sql stable security definer set search_path = auth, fin as $$
  select id from auth.users where lower(email) = lower(trim(p_email)) limit 1;
$$;
revoke execute on function fin.user_id_by_email(text) from public, anon, authenticated;
revoke execute on function fin.is_login_locked(uuid) from public, anon, authenticated;
grant execute on function fin.user_id_by_email(text), fin.is_login_locked(uuid) to service_role;

notify pgrst, 'reload schema';
commit;
