-- Staff PIN list (store_staff) through server functions only.
--
-- The staff name lists (NSDI Cafe staff login, Attendance, Stall, Recipes,
-- Kitchen recipe card), Manage Staff and the Attendance salary screens read
-- and changed store_staff directly. With row level security switched on for
-- that table (Supabase's security advisor suggests it), every one of those
-- returned nothing or failed: no names to pick, and errors in Manage Staff.
-- Direct access also let anyone with the app's public key read every PIN.
--
-- Now the app uses these functions, and the table itself is closed to the
-- app (RLS on, no direct access):
--   cc_staff_names(roles)                     active names for the login lists
--   cc_staff_login(name, pin)                 { ok, id, name, role, is_super_admin } or { ok:false, error }
--   cc_admin_store_staff(action, payload)     Manage Staff (app admins): list | add | set_active | delete
--   cc_staff_self(name, pin)                  a signed-in staff member's own pay details
--   cc_staff_salaries(name, pin)              super admin (staff PIN): everyone's pay details
--   cc_staff_set_salary(name, pin, staff, field, amount)  super admin: change one pay component
--
-- Safe to run more than once.
begin;

do $$ begin
 if not exists(select 1 from information_schema.tables where table_schema = 'public' and table_name = 'store_staff') then
  raise exception 'store_staff table not found -- is this the right database?';
 end if;
 if not exists(select 1 from pg_proc where proname = 'cc_staff_access_caller') then
  raise exception 'Run migrations/20261113_staff_app_access.sql first.';
 end if;
end $$;

-- One active staff member by name and PIN (null if no match).
create or replace function public.cc_staff_check(p_name text, p_pin text) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select to_jsonb(s) from public.store_staff s
  where lower(btrim(s.name)) = lower(btrim(coalesce(p_name, ''))) and coalesce(s.active, true)
    and s.pin::text = btrim(coalesce(p_pin, ''))
  order by (to_jsonb(s)->>'role') = 'Admin' desc limit 1
$$;
revoke all on function public.cc_staff_check(text, text) from public, anon, authenticated;

create or replace function public.cc_staff_names(p_roles text[] default null) returns jsonb
language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(jsonb_agg(n order by lower(n)), '[]'::jsonb) from (
  select distinct s.name n from public.store_staff s
   where coalesce(s.active, true) and nullif(btrim(s.name), '') is not null
     and (p_roles is null or coalesce(to_jsonb(s)->>'role', 'Employee') = any(p_roles))
 ) x
$$;
revoke all on function public.cc_staff_names(text[]) from public;
grant execute on function public.cc_staff_names(text[]) to anon, authenticated;

create or replace function public.cc_staff_login(p_name text, p_pin text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare s jsonb;
begin
 if nullif(btrim(coalesce(p_name, '')), '') is null then return jsonb_build_object('ok', false, 'error', 'Select your name'); end if;
 if nullif(btrim(coalesce(p_pin, '')), '') is null then return jsonb_build_object('ok', false, 'error', 'Enter your PIN'); end if;
 s = public.cc_staff_check(p_name, p_pin);
 if s is null then return jsonb_build_object('ok', false, 'error', 'Wrong name or PIN'); end if;
 return jsonb_build_object('ok', true, 'id', s->>'id', 'name', s->>'name',
   'role', coalesce(s->>'role', 'Employee'), 'is_super_admin', coalesce((s->>'is_super_admin')::boolean, false));
end $$;
revoke all on function public.cc_staff_login(text, text) from public;
grant execute on function public.cc_staff_login(text, text) to anon, authenticated;

-- Manage Staff in the NSDI Cafe Command Center: app admins / super admins.
create or replace function public.cc_admin_store_staff(p_action text, p_payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_name text; v_pin text; v_role text;
begin
 if public.cc_staff_access_caller() is null then raise exception 'You do not have access to this' using errcode = '42501'; end if;
 if p_action = 'add' then
  v_name = nullif(btrim(coalesce(p_payload->>'name', '')), '');
  v_pin = nullif(btrim(coalesce(p_payload->>'pin', '')), '');
  v_role = case when p_payload->>'role' = 'Admin' then 'Admin' else 'Employee' end;
  if v_name is null then raise exception 'Enter a staff name'; end if;
  if v_pin is null or v_pin !~ '^[0-9]{4,8}$' then raise exception 'PIN must be 4 to 8 digits'; end if;
  if exists(select 1 from public.store_staff where lower(btrim(name)) = lower(v_name) and coalesce(active, true)) then
   raise exception '% is already on the staff list', v_name;
  end if;
  insert into public.store_staff(name, pin, role, active) values (v_name, v_pin, v_role, true);
 elsif p_action = 'set_active' then
  update public.store_staff set active = coalesce((p_payload->>'active')::boolean, false) where id::text = p_payload->>'id';
  if not found then raise exception 'Staff member not found'; end if;
 elsif p_action = 'delete' then
  delete from public.store_staff where id::text = p_payload->>'id';
  if not found then raise exception 'Staff member not found'; end if;
 elsif p_action <> 'list' then
  raise exception 'Unknown action: %', p_action;
 end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id', s.id::text, 'name', s.name, 'pin', s.pin::text,
          'role', coalesce(to_jsonb(s)->>'role', 'Employee'), 'active', coalesce(s.active, true))
          order by (to_jsonb(s)->>'created_at') desc nulls last, s.name), '[]'::jsonb)
         from public.store_staff s);
end $$;
revoke all on function public.cc_admin_store_staff(text, jsonb) from public, anon;
grant execute on function public.cc_admin_store_staff(text, jsonb) to authenticated;

-- Attendance → Payroll: a staff member's own pay details.
create or replace function public.cc_staff_self(p_name text, p_pin text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare s jsonb = public.cc_staff_check(p_name, p_pin);
begin
 if s is null then raise exception 'Please sign in again' using errcode = '42501'; end if;
 return s - 'pin';
end $$;
revoke all on function public.cc_staff_self(text, text) from public;
grant execute on function public.cc_staff_self(text, text) to anon, authenticated;

-- Attendance → Manage Salaries: super admin (by staff PIN) only.
create or replace function public.cc_staff_salaries(p_name text, p_pin text) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare me jsonb = public.cc_staff_check(p_name, p_pin);
begin
 if me is null or not coalesce((me->>'is_super_admin')::boolean, false) then
  raise exception 'Super admin access required' using errcode = '42501';
 end if;
 return (select coalesce(jsonb_agg(to_jsonb(s) - 'pin' order by lower(s.name)), '[]'::jsonb)
           from public.store_staff s where coalesce(s.active, true));
end $$;
revoke all on function public.cc_staff_salaries(text, text) from public;
grant execute on function public.cc_staff_salaries(text, text) to anon, authenticated;

create or replace function public.cc_staff_set_salary(p_name text, p_pin text, p_staff text, p_field text, p_amount numeric)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare me jsonb = public.cc_staff_check(p_name, p_pin);
begin
 if me is null or not coalesce((me->>'is_super_admin')::boolean, false) then
  raise exception 'Super admin access required' using errcode = '42501';
 end if;
 if p_field not in ('basic_salary', 'customer_feedback_bonus', 'sales_target_bonus', 'no_leave_allowance') then
  raise exception 'Unknown pay component';
 end if;
 if p_amount is null or p_amount < 0 or p_amount > 1000000 then raise exception 'Enter a valid amount'; end if;
 execute format('update public.store_staff set %I = $1 where name = $2', p_field) using p_amount, p_staff;
 return jsonb_build_object('ok', true);
end $$;
revoke all on function public.cc_staff_set_salary(text, text, text, text, numeric) from public;
grant execute on function public.cc_staff_set_salary(text, text, text, text, numeric) to anon, authenticated;

-- Close the table to the app: PINs are no longer readable with the public key.
alter table public.store_staff enable row level security;
revoke all on public.store_staff from anon, authenticated;

notify pgrst, 'reload schema';
commit;
