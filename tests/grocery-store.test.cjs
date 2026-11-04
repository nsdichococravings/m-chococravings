/* NSDI Store database rules. Run: node tests/grocery-store.test.cjs */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('../.production-test-runtime/node_modules/@electric-sql/pglite');

(async () => {
  const db = new PGlite();
  const ids = { owner: randomUUID(), admin: randomUUID(), staff: randomUUID(), a: randomUUID(), b: randomUUID(), c: randomUUID() };
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    grant usage on schema auth to anon, authenticated;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.customers(id uuid primary key default gen_random_uuid(), name text, phone text, email text,
      is_admin boolean default false, is_employee boolean default false, is_super_user boolean default false);
    create table public.store_orders(id uuid primary key default gen_random_uuid(), item_name text);
    insert into public.store_orders(item_name) values ('Brownie');
    insert into auth.users values
      ('${ids.owner}','owner@x.test',now()),('${ids.admin}','admin@x.test',now()),('${ids.staff}','staff@x.test',now()),
      ('${ids.a}','a@x.test',now()),('${ids.b}','b@x.test',now()),('${ids.c}','c@x.test',now());
    insert into public.customers(name,phone,email,is_admin,is_employee,is_super_user) values
      ('Owner','9000000001','owner@x.test',true,false,true),('Admin','9000000002','admin@x.test',true,false,false),
      ('Staff','9000000003','staff@x.test',false,true,false),('Asha','9000000004','a@x.test',false,false,false),
      ('Bala','9000000005','b@x.test',false,false,false),('Chitra','9000000006','c@x.test',false,false,false);
  `);
  const sql = fs.readFileSync(path.join(__dirname, '../migrations/20261104_grocery_store.sql'), 'utf8');
  await db.exec(sql);
  await db.exec(sql); // runs twice without errors or duplicate seed rows
  await db.exec('grant usage on schema public to anon, authenticated');

  async function as(who) {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [who ? ids[who] : '']);
    await db.exec(who ? 'set role authenticated' : 'set role anon');
  }
  async function rpc(fn, args = []) {
    const ph = args.map((_, i) => '$' + (i + 1)).join(',');
    return (await db.query(`select public.${fn}(${ph}) r`, args)).rows[0].r;
  }
  async function raw(q, a = []) { await db.exec('reset role'); const r = (await db.query(q, a)).rows; return r; }
  const stock = async (pid) => (await raw('select on_hand, reserved from grocery_stock where product_id=$1', [pid]))[0];
  const items = (pid, qty) => JSON.stringify([{ product_id: pid, qty }]);
  const key = () => randomUUID();

  assert.equal(Number((await raw('select count(*) n from grocery_products'))[0].n), 1, 'one placeholder product, seeded once');

  // ── Closed by default ──
  await as(null);
  let cat = await rpc('grocery_catalog');
  assert.equal(cat.open, false); assert.deepEqual(cat.products, []);
  assert.equal((await rpc('grocery_entry')).show, false);
  await as('a');
  assert.equal((await rpc('grocery_catalog')).open, false);
  const placeholder = (await raw('select id from grocery_products'))[0].id;
  await as('a');
  await assert.rejects(rpc('grocery_place_order', [items(placeholder, 1), 'cash', 'Asha', '9000000004', key(), null]), /not open yet/);
  await assert.rejects(db.query('select * from public.grocery_orders'), /permission denied/, 'no direct table reads');
  await assert.rejects(db.query('select * from public.grocery_stock'), /permission denied/);
  await assert.rejects(rpc('grocery_admin_products', [false]), /do not have access/);

  // ── Staff preview ──
  await as('staff');
  cat = await rpc('grocery_catalog');
  assert.equal(cat.open, true); assert.equal(cat.preview, true);
  assert.equal(cat.products.length, 1, 'staff see drafts');
  assert.equal(cat.products[0].cost, undefined, 'catalog never shows cost');
  let entry = await rpc('grocery_entry');
  assert.equal(entry.preview, true); assert.equal(entry.slides.length, 1, 'staff see the draft card');
  await assert.rejects(rpc('grocery_admin_products', [false]), /do not have access/, 'staff cannot manage products');

  // ── Admin: products ──
  await as('admin');
  const base = { name: 'Sona Masoori Rice', brand: 'NSDI', unit_label: '5 kg', mrp: 520, price: 465, cost: 400,
    low_stock_level: 2, selling_fast_level: 2, opening_stock: 2, is_published: true };
  await assert.rejects(rpc('grocery_admin_save_product', [JSON.stringify(base)]), /net quantity, manufacturer/);
  const full = { ...base, net_quantity: '5 kg', manufacturer: 'NSDI Foods, Chennai', country_of_origin: 'India' };
  await assert.rejects(rpc('grocery_admin_save_product', [JSON.stringify(full)]), /photo/);
  await assert.rejects(rpc('grocery_admin_save_product', [JSON.stringify({ ...full, price: 600 })]), /MRP must be at least/);
  await assert.rejects(rpc('grocery_admin_save_product', [JSON.stringify({ ...full, images: [{ full: 'http://x/a.webp', thumb: 'http://x/b.webp' }] })]), /https/);
  const img = [{ full: 'https://cdn.test/p/1.webp', thumb: 'https://cdn.test/p/1-600.webp' }];
  const rice = await rpc('grocery_admin_save_product', [JSON.stringify({ ...full, images: img })]);
  assert.equal(rice.on_hand, 2); assert.equal(rice.available, 2); assert.equal(rice.is_published, true);
  // editing does not add opening stock again
  await rpc('grocery_admin_save_product', [JSON.stringify({ ...full, id: rice.id, images: img, opening_stock: 50 })]);
  assert.deepEqual(await stock(rice.id), { on_hand: 2, reserved: 0 });
  await as('admin');
  await assert.rejects(rpc('grocery_admin_save_settings', [JSON.stringify({ enabled: true })]), /Only the owner/);
  await rpc('grocery_admin_save_settings', [JSON.stringify({ outlet_address: '12 Main Road' })]);
  await assert.rejects(rpc('grocery_admin_analytics', [30]), /do not have access/, 'profit is owner only');

  // ── Pilot: only listed customers can shop ──
  await as('owner');
  await rpc('grocery_admin_save_settings', [JSON.stringify({ enabled: true, pilot_only: true, online_enabled: true })]);
  await rpc('grocery_admin_set_pilot', ['+91 90000 00004', true]);
  await assert.rejects(rpc('grocery_admin_set_pilot', ['123', true]), /10-digit/);
  await as('b');
  assert.equal((await rpc('grocery_catalog')).open, false, 'not on the pilot list');
  await as('a');
  cat = await rpc('grocery_catalog');
  assert.equal(cat.open, true);
  assert.deepEqual(cat.products.map(p => p.name), ['Sona Masoori Rice'], 'customers see only published items');
  assert.equal(cat.settings.outlet_address, '12 Main Road');
  entry = await rpc('grocery_entry');
  assert.equal(entry.show, true); assert.equal(entry.preview, false);
  assert.deepEqual(entry.slides, [], 'drafts and non-featured items are not on the home cards');
  await as('owner');
  await rpc('grocery_admin_save_settings', [JSON.stringify({ pilot_only: false })]);

  // ── Price check before anything is held ──
  await as('a');
  await assert.rejects(rpc('grocery_place_order', [items(rice.id, 1), 'online', 'Asha', '9000000004', key(), 400]), /PRICE_CHANGED.*465\.00/);
  assert.deepEqual(await stock(rice.id), { on_hand: 2, reserved: 0 }, 'nothing held after a price change');
  await as('a');
  await assert.rejects(rpc('grocery_place_order', [items(rice.id, 6), 'online', 'Asha', '9000000004', key(), null]), /up to 5/);

  // ── Hold, idempotency, last pack ──
  await as('a');
  const kA = key();
  const oA = await rpc('grocery_place_order', [items(rice.id, 1), 'online', 'Asha', '9000000004', kA, 465]);
  assert.equal(oA.status, 'awaiting_payment'); assert.equal(Number(oA.total), 465);
  assert.match(oA.order_no, /^NS\d{6}-\d{4}$/);
  assert.equal(oA.idempotency_key, undefined);
  const again = await rpc('grocery_place_order', [items(rice.id, 1), 'online', 'Asha', '9000000004', kA, 465]);
  assert.equal(again.id, oA.id, 'same tap twice = same order');
  assert.deepEqual(await stock(rice.id), { on_hand: 2, reserved: 1 });
  await as('b');
  const oB = await rpc('grocery_place_order', [items(rice.id, 1), 'online', 'Bala', '9000000005', key(), 465]);
  await as('c');
  cat = await rpc('grocery_catalog');
  assert.equal(cat.products[0].available, 0);
  await assert.rejects(rpc('grocery_place_order', [items(rice.id, 1), 'online', 'Chitra', '9000000006', key(), 465]), /only 0 left/);
  assert.deepEqual(await stock(rice.id), { on_hand: 2, reserved: 2 }, 'a failed order holds nothing');

  // ── Payment ──
  await as('c');
  await assert.rejects(rpc('grocery_record_payment', [oA.id, 'pay_AAAAAA', 'order_1']), /not found/, 'cannot pay for someone else');
  await as('a');
  let paid = await rpc('grocery_record_payment', [oA.id, 'pay_AAAAAA', 'order_1']);
  assert.equal(paid.status, 'placed'); assert.equal(paid.payment_status, 'paid');
  assert.deepEqual(await stock(rice.id), { on_hand: 1, reserved: 1 });
  await as('a');
  paid = await rpc('grocery_record_payment', [oA.id, 'pay_AAAAAA', 'order_1']);
  assert.deepEqual(await stock(rice.id), { on_hand: 1, reserved: 1 }, 'same payment twice changes nothing');
  await as('b');
  await assert.rejects(rpc('grocery_record_payment', [oB.id, 'pay_AAAAAA', 'order_1']), /another order/);

  // ── Honest badges: "only N left" and "selling fast" come from real numbers ──
  await as('c');
  cat = await rpc('grocery_catalog');
  assert.equal(cat.products[0].sold_today, 2); assert.equal(cat.products[0].available, 0);

  // ── Expiry frees the hold; a late payment keeps the order only if stock is still free ──
  await raw("update grocery_orders set hold_until=now()-interval '1 minute' where id=$1", [oB.id]);
  assert.equal((await raw('select grocery_release_expired() n'))[0].n, 1);
  assert.deepEqual(await stock(rice.id), { on_hand: 1, reserved: 0 });
  assert.equal((await raw('select status from grocery_orders where id=$1', [oB.id]))[0].status, 'expired');
  await as('b');
  let late = await rpc('grocery_record_payment', [oB.id, 'pay_BBBBBB', null]);
  assert.equal(late.status, 'placed'); assert.equal(late.payment_status, 'paid');
  assert.deepEqual(await stock(rice.id), { on_hand: 0, reserved: 0 });

  // restock, then a late payment after someone else bought the last pack → refund due
  await as('admin');
  await assert.rejects(rpc('grocery_admin_adjust_stock', [rice.id, -1, 'restock', null]), /must add/);
  await rpc('grocery_admin_adjust_stock', [rice.id, 1, 'restock', 'Delivery from supplier']);
  await as('c');
  const oC = await rpc('grocery_place_order', [items(rice.id, 1), 'online', 'Chitra', '9000000006', key(), 465]);
  await raw("update grocery_orders set hold_until=now()-interval '1 minute' where id=$1", [oC.id]);
  await raw('select grocery_release_expired()');
  await as('a');
  const oA2 = await rpc('grocery_place_order', [items(rice.id, 1), 'cash', 'Asha', '9000000004', key(), 465]);
  await as('c');
  late = await rpc('grocery_record_payment', [oC.id, 'pay_CCCCCC', null]);
  assert.equal(late.status, 'expired'); assert.equal(late.payment_status, 'refund_due');
  assert.equal(Number((await raw("select count(*) n from grocery_payments where rzp_payment_id='pay_CCCCCC'"))[0].n), 1, 'late payment is recorded for refund');
  assert.deepEqual(await stock(rice.id), { on_hand: 1, reserved: 1 }, 'the cash order keeps its pack');

  // ── Cash at pickup ──
  await as('staff');
  let open = await rpc('grocery_admin_orders', ['open', 50]);
  assert.ok(open.some(o => o.id === oA2.id));
  await assert.rejects(rpc('grocery_admin_set_status', [oC.id, 'picked_up']), /cannot be picked up/);
  await rpc('grocery_admin_set_status', [oA2.id, 'ready']);
  const done = await rpc('grocery_admin_set_status', [oA2.id, 'picked_up']);
  assert.equal(done.status, 'picked_up'); assert.equal(done.payment_status, 'paid');
  assert.deepEqual(await stock(rice.id), { on_hand: 0, reserved: 0 });
  await assert.rejects(rpc('grocery_admin_record_refund', [oC.id, 465, 'rfnd_1', null]), /do not have access/, 'staff cannot record refunds');

  // ── Refund ──
  await as('admin');
  await assert.rejects(rpc('grocery_admin_record_refund', [oC.id, 999, 'rfnd_1', null]), /more than what was paid/);
  const ref = await rpc('grocery_admin_record_refund', [oC.id, 465, 'rfnd_1', 'Stock gone']);
  assert.equal(ref.payment_status, 'refunded'); assert.equal(Number(ref.refunded), 465);

  // ── Cancel ──
  await rpc('grocery_admin_adjust_stock', [rice.id, 3, 'restock', null]);
  await as('b');
  const oB2 = await rpc('grocery_place_order', [items(rice.id, 2), 'cash', 'Bala', '9000000005', key(), 930]);
  assert.deepEqual(await stock(rice.id), { on_hand: 3, reserved: 2 });
  await as('admin');
  await assert.rejects(rpc('grocery_admin_adjust_stock', [rice.id, -2, 'adjust', 'count']), /below the packs held/);
  await as('b');
  const cancelled = await rpc('grocery_cancel_order', [oB2.id, null]);
  assert.equal(cancelled.status, 'cancelled');
  assert.deepEqual(await stock(rice.id), { on_hand: 3, reserved: 0 });
  await as('b');
  await assert.rejects(rpc('grocery_cancel_order', [oB.id, null]), /paid\. Please ask the outlet/);
  await as('staff');
  const staffCancel = await rpc('grocery_cancel_order', [oB.id, 'Customer asked']);
  assert.equal(staffCancel.payment_status, 'refund_due');
  assert.deepEqual(await stock(rice.id), { on_hand: 4, reserved: 0 }, 'paid pack goes back on the shelf');

  // ── Too many unpaid orders ──
  await as('c');
  for (let i = 0; i < 3; i++) await rpc('grocery_place_order', [items(rice.id, 1), 'cash', 'Chitra', '9000000006', key(), 465]);
  await assert.rejects(rpc('grocery_place_order', [items(rice.id, 1), 'cash', 'Chitra', '9000000006', key(), 465]), /3 unpaid orders/);

  // ── My orders ──
  await as('a');
  const mine = await rpc('grocery_my_orders', [20]);
  assert.equal(mine.length, 2); assert.ok(mine.every(o => o.items.length === 1));
  assert.equal(mine[0].items[0].thumb, img[0].thumb);
  await as('b');
  assert.equal(await rpc('grocery_order', [oA.id]), null, 'cannot read someone else\'s order');

  // ── Delete ──
  await as('admin');
  const unused = await rpc('grocery_admin_save_product', [JSON.stringify({ name: 'Toor Dal', mrp: 180, price: 170, images: img })]);
  const gone = await rpc('grocery_admin_delete_product', [unused.id]);
  assert.equal(gone.deleted, 'removed'); assert.equal(gone.images.length, 1, 'app gets photo addresses to remove');
  const openOrders = (await raw("select count(*) n from grocery_orders where status in ('placed','awaiting_payment') and payment_status='pending'"))[0].n;
  await as('admin');
  const hidden = await rpc('grocery_admin_delete_product', [rice.id]);
  assert.equal(hidden.deleted, 'hidden'); assert.equal(hidden.cancelled, Number(openOrders));
  assert.deepEqual(await stock(rice.id), { on_hand: 4, reserved: 0 }, 'cancelled holds are released');
  await as('a');
  assert.equal((await rpc('grocery_catalog')).products.length, 0);
  assert.equal((await rpc('grocery_my_orders', [20])).length, 2, 'order history kept');
  await as('admin');
  await assert.rejects(rpc('grocery_admin_restore_product', [rice.id]), /do not have access/);
  await as('owner');
  const back = await rpc('grocery_admin_restore_product', [rice.id]);
  assert.equal(back.is_published, false, 'restored items come back as drafts');

  // ── Analytics (owner) ──
  const an = await rpc('grocery_admin_analytics', [30]);
  // Sales = paid and kept: Asha's online order + Asha's cash pickup. Cancelled/refunded orders are not sales.
  assert.equal(Number(an.orders), 2); assert.equal(Number(an.units), 2);
  assert.equal(Number(an.revenue), 930); assert.equal(Number(an.cost), 800);
  assert.equal(an.top[0].name, 'Sona Masoori Rice'); assert.equal(Number(an.top[0].profit), 130);
  assert.equal(Number(an.refunds), 465); assert.equal(Number(an.refund_due), 1);

  // ── Requests ──
  await as(null);
  await assert.rejects(rpc('grocery_request_items', [JSON.stringify([{ key: 'atta', label: 'Atta' }]), null, true]), /sign in|permission denied/);
  await as('a');
  assert.equal(await rpc('grocery_request_items', [JSON.stringify([{ key: 'atta', label: 'Atta' }, { label: 'Aashirvaad  atta 10 kg' }]), 'Every month', true]), 2);
  await rpc('grocery_request_items', [JSON.stringify([{ key: 'atta', label: 'Atta' }]), null, true]);
  await as('b');
  await rpc('grocery_request_items', [JSON.stringify([{ key: 'atta', label: 'Atta' }, { key: 'rice', label: 'Rice' }]), null, false]);
  await assert.rejects(rpc('grocery_request_items', [JSON.stringify([]), null, true]), /between 1 and 15/);
  assert.deepEqual((await rpc('grocery_my_requests')).sort(), ['atta', 'rice']);
  await as('staff');
  await assert.rejects(rpc('grocery_admin_requests', [30]), /do not have access/);
  await as('admin');
  const reqs = await rpc('grocery_admin_requests', [30]);
  assert.equal(reqs[0].item_key, 'atta'); assert.equal(reqs[0].count, 2, 'one vote per customer per item');
  assert.equal(reqs[0].waiting, 1, 'only customers who asked to be told');
  assert.ok(reqs.some(r => r.item_key === 'other:aashirvaad atta 10 kg'));
  assert.equal(await rpc('grocery_admin_notify_request', ['atta', null]), 1);
  assert.equal(await rpc('grocery_admin_notify_request', ['atta', null]), 0, 'nobody is told twice');

  // ── On Store untouched ──
  assert.deepEqual((await raw('select item_name from store_orders')).map(r => r.item_name), ['Brownie']);
  const touched = sql.match(/\b(?:insert into|update|delete from|alter table|drop table)\s+(?:if exists\s+)?public\.(\w+)/gi) || [];
  assert.ok(touched.every(s => /public\.grocery_/.test(s)), 'migration only writes grocery_ tables: ' + touched.filter(s => !/grocery_/.test(s)).join(', '));

  console.log('grocery-store: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
