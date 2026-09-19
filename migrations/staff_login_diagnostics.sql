-- READ ONLY. Replace the example email with the staff member's exact login email.
-- Run in Supabase SQL Editor. No passwords, PINs or reset tokens are returned.
with target as (select lower(btrim('staff@example.com')) as email)
select t.email as checked_email,
       u.id is not null as auth_account_exists,
       u.email_confirmed_at is not null as email_confirmed,
       u.recovery_sent_at,
       c.id is not null as customer_profile_exists,
       c.email as profile_email,
       c.email=u.email as exact_email_match_used_by_app,
       coalesce((to_jsonb(c)->>'is_employee')::boolean,false) as employee_access,
       (select count(*) from public.customers c2 where lower(btrim(c2.email))=t.email) as matching_customer_profiles
from target t
left join auth.users u on lower(btrim(u.email))=t.email
left join public.customers c on lower(btrim(c.email))=t.email;

-- If account/profile/employee flag is missing, correct that account through
-- authorized user management. A store_staff PIN record alone is not an Auth
-- account and does not grant the email account employee access.
-- Duplicate profiles, mismatched email casing, an RLS denial or a failed Auth
-- request can also prevent the current app's exact-email .single() lookup.
-- recovery_sent_at is not proof of inbox delivery; inspect Auth/SMTP logs.
