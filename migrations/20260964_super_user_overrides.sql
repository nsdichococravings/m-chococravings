-- Super-user overrides for Production.
--
-- Normally an approved production request can't be changed and a recipe can
-- only be changed by saving a new version (and planned pieces must equal the
-- approved request, planned kg always comes from the recipe yield). The
-- owner (customers.is_super_user) can now:
--
--   cc_super_production('edit_request', {id, quantity?, due_date?, note?})
--      change quantity / due date of a pending or approved request
--      (before baking starts). Status is kept.
--   cc_super_production('cancel_request', {id, note?})
--      cancel a pending or approved request.
--   cc_super_production('fix_recipe_yield', {id, yield_qty, yield_kg, note?})
--      correct a recipe's base yield in place (e.g. "10 pcs / 1 kg" that
--      should be "1 pc / 1 kg"). Past batches keep their own snapshot
--      costs, so history is unaffected.
--
-- Every override is noted in review_note (requests) and in
-- cc_super_overrides (who, when, what changed).
-- Run as database owner after the Production migrations. Safe to re-run.
begin;
do $$ begin
 if not exists(select 1 from information_schema.tables where table_schema='public' and table_name='cc_production_requests') then
  raise exception 'Run the Production workspace migrations first.';
 end if;
end $$;

create or replace function public.cc_prod_is_super() returns boolean
language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(
  (select coalesce((to_jsonb(c)->>'is_super_user')::boolean,false)
   from auth.users u join public.customers c on lower(c.email)=lower(u.email)
   where u.id=auth.uid() and u.email_confirmed_at is not null limit 1),
  false)
$$;
grant execute on function public.cc_prod_is_super() to authenticated;

create table if not exists public.cc_super_overrides(
 id uuid primary key default gen_random_uuid(),
 action text not null,
 target_id uuid not null,
 before jsonb,
 after jsonb,
 note text,
 actor uuid not null,
 created_at timestamptz not null default now()
);
alter table public.cc_super_overrides enable row level security;
revoke all on public.cc_super_overrides from public, anon, authenticated;

create or replace function public.cc_super_production(p_action text, p_payload jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.cc_production_requests%rowtype; rc public.cc_production_recipes%rowtype;
        v_qty numeric; v_kg numeric; v_due date; v_note text := nullif(btrim(coalesce(p_payload->>'note','')),'');
begin
 if auth.uid() is null or not public.cc_prod_is_super() then
  raise exception 'Only a super user can do this' using errcode='42501';
 end if;
 perform set_config('cc.system_write','on',true); -- lets the approval guard accept a super-user cancel

 if p_action in ('edit_request','cancel_request') then
  select * into r from public.cc_production_requests where id=(p_payload->>'id')::uuid for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.status not in ('pending','approved') then raise exception 'Baking has already started for this request (status %), so it can no longer be changed', r.status; end if;
  if p_action='cancel_request' then
   update public.cc_production_requests set status='cancelled',
    review_note=concat_ws(' · ', nullif(review_note,''), 'Cancelled by super user' || coalesce(': ' || v_note,'')) where id=r.id;
   insert into public.cc_super_overrides(action,target_id,before,after,note,actor)
    values(p_action, r.id, jsonb_build_object('status',r.status), jsonb_build_object('status','cancelled'), v_note, auth.uid());
  else
   v_qty := coalesce(nullif(p_payload->>'quantity','')::numeric, r.quantity);
   v_due := coalesce(nullif(p_payload->>'due_date','')::date, r.due_date);
   if v_qty <= 0 or v_qty <> trunc(v_qty) or v_qty > 1000000 then raise exception 'Enter a whole number of pieces (1 or more)'; end if;
   update public.cc_production_requests set quantity=v_qty::integer, due_date=v_due,
    review_note=concat_ws(' · ', nullif(review_note,''), 'Edited by super user: ' || r.quantity || '→' || v_qty::integer || ' pcs' || coalesce(', due ' || v_due::text, '') || coalesce(' (' || v_note || ')','')) where id=r.id;
   insert into public.cc_super_overrides(action,target_id,before,after,note,actor)
    values(p_action, r.id, jsonb_build_object('quantity',r.quantity,'due_date',r.due_date), jsonb_build_object('quantity',v_qty::integer,'due_date',v_due), v_note, auth.uid());
  end if;
 elsif p_action='fix_recipe_yield' then
  select * into rc from public.cc_production_recipes where id=(p_payload->>'id')::uuid for update;
  if rc.id is null then raise exception 'Recipe not found'; end if;
  v_qty := (p_payload->>'yield_qty')::numeric; v_kg := (p_payload->>'yield_kg')::numeric;
  if v_qty is null or v_qty <= 0 or v_qty <> trunc(v_qty) or v_qty > 1000000 then raise exception 'Base yield pieces must be a whole number (1 or more)'; end if;
  if v_kg is null or v_kg <= 0 or v_kg > 1000000 then raise exception 'Base output kg must be more than 0'; end if;
  update public.cc_production_recipes set yield_qty=v_qty::integer, yield_kg=v_kg where id=rc.id;
  insert into public.cc_super_overrides(action,target_id,before,after,note,actor)
   values(p_action, rc.id, jsonb_build_object('yield_qty',rc.yield_qty,'yield_kg',rc.yield_kg), jsonb_build_object('yield_qty',v_qty::integer,'yield_kg',v_kg), v_note, auth.uid());
 else
  raise exception 'Unknown action';
 end if;
 perform set_config('cc.system_write','off',true);
 return jsonb_build_object('ok', true);
end $$;

revoke all on function public.cc_super_production(text,jsonb) from public, anon;
grant execute on function public.cc_super_production(text,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
