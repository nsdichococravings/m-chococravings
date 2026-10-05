-- Delete a material and correct its unit cost from Production > Materials.
--
-- Direct writes to inventory_items / packaging_materials were locked by the
-- Production workspace migration (stock may only change through commands),
-- so the older Inventory screen's Delete/Save silently did nothing. This adds
-- one controlled command for admins/production staff:
--
--   cc_material_admin('delete',  kind, name)
--     Refused while an active recipe uses the material (names them), so a
--     recipe can never point at a missing material. Purchase history
--     (material_purchases) is kept.
--   cc_material_admin('set_cost', kind, name, cost)
--     Sets the unit cost (₹ per kg / g / l / ml / pcs, the material's own
--     unit). Use it to fix ₹0 or wrong averages, e.g. old opening stock that
--     was entered without a price, which pulls recipe costs down.
--
-- kind is 'raw' (inventory_items) or 'packaging' (packaging_materials).
-- Run as database owner after the Production migrations. Safe to re-run.
begin;
do $$ begin
 if not exists(select 1 from pg_proc where proname='cc_production_role') then
  raise exception 'cc_production_role() not found -- run the Production workspace migrations first.';
 end if;
end $$;

create or replace function public.cc_material_admin(p_action text, p_kind text, p_name text, p_value numeric default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_role text := public.cc_production_role(); v_table text; v_used text; v_n int;
begin
 if auth.uid() is null or v_role not in ('admin','production') then
  raise exception 'Only admin or production staff can change materials' using errcode='42501';
 end if;
 v_table := case p_kind when 'raw' then 'inventory_items' when 'packaging' then 'packaging_materials' end;
 if v_table is null then raise exception 'Unknown material type'; end if;

 if p_action = 'delete' then
  select string_agg(distinct r.product_name, ', ' order by r.product_name) into v_used
  from public.cc_production_recipes r
  cross join lateral jsonb_array_elements(case when p_kind='raw' then r.ingredients else coalesce(r.packaging,'[]'::jsonb) end) x
  where r.deleted_at is null and x->>'name' = p_name;
  if v_used is not null then
   raise exception 'Used in recipe: %. Remove it from those recipes first.', v_used;
  end if;
  begin
   execute format('delete from public.%I where name=$1', v_table) using p_name;
  exception when foreign_key_violation then
   raise exception 'Other records still point to %, so it cannot be deleted. Set its reorder level to 0 to hide it from the To-buy list instead.', p_name;
  end;
 elsif p_action = 'set_cost' then
  if p_value is null or p_value < 0 or p_value > 100000000 then raise exception 'Enter a unit cost of 0 or more'; end if;
  execute format('update public.%I set cost_per_unit=$1, updated_at=now() where name=$2', v_table) using p_value, p_name;
 else
  raise exception 'Unknown action';
 end if;
 get diagnostics v_n = row_count;
 if v_n = 0 then raise exception 'Material not found: %', p_name; end if;
 return jsonb_build_object('ok', true);
end $$;

revoke all on function public.cc_material_admin(text,text,text,numeric) from public, anon;
grant execute on function public.cc_material_admin(text,text,text,numeric) to authenticated;
notify pgrst, 'reload schema';
commit;
