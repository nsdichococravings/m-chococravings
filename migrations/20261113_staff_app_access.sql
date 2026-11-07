-- Staff tab access in the app, managed from On Store → Command Center → Manage Staff.
--
-- The Staff tab (and the staff tools it opens) is shown to customer accounts
-- with customers.is_employee or customers.is_admin = true. Those flags were
-- only editable in the Supabase table editor, and removing someone from the
-- PIN staff list (store_staff) never touched them, so a removed staff member
-- kept the Staff tab. These functions let admins see and change that access
-- from the app.
--
--   cc_admin_staff_accounts()                       list accounts with staff access
--   cc_admin_set_staff_access(customer_id, flag, on) flag = 'employee' | 'admin'
--   cc_admin_grant_staff_by_phone(phone)            give an existing customer the Staff tab
--
-- Rules: callers must be an admin or super admin with a confirmed email.
-- Admins can add or remove employee access. Only a super admin can remove an
-- admin's access. Nobody can change a super admin here, or remove their own
-- admin access. Safe to run more than once.
begin;

create or replace function public.cc_staff_access_caller() returns text
language sql stable security definer set search_path=pg_catalog,public as $$
 select case
   when bool_or(coalesce((to_jsonb(c)->>'is_super_user')::boolean,false)) then 'super'
   when bool_or(coalesce((to_jsonb(c)->>'is_admin')::boolean,false)) then 'admin'
 end
 from auth.users u join public.customers c on lower(c.email)=lower(u.email)
 where u.id=auth.uid() and u.email_confirmed_at is not null
$$;

create or replace function public.cc_admin_staff_accounts() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare r text := public.cc_staff_access_caller();
begin
 if r is null then raise exception 'You do not have access to this' using errcode='42501'; end if;
 return jsonb_build_object('caller', r, 'accounts', coalesce((
   select jsonb_agg(jsonb_build_object(
     'id', c.id::text, 'name', c.name, 'phone', c.phone, 'email', c.email,
     'employee', coalesce((to_jsonb(c)->>'is_employee')::boolean,false),
     'admin', coalesce((to_jsonb(c)->>'is_admin')::boolean,false),
     'super', coalesce((to_jsonb(c)->>'is_super_user')::boolean,false)) order by lower(coalesce(c.name,'')))
   from public.customers c
   where coalesce((to_jsonb(c)->>'is_employee')::boolean,false)
      or coalesce((to_jsonb(c)->>'is_admin')::boolean,false)
      or coalesce((to_jsonb(c)->>'is_super_user')::boolean,false)), '[]'::jsonb));
end $$;

create or replace function public.cc_admin_set_staff_access(p_customer_id text, p_flag text, p_on boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r text := public.cc_staff_access_caller(); c public.customers; me text;
begin
 if r is null then raise exception 'You do not have access to this' using errcode='42501'; end if;
 if p_flag not in ('employee','admin') then raise exception 'Unknown access type'; end if;
 select * into c from public.customers where id::text = p_customer_id for update;
 if not found then raise exception 'Account not found'; end if;
 if coalesce((to_jsonb(c)->>'is_super_user')::boolean,false) then
  raise exception 'A super admin''s access can only be changed in Supabase' using errcode='42501';
 end if;
 if p_flag = 'admin' and r <> 'super' then
  raise exception 'Only the super admin can change admin access' using errcode='42501';
 end if;
 select c2.id::text into me from auth.users u join public.customers c2 on lower(c2.email)=lower(u.email)
  where u.id=auth.uid() order by c2.id limit 1;
 if p_flag = 'admin' and not p_on and me = p_customer_id then
  raise exception 'You cannot remove your own admin access' using errcode='42501';
 end if;
 if p_flag = 'employee' then
  update public.customers set is_employee = coalesce(p_on,false) where id::text = p_customer_id;
 else
  update public.customers set is_admin = coalesce(p_on,false) where id::text = p_customer_id;
 end if;
 return public.cc_admin_staff_accounts();
end $$;

create or replace function public.cc_admin_grant_staff_by_phone(p_phone text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r text := public.cc_staff_access_caller(); v_digits text := right(regexp_replace(coalesce(p_phone,''),'\D','','g'),10); v_id text; n int;
begin
 if r is null then raise exception 'You do not have access to this' using errcode='42501'; end if;
 if length(v_digits) <> 10 then raise exception 'Enter a 10-digit mobile number'; end if;
 select count(*), min(id::text) into n, v_id from public.customers
  where right(regexp_replace(coalesce(phone,''),'\D','','g'),10) = v_digits;
 if n = 0 then raise exception 'No customer account with this number. Ask them to sign up in the app first.'; end if;
 if n > 1 then raise exception 'More than one account uses this number. Change it in Supabase.'; end if;
 update public.customers set is_employee = true where id::text = v_id;
 return public.cc_admin_staff_accounts();
end $$;

do $$ declare f text; begin
 foreach f in array array['cc_staff_access_caller()','cc_admin_staff_accounts()',
   'cc_admin_set_staff_access(text,text,boolean)','cc_admin_grant_staff_by_phone(text)'] loop
  execute format('revoke all on function public.%s from public, anon', f);
  execute format('grant execute on function public.%s to authenticated', f);
 end loop;
end $$;

commit;
