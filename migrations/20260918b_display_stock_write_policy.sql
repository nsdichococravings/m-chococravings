-- Fixes a gap left by 20260918_production_workspace.sql: enabling RLS on
-- display_stock only added a SELECT policy, so Morning Count save, the
-- Settings tracking toggle sync, and "Mark Fulfilled" restock (all direct
-- client writes from display-stock-patch.js) have been silently no-ops
-- ever since — the update/insert/delete calls succeed with 0 rows affected
-- because RLS has no INSERT/UPDATE/DELETE policy to allow them.
-- Run this once in the Supabase SQL Editor as the project database owner.
begin;

grant insert, update, delete on public.display_stock to authenticated;

create policy cc_prod_display_stock_write on public.display_stock
  for all to authenticated
  using (public.cc_production_access())
  with check (public.cc_production_access());

commit;
