-- ═══════════════════════════════════════════════════════════════════
--  NSDI ChocoCravings — Complete Supabase Database Schema
--  Run in: Supabase Dashboard → SQL Editor → New Query → ▶ Run
--  All tables, relationships, indexes, RLS policies & triggers
-- ═══════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
--  UTILITY: auto-update updated_at timestamps
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION fn_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════
--  TABLE 1 — PRODUCTS
--  Every brownie variant, tier, size with pricing
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS products (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sku             TEXT UNIQUE NOT NULL,          -- e.g. PREM-EL-CLASSIC
  name            TEXT NOT NULL,                 -- Classic Fudge Brownie
  slug            TEXT UNIQUE NOT NULL,          -- classic-fudge-brownie
  category        TEXT NOT NULL
                    CHECK (category IN ('brownie','cake','gift_box','custom','seasonal')),
  tier            TEXT NOT NULL
                    CHECK (tier IN ('premium','couverture')),
  egg_type        TEXT NOT NULL
                    CHECK (egg_type IN ('eggless','egg','both')),
  description     TEXT,
  ingredients     TEXT[],                        -- array of ingredients
  shelf_life_days INTEGER DEFAULT 5,
  is_active       BOOLEAN DEFAULT TRUE,
  is_featured     BOOLEAN DEFAULT FALSE,
  is_bestseller   BOOLEAN DEFAULT FALSE,
  sort_order      INTEGER DEFAULT 0,
  image_url       TEXT,
  tags            TEXT[],                        -- ['healthy','nuts','gluten-free']
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER trg_products_updated
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION fn_updated_at();

-- ═══════════════════════════════════════════════════════════════════
--  TABLE 2 — PRODUCT VARIANTS
--  Pack sizes (4pcs/9pcs/16pcs) with prices per product
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS product_variants (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id      UUID REFERENCES products(id) ON DELETE CASCADE,
  pack_label      TEXT NOT NULL,                 -- "4pcs", "9pcs", "16pcs"
  weight_grams    INTEGER NOT NULL,              -- 250, 500, 1000
  pieces          INTEGER NOT NULL,              -- 4, 9, 16
  price           NUMERIC(10,2) NOT NULL,
  cost_price      NUMERIC(10,2),                 -- for margin tracking
  stock_qty       INTEGER DEFAULT 999,           -- inventory
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, pack_label)
);

CREATE TRIGGER trg_variants_updated
  BEFORE UPDATE ON product_variants
  FOR EACH ROW EXECUTE FUNCTION fn_updated_at();

-- ═══════════════════════════════════════════════════════════════════
--  TABLE 3 — TOPPINGS
--  All ganache toppings with per-pack pricing
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS toppings (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name            TEXT UNIQUE NOT NULL,          -- "Milk Chocolate Ganache"
  slug            TEXT UNIQUE NOT NULL,          -- "milk-chocolate-ganache"
  description     TEXT,
  price_4pcs      NUMERIC(8,2) NOT NULL,
  price_9pcs      NUMERIC(8,2) NOT NULL,
  price_16pcs     NUMERIC(8,2) NOT NULL,
  emoji           TEXT,                          -- "🍫"
  is_active       BOOLEAN DEFAULT TRUE,
  is_premium      BOOLEAN DEFAULT FALSE,
  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER trg_toppings_updated
  BEFORE UPDATE ON toppings
  FOR EACH ROW EXECUTE FUNCTION fn_updated_at();

-- ═══════════════════════════════════════════════════════════════════
--  TABLE 4 — CUSTOMERS
--  All customer profiles, loyalty points, preferences
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS customers (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_code   TEXT UNIQUE,                   -- CC-XXXXXX
  name            TEXT NOT NULL,
  phone           TEXT UNIQUE NOT NULL,
  email           TEXT UNIQUE,
  date_of_birth   DATE,
  anniversary_date DATE,
  gender          TEXT CHECK (gender IN ('male','female','other','prefer_not')),

  -- Address (primary)
  address_line1   TEXT,
  address_line2   TEXT,
  city            TEXT,
  pincode         TEXT,
  state           TEXT DEFAULT 'Tamil Nadu',

  -- Preferences
  egg_preference  TEXT DEFAULT 'eggless'
                    CHECK (egg_preference IN ('eggless','egg','both')),
  preferred_tier  TEXT CHECK (preferred_tier IN ('premium','couverture')),
  allergens       TEXT[],                        -- ['nuts','gluten']
  favourite_items UUID[],                        -- product ids

  -- Loyalty
  loyalty_points  INTEGER DEFAULT 0,
  loyalty_tier    TEXT DEFAULT 'bronze'
                    CHECK (loyalty_tier IN ('bronze','silver','gold','platinum')),
  total_orders    INTEGER DEFAULT 0,
  total_spent     NUMERIC(12,2) DEFAULT 0,
  avg_order_value NUMERIC(10,2) DEFAULT 0,
  last_order_at   TIMESTAMPTZ,
  first_order_at  TIMESTAMPTZ,

  -- Marketing
  referral_code   TEXT UNIQUE,
  referred_by     UUID REFERENCES customers(id),
  whatsapp_opted  BOOLEAN DEFAULT TRUE,
  email_opted     BOOLEAN DEFAULT TRUE,
  sms_opted       BOOLEAN DEFAULT FALSE,

  -- Status
  is_active       BOOLEAN DEFAULT TRUE,
  is_blocked      BOOLEAN DEFAULT FALSE,
  block_reason    TEXT,
  notes           TEXT,                          -- admin notes

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER trg_customers_updated
  BEFORE UPDATE ON customers
  FOR EACH ROW EXECUTE FUNCTION fn_updated_at();

CREATE INDEX idx_customers_phone ON customers(phone);
CREATE INDEX idx_customers_email ON customers(email);
CREATE INDEX idx_customers_city  ON customers(city);

-- ═══════════════════════════════════════════════════════════════════
--  TABLE 5 — CUSTOMER ADDRESSES
--  Multiple saved addresses per customer
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS customer_addresses (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id     UUID REFERENCES customers(id) ON DELETE CASCADE,
  label           TEXT DEFAULT 'Home'
                    CHECK (label IN ('Home','Work','Other')),
  address_line1   TEXT NOT NULL,
  address_line2   TEXT,
  city            TEXT NOT NULL,
  pincode         TEXT,
  state           TEXT DEFAULT 'Tamil Nadu',
  landmark        TEXT,
  is_default      BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
--  TABLE 6 — OFFERS & COUPONS
--  Promo codes, discounts, special offers
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS offers (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code            TEXT UNIQUE NOT NULL,          -- "CHOCO20"
  name            TEXT NOT NULL,                 -- "20% First Order Offer"
  description     TEXT,
  type            TEXT NOT NULL
                    CHECK (type IN (
                      'percentage',              -- 20% off
                      'flat_amount',             -- ₹50 off
                      'free_delivery',           -- free delivery
                      'buy_x_get_y',             -- buy 2 get 1
                      'loyalty_bonus'            -- 2x points
                    )),
  discount_value  NUMERIC(8,2),                  -- 20 for 20%, 50 for ₹50
  min_order_value NUMERIC(8,2) DEFAULT 0,        -- minimum cart value
  max_discount    NUMERIC(8,2),                  -- cap on discount amount

  -- Applicability
  applicable_to   TEXT DEFAULT 'all'
                    CHECK (applicable_to IN ('all','new_customers','existing','loyalty_gold','loyalty_platinum')),
  product_ids     UUID[],                        -- null = applies to all
  category_filter TEXT,                          -- 'brownie' or null

  -- Usage limits
  usage_limit     INTEGER,                       -- null = unlimited
  usage_per_user  INTEGER DEFAULT 1,
  total_used      INTEGER DEFAULT 0,

  -- Validity
  valid_from      TIMESTAMPTZ DEFAULT NOW(),
  valid_until     TIMESTAMPTZ,
  is_active       BOOLEAN DEFAULT TRUE,

  -- Display
  banner_text     TEXT,                          -- "🎉 First Order Special!"
  emoji           TEXT,
  show_on_home    BOOLEAN DEFAULT FALSE,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER trg_offers_updated
  BEFORE UPDATE ON offers
  FOR EACH ROW EXECUTE FUNCTION fn_updated_at();

-- ═══════════════════════════════════════════════════════════════════
--  TABLE 7 — ORDERS
--  Master orders table
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS orders (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_number    TEXT UNIQUE NOT NULL,          -- CC-123456
  customer_id     UUID REFERENCES customers(id),

  -- Customer snapshot (in case customer record changes)
  customer_name   TEXT NOT NULL,
  customer_phone  TEXT NOT NULL,
  customer_email  TEXT,

  -- Delivery address snapshot
  delivery_address TEXT NOT NULL,
  delivery_city   TEXT NOT NULL,
  delivery_pincode TEXT,
  delivery_state  TEXT DEFAULT 'Tamil Nadu',
  delivery_landmark TEXT,

  -- Order type
  order_type      TEXT DEFAULT 'delivery'
                    CHECK (order_type IN ('delivery','pickup','custom')),
  delivery_slot   TEXT,                          -- "Morning 9-12", "Evening 4-7"
  requested_date  DATE,                          -- requested delivery date

  -- Pricing
  subtotal        NUMERIC(10,2) NOT NULL,
  topping_total   NUMERIC(10,2) DEFAULT 0,
  delivery_fee    NUMERIC(10,2) DEFAULT 0,
  discount_code   TEXT REFERENCES offers(code),
  discount_amount NUMERIC(10,2) DEFAULT 0,
  tax_amount      NUMERIC(10,2) DEFAULT 0,
  total           NUMERIC(10,2) NOT NULL,

  -- Payment
  payment_method  TEXT DEFAULT 'cod'
                    CHECK (payment_method IN ('cod','upi','card','netbanking','wallet')),
  payment_status  TEXT DEFAULT 'pending'
                    CHECK (payment_status IN ('pending','paid','failed','refunded','partial')),
  payment_ref     TEXT,                          -- UPI/Razorpay transaction ID
  paid_at         TIMESTAMPTZ,

  -- Order status
  status          TEXT DEFAULT 'pending'
                    CHECK (status IN (
                      'pending',
                      'confirmed',
                      'preparing',
                      'quality_check',
                      'packed',
                      'out_for_delivery',
                      'delivered',
                      'cancelled',
                      'refunded'
                    )),
  cancelled_reason TEXT,

  -- Preferences & notes
  egg_preference  TEXT,
  special_notes   TEXT,
  gift_message    TEXT,
  is_gift         BOOLEAN DEFAULT FALSE,

  -- Source
  order_source    TEXT DEFAULT 'app'
                    CHECK (order_source IN ('app','whatsapp','instagram','phone','walk_in')),

  -- Loyalty
  points_earned   INTEGER DEFAULT 0,
  points_used     INTEGER DEFAULT 0,

  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER trg_orders_updated
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION fn_updated_at();

CREATE INDEX idx_orders_customer   ON orders(customer_id);
CREATE INDEX idx_orders_status     ON orders(status);
CREATE INDEX idx_orders_created_at ON orders(created_at DESC);
CREATE INDEX idx_orders_phone      ON orders(customer_phone);
CREATE INDEX idx_orders_date       ON orders(created_at);

-- ═══════════════════════════════════════════════════════════════════
--  TABLE 8 — ORDER ITEMS
--  Individual line items for each order
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS order_items (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id        UUID REFERENCES orders(id) ON DELETE CASCADE,
  product_id      UUID REFERENCES products(id),
  variant_id      UUID REFERENCES product_variants(id),

  -- Snapshot of product at time of order
  product_name    TEXT NOT NULL,
  tier            TEXT NOT NULL,
  egg_type        TEXT NOT NULL,
  pack_label      TEXT NOT NULL,
  weight_grams    INTEGER,

  quantity        INTEGER NOT NULL DEFAULT 1,
  unit_price      NUMERIC(10,2) NOT NULL,
  topping_price   NUMERIC(10,2) DEFAULT 0,
  line_total      NUMERIC(10,2) NOT NULL,

  -- Toppings chosen
  toppings        JSONB,
  -- [{"id":"...", "name":"Dark Ganache", "price":45}]

  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_order_items_order   ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);

-- ═══════════════════════════════════════════════════════════════════
--  TABLE 9 — ORDER STATUS HISTORY
--  Full audit trail of every status change
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS order_status_history (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id        UUID REFERENCES orders(id) ON DELETE CASCADE,
  from_status     TEXT,
  to_status       TEXT NOT NULL,
  changed_by      TEXT DEFAULT 'admin',          -- 'admin', 'system', 'customer'
  note            TEXT,
  notified_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_status_history_order ON order_status_history(order_id);

-- ═══════════════════════════════════════════════════════════════════
--  TABLE 10 — SALES
--  Daily/weekly/monthly sales aggregates (for analytics)
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sales_daily (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sale_date       DATE UNIQUE NOT NULL,
  total_orders    INTEGER DEFAULT 0,
  total_revenue   NUMERIC(12,2) DEFAULT 0,
  total_discount  NUMERIC(10,2) DEFAULT 0,
  net_revenue     NUMERIC(12,2) DEFAULT 0,
  cod_orders      INTEGER DEFAULT 0,
  upi_orders      INTEGER DEFAULT 0,
  card_orders     INTEGER DEFAULT 0,
  avg_order_value NUMERIC(10,2) DEFAULT 0,
  new_customers   INTEGER DEFAULT 0,
  repeat_customers INTEGER DEFAULT 0,
  units_sold      INTEGER DEFAULT 0,
  cancelled_orders INTEGER DEFAULT 0,
  top_product     TEXT,                          -- name of best selling product that day
  top_city        TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
--  TABLE 11 — PRODUCT SALES STATS
--  Per-product sales tracking
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS product_sales_stats (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id      UUID REFERENCES products(id) ON DELETE CASCADE UNIQUE,
  total_units_sold INTEGER DEFAULT 0,
  total_revenue   NUMERIC(12,2) DEFAULT 0,
  total_orders    INTEGER DEFAULT 0,
  avg_rating      NUMERIC(3,2) DEFAULT 0,
  total_reviews   INTEGER DEFAULT 0,
  last_sold_at    TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
--  TABLE 12 — OFFER USAGE
--  Track which customer used which coupon
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS offer_usage (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  offer_id        UUID REFERENCES offers(id),
  customer_id     UUID REFERENCES customers(id),
  order_id        UUID REFERENCES orders(id),
  discount_applied NUMERIC(8,2) NOT NULL,
  used_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(offer_id, customer_id, order_id)
);

-- ═══════════════════════════════════════════════════════════════════
--  TABLE 13 — REVIEWS & RATINGS
--  Customer reviews per product
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS reviews (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id     UUID REFERENCES customers(id),
  product_id      UUID REFERENCES products(id),
  order_id        UUID REFERENCES orders(id),
  rating          INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  title           TEXT,
  body            TEXT,
  is_verified     BOOLEAN DEFAULT FALSE,         -- verified purchase
  is_featured     BOOLEAN DEFAULT FALSE,
  is_approved     BOOLEAN DEFAULT FALSE,
  admin_reply     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(customer_id, order_id, product_id)
);

-- ═══════════════════════════════════════════════════════════════════
--  TABLE 14 — NOTIFICATIONS LOG
--  Every WhatsApp/email/SMS sent
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS notifications (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id        UUID REFERENCES orders(id),
  customer_id     UUID REFERENCES customers(id),
  type            TEXT NOT NULL
                    CHECK (type IN ('whatsapp','email','sms','push')),
  direction       TEXT DEFAULT 'outbound'
                    CHECK (direction IN ('outbound','inbound')),
  recipient       TEXT NOT NULL,
  subject         TEXT,
  message         TEXT NOT NULL,
  template_name   TEXT,                          -- e.g. 'order_confirmed'
  status          TEXT DEFAULT 'sent'
                    CHECK (status IN ('sent','delivered','read','failed','pending')),
  provider        TEXT,                          -- 'wa.me','twilio','sendgrid'
  provider_msg_id TEXT,
  sent_at         TIMESTAMPTZ DEFAULT NOW(),
  delivered_at    TIMESTAMPTZ,
  read_at         TIMESTAMPTZ
);

CREATE INDEX idx_notifs_order    ON notifications(order_id);
CREATE INDEX idx_notifs_customer ON notifications(customer_id);
CREATE INDEX idx_notifs_sent_at  ON notifications(sent_at DESC);

-- ═══════════════════════════════════════════════════════════════════
--  TABLE 15 — LOYALTY TRANSACTIONS
--  Points earned and redeemed
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  customer_id     UUID REFERENCES customers(id) ON DELETE CASCADE,
  order_id        UUID REFERENCES orders(id),
  type            TEXT NOT NULL
                    CHECK (type IN ('earned','redeemed','bonus','expired','adjusted')),
  points          INTEGER NOT NULL,              -- positive = credit, negative = debit
  balance_after   INTEGER NOT NULL,
  description     TEXT,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_loyalty_customer ON loyalty_transactions(customer_id);

-- ═══════════════════════════════════════════════════════════════════
--  TABLE 16 — INVENTORY
--  Track stock levels per product variant
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS inventory (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  variant_id      UUID REFERENCES product_variants(id) ON DELETE CASCADE UNIQUE,
  stock_qty       INTEGER NOT NULL DEFAULT 0,
  reserved_qty    INTEGER DEFAULT 0,             -- in pending orders
  available_qty   INTEGER GENERATED ALWAYS AS (stock_qty - reserved_qty) STORED,
  reorder_level   INTEGER DEFAULT 10,
  max_stock       INTEGER DEFAULT 200,
  last_restocked  TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
--  TABLE 17 — INVENTORY MOVEMENTS
--  Stock in/out audit trail
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS inventory_movements (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  variant_id      UUID REFERENCES product_variants(id),
  movement_type   TEXT NOT NULL
                    CHECK (movement_type IN ('restock','sold','returned','damaged','adjustment')),
  quantity        INTEGER NOT NULL,
  balance_after   INTEGER NOT NULL,
  order_id        UUID REFERENCES orders(id),
  note            TEXT,
  created_by      TEXT DEFAULT 'admin',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
--  TABLE 18 — DELIVERY ZONES
--  Cities and delivery fees
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS delivery_zones (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  city            TEXT UNIQUE NOT NULL,
  state           TEXT DEFAULT 'Tamil Nadu',
  delivery_fee    NUMERIC(6,2) DEFAULT 0,
  min_order_free_delivery NUMERIC(8,2) DEFAULT 499,
  estimated_days  INTEGER DEFAULT 1,
  is_active       BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════
--  TABLE 19 — CUSTOM CAKE ENQUIRIES
--  For anniversary/birthday/pregnancy slabs & towers
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS custom_cake_enquiries (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  enquiry_number  TEXT UNIQUE,
  customer_name   TEXT NOT NULL,
  customer_phone  TEXT NOT NULL,
  customer_email  TEXT,
  occasion        TEXT
                    CHECK (occasion IN ('birthday','anniversary','pregnancy','wedding','corporate','other')),
  cake_type       TEXT
                    CHECK (cake_type IN ('brownie_slab','brownie_tower','brownie_layer','custom_cake','other')),
  description     TEXT NOT NULL,
  event_date      DATE,
  budget_range    TEXT,
  quantity        INTEGER,
  status          TEXT DEFAULT 'new'
                    CHECK (status IN ('new','quoted','confirmed','in_progress','delivered','cancelled')),
  quoted_price    NUMERIC(10,2),
  final_price     NUMERIC(10,2),
  admin_notes     TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER trg_custom_enquiry_updated
  BEFORE UPDATE ON custom_cake_enquiries
  FOR EACH ROW EXECUTE FUNCTION fn_updated_at();

-- ═══════════════════════════════════════════════════════════════════
--  TABLE 20 — APP SETTINGS
--  Business config, toggles, announcements
-- ═══════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS app_settings (
  key             TEXT PRIMARY KEY,
  value           TEXT,
  value_json      JSONB,
  description     TEXT,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Default settings
INSERT INTO app_settings (key, value, description) VALUES
  ('business_name',         'NSDI ChocoCravings',              'Business display name'),
  ('owner_phone',           '+919972141890',                    'Owner WhatsApp number'),
  ('owner_phone_2',         '+917373279025',                    'Owner second number'),
  ('instagram_handle',      'nsdi.chococravings',               'Instagram username'),
  ('free_delivery_above',   '499',                              'Free delivery threshold in ₹'),
  ('min_order_value',       '270',                              'Minimum order value in ₹'),
  ('app_is_open',           'true',                             'Is app accepting orders?'),
  ('closed_message',        'We are closed right now. We will be back soon! 🍫', 'Message when closed'),
  ('points_per_rupee',      '1',                                'Loyalty points per ₹1 spent'),
  ('points_to_rupee_ratio', '100',                              '100 points = ₹1 discount'),
  ('silver_threshold',      '500',                              'Points needed for Silver'),
  ('gold_threshold',        '1500',                             'Points needed for Gold'),
  ('platinum_threshold',    '5000',                             'Points needed for Platinum'),
  ('welcome_points',        '50',                               'Points given on signup');

-- ═══════════════════════════════════════════════════════════════════
--  ROW LEVEL SECURITY (RLS)
-- ═══════════════════════════════════════════════════════════════════
ALTER TABLE products            ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants    ENABLE ROW LEVEL SECURITY;
ALTER TABLE toppings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_addresses  ENABLE ROW LEVEL SECURITY;
ALTER TABLE offers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders              ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items         ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_status_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_daily         ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_sales_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE offer_usage         ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews             ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications       ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory           ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE delivery_zones      ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_cake_enquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings        ENABLE ROW LEVEL SECURITY;

-- PUBLIC READ policies (catalogue is publicly visible)
CREATE POLICY "public_read_products"       ON products            FOR SELECT USING (is_active = TRUE);
CREATE POLICY "public_read_variants"       ON product_variants    FOR SELECT USING (is_active = TRUE);
CREATE POLICY "public_read_toppings"       ON toppings            FOR SELECT USING (is_active = TRUE);
CREATE POLICY "public_read_offers"         ON offers              FOR SELECT USING (is_active = TRUE);
CREATE POLICY "public_read_delivery_zones" ON delivery_zones      FOR SELECT USING (is_active = TRUE);
CREATE POLICY "public_read_settings"       ON app_settings        FOR SELECT USING (TRUE);
CREATE POLICY "public_read_reviews"        ON reviews             FOR SELECT USING (is_approved = TRUE);

-- PUBLIC INSERT policies (customers can place orders, register, enquire)
CREATE POLICY "public_place_orders"        ON orders              FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "public_add_order_items"     ON order_items         FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "public_register_customer"   ON customers           FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "public_add_address"         ON customer_addresses  FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "public_add_enquiry"         ON custom_cake_enquiries FOR INSERT WITH CHECK (TRUE);
CREATE POLICY "public_add_review"          ON reviews             FOR INSERT WITH CHECK (TRUE);

-- ═══════════════════════════════════════════════════════════════════
--  REALTIME — Enable for live admin feed
--  (Also do this in Supabase UI: Database → Replication)
-- ═══════════════════════════════════════════════════════════════════
-- ALTER PUBLICATION supabase_realtime ADD TABLE orders;
-- ALTER PUBLICATION supabase_realtime ADD TABLE order_items;
-- ALTER PUBLICATION supabase_realtime ADD TABLE custom_cake_enquiries;

-- ═══════════════════════════════════════════════════════════════════
--  AUTO-COMPUTE: Update customer stats after order delivered
-- ═══════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION fn_update_customer_stats()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'delivered' AND OLD.status <> 'delivered' THEN
    UPDATE customers SET
      total_orders    = total_orders + 1,
      total_spent     = total_spent + NEW.total,
      avg_order_value = (total_spent + NEW.total) / (total_orders + 1),
      last_order_at   = NOW(),
      first_order_at  = COALESCE(first_order_at, NOW()),
      loyalty_points  = loyalty_points + NEW.points_earned,
      loyalty_tier    = CASE
        WHEN loyalty_points + NEW.points_earned >= 5000 THEN 'platinum'
        WHEN loyalty_points + NEW.points_earned >= 1500 THEN 'gold'
        WHEN loyalty_points + NEW.points_earned >= 500  THEN 'silver'
        ELSE 'bronze'
      END
    WHERE id = NEW.customer_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_order_delivered
  AFTER UPDATE ON orders
  FOR EACH ROW
  WHEN (NEW.status = 'delivered' AND OLD.status <> 'delivered')
  EXECUTE FUNCTION fn_update_customer_stats();

-- ═══════════════════════════════════════════════════════════════════
--  SEED DATA — Products (all 15 variants, 2 tiers, eggless & egg)
-- ═══════════════════════════════════════════════════════════════════

-- Premium Eggless Brownies
INSERT INTO products (sku, name, slug, category, tier, egg_type, description, shelf_life_days, is_active, is_featured, is_bestseller) VALUES
('PREM-EL-CLASSIC',  'Classic Fudge Chocolate Brownie', 'classic-fudge-eggless',       'brownie','premium','eggless','Rich dark chocolate fudge brownie, hand-baked fresh',5,TRUE,TRUE, TRUE),
('PREM-EL-DOUBLE',   'Double Chocolate Brownie',        'double-choco-eggless',        'brownie','premium','eggless','Dark + milk chocolate layers',5,TRUE,TRUE,FALSE),
('PREM-EL-TRIPLE',   'Triple Chocolate Brownie',        'triple-choco-eggless',        'brownie','premium','eggless','Dark + milk + white chocolate',5,TRUE,TRUE,FALSE),
('PREM-EL-NUTELLA',  'Nutella Brownie',                 'nutella-brownie-eggless',     'brownie','premium','eggless','Hazelnut chocolate spread swirled inside',5,TRUE,TRUE,FALSE),
('PREM-EL-BISCOFF',  'Biscoff Brownie',                 'biscoff-brownie-eggless',     'brownie','premium','eggless','Lotus Biscoff caramelised biscuit spread',5,TRUE,TRUE,FALSE),
('PREM-EL-NUTS',     'Nuts Brownie',                    'nuts-brownie-eggless',        'brownie','premium','eggless','Loaded with premium roasted nuts',5,TRUE,FALSE,FALSE),
('PREM-EL-SEEDS',    'Mixed Seeds Brownie',             'mixed-seeds-eggless',         'brownie','premium','eggless','Healthy multi-seed blend inside',5,TRUE,FALSE,FALSE),
('PREM-EL-SEEDNUTS', 'Seeds with Nuts Brownie',         'seeds-nuts-eggless',          'brownie','premium','eggless','Super seeds and roasted nuts combo',5,TRUE,FALSE,FALSE),
('PREM-EL-WALNUT',   'Walnut Brownie',                  'walnut-brownie-eggless',      'brownie','premium','eggless','Crunchy California walnuts throughout',5,TRUE,FALSE,FALSE),
('PREM-EL-HAZEL',    'Hazelnut Brownie',                'hazelnut-brownie-eggless',    'brownie','premium','eggless','Roasted hazelnut pieces',5,TRUE,FALSE,FALSE),
('PREM-EL-ASSORTED', 'Assorted Brownie Box',            'assorted-brownie-eggless',    'brownie','premium','eggless','Mix: Double, Triple, Nuts, Nutella, Biscoff, Oreo, KitKat',5,TRUE,TRUE,TRUE),
('PREM-EL-RAGI',     'Ragi Brownie',                    'ragi-brownie-eggless',        'brownie','premium','eggless','Healthy finger millet base brownie',5,TRUE,FALSE,FALSE),
('PREM-EL-WHEAT',    'Wheat Brownie',                   'wheat-brownie-eggless',       'brownie','premium','eggless','Wholesome whole wheat flour',5,TRUE,FALSE,FALSE),
('PREM-EL-BLACKRICE','Black Rice Brownie',              'black-rice-brownie-eggless',  'brownie','premium','eggless','Antioxidant-rich black rice brownie',5,TRUE,FALSE,FALSE),
('PREM-EL-MILLET',   'Pearl Millet Brownie',            'pearl-millet-brownie-eggless','brownie','premium','eggless','Kambu (pearl millet) nutritious brownie',5,TRUE,FALSE,FALSE);

-- Couverture Eggless (premium Belgian chocolate tier)
INSERT INTO products (sku, name, slug, category, tier, egg_type, description, shelf_life_days, is_active, is_featured) VALUES
('COUV-EL-CLASSIC',  'Couverture Classic Fudge',        'couverture-classic-eggless',  'brownie','couverture','eggless','Belgian couverture chocolate — intense, silky richness',5,TRUE,TRUE),
('COUV-EL-TRIPLE',   'Couverture Triple Chocolate',     'couverture-triple-eggless',   'brownie','couverture','eggless','Belgian dark+milk+white couverture',5,TRUE,TRUE),
('COUV-EL-NUTELLA',  'Couverture Nutella Brownie',      'couverture-nutella-eggless',  'brownie','couverture','eggless','Belgian chocolate + Nutella luxury',5,TRUE,FALSE);

-- Seed product variants (Premium Eggless Classic — 3 pack sizes)
INSERT INTO product_variants (product_id, pack_label, weight_grams, pieces, price, cost_price) VALUES
((SELECT id FROM products WHERE sku='PREM-EL-CLASSIC'), '4pcs',  250,  4, 300, 140),
((SELECT id FROM products WHERE sku='PREM-EL-CLASSIC'), '9pcs',  500,  9, 590, 270),
((SELECT id FROM products WHERE sku='PREM-EL-CLASSIC'), '16pcs', 1000,16,1170, 530);

-- Seed toppings
INSERT INTO toppings (name, slug, description, price_4pcs, price_9pcs, price_16pcs, emoji, is_active, sort_order) VALUES
('Milk Chocolate Ganache',    'milk-ganache',     'Creamy milk chocolate drizzle',             60,120,240,'🍫',TRUE,1),
('Dark Chocolate Ganache',    'dark-ganache',     'Rich dark chocolate coating',               45, 90,180,'🍫',TRUE,2),
('White Chocolate Ganache',   'white-ganache',    'Smooth white chocolate pour',               70,140,280,'🥛',TRUE,3),
('Nutella',                   'nutella',          'Hazelnut chocolate spread',                 55,110,190,'🍯',TRUE,4),
('Biscoff',                   'biscoff',          'Lotus caramelised biscuit spread',          40, 80,165,'🍪',TRUE,5),
('Ganache + Nuts',            'ganache-nuts',     'Ganache drizzle with roasted nuts',        105,160,320,'🥜',TRUE,6),
('Ganache + Seeds',           'ganache-seeds',    'Ganache with healthy seeds',               105,160,320,'🌿',TRUE,7),
('Ganache + KitKat',          'ganache-kitkat',   'Chocolate wafer crunch on top',            100,155,310,'🍬',TRUE,8),
('Ganache + Oreo',            'ganache-oreo',     'Crushed Oreo cookie topping',               75,120,240,'🖤',TRUE,9),
('Ganache + Milk Choco Chips','ganache-milk-chips','Milk chocolate chips on ganache',         110,170,330,'🍫',TRUE,10),
('Ganache + Dark Choco Chips','ganache-dark-chips','Dark chocolate chips on ganache',         105,160,310,'🍫',TRUE,11),
('Ganache + White Choco Chips','ganache-white-chips','White chocolate chips on ganache',      115,175,360,'🥛',TRUE,12),
('Nutella + Hazelnut',        'nutella-hazelnut', 'Double hazelnut indulgence',                65,140,250,'🌰',TRUE,13),
('Biscoff + Lotus Biscuits',  'biscoff-lotus',    'Spread + whole Lotus biscuit pieces',       50,110,110,'🍪',TRUE,14),
('Ferrero Rocher',            'ferrero-rocher',   'Premium Ferrero Rocher chocolates on top', 130,260,520,'✨',TRUE,15);

-- Seed offers / coupons
INSERT INTO offers (code, name, description, type, discount_value, min_order_value, applicable_to, usage_per_user, show_on_home, banner_text, emoji, valid_until) VALUES
('CHOCO20',   'First Order 20% Off',       '20% off on your first order',           'percentage', 20,  200, 'new_customers',   1, TRUE,  '🎉 First Order Special!',       '🎁', NOW() + INTERVAL '1 year'),
('SWEET50',   '₹50 Off on ₹500+',          '₹50 flat off on orders above ₹500',    'flat_amount', 50, 500, 'all',             1, FALSE, '🍫 Sweet Savings!',             '💰', NOW() + INTERVAL '6 months'),
('BDAY',      'Birthday Free Brownie',     'Free 4pcs on your birthday month',      'flat_amount',300, 300, 'all',             1, TRUE,  '🎂 Happy Birthday Treat!',      '🎂', NOW() + INTERVAL '1 year'),
('NSDI10',    'Loyalty 10% Off',           '10% off for Silver+ members',           'percentage', 10,  100, 'loyalty_gold',    1, FALSE, '⭐ Loyalty Reward!',            '⭐', NULL),
('FREEDEL',   'Free Delivery',             'Free delivery on any order',            'free_delivery',0,   0, 'all',             1, FALSE, '🚚 Free Delivery Today!',       '🚚', NOW() + INTERVAL '30 days');

-- Seed delivery zones (Tamil Nadu cities)
INSERT INTO delivery_zones (city, delivery_fee, min_order_free_delivery, estimated_days) VALUES
('Chennai',        0,  499, 1),
('Coimbatore',     0,  499, 1),
('Madurai',        0,  499, 1),
('Trichy',        40,  599, 1),
('Salem',         40,  599, 1),
('Tirunelveli',   60,  699, 2),
('Erode',         40,  599, 1),
('Vellore',       50,  599, 1),
('Thanjavur',     50,  699, 1),
('Tiruppur',      40,  599, 1),
('Dindigul',      50,  699, 2),
('Kumbakonam',    60,  699, 2),
('Nagercoil',     70,  799, 2),
('Karur',         50,  699, 2),
('Namakkal',      50,  699, 2);

-- ═══════════════════════════════════════════════════════════════════
--  HANDY VIEWS for admin dashboard queries
-- ═══════════════════════════════════════════════════════════════════

-- Orders with customer name + item count (for admin table)
CREATE OR REPLACE VIEW v_orders_summary AS
SELECT
  o.id, o.order_number, o.status, o.payment_method, o.payment_status,
  o.customer_name, o.customer_phone, o.delivery_city,
  o.total, o.discount_amount, o.egg_preference,
  o.created_at, o.updated_at,
  COUNT(oi.id) AS item_count,
  SUM(oi.quantity) AS total_units
FROM orders o
LEFT JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id;

-- Today's sales snapshot
CREATE OR REPLACE VIEW v_today_sales AS
SELECT
  COUNT(*) FILTER (WHERE status <> 'cancelled')                  AS total_orders,
  COALESCE(SUM(total) FILTER (WHERE status <> 'cancelled'),0)    AS total_revenue,
  COUNT(*) FILTER (WHERE status = 'pending')                     AS pending_orders,
  COUNT(*) FILTER (WHERE status = 'delivered')                   AS delivered_orders,
  COUNT(*) FILTER (WHERE status = 'preparing')                   AS preparing_orders,
  COUNT(*) FILTER (WHERE payment_method = 'cod')                 AS cod_orders,
  COUNT(*) FILTER (WHERE payment_method = 'upi')                 AS upi_orders,
  COALESCE(AVG(total) FILTER (WHERE status <> 'cancelled'),0)    AS avg_order_value
FROM orders
WHERE DATE(created_at) = CURRENT_DATE;

-- Top selling products
CREATE OR REPLACE VIEW v_top_products AS
SELECT
  p.name, p.tier, p.egg_type,
  COALESCE(SUM(oi.quantity), 0) AS units_sold,
  COALESCE(SUM(oi.line_total), 0) AS revenue
FROM products p
LEFT JOIN order_items oi ON oi.product_id = p.id
LEFT JOIN orders o ON o.id = oi.order_id AND o.status <> 'cancelled'
GROUP BY p.id, p.name, p.tier, p.egg_type
ORDER BY units_sold DESC;

-- ═══════════════════════════════════════════════════════════════════
--  DONE! 20 tables + 3 views + seed data
--  Verify in: Table Editor → you should see all tables listed
-- ═══════════════════════════════════════════════════════════════════
