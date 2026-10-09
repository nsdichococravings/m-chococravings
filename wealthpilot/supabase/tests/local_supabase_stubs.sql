-- LOCAL TESTING ONLY. Never run this on your Supabase project.
-- Creates the roles and auth pieces Supabase normally provides, so the
-- migrations and smoke_test.sql can run on a plain Postgres 15+.
do $r$ begin create role anon; exception when duplicate_object then null; end $r$;
do $r$ begin create role service_role; exception when duplicate_object then null; end $r$;
do $r$ begin create role authenticated; exception when duplicate_object then null; end $r$;
create schema if not exists auth;
create table if not exists auth.users(id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to authenticated, service_role, anon;
