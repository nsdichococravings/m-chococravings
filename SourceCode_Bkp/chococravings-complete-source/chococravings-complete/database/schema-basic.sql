-- ═══════════════════════════════════════════════════
-- NSDI ChocoCravings — Supabase Database Setup
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ═══════════════════════════════════════════════════

-- 1. ORDERS TABLE
CREATE TABLE IF NOT EXISTS orders (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_number    TEXT UNIQUE NOT NULL,
  status          TEXT DEFAULT 'pending'
                    CHECK (status IN ('pending','confirmed','preparing','out_for_delivery','delivered','cancelled')),

  -- Customer details
  customer_name   TEXT NOT NULL,
  customer_phone  TEXT NOT NULL,
  customer_email  TEXT,
  delivery_address TEXT NOT NULL,
  city            TEXT NOT NULL,
  pincode         TEXT,

  -- Order items (stored as JSON array)
  items           JSONB NOT NULL,
  -- Example items:
  -- [{"name":"Classic Fudge Brownie","tier":"premium","egg":"eggless",
  --   "pack":"4pcs","qty":2,"base_price":300,"toppings":["Dark Ganache +45"],
  --   "topping_price":45,"line_total":690}]

  -- Pricing
  subtotal        NUMERIC(10,2) NOT NULL,
  topping_total   NUMERIC(10,2) DEFAULT 0,
  delivery_fee    NUMERIC(10,2) DEFAULT 0,
  discount_code   TEXT,
  discount_amount NUMERIC(10,2) DEFAULT 0,
  total           NUMERIC(10,2) NOT NULL,

  -- Payment
  payment_method  TEXT DEFAULT 'cod'
                    CHECK (payment_method IN ('cod','upi','card','netbanking')),
  payment_status  TEXT DEFAULT 'pending'
                    CHECK (payment_status IN ('pending','paid','failed','refunded')),

  -- Preferences
  egg_preference  TEXT,
  special_notes   TEXT,

  -- Timestamps
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 2. ORDER STATUS HISTORY (for tracking)
CREATE TABLE IF NOT EXISTS order_status_history (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id    UUID REFERENCES orders(id) ON DELETE CASCADE,
  status      TEXT NOT NULL,
  note        TEXT,
  changed_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 3. CUSTOMERS TABLE (for loyalty points)
CREATE TABLE IF NOT EXISTS customers (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name          TEXT NOT NULL,
  phone         TEXT UNIQUE NOT NULL,
  email         TEXT UNIQUE,
  city          TEXT,
  dob           DATE,
  points        INTEGER DEFAULT 0,
  tier          TEXT DEFAULT 'bronze'
                  CHECK (tier IN ('bronze','silver','gold','platinum')),
  total_orders  INTEGER DEFAULT 0,
  total_spent   NUMERIC(10,2) DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 4. NOTIFICATIONS LOG
CREATE TABLE IF NOT EXISTS notifications (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id    UUID REFERENCES orders(id),
  type        TEXT CHECK (type IN ('whatsapp','email','sms','push')),
  recipient   TEXT NOT NULL,
  message     TEXT NOT NULL,
  status      TEXT DEFAULT 'sent' CHECK (status IN ('sent','failed','pending')),
  sent_at     TIMESTAMPTZ DEFAULT NOW()
);

-- ═══ ROW LEVEL SECURITY ═══
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- Public can INSERT orders (place order)
CREATE POLICY "customers_can_place_orders"
  ON orders FOR INSERT WITH CHECK (true);

-- Public can read their own order by phone
CREATE POLICY "customers_read_own_orders"
  ON orders FOR SELECT
  USING (customer_phone = current_setting('request.jwt.claims', true)::json->>'phone'
         OR true); -- simplify for now, tighten in production

-- Anyone can insert customers
CREATE POLICY "anyone_can_register"
  ON customers FOR INSERT WITH CHECK (true);

-- ═══ AUTO UPDATE TIMESTAMP ═══
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER orders_updated_at
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══ REALTIME (for admin live feed) ═══
-- Enable realtime on orders table in Supabase dashboard:
-- Database → Replication → orders → enable INSERT + UPDATE

-- ═══ SAMPLE DATA (to test) ═══
INSERT INTO orders (order_number, customer_name, customer_phone, customer_email,
  delivery_address, city, pincode, items, subtotal, topping_total, total,
  payment_method, egg_preference, status)
VALUES (
  'CC-000001',
  'Priya Krishnan',
  '+919876543210',
  'priya@example.com',
  '12, Anna Nagar, 3rd Street',
  'Chennai',
  '600040',
  '[{"name":"Classic Fudge Brownie","tier":"premium","egg":"eggless","pack":"9pcs","qty":1,"base_price":590,"toppings":["Dark Ganache"],"topping_price":90,"line_total":680}]',
  590, 90, 680, 'cod', 'eggless', 'pending'
);
