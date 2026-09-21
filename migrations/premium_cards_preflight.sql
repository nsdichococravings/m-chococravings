-- Read-only checks before installing Premium Cards. No order or stock changes.
select table_name,column_name,data_type
from information_schema.columns
where table_schema='public' and
 ((table_name='store_orders' and column_name in ('id','customer_id','items','total','status','payment_status'))
  or (table_name='customers' and column_name in ('email','is_employee'))
  or (table_name='store_menu' and column_name='name'))
order by table_name,column_name;

select to_regprocedure('public.cc_production_role()') as required_role_function;

-- Keep existing stock triggers. Inspect whether they handle item additions on UPDATE,
-- complimentary quantities, and cancellation reversal before enabling reward redemption.
select t.tgname as trigger_name,pg_get_triggerdef(t.oid) as trigger_definition,
 pg_get_functiondef(t.tgfoid) as function_definition
from pg_trigger t where t.tgrelid='public.store_orders'::regclass and not t.tgisinternal;
