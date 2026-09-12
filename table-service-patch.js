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

function _tsInit() {
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

  fabMenu.insertBefore(entry, fabMenu.children[1] || null);
  buildTablesBoardDOM();
  injectKitchenRefreshButton();
}
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _tsInit); } else { _tsInit(); }

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
    +   '<input id="ts-cust-phone" type="tel" inputmode="numeric" maxlength="10" placeholder="📱 Customer phone (optional)" '
    +     'style="width:100%;padding:12px 14px;border:1.5px solid #e0c8f0;border-radius:12px;font-size:14px;'
    +     'font-family:\'DM Sans\',sans-serif;outline:none;box-sizing:border-box">'
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
    +   '<button id="ts-move-btn" onclick="openMoveTablePicker()" style="display:none;width:100%;padding:13px;margin-top:8px;'
    +     'background:rgba(37,99,235,0.08);color:#2563eb;font-size:12px;font-weight:700;'
    +     'border:1.5px solid rgba(37,99,235,0.25);border-radius:14px;cursor:pointer;letter-spacing:.5px;'
    +     'font-family:\'DM Sans\',sans-serif">🔄 Move to Another Table</button>'
    +   '<button id="ts-undo-btn" onclick="tsUndoDelivered()" style="display:none;width:100%;padding:13px;'
    +     'background:rgba(220,38,38,0.08);color:#dc2626;font-size:12px;font-weight:700;'
    +     'border:1.5px solid rgba(220,38,38,0.25);border-radius:14px;cursor:pointer;letter-spacing:.5px;'
    +     'font-family:\'DM Sans\',sans-serif;margin-top:8px">↩️ Undo Delivered — back to Kitchen</button>'
    + '</div>';
  document.body.appendChild(tSheet);
}

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

function openTableOrderSheet(code) {
  _tsTableCode     = code;
  _tsExistingOrder = null;
  _tsItems         = [];

  document.getElementById('ts-order-title').textContent = code;
  tsPopulateDropdown();

  var sendBtn = document.getElementById('ts-send-btn');
  var billBtn = document.getElementById('ts-bill-btn');
  var undoBtn = document.getElementById('ts-undo-btn');
  var moveBtn = document.getElementById('ts-move-btn');

  db.from('store_orders')
    .select('id, items, total, status, created_at, staff_name, customer_phone')
    .eq('table_code', code)
    .not('status', 'in', '("collected","cancelled")')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
    .then(function (res) {
      var phoneInput = document.getElementById('ts-cust-phone');
      if (res.data) {
        _tsExistingOrder = res.data;
        var rawItems = res.data.items;
        _tsItems = (Array.isArray(rawItems) ? rawItems : JSON.parse(rawItems || '[]')).map(function (i) {
          return { name: i.name, price: i.price, qty: i.qty, delivered: !!i.delivered, prepared_by: i.prepared_by || null, prepared_at: i.prepared_at || null, complimentary: !!i.complimentary, _origQty: i.qty };
        });
        sendBtn.textContent = '➕ Add Items';
        billBtn.style.display = 'block';
        undoBtn.style.display = res.data.status === 'delivered' ? 'block' : 'none';
        moveBtn.style.display = 'block';
        phoneInput.value = (res.data.customer_phone || '').replace(/^\+?91/, '');
      } else {
        sendBtn.textContent = '➕ Send to Kitchen';
        billBtn.style.display = 'none';
        undoBtn.style.display = 'none';
        moveBtn.style.display = 'none';
        phoneInput.value = '';
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
    var isFree = !!item.complimentary;
    return '<div style="display:flex;align-items:center;justify-content:space-between;'
      + 'background:' + (isFree ? '#fff8e6' : '#f5eeff') + ';border:1px solid ' + (isFree ? 'rgba(245,196,48,0.4)' : '#e0c8f0') + ';'
      + 'border-radius:10px;padding:10px 12px">'
      + '<div style="flex:1">'
      + '<div style="font-size:13px;font-weight:600;color:#1a0820">' + item.name
      + (isFree ? ' <span style="font-size:9px;font-weight:700;color:#b87410;background:rgba(245,196,48,0.2);padding:2px 7px;border-radius:10px;margin-left:4px">🎁 FREE</span>' : '') + '</div>'
      + '<div style="font-size:11px;color:#9c0ca1;' + (isFree ? 'text-decoration:line-through' : '') + '">₹' + item.price + ' × ' + item.qty + '</div>'
      + '</div>'
      + '<div style="font-size:13px;font-weight:700;color:' + (isFree ? '#b87410' : '#6e0977') + ';margin-right:8px">'
      + (isFree ? 'FREE' : ('₹' + (item.price * item.qty))) + '</div>'
      + '<div onclick="tsToggleComplimentary(' + i + ')" title="Mark complimentary" style="width:26px;height:26px;border-radius:50%;'
      + 'background:' + (isFree ? '#b87410' : '#fff') + ';border:1px solid ' + (isFree ? '#b87410' : '#e0c8f0') + ';display:flex;'
      + 'align-items:center;justify-content:center;cursor:pointer;font-size:12px;margin-right:6px">🎁</div>'
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
  var total = _tsItems.reduce(function (s, i) { return s + (i.complimentary ? 0 : i.price * i.qty); }, 0);
  var el = document.getElementById('ts-total');
  if (el) el.textContent = '₹' + total;
  return total;
}

function tsToggleComplimentary(idx) {
  _tsItems[idx].complimentary = !_tsItems[idx].complimentary;
  tsRenderItems();
  tsCalcTotal();
}

async function tsSubmit() {
  if (!_tsItems.length) { showStoreToast('Add at least one item'); return; }
  var btn = document.getElementById('ts-send-btn');
  var total = tsCalcTotal();

  var phoneRaw = (document.getElementById('ts-cust-phone').value || '').replace(/\D/g, '');
  var phone = phoneRaw.length === 10 ? '+91' + phoneRaw : null;

  var finalItems = _tsItems.map(function (item) {
    var isNew = item._origQty === undefined;
    var qtyIncreased = !isNew && item.qty > item._origQty;
    var resetPrep = isNew || qtyIncreased;
    return {
      name: item.name,
      price: item.price,
      qty: item.qty,
      delivered: resetPrep ? false : !!item.delivered,
      prepared_by: resetPrep ? null : (item.prepared_by || null),
      prepared_at: resetPrep ? null : (item.prepared_at || null),
      complimentary: !!item.complimentary
    };
  });

  try {
    if (_tsExistingOrder) {
      btn.disabled = true; btn.textContent = 'Sending…';
      var updatePayload = { items: JSON.stringify(finalItems), total: total };
      if (phone) updatePayload.customer_phone = phone;
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
        customer_phone:  phone,
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
    closeTableOrderSheet();
  } catch (e) {
    showStoreToast('Error: ' + e.message);
  } finally {
    btn.disabled = false;
  }
}

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
  openSplitPaymentPicker(_tsExistingOrder.id, _tsExistingOrder.total, { type: 'table', tableCode: _tsTableCode, fromTablesBoard: true });
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

    var pmMap = { upi: 'UPI', upi_qr: 'UPI (QR)', cash: 'Cash', card: 'Card', razorpay: 'Razorpay', gpay: 'Google Pay', phonepe: 'PhonePe', split: 'Split Payment' };
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

    var itemsHtml = o.table_code
      ? (itemsArr || []).map(function (i, idx) {
          var delivered = !!i.delivered;
          var preparedTag = i.prepared_by
            ? '<span style="font-size:9px;font-weight:700;color:#4ade80;background:rgba(74,222,128,0.12);'
              + 'padding:2px 7px;border-radius:10px;margin-left:6px;flex-shrink:0">✅ ' + i.prepared_by + '</span>'
            : '';
          var compTag = i.complimentary
            ? '<span style="font-size:9px;font-weight:700;color:#b87410;background:rgba(245,196,48,0.15);'
              + 'padding:2px 7px;border-radius:10px;margin-left:6px;flex-shrink:0">🎁 FREE</span>'
            : '';
          return '<div style="display:flex;align-items:center;gap:9px;padding:5px 0">'
            + '<span onclick="kToggleItemDelivered(\'' + o.id + '\',' + idx + ')" style="width:18px;height:18px;border-radius:5px;flex-shrink:0;display:flex;'
            + 'align-items:center;justify-content:center;font-size:11px;color:#0c0810;cursor:pointer;'
            + 'border:1.5px solid ' + (delivered ? '#4ade80' : 'rgba(255,255,255,.25)') + ';'
            + 'background:' + (delivered ? '#4ade80' : 'transparent') + '">' + (delivered ? '✓' : '') + '</span>'
            + '<span onclick="kToggleItemDelivered(\'' + o.id + '\',' + idx + ')" style="flex:1;font-size:13px;font-weight:500;cursor:pointer;'
            + 'color:' + (delivered ? 'rgba(245,234,220,.4)' : '#f5eadc') + ';'
            + 'text-decoration:' + (delivered ? 'line-through' : 'none') + '">' + i.name + '</span>'
            + preparedTag
            + compTag
            + '<span onclick="openItemRecipePopup(\'' + o.id + '\',' + idx + ')" style="width:24px;height:24px;border-radius:7px;'
            + 'background:rgba(245,196,48,0.15);border:1px solid rgba(245,196,48,0.3);display:flex;align-items:center;'
            + 'justify-content:center;font-size:12px;cursor:pointer;flex-shrink:0">📖</span>'
            + '<span style="font-size:12px;color:#f5c430;font-weight:700;flex-shrink:0">×' + i.qty + '</span>'
            + '</div>';
        }).join('')
      : (itemsArr || []).map(function (i, idx) {
          var preparedTag = i.prepared_by
            ? '<span style="font-size:9px;font-weight:700;color:#4ade80;background:rgba(74,222,128,0.12);'
              + 'padding:2px 7px;border-radius:10px;margin-left:6px;flex-shrink:0">✅ ' + i.prepared_by + '</span>'
            : '';
          var compTag = i.complimentary
            ? '<span style="font-size:9px;font-weight:700;color:#b87410;background:rgba(245,196,48,0.15);'
              + 'padding:2px 7px;border-radius:10px;margin-left:6px;flex-shrink:0">🎁 FREE</span>'
            : '';
          return '<div style="display:flex;align-items:center;justify-content:space-between;padding:4px 0">'
            + '<span style="font-size:13px;color:#f5eadc;font-weight:500;flex:1">' + i.name + '</span>'
            + preparedTag
            + compTag
            + '<span onclick="openItemRecipePopup(\'' + o.id + '\',' + idx + ')" style="width:24px;height:24px;border-radius:7px;'
            + 'background:rgba(245,196,48,0.15);border:1px solid rgba(245,196,48,0.3);display:flex;align-items:center;'
            + 'justify-content:center;font-size:12px;cursor:pointer;flex-shrink:0;margin-left:8px">📖</span>'
            + '<span style="font-size:12px;color:#f5c430;font-weight:700;flex-shrink:0;margin-left:8px">×' + i.qty + '</span>'
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
            + '<button class="k-btn" onclick="openSplitPaymentPicker(\'' + o.id + '\',' + (o.total || 0) + ',{type:\'table\',tableCode:\'' + o.table_code + '\'})" '
            + 'style="background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);color:#15803d">💰 Mark Bill Collected</button>'
          : '<button class="k-btn k-done" onclick="kCollectOrder(\'' + o.id + '\',\'' + (o.payment_status || 'pending') + '\',' + (o.total || 0) + ')">Collected ✓</button>')
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

async function kMarkDelivered(id) {
  try {
    var res = await db.from('store_orders').select('items').eq('id', id).single();
    if (res.error) throw res.error;
    var items = Array.isArray(res.data.items) ? res.data.items : JSON.parse(res.data.items || '[]');
    items.forEach(function (i) { i.delivered = true; });

    await db.from('store_orders').update({ items: JSON.stringify(items) }).eq('id', id);

    showStoreToast('🍽️ All items checked off');
    kitchenManualRefresh();
  } catch (e) {
    showStoreToast('Error: ' + e.message);
  }
}

async function kToggleItemDelivered(orderId, itemIndex) {
  try {
    var res = await db.from('store_orders').select('items').eq('id', orderId).single();
    if (res.error) throw res.error;
    var items = Array.isArray(res.data.items) ? res.data.items : JSON.parse(res.data.items || '[]');
    if (!items[itemIndex]) return;

    items[itemIndex].delivered = !items[itemIndex].delivered;

    await db.from('store_orders').update({ items: JSON.stringify(items) }).eq('id', orderId);
    kitchenManualRefresh();
  } catch (e) {
    showStoreToast('Error: ' + e.message);
  }
}

function kCollectOrder(id, paymentStatus, total) {
  if (paymentStatus === 'paid' || paymentStatus === 'complimentary') {
    kBump(id, 'collected');
    return;
  }
  openSplitPaymentPicker(id, total || 0, { type: 'walkin' });
}

// ══════════════════════════════════════════════════════════════
// In-Kitchen Recipe Popup — fast, one-tap, no separate login
// ══════════════════════════════════════════════════════════════
var _krLang = 'en';
var _krOrderId = null;
var _krItemIndex = null;
var _krSelectedStaff = '';
var _krStaffListCache = null;

async function openItemRecipePopup(orderId, itemIndex) {
  _krOrderId = orderId;
  _krItemIndex = itemIndex;
  _krSelectedStaff = '';

  var existing = document.getElementById('kr-overlay');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.id = 'kr-overlay';
  overlay.onclick = function (e) { if (e.target === overlay) closeItemRecipePopup(); };
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:4500;'
    + 'display:flex;align-items:center;justify-content:center;padding:16px;font-family:\'DM Sans\',sans-serif';

  var card = document.createElement('div');
  card.id = 'kr-card';
  card.style.cssText = 'background:#fff;border-radius:24px;padding:24px 22px;max-width:400px;width:100%;'
    + 'max-height:88vh;overflow-y:auto';
  card.innerHTML = '<div style="text-align:center;padding:30px;color:#9a8aaa;font-size:13px">Loading…</div>';

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  var orderRes = await db.from('store_orders').select('items').eq('id', orderId).single();
  var items = Array.isArray(orderRes.data.items) ? orderRes.data.items : JSON.parse(orderRes.data.items || '[]');
  var item = items[itemIndex];
  if (!item) { closeItemRecipePopup(); return; }

  var ingRes = await db.from('menu_recipes').select('ingredient_name, quantity').eq('menu_item_name', item.name);
  var ingredients = ingRes.data || [];
  var unitRes = ingredients.length
    ? await db.from('inventory_items').select('item_name, unit').in('item_name', ingredients.map(function (i) { return i.ingredient_name; }))
    : { data: [] };
  var unitMap = {};
  (unitRes.data || []).forEach(function (u) { unitMap[u.item_name] = u.unit; });

  var guideRes = await db.from('recipe_guides').select('*').eq('menu_item_name', item.name).maybeSingle();
  var guide = guideRes.data;

  if (!_krStaffListCache) {
    var staffRes = await db.from('store_staff').select('name').eq('active', true).order('name');
    _krStaffListCache = (staffRes.data || []).map(function (s) { return s.name; });
  }

  renderRecipeCard(item, ingredients, unitMap, guide);
}

function krToggleLanguage() {
  _krLang = _krLang === 'en' ? 'ta' : 'en';
  reopenCurrentRecipeCard();
}

async function reopenCurrentRecipeCard() {
  if (_krOrderId === null || _krItemIndex === null) return;
  var orderRes = await db.from('store_orders').select('items').eq('id', _krOrderId).single();
  var items = Array.isArray(orderRes.data.items) ? orderRes.data.items : JSON.parse(orderRes.data.items || '[]');
  var item = items[_krItemIndex];
  if (!item) return;

  var ingRes = await db.from('menu_recipes').select('ingredient_name, quantity').eq('menu_item_name', item.name);
  var ingredients = ingRes.data || [];
  var unitRes = ingredients.length
    ? await db.from('inventory_items').select('item_name, unit').in('item_name', ingredients.map(function (i) { return i.ingredient_name; }))
    : { data: [] };
  var unitMap = {};
  (unitRes.data || []).forEach(function (u) { unitMap[u.item_name] = u.unit; });

  var guideRes = await db.from('recipe_guides').select('*').eq('menu_item_name', item.name).maybeSingle();
  renderRecipeCard(item, ingredients, unitMap, guideRes.data);
}

function renderRecipeCard(item, ingredients, unitMap, guide) {
  var ta = _krLang === 'ta';

  var ingHtml = ingredients.length
    ? ingredients.map(function (i) {
        return '<div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid #f5f0f8;font-size:15px">'
          + '<span>' + i.ingredient_name + '</span>'
          + '<span style="font-weight:700;color:#b87410">' + i.quantity + ' ' + (unitMap[i.ingredient_name] || '') + '</span></div>';
      }).join('')
    : '<div style="text-align:center;padding:16px;color:#9a8aaa;font-size:12px;background:#f5eeff;border-radius:12px">'
      + (ta ? 'பொருட்கள் இன்னும் அமைக்கப்படவில்லை.' : 'Ingredients not set up yet.') + '</div>';

  var stepsEn = (guide && guide.steps) || [];
  var stepsTa = (guide && guide.steps_ta) || [];
  var usingFallback = ta && stepsEn.length > 0 && stepsTa.length === 0;
  var steps = (ta && stepsTa.length > 0) ? stepsTa : stepsEn;

  var stepsHtml = steps.length
    ? (usingFallback ? '<div style="font-size:11px;color:#c2607a;margin-bottom:8px">தமிழ் மொழிபெயர்ப்பு இல்லை — ஆங்கிலத்தில்.</div>' : '')
      + steps.map(function (s, idx) {
          return '<div style="display:flex;gap:12px;padding:12px 0;border-bottom:1px solid #f5f0f8;align-items:flex-start">'
            + '<div style="width:30px;height:30px;border-radius:50%;background:#6e0977;color:#fff;font-size:14px;font-weight:700;'
            + 'display:flex;align-items:center;justify-content:center;flex-shrink:0">' + (idx + 1) + '</div>'
            + '<div style="font-size:16px;color:#1a0820;line-height:1.4;padding-top:3px;font-weight:600;flex:1">' + s + '</div></div>';
        }).join('')
    : '<div style="text-align:center;padding:16px;color:#9a8aaa;font-size:12px;background:#f5eeff;border-radius:12px">'
      + (ta ? 'இன்னும் படிகள் இல்லை.' : 'No steps added yet.') + '</div>';

  var tip = ta && guide && guide.tips_ta ? guide.tips_ta : (guide && guide.tips);
  var tipHtml = tip
    ? '<div style="background:#fff8e6;border:1.5px solid rgba(245,196,48,0.35);border-radius:14px;padding:14px;margin-top:16px;font-size:13px;color:#8a6a1a">'
      + '💡 <b>' + (ta ? 'குறிப்பு:' : 'Tip:') + '</b> ' + tip + '</div>'
    : '';

  var prepTimeHtml = guide && guide.prep_time_minutes
    ? '<div style="display:inline-block;background:#f5eeff;color:#6e0977;font-size:12px;font-weight:700;padding:5px 14px;border-radius:20px;margin-bottom:16px">⏱ ' + guide.prep_time_minutes + ' min</div>'
    : '';

  var preparedTag = item.prepared_by
    ? '<div style="text-align:center;margin-bottom:14px"><span style="font-size:11px;font-weight:700;color:#15803d;background:rgba(34,197,94,0.12);padding:5px 12px;border-radius:20px">✅ '
      + (ta ? 'தயார் செய்தவர்: ' : 'Prepared by: ') + item.prepared_by + '</span></div>'
    : '';

  var staffOptions = '<option value="">' + (ta ? 'பணியாளர் பெயரைத் தேர்ந்தெடுக்கவும்...' : 'Select staff name...') + '</option>'
    + (_krStaffListCache || []).map(function (n) { return '<option value="' + n + '"' + (n === item.prepared_by ? ' selected' : '') + '>' + n + '</option>'; }).join('');

  var card = document.getElementById('kr-card');
  card.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">'
    + '<div style="font-family:Fraunces,Georgia,serif;font-size:24px;font-weight:900;color:#1a0820;flex:1">' + item.name + '</div>'
    + '<div onclick="krToggleLanguage()" style="background:#f5eeff;border-radius:20px;padding:6px 12px;font-size:11px;'
    + 'font-weight:700;color:#6e0977;cursor:pointer;flex-shrink:0;margin-left:10px">' + (ta ? 'தமிழ் / EN' : 'EN / தமிழ்') + '</div>'
    + '</div>'
    + prepTimeHtml
    + preparedTag
    + '<div style="font-size:11px;font-weight:700;letter-spacing:1.5px;color:#c2607a;margin:16px 0 10px">' + (ta ? 'பொருட்கள்' : 'INGREDIENTS') + '</div>' + ingHtml
    + '<div style="font-size:11px;font-weight:700;letter-spacing:1.5px;color:#c2607a;margin:16px 0 10px">' + (ta ? 'படிகள்' : 'STEPS') + '</div>' + stepsHtml
    + tipHtml
    + '<div style="background:#f5eeff;border:1.5px solid rgba(110,9,119,0.2);border-radius:16px;padding:16px;margin-top:18px">'
    + '<div style="font-size:11px;font-weight:700;letter-spacing:1.5px;color:#6e0977;margin-bottom:10px">' + (ta ? 'யார் தயார் செய்கிறார்கள்?' : "WHO'S PREPARING THIS?") + '</div>'
    + '<select id="kr-staff-select" onchange="krOnStaffSelected()" style="width:100%;padding:11px 12px;border-radius:10px;'
    + 'border:1.5px solid rgba(110,9,119,0.2);background:#fff;font-size:13px;font-family:inherit;margin-bottom:10px">' + staffOptions + '</select>'
    + '<div id="kr-check-row" onclick="krTogglePrepared()" style="display:flex;align-items:center;gap:10px;cursor:pointer;'
    + 'opacity:' + (item.prepared_by ? '1' : '.4') + ';pointer-events:' + (item.prepared_by ? 'auto' : 'none') + '">'
    + '<div id="kr-checkbox" style="width:24px;height:24px;border-radius:7px;border:2px solid rgba(110,9,119,0.35);'
    + 'background:' + (item.prepared_by ? '#6e0977' : '#fff') + ';display:flex;align-items:center;justify-content:center;'
    + 'font-size:14px;color:#fff;flex-shrink:0">' + (item.prepared_by ? '✓' : '') + '</div>'
    + '<div style="font-size:13px;font-weight:700;color:#1a0820">' + (ta ? 'தயார் என குறிக்கவும்' : 'Mark as prepared') + '</div>'
    + '</div></div>'
    + '<button onclick="closeItemRecipePopup()" style="width:100%;padding:15px;margin-top:20px;'
    + 'background:linear-gradient(135deg,#6e0977,#9c0ca1);color:#fff;font-size:15px;font-weight:700;border:none;border-radius:14px;cursor:pointer">'
    + (ta ? 'மூடு' : 'Close') + '</button>';

  if (item.prepared_by) _krSelectedStaff = item.prepared_by;
}

function krOnStaffSelected() {
  _krSelectedStaff = document.getElementById('kr-staff-select').value;
  var row = document.getElementById('kr-check-row');
  row.style.opacity = _krSelectedStaff ? '1' : '.4';
  row.style.pointerEvents = _krSelectedStaff ? 'auto' : 'none';
}

async function krTogglePrepared() {
  if (!_krSelectedStaff || _krOrderId === null || _krItemIndex === null) return;

  try {
    var res = await db.from('store_orders').select('items').eq('id', _krOrderId).single();
    if (res.error) throw res.error;
    var items = Array.isArray(res.data.items) ? res.data.items : JSON.parse(res.data.items || '[]');
    var item = items[_krItemIndex];
    if (!item) return;

    var nowMarking = !item.prepared_by;
    item.prepared_by = nowMarking ? _krSelectedStaff : null;
    item.prepared_at = nowMarking ? new Date().toISOString() : null;

    await db.from('store_orders').update({ items: JSON.stringify(items) }).eq('id', _krOrderId);

    var box = document.getElementById('kr-checkbox');
    box.style.background = nowMarking ? '#6e0977' : '#fff';
    box.textContent = nowMarking ? '✓' : '';

    kitchenManualRefresh();
  } catch (e) {
    showStoreToast('Error: ' + e.message);
  }
}

function closeItemRecipePopup() {
  var el = document.getElementById('kr-overlay');
  if (el) el.remove();
  _krOrderId = null;
  _krItemIndex = null;
}

// ══════════════════════════════════════════════════════════════
// Payment Collection Picker — shared by walk-in "Collected" AND table
// "Mark Bill Collected". Defaults to Full Payment (one tap, done —
// most transactions are single-method) with a Partial Payment toggle
// for the minority of customers who split across methods. Cash
// specifically also tracks amount received + change to return.
// ══════════════════════════════════════════════════════════════
var _spOrderId = null;
var _spTotal = 0;
var _spContext = null;
var _spMode = 'full'; // 'full' | 'partial'
var _spFullMethod = null; // selected method in Full mode, before confirming cash

var SP_METHOD_META = {
  cash:   { label: 'Cash',     icon: '💵', color: '#b87410', bg: 'rgba(184,116,16,0.1)',  border: 'rgba(184,116,16,0.35)' },
  upi:    { label: 'UPI',      icon: '📱', color: '#6e0977', bg: 'rgba(110,9,119,0.1)',   border: 'rgba(110,9,119,0.35)' },
  upi_qr: { label: 'Scan QR',  icon: '📲', color: '#15803d', bg: 'rgba(34,197,94,0.1)',   border: 'rgba(34,197,94,0.35)' },
  card:   { label: 'Card',     icon: '💳', color: '#2563eb', bg: 'rgba(37,99,235,0.1)',   border: 'rgba(37,99,235,0.35)' }
};

function openSplitPaymentPicker(orderId, total, context) {
  _spOrderId = orderId;
  _spTotal = total || 0;
  _spContext = context || { type: 'walkin' };
  _spMode = 'full';
  _spFullMethod = null;

  var existing = document.getElementById('sp-overlay');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.id = 'sp-overlay';
  overlay.onclick = function (e) { if (e.target === overlay) closeSplitPaymentPicker(); };
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(18,10,30,0.65);backdrop-filter:blur(3px);'
    + 'z-index:4400;display:flex;align-items:center;justify-content:center;padding:16px;font-family:\'DM Sans\',sans-serif';

  var box = document.createElement('div');
  box.id = 'sp-card';
  box.style.cssText = 'background:#fff;border-radius:26px;max-width:400px;width:100%;'
    + 'max-height:90vh;overflow-y:auto;box-shadow:0 24px 60px rgba(0,0,0,0.3)';

  var titleTxt = _spContext.type === 'table' ? _spContext.tableCode + ' — Collect Payment' : 'Collect Payment';

  box.innerHTML =
      '<div style="background:linear-gradient(135deg,#6e0977,#9c0ca1);padding:24px 22px;border-radius:26px 26px 0 0;text-align:center">'
    + '<div style="font-size:10px;font-weight:700;letter-spacing:3px;color:rgba(255,255,255,.7)">CHOCOCRAVINGS</div>'
    + '<div style="font-family:Fraunces,Georgia,serif;font-size:19px;font-weight:900;color:#fff;margin-top:2px">' + titleTxt + '</div>'
    + '<div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:rgba(255,255,255,.65);margin-top:14px">BILL TOTAL</div>'
    + '<div style="font-family:Fraunces,Georgia,serif;font-size:38px;font-weight:900;color:#f5c430;margin-top:2px">₹' + _spTotal + '</div>'
    + '</div>'
    + '<div style="padding:20px 22px 24px">'
    + '<div style="display:flex;gap:8px;margin-bottom:18px;background:#f5eeff;border-radius:14px;padding:4px">'
    +   '<div id="sp-mode-full" onclick="spSetMode(\'full\')" style="flex:1;text-align:center;padding:10px;border-radius:11px;'
    +     'font-size:12px;font-weight:700;cursor:pointer;background:#6e0977;color:#fff">💯 Full Payment</div>'
    +   '<div id="sp-mode-partial" onclick="spSetMode(\'partial\')" style="flex:1;text-align:center;padding:10px;border-radius:11px;'
    +     'font-size:12px;font-weight:700;cursor:pointer;color:#9a8aaa">🔀 Partial Payment</div>'
    + '</div>'
    + '<div id="sp-body"></div>'
    + '<button onclick="closeSplitPaymentPicker()" style="width:100%;padding:12px;margin-top:14px;'
    + 'background:transparent;color:#9a8aaa;font-size:12px;font-weight:600;border-radius:12px;border:none;cursor:pointer">Cancel</button>'
    + '</div>';

  overlay.appendChild(box);
  document.body.appendChild(overlay);
  renderSpBody();
}

function spSetMode(mode) {
  _spMode = mode;
  _spFullMethod = null;
  document.getElementById('sp-mode-full').style.background = mode === 'full' ? '#6e0977' : 'transparent';
  document.getElementById('sp-mode-full').style.color = mode === 'full' ? '#fff' : '#9a8aaa';
  document.getElementById('sp-mode-partial').style.background = mode === 'partial' ? '#6e0977' : 'transparent';
  document.getElementById('sp-mode-partial').style.color = mode === 'partial' ? '#fff' : '#9a8aaa';
  renderSpBody();
}

function renderSpBody() {
  var body = document.getElementById('sp-body');
  body.innerHTML = _spMode === 'full' ? spFullModeHtml() : spPartialModeHtml();
  if (_spMode === 'partial') updateSplitRemaining();
}

// ── FULL PAYMENT MODE ──
function spFullModeHtml() {
  var methodGrid = Object.keys(SP_METHOD_META).map(function (key) {
    var m = SP_METHOD_META[key];
    var selected = _spFullMethod === key;
    return '<div onclick="spSelectFullMethod(\'' + key + '\')" style="padding:16px 10px;border-radius:16px;text-align:center;'
      + 'cursor:pointer;background:' + (selected ? m.color : m.bg) + ';border:1.5px solid ' + m.border + ';'
      + 'transition:all .15s' + (selected ? ';box-shadow:0 6px 16px ' + m.border : '') + '">'
      + '<div style="font-size:26px;margin-bottom:4px">' + m.icon + '</div>'
      + '<div style="font-size:12px;font-weight:700;color:' + (selected ? '#fff' : m.color) + '">' + m.label + '</div>'
      + '</div>';
  }).join('');

  var cashSection = _spFullMethod === 'cash'
    ? '<div style="background:#fff8e6;border:1.5px solid rgba(245,196,48,0.4);border-radius:16px;padding:16px;margin-top:14px">'
      + '<div style="font-size:11px;font-weight:700;letter-spacing:1.5px;color:#b87410;margin-bottom:10px">AMOUNT RECEIVED FROM CUSTOMER</div>'
      + '<input id="sp-cash-received" type="number" inputmode="decimal" placeholder="₹ 0" oninput="spUpdateChange()" '
      + 'style="width:100%;padding:14px;border-radius:12px;border:1.5px solid rgba(245,196,48,0.5);'
      + 'font-family:Fraunces,Georgia,serif;font-size:24px;font-weight:900;text-align:center;color:#1a0820;outline:none;box-sizing:border-box">'
      + '<div id="sp-change-display" style="text-align:center;margin-top:12px;font-size:14px;font-weight:700"></div>'
      + '<button onclick="spConfirmFullCash()" style="width:100%;padding:14px;margin-top:14px;'
      + 'background:linear-gradient(135deg,#6e0977,#9c0ca1);color:#fff;font-size:14px;font-weight:700;'
      + 'border:none;border-radius:12px;cursor:pointer">✅ Confirm Cash Payment</button>'
      + '</div>'
    : '';

  return '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' + methodGrid + '</div>' + cashSection;
}

function spSelectFullMethod(key) {
  if (key !== 'cash') {
    spConfirmFullNonCash(key);
    return;
  }
  _spFullMethod = 'cash';
  renderSpBody();
  setTimeout(function () {
    var el = document.getElementById('sp-cash-received');
    if (el) el.focus();
  }, 50);
}

function spUpdateChange() {
  var received = parseFloat(document.getElementById('sp-cash-received').value) || 0;
  var change = Math.round((received - _spTotal) * 100) / 100;
  var display = document.getElementById('sp-change-display');
  if (received === 0) {
    display.textContent = '';
  } else if (change > 0) {
    display.style.color = '#15803d';
    display.innerHTML = '💰 Change to return: <span style="font-family:Fraunces,Georgia,serif;font-size:18px">₹' + change + '</span>';
  } else if (change < 0) {
    display.style.color = '#dc2626';
    display.innerHTML = '⚠️ ₹' + Math.abs(change) + ' short of the bill';
  } else {
    display.style.color = '#15803d';
    display.textContent = '✅ Exact amount — no change needed';
  }
}

async function spConfirmFullCash() {
  var received = parseFloat(document.getElementById('sp-cash-received').value) || 0;
  if (received < _spTotal) {
    var proceed = confirm('Amount received (₹' + received + ') is less than the bill (₹' + _spTotal + '). Confirm anyway?');
    if (!proceed) return;
  }
  var change = Math.max(0, Math.round((received - _spTotal) * 100) / 100);
  await spFinalizePayment({ cash: _spTotal }, 'cash', 'Cash ₹' + _spTotal, received, change);
}

async function spConfirmFullNonCash(method) {
  var v = {}; v[method] = _spTotal;
  var m = SP_METHOD_META[method];
  await spFinalizePayment(v, method, m.label + ' ₹' + _spTotal, null, null);
}

// ── PARTIAL PAYMENT MODE ──
function spPartialModeHtml() {
  var rows = Object.keys(SP_METHOD_META).map(function (key) {
    var m = SP_METHOD_META[key];
    return '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid #f5f0f8">'
      + '<span style="font-size:14px;font-weight:600;color:' + m.color + '">' + m.icon + ' ' + m.label + '</span>'
      + '<input id="sp-' + key + '" type="number" inputmode="decimal" placeholder="0" oninput="updateSplitRemaining()" '
      + 'style="width:110px;padding:9px 10px;border-radius:10px;border:1.5px solid ' + m.border + ';'
      + 'font-size:14px;font-weight:700;text-align:right;outline:none">'
      + '</div>';
  }).join('');

  return rows
    + '<div id="sp-cash-change-row" style="display:none;background:#fff8e6;border:1.5px solid rgba(245,196,48,0.4);'
    + 'border-radius:14px;padding:12px 14px;margin-top:12px">'
    + '<div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:#b87410;margin-bottom:6px">CASH RECEIVED (FOR CHANGE)</div>'
    + '<input id="sp-partial-cash-received" type="number" inputmode="decimal" placeholder="₹ 0" oninput="spUpdatePartialChange()" '
    + 'style="width:100%;padding:10px;border-radius:10px;border:1.5px solid rgba(245,196,48,0.5);font-size:15px;'
    + 'font-weight:700;text-align:center;outline:none;box-sizing:border-box">'
    + '<div id="sp-partial-change-display" style="text-align:center;margin-top:8px;font-size:13px;font-weight:700"></div>'
    + '</div>'
    + '<div id="sp-remaining" style="text-align:center;padding:12px;margin:14px 0;border-radius:12px;font-size:13px;font-weight:700"></div>'
    + '<button id="sp-confirm-btn" onclick="confirmSplitPayment()" style="width:100%;padding:15px;'
    + 'background:linear-gradient(135deg,#6e0977,#9c0ca1);color:#fff;font-size:14px;font-weight:700;'
    + 'border:none;border-radius:14px;cursor:pointer">✅ Confirm Payment</button>';
}

function getSplitValues() {
  return {
    cash:   parseFloat(document.getElementById('sp-cash').value) || 0,
    upi:    parseFloat(document.getElementById('sp-upi').value) || 0,
    upi_qr: parseFloat(document.getElementById('sp-upi_qr').value) || 0,
    card:   parseFloat(document.getElementById('sp-card').value) || 0
  };
}

function updateSplitRemaining() {
  var v = getSplitValues();
  var entered = v.cash + v.upi + v.upi_qr + v.card;
  var remaining = Math.round((_spTotal - entered) * 100) / 100;
  var box = document.getElementById('sp-remaining');
  var btn = document.getElementById('sp-confirm-btn');
  var cashRow = document.getElementById('sp-cash-change-row');

  // Only show the cash-received/change sub-field once a cash amount is
  // actually entered — the physical change calculation only matters for
  // whatever portion of the bill is being paid in cash.
  if (cashRow) cashRow.style.display = v.cash > 0 ? 'block' : 'none';

  if (!box || !btn) return;

  if (remaining === 0 && entered > 0) {
    box.style.background = 'rgba(34,197,94,0.1)';
    box.style.color = '#15803d';
    box.textContent = '✅ Fully accounted for — ready to confirm';
    btn.style.opacity = '1';
  } else if (remaining > 0) {
    box.style.background = 'rgba(245,158,11,0.1)';
    box.style.color = '#b87410';
    box.textContent = '₹' + remaining + ' still remaining';
    btn.style.opacity = '.6';
  } else {
    box.style.background = 'rgba(220,38,38,0.1)';
    box.style.color = '#dc2626';
    box.textContent = '₹' + Math.abs(remaining) + ' over the bill total';
    btn.style.opacity = '.6';
  }
}

function spUpdatePartialChange() {
  var v = getSplitValues();
  var received = parseFloat(document.getElementById('sp-partial-cash-received').value) || 0;
  var change = Math.round((received - v.cash) * 100) / 100;
  var display = document.getElementById('sp-partial-change-display');
  if (received === 0) {
    display.textContent = '';
  } else if (change > 0) {
    display.style.color = '#15803d';
    display.innerHTML = '💰 Change to return: ₹' + change;
  } else if (change < 0) {
    display.style.color = '#dc2626';
    display.textContent = '⚠️ ₹' + Math.abs(change) + ' short for the cash portion';
  } else {
    display.style.color = '#15803d';
    display.textContent = '✅ Exact — no change needed';
  }
}

function closeSplitPaymentPicker() {
  var el = document.getElementById('sp-overlay');
  if (el) el.remove();
  _spOrderId = null;
  _spContext = null;
}

async function confirmSplitPayment() {
  var v = getSplitValues();
  var entered = v.cash + v.upi + v.upi_qr + v.card;
  var remaining = Math.round((_spTotal - entered) * 100) / 100;

  if (entered === 0) { showStoreToast('Enter at least one amount'); return; }
  if (remaining !== 0) {
    var proceed = confirm(remaining > 0
      ? '₹' + remaining + ' is still unaccounted for. Confirm anyway?'
      : '₹' + Math.abs(remaining) + ' more than the bill total was entered. Confirm anyway?');
    if (!proceed) return;
  }

  var received = v.cash > 0 ? (parseFloat(document.getElementById('sp-partial-cash-received').value) || 0) : null;
  var change = received !== null ? Math.max(0, Math.round((received - v.cash) * 100) / 100) : null;

  var labels = { cash: 'Cash', upi: 'UPI', upi_qr: 'Scan QR', card: 'Card' };
  var usedMethods = Object.keys(v).filter(function (k) { return v[k] > 0; });
  var summaryMethod = usedMethods.length === 1 ? usedMethods[0] : (usedMethods.length > 1 ? 'split' : 'cash');
  var breakdownText = usedMethods.map(function (k) { return labels[k] + ' ₹' + v[k]; }).join(' + ');

  await spFinalizePayment(v, summaryMethod, breakdownText, received, change);
}

// ── Shared finalize step for both Full and Partial modes ──
async function spFinalizePayment(splitObj, summaryMethod, breakdownText, cashReceived, changeGiven) {
  try {
    await db.from('store_orders').update({
      status: 'collected',
      payment_status: 'paid',
      payment_method: summaryMethod,
      payment_split: JSON.stringify(splitObj)
    }).eq('id', _spOrderId);

    var context = _spContext;
    var orderId = _spOrderId;
    closeSplitPaymentPicker();

    var changeNote = (changeGiven && changeGiven > 0) ? (' · Change given: ₹' + changeGiven) : '';
    showStoreToast('✅ Collected · ' + breakdownText + changeNote);
    kitchenManualRefresh();

    if (context.type === 'table') {
      await sendTableBillWhatsApp(orderId, context.tableCode, breakdownText);
    }
  } catch (e) {
    showStoreToast('Error: ' + e.message);
  }
}

async function sendTableBillWhatsApp(orderId, tableCode, breakdownText) {
  try {
    var res = await db.from('store_orders').select('items, total, customer_phone').eq('id', orderId).single();
    if (res.error) throw res.error;
    var items = Array.isArray(res.data.items) ? res.data.items : JSON.parse(res.data.items || '[]');
    var total = res.data.total || 0;

    var phone = prompt('Customer phone number for WhatsApp bill (leave blank to skip):', res.data.customer_phone || '');
    if (!phone) return;

    var digits = phone.replace(/\D/g, '').slice(-10);
    if (digits.length !== 10) { showStoreToast('Skipped WhatsApp — enter a valid 10-digit number next time'); return; }

    var lines = items.map(function (i) { return i.name + ' ×' + i.qty + ' — ₹' + (i.price * i.qty); });
    var message = '🧾NSDI Choco Cravings Bill\n'
      + 'Table: ' + tableCode + '\n\n'
      + lines.join('\n') + '\n\n'
      + 'Total: ₹' + total + '\n'
      + 'Paid via: ' + breakdownText + '\n\n'
      + 'Thank you for visiting! 🍫\n'
      + 'Order again: https://chococravings.netlify.app/chococravings_n.apk'
      + '\n Insta Page : https://www.instagram.com/nsdi.chococravings';
    window.open('https://wa.me/91' + digits + '?text=' + encodeURIComponent(message), '_blank');
  } catch (e) {
    showStoreToast('Error: ' + e.message);
  }
}

// ══════════════════════════════════════════════════════════════
// Kitchen Order History — modern slide-in drawer from the left,
// showing today's completed/cancelled orders. Each entry expands to
// show full item details on tap.
// ══════════════════════════════════════════════════════════════
var _khOpen = false;
var _khExpandedId = null;

document.addEventListener('DOMContentLoaded', function () {
  buildKitchenHistoryDrawer();
  injectKitchenHistoryButton();
});

function buildKitchenHistoryDrawer() {
  var backdrop = document.createElement('div');
  backdrop.id = 'kh-backdrop';
  backdrop.onclick = closeKitchenHistory;
  backdrop.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);'
    + 'z-index:2900;backdrop-filter:blur(2px)';
  document.body.appendChild(backdrop);

  var drawer = document.createElement('div');
  drawer.id = 'kh-drawer';
  drawer.style.cssText = 'position:fixed;top:0;left:0;bottom:0;width:320px;max-width:86vw;'
    + 'background:#0e0716;border-right:1px solid rgba(255,255,255,.08);z-index:2901;'
    + 'transform:translateX(-100%);transition:transform .3s cubic-bezier(.4,0,.2,1);'
    + 'font-family:\'DM Sans\',sans-serif;overflow-y:auto;box-shadow:8px 0 30px rgba(0,0,0,0.3)';
  drawer.innerHTML =
      '<div style="position:sticky;top:0;background:#0e0716;padding:18px 18px 14px;'
    + 'border-bottom:1px solid rgba(255,255,255,.08);display:flex;align-items:center;justify-content:space-between;z-index:1">'
    +   '<div>'
    +     '<div style="font-size:9px;letter-spacing:2.5px;color:#c084fc;font-weight:700">TODAY</div>'
    +     '<div style="font-family:Fraunces,Georgia,serif;font-size:19px;font-weight:900;color:#fff">Order History</div>'
    +   '</div>'
    +   '<div onclick="closeKitchenHistory()" style="width:32px;height:32px;border-radius:50%;'
    +     'background:rgba(255,255,255,.06);display:flex;align-items:center;justify-content:center;'
    +     'cursor:pointer;color:#fff;font-size:14px">✕</div>'
    + '</div>'
    + '<div id="kh-list" style="padding:14px"></div>';
  document.body.appendChild(drawer);
}

function injectKitchenHistoryButton() {
  var attempts = 0;
  var poll = setInterval(function () {
    attempts++;
    var kHdr = document.querySelector('#pg-kitchen .k-hdr');
    if (kHdr) {
      clearInterval(poll);
      if (document.getElementById('kitchen-history-btn')) return;

      var btn = document.createElement('div');
      btn.id = 'kitchen-history-btn';
      btn.onclick = toggleKitchenHistory;
      btn.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:8px 14px;'
        + 'border-radius:20px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);'
        + 'color:rgba(245,234,220,.75);font-size:11px;font-weight:700;cursor:pointer;margin-left:8px;'
        + 'font-family:\'DM Sans\',sans-serif;transition:background .15s';
      btn.onmouseenter = function () { btn.style.background = 'rgba(255,255,255,.12)'; };
      btn.onmouseleave = function () { btn.style.background = 'rgba(255,255,255,.06)'; };
      btn.innerHTML = '📋 History';
      kHdr.insertBefore(btn, kHdr.firstChild);
    } else if (attempts >= 20) {
      clearInterval(poll);
    }
  }, 300);
}

function toggleKitchenHistory() {
  if (_khOpen) closeKitchenHistory();
  else openKitchenHistory();
}

function openKitchenHistory() {
  _khOpen = true;
  document.getElementById('kh-backdrop').style.display = 'block';
  document.getElementById('kh-drawer').style.transform = 'translateX(0)';
  loadKitchenHistory();
}

function closeKitchenHistory() {
  _khOpen = false;
  document.getElementById('kh-backdrop').style.display = 'none';
  document.getElementById('kh-drawer').style.transform = 'translateX(-100%)';
  _khExpandedId = null;
}

var _khCachedOrders = [];

async function loadKitchenHistory() {
  var list = document.getElementById('kh-list');
  list.innerHTML = '<div style="text-align:center;padding:30px;color:rgba(255,255,255,.35);font-size:12px">Loading…</div>';

  var today = new Date().toISOString().slice(0, 10);
  var res = await db.from('store_orders')
    .select('*')
    .gte('created_at', today + 'T00:00:00.000Z')
    .in('status', ['collected', 'cancelled'])
    .order('created_at', { ascending: false });

  _khCachedOrders = res.data || [];
  renderKitchenHistory(_khCachedOrders);
}

function renderKitchenHistory(orders) {
  var list = document.getElementById('kh-list');
  if (!orders.length) {
    list.innerHTML = '<div style="text-align:center;padding:30px;color:rgba(255,255,255,.35);font-size:13px;'
      + 'font-family:Fraunces,Georgia,serif">No completed orders yet today</div>';
    return;
  }

  list.innerHTML = orders.map(function (o) {
    var rawItems = o.items;
    var items = Array.isArray(rawItems) ? rawItems : (typeof rawItems === 'string' ? JSON.parse(rawItems || '[]') : []);
    var headline = o.table_code ? '🍽️ ' + o.table_code : '#' + o.token;
    var time = new Date(o.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    var isCancelled = o.status === 'cancelled';
    var expanded = _khExpandedId === o.id;

    var pmMap = { upi: 'UPI', upi_qr: 'Scan QR', cash: 'Cash', card: 'Card', split: 'Split', razorpay: 'Razorpay' };
    var pmLabel = pmMap[(o.payment_method || '').toLowerCase()] || (o.payment_method || '—');

    var statusBadge = isCancelled
      ? '<span style="font-size:9px;font-weight:700;color:#f87171;background:rgba(239,68,68,0.12);padding:3px 9px;border-radius:20px">CANCELLED</span>'
      : '<span style="font-size:9px;font-weight:700;color:#4ade80;background:rgba(74,222,128,0.12);padding:3px 9px;border-radius:20px">✅ ' + pmLabel + '</span>';

    var itemsDetail = expanded
      ? '<div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.08)">'
        + items.map(function (i) {
            var freeTag = i.complimentary ? ' <span style="color:#f5c430">🎁 FREE</span>' : '';
            return '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12px;color:rgba(245,234,220,.7)">'
              + '<span>' + i.name + ' ×' + i.qty + freeTag + '</span></div>';
          }).join('')
        + '</div>'
      : '';

    return '<div onclick="toggleHistoryEntry(\'' + o.id + '\')" style="background:rgba(255,255,255,.03);'
      + 'border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:13px;margin-bottom:9px;cursor:pointer;'
      + 'transition:background .15s' + (isCancelled ? ';opacity:.6' : '') + '">'
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">'
      + '<span style="font-family:Fraunces,Georgia,serif;font-size:16px;font-weight:900;color:#fff">' + headline + '</span>'
      + '<span style="font-size:10px;color:rgba(255,255,255,.35)">' + time + '</span>'
      + '</div>'
      + '<div style="display:flex;align-items:center;justify-content:space-between">'
      + statusBadge
      + '<span style="font-family:Fraunces,Georgia,serif;font-size:15px;font-weight:900;color:#f5c430">₹' + (o.total || 0) + '</span>'
      + '</div>'
      + '<div style="text-align:center;margin-top:6px;font-size:10px;color:rgba(255,255,255,.3)">' + (expanded ? '▲ tap to collapse' : '▼ tap to expand · ' + items.length + ' items') + '</div>'
      + itemsDetail
      + '</div>';
  }).join('');
}

function toggleHistoryEntry(orderId) {
  _khExpandedId = _khExpandedId === orderId ? null : orderId;
  renderKitchenHistory(_khCachedOrders); // re-render from cache, no need to re-fetch just to toggle
}

// ══════════════════════════════════════════════════════════════
// New Order Sound Alert — Admin gets a loud, distinctive chime +
// toast the moment ANY new order lands (table, walk-in, or customer
// self-checkout), even if they're on a different tab of the app.
// Uses a generated tone (Web Audio API) instead of an audio file —
// no external file to host, loads instantly, works offline.
// ══════════════════════════════════════════════════════════════
var _noaCh = null;

document.addEventListener('DOMContentLoaded', function () {
  waitForAdminThenSubscribeOrderAlerts();
});

function waitForAdminThenSubscribeOrderAlerts() {
  var attempts = 0;
  var poll = setInterval(function () {
    attempts++;
    if (typeof isAdmin !== 'undefined' && isAdmin) {
      clearInterval(poll);
      subscribeNewOrderAlerts();
    } else if (attempts >= 20) {
      clearInterval(poll);
    }
  }, 300);
}

// Single dedicated subscription just for this alert — deliberately
// separate from the Kitchen/Tables subscriptions elsewhere in this app,
// so this never risks disrupting those (see the churn issue notes
// throughout this file for why that separation matters).
function subscribeNewOrderAlerts() {
  if (_noaCh) return;
  _noaCh = db.channel('new-order-alert')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'store_orders' }, function (payload) {
      var o = payload.new;
      if (!o) return;
      playNewOrderChime();
      showNewOrderToast(o);
    })
    .subscribe();
}

function showNewOrderToast(o) {
  var headline = o.table_code ? '🍽️ Table ' + o.table_code : '🙋 New order #' + o.token;
  if (typeof showStoreToast === 'function') {
    showStoreToast('🔔 ' + headline + ' — ₹' + (o.total || 0));
  }
}

// Generates a distinctive 3-tone ascending chime, played twice, loud
// enough to actually get noticed in a busy kitchen — no audio file
// needed. Autoplay is safe here since it only fires after the admin has
// already interacted with the page at least once (normal browser rule).
function playNewOrderChime() {
  try {
    var AudioCtx = window.AudioContext || window.webkitAudioContext;
    var ctx = new AudioCtx();
    var now = ctx.currentTime;

    function tone(freq, startOffset, duration, gainPeak) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + startOffset);
      gain.gain.setValueAtTime(0, now + startOffset);
      gain.gain.linearRampToValueAtTime(gainPeak, now + startOffset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration);
    }

    // First chime: ascending ding-ding-ding
    tone(880, 0.00, 0.18, 0.5);   // A5
    tone(1108, 0.15, 0.18, 0.5);  // C#6
    tone(1318, 0.30, 0.30, 0.55); // E6

    // Second chime, slightly delayed — repeats the pattern to make sure
    // it actually gets noticed over kitchen noise.
    tone(880, 0.65, 0.18, 0.5);
    tone(1108, 0.80, 0.18, 0.5);
    tone(1318, 0.95, 0.30, 0.55);
  } catch (e) {
    // Autoplay blocked or unsupported browser — fails silently, toast still shows.
  }
}

// ══════════════════════════════════════════════════════════════
// Move Table — transfers an active order to a different table when a
// customer physically relocates. Preserves everything about the order
// (items, delivery status, prepared-by tags, payment info, arrival
// rank) — only table_code changes. Only free tables are offered, so
// staff can never accidentally overwrite another table's active order.
// ══════════════════════════════════════════════════════════════
async function openMoveTablePicker() {
  if (!_tsExistingOrder) return;

  var existing = document.getElementById('mt-overlay');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.id = 'mt-overlay';
  overlay.onclick = function (e) { if (e.target === overlay) closeMoveTablePicker(); };
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:3200;'
    + 'display:flex;align-items:center;justify-content:center;padding:20px;font-family:\'DM Sans\',sans-serif';

  var box = document.createElement('div');
  box.id = 'mt-card';
  box.style.cssText = 'background:#fff;border-radius:22px;padding:22px;max-width:380px;width:100%;'
    + 'max-height:80vh;overflow-y:auto';
  box.innerHTML = '<div style="text-align:center;padding:20px;color:#9a8aaa;font-size:12px">Checking free tables…</div>';

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  // Fetch fresh occupancy — never rely on stale data for this, since
  // picking an already-occupied table would silently merge two orders.
  var today = new Date().toISOString().slice(0, 10);
  var res = await db.from('store_orders')
    .select('table_code')
    .not('table_code', 'is', null)
    .not('status', 'in', '("collected","cancelled")')
    .gte('created_at', today + 'T00:00:00.000Z');

  var occupied = {};
  (res.data || []).forEach(function (o) { occupied[o.table_code] = true; });
  var freeTables = TABLE_CODES.filter(function (c) { return c !== _tsTableCode && !occupied[c]; });

  renderMoveTablePicker(freeTables);
}

function renderMoveTablePicker(freeTables) {
  var box = document.getElementById('mt-card');
  if (!box) return;

  var gridHtml = freeTables.length
    ? '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">' + freeTables.map(function (code) {
        return '<div onclick="confirmMoveTable(\'' + code + '\')" style="background:rgba(34,197,94,0.08);'
          + 'border:1.5px solid rgba(34,197,94,0.3);border-radius:14px;padding:16px 8px;text-align:center;cursor:pointer">'
          + '<div style="font-family:Fraunces,Georgia,serif;font-size:20px;font-weight:900;color:#15803d">' + code + '</div>'
          + '</div>';
      }).join('') + '</div>'
    : '<div style="text-align:center;padding:20px;color:#9a8aaa;font-size:13px">No free tables right now.</div>';

  box.innerHTML =
      '<div style="font-size:16px;font-weight:700;color:#1a0820;margin-bottom:2px">Move ' + _tsTableCode + ' to…</div>'
    + '<div style="font-size:12px;color:#9a8aaa;margin-bottom:18px">Only currently free tables are shown, so nothing gets overwritten.</div>'
    + gridHtml
    + '<button onclick="closeMoveTablePicker()" style="width:100%;padding:12px;margin-top:18px;'
    + 'background:transparent;color:#9a8aaa;font-size:12px;font-weight:600;border-radius:12px;border:none;cursor:pointer">Cancel</button>';
}

function closeMoveTablePicker() {
  var el = document.getElementById('mt-overlay');
  if (el) el.remove();
}

async function confirmMoveTable(newCode) {
  if (!_tsExistingOrder) return;
  var oldCode = _tsTableCode;
  if (!confirm('Move ' + oldCode + '\'s order to ' + newCode + '?')) return;

  try {
    var upd = await db.from('store_orders')
      .update({ table_code: newCode })
      .eq('id', _tsExistingOrder.id);
    if (upd.error) throw upd.error;

    closeMoveTablePicker();
    showStoreToast('🔄 Moved ' + oldCode + ' → ' + newCode);
    closeTableOrderSheet(); // returns to the Tables board, which will now show newCode as occupied and oldCode as free
  } catch (e) {
    showStoreToast('Error: ' + e.message);
  }
}
