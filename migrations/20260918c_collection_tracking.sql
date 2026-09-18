-- Adds collector-name tracking to outlet collections, plus a recent-
-- collections history feed for the Kitchen page's "Ready for collection"
-- panel. Folded into migrations/20260918_production_workspace.sql for
-- fresh installs; run this file once against an already-installed
-- database (as the project database owner) to bring it up to date
-- without re-running the whole original migration.
begin;

alter table public.cc_production_movements add column if not exists collected_by text;
create index if not exists cc_production_movements_kind_created_idx on public.cc_production_movements(kind,created_at desc);

create or replace function public.cc_production_command(p_action text,p_payload jsonb,p_key uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_actor uuid:=auth.uid(); v_role text:=public.cc_production_role();
  v_cmd public.cc_production_commands%rowtype;
  v_request public.cc_production_requests%rowtype;
  v_recipe public.cc_production_recipes%rowtype;
  v_batch public.cc_production_batches%rowtype;
  v_id uuid; v_name text; v_kind text; v_table text; v_unit text;
  v_qty numeric; v_cost numeric; v_stock numeric; v_price numeric;
  v_old_unit text; v_scale numeric; v_total numeric:=0; v_snapshot jsonb:='[]'; v_line jsonb;
  v_count integer; v_result jsonb; v_kg numeric; v_labor numeric; v_overhead numeric; v_collected_by text;
begin
  if v_actor is null or v_role is null then raise exception 'Production access denied' using errcode='42501'; end if;
  if p_key is null or p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Command key and object payload required'; end if;
  if p_action not in ('request','approve','recipe','purchase','start','complete','collect') then raise exception 'Unknown production action'; end if;
  if p_action in ('request','approve','collect') and v_role not in ('admin','sales') then raise exception 'A sales-authorized account is required' using errcode='42501'; end if;
  if p_action in ('recipe','purchase','start','complete') and v_role not in ('admin','production') then raise exception 'A production-authorized account is required' using errcode='42501'; end if;

  insert into public.cc_production_commands(actor,command_key,action,payload)
    values(v_actor,p_key,p_action,p_payload) on conflict(actor,command_key) do nothing;
  select * into strict v_cmd from public.cc_production_commands where actor=v_actor and command_key=p_key for update;
  if v_cmd.action<>p_action or v_cmd.payload<>p_payload then raise exception 'Retry key already belongs to different input'; end if;
  if v_cmd.result is not null then return v_cmd.result; end if;

  if p_action in ('request','recipe') then
    v_name:=btrim(p_payload->>'product_name');
    select count(*) into v_count from public.store_menu where name=v_name;
    if v_count<>1 then raise exception 'Product must match exactly one menu item'; end if;
  end if;

  if p_action='request' then
    v_qty:=(p_payload->>'quantity')::numeric;
    if v_qty is null or v_qty<=0 or v_qty<>trunc(v_qty) or v_qty>1000000 then raise exception 'Enter a valid whole-piece quantity'; end if;
    insert into public.cc_production_requests(product_name,quantity,due_date,requested_by)
      values(v_name,v_qty,(p_payload->>'due_date')::date,v_actor) returning id into v_id;
  elsif p_action='approve' then
    select * into strict v_request from public.cc_production_requests where id=(p_payload->>'id')::uuid for update;
    if v_request.status<>'pending' then raise exception 'Only pending requests can be approved'; end if;
    update public.cc_production_requests set status='approved',approved_by=v_actor,approved_at=now() where id=v_request.id;
    v_id:=v_request.id;
  elsif p_action='recipe' then
    v_qty:=(p_payload->>'yield_qty')::numeric; v_kg:=(p_payload->>'yield_kg')::numeric;
    if v_qty is null or v_qty<=0 or v_qty<>trunc(v_qty) or v_qty>1000000 or v_kg is null or v_kg<=0 or v_kg>1000000 then raise exception 'Valid piece and kg yields required'; end if;
    if jsonb_typeof(p_payload->'ingredients') is distinct from 'array' or jsonb_typeof(p_payload->'packaging') is distinct from 'array' then raise exception 'Recipe lines must be arrays'; end if;
    if jsonb_array_length(p_payload->'ingredients')=0 then raise exception 'At least one ingredient is required'; end if;
    foreach v_kind in array array['ingredients','packaging'] loop
      v_table:=case when v_kind='ingredients' then 'inventory_items' else 'packaging_materials' end;
      if exists(select 1 from jsonb_array_elements(p_payload->v_kind) l group by l->>'name' having count(*)>1) then raise exception 'Combine duplicate recipe materials'; end if;
      for v_line in select value from jsonb_array_elements(p_payload->v_kind) loop
        v_cost:=(v_line->>'quantity')::numeric;
        if v_cost is null or v_cost<=0 or v_cost>1000000 then raise exception 'Each recipe quantity must be positive and finite'; end if;
        execute format('select unit from public.%I where name=$1',v_table) into v_unit using v_line->>'name';
        if v_unit is null or v_unit is distinct from v_line->>'unit' then raise exception 'Recipe unit does not match material %',v_line->>'name'; end if;
      end loop;
    end loop;
    insert into public.cc_production_recipes(product_name,yield_qty,yield_kg,ingredients,packaging,approved_by)
      values(v_name,v_qty,v_kg,p_payload->'ingredients',p_payload->'packaging',v_actor) returning id into v_id;
  elsif p_action='purchase' then
    v_name:=btrim(p_payload->>'name'); v_kind:=p_payload->>'kind'; v_unit:=p_payload->>'unit';
    v_qty:=(p_payload->>'quantity')::numeric; v_cost:=(p_payload->>'total_cost')::numeric;
    if v_name is null or v_name='' or v_kind is null or v_kind not in ('raw','packaging') or v_unit is null or v_unit not in ('kg','g','l','ml','pcs') then raise exception 'Valid material name, type and unit required'; end if;
    if v_qty is null or v_qty<=0 or v_qty>1000000 or v_cost is null or v_cost<=0 or v_cost>100000000 then raise exception 'Valid positive quantity and total cost required'; end if;
    if v_unit='pcs' and v_qty<>trunc(v_qty) then raise exception 'Pieces must be whole numbers'; end if;
    if (p_payload->>'purchase_date')::date is null or (p_payload->>'purchase_date')::date>(now() at time zone 'Asia/Kolkata')::date then raise exception 'Stock-in date cannot be empty or in the future'; end if;
    v_table:=case when v_kind='raw' then 'inventory_items' else 'packaging_materials' end;
    -- Serialize creation of the same named material as well as subsequent receipts.
    perform pg_advisory_xact_lock(hashtextextended(v_table||':'||v_name,0));
    execute format('select current_stock,cost_per_unit,unit from public.%I where name=$1 for update',v_table) into v_stock,v_price,v_old_unit using v_name;
    if v_old_unit is null then
      execute format('insert into public.%I(name,unit,current_stock,cost_per_unit,low_stock_threshold) values($1,$2,0,0,0)',v_table) using v_name,v_unit;
      v_stock:=0; v_price:=0;
    elsif v_old_unit<>v_unit then raise exception 'Use existing material unit %',v_old_unit;
    end if;
    if v_stock<0 or v_stock is null then raise exception 'Reconcile negative or missing opening stock first'; end if;
    if v_stock>0 and v_price is null then raise exception 'Existing stock has no cost. Reconcile opening valuation before receiving'; end if;
    execute format('update public.%I set current_stock=current_stock+$1,cost_per_unit=($2*$3+$4)/($2+$1),updated_at=now() where name=$5',v_table)
      using v_qty,v_stock,coalesce(v_price,0),v_cost,v_name;
    if v_kind='packaging' then update public.packaging_materials set category=coalesce(nullif(btrim(p_payload->>'category'),''),category) where name=v_name; end if;
    insert into public.material_purchases(material_type,item_name,quantity,unit,cost_total,purchase_date,bought_by,notes)
      values(case when v_kind='raw' then 'ingredient' else 'packaging' end,v_name,v_qty,v_unit,v_cost,(p_payload->>'purchase_date')::date,v_actor::text,'Production workspace');
    insert into public.cc_production_movements(kind,item_name,location,quantity,unit,unit_cost,actor,command_key)
      values('purchase',v_name,'Central kitchen',v_qty,v_unit,v_cost/v_qty,v_actor,p_key);
    v_id:=v_cmd.id;
  elsif p_action='start' then
    select * into strict v_request from public.cc_production_requests where id=(p_payload->>'id')::uuid for update;
    if v_request.status<>'approved' then raise exception 'Sales request must be approved before baking'; end if;
    select * into strict v_recipe from public.cc_production_recipes where id=(p_payload->>'recipe_id')::uuid;
    if v_recipe.product_name<>v_request.product_name then raise exception 'Recipe does not match requested product'; end if;
    v_qty:=(p_payload->>'planned_qty')::numeric; v_kg:=(p_payload->>'planned_kg')::numeric;
    if v_qty is null or v_qty<=0 or v_qty<>trunc(v_qty) or v_qty>1000000 or v_kg is null or v_kg<=0 or v_kg>1000000 then raise exception 'Valid output quantity and kg required'; end if;
    if v_qty<>v_request.quantity then raise exception 'Planned pieces must equal the approved request quantity'; end if;
    v_scale:=v_qty/v_recipe.yield_qty;
    if abs(v_kg-v_scale*v_recipe.yield_kg)>0.001 then raise exception 'Planned weight must match recipe-scaled output: % kg',v_scale*v_recipe.yield_kg; end if;
    for v_line in select value from jsonb_array_elements(v_recipe.ingredients) order by value->>'name' loop
      select current_stock,cost_per_unit,unit into strict v_stock,v_price,v_unit from public.inventory_items where name=v_line->>'name' for update;
      v_cost:=(v_line->>'quantity')::numeric*v_scale;
      if v_unit<>v_line->>'unit' then raise exception 'Material unit changed; create a new recipe'; end if;
      if v_stock is null or v_stock<v_cost then raise exception 'Insufficient % stock',v_line->>'name'; end if;
      if v_price is null or v_price<0 or v_price>100000000 then raise exception 'Missing or invalid cost for %',v_line->>'name'; end if;
      if v_unit='pcs' and v_cost<>trunc(v_cost) then raise exception 'Recipe scaling creates fractional pieces for %',v_line->>'name'; end if;
      update public.inventory_items set current_stock=current_stock-v_cost,updated_at=now() where name=v_line->>'name';
      v_total:=v_total+v_cost*v_price;
      v_snapshot:=v_snapshot||jsonb_build_array(jsonb_build_object('name',v_line->>'name','unit',v_unit,'quantity',v_cost,'unit_cost',v_price));
    end loop;
    insert into public.cc_production_batches(request_id,recipe_id,product_name,outlet_name,planned_qty,planned_kg,material_snapshot,material_cost,started_by)
      values(v_request.id,v_recipe.id,v_request.product_name,v_request.outlet_name,v_qty,v_kg,v_snapshot,v_total,v_actor) returning id into v_id;
    insert into public.cc_production_movements(batch_id,kind,item_name,location,quantity,unit,unit_cost,actor,command_key)
      select v_id,'ingredient_issue',value->>'name','Central kitchen',-(value->>'quantity')::numeric,value->>'unit',(value->>'unit_cost')::numeric,v_actor,p_key from jsonb_array_elements(v_snapshot);
    update public.cc_production_requests set status='baking' where id=v_request.id;
  elsif p_action='complete' then
    select * into strict v_batch from public.cc_production_batches where id=(p_payload->>'id')::uuid for update;
    if v_batch.status<>'baking' then raise exception 'Batch is already completed'; end if;
    select * into strict v_recipe from public.cc_production_recipes where id=v_batch.recipe_id;
    v_qty:=(p_payload->>'actual_qty')::numeric; v_kg:=(p_payload->>'actual_kg')::numeric;
    v_labor:=(p_payload->>'labor_cost')::numeric; v_overhead:=(p_payload->>'overhead_cost')::numeric;
    if v_qty is null or v_qty<=0 or v_qty<>trunc(v_qty) or v_qty>1000000 or v_kg is null or v_kg<=0 or v_kg>1000000 then raise exception 'Valid actual output required'; end if;
    if v_labor is null or v_labor<0 or v_labor>100000000 or v_overhead is null or v_overhead<0 or v_overhead>100000000 then raise exception 'Valid non-negative labor and overhead costs required'; end if;
    v_scale:=v_qty/v_recipe.yield_qty;
    for v_line in select value from jsonb_array_elements(v_recipe.packaging) order by value->>'name' loop
      select current_stock,cost_per_unit,unit into strict v_stock,v_price,v_unit from public.packaging_materials where name=v_line->>'name' for update;
      v_cost:=(v_line->>'quantity')::numeric*v_scale;
      if v_unit<>v_line->>'unit' then raise exception 'Packaging unit changed; reconcile before completion'; end if;
      if v_unit='pcs' then v_cost:=ceil(v_cost); end if;
      if v_stock is null or v_stock<v_cost then raise exception 'Insufficient packaging: %',v_line->>'name'; end if;
      if v_price is null or v_price<0 or v_price>100000000 then raise exception 'Missing or invalid packaging cost'; end if;
      update public.packaging_materials set current_stock=current_stock-v_cost,updated_at=now() where name=v_line->>'name';
      v_total:=v_total+v_cost*v_price;
      v_snapshot:=v_snapshot||jsonb_build_array(jsonb_build_object('name',v_line->>'name','unit',v_unit,'quantity',v_cost,'unit_cost',v_price));
    end loop;
    update public.cc_production_batches set status='completed',actual_qty=v_qty,actual_kg=v_kg,packaging_snapshot=v_snapshot,packaging_cost=v_total,
      labor_cost=v_labor,overhead_cost=v_overhead,total_cost=material_cost+v_total+v_labor+v_overhead,
      unit_cost=(material_cost+v_total+v_labor+v_overhead)/v_qty,completed_by=v_actor,completed_at=now() where id=v_batch.id;
    insert into public.cc_production_movements(batch_id,kind,item_name,location,quantity,unit,unit_cost,actor,command_key)
      select v_batch.id,'packaging_issue',value->>'name','Central kitchen',-(value->>'quantity')::numeric,value->>'unit',(value->>'unit_cost')::numeric,v_actor,p_key from jsonb_array_elements(v_snapshot);
    insert into public.cc_production_movements(batch_id,kind,item_name,location,quantity,unit,unit_cost,actor,command_key)
      values(v_batch.id,'baked',v_batch.product_name,'Central kitchen',v_qty,'pcs',(v_batch.material_cost+v_total+v_labor+v_overhead)/v_qty,v_actor,p_key);
    update public.cc_production_requests set status='ready' where id=v_batch.request_id;
    v_id:=v_batch.id;
  elsif p_action='collect' then
    select * into strict v_batch from public.cc_production_batches where id=(p_payload->>'id')::uuid for update;
    v_qty:=(p_payload->>'quantity')::numeric;
    v_collected_by:=nullif(btrim(p_payload->>'collected_by'),'');
    if v_collected_by is null then raise exception 'Collector name is required'; end if;
    if length(v_collected_by)>120 then raise exception 'Collector name is too long'; end if;
    if v_batch.status<>'completed' or v_qty is null or v_qty<=0 or v_qty<>trunc(v_qty) or v_qty>v_batch.actual_qty-v_batch.collected_qty then raise exception 'Collection exceeds available finished stock'; end if;
    select count(*) into v_count from public.store_menu where name=v_batch.product_name;
    if v_count<>1 then raise exception 'Product name changed or is duplicated; reconcile before collection'; end if;
    insert into public.display_stock(item_name,category,current_stock,low_stock_threshold)
      select name,category,0,5 from public.store_menu where name=v_batch.product_name on conflict(item_name) do nothing;
    update public.display_stock set current_stock=current_stock+v_qty,updated_at=now() where item_name=v_batch.product_name;
    update public.store_menu set track_display_stock=true where name=v_batch.product_name;
    update public.cc_production_batches set collected_qty=collected_qty+v_qty where id=v_batch.id;
    -- A short-yield batch remains partially fulfilled against the original request.
    update public.cc_production_requests set status=case when v_batch.collected_qty+v_qty>=quantity then 'fulfilled' else 'partial' end where id=v_batch.request_id;
    insert into public.cc_production_movements(batch_id,kind,item_name,location,quantity,unit,unit_cost,actor,command_key,collected_by) values
      (v_batch.id,'collection_out',v_batch.product_name,'Central kitchen',-v_qty,'pcs',v_batch.unit_cost,v_actor,p_key,null),
      (v_batch.id,'collection_in',v_batch.product_name,'Main outlet',v_qty,'pcs',v_batch.unit_cost,v_actor,p_key,v_collected_by);
    v_id:=v_batch.id;
  end if;
  v_result:=jsonb_build_object('id',v_id,'action',p_action);
  update public.cc_production_commands set result=v_result where id=v_cmd.id;
  return v_result;
end $$;

-- Enable Realtime for movements too, if not already, so the kitchen page's
-- collection history refreshes without needing the production dashboard open.
do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='cc_production_movements') then
      alter publication supabase_realtime add table public.cc_production_movements;
    end if;
  end if;
end $$;

commit;
