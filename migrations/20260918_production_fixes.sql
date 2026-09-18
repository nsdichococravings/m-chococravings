-- EXISTING installations: run this patch, not the original creation migration.
-- NEW installations: run the original migration first, then this file.
begin;
create or replace function public.cc_production_approver_names(p_ids uuid[])
returns table(user_id uuid,display_name text)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
begin
  if not public.cc_production_access() then raise exception 'Production access denied' using errcode='42501'; end if;
  if coalesce(array_length(p_ids,1),0)>1000 then raise exception 'Too many approvers requested'; end if;
  return query select u.id,coalesce(
    (select nullif(btrim(to_jsonb(c)->>'name'),'') from public.customers c where lower(c.email)=lower(u.email) limit 1),
    nullif(btrim(u.raw_user_meta_data->>'full_name'),''),
    nullif(btrim(u.raw_user_meta_data->>'name'),''),
    'User '||left(u.id::text,8))
  from auth.users u where u.id=any(p_ids) and (
    exists(select 1 from public.cc_production_requests r where r.approved_by=u.id)
    or exists(select 1 from public.cc_production_recipes r where r.approved_by=u.id));
end $$;
revoke all on function public.cc_production_approver_names(uuid[]) from public,anon;
grant execute on function public.cc_production_approver_names(uuid[]) to authenticated;

create or replace function public.cc_production_add_material(p_payload jsonb,p_key uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_actor uuid:=auth.uid(); v_role text:=public.cc_production_role();
  v_name text:=btrim(p_payload->>'name'); v_unit text:=p_payload->>'unit';
  v_kind text:=p_payload->>'kind'; v_table text; v_existing text;
  v_cmd public.cc_production_commands%rowtype; v_result jsonb;
begin
  if v_actor is null or v_role is null or v_role not in ('admin','production') then raise exception 'Production access denied' using errcode='42501'; end if;
  if p_key is null or jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'Command key and object payload required'; end if;
  if v_name is null or v_name='' or length(v_name)>200 or v_kind is null or v_kind not in ('raw','packaging') or v_unit is null or v_unit not in ('g','kg','ml','l','pcs','dozen') then raise exception 'Valid name, material type and unit required'; end if;
  insert into public.cc_production_commands(actor,command_key,action,payload) values(v_actor,p_key,'add_material',p_payload)
    on conflict(actor,command_key) do nothing;
  select * into strict v_cmd from public.cc_production_commands where actor=v_actor and command_key=p_key for update;
  if v_cmd.action<>'add_material' or v_cmd.payload<>p_payload then raise exception 'Retry key already belongs to different input'; end if;
  if v_cmd.result is not null then return v_cmd.result; end if;
  v_table:=case when v_kind='raw' then 'inventory_items' else 'packaging_materials' end;
  perform pg_advisory_xact_lock(hashtextextended(v_table||':'||v_name,0));
  execute format('select unit from public.%I where name=$1',v_table) into v_existing using v_name;
  if v_existing is not null and v_existing<>v_unit then raise exception 'This material already exists in %',v_existing; end if;
  if v_existing is null then
    execute format('insert into public.%I(name,unit,current_stock,cost_per_unit,low_stock_threshold) values($1,$2,0,null,0)',v_table) using v_name,v_unit;
    if v_kind='packaging' then update public.packaging_materials set category='General' where name=v_name; end if;
  end if;
  v_result:=jsonb_build_object('name',v_name,'unit',v_unit);
  update public.cc_production_commands set result=v_result where id=v_cmd.id;
  return v_result;
end $$;
revoke all on function public.cc_production_add_material(jsonb,uuid) from public,anon;
grant execute on function public.cc_production_add_material(jsonb,uuid) to authenticated;

-- Stock refresh notifications only: no additional order deduction trigger.
-- Extend the original receipt command to accept existing material unit aliases.
do $$
declare definition text;
begin
  definition:=pg_get_functiondef('public.cc_production_command(text,jsonb,uuid)'::regprocedure);
  definition:=replace(definition, 'v_unit not in (''kg'',''g'',''l'',''ml'',''pcs'')',
    'v_unit not in (''kg'',''g'',''l'',''ml'',''pcs'',''dozen'',''dozens'',''liter'',''litre'',''liters'',''litres'',''piece'',''pieces'',''gram'',''grams'',''kgs'')');
  execute definition;
end $$;

do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') and
    not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='display_stock') then
    alter publication supabase_realtime add table public.display_stock;
  end if;
end $$;
notify pgrst,'reload schema';
commit;
