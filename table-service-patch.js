/**
 * table-service-patch.js — ChocoCravings On Store
 * Feature: Dine-in Table Service Board (T1, T2, T3, BS, SL, SR, SC)
 *
 * Standalone patch — loaded AFTER store-patch.js, right before </body>:
 *   <script src="table-service-patch.js"></script>
 *
 * Requires: `db` (Supabase client), `showStoreToast`, `MENU`, `kitchenLoad`
 * all already defined by store.html + store-patch.js (same page, same
 * global scope — no module wrapping, so we can reuse them directly).
 *
 * Requires DB migration: ALTER TABLE store_orders ADD COLUMN table_code text;
 */

var TABLE_CODES = ['T1', 'T2', 'T3', 'BS', 'SL', 'SR', 'SC', 'DC'];

var _tsItems        = [];
var _tsTableCode    = null;
var _tsExistingOrder = null;
var _tsBoardCh      = null;

// ── 1. Inject "Tables" entry into Admin FAB menu ───────────────
document.addEventListener('DOMContentLoaded', function () {
  var fabMenu = document.getElementById('admin-fab-menu');
  if (!fabMenu) return;

  var entry = document.createElement('div');
  entry.onclick = function () { openTablesBoard(); closeAdminMenu(); };
  entry.style.cssText = 'display:flex;align-items:center;gap:10px;padding:13px 16px;'
    + 'cursor:pointer;transition:background .15s;border-bottom:1px solid #f5f0f8';
  entry.onmouseover = function () { entry.style.background = '#f5eeff'; };
  entry.onmouseout  = function () { entry.style.background = 'transparent'; };
  entry.innerHTML =
      '<div style="width:32px;height:32px;border-radius:8px;background:rgba(110,9,119,0.1);'
    + 'display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">🍽️</div>'
    + '<div>'
    +   '<div style="font-size:13px;font-weight:600;color:#1a0820">Tables</div>'
    +   '<div style="font-size:11px;color:#9c0ca1;margin-top:1px">Dine-in table service</div>'
    + '</div>';

  // Insert as the first item, above "Place Order"
  fabMenu.insertBefore(entry, fabMenu.children[1] || null);
  buildTablesBoardDOM();
  injectKitchenRefreshButton();
});

// ── 2. Build the board + item-picker sheet DOM ─────────────────
function buildTablesBoardDOM() {
  var overlay = document.createElement('div');
  overlay.id = 'ts-board-overlay';
  overlay.onclick = closeTablesBoard;
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);'
    + 'z-index:3000;backdrop-filter:blur(4px)';
  document.body.appendChild(overlay);

  var sheet = document.createElement('div');
  sheet.id = 'ts-board-sheet';
  sheet.style.cssText = 'display:none;position:fixed;bottom:0;left:0;right:0;background:#fff;'
    + 'border-radius:22px 22px 0 0;border-top:1px solid #e8d0f0;z-index:3001;'
    + 'padding:0 0 28px;font-family:\'DM Sans\',sans-serif;max-height:88vh;overflow-y:auto';
  sheet.innerHTML =
      '<div style="width:40px;height:4px;border-radius:2px;background:#ddd0ea;margin:14px auto 0"></div>'
    + '<div style="padding:16px 20px 12px;border-bottom:1px solid #f0e8f8;display:flex;'
    +   'align-items:center;justify-content:space-between">'
    +   '<div>'
    +     '<div style="font-size:9px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;'
    +       'color:#9c0ca1;margin-bottom:4px">Dine-In</div>'
    +     '<div style="font-size:18px;font-weight:700;color:#1a0820">Tables</div>'
    +   '</div>'
    +   '<div onclick="closeTablesBoard()" style="width:34px;height:34px;border-radius:50%;'
    +     'background:#f5eeff;border:1px solid #e0c8f0;display:flex;align-items:center;'
    +     'justify-content:center;cursor:pointer;font-size:14px;color:#6e0977">✕</div>'
    + '</div>'
    + '<div id="ts-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:18px 20px"></div>';
  document.body.appendChild(sheet);

  // ── Order-taking sheet for a single table ──
  var tOverlay = document.createElement('div');
  tOverlay.id = 'ts-order-overlay';
  tOverlay.onclick = closeTableOrderSheet;
  tOverlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);'
    + 'z-index:3100;backdrop-filter:blur(4px)';
  document.body.appendChild(tOverlay);

  var tSheet = document.createElement('div');
  tSheet.id = 'ts-order-sheet';
  tSheet.style.cssText = 'display:none;position:fixed;bottom:0;left:0;right:0;background:#fff;'
    + 'border-radius:22px 22px 0 0;border-top:1px solid #e8d0f0;z-index:3101;'
    + 'padding:0 0 28px;font-family:\'DM Sans\',sans-serif;max-height:92vh;overflow-y:auto';
  tSheet.innerHTML =
      '<div style="width:40px;height:4px;border-radius:2px;background:#ddd0ea;margin:14px auto 0"></div>'
    + '<div style="padding:16px 20px 12px;border-bottom:1px solid #f0e8f8">'
    +   '<div style="display:flex;align-items:center;justify-content:space-between">'
    +     '<div>'
    +       '<div style="font-size:9px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;'
    +         'color:#9c0ca1;margin-bottom:4px">Table</div>'
    +       '<div id="ts-order-title" style="font-size:20px;font-weight:700;color:#1a0820">T1</div>'
    +     '</div>'
    +     '<div onclick="closeTableOrderSheet()" style="width:34px;height:34px;border-radius:50%;'
    +       'background:#f5eeff;border:1px solid #e0c8f0;display:flex;align-items:center;'
    +       'justify-content:center;cursor:pointer;font-size:14px;color:#6e0977">✕</div>'
    +   '</div>'
    + '</div>'
    + '<div style="padding:18px 20px;display:flex;flex-direction:column;gap:14px">'
    +   '<div id="ts-items-list" style="display:flex;flex-direction:column;gap:8px">'
    +     '<div style="font-size:12px;color:#b090c0;text-align:center;padding:10px">No items yet</div>'
    +   '</div>'
    +   '<input id="ts-search" type="text" placeholder="🔍 Search items..." oninput="tsFilterItems()" '
    +     'style="width:100%;padding:12px 14px;border:1.5px solid #e0c8f0;border-radius:12px;font-size:14px;'
    +     'font-family:\'DM Sans\',sans-serif;outline:none;box-sizing:border-box">'
    +   '<div id="ts-cat-tabs" style="display:flex;gap:6px;overflow-x:auto;padding-bottom:2px"></div>'
    +   '<div id="ts-item-grid" style="display:flex;flex-wrap:wrap;gap:8px;max-height:200px;'
    +     'overflow-y:auto;padding:2px"></div>'
    +   '<div style="display:flex;justify-content:space-between;align-items:center;background:#f5eeff;'
    +     'border:1px solid #e0c8f0;border-radius:12px;padding:13px 16px">'
    +     '<div style="font-size:13px;font-weight:700;color:#1a0820">Total</div>'
    +     '<div id="ts-total" style="font-size:22px;font-weight:700;color:#6e0977;'
    +       'font-family:\'Fraunces\',Georgia,serif">₹0</div>'
    +   '</div>'
    +   '<button id="ts-send-btn" onclick="tsSubmit()" style="width:100%;padding:15px;'
    +     'background:linear-gradient(135deg,#6e0977,#9c0ca1);color:#fff;font-size:13px;font-weight:700;'
    +     'border:none;border-radius:14px;cursor:pointer;letter-spacing:1px;font-family:\'DM Sans\',sans-serif">'
    +     '➕ Send to Kitchen</button>'
    +   '<button id="ts-bill-btn" onclick="tsBillAndClose()" style="display:none;width:100%;padding:15px;'
    +     'background:rgba(34,197,94,0.1);color:#15803d;font-size:13px;font-weight:700;'
    +     'border:1.5px solid rgba(34,197,94,0.35);border-radius:14px;cursor:pointer;letter-spacing:1px;'
    +     'font-family:\'DM Sans\',sans-serif">💰 Bill &amp; Close Table</button>'
    +   '<button id="ts-undo-btn" onclick="tsUndoDelivered()" style="display:none;width:100%;padding:13px;'
    +     'background:rgba(220,38,38,0.08);color:#dc2626;font-size:12px;font-weight:700;'
    +     'border:1.5px solid rgba(220,38,38,0.25);border-radius:14px;cursor:pointer;letter-spacing:.5px;'
    +     'font-family:\'DM Sans\',sans-serif;margin-top:8px">↩️ Undo Delivered — back to Kitchen</button>'
    + '</div>';
  document.body.appendChild(tSheet);
}

// ── 3. Board open/close + live status ──────────────────────────
function openTablesBoard() {
  document.getElementById('ts-board-overlay').style.display = 'block';
  document.getElementById('ts-board-sheet').style.display   = 'block';
  loadTablesStatus();
  subscribeTablesBoard();
}

function closeTablesBoard() {
  document.getElementById('ts-board-overlay').style.display = 'none';
  document.getElementById('ts-board-sheet').style.display   = 'none';
  if (_tsBoardCh) { try { db.removeChannel(_tsBoardCh); } catch (e) {} _tsBoardCh = null; }
}

async function loadTablesStatus() {
  var today = new Date().toISOString().slice(0, 10);
  var res = await db.from('store_orders')
    .select('id, table_code, items, total, status, staff_name, created_at')
    .not('table_code', 'is', null)
    .not('status', 'in', '("collected","cancelled")')
    .gte('created_at', today + 'T00:00:00.000Z');

  var map = {};
  (res.data || []).forEach(function (o) { map[o.table_code] = o; });

  // Rank occupied tables by whose order arrived first — helps staff serve
  // in first-come-first-served order instead of just whichever looks busy.
  var rankMap = {};
  Object.keys(map)
    .sort(function (a, b) { return new Date(map[a].created_at) - new Date(map[b].created_at); })
    .forEach(function (code, idx) { rankMap[code] = idx + 1; });

  renderTablesGrid(map, rankMap);
}

function renderTablesGrid(map, rankMap) {
  rankMap = rankMap || {};
  var grid = document.getElementById('ts-grid');
  if (!grid) return;
  grid.innerHTML = TABLE_CODES.map(function (code) {
    var o = map[code];
    if (o) {
      var rawItems = o.items;
      var items = Array.isArray(rawItems) ? rawItems : JSON.parse(rawItems || '[]');
      var count = items.reduce(function (s, i) { return s + (i.qty || 1); }, 0);
      var statusLbl = { pending: 'Pending', preparing: 'Preparing', ready: 'Ready!', delivered: 'Waiting for Bill' }[o.status] || o.status;
      var staffBadge = o.staff_name ? ('<div style="font-size:10px;color:#8a6a3a;margin-top:2px">👤 ' + o.staff_name + '</div>') : '';

      // Arrival-order badge — 1st (longest waiting) is most urgent, colors
      // step down through the queue so staff can see priority at a glance.
      var rank = rankMap[code];
      var rankColors = ['#dc2626', '#f97316', '#eab308', '#8b5cf6', '#6b7280'];
      var rankColor = rankColors[Math.min((rank || 1) - 1, rankColors.length - 1)];
      var rankBadge = rank
        ? '<div style="position:absolute;top:-8px;right:-8px;width:26px;height:26px;border-radius:50%;'
          + 'background:' + rankColor + ';color:#fff;font-size:12px;font-weight:900;display:flex;'
          + 'align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.25);'
          + 'font-family:Fraunces,Georgia,serif;border:2px solid #fff">' + rank + '</div>'
        : '';

      return '<div onclick="openTableOrderSheet(\'' + code + '\')" style="position:relative;background:rgba(184,116,16,0.09);'
        + 'border:1.5px solid rgba(184,116,16,0.35);border-radius:14px;padding:14px;cursor:pointer;'
        + 'text-align:center">'
        + rankBadge
        + '<div style="font-family:Fraunces,Georgia,serif;font-size:22px;font-weight:900;color:#b87410">' + code + '</div>'
        + '<div style="font-size:10px;font-weight:700;color:#b87410;letter-spacing:1px;margin-top:2px">' + statusLbl.toUpperCase() + '</div>'
        + '<div style="font-size:12px;color:#8a6a3a;margin-top:6px">' + count + ' items · ₹' + o.total + '</div>'
        + staffBadge
        + '</div>';
    }
    return '<div onclick="openTableOrderSheet(\'' + code + '\')" style="background:rgba(34,197,94,0.08);'
      + 'border:1.5px solid rgba(34,197,94,0.3);border-radius:14px;padding:14px;cursor:pointer;text-align:center">'
      + '<div style="font-family:Fraunces,Georgia,serif;font-size:22px;font-weight:900;color:#15803d">' + code + '</div>'
      + '<div style="font-size:10px;font-weight:700;color:#15803d;letter-spacing:1px;margin-top:2px">FREE</div>'
      + '</div>';
  }).join('');
}

function subscribeTablesBoard() {
  if (_tsBoardCh) { try { db.removeChannel(_tsBoardCh); } catch (e) {} }
  _tsBoardCh = db.channel('tables-board-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'store_orders' }, function () {
      loadTablesStatus();
    })
    .subscribe();
}

// ── 4. Per-table order-taking sheet ────────────────────────────
function openTableOrderSheet(code) {
  _tsTableCode     = code;
  _tsExistingOrder = null;
  _tsItems         = [];

  document.getElementById('ts-order-title').textContent = code;
  tsPopulateDropdown();

  var sendBtn = document.getElementById('ts-send-btn');
  var billBtn = document.getElementById('ts-bill-btn');
  var undoBtn = document.getElementById('ts-undo-btn');

  db.from('store_orders')
    .select('id, items, total, status, created_at, staff_name')
    .eq('table_code', code)
    .not('status', 'in', '("collected","cancelled")')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
    .then(function (res) {
      if (res.data) {
        _tsExistingOrder = res.data;
        var rawItems = res.data.items;
        _tsItems = (Array.isArray(rawItems) ? rawItems : JSON.parse(rawItems || '[]')).map(function (i) {
          // _origQty and delivered are internal tracking fields, stripped
          // before saving — see tsSubmit(). They let us detect when staff
          // add MORE of an already-delivered item, so its checkbox
          // correctly resets instead of staying falsely checked.
          return { name: i.name, price: i.price, qty: i.qty, delivered: !!i.delivered, _origQty: i.qty };
        });
        sendBtn.textContent = '➕ Add Items';
        billBtn.style.display = 'block';
        undoBtn.style.display = res.data.status === 'delivered' ? 'block' : 'none';
      } else {
        sendBtn.textContent = '➕ Send to Kitchen';
        billBtn.style.display = 'none';
        undoBtn.style.display = 'none';
      }
      tsRenderItems();
      tsCalcTotal();
    });

  document.getElementById('ts-board-overlay').style.display = 'none';
  document.getElementById('ts-board-sheet').style.display   = 'none';
  document.getElementById('ts-order-overlay').style.display = 'block';
  document.getElementById('ts-order-sheet').style.display   = 'block';
}

function closeTableOrderSheet() {
  document.getElementById('ts-order-overlay').style.display = 'none';
  document.getElementById('ts-order-sheet').style.display   = 'none';
  openTablesBoard();
}

var _tsActiveCat = null;

function tsPopulateDropdown() {
  var firstCat = Object.keys(MENU).find(function (c) { return MENU[c].items.length; });
  _tsActiveCat = firstCat;
  var search = document.getElementById('ts-search');
  if (search) search.value = '';
  renderTsCatTabs();
  renderTsItemGrid();
}

function renderTsCatTabs() {
  var tabsEl = document.getElementById('ts-cat-tabs');
  if (!tabsEl) return;
  var cats = Object.keys(MENU).filter(function (c) { return MENU[c].items.length; });
  tabsEl.innerHTML = cats.map(function (c) {
    var on = c === _tsActiveCat;
    return '<div onclick="tsSetCat(\'' + c + '\')" style="flex-shrink:0;padding:7px 13px;border-radius:20px;'
      + 'font-size:11px;font-weight:700;cursor:pointer;white-space:nowrap;'
      + (on ? 'background:#6e0977;color:#fff' : 'background:#f5eeff;color:#6e0977;border:1px solid #e0c8f0')
      + '">' + c + '</div>';
  }).join('');
}

function tsSetCat(c) {
  _tsActiveCat = c;
  var search = document.getElementById('ts-search');
  if (search) search.value = '';
  renderTsCatTabs();
  renderTsItemGrid();
}

function renderTsItemGrid(filterText) {
  var grid = document.getElementById('ts-item-grid');
  if (!grid) return;
  var items;
  if (filterText) {
    items = [];
    Object.keys(MENU).forEach(function (c) {
      MENU[c].items.forEach(function (i) {
        if (i.name.toLowerCase().indexOf(filterText.toLowerCase()) !== -1) items.push(i);
      });
    });
  } else {
    items = (MENU[_tsActiveCat] || { items: [] }).items;
  }
  grid.innerHTML = items.length
    ? items.map(function (item) {
        return '<div onclick="tsQuickAdd(\'' + item.name.replace(/'/g, "\\'") + '\',' + item.price + ')" '
          + 'style="padding:9px 13px;border-radius:20px;background:#f5eeff;border:1.5px solid #e0c8f0;'
          + 'font-size:12px;font-weight:600;color:#6e0977;cursor:pointer">' + item.name + ' · ₹' + item.price + '</div>';
      }).join('')
    : '<div style="font-size:12px;color:#b090c0;padding:10px;text-align:center;width:100%">No items found</div>';
}

function tsFilterItems() {
  var q = (document.getElementById('ts-search').value || '').trim();
  document.getElementById('ts-cat-tabs').style.display = q ? 'none' : 'flex';
  renderTsItemGrid(q);
}

function tsQuickAdd(name, price) {
  var existing = _tsItems.find(function (i) { return i.name === name; });
  if (existing) existing.qty++;
  else _tsItems.push({ name: name, price: price, qty: 1 });
  tsRenderItems();
  tsCalcTotal();
}

function tsRemoveItem(idx) {
  _tsItems.splice(idx, 1);
  tsRenderItems();
  tsCalcTotal();
}

function tsRenderItems() {
  var list = document.getElementById('ts-items-list');
  if (!list) return;
  if (!_tsItems.length) {
    list.innerHTML = '<div style="font-size:12px;color:#b090c0;text-align:center;padding:10px">No items yet</div>';
    return;
  }
  list.innerHTML = _tsItems.map(function (item, i) {
    return '<div style="display:flex;align-items:center;justify-content:space-between;'
      + 'background:#f5eeff;border:1px solid #e0c8f0;border-radius:10px;padding:10px 12px">'
      + '<div style="flex:1">'
      + '<div style="font-size:13px;font-weight:600;color:#1a0820">' + item.name + '</div>'
      + '<div style="font-size:11px;color:#9c0ca1">₹' + item.price + ' × ' + item.qty + '</div>'
      + '</div>'
      + '<div style="font-size:13px;font-weight:700;color:#6e0977;margin-right:8px">₹' + (item.price * item.qty) + '</div>'
      + '<div onclick="tsQuickAdd(\'' + item.name.replace(/'/g, "\\'") + '\',' + item.price + ')" '
      + 'style="width:26px;height:26px;border-radius:50%;background:#6e0977;color:#fff;display:flex;'
      + 'align-items:center;justify-content:center;cursor:pointer;font-size:14px;font-weight:700;margin-right:6px">+</div>'
      + '<div onclick="tsRemoveItem(' + i + ')" style="width:26px;height:26px;border-radius:50%;'
      + 'background:#fff;border:1px solid #e0c8f0;display:flex;align-items:center;'
      + 'justify-content:center;cursor:pointer;font-size:12px;color:#e05080">✕</div>'
      + '</div>';
  }).join('');
}

function tsCalcTotal() {
  var total = _tsItems.reduce(function (s, i) { return s + (i.price * i.qty); }, 0);
  var el = document.getElementById('ts-total');
  if (el) el.textContent = '₹' + total;
  return total;
}

async function tsSubmit() {
  if (!_tsItems.length) { showStoreToast('Add at least one item'); return; }
  var btn = document.getElementById('ts-send-btn');
  var total = tsCalcTotal();

  // Resolve the final delivered state per item: brand-new items start
  // undelivered; existing items keep their delivered state UNLESS more
  // quantity was just added, in which case they reset to undelivered
  // since there's now an unfulfilled unit mixed into that line.
  var finalItems = _tsItems.map(function (item) {
    var isNew = item._origQty === undefined;
    var qtyIncreased = !isNew && item.qty > item._origQty;
    return {
      name: item.name,
      price: item.price,
      qty: item.qty,
      delivered: (isNew || qtyIncreased) ? false : !!item.delivered
    };
  });

  try {
    if (_tsExistingOrder) {
      btn.disabled = true; btn.textContent = 'Sending…';
      var updatePayload = { items: JSON.stringify(finalItems), total: total };
      // If kitchen had already marked this ticket "ready", adding new items
      // means there's unprepared food again — bump it back into the active
      // queue so it doesn't get missed sitting under a stale "Ready" badge.
      var wasReady = _tsExistingOrder.status === 'ready' || _tsExistingOrder.status === 'delivered';
      if (wasReady) updatePayload.status = 'preparing';

      var upd = await db.from('store_orders')
        .update(updatePayload)
        .eq('id', _tsExistingOrder.id);
      if (upd.error) throw upd.error;
      showStoreToast(wasReady
        ? '✅ Items added to ' + _tsTableCode + ' — back to Preparing'
        : '✅ Items added to ' + _tsTableCode);
    } else {
      btn.disabled = true; btn.textContent = 'Sending…';
      var token = await getToken();
      var placedBy = (typeof _staffSession !== 'undefined' && _staffSession && _staffSession.name)
        ? _staffSession.name
        : ((typeof isAdmin !== 'undefined' && isAdmin) ? 'Admin' : null);
      var ins = await db.from('store_orders').insert([{
        token:           token,
        table_code:      _tsTableCode,
        customer_name:   'Table ' + _tsTableCode,
        customer_phone:  null,
        staff_name:      placedBy,
        items:           JSON.stringify(finalItems),
        total:           total,
        payment_method:  'cash',
        payment_status:  'pending',
        status:          'pending',
        placed_by_admin: true
      }]).select('id').single();
      if (ins.error) throw ins.error;
      showStoreToast('✅ Order sent for ' + _tsTableCode);
    }
    // Not calling kitchenLoad() here on purpose — it tears down and rebuilds
    // the realtime subscription every time, which can drop OTHER orders
    // arriving during that split-second reconnect window. The kitchen
    // page's own subscription already picks this order up live.
    closeTableOrderSheet();
  } catch (e) {
    showStoreToast('Error: ' + e.message);
  } finally {
    btn.disabled = false;
  }
}

// Undoes a mistaken "Delivered" (whether from the per-item checkboxes or
// the "Mark All Delivered" shortcut) — reverts the order back to Ready
// and un-checks every item, so it reappears properly in the Kitchen
// queue for staff to re-check items as they're actually served.
async function tsUndoDelivered() {
  if (!_tsExistingOrder) return;
  if (!confirm('Undo delivered status for ' + _tsTableCode + '? This puts it back in the kitchen queue as Ready.')) return;

  try {
    var rawItems = _tsExistingOrder.items;
    var items = Array.isArray(rawItems) ? rawItems : JSON.parse(rawItems || '[]');
    items.forEach(function (i) { i.delivered = false; });

    var upd = await db.from('store_orders')
      .update({ status: 'ready', items: JSON.stringify(items) })
      .eq('id', _tsExistingOrder.id);
    if (upd.error) throw upd.error;

    showStoreToast('↩️ ' + _tsTableCode + ' reverted — back in kitchen queue as Ready');
    closeTableOrderSheet();
  } catch (e) {
    showStoreToast('Error: ' + e.message);
  }
}

async function tsBillAndClose() {
  if (!_tsExistingOrder) return;
  var total = _tsExistingOrder.total;
  var totalMin = tsElapsedMin(_tsExistingOrder.created_at, null);
  var staffTxt = _tsExistingOrder.staff_name ? (' · placed by ' + _tsExistingOrder.staff_name) : '';
  if (!confirm('Close ' + _tsTableCode + ' — bill total ₹' + total + '\nOpen for ' + tsFormatDuration(totalMin) + staffTxt + '?')) return;

  try {
    var collectedAt = new Date().toISOString();
    var upd = await db.from('store_orders')
      .update({ status: 'collected', payment_status: 'paid', collected_at: collectedAt })
      .eq('id', _tsExistingOrder.id);
    if (upd.error) throw upd.error;
    var finalMin = tsElapsedMin(_tsExistingOrder.created_at, collectedAt);
    showStoreToast('✅ ' + _tsTableCode + ' closed — ₹' + total + ' · ' + tsFormatDuration(finalMin) + staffTxt);
    // Same reasoning as tsSubmit — no kitchenLoad() call here, let the
    // realtime subscription handle it without forcing a reconnect.
    closeTableOrderSheet();
  } catch (e) {
    showStoreToast('Error: ' + e.message);
  }
}

// ── 5. Kitchen display — show table code instead of token ──────
function renderKitchen(orders) {
  var list = document.getElementById('k-list');
  if (!orders.length) { list.innerHTML = '<div class="k-empty">No pending orders</div>'; return; }
  list.innerHTML = orders.map(function (o) {
    var rawItems = o.items;
    var itemsArr = Array.isArray(rawItems) ? rawItems : (typeof rawItems === 'string' ? JSON.parse(rawItems) : []);
    var age = ageStr(o.created_at);
    var startTxt = o.status === 'preparing' ? '⏳ Making…' : '▶ Start';
    var readyTxt = o.status === 'ready' ? '✓ Ready!' : '✓ Mark Ready';
    var headline = o.table_code
      ? '🍽️ ' + o.table_code
      : ('#' + o.token);

    // Meta line: staff + timing for table orders; customer name/phone for
    // self-orders placed by customers on their own phones — this matters
    // just as much, since staff need to know WHO to call out or match at
    // pickup, not just that "a token exists."
    var metaLine;
    if (o.table_code) {
      var staffLine = o.staff_name ? ('👤 ' + o.staff_name) : '';
      var timingBits = [];
      if (o.preparing_at) {
        var prepDuration = tsElapsedMin(o.preparing_at, o.ready_at || null);
        timingBits.push('🔥 Prep ' + tsFormatDuration(prepDuration));
      } else {
        timingBits.push('⏳ Waiting ' + tsFormatDuration(tsElapsedMin(o.created_at, null)));
      }
      metaLine = [staffLine, timingBits.join(' · ')].filter(Boolean).join(' · ');
    } else {
      var custBits = [];
      if (o.customer_name) custBits.push('🙋 ' + o.customer_name);
      if (o.customer_phone) custBits.push('📞 ' + o.customer_phone);
      metaLine = custBits.length ? custBits.join('  ·  ') : '🙋 Walk-in (no details)';
    }

    // Payment badge — shows exactly how/whether this order was paid,
    // so staff know at a glance whether cash still needs collecting.
    var pmMap = { upi: 'UPI', upi_qr: 'UPI (QR)', cash: 'Cash', razorpay: 'Razorpay', gpay: 'Google Pay', phonepe: 'PhonePe' };
    var pmLabel = pmMap[(o.payment_method || '').toLowerCase()] || (o.payment_method || 'Cash');
    var pay;
    if (o.payment_status === 'paid') {
      pay = { label: '✅ Paid · ' + pmLabel, bg: 'rgba(74,222,128,0.12)', color: '#4ade80', border: 'rgba(74,222,128,0.3)' };
    } else if (o.payment_status === 'complimentary') {
      pay = { label: '🎁 Complimentary', bg: 'rgba(192,132,252,0.12)', color: '#c084fc', border: 'rgba(192,132,252,0.3)' };
    } else if ((o.payment_method || '').toLowerCase() === 'cash') {
      pay = { label: '💵 COD · Pay at counter', bg: 'rgba(245,158,11,0.12)', color: '#fb923c', border: 'rgba(245,158,11,0.3)' };
    } else {
      pay = { label: '⏳ Payment Pending', bg: 'rgba(239,68,68,0.1)', color: '#f87171', border: 'rgba(239,68,68,0.3)' };
    }
    var payBadge = '<span style="display:inline-block;font-size:9.5px;font-weight:700;padding:3px 9px;'
      + 'border-radius:20px;background:' + pay.bg + ';color:' + pay.color + ';border:1px solid ' + pay.border
      + ';margin-left:8px;vertical-align:middle">' + pay.label + '</span>';

    // Items — for table orders, each one is an individually tappable
    // checkbox (per-item delivery tracking); walk-in/token orders keep
    // the plain list since they're collected as a whole batch anyway.
    var itemsHtml = o.table_code
      ? (itemsArr || []).map(function (i, idx) {
          var delivered = !!i.delivered;
          return '<div onclick="kToggleItemDelivered(\'' + o.id + '\',' + idx + ')" style="display:flex;'
            + 'align-items:center;gap:9px;padding:5px 0;cursor:pointer">'
            + '<span style="width:18px;height:18px;border-radius:5px;flex-shrink:0;display:flex;'
            + 'align-items:center;justify-content:center;font-size:11px;color:#0c0810;'
            + 'border:1.5px solid ' + (delivered ? '#4ade80' : 'rgba(255,255,255,.25)') + ';'
            + 'background:' + (delivered ? '#4ade80' : 'transparent') + '">' + (delivered ? '✓' : '') + '</span>'
            + '<span style="flex:1;font-size:13px;font-weight:500;'
            + 'color:' + (delivered ? 'rgba(245,234,220,.4)' : '#f5eadc') + ';'
            + 'text-decoration:' + (delivered ? 'line-through' : 'none') + '">' + i.name + '</span>'
            + '<span style="font-size:12px;color:#f5c430;font-weight:700;flex-shrink:0">×' + i.qty + '</span>'
            + '</div>';
        }).join('')
      : (itemsArr || []).map(function (i) {
          return '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0">'
            + '<span style="font-size:13px;color:#f5eadc;font-weight:500">' + i.name + '</span>'
            + '<span style="font-size:12px;color:#f5c430;font-weight:700;flex-shrink:0;margin-left:10px">×' + i.qty + '</span>'
            + '</div>';
        }).join('');

    return '<div class="k-ticket" id="kt-' + o.id + '" data-s="' + o.status + '">'
      + '<div class="k-top"><div class="k-tok">' + headline + '</div>'
      + '<div class="k-badge">' + o.status.toUpperCase() + '</div>'
      + '<div class="k-age">' + age + '</div></div>'
      + '<div style="font-size:11.5px;color:rgba(245,234,220,.65);margin-bottom:9px;font-weight:600">' + metaLine + payBadge + '</div>'
      + '<div style="background:rgba(0,0,0,0.22);border-radius:10px;padding:9px 12px;margin-bottom:10px">' + itemsHtml + '</div>'
      + '<div style="display:flex;justify-content:space-between;align-items:center;'
      + 'background:linear-gradient(135deg,rgba(245,196,48,0.18),rgba(245,196,48,0.06));'
      + 'border:1.5px solid rgba(245,196,48,0.4);border-radius:12px;padding:10px 14px;margin-bottom:10px">'
      + '<span style="font-size:10px;font-weight:700;letter-spacing:2px;color:rgba(245,196,48,0.85)">TOTAL</span>'
      + '<span style="font-family:Fraunces,Georgia,serif;font-size:26px;font-weight:900;color:#f5c430">₹' + (o.total || 0) + '</span>'
      + '</div>'
      + '<div class="k-actions">'
      + '<button class="k-btn k-start" onclick="kBump(\'' + o.id + '\',\'preparing\')">' + startTxt + '</button>'
      + '<button class="k-btn k-ready" onclick="kBump(\'' + o.id + '\',\'ready\')">' + readyTxt + '</button>'
      + (o.table_code
          ? '<button class="k-btn k-done" onclick="kMarkDelivered(\'' + o.id + '\')">🍽️ Mark All Delivered</button>'
            + '<button class="k-btn" onclick="openTableCollectPicker(\'' + o.id + '\',\'' + o.table_code + '\')" '
            + 'style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);color:#15803d">💰 Mark Bill Collected</button>'
          : '<button class="k-btn k-done" onclick="kCollectOrder(\'' + o.id + '\',\'' + (o.payment_status || 'pending') + '\')">Collected ✓</button>')
      + '<button class="k-btn" onclick="printStoreInvoice(\'' + o.id + '\')" style="background:rgba(240,201,107,0.1);'
      + 'border:1px solid rgba(240,201,107,0.3);color:#b87410">🖨️ Print</button>'
      + '<button class="k-btn" onclick="kCancelOrder(\'' + o.id + '\')" style="background:rgba(239,68,68,0.1);'
      + 'border:1px solid rgba(239,68,68,0.3);color:#f87171">❌ Cancel</button>'
      + '</div></div>';
  }).join('');
}

function tsElapsedMin(fromIso, toIso) {
  if (!fromIso) return null;
  var from = new Date(fromIso).getTime();
  var to = toIso ? new Date(toIso).getTime() : Date.now();
  return Math.max(0, Math.round((to - from) / 60000));
}

function tsFormatDuration(min) {
  if (min === null || min === undefined) return '—';
  if (min < 60) return min + 'm';
  return Math.floor(min / 60) + 'h ' + (min % 60) + 'm';
}

// Override kBump (originally in store.html) to also stamp stage timestamps.
// Only stamps a timestamp the FIRST time an order enters that stage — this
// keeps the "prep took Xm" numbers meaningful even if an order bounces
// back to preparing after items are added post-ready (see tsSubmit).
async function kBump(id, status) {
  var payload = { status: status };
  if (status === 'preparing') {
    var existing = await db.from('store_orders').select('preparing_at').eq('id', id).single();
    if (existing.data && !existing.data.preparing_at) payload.preparing_at = new Date().toISOString();
  } else if (status === 'ready') {
    var existingR = await db.from('store_orders').select('ready_at').eq('id', id).single();
    if (existingR.data && !existingR.data.ready_at) payload.ready_at = new Date().toISOString();
  } else if (status === 'collected') {
    payload.collected_at = new Date().toISOString();
  }
  await db.from('store_orders').update(payload).eq('id', id);
}

function kCancelOrder(id) {
  if (!confirm('Cancel this order? This cannot be undone.')) return;
  kBump(id, 'cancelled');
}

// ══════════════════════════════════════════════════════════════
// Kitchen manual refresh button
// ══════════════════════════════════════════════════════════════
// Deliberately does NOT call kitchenLoad() — that also calls
// subscribeKitchen(), which tears down and rebuilds the realtime
// connection every time it runs. Doing that on every manual refresh tap
// would reintroduce the exact "orders sometimes don't show up live"
// problem fixed elsewhere. This only re-fetches and re-renders, leaving
// the live subscription untouched.
function injectKitchenRefreshButton() {
  var kHdr = document.querySelector('#pg-kitchen .k-hdr');
  if (!kHdr) return;

  var btn = document.createElement('div');
  btn.id = 'kitchen-refresh-btn';
  btn.onclick = kitchenManualRefresh;
  btn.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:8px 14px;'
    + 'border-radius:20px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);'
    + 'color:rgba(245,234,220,.75);font-size:11px;font-weight:700;cursor:pointer;margin-left:8px;'
    + 'font-family:\'DM Sans\',sans-serif;transition:background .15s';
  btn.onmouseenter = function () { btn.style.background = 'rgba(255,255,255,.12)'; };
  btn.onmouseleave = function () { btn.style.background = 'rgba(255,255,255,.06)'; };
  btn.innerHTML = '<span id="kitchen-refresh-icon" style="display:inline-block">🔄</span> Refresh';

  kHdr.appendChild(btn);

  var style = document.createElement('style');
  style.textContent = '@keyframes kitchenRefreshSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
  document.head.appendChild(style);
}

async function kitchenManualRefresh() {
  var icon = document.getElementById('kitchen-refresh-icon');
  if (icon) icon.style.animation = 'kitchenRefreshSpin .6s linear';

  try {
    var today = new Date().toISOString().slice(0, 10);
    var res = await db.from('store_orders')
      .select('*')
      .gte('created_at', today + 'T00:00:00.000Z')
      .in('status', ['pending', 'preparing', 'ready'])
      .order('created_at', { ascending: true });

    if (res.error) throw res.error;
    renderKitchen(res.data || []);
    if (typeof loadProductionRequests === 'function') loadProductionRequests();
    showStoreToast('🔄 Refreshed');
  } catch (e) {
    showStoreToast('Refresh error: ' + e.message);
  } finally {
    if (icon) setTimeout(function () { icon.style.animation = ''; }, 600);
  }
}

// ══════════════════════════════════════════════════════════════
// Collected button — payment-aware
// ══════════════════════════════════════════════════════════════
// If the order was already paid (self-checkout, advance UPI, etc.),
// "Collected" behaves exactly as before — one tap, done. If it's still
// unpaid (typically cash COD), it asks HOW it was just paid before
// marking it collected, so payment_status/payment_method get resolved
// at the same time — otherwise cash orders would sit forever in Day
// Close's "Pending COD" bucket even after being paid and picked up.
// Shortcut for when nothing needs splitting — marks every item on the
// order delivered in one tap, same as checking each one individually.
async function kMarkDelivered(id) {
  try {
    var res = await db.from('store_orders').select('items').eq('id', id).single();
    if (res.error) throw res.error;
    var items = Array.isArray(res.data.items) ? res.data.items : JSON.parse(res.data.items || '[]');
    items.forEach(function (i) { i.delivered = true; });

    // No status change here anymore — see kToggleItemDelivered for why.
    await db.from('store_orders').update({ items: JSON.stringify(items) }).eq('id', id);

    showStoreToast('🍽️ All items checked off');
    kitchenManualRefresh();
  } catch (e) {
    showStoreToast('Error: ' + e.message);
  }
}

// Per-item checkbox toggle. Once every item on the order is checked,
// the order automatically flips to 'delivered' (Waiting for Bill on the
// Tables board) — same end state as tapping "Mark All Delivered", just
// reached one item at a time.
async function kToggleItemDelivered(orderId, itemIndex) {
  try {
    var res = await db.from('store_orders').select('items').eq('id', orderId).single();
    if (res.error) throw res.error;
    var items = Array.isArray(res.data.items) ? res.data.items : JSON.parse(res.data.items || '[]');
    if (!items[itemIndex]) return;

    items[itemIndex].delivered = !items[itemIndex].delivered;

    // Deliberately does NOT change order status here anymore — checking
    // items is purely informational tracking now. The table only moves
    // to "closed" when staff explicitly tap "Mark Bill Collected" below,
    // even if every item happens to already be checked.
    await db.from('store_orders').update({ items: JSON.stringify(items) }).eq('id', orderId);
    kitchenManualRefresh();
  } catch (e) {
    showStoreToast('Error: ' + e.message);
  }
}

function kCollectOrder(id, paymentStatus) {
  if (paymentStatus === 'paid' || paymentStatus === 'complimentary') {
    kBump(id, 'collected');
    return;
  }
  openCollectPaymentPicker(id);
}

function openCollectPaymentPicker(id) {
  var existing = document.getElementById('kc-picker-overlay');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.id = 'kc-picker-overlay';
  overlay.onclick = function (e) { if (e.target === overlay) closeCollectPaymentPicker(); };
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:4200;'
    + 'display:flex;align-items:center;justify-content:center;padding:20px';

  var box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:20px;padding:22px;max-width:340px;width:100%;'
    + 'font-family:\'DM Sans\',sans-serif';
  box.innerHTML =
      '<div style="font-size:15px;font-weight:700;color:#1a0820;margin-bottom:4px">How was this paid?</div>'
    + '<div style="font-size:12px;color:#9a8aaa;margin-bottom:16px">This order hasn\'t been marked paid yet — pick how the customer just paid.</div>'
    + '<div style="display:flex;flex-direction:column;gap:8px">'
    +   '<button onclick="collectWithPayment(\'' + id + '\',\'cash\')" style="padding:14px;border-radius:12px;'
    +     'background:rgba(184,116,16,0.1);border:1.5px solid rgba(184,116,16,0.3);color:#b87410;'
    +     'font-size:14px;font-weight:700;cursor:pointer">💵 Cash</button>'
    +   '<button onclick="collectWithPayment(\'' + id + '\',\'upi\')" style="padding:14px;border-radius:12px;'
    +     'background:rgba(110,9,119,0.1);border:1.5px solid rgba(110,9,119,0.3);color:#6e0977;'
    +     'font-size:14px;font-weight:700;cursor:pointer">📱 UPI</button>'
    +   '<button onclick="collectWithPayment(\'' + id + '\',\'upi_qr\')" style="padding:14px;border-radius:12px;'
    +     'background:rgba(34,197,94,0.1);border:1.5px solid rgba(34,197,94,0.3);color:#15803d;'
    +     'font-size:14px;font-weight:700;cursor:pointer">📲 Scan QR</button>'
    +   '<button onclick="closeCollectPaymentPicker()" style="padding:11px;border-radius:12px;'
    +     'background:transparent;border:none;color:#9a8aaa;font-size:12px;cursor:pointer;margin-top:4px">Cancel</button>'
    + '</div>';

  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

function closeCollectPaymentPicker() {
  var el = document.getElementById('kc-picker-overlay');
  if (el) el.remove();
}

async function collectWithPayment(id, method) {
  var labels = { cash: '💵 Cash', upi: '📱 UPI', upi_qr: '📲 Scan QR' };
  try {
    await db.from('store_orders').update({
      status: 'collected',
      payment_status: 'paid',
      payment_method: method
    }).eq('id', id);
    closeCollectPaymentPicker();
    showStoreToast('✅ Collected · ' + (labels[method] || method));
  } catch (e) {
    showStoreToast('Error: ' + e.message);
  }
}

// ══════════════════════════════════════════════════════════════
// Mark Bill Collected — table order closing, direct from Kitchen
// ══════════════════════════════════════════════════════════════
// Same end state as tsBillAndClose() on the Tables board (status:
// 'collected', payment recorded) — just reachable directly from the
// Kitchen ticket too. Also asks for the customer's phone number to
// send the bill on WhatsApp (manual — opens WhatsApp with the message
// ready, staff taps Send themselves, same pattern as your existing
// invoice feature).
function openTableCollectPicker(id, tableCode) {
  var existing = document.getElementById('tc-picker-overlay');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.id = 'tc-picker-overlay';
  overlay.onclick = function (e) { if (e.target === overlay) closeTableCollectPicker(); };
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:4300;'
    + 'display:flex;align-items:center;justify-content:center;padding:20px';

  var box = document.createElement('div');
  box.style.cssText = 'background:#fff;border-radius:20px;padding:22px;max-width:340px;width:100%;'
    + 'font-family:\'DM Sans\',sans-serif';
  box.innerHTML =
      '<div style="font-size:15px;font-weight:700;color:#1a0820;margin-bottom:4px">How was ' + tableCode + '\'s bill paid?</div>'
    + '<div style="font-size:12px;color:#9a8aaa;margin-bottom:16px">This closes the table and asks for a phone number to send the bill on WhatsApp.</div>'
    + '<div style="display:flex;flex-direction:column;gap:8px">'
    +   '<button onclick="collectTableWithPayment(\'' + id + '\',\'' + tableCode + '\',\'cash\')" style="padding:14px;border-radius:12px;'
    +     'background:rgba(184,116,16,0.1);border:1.5px solid rgba(184,116,16,0.3);color:#b87410;'
    +     'font-size:14px;font-weight:700;cursor:pointer">💵 Cash</button>'
    +   '<button onclick="collectTableWithPayment(\'' + id + '\',\'' + tableCode + '\',\'upi\')" style="padding:14px;border-radius:12px;'
    +     'background:rgba(110,9,119,0.1);border:1.5px solid rgba(110,9,119,0.3);color:#6e0977;'
    +     'font-size:14px;font-weight:700;cursor:pointer">📱 UPI</button>'
    +   '<button onclick="collectTableWithPayment(\'' + id + '\',\'' + tableCode + '\',\'upi_qr\')" style="padding:14px;border-radius:12px;'
    +     'background:rgba(34,197,94,0.1);border:1.5px solid rgba(34,197,94,0.3);color:#15803d;'
    +     'font-size:14px;font-weight:700;cursor:pointer">📲 Scan QR</button>'
    +   '<button onclick="closeTableCollectPicker()" style="padding:11px;border-radius:12px;'
    +     'background:transparent;border:none;color:#9a8aaa;font-size:12px;cursor:pointer;margin-top:4px">Cancel</button>'
    + '</div>';

  overlay.appendChild(box);
  document.body.appendChild(overlay);
}

function closeTableCollectPicker() {
  var el = document.getElementById('tc-picker-overlay');
  if (el) el.remove();
}

async function collectTableWithPayment(id, tableCode, method) {
  closeTableCollectPicker();
  var labels = { cash: 'Cash', upi: 'UPI', upi_qr: 'Scan QR' };

  try {
    var res = await db.from('store_orders').select('items, total, customer_phone').eq('id', id).single();
    if (res.error) throw res.error;
    var items = Array.isArray(res.data.items) ? res.data.items : JSON.parse(res.data.items || '[]');
    var total = res.data.total || 0;

    var phone = prompt(
      'Customer phone number for WhatsApp bill (leave blank to skip):',
      res.data.customer_phone || ''
    );

    await db.from('store_orders').update({
      status: 'collected',
      payment_status: 'paid',
      payment_method: method
    }).eq('id', id);

    showStoreToast('✅ ' + tableCode + ' bill collected · ' + labels[method]);
    kitchenManualRefresh();

    if (phone) {
      var digits = phone.replace(/\D/g, '').slice(-10);
      if (digits.length === 10) {
        var lines = items.map(function (i) { return i.name + ' ×' + i.qty + ' — ₹' + (i.price * i.qty); });
        var message = '🧾 ChocoCravings Bill\n'
          + 'Table: ' + tableCode + '\n\n'
          + lines.join('\n') + '\n\n'
          + 'Total: ₹' + total + '\n'
          + 'Paid via: ' + labels[method] + '\n\n'
          + 'Thank you for visiting! 🍫';
        window.open('https://wa.me/91' + digits + '?text=' + encodeURIComponent(message), '_blank');
      } else {
        showStoreToast('Skipped WhatsApp — enter a valid 10-digit number next time');
      }
    }
  } catch (e) {
    showStoreToast('Error: ' + e.message);
  }
}
