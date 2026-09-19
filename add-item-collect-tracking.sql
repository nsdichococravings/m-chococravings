-- Supports per-item partial bill collection for shared tables where each
-- diner pays for their own items/quantities instead of one person paying
-- the whole table bill at once.
--
-- collected_amount tracks the running total collected so far against this
-- order's `total` (across one or more item-level or full-bill collections).
-- Each order item (inside the existing `items` jsonb array) gains a
-- `paidQty` field at the application level once collected against —
-- no schema change needed for that part since `items` is already jsonb.
alter table store_orders add column if not exists collected_amount numeric default 0;
