-- WealthPilot migration 0001: schema, plans, people, households, subscriptions
-- Money is stored as bigint PAISE (₹1 = 100) everywhere: exact maths, no rounding.
-- Every family's data carries household_id; Row Level Security is switched on in 0006.
-- Run the files in number order (Supabase > SQL Editor > paste > Run). Safe to re-run.
begin;
set local lock_timeout = '10s';

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create schema if not exists fin;

create table if not exists fin.plans(
  code          text primary key,                 -- free | plus | family | pro
  name          text not null,
  price_paise   bigint not null default 0,
  billing_cycle text not null default 'month' check (billing_cycle in ('month','year')),
  features      jsonb not null default '{}',      -- {"max_members":6,"ai_msgs":1000,"agents":["cost_cutter"]}
  active        boolean not null default true
);

create table if not exists fin.profiles(
  user_id        uuid primary key,                 -- = auth.users.id
  full_name      text,
  phone          text,
  currency       char(3) not null default 'INR',
  timezone       text not null default 'Asia/Kolkata',
  platform_role  text not null default 'user' check (platform_role in ('user','support','super_admin')),
  ai_consent     boolean not null default false,
  created_at     timestamptz not null default now()
);

create table if not exists fin.households(
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  owner_id    uuid not null references fin.profiles(user_id),
  plan_code   text not null default 'free' references fin.plans(code),
  settings    jsonb not null default '{"buffer_pct":5,"working_days_per_month":26,"real_return_pct":5,"swr_multiple":25}',
  created_at  timestamptz not null default now()
);
create index if not exists households_owner_idx on fin.households(owner_id);

create table if not exists fin.household_members(
  household_id uuid not null references fin.households(id) on delete cascade,
  user_id      uuid not null references fin.profiles(user_id) on delete cascade,
  role         text not null check (role in ('owner','partner','member','viewer','advisor')),
  expires_at   timestamptz,                         -- advisor access is time-boxed
  created_at   timestamptz not null default now(),
  primary key (household_id, user_id)
);
-- "which households am I in?" is asked on every request
create index if not exists household_members_user_idx on fin.household_members(user_id) include (household_id, role);

create table if not exists fin.subscriptions(
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references fin.households(id) on delete cascade,
  plan_code          text not null references fin.plans(code),
  status             text not null check (status in ('trialing','active','past_due','cancelled')),
  provider           text not null check (provider in ('razorpay','stripe','manual')),
  provider_sub_id    text unique,
  current_period_end timestamptz not null,
  created_at         timestamptz not null default now()
);
create unique index if not exists subscriptions_one_live_idx on fin.subscriptions(household_id)
  where status in ('trialing','active','past_due');

notify pgrst, 'reload schema';
commit;
