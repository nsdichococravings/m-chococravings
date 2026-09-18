-- Read-only checks. Run before installing the production migration.
-- Save the output with your backup. Inspect existing triggers before live testing.
select table_name,column_name,data_type from information_schema.columns
where table_schema='public' and table_name in
('inventory_items','packaging_materials','material_purchases','display_stock','production_requests','menu_recipes','store_menu','store_orders')
order by table_name,ordinal_position;

select t.tgname,c.relname as table_name,pg_get_triggerdef(t.oid) as trigger_definition,
  p.proname as function_name,p.prosecdef as security_definer,pg_get_functiondef(p.oid) as function_definition
from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_proc p on p.oid=t.tgfoid
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and not t.tgisinternal and c.relname in ('store_orders','display_stock','inventory_items','packaging_materials');

select tablename,policyname,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename in ('customers','inventory_items','packaging_materials','material_purchases','display_stock','store_orders');
