-- WealthPilot migration 0006: AI runs and insights, notifications, audit log, login history
-- Passwords are NEVER stored in these tables. Supabase Auth keeps only a bcrypt hash.
-- Run the files in number order (Supabase > SQL Editor > paste > Run). Safe to re-run.
begin;
set local lock_timeout = '10s';

create table if not exists fin.ai_agent_runs(
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
create table if not exists fin.ai_agent_runs_default partition of fin.ai_agent_runs default;
create index if not exists ai_agent_runs_household_idx on fin.ai_agent_runs(household_id, agent, created_at desc);
create index if not exists ai_agent_runs_time_brin on fin.ai_agent_runs using brin (created_at);

create table if not exists fin.ai_insights(
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
create index if not exists ai_insights_feed_idx on fin.ai_insights(household_id, severity desc, created_at desc) where status = 'new';

create table if not exists fin.ai_usage(
  household_id uuid not null references fin.households(id) on delete cascade,
  month        date not null,
  messages     int not null default 0,
  tokens       bigint not null default 0,
  primary key (household_id, month)
);

create table if not exists fin.notifications(
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
create table if not exists fin.notifications_default partition of fin.notifications default;
create index if not exists notifications_unread_idx on fin.notifications(user_id, created_at desc) where read_at is null;

create table if not exists fin.audit_log(
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
create table if not exists fin.audit_log_default partition of fin.audit_log default;
create index if not exists audit_log_time_brin on fin.audit_log using brin (created_at);
create index if not exists audit_log_household_idx on fin.audit_log(household_id, created_at desc);


-- Login history (written by the auth hook / Edge Function with the service role).
-- Passwords are NEVER stored here; Supabase Auth keeps only a bcrypt hash in auth.users.
create table if not exists fin.login_events(
  id          bigint generated always as identity,
  user_id     uuid,                                 -- null when the email/phone is unknown
  event       text not null check (event in ('login_ok','login_failed','locked','unlocked','password_reset',
                                             'password_changed','mfa_enabled','mfa_disabled','new_device','logout_all')),
  ip          inet,
  device      text,
  created_at  timestamptz not null default now(),
  primary key (created_at, id)
) partition by range (created_at);
create table if not exists fin.login_events_default partition of fin.login_events default;
create index if not exists login_events_user_idx on fin.login_events(user_id, created_at desc);
create index if not exists login_events_failed_ip_idx on fin.login_events(ip, created_at) where event = 'login_failed';

-- Lockout check used before verifying a password: 5 failures in 15 minutes = locked
create or replace function fin.is_login_locked(p_user uuid) returns boolean
language sql stable security definer set search_path = fin as $$
  select count(*) >= 5 from fin.login_events
  where user_id = p_user and event = 'login_failed' and created_at > now() - interval '15 minutes'
    and created_at > coalesce((select max(created_at) from fin.login_events
                               where user_id = p_user and event in ('login_ok','unlocked','password_reset')), '-infinity');
$$;
-- Only the login Edge Function (service role) may ask; users cannot probe other accounts
revoke execute on function fin.is_login_locked(uuid) from public;

notify pgrst, 'reload schema';
commit;
