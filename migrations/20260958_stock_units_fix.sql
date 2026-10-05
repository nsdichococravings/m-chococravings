-- Fixes "Valid material name, type and unit required" on Production stock-in,
-- and stops automatic sales usage from making stock negative.
--
--  1. UNITS. Production (stock-in, recipes) only accepts kg, g, l, ml, pcs,
--     but the older Inventory screen saved "liter", "pieces", "dozen" etc.
--     Those materials could never be restocked from Production. This
--     converts existing materials, packaging and recipe lines to the
--     standard units (dozen -> pcs x12, with the per-unit cost /12).
--     inventory-patch.js now only offers the standard units.
--
--  2. NO NEGATIVE STOCK. Stock-in refuses a material whose stock is below 0
--     ("Reconcile negative ... first"). 20260956 let sales take stock below
--     zero, which would have blocked restocking. Sales now only take what
--     is there (the item still shows 0 on the To-buy list), and any stock
--     that is already negative is reset to 0.
--
--  3. NO-COST STOCK. Stock-in also refuses a material that has stock but
--     no recorded cost. Those are set to cost 0 so they can be restocked;
--     the next stock-in sets a real average cost.
--
-- Run this ENTIRE file as database owner, AFTER 20260956_auto_stock.sql.
-- Safe to re-run.
begin;
do $$ begin
 if not exists(select 1 from pg_proc where proname='cc_apply_sales_usage') then
  raise exception 'Run migrations/20260956_auto_stock.sql first.';
 end if;
end $$;

-- ── 1. Standard units ─────────────────────────────────────────
create or replace function public.cc_std_unit(p text) returns text
language sql immutable as $$
 select case lower(btrim(coalesce(p,'')))
  when 'kg' then 'kg' when 'kgs' then 'kg' when 'kilogram' then 'kg' when 'kilograms' then 'kg'
  when 'g' then 'g' when 'gm' then 'g' when 'gms' then 'g' when 'gram' then 'g' when 'grams' then 'g'
  when 'l' then 'l' when 'ltr' then 'l' when 'liter' then 'l' when 'litre' then 'l' when 'liters' then 'l' when 'litres' then 'l'
  when 'ml' then 'ml'
  when 'pcs' then 'pcs' when 'pc' then 'pcs' when 'piece' then 'pcs' when 'pieces' then 'pcs' when 'nos' then 'pcs'
  when 'dozen' then 'pcs' when 'dozens' then 'pcs'
  else null end
$$;
create or replace function public.cc_unit_factor(p text) returns numeric
language sql immutable as $$ select case when lower(btrim(coalesce(p,''))) in ('dozen','dozens') then 12 else 1 end $$;

do $$ declare t text; begin
 foreach t in array array['inventory_items','packaging_materials'] loop
  execute format($q$
   update public.%I set
     current_stock = current_stock * public.cc_unit_factor(unit),
     low_stock_threshold = coalesce(low_stock_threshold,0) * public.cc_unit_factor(unit),
     cost_per_unit = case when cost_per_unit is null then null else cost_per_unit / public.cc_unit_factor(unit) end,
     unit = public.cc_std_unit(unit)
   where public.cc_std_unit(unit) is not null and unit <> public.cc_std_unit(unit)$q$, t);
 end loop;
end $$;

-- Recipe lines store the material's unit; keep them in step.
update public.cc_production_recipes r set
 ingredients = (select jsonb_agg(case when public.cc_std_unit(x->>'unit') is not null and x->>'unit' <> public.cc_std_unit(x->>'unit')
     then x || jsonb_build_object('unit', public.cc_std_unit(x->>'unit'), 'quantity', (x->>'quantity')::numeric * public.cc_unit_factor(x->>'unit'))
     else x end order by ord) from jsonb_array_elements(r.ingredients) with ordinality e(x, ord)),
 packaging = coalesce((select jsonb_agg(case when public.cc_std_unit(x->>'unit') is not null and x->>'unit' <> public.cc_std_unit(x->>'unit')
     then x || jsonb_build_object('unit', public.cc_std_unit(x->>'unit'), 'quantity', (x->>'quantity')::numeric * public.cc_unit_factor(x->>'unit'))
     else x end order by ord) from jsonb_array_elements(coalesce(r.packaging,'[]'::jsonb)) with ordinality e(x, ord)), '[]'::jsonb)
where exists(select 1 from jsonb_array_elements(r.ingredients || coalesce(r.packaging,'[]'::jsonb)) x
             where public.cc_std_unit(x->>'unit') is not null and x->>'unit' <> public.cc_std_unit(x->>'unit'));

update public.cc_sales_usage set quantity = quantity * public.cc_unit_factor(unit), unit = public.cc_std_unit(unit)
 where public.cc_std_unit(unit) is not null and unit <> public.cc_std_unit(unit);

-- ── 2 & 3. Unblock stock-in ───────────────────────────────────
update public.inventory_items set current_stock = 0, updated_at = now() where current_stock < 0;
update public.packaging_materials set current_stock = 0, updated_at = now() where current_stock < 0;
update public.inventory_items set cost_per_unit = 0 where cost_per_unit is null and current_stock > 0;
update public.packaging_materials set cost_per_unit = 0 where cost_per_unit is null and current_stock > 0;

-- Sales usage: take only what is in stock; cc_sales_usage records what was
-- actually taken, so cancelling returns exactly that.
create or replace function public.cc_apply_sales_usage(p_order_id text, p_items jsonb, p_status text) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r record; v_unit text; v_stock numeric; v_move numeric;
begin
 create temp table if not exists cc_tmp_usage(kind text, name text, unit text, quantity numeric) on commit drop;
 delete from cc_tmp_usage;
 if coalesce(p_status,'') <> 'cancelled' then
  insert into cc_tmp_usage(kind,name,unit,quantity)
  select l.kind, l.name, l.unit, sum(l.qty)
  from (
   select lower(btrim(i->>'name')) as key, sum(coalesce(nullif(i->>'qty','')::numeric, nullif(i->>'quantity','')::numeric, 1)) as sold
   from jsonb_array_elements(public.cc_store_items(p_items)) i
   where coalesce(btrim(i->>'name'),'')<>''
   group by 1
  ) s
  join lateral (
   select m.name from public.store_menu m
   where lower(btrim(m.name))=s.key and not coalesce(m.track_display_stock,false)
   limit 1
  ) mm on true
  join lateral (
   select rc.* from public.cc_production_recipes rc
   where lower(btrim(rc.product_name))=s.key and rc.deleted_at is null
   order by rc.created_at desc limit 1
  ) rc on true
  cross join lateral (
   select 'raw' as kind, x->>'name' as name, x->>'unit' as unit, (x->>'quantity')::numeric * s.sold / rc.yield_qty as qty
   from jsonb_array_elements(rc.ingredients) x
   union all
   select 'packaging', x->>'name', x->>'unit', (x->>'quantity')::numeric * s.sold / rc.yield_qty
   from jsonb_array_elements(coalesce(rc.packaging,'[]'::jsonb)) x
  ) l
  where s.sold > 0
  group by l.kind, l.name, l.unit;
 end if;

 for r in
  select coalesce(t.kind,u.kind) as kind, coalesce(t.name,u.name) as name, coalesce(t.unit,u.unit) as unit,
         coalesce(t.quantity,0) as want, coalesce(u.quantity,0) as had
  from cc_tmp_usage t
  full join (select * from public.cc_sales_usage where order_id=p_order_id) u on u.kind=t.kind and u.name=t.name
 loop
  continue when r.want = r.had;
  if r.kind='raw' then
   select unit, current_stock into v_unit, v_stock from public.inventory_items where name=r.name for update;
  else
   select unit, current_stock into v_unit, v_stock from public.packaging_materials where name=r.name for update;
  end if;
  continue when v_unit is null or v_unit <> r.unit;
  -- Taking more: only what's there. Giving back: what this order took.
  v_move := case when r.want > r.had then least(r.want - r.had, greatest(coalesce(v_stock,0),0)) else r.want - r.had end;
  if v_move <> 0 then
   if r.kind='raw' then
    update public.inventory_items set current_stock=current_stock - v_move, updated_at=now() where name=r.name;
   else
    update public.packaging_materials set current_stock=current_stock - v_move, updated_at=now() where name=r.name;
   end if;
  end if;
  if r.had + v_move = 0 then
   delete from public.cc_sales_usage where order_id=p_order_id and kind=r.kind and name=r.name;
  else
   insert into public.cc_sales_usage(order_id,kind,name,unit,quantity) values(p_order_id,r.kind,r.name,r.unit,r.had + v_move)
    on conflict (order_id,kind,name) do update set quantity=excluded.quantity, unit=excluded.unit, updated_at=now();
  end if;
 end loop;
end $$;

revoke all on function public.cc_apply_sales_usage(text,jsonb,text) from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;
