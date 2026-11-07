/* NSDI Store admin (inside admin-dashboard.html).
 * Nothing loads until the "NSDI Store" view is opened.
 * Tabs: Orders · Products · Requests · Settings · Profit (owner only).
 * All changes go through grocery_admin_* database functions, which check the role again. */
(function () {
  'use strict';
  var BUCKET = 'grocery-photos';
  var G = { tab: 'orders', role: null, orders: [], filter: 'open', products: [], categories: [], showDeleted: false,
    requests: [], reqDays: 30, settings: null, an: null, anDays: 30, edit: null, loaded: {}, timer: null, lastOrderIds: null };
  var COLORS = { peach: '#fff1e6', mint: '#e6f6ef', sky: '#eaf2ff', blush: '#fdebf3', lemon: '#fff8d6', lilac: '#f3ecff' };
  var ACCENT = { peach: '#c2410c', mint: '#0f766e', sky: '#1d4ed8', blush: '#be185d', lemon: '#a16207', lilac: '#6d28d9' };

  function dbc() { return typeof db !== 'undefined' ? db : null; }
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { n = Number(n) || 0; return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
  function when(t) { if (!t) return ''; var d = new Date(t); return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }); }
  function errText(e) {
    var m = (e && (e.message || e.error)) || 'Something went wrong';
    if (/Could not find the function|does not exist/i.test(m)) return 'NSDI Store is not set up in the database yet. Run migrations/20261104_grocery_store.sql in the Supabase SQL Editor.';
    if (/AbortError|timed out|Failed to fetch/i.test(m)) return 'Network is slow. Please try again.';
    return m;
  }
  function note(title, body) { if (typeof showToast === 'function') showToast(title, body || ''); else alert(title + (body ? '\n' + body : '')); }
  async function rpc(fn, args) { var r = await dbc().rpc(fn, args || {}); if (r.error) throw r.error; return r.data; }
  function root() { return document.getElementById('view-grocery'); }

  // ── Styles (scoped to .ga) ──
  function css() {
    if (document.getElementById('ga-css')) return;
    var s = document.createElement('style'); s.id = 'ga-css';
    s.textContent = [
      // Boutique night look, same as the admin panel: aubergine, cream text, gold hairlines, serif headings.
      '.ga{padding:18px 16px 90px;max-width:980px;margin:0 auto}',
      '.ga-tabs{display:flex;gap:4px;overflow-x:auto;padding:5px;margin-bottom:16px;border-radius:999px;background:rgba(255,255,255,.04);border:1px solid var(--bdr);scrollbar-width:none}',
      '.ga-tabs::-webkit-scrollbar{display:none}',
      '.ga-tab{flex-shrink:0;min-height:38px;padding:0 16px;border-radius:999px;border:0;background:transparent;color:var(--dim);font:600 13px "DM Sans",sans-serif;cursor:pointer}',
      '.ga-tab.on{background:linear-gradient(135deg,#e8c98f,#b08d57);color:#2b0a35}',
      '.ga-chip{flex-shrink:0;min-height:36px;padding:0 14px;border-radius:999px;border:1px solid var(--bdr2);background:rgba(255,255,255,.04);color:var(--off);font:600 12.5px "DM Sans",sans-serif;cursor:pointer}',
      '.ga-chip.on{background:rgba(217,184,122,.16);border-color:rgba(217,184,122,.55);color:#ffe9c2}',
      '.ga-row{display:flex;gap:10px;align-items:center}.ga-grow{flex:1 1 0;min-width:0}',
      '.ga-card{position:relative;background:linear-gradient(160deg,rgba(255,255,255,.06),rgba(255,255,255,.02));border:1px solid var(--bdr);border-radius:22px;padding:16px;margin-bottom:12px;box-shadow:0 18px 40px -28px rgba(0,0,0,.8)}',
      '.ga-h{font-family:"Cormorant Garamond",serif;font-size:24px;font-weight:600;color:#fff7ea;line-height:1.1}',
      '.ga-dim{color:var(--dim);font-size:12px}',
      '.ga-btn{min-height:40px;padding:0 16px;border-radius:999px;border:1px solid var(--bdr2);background:rgba(255,255,255,.04);color:#f1e3cf;font:600 12.5px "DM Sans",sans-serif;letter-spacing:.03em;cursor:pointer}',
      '.ga-btn.p{background:linear-gradient(135deg,#6e0977,#a33aac);border-color:rgba(230,181,236,.35);color:#fff}',
      '.ga-btn.g{background:linear-gradient(135deg,#2f7a4b,#47a86d);border-color:transparent;color:#fff}',
      '.ga-btn.r{color:#f4a3b3;border-color:rgba(240,130,150,.4)}',
      '.ga-btn[disabled]{opacity:.5;cursor:not-allowed}',
      '.ga-pill{display:inline-block;font-size:10.5px;font-weight:700;letter-spacing:.06em;padding:4px 10px;border-radius:999px}',
      '.ga-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}',
      '.ga-stat{background:linear-gradient(160deg,rgba(255,255,255,.06),rgba(255,255,255,.02));border:1px solid var(--bdr);border-radius:20px;padding:14px;font-size:10px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:var(--dim)}',
      '.ga-stat b{display:block;font-family:"Cormorant Garamond",serif;font-size:28px;font-weight:700;letter-spacing:0;text-transform:none;color:#fff7ea;margin-top:4px}',
      '.ga-thumb{width:56px;height:70px;border-radius:14px;object-fit:cover;background:#efe3c8;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;color:#6e0977;border:1px solid rgba(217,184,122,.6);overflow:hidden}',
      '.ga-f{display:flex;flex-direction:column;gap:6px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);font-weight:700}',
      '.ga-f input,.ga-f select,.ga-f textarea{min-height:44px;border-radius:14px;border:1px solid var(--bdr2);background:rgba(255,255,255,.05);color:#fff7ea;padding:8px 12px;font:400 14px "DM Sans",sans-serif;letter-spacing:0;text-transform:none}',
      '.ga-f input:focus,.ga-f select:focus,.ga-f textarea:focus{outline:none;border-color:rgba(217,184,122,.7);box-shadow:0 0 0 3px rgba(217,184,122,.12)}',
      '.ga-f textarea{min-height:70px;resize:vertical}',
      '.ga-f2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}',
      '.ga-err{background:rgba(240,130,150,.1);border:1px solid rgba(240,130,150,.35);color:#ffd3dc;border-radius:16px;padding:12px 14px;font-size:13px;margin-bottom:12px}',
      '.ga-info{background:rgba(217,184,122,.08);border:1px solid rgba(217,184,122,.3);color:#f1e3cf;border-radius:16px;padding:12px 14px;font-size:12.5px;margin-bottom:12px;line-height:1.5}',
      '.ga-modal{position:fixed;inset:0;z-index:900;background:rgba(10,3,14,.72);backdrop-filter:blur(4px);display:flex;align-items:flex-end;justify-content:center}',
      '.ga-sheet{background:#1b0a22;border:1px solid var(--bdr2);border-radius:26px 26px 0 0;width:100%;max-width:720px;max-height:94vh;overflow-y:auto;padding:20px 18px 28px;box-shadow:0 -20px 60px -20px rgba(0,0,0,.8)}',
      '@media(min-width:701px){.ga-modal{align-items:center}.ga-sheet{border-radius:26px}}',
      '.ga-prev{width:200px;border-radius:22px;overflow:hidden;background:#fffdfa;color:#24112b;box-shadow:0 18px 40px -16px rgba(0,0,0,.7);flex-shrink:0}',
      '.ga-prev-img{height:250px;position:relative;background:#f6eedf;display:flex;align-items:center;justify-content:center;border-bottom:1px solid #ecdcbf;overflow:hidden}',
      '.ga-prev-img img{width:100%;height:100%;object-fit:cover}',
      '.ga-bar{height:6px;border-radius:999px;background:rgba(255,255,255,.08);overflow:hidden}.ga-bar div{height:100%;background:linear-gradient(90deg,#b08d57,#e8c98f)}',
      '.ga-sw{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid var(--bdr)}',
      '.ga-sw input{width:22px;height:22px;accent-color:#b08d57}',
      '.ga-head{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px}',
      '.ga-eb{font-size:10px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:rgba(217,184,122,.85)}',
      '.ga-title{font-family:"Cormorant Garamond",serif;font-size:34px;font-weight:600;line-height:1;color:#fff7ea;margin-top:4px}',
      '.ga-title em{font-style:italic;color:#e8c98f;font-weight:500}'
    ].join('');
    document.head.appendChild(s);
  }

  // ── Shell ──
  function tabs() {
    var t = [['orders', 'Orders'], ['products', 'Products'], ['requests', 'Requests'], ['settings', 'Settings']];
    if (G.role === 'owner') t.push(['profit', 'Profit']);
    if (G.role === 'staff') t = [['orders', 'Orders']];
    return '<div class="ga-tabs" role="tablist">' + t.map(function (x) {
      return '<button class="ga-tab' + (G.tab === x[0] ? ' on' : '') + '" role="tab" aria-selected="' + (G.tab === x[0]) + '" data-ga-tab="' + x[0] + '">' + x[1] + '</button>';
    }).join('') + '<a class="ga-tab" style="display:inline-flex;align-items:center;text-decoration:none" href="/grocery" target="_blank" rel="noopener">Open store ↗</a></div>';
  }
  function draw(body) {
    var el = root(); if (!el) return;
    var s = G.settings;
    var status = s ? (s.enabled ? (s.pilot_only ? '<span class="ga-pill" style="background:rgba(217,184,122,.14);color:#e8c98f;border:1px solid rgba(217,184,122,.4)">Pilot · listed customers only</span>' : '<span class="ga-pill" style="background:rgba(127,209,160,.12);color:#9fdcb7;border:1px solid rgba(127,209,160,.4)">● Open to customers</span>')
      : '<span class="ga-pill" style="background:rgba(255,255,255,.06);color:var(--dim);border:1px solid var(--bdr)">Off · staff preview only</span>') : '';
    el.innerHTML = '<div class="ga"><div class="ga-head"><div><div class="ga-eb">Daily essentials · outlet pickup</div><div class="ga-title">NSDI <em>Store</em></div></div>' + status + '</div>'
      + tabs() + '<div id="ga-body">' + body + '</div></div>';
  }
  function loading() { draw('<div class="ga-dim" style="padding:20px 0">Loading…</div>'); }
  function failed(e) {
    var t = errText(e), signIn = /sign in/i.test(t);
    draw('<div class="ga-err">' + h(t) + '</div>' + (signIn ? '<a class="ga-btn p" style="display:inline-flex;align-items:center;text-decoration:none" href="auth.html">Sign in</a> ' : '') + '<button class="ga-btn" data-ga="reload">Try again</button>');
  }

  async function open() {
    css();
    if (!root()) return;
    clearInterval(G.timer);
    G.timer = setInterval(function () { if (!document.hidden && isVisible() && G.tab === 'orders') loadOrders(true); }, 30000);
    if (!G.role) {
      loading();
      try { G.settings = await rpc('grocery_admin_settings'); G.role = G.settings.role; }
      catch (e) {
        if (/do not have access/i.test(errText(e))) { G.role = 'staff'; G.tab = 'orders'; }
        else return failed(e);
      }
    }
    show(G.tab);
  }
  function isVisible() { var el = root(); return el && el.style.display !== 'none'; }
  function show(tab) {
    G.tab = tab;
    if (tab === 'orders') return loadOrders();
    if (tab === 'products') return loadProducts();
    if (tab === 'requests') return loadRequests();
    if (tab === 'settings') return loadSettings();
    if (tab === 'profit') return loadProfit();
  }

  // ── Orders ──
  var ST = { awaiting_payment: ['Waiting for payment', '#e8c98f'], placed: ['New · to pack', '#e6b5ec'], ready: ['Ready', '#9fdcb7'], picked_up: ['Picked up', 'var(--dim)'], cancelled: ['Cancelled', '#f4a3b3'], expired: ['Not paid in time', '#f4a3b3'] };
  var PAY = { pending: 'Not paid', paid: 'Paid', refund_due: 'Refund due', refunded: 'Refunded', partially_refunded: 'Part refunded' };
  async function loadOrders(quiet) {
    if (!quiet) draw(ordersHtml(true));
    try {
      var list = await rpc('grocery_admin_orders', { p_filter: G.filter, p_limit: 150 });
      var ids = list.map(function (o) { return o.id; });
      if (G.lastOrderIds && G.filter === 'open') {
        var fresh = list.filter(function (o) { return G.lastOrderIds.indexOf(o.id) < 0; });
        if (fresh.length && !window.GroceryAlerts) { note('🛍️ New NSDI Store order', fresh[0].order_no + ' · ' + money(fresh[0].total)); if (typeof playBeep === 'function') playBeep('neworder'); }
      }
      if (G.filter === 'open') G.lastOrderIds = ids;
      G.orders = list;
      if (G.tab === 'orders' && isVisible()) draw(ordersHtml());
    } catch (e) { if (!quiet) failed(e); }
  }
  function ordersHtml(busy) {
    var f = [['open', 'Open'], ['today', 'Today'], ['refunds', 'Refund due'], ['all', 'All']].map(function (x) {
      return '<button class="ga-chip' + (G.filter === x[0] ? ' on' : '') + '" data-ga-filter="' + x[0] + '">' + x[1] + '</button>';
    }).join('');
    var head = '<div class="ga-tabs">' + f + '<button class="ga-chip" data-ga="reload">↻ Refresh</button></div>';
    if (busy) return head + '<div class="ga-dim">Loading…</div>';
    if (!G.orders.length) return head + '<div class="ga-card ga-dim">' + (G.filter === 'open' ? 'No open orders right now.' : 'No orders here.') + '</div>';
    return head + G.orders.map(function (o) {
      var st = ST[o.status] || ['', 'var(--dim)'], pending = o.payment_status === 'pending';
      var acts = [];
      if (o.status === 'placed') acts.push('<button class="ga-btn p" data-ga-status="ready" data-id="' + o.id + '">Mark ready</button>');
      if ((o.status === 'placed' || o.status === 'ready') && (o.payment_status === 'paid' || (pending && o.payment_method === 'cash')))
        acts.push('<button class="ga-btn g" data-ga-status="picked_up" data-id="' + o.id + '">' + (pending ? 'Cash ' + money(o.total) + ' taken · picked up' : 'Picked up') + '</button>');
      if (['awaiting_payment', 'placed', 'ready'].indexOf(o.status) >= 0) acts.push('<button class="ga-btn r" data-ga-cancel="' + o.id + '">Cancel</button>');
      if (G.role !== 'staff' && ['refund_due', 'partially_refunded'].indexOf(o.payment_status) >= 0) acts.push('<button class="ga-btn" data-ga-refund="' + o.id + '">Record refund</button>');
      return '<div class="ga-card"><div class="ga-row" style="align-items:flex-start;flex-wrap:wrap">'
        + '<div class="ga-grow"><div style="font-family:\'Cormorant Garamond\',serif;font-size:24px;font-weight:700;color:#fff7ea;line-height:1.1">' + h(o.order_no) + '</div>'
        + '<div class="ga-dim">' + when(o.created_at) + ' · ' + h(o.name || '') + (o.phone ? ' · <a href="tel:' + h(o.phone) + '" style="color:var(--pl)">' + h(o.phone) + '</a>' : '') + '</div></div>'
        + '<div style="text-align:right"><div style="font-family:\'Cormorant Garamond\',serif;font-size:26px;font-weight:700;color:#e8c98f;line-height:1.1;margin-bottom:4px">' + money(o.total) + '</div>'
        + '<span class="ga-pill" style="background:rgba(255,255,255,.06);border:1px solid currentColor;color:' + st[1] + '">' + st[0] + '</span> '
        + '<span class="ga-pill" style="background:rgba(255,255,255,.06);color:var(--off)">' + (o.payment_method === 'cash' ? 'Cash · ' : 'Online · ') + (PAY[o.payment_status] || '') + '</span></div></div>'
        + '<div style="margin:10px 0;font-size:14px;color:var(--off)">' + o.items.map(function (i) { return '<div>' + i.qty + ' × ' + h(i.name) + ' <span class="ga-dim">(' + h(i.unit_label) + ')</span></div>'; }).join('') + '</div>'
        + (o.cancel_reason ? '<div class="ga-dim" style="margin-bottom:8px">' + h(o.cancel_reason) + '</div>' : '')
        + (o.hold_until && pending && o.status !== 'ready' ? '<div class="ga-dim" style="margin-bottom:8px">Held until ' + when(o.hold_until) + '</div>' : '')
        + (acts.length ? '<div class="ga-row" style="flex-wrap:wrap;gap:8px">' + acts.join('') + '</div>' : '') + '</div>';
    }).join('');
  }
  async function setStatus(id, status, btn) {
    var o = G.orders.filter(function (x) { return x.id === id; })[0];
    if (status === 'picked_up' && o && o.payment_status === 'pending' && !confirm('Confirm you received ' + money(o.total) + ' in cash for ' + o.order_no + '?')) return;
    btn.disabled = true;
    try { await rpc('grocery_admin_set_status', { p_order_id: id, p_status: status }); note(status === 'ready' ? 'Marked ready' : 'Picked up', o ? o.order_no : ''); loadOrders(true); }
    catch (e) { btn.disabled = false; note('Could not update', errText(e)); }
  }
  async function cancelOrder(id, btn) {
    var o = G.orders.filter(function (x) { return x.id === id; })[0];
    var why = prompt('Cancel ' + (o ? o.order_no : 'order') + '? Reason (shown to the customer):' + (o && o.payment_status === 'paid' ? '\nThis order is paid: it will be marked "Refund due".' : ''), 'Out of stock');
    if (why == null) return;
    btn.disabled = true;
    try { await rpc('grocery_cancel_order', { p_order_id: id, p_reason: why }); note('Order cancelled', o ? o.order_no : ''); loadOrders(true); }
    catch (e) { btn.disabled = false; note('Could not cancel', errText(e)); }
  }
  async function refund(id) {
    var o = G.orders.filter(function (x) { return x.id === id; })[0]; if (!o) return;
    var left = Number(o.total) - Number(o.refunded || 0);
    var amt = prompt('Refund amount for ' + o.order_no + ' (max ' + money(left) + ').\nFirst refund it in the Razorpay dashboard, then record it here.', String(left));
    if (amt == null) return;
    var ref = prompt('Razorpay refund id (rfnd_…) or a short note:');
    if (!ref) return;
    try { await rpc('grocery_admin_record_refund', { p_order_id: id, p_amount: Number(amt), p_reference: ref, p_reason: null }); note('Refund recorded', o.order_no); loadOrders(true); }
    catch (e) { note('Could not record refund', errText(e)); }
  }

  // ── Products ──
  async function loadProducts() {
    draw('<div class="ga-dim">Loading…</div>');
    try { var r = await rpc('grocery_admin_products', { p_include_deleted: G.showDeleted }); G.products = r.products; G.categories = r.categories; G.role = r.role || G.role; draw(productsHtml()); }
    catch (e) { failed(e); }
  }
  function stockLine(p) {
    var a = Math.max(0, p.on_hand - p.reserved);
    var c = a <= 0 ? '#f87171' : (a <= p.low_stock_level ? '#fbbf24' : '#4ade80');
    return '<span style="color:' + c + ';font-weight:700">' + a + ' available</span> <span class="ga-dim">· ' + p.on_hand + ' on shelf' + (p.reserved ? ', ' + p.reserved + ' held for unpaid orders' : '') + ' · ' + p.sold_today + ' sold today</span>';
  }
  function productsHtml() {
    var head = '<div class="ga-row" style="margin-bottom:12px;flex-wrap:wrap"><button class="ga-btn p" data-ga="new">+ Add new item</button><label class="ga-dim ga-row" style="gap:6px;margin-left:auto"><input type="checkbox" data-ga="deleted"' + (G.showDeleted ? ' checked' : '') + '> Show deleted</label></div>';
    if (!G.products.length) return head + '<div class="ga-card ga-dim">No items yet. Tap “Add new item”.</div>';
    return head + G.products.map(function (p) {
      var del = !!p.deleted_at;
      return '<div class="ga-card" style="' + (del ? 'opacity:.6' : '') + '"><div class="ga-row" style="align-items:flex-start">'
        + (p.images[0] ? '<img class="ga-thumb" src="' + h(p.images[0].thumb) + '" alt="">' : '<div class="ga-thumb">' + h(String(p.unit_label).toUpperCase()) + '</div>')
        + '<div class="ga-grow"><div style="font-weight:700;color:var(--white);font-size:15px">' + h(p.name) + ' <span class="ga-dim">' + h(p.unit_label) + '</span></div>'
        + '<div class="ga-dim">' + money(p.price) + ' · MRP ' + money(p.mrp) + (p.cost != null ? ' · cost ' + money(p.cost) + ' · margin ' + Math.round((p.price - p.cost) / p.price * 100) + '%' : ' · <span style="color:#fbbf24">add cost for profit</span>') + '</div>'
        + '<div style="font-size:12.5px;margin-top:4px">' + stockLine(p) + '</div>'
        + '<div style="margin-top:6px">' + (del ? '<span class="ga-pill" style="background:rgba(239,68,68,.15);color:#f87171">Deleted</span>'
          : (p.is_published ? '<span class="ga-pill" style="background:rgba(34,197,94,.15);color:#4ade80">Published</span>' : '<span class="ga-pill" style="background:rgba(255,255,255,.08);color:var(--dim)">Draft</span>'))
        + (p.featured && !del ? ' <span class="ga-pill" style="background:' + COLORS[p.slide_color] + ';color:' + ACCENT[p.slide_color] + '">Home card</span>' : '') + '</div></div></div>'
        + '<div class="ga-row" style="flex-wrap:wrap;gap:8px;margin-top:10px">'
        + (del ? (G.role === 'owner' ? '<button class="ga-btn" data-ga-restore="' + p.id + '">Restore</button>' : '<span class="ga-dim">Only the owner can restore</span>')
          : '<button class="ga-btn p" data-ga-edit="' + p.id + '">Edit</button><button class="ga-btn" data-ga-stock="' + p.id + '">Stock</button><button class="ga-btn r" data-ga-del="' + p.id + '">Delete</button>')
        + '</div></div>';
    }).join('');
  }

  // Product editor
  function blank() {
    return { name: '', brand: 'NSDI', unit_label: '5 kg', description: '', mrp: '', price: '', cost: '', opening_stock: '', low_stock_level: 10, selling_fast_level: 10,
      net_quantity: '5 kg', manufacturer: '', country_of_origin: 'India', best_before: '', fssai_license: '', hsn_code: '', gst_rate: '',
      featured: true, slide_title: '', slide_text: '', slide_color: 'peach', sort: 0, is_published: false, images: [], category_id: '' };
  }
  function openEditor(p) {
    G.edit = p ? JSON.parse(JSON.stringify(p)) : blank();
    G.edit.err = ''; G.edit.uploading = 0;
    drawEditor();
  }
  function closeEditor() { G.edit = null; var m = document.getElementById('ga-modal'); if (m) m.remove(); }
  function modal(html) {
    var m = document.getElementById('ga-modal');
    if (!m) { m = document.createElement('div'); m.id = 'ga-modal'; m.className = 'ga-modal'; document.body.appendChild(m); }
    m.innerHTML = '<div class="ga-sheet" role="dialog" aria-modal="true">' + html + '</div>';
    return m;
  }
  function val(id) { var el = document.getElementById(id); return el ? (el.type === 'checkbox' ? el.checked : el.value) : undefined; }
  function readForm() {
    var e = G.edit; if (!e) return;
    ['name', 'brand', 'unit_label', 'description', 'mrp', 'price', 'cost', 'opening_stock', 'low_stock_level', 'selling_fast_level', 'net_quantity', 'manufacturer',
      'country_of_origin', 'best_before', 'fssai_license', 'hsn_code', 'gst_rate', 'slide_title', 'slide_text', 'slide_color', 'sort', 'category_id'].forEach(function (k) {
      var v = val('ge-' + k); if (v !== undefined) e[k] = v;
    });
    e.featured = !!val('ge-featured');
  }
  function f(label, key, opts) {
    opts = opts || {}; var e = G.edit, v = e[key] == null ? '' : e[key];
    if (opts.area) return '<label class="ga-f">' + label + '<textarea id="ge-' + key + '" maxlength="' + (opts.max || 400) + '">' + h(v) + '</textarea></label>';
    return '<label class="ga-f">' + label + '<input id="ge-' + key + '" value="' + h(v) + '"' + (opts.num ? ' type="number" inputmode="decimal" min="0" step="' + (opts.step || 1) + '"' : '') + (opts.ph ? ' placeholder="' + h(opts.ph) + '"' : '') + ' maxlength="' + (opts.max || 80) + '"></label>';
  }
  function previewCard() {
    var e = G.edit, price = Number(e.price) || 0, mrp = Number(e.mrp) || 0, off = mrp > price && price ? Math.round((1 - price / mrp) * 100) : 0;
    var low = Number(e.low_stock_level) || 0, stock = e.id ? Math.max(0, e.on_hand - e.reserved) : (Number(e.opening_stock) || 0);
    var badge = stock <= 0 ? '<span style="color:#b42318">Sold out</span>' : (stock <= low ? '<span style="color:#b45309">Only ' + stock + ' left</span>' : '<span style="color:#17803d">In stock</span>');
    return '<div class="ga-prev"><div class="ga-prev-img">' + (e.images[0] ? '<img src="' + h(e.images[0].thumb) + '" alt="">' : '<div style="width:96px;height:128px;border-radius:30px 30px 10px 10px;background:#efe3c8;border:2px solid #c9a633;display:flex;flex-direction:column;justify-content:center;align-items:center;overflow:hidden"><b style="width:100%;background:#6e0977;color:#fff;text-align:center;padding:6px 0">' + h(String(e.unit_label || 'PACK').toUpperCase()) + '</b><i style="font-style:normal;font-size:8px;font-weight:700;letter-spacing:.12em;color:#3d0543;margin-top:4px">NSDI STORE</i></div>')
      + '<span style="position:absolute;left:8px;bottom:8px;font-size:8.5px;font-weight:700;letter-spacing:.12em;background:rgba(61,5,67,.88);color:#f3d77a;padding:3px 6px;border-radius:6px">NSDI STORE</span>'
      + (off ? '<span style="position:absolute;right:8px;top:8px;font-size:10px;font-weight:700;background:#3d0543;color:#fff;padding:3px 7px;border-radius:999px">' + off + '% off</span>' : '') + '</div>'
      + '<div style="padding:10px 12px 12px;font-size:12px"><div style="color:#6b5a70;font-size:10.5px">' + h(e.brand || '') + '</div><div style="font-weight:700;font-size:14px">' + h(e.name || 'Product name') + '</div>'
      + '<div><b style="font-size:16px;color:#3d0543">' + money(price) + '</b>' + (off ? ' <s style="color:#6b5a70">' + money(mrp) + '</s>' : '') + '</div><div style="font-weight:700;margin-top:2px">' + badge + '</div></div></div>';
  }
  function drawEditor() {
    var e = G.edit; if (!e) return;
    var colors = Object.keys(COLORS).map(function (c) { return '<option value="' + c + '"' + (e.slide_color === c ? ' selected' : '') + '>' + c + '</option>'; }).join('');
    var cats = G.categories.map(function (c) { return '<option value="' + c.id + '"' + (e.category_id === c.id ? ' selected' : '') + '>' + h(c.name) + '</option>'; }).join('');
    var imgs = e.images.map(function (g, i) {
      return '<div style="position:relative"><img src="' + h(g.thumb) + '" alt="" style="width:72px;height:90px;object-fit:cover;border-radius:10px;border:1.5px solid #c9a633">'
        + '<button class="ga-btn r" style="position:absolute;top:-8px;right:-8px;min-height:26px;width:26px;padding:0;border-radius:50%" aria-label="Remove photo" data-ga-rmimg="' + i + '">×</button>'
        + (i ? '<button class="ga-btn" style="min-height:24px;padding:0 6px;font-size:10px;margin-top:4px" data-ga-firstimg="' + i + '">Make first</button>' : '<div class="ga-dim" style="font-size:10px;margin-top:4px">Main photo</div>') + '</div>';
    }).join('');
    modal('<div class="ga-row" style="margin-bottom:14px"><div class="ga-grow ga-h">' + (e.id ? 'Edit item' : 'Add new item') + '</div><button class="ga-btn" data-ga="close">Close</button></div>'
      + '<div class="ga-row" style="align-items:flex-start;gap:16px;flex-wrap:wrap"><div>' + '<div class="ga-dim" style="margin-bottom:6px">Customer card preview</div>' + previewCard() + '</div>'
      + '<div class="ga-grow" style="min-width:260px;display:flex;flex-direction:column;gap:12px">'
      + '<div><div class="ga-dim" style="margin-bottom:6px">Photos (up to 4). Use a clear, well-lit photo at least 1000 px wide. It is cropped to a 4:5 card.</div>'
      + '<div class="ga-row" style="flex-wrap:wrap;gap:12px">' + imgs + (e.images.length < 4 ? '<label class="ga-btn" style="display:inline-flex;align-items:center;min-height:90px;width:72px;justify-content:center;text-align:center">' + (e.uploading ? '…' : '+ Photo') + '<input id="ge-file" type="file" accept="image/*" hidden></label>' : '') + '</div></div>'
      + f('Product name', 'name', { ph: 'e.g. Sona Masoori Rice' })
      + '<div class="ga-f2">' + f('Brand', 'brand') + f('Pack size on card', 'unit_label', { ph: '5 kg' }) + '</div>'
      + '<label class="ga-f">Category<select id="ge-category_id">' + cats + '</select></label>'
      + f('Short description', 'description', { area: true })
      + '</div></div>'
      + '<div class="ga-h" style="font-size:17px;margin:18px 0 8px">Price &amp; stock</div>'
      + '<div class="ga-f2">' + f('MRP (₹)', 'mrp', { num: 1, step: '0.01' }) + f('Selling price (₹)', 'price', { num: 1, step: '0.01' }) + f('Your cost (₹, admin only)', 'cost', { num: 1, step: '0.01' })
      + (e.id ? '<div class="ga-f">Stock<div style="color:var(--white);font-size:14px;padding:10px 0">' + Math.max(0, e.on_hand - e.reserved) + ' available · use “Stock” to restock</div></div>' : f('Opening stock (packs)', 'opening_stock', { num: 1 }))
      + f('Show “Only N left” at', 'low_stock_level', { num: 1 }) + f('Show “Selling fast” after N sold today', 'selling_fast_level', { num: 1 }) + '</div>'
      + '<div class="ga-dim" style="margin-top:6px">Stock goes down by itself when an order is paid, and comes back when an unpaid order runs out of time or is cancelled. Badges only use these real numbers.</div>'
      + '<div class="ga-h" style="font-size:17px;margin:18px 0 8px">Pack declarations</div>'
      + '<div class="ga-f2">' + f('Net quantity', 'net_quantity', { ph: '5 kg' }) + f('Country of origin', 'country_of_origin') + '</div>'
      + f('Manufacturer / packer name and address', 'manufacturer', { max: 200 })
      + '<div class="ga-f2">' + f('Best before', 'best_before', { ph: '6 months from packing' }) + f('FSSAI licence no.', 'fssai_license') + f('HSN code', 'hsn_code') + f('GST %', 'gst_rate', { num: 1, step: '0.01' }) + '</div>'
      + '<div class="ga-h" style="font-size:17px;margin:18px 0 8px">Home card</div>'
      + '<label class="ga-sw"><span>Show as a big card on the home page and store</span><input type="checkbox" id="ge-featured"' + (e.featured ? ' checked' : '') + '></label>'
      + '<div class="ga-f2" style="margin-top:10px">' + f('Card title', 'slide_title', { ph: e.name || 'New: 5 KG Pack' }) + '<label class="ga-f">Card colour<select id="ge-slide_color">' + colors + '</select></label></div>'
      + f('Card line', 'slide_text', { ph: 'Pick up at the outlet' }) + f('Order (lower shows first)', 'sort', { num: 1 })
      + (e.err ? '<div class="ga-err" style="margin-top:14px" role="alert">' + h(e.err) + '</div>' : '')
      + '<div class="ga-row" style="margin-top:16px;gap:10px;flex-wrap:wrap"><button class="ga-btn" data-ga="save-draft"' + (e.uploading ? ' disabled' : '') + '>Save as draft</button>'
      + '<button class="ga-btn p" data-ga="publish"' + (e.uploading ? ' disabled' : '') + '>' + (e.is_published ? 'Save &amp; keep published' : 'Publish') + '</button></div>'
      + '<div class="ga-dim" style="margin-top:8px">Publishing needs a photo, net quantity, manufacturer and country of origin.</div>');
    var file = document.getElementById('ge-file');
    if (file) file.addEventListener('change', function () { if (file.files[0]) addPhoto(file.files[0]); });
    var m = document.getElementById('ga-modal');
    m.oninput = function (ev) { if (/^ge-(name|brand|unit_label|mrp|price|low_stock_level|opening_stock)$/.test(ev.target.id)) { readForm(); var pv = m.querySelector('.ga-prev'); if (pv) pv.outerHTML = previewCard(); } };
  }
  async function save(publish) {
    readForm(); var e = G.edit;
    var payload = {}; Object.keys(e).forEach(function (k) { if (['err', 'uploading', 'available', 'on_hand', 'reserved', 'sold_today', 'ever_ordered', 'deleted_at', 'category'].indexOf(k) < 0) payload[k] = e[k]; });
    payload.is_published = publish;
    e.err = ''; e.uploading = 1; drawEditor();
    try { await rpc('grocery_admin_save_product', { p: payload }); closeEditor(); note(publish ? 'Published' : 'Saved as draft', payload.name); loadProducts(); }
    catch (x) { e.uploading = 0; e.err = errText(x); drawEditor(); }
  }

  // Photo: crop to 4:5, make 1200 px and 600 px WebP copies in the browser, upload both.
  function loadImage(file) {
    return new Promise(function (ok, bad) {
      var url = URL.createObjectURL(file), im = new Image();
      im.onload = function () { ok(im); }; im.onerror = function () { bad(new Error('This file is not a photo we can read')); };
      im.src = url;
    });
  }
  function encode(im, w) {
    var hgt = Math.round(w * 1.25), sw = im.naturalWidth, sh = im.naturalHeight, cw = sw, ch = cw * 1.25;
    if (ch > sh) { ch = sh; cw = ch / 1.25; }
    var c = document.createElement('canvas'); c.width = w; c.height = hgt;
    var x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
    x.drawImage(im, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, w, hgt);
    return new Promise(function (ok) { c.toBlob(function (b) { if (b && b.type === 'image/webp') return ok(b); c.toBlob(ok, 'image/jpeg', 0.86); }, 'image/webp', w > 800 ? 0.86 : 0.8); });
  }
  async function addPhoto(file) {
    var e = G.edit; if (!e) return;
    e.err = '';
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error('Photo is too large (max 15 MB)');
      var im = await loadImage(file);
      if (Math.min(im.naturalWidth, im.naturalHeight) < 1000) throw new Error('Photo is ' + im.naturalWidth + '×' + im.naturalHeight + ' px. Please use one at least 1000 px on the short side, so it looks sharp.');
      e.uploading = 1; drawEditor();
      var big = await encode(im, 1200), small = await encode(im, 600);
      var id = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)), ext = big.type === 'image/webp' ? 'webp' : 'jpg';
      var st = dbc().storage.from(BUCKET), urls = {};
      var parts = [['full', 'p/' + id + '-1200.' + ext, big], ['thumb', 'p/' + id + '-600.' + ext, small]];
      for (var i = 0; i < parts.length; i++) {
        var up = await st.upload(parts[i][1], parts[i][2], { contentType: parts[i][2].type, cacheControl: '31536000', upsert: false });
        if (up.error) throw up.error;
        urls[parts[i][0]] = st.getPublicUrl(parts[i][1]).data.publicUrl;
      }
      if (!G.edit) return;
      G.edit.images.push(urls);
    } catch (x) { if (G.edit) G.edit.err = errText(x); }
    if (G.edit) { G.edit.uploading = 0; readFormSafe(); drawEditor(); }
  }
  function readFormSafe() { try { readForm(); } catch (x) {} }
  function pathOf(url) { var i = String(url).indexOf('/' + BUCKET + '/'); return i >= 0 ? decodeURIComponent(String(url).slice(i + BUCKET.length + 2)) : null; }
  async function removeFiles(urls) { var paths = urls.map(pathOf).filter(Boolean); if (paths.length) { try { await dbc().storage.from(BUCKET).remove(paths); } catch (x) {} } }

  // Stock
  async function stockSheet(id) {
    var p = G.products.filter(function (x) { return x.id === id; })[0]; if (!p) return;
    var m = modal('<div class="ga-row" style="margin-bottom:12px"><div class="ga-grow ga-h">Stock · ' + h(p.name) + '</div><button class="ga-btn" data-ga="close">Close</button></div>'
      + '<div style="margin-bottom:12px;font-size:13px">' + stockLine(p) + '</div>'
      + '<div class="ga-f2"><label class="ga-f">What happened<select id="gs-kind"><option value="restock">New stock arrived (+)</option><option value="adjust">Correct the count (+ or −)</option></select></label>'
      + '<label class="ga-f">Packs<input id="gs-qty" type="number" inputmode="numeric" step="1" placeholder="e.g. 20"></label></div>'
      + '<label class="ga-f" style="margin-top:10px">Note (optional)<input id="gs-note" maxlength="120" placeholder="e.g. supplier bill 123, 2 packs damaged"></label>'
      + '<div id="gs-err"></div><button class="ga-btn p" style="margin-top:12px" data-ga-stocksave="' + p.id + '">Save</button>'
      + '<div class="ga-h" style="font-size:16px;margin:18px 0 8px">History</div><div id="gs-hist" class="ga-dim">Loading…</div>');
    try {
      var rows = await rpc('grocery_admin_stock_history', { p_product_id: id, p_limit: 40 });
      var K = { opening: 'Opening stock', restock: 'Restock', adjust: 'Count corrected', reserve: 'Held for order', release: 'Hold released', sale: 'Sold', 'return': 'Returned' };
      var el = m.querySelector('#gs-hist');
      if (el) el.innerHTML = rows.length ? rows.map(function (r) {
        var sign = ['reserve', 'release', 'sale'].indexOf(r.kind) >= 0 ? '' : (r.qty > 0 ? '+' : '');
        return '<div class="ga-row" style="padding:7px 0;border-bottom:1px solid var(--bdr);font-size:12.5px"><span class="ga-grow" style="color:var(--off)">' + K[r.kind] + ' ' + sign + r.qty + (r.order_no ? ' · ' + h(r.order_no) : '') + (r.note ? ' · ' + h(r.note) : '') + '</span><span>' + r.on_hand_after + ' on shelf</span><span style="width:110px;text-align:right">' + when(r.created_at) + '</span></div>';
      }).join('') : 'No changes yet.';
    } catch (x) { var el2 = m.querySelector('#gs-hist'); if (el2) el2.textContent = errText(x); }
  }
  async function saveStock(id, btn) {
    var kind = val('gs-kind'), qty = parseInt(val('gs-qty'), 10), noteTxt = val('gs-note');
    var err = document.getElementById('gs-err');
    if (!qty) { err.innerHTML = '<div class="ga-err" style="margin-top:10px">Enter how many packs</div>'; return; }
    btn.disabled = true;
    try { await rpc('grocery_admin_adjust_stock', { p_product_id: id, p_delta: qty, p_kind: kind, p_note: noteTxt || null }); closeEditor(); note('Stock updated', ''); loadProducts(); }
    catch (x) { btn.disabled = false; err.innerHTML = '<div class="ga-err" style="margin-top:10px">' + h(errText(x)) + '</div>'; }
  }

  // Delete / restore
  function deleteSheet(id) {
    var p = G.products.filter(function (x) { return x.id === id; })[0]; if (!p) return;
    modal('<div class="ga-h" style="margin-bottom:10px">Delete ' + h(p.name) + '?</div>'
      + (p.ever_ordered ? '<div class="ga-info">This item has orders, so it will be <b>hidden</b>, not erased. Past orders and reports keep it. Any unpaid orders for it are cancelled and their packs released. The owner can restore it later.</div>'
        : '<div class="ga-info">Nobody has ordered this item, so it will be <b>removed completely</b>, including its photos. This cannot be undone.</div>')
      + '<div class="ga-row" style="gap:10px"><button class="ga-btn" data-ga="close">Keep it</button><button class="ga-btn r" data-ga-delok="' + p.id + '">Delete</button></div>');
  }
  async function doDelete(id, btn) {
    btn.disabled = true;
    try {
      var r = await rpc('grocery_admin_delete_product', { p_product_id: id });
      if (r.deleted === 'removed') await removeFiles([].concat.apply([], r.images || []));
      closeEditor(); note(r.deleted === 'removed' ? 'Item removed' : 'Item hidden', r.cancelled ? r.cancelled + ' unpaid order(s) cancelled' : ''); loadProducts();
    } catch (x) { btn.disabled = false; note('Could not delete', errText(x)); }
  }
  async function restore(id) {
    try { await rpc('grocery_admin_restore_product', { p_product_id: id }); note('Restored as a draft', 'Edit and publish it to show it again'); loadProducts(); }
    catch (x) { note('Could not restore', errText(x)); }
  }

  // ── Requests ──
  async function loadRequests() {
    draw(requestsHtml(true));
    try { G.requests = await rpc('grocery_admin_requests', { p_days: G.reqDays }); draw(requestsHtml()); }
    catch (e) { failed(e); }
  }
  function requestsHtml(busy) {
    var chips = '<div class="ga-tabs">' + [[7, 'This week'], [30, 'This month'], [0, 'All time']].map(function (x) {
      return '<button class="ga-chip' + (G.reqDays === x[0] ? ' on' : '') + '" data-ga-days="' + x[0] + '">' + x[1] + '</button>';
    }).join('') + '</div><div class="ga-dim" style="margin-bottom:10px">What customers asked NSDI Store to stock, most asked first. One vote per customer per item.</div>';
    if (busy) return chips + '<div class="ga-dim">Loading…</div>';
    if (!G.requests.length) return chips + '<div class="ga-card ga-dim">No requests yet. Customers can ask from the “What should we stock for you?” card.</div>';
    var max = G.requests[0].count || 1;
    return chips + G.requests.map(function (r, i) {
      var notes = (r.notes || []).filter(Boolean);
      return '<div class="ga-card"><div class="ga-row"><span style="width:30px;font-weight:700;color:#fbbf24">#' + (i + 1) + '</span><div class="ga-grow"><div style="font-weight:700;color:var(--white)">' + h(r.label) + '</div>'
        + (notes.length ? '<div class="ga-dim">' + notes.map(h).join(' · ') + '</div>' : '') + '</div><span style="font-size:18px;font-weight:700;color:var(--white)">' + r.count + '</span></div>'
        + '<div class="ga-bar" style="margin:10px 0"><div style="width:' + Math.round(r.count / max * 100) + '%"></div></div>'
        + '<div class="ga-row" style="justify-content:space-between;flex-wrap:wrap"><span class="ga-dim">' + (r.notified ? r.notified + ' already told it arrived · ' : '') + r.waiting + ' waiting to be told</span>'
        + (r.waiting ? '<button class="ga-btn p" data-ga-notify="' + h(r.item_key) + '" data-n="' + r.waiting + '" data-label="' + h(r.label) + '">Now in stock · notify ' + r.waiting + '</button>' : '') + '</div></div>';
    }).join('');
  }
  async function notifyReq(btn) {
    var key = btn.getAttribute('data-ga-notify'), n = btn.getAttribute('data-n'), label = btn.getAttribute('data-label');
    if (!confirm('Send a notification to ' + n + ' customer(s) that "' + label + '" is now in NSDI Store?\nAdd the item and publish it first.')) return;
    btn.disabled = true;
    try { var c = await rpc('grocery_admin_notify_request', { p_item_key: key, p_message: null }); note('Notified', c + ' customer(s)'); loadRequests(); }
    catch (x) { btn.disabled = false; note('Could not notify', errText(x)); }
  }

  // ── Settings ──
  async function loadSettings() {
    draw('<div class="ga-dim">Loading…</div>');
    try { G.settings = await rpc('grocery_admin_settings'); G.role = G.settings.role; draw(settingsHtml()); }
    catch (e) { failed(e); }
  }
  function settingsHtml() {
    var s = G.settings, owner = G.role === 'owner';
    function sw(key, label, sub, ownerOnly) {
      return '<label class="ga-sw"><span><span style="color:var(--white);font-weight:600">' + label + '</span><br><span class="ga-dim">' + sub + '</span></span><input type="checkbox" id="gt-' + key + '"' + (s[key] ? ' checked' : '') + (ownerOnly && !owner ? ' disabled' : '') + '></label>';
    }
    function inp(key, label, num) { return '<label class="ga-f">' + label + '<input id="gt-' + key + '" value="' + h(s[key] == null ? '' : s[key]) + '"' + (num ? ' type="number" inputmode="numeric"' : '') + ' maxlength="160"></label>'; }
    return '<div class="ga-card"><div class="ga-h" style="font-size:17px">Store status</div>'
      + (owner ? '' : '<div class="ga-info" style="margin-top:8px">Only the owner can open the store or turn on online payment.</div>')
      + sw('enabled', 'Open NSDI Store', 'Off: only staff can see it (preview).', true)
      + sw('pilot_only', 'Pilot: only listed customers', 'Try it with a few customers first.', true)
      + sw('online_enabled', 'Online payment (Razorpay)', 'Uses the same Razorpay account as On Store. Leave off until tested.', true)
      + sw('cash_enabled', 'Cash at pickup', 'Customer pays at the counter.', false) + '</div>'
      + '<div class="ga-card"><div class="ga-h" style="font-size:17px;margin-bottom:10px">Outlet &amp; rules</div><div style="display:flex;flex-direction:column;gap:10px">'
      + inp('outlet_name', 'Outlet name') + inp('outlet_address', 'Outlet address') + inp('pickup_hours', 'Pickup hours')
      + inp('notice', 'Notice at the top of the store (optional)')
      + '<div class="ga-f2">' + inp('hold_minutes', 'Hold for online payment (minutes)', 1) + inp('cash_hold_hours', 'Hold for cash orders (hours)', 1) + inp('max_qty_per_item', 'Max packs per item per order', 1) + '</div>'
      + '<div id="gt-err"></div><button class="ga-btn p" data-ga="save-settings" style="align-self:flex-start">Save settings</button></div></div>'
      + '<div class="ga-card"><div class="ga-h" style="font-size:17px">Pilot customers</div><div class="ga-dim" style="margin:4px 0 10px">Used while “Pilot” is on. Add by the phone number on their account.</div>'
      + '<div class="ga-row"><input id="gt-pilot" type="tel" inputmode="tel" placeholder="10-digit phone" style="flex:1;min-height:42px;border-radius:10px;border:1px solid var(--bdr2);background:rgba(255,255,255,.05);color:var(--white);padding:8px 12px"><button class="ga-btn p" data-ga="pilot-add">Add</button></div>'
      + (s.pilots.length ? s.pilots.map(function (p) { return '<div class="ga-row" style="padding:8px 0;border-bottom:1px solid var(--bdr)"><span class="ga-grow" style="color:var(--off)">' + h(p.name || '') + ' · ' + h(p.phone || '') + '</span><button class="ga-btn r" data-ga-pilotrm="' + h(p.phone || '') + '">Remove</button></div>'; }).join('') : '<div class="ga-dim" style="margin-top:10px">No pilot customers yet.</div>')
      + '</div>';
  }
  async function saveSettings(btn) {
    var s = G.settings, p = {};
    ['enabled', 'pilot_only', 'online_enabled', 'cash_enabled'].forEach(function (k) { var v = val('gt-' + k); if (v !== undefined) p[k] = v; });
    ['outlet_name', 'outlet_address', 'pickup_hours', 'notice', 'hold_minutes', 'cash_hold_hours', 'max_qty_per_item'].forEach(function (k) { var v = val('gt-' + k); if (v !== undefined) p[k] = v; });
    if (p.enabled && !s.enabled && !confirm(p.pilot_only ? 'Open NSDI Store for pilot customers?' : 'Open NSDI Store for ALL customers?')) return;
    if (p.online_enabled && !s.online_enabled && !confirm('Turn on online payment? Customers will pay real money through Razorpay.')) return;
    btn.disabled = true;
    try { G.settings = await rpc('grocery_admin_save_settings', { p: p }); note('Settings saved', ''); draw(settingsHtml()); }
    catch (x) { btn.disabled = false; document.getElementById('gt-err').innerHTML = '<div class="ga-err">' + h(errText(x)) + '</div>'; }
  }
  async function pilot(phone, add) {
    try { G.settings = await rpc('grocery_admin_set_pilot', { p_phone: phone, p_add: add }); draw(settingsHtml()); }
    catch (x) { note('Could not update', errText(x)); }
  }

  // ── Profit (owner) ──
  async function loadProfit() {
    draw('<div class="ga-dim">Loading…</div>');
    try { G.an = await rpc('grocery_admin_analytics', { p_days: G.anDays }); draw(profitHtml()); }
    catch (e) { failed(e); }
  }
  function profitHtml() {
    var a = G.an, gp = Number(a.revenue) - Number(a.cost), margin = Number(a.revenue) ? Math.round(gp / Number(a.revenue) * 100) : 0;
    var chips = '<div class="ga-tabs">' + [[7, '7 days'], [30, '30 days'], [90, '90 days']].map(function (x) {
      return '<button class="ga-chip' + (G.anDays === x[0] ? ' on' : '') + '" data-ga-andays="' + x[0] + '">' + x[1] + '</button>';
    }).join('') + '</div>';
    function stat(l, v, sub) { return '<div class="ga-stat"><span class="ga-dim">' + l + '</span><b>' + v + '</b>' + (sub ? '<span class="ga-dim">' + sub + '</span>' : '') + '</div>'; }
    return chips + '<div class="ga-grid">' + stat('Sales', money(a.revenue), a.orders + ' orders · ' + a.units + ' packs')
      + stat('Gross profit', money(gp), margin + '% margin') + stat('Refunded', money(a.refunds), a.refund_due ? a.refund_due + ' refund(s) still due' : '')
      + stat('Not paid in time', a.expired, 'orders released') + stat('Customer requests', a.requests, 'items asked for') + '</div>'
      + (Number(a.cost_missing_units) ? '<div class="ga-info" style="margin-top:10px">' + a.cost_missing_units + ' packs were sold without a cost price, so the profit shown is too high. Add “Your cost” on those items.</div>' : '')
      + '<div class="ga-card" style="margin-top:12px"><div class="ga-h" style="font-size:17px;margin-bottom:8px">Top items</div>'
      + (a.top.length ? a.top.map(function (t) { return '<div class="ga-row" style="padding:7px 0;border-bottom:1px solid var(--bdr);font-size:13px"><span class="ga-grow" style="color:var(--off)">' + h(t.name) + '</span><span>' + t.units + ' packs</span><span style="width:90px;text-align:right">' + money(t.revenue) + '</span><span style="width:90px;text-align:right;color:#4ade80">' + (t.profit == null ? '—' : money(t.profit)) + '</span></div>'; }).join('') : '<div class="ga-dim">No sales yet.</div>')
      + '</div><div class="ga-dim">Sales count paid orders that were not cancelled. Profit = selling price − your cost, before rent and wages.</div>';
  }

  // ── Events ──
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-ga],[data-ga-tab],[data-ga-filter],[data-ga-status],[data-ga-cancel],[data-ga-refund],[data-ga-edit],[data-ga-stock],[data-ga-del],[data-ga-delok],[data-ga-restore],[data-ga-rmimg],[data-ga-firstimg],[data-ga-stocksave],[data-ga-days],[data-ga-notify],[data-ga-pilotrm],[data-ga-andays]');
    if (!t || !(root() && (root().contains(t) || (document.getElementById('ga-modal') || { contains: function () { return false; } }).contains(t)))) return;
    var d = t.dataset, a = d.ga;
    if (d.gaTab) return show(d.gaTab);
    if (d.gaFilter) { G.filter = d.gaFilter; G.lastOrderIds = null; return loadOrders(); }
    if (d.gaStatus) return setStatus(d.id, d.gaStatus, t);
    if (d.gaCancel) return cancelOrder(d.gaCancel, t);
    if (d.gaRefund) return refund(d.gaRefund);
    if (d.gaEdit) return openEditor(G.products.filter(function (p) { return p.id === d.gaEdit; })[0]);
    if (d.gaStock) return stockSheet(d.gaStock);
    if (d.gaDel) return deleteSheet(d.gaDel);
    if (d.gaDelok) return doDelete(d.gaDelok, t);
    if (d.gaRestore) return restore(d.gaRestore);
    if (d.gaStocksave) return saveStock(d.gaStocksave, t);
    if (d.gaRmimg) { readForm(); G.edit.images.splice(+d.gaRmimg, 1); return drawEditor(); }
    if (d.gaFirstimg) { readForm(); var im = G.edit.images.splice(+d.gaFirstimg, 1)[0]; G.edit.images.unshift(im); return drawEditor(); }
    if (d.gaDays !== undefined) { G.reqDays = +d.gaDays; return loadRequests(); }
    if (d.gaNotify) return notifyReq(t);
    if (d.gaPilotrm) return pilot(d.gaPilotrm, false);
    if (d.gaAndays) { G.anDays = +d.gaAndays; return loadProfit(); }
    if (a === 'reload') return show(G.tab);
    if (a === 'new') return openEditor(null);
    if (a === 'close') return closeEditor();
    if (a === 'save-draft') return save(false);
    if (a === 'publish') return save(true);
    if (a === 'save-settings') return saveSettings(t);
    if (a === 'pilot-add') { var v = val('gt-pilot'); if (v) pilot(v, true); return; }
  });
  document.addEventListener('change', function (ev) {
    if (ev.target.matches && ev.target.matches('[data-ga="deleted"]')) { G.showDeleted = ev.target.checked; loadProducts(); }
  });

  // The view must sit directly in .main. (Older markup leaves the views after Orders
  // inside the Orders view, which would hide this one whenever Orders is hidden.)
  (function place() {
    var v = root(), main = document.querySelector('.main');
    var orders = document.getElementById('view-orders');
    if (v && main && v.parentElement !== main) {
      if (orders && orders.parentElement === main) main.insertBefore(v, orders.nextSibling); else main.appendChild(v);
    }
  })();

  // Hook into the dashboard's view switcher.
  if (typeof window.showView === 'function') {
    var orig = window.showView;
    window.showView = function (name, el) {
      orig.apply(this, arguments);
      if (name === 'grocery') { var tt = document.getElementById('topbar-title'); if (tt) tt.textContent = 'NSDI Store'; open(); }
      else clearInterval(G.timer);
    };
  }
  window.ccGroceryAdmin = { open: open, showOrders: function () { if (G.role) show('orders'); } };

  // Stand-alone page (grocery-admin.html): open straight away, on the tab in the address (#products, #orders…).
  if (document.body && document.body.hasAttribute('data-grocery-admin')) {
    var want = (location.hash || '').replace('#', '');
    if (['orders', 'products', 'requests', 'settings', 'profit'].indexOf(want) >= 0) G.tab = want; else G.tab = 'products';
    var startTab = G.tab;
    open().then(function () { if (G.role === 'staff' && startTab !== 'orders') show('orders'); });
    // The bell in the header links to #orders.
    window.addEventListener('hashchange', function () { if (location.hash === '#orders' && G.role) show('orders'); });
  }
  // A new order arrived (grocery-alerts.js): refresh the list if it is on screen.
  window.addEventListener('grocery:new-order', function () { if (G.tab === 'orders' && G.role && isVisible()) loadOrders(true); });
})();
