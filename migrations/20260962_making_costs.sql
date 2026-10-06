-- Labour and other making costs per piece, set once per product.
--
-- The Profit report only shows a profit when ingredients, packaging, labour
-- and other costs (electricity, gas…) are all known. Made-to-order items
-- (coffee, juices…) never have a production batch, so until now the only
-- way to complete them was a dated cost-correction request + approval, and
-- that froze the ingredient cost too. With this table the report uses:
--   recipe ingredients + packaging (live material prices)
--   + labour + other per piece from here
-- and marks the cost complete. Approved cost corrections and recorded batch
-- costs still take priority, exactly as before.
--
-- Set from Production › Recipes ("Labour + other / piece" › Set) or from the
-- Profit report details. Admin / production staff only.
-- Run as database owner after the Production migrations. Safe to re-run.
begin;
do $$ begin
 if not exists(select 1 from pg_proc where proname='cc_production_role') then
  raise exception 'cc_production_role() not found -- run the Production workspace migrations first.';
 end if;
end $$;

create table if not exists public.cc_making_costs(
 product_name text primary key,
 labor_cost numeric not null default 0 check (labor_cost >= 0 and labor_cost < 100000000),
 overhead_cost numeric not null default 0 check (overhead_cost >= 0 and overhead_cost < 100000000),
 updated_by uuid,
 updated_at timestamptz not null default now()
);
alter table public.cc_making_costs enable row level security;
revoke all on public.cc_making_costs from public, anon, authenticated;
grant select on public.cc_making_costs to authenticated;
drop policy if exists cc_making_read on public.cc_making_costs;
create policy cc_making_read on public.cc_making_costs for select to authenticated using (public.cc_production_access());

create or replace function public.cc_set_making_cost(p_product text, p_labor numeric, p_overhead numeric) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_role text := public.cc_production_role(); v_name text := btrim(coalesce(p_product,''));
begin
 if auth.uid() is null or v_role not in ('admin','production') then
  raise exception 'Only admin or production staff can set making costs' using errcode='42501';
 end if;
 if v_name = '' or (not exists(select 1 from public.store_menu where name=v_name)
                    and not exists(select 1 from public.cc_production_recipes where product_name=v_name)) then
  raise exception 'Product not found: %', v_name;
 end if;
 if p_labor is null or p_labor < 0 or p_labor >= 100000000 or p_overhead is null or p_overhead < 0 or p_overhead >= 100000000 then
  raise exception 'Enter labour and other cost of 0 or more';
 end if;
 insert into public.cc_making_costs(product_name, labor_cost, overhead_cost, updated_by, updated_at)
  values(v_name, p_labor, p_overhead, auth.uid(), now())
  on conflict (product_name) do update set labor_cost=excluded.labor_cost, overhead_cost=excluded.overhead_cost,
   updated_by=excluded.updated_by, updated_at=now();
 return jsonb_build_object('ok', true);
end $$;

revoke all on function public.cc_set_making_cost(text,numeric,numeric) from public, anon;
grant execute on function public.cc_set_making_cost(text,numeric,numeric) to authenticated;
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime')
    and not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='cc_making_costs') then
  alter publication supabase_realtime add table public.cc_making_costs;
 end if;
end $$;
notify pgrst, 'reload schema';
commit;
