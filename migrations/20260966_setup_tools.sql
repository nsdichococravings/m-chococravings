-- Setup tools: keep product names in step with the menu, and record wastage.
--
--  1. MENU RENAME FOLLOWS EVERYWHERE. Production finds a product by its exact
--     menu name. Renaming a menu item (Kitchen > MENU) used to leave recipes,
--     requests, batches, outlet stock, making costs and cake bookings on the
--     old name, so collection failed with "Product name changed or is
--     duplicated". Now a menu rename carries the new name into all of them.
--
--  2. RELINK OLD NAMES (super user). For names that already drifted, e.g.
--     "1/2kg vanilla cake" with no such menu item:
--       cc_super_relink_product(from_name, menu_name)
--     moves every production record from the old name to an existing menu
--     item. Production > Setup check lists these names with a Relink button.
--
--  3. WASTAGE. cc_record_wastage(item, pieces, reason, note, staff name)
--     takes thrown-away pieces off the outlet counter and logs them with
--     the latest batch cost per piece, so stock stays true and the cost of
--     waste is visible (Production > Outlet, Live Stock in Display Stock).
--     Reasons: stale, damaged, sample, other.
--
-- Run as database owner after 20260964_super_user_overrides.sql. Safe to re-run.
begin;
-- Wait at most 10 s for a busy table instead of deadlocking with the live app.
set local lock_timeout = '10s';
do $$ begin
 if not exists(select 1 from pg_proc where proname='cc_prod_is_super') then
  raise exception 'Run migrations/20260964_super_user_overrides.sql first.';
 end if;
end $$;

-- ── 1 & 2. One place that moves a product name everywhere ─────
create or replace function public.cc_move_product_name(p_from text, p_to text) returns void
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_old public.display_stock%rowtype;
begin
 if p_from is null or p_to is null or p_from = p_to then return; end if;
 perform set_config('cc.system_write','on',true);
 update public.cc_production_recipes  set product_name=p_to where product_name=p_from;
 update public.cc_production_requests set product_name=p_to where product_name=p_from;
 update public.cc_production_batches  set product_name=p_to where product_name=p_from;
 if to_regclass('public.cc_cost_corrections') is not null then
  update public.cc_cost_corrections set product_name=p_to where product_name=p_from;
 end if;
 -- Making costs: the new name keeps its own values if it already has some.
 if to_regclass('public.cc_making_costs') is not null then
  update public.cc_making_costs set product_name=p_to
   where product_name=p_from and not exists(select 1 from public.cc_making_costs where product_name=p_to);
  delete from public.cc_making_costs where product_name=p_from;
 end if;
 if to_regclass('public.custom_bookings') is not null then
  update public.custom_bookings set production_product=p_to where production_product=p_from;
 end if;
 -- Outlet stock: rename the row, or add its pieces to the existing one.
 select * into v_old from public.display_stock where item_name=p_from;
 if v_old.id is not null then
  if exists(select 1 from public.display_stock where item_name=p_to) then
   update public.display_stock set current_stock=current_stock + greatest(coalesce(v_old.current_stock,0),0), updated_at=now() where item_name=p_to;
   begin
    delete from public.display_stock where item_name=p_from;
   exception when foreign_key_violation then
    update public.display_stock set current_stock=0, updated_at=now() where item_name=p_from;
   end;
  else
   update public.display_stock set item_name=p_to, updated_at=now() where item_name=p_from;
  end if;
 end if;
 perform set_config('cc.system_write','off',true);
end $$;
revoke all on function public.cc_move_product_name(text,text) from public, anon, authenticated;

create or replace function public.cc_menu_rename_follow() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if new.name is distinct from old.name and old.name is not null and new.name is not null
    and not exists(select 1 from public.store_menu where name=old.name and id<>new.id) then
  begin
   perform public.cc_move_product_name(old.name, new.name);
  exception when others then
   perform set_config('cc.system_write','off',true);
   raise warning 'menu rename % -> % not carried into production: %', old.name, new.name, sqlerrm; -- never block a menu edit
  end;
 end if;
 return new;
end $$;
-- create or replace: lighter lock than drop + create, so menu reads keep working.
create or replace trigger cc_menu_rename_follow after update of name on public.store_menu
 for each row execute function public.cc_menu_rename_follow();

create or replace function public.cc_super_relink_product(p_from text, p_to text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_from text := btrim(coalesce(p_from,'')); v_to text := btrim(coalesce(p_to,''));
begin
 if auth.uid() is null or not public.cc_prod_is_super() then
  raise exception 'Only a super user can do this' using errcode='42501';
 end if;
 if v_from = '' or v_to = '' or v_from = v_to then raise exception 'Choose a different menu item'; end if;
 if (select count(*) from public.store_menu where name=v_to) <> 1 then
  raise exception 'Menu item "%" not found (or listed twice)', v_to;
 end if;
 if exists(select 1 from public.store_menu where name=v_from) then
  raise exception '"%" is still on the menu. Rename it in Kitchen > MENU instead; production follows automatically.', v_from;
 end if;
 perform public.cc_move_product_name(v_from, v_to);
 insert into public.cc_super_overrides(action,target_id,before,after,note,actor)
  values('relink_product', gen_random_uuid(), jsonb_build_object('product_name',v_from), jsonb_build_object('product_name',v_to), null, auth.uid());
 return jsonb_build_object('ok', true);
end $$;
revoke all on function public.cc_super_relink_product(text,text) from public, anon;
grant execute on function public.cc_super_relink_product(text,text) to authenticated;

-- ── 3. Wastage ────────────────────────────────────────────────
create table if not exists public.cc_wastage(
 id uuid primary key default gen_random_uuid(),
 item_name text not null,
 quantity integer not null check (quantity > 0),
 reason text not null check (reason in ('stale','damaged','sample','other')),
 note text,
 unit_cost numeric,
 recorded_by_name text,
 recorded_by uuid,
 created_at timestamptz not null default now()
);
create index if not exists cc_wastage_created_idx on public.cc_wastage(created_at desc);
alter table public.cc_wastage enable row level security;
revoke all on public.cc_wastage from public, anon, authenticated;
grant select on public.cc_wastage to authenticated;
drop policy if exists cc_wastage_read on public.cc_wastage;
create policy cc_wastage_read on public.cc_wastage for select to authenticated
 using (public.cc_production_access() or public.cc_loyalty_role() in ('admin','staff'));

create or replace function public.cc_record_wastage(p_item text, p_qty integer, p_reason text, p_note text default null, p_by text default null)
returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_stock numeric; v_cost numeric; v_left numeric;
begin
 if auth.uid() is null or not (public.cc_loyalty_role() in ('admin','staff') or public.cc_production_role() in ('admin','production')) then
  raise exception 'Staff access required' using errcode='42501';
 end if;
 if p_qty is null or p_qty <= 0 or p_qty > 10000 then raise exception 'Enter how many pieces were thrown away (1 or more)'; end if;
 if coalesce(p_reason,'') not in ('stale','damaged','sample','other') then raise exception 'Choose a reason'; end if;
 select current_stock into v_stock from public.display_stock where item_name=p_item for update;
 if v_stock is null then raise exception '% is not on the outlet stock list', p_item; end if;
 if p_qty > v_stock then raise exception 'Only % on the counter for %', trim(to_char(v_stock,'FM999999990.##')), p_item; end if;
 select b.unit_cost into v_cost from public.cc_production_batches b
  where b.product_name=p_item and b.status='completed' and b.unit_cost is not null
  order by b.completed_at desc nulls last limit 1;
 update public.display_stock set current_stock=current_stock - p_qty, updated_at=now() where item_name=p_item
  returning current_stock into v_left;
 insert into public.cc_wastage(item_name,quantity,reason,note,unit_cost,recorded_by_name,recorded_by)
  values(p_item, p_qty, p_reason, nullif(btrim(coalesce(p_note,'')),''), v_cost, nullif(btrim(coalesce(p_by,'')),''), auth.uid());
 return jsonb_build_object('ok', true, 'left', v_left, 'unit_cost', v_cost);
end $$;
revoke all on function public.cc_record_wastage(text,integer,text,text,text) from public, anon;
grant execute on function public.cc_record_wastage(text,integer,text,text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
