-- Kitchen: an admin moves all of one customer's open orders to one table.
--
-- For orders placed before the customer-side merge question existed (or when
-- the customer said No): the Kitchen shows "Same number · 3 orders" on those
-- tickets and an admin picks the table. Every open self-order from that
-- mobile number moves there (store_orders.customer_table), freeing the
-- other tables. Payments and kitchen tickets are not changed. Staff table
-- bills (table_code) are never moved.
--
--   cc_admin_merge_phone_table(phone, table) -> { table, moved }
--
-- Admins and super admins only (confirmed email). Safe to run more than once.
begin;

create or replace function public.cc_phone10(p text) returns text
language sql immutable set search_path=pg_catalog as $$
 select nullif(right(regexp_replace(coalesce(p,''),'\D','','g'),10),'')
$$;

create or replace function public.cc_admin_merge_phone_table(p_phone text, p_table text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v text := public.cc_phone10(p_phone); t text := upper(trim(coalesce(p_table,''))); ok boolean; n int;
begin
 select bool_or(coalesce((to_jsonb(c)->>'is_admin')::boolean,false) or coalesce((to_jsonb(c)->>'is_super_user')::boolean,false))
   into ok
   from auth.users u join public.customers c on lower(c.email)=lower(u.email)
  where u.id = auth.uid() and u.email_confirmed_at is not null;
 if not coalesce(ok,false) then raise exception 'Only an admin can merge orders' using errcode='42501'; end if;
 if v is null or length(v) <> 10 then raise exception 'This order has no 10-digit mobile number'; end if;
 if t not in ('T1','T2','T3','T4','BS','SL','SR','SC','DC','TAKEAWAY') then raise exception 'Unknown table %', p_table; end if;
 update public.store_orders s set customer_table = t
  where public.cc_phone10(s.customer_phone) = v
    and s.status not in ('collected','cancelled')
    and s.table_code is null
    and s.customer_table is distinct from t;
 get diagnostics n = row_count;
 return jsonb_build_object('table', t, 'moved', n);
end $$;

revoke all on function public.cc_admin_merge_phone_table(text,text) from public, anon;
grant execute on function public.cc_admin_merge_phone_table(text,text) to authenticated;

commit;
