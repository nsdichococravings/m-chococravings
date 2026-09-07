-- Stores the exact breakdown when a customer pays via multiple methods
-- (e.g. part cash, part UPI). payment_method stays a single summary
-- value for backward compatibility with existing reports:
--   - if only ONE method was used, payment_method = that method (as before)
--   - if MORE than one method was used, payment_method = 'split'
-- payment_split holds the real breakdown either way, e.g.
--   {"cash": 100, "upi": 50, "upi_qr": 0, "card": 0}
alter table store_orders add column if not exists payment_split jsonb;
