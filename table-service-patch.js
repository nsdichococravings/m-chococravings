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
var _tsOpenedFromKitchen = false; // true when opened via kOpenOrderEditFromKitchen(), not the Tables board

// Item-level partial-collection amounts derive straight from the items
// jsonb array (each item's paidQty × price) rather than a separate DB
// column — items already exists on every order, so this needs no schema
// migration and can never break Tables/Kitchen if a migration hasn't run.
function tsParseItems(raw) {
  return Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
}

function tsCollectedAmount(items) {
  return Math.round((items || []).reduce(function (s, i) {
    return s + (i.complimentary ? 0 : (i.paidQty || 0) * (i.price || 0));
  }, 0) * 100) / 100;
}

function _tsInit() {
  registerAdminTool('Daily Operations', {
    icon: '🍽️', iconBg: 'rgba(184,116,16,0.12)',
    title: 'Tables', subtitle: 'Dine-in table service',
    onClick: openTablesBoard
  });
  buildTablesBoardDOM();
  injectKitchenRefreshButton();
  injectKitchenOrderCountBadge();

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
    + '<div style="padding:12px 20px;display:flex;gap:12px;align-items:center"><span id="ts-board-status" role="status" aria-live="polite" style="flex:1;font-size:12px;color:#73547d"></span><button type="button" onclick="loadTablesStatus()" style="padding:10px 16px;border:1px solid #e0c8f0;border-radius:10px;background:#fff;color:#6e0977">Refresh</button></div>'
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
    +   '<input id="ts-cust-phone" type="tel" inputmode="numeric" maxlength="10" placeholder="📱 Customer phone (optional)" '
    +     'style="width:100%;padding:12px 14px;border:1.5px solid #e0c8f0;border-radius:12px;font-size:14px;'
    +     'font-family:\'DM Sans\',sans-serif;outline:none;box-sizing:border-box;margin-top:12px">'
    + '<label style="display:block;margin-top:12px;font-size:13px;color:#6e0977">Friends’ NSDI card mobile numbers (comma separated)</label>'
    + '<input id="ts-group-phones" type="text" autocomplete="off" placeholder="9876543210, 9123456780" style="width:100%;padding:12px;border:1px solid #e0c8f0;border-radius:12px;box-sizing:border-box">'
    + '<button type="button" onclick="tsSaveGroupPhones(true)" style="margin-top:8px;padding:8px 12px;border-radius:8px;border:1px solid #e0c8f0;background:#fff;color:#6e0977">Save friends on existing bill</button>'
    + '<small>Only include friends present. Each matching card earns one stamp per day after payment and collection.</small>'
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
  ++_tsBoardRead;
  document.getElementById('ts-board-overlay').style.display = 'none';
  document.getElementById('ts-board-sheet').style.display   = 'none';
  if (_tsBoardCh) { try { db.removeChannel(_tsBoardCh); } catch (e) {} _tsBoardCh = null; }
}

var _tsBoardRead = 0;
var _tsBoardHasSnapshot = false;
var _tsOrderRead = 0;
var _tsOrderLoading = false;
function tsOpenOrdersQuery(columns) {
  // An order occupies a table until closed, irrespective of date/timezone.
  return db.from('store_orders').select(columns).not('status', 'in', '("collected","cancelled")');
}
async function loadTablesStatus() {
  var serial=++_tsBoardRead,notice=document.getElementById('ts-board-status'),grid=document.getElementById('ts-grid');
  if(notice)notice.textContent='Checking open orders…';
  if(grid&&!_tsBoardHasSnapshot)grid.textContent='Loading table status…';
  try {
    var all=[],offset=0,pageSize=200;
    while(true) {
      var res=await tsOpenOrdersQuery('id, table_code, items, total, status, staff_name, created_at')
        .in('table_code',TABLE_CODES).order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+pageSize-1);
      if(serial!==_tsBoardRead)return;
      if(res.error)throw res.error;
      if(!Array.isArray(res.data))throw new Error('Invalid table status response');
      all=all.concat(res.data);
      if(res.data.length<pageSize)break;
      offset+=pageSize;
    }
    var map={},rankMap={};
    all.forEach(function(o){
      if(!map[o.table_code])map[o.table_code]=Object.assign({},o,{_tsOpenOrderCount:1});
      else map[o.table_code]._tsOpenOrderCount++;
    });
    Object.keys(map).sort(function(a,b){return new Date(map[a].created_at)-new Date(map[b].created_at);})
      .forEach(function(code,idx){rankMap[code]=idx+1;});
    // Validate item payloads before replacing the previous successful snapshot.
    Object.keys(map).forEach(function(code){if(!Array.isArray(tsParseItems(map[code].items)))throw new Error('Invalid order items');});
    renderTablesGrid(map,rankMap);_tsBoardHasSnapshot=true;
    if(notice)notice.textContent='Open orders checked '+new Date().toLocaleTimeString('en-IN')+' · Includes overnight orders';
  } catch(error) {
    if(serial!==_tsBoardRead)return;
    if(notice)notice.textContent='Could not refresh tables. '+(_tsBoardHasSnapshot?'Showing the last successful check. ':'Status is unknown. ')+'Tap Refresh to retry.';
    if(grid&&!_tsBoardHasSnapshot)grid.textContent='Table availability could not be loaded. No tables have been marked free.';
    console.warn('Tables status:',error.message);
  }
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
      var collected = tsCollectedAmount(items);
      var billLine = collected > 0
        ? count + ' items · 💰 ₹' + Math.max(0, Math.round((o.total - collected) * 100) / 100) + ' left'
        : count + ' items · ₹' + o.total;

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
        + '<div style="font-size:12px;color:#8a6a3a;margin-top:6px">' + billLine + '</div>'
        + staffBadge
        + (o._tsOpenOrderCount>1?'<div style="font-size:11px;color:#8a6a3a;margin-top:5px">'+o._tsOpenOrderCount+' open bills · newest shown</div>':'')
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
      if(document.getElementById('ts-board-sheet').style.display==='block')loadTablesStatus();
    })
    .subscribe(function(status){if(status==='SUBSCRIBED'&&document.getElementById('ts-board-sheet').style.display==='block')loadTablesStatus();});
}

window.addEventListener('online',function(){if(document.getElementById('ts-board-sheet')?.style.display==='block')loadTablesStatus();});
document.addEventListener('visibilitychange',function(){if(!document.hidden&&document.getElementById('ts-board-sheet')?.style.display==='block')loadTablesStatus();});

function openTableOrderSheet(code) {
  var serial=++_tsOrderRead;
  _tsOrderLoading=true;
  _tsTableCode     = code;
  _tsExistingOrder = null;
  _tsItems         = [];
  _tsOpenedFromKitchen = false;

  document.getElementById('ts-order-title').textContent = code;
  tsPopulateDropdown();

  var sendBtn = document.getElementById('ts-send-btn');
  var billBtn = document.getElementById('ts-bill-btn');
  var undoBtn = document.getElementById('ts-undo-btn');
  var moveBtn = document.getElementById('ts-move-btn');
  sendBtn.disabled=true;sendBtn.textContent='Loading table…';
  billBtn.style.display='none';undoBtn.style.display='none';moveBtn.style.display='none';
  document.getElementById('ts-items-list').textContent='Loading current order…';
  document.getElementById('ts-cust-phone').value='';
  if(document.getElementById('ts-group-phones')) document.getElementById('ts-group-phones').value='';

  tsOpenOrdersQuery('id, items, total, status, created_at, staff_name, customer_phone, customer_group_phones')
    .eq('table_code', code)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
    .then(function (res) {
      if(serial!==_tsOrderRead)return;
      if(res.error)throw res.error;
      var phoneInput = document.getElementById('ts-cust-phone');
      if (res.data) {
        _tsExistingOrder = res.data;
        var rawItems = res.data.items;
        _tsItems = (Array.isArray(rawItems) ? rawItems : JSON.parse(rawItems || '[]')).map(function (i) {
          return { name: i.name, price: i.price, qty: i.qty, delivered: !!i.delivered, prepared_by: i.prepared_by || null, prepared_at: i.prepared_at || null, complimentary: !!i.complimentary, paidQty: i.paidQty || 0, _origQty: i.qty };
        });
        sendBtn.textContent = '➕ Add Items';
        billBtn.style.display = 'block';
        undoBtn.style.display = res.data.status === 'delivered' ? 'block' : 'none';
        moveBtn.style.display = 'block';
        phoneInput.value = (res.data.customer_phone || '').replace(/^\+?91/, '');
        if(document.getElementById('ts-group-phones')) document.getElementById('ts-group-phones').value=(res.data.customer_group_phones || []).join(', ');
      } else {
        sendBtn.textContent = '➕ Send to Kitchen';
        billBtn.style.display = 'none';
        undoBtn.style.display = 'none';
        moveBtn.style.display = 'none';
        phoneInput.value = '';
      }
      tsRenderItems();
      tsCalcTotal();
      _tsOrderLoading=false;sendBtn.disabled=false;
    }).catch(function(error){
      if(serial!==_tsOrderRead)return;
      sendBtn.disabled=true;sendBtn.textContent='Reopen table to retry';
      document.getElementById('ts-items-list').textContent='Could not load this table. Close and reopen to retry; no order has been created.';
      showStoreToast('Could not load table: '+error.message);
    });

  document.getElementById('ts-board-overlay').style.display = 'none';
  document.getElementById('ts-board-sheet').style.display   = 'none';
  document.getElementById('ts-order-overlay').style.display = 'block';
  document.getElementById('ts-order-sheet').style.display   = 'block';
}

// Opens the same order-editing sheet directly from a Kitchen ticket —
// works for BOTH table and walk-in orders, since it fetches by order id
// rather than by table_code. Reuses tsSubmit()'s existing "update an
// existing order" branch as-is; only the opener and close behavior
// differ from the normal Tables board flow.
async function kOpenOrderEditFromKitchen(orderId) {
  ++_tsOrderRead;
  _tsOrderLoading=false;
  _tsOpenedFromKitchen = true;
  _tsExistingOrder = null;
  _tsItems = [];

  var res = await db.from('store_orders')
    .select('id, items, total, status, created_at, staff_name, customer_phone, customer_group_phones, table_code, token')
    .eq('id', orderId)
    .maybeSingle();
  if (!res.data) { showStoreToast('Could not load this order'); return; }

  var o = res.data;
  _tsExistingOrder = o;
  _tsTableCode = o.table_code || null;

  var rawItems = o.items;
  _tsItems = (Array.isArray(rawItems) ? rawItems : JSON.parse(rawItems || '[]')).map(function (i) {
    return { name: i.name, price: i.price, qty: i.qty, delivered: !!i.delivered, prepared_by: i.prepared_by || null, prepared_at: i.prepared_at || null, complimentary: !!i.complimentary, paidQty: i.paidQty || 0, _origQty: i.qty };
  });

  document.getElementById('ts-order-title').textContent = o.table_code ? o.table_code : ('#' + o.token);
  tsPopulateDropdown();

  document.getElementById('ts-send-btn').textContent = '➕ Add Items';
  document.getElementById('ts-send-btn').disabled = false;
  document.getElementById('ts-cust-phone').value = (o.customer_phone || '').replace(/^\+?91/, '');
        if(document.getElementById('ts-group-phones')) document.getElementById('ts-group-phones').value=(o.customer_group_phones || []).join(', ');

  // Quick-edit from Kitchen is purely for adding/modifying items — the
  // billing/undo/move actions already live on the ticket itself, so
  // hide them here to keep this sheet focused on just the one job.
  document.getElementById('ts-bill-btn').style.display = 'none';
  document.getElementById('ts-undo-btn').style.display = 'none';
  var moveBtn = document.getElementById('ts-move-btn');
  if (moveBtn) moveBtn.style.display = 'none';

  tsRenderItems();
  tsCalcTotal();

  document.getElementById('ts-order-overlay').style.display = 'block';
  document.getElementById('ts-order-sheet').style.display   = 'block';
}

function closeTableOrderSheet() {
  ++_tsOrderRead;
  _tsOrderLoading=false;
  document.getElementById('ts-order-overlay').style.display = 'none';
  document.getElementById('ts-order-sheet').style.display   = 'none';
  if (_tsOpenedFromKitchen) {
    _tsOpenedFromKitchen = false;
    if (typeof kitchenManualRefresh === 'function') kitchenManualRefresh();
  } else {
    openTablesBoard();
  }
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
  var item = _tsItems[idx];
  if (item && item.paidQty > 0) { showStoreToast('Can\'t remove — ₹' + (item.paidQty * item.price) + ' already collected for this item'); return; }
  _tsItems.splice(idx, 1);
  tsRenderItems();
  tsCalcTotal();
}

function tsDecrementItem(idx) {
  var item = _tsItems[idx];
  if (!item) return;
  if (item.paidQty > 0 && item.qty <= item.paidQty) { showStoreToast('Can\'t reduce below the ' + item.paidQty + ' already paid for'); return; }
  if (item.qty > 1) {
    item.qty--;
  } else {
    _tsItems.splice(idx, 1); // decrementing from 1 removes the line entirely, same as tapping ✕
  }
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
      + '<div style="flex:1;min-width:0">'
      + '<div style="font-size:13px;font-weight:600;color:#1a0820;display:flex;align-items:center;gap:6px;flex-wrap:wrap">'
      + '<span>' + item.name + '</span>'
      + '<span style="font-family:Fraunces,Georgia,serif;font-size:13px;font-weight:900;color:#fff;'
      + 'background:' + (isFree ? '#b87410' : '#6e0977') + ';padding:2px 9px;border-radius:20px;flex-shrink:0">×' + item.qty + '</span>'
      + (isFree ? '<span style="font-size:9px;font-weight:700;color:#b87410;background:rgba(245,196,48,0.2);padding:2px 7px;border-radius:10px">🎁 FREE</span>' : '')
      + (item.paidQty > 0 ? '<span style="font-size:9px;font-weight:700;color:#15803d;background:rgba(74,222,128,0.15);padding:2px 7px;border-radius:10px">💰 ' + item.paidQty + '/' + item.qty + ' paid</span>' : '')
      + '</div>'
      + '<div style="font-size:11px;color:#9c0ca1;margin-top:2px;' + (isFree ? 'text-decoration:line-through' : '') + '">₹' + item.price + ' each</div>'
      + '</div>'
      + '<div style="font-size:13px;font-weight:700;color:' + (isFree ? '#b87410' : '#6e0977') + ';margin-right:8px;flex-shrink:0">'
      + (isFree ? 'FREE' : ('₹' + (item.price * item.qty))) + '</div>'
      + '<div onclick="tsToggleComplimentary(' + i + ')" title="Mark complimentary" style="width:26px;height:26px;border-radius:50%;'
      + 'background:' + (isFree ? '#b87410' : '#fff') + ';border:1px solid ' + (isFree ? '#b87410' : '#e0c8f0') + ';display:flex;'
      + 'align-items:center;justify-content:center;cursor:pointer;font-size:12px;margin-right:6px">🎁</div>'
      + '<div onclick="tsDecrementItem(' + i + ')" style="width:26px;height:26px;border-radius:50%;'
      + 'background:#fff;border:1px solid #e0c8f0;display:flex;align-items:center;'
      + 'justify-content:center;cursor:pointer;font-size:16px;font-weight:700;color:#6e0977;margin-right:6px">−</div>'
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
  if(_tsOrderLoading){showStoreToast('Wait for the current table order to load, or reopen it to retry.');return;}
  if (!_tsItems.length) { showStoreToast('Add at least one item'); return; }
  var btn = document.getElementById('ts-send-btn');
  var total = tsCalcTotal();

  var groupPhones;
  try { groupPhones = lcParseGroupPhones((document.getElementById('ts-group-phones') || {}).value || ''); }
  catch(e) { showStoreToast(e.message); return; }
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
      complimentary: !!item.complimentary,
      paidQty: item.paidQty || 0
    };
  });

  try {
    if (_tsExistingOrder) {
      btn.disabled = true; btn.textContent = 'Sending…';
      var updatePayload = { items: JSON.stringify(finalItems), total: total };
      if (phone) updatePayload.customer_phone = phone;
      updatePayload.customer_group_phones = groupPhones;
      var wasReady = _tsExistingOrder.status === 'ready' || _tsExistingOrder.status === 'delivered';
      if (wasReady) updatePayload.status = 'preparing';

      var upd = await db.from('store_orders')
        .update(updatePayload)
        .eq('id', _tsExistingOrder.id);
      if (upd.error) throw upd.error;
      var orderLabel = _tsTableCode || ('#' + (_tsExistingOrder.token || ''));
      showStoreToast(wasReady
        ? '✅ Items added to ' + orderLabel + ' — back to Preparing'
        : '✅ Items added to ' + orderLabel);
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
        customer_group_phones: groupPhones,
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

async function tsSaveGroupPhones(feedback) {
  if (_tsOrderLoading || !_tsExistingOrder) { if(feedback) showStoreToast('Send the new order to Kitchen first.'); return false; }
  try {
    var phones=lcParseGroupPhones((document.getElementById('ts-group-phones') || {}).value || '');
    if(JSON.stringify(phones)!==JSON.stringify(_tsExistingOrder.customer_group_phones || [])) {
      var res=await db.from('store_orders').update({customer_group_phones:phones}).eq('id',_tsExistingOrder.id)
        .not('status','in','(collected,cancelled)').select('id').maybeSingle();
      if(res.error) throw res.error;
      if(!res.data) throw new Error('This bill has closed. Reopen the table to refresh.');
      _tsExistingOrder.customer_group_phones=phones;
    }
    if(feedback) {showStoreToast('Friends saved. Their cards will appear in Kitchen.'); if(typeof kitchenManualRefresh==='function') kitchenManualRefresh();}
    return true;
  } catch(e) {showStoreToast(e.message);return false;}
}

async function tsBillAndClose() {
  if (!_tsExistingOrder) return;
  if(!await tsSaveGroupPhones(false)) return;
  var collected = tsCollectedAmount(tsParseItems(_tsExistingOrder.items));
  var remaining = Math.max(0, Math.round((_tsExistingOrder.total - collected) * 100) / 100);
  openSplitPaymentPicker(_tsExistingOrder.id, remaining, { type: 'table', tableCode: _tsTableCode, fromTablesBoard: true });
}

// ── 5. Kitchen display — show table code instead of token ──────
function renderKitchen(orders, loyaltyMap) {
  loyaltyMap = loyaltyMap || {};
  updateKitchenOrderCountBadge(orders.length);
  var list = document.getElementById('k-list');
  if (!orders.length) { list.innerHTML = '<div class="k-empty">No pending orders</div>'; return; }
  list.innerHTML = orders.map(function (o) {
    var rawItems = o.items;
    var itemsArr = Array.isArray(rawItems) ? rawItems : (typeof rawItems === 'string' ? JSON.parse(rawItems) : []);
    var age = ageStr(o.created_at);
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
          var paidQty = i.complimentary ? i.qty : (i.paidQty || 0);
          var fullyPaid = paidQty >= i.qty;
          var partiallyPaid = paidQty > 0 && !fullyPaid;
          var preparedTag = i.prepared_by
            ? '<span style="font-size:9px;font-weight:700;color:#4ade80;background:rgba(74,222,128,0.12);'
              + 'padding:2px 7px;border-radius:10px;margin-left:6px;flex-shrink:0">✅ ' + i.prepared_by + '</span>'
            : '';
          var compTag = i.complimentary
            ? '<span style="font-size:9px;font-weight:700;color:#b87410;background:rgba(245,196,48,0.15);'
              + 'padding:2px 7px;border-radius:10px;margin-left:6px;flex-shrink:0">🎁 FREE</span>'
            : '';
          var paidTag = fullyPaid && !i.complimentary
            ? '<span style="font-size:9px;font-weight:700;color:#4ade80;background:rgba(74,222,128,0.15);'
              + 'padding:2px 7px;border-radius:10px;margin-left:6px;flex-shrink:0">💰 PAID</span>'
            : partiallyPaid
              ? '<span style="font-size:9px;font-weight:700;color:#f5c430;background:rgba(245,196,48,0.15);'
                + 'padding:2px 7px;border-radius:10px;margin-left:6px;flex-shrink:0">💰 ' + paidQty + '/' + i.qty + ' paid</span>'
              : '';
          var collectBtn = (!i.complimentary && !fullyPaid)
            ? '<span onclick="openItemCollectPicker(\'' + o.id + '\',' + idx + ')" title="Collect payment for this item" '
              + 'style="width:24px;height:24px;border-radius:7px;background:rgba(74,222,128,0.15);'
              + 'border:1px solid rgba(74,222,128,0.35);display:flex;align-items:center;justify-content:center;'
              + 'font-size:12px;cursor:pointer;flex-shrink:0">💰</span>'
            : '';
          var rowBg = fullyPaid && !i.complimentary
            ? 'background:rgba(74,222,128,0.08);border-radius:8px;padding:5px 6px;margin:2px 0'
            : partiallyPaid
              ? 'background:rgba(245,196,48,0.08);border-radius:8px;padding:5px 6px;margin:2px 0'
              : 'padding:5px 0';
          return '<div style="display:flex;align-items:center;gap:9px;' + rowBg + '">'
            + '<span onclick="kToggleItemDelivered(\'' + o.id + '\',' + idx + ')" style="width:18px;height:18px;border-radius:5px;flex-shrink:0;display:flex;'
            + 'align-items:center;justify-content:center;font-size:11px;color:#0c0810;cursor:pointer;'
            + 'border:1.5px solid ' + (delivered ? '#4ade80' : 'rgba(255,255,255,.25)') + ';'
            + 'background:' + (delivered ? '#4ade80' : 'transparent') + '">' + (delivered ? '✓' : '') + '</span>'
            + '<span onclick="kToggleItemDelivered(\'' + o.id + '\',' + idx + ')" style="flex:1;font-size:13px;font-weight:500;cursor:pointer;'
            + 'color:' + (delivered ? 'rgba(245,234,220,.4)' : '#f5eadc') + ';'
            + 'text-decoration:' + (delivered ? 'line-through' : 'none') + '">' + i.name + '</span>'
            + preparedTag
            + compTag
            + paidTag
            + '<span onclick="openItemRecipePopup(\'' + o.id + '\',' + idx + ')" style="width:24px;height:24px;border-radius:7px;'
            + 'background:rgba(245,196,48,0.15);border:1px solid rgba(245,196,48,0.3);display:flex;align-items:center;'
            + 'justify-content:center;font-size:12px;cursor:pointer;flex-shrink:0">📖</span>'
            + collectBtn
            + '<span style="font-size:12px;color:#c084fc;font-weight:700;background:rgba(192,132,252,0.12);'
            + 'border-radius:8px;padding:2px 7px;flex-shrink:0">₹' + (i.price || 0) + '</span>'
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
            + '<span style="font-size:12px;color:#c084fc;font-weight:700;background:rgba(192,132,252,0.12);'
            + 'border-radius:8px;padding:2px 7px;flex-shrink:0;margin-left:8px">₹' + (i.price || 0) + '</span>'
            + '<span style="font-size:12px;color:#f5c430;font-weight:700;flex-shrink:0;margin-left:6px">×' + i.qty + '</span>'
            + '</div>';
        }).join('');

    var primaryAction = kPrimaryActionFor(o);

    // Loyalty card lookup only ever succeeds once loyalty-cards.js's own
    // functions are all defined (same script, same load), so a single
    // guard here covers lcRewardsFor/lcEsc/lcApplyRewardToOrder below too.
    var loyaltyBox = '';
    if (typeof lcOrderPhones === 'function') lcOrderPhones(o).forEach(function(phone) {
      var loyaltyMember=loyaltyMap[lcLast10(phone)];
      if (!loyaltyMember) {
        loyaltyBox += '<div style="padding:8px;color:#c9b5cf">NSDI card ' + lcMaskPhone(phone) + (loyaltyMap._unavailable ? ' · Lookup unavailable; refresh to retry' : ' · No card found') + '</div>';
        return;
      }
      var lcAvailable = lcRewardsFor(loyaltyMember).filter(function (r) { return !loyaltyMember.suspended && r.status === 'available'; });
      loyaltyBox += '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px;'
        + 'background:rgba(121,12,136,0.14);border:1.5px solid rgba(192,132,252,0.35);border-radius:12px;'
        + 'padding:9px 14px;margin-bottom:10px">'
        + '<div><span style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:#c084fc">💳 ' + lcEsc(loyaltyMember.card_code) + '</span>'
        + '<div style="font-size:10.5px;color:rgba(245,234,220,.6);margin-top:2px">' + lcEsc(loyaltyMember.name_pending ? 'Name needed' : loyaltyMember.name) + ' · Day ' + loyaltyMember.stamp_count + '/100 · ' + lcMaskPhone(loyaltyMember.phone) + (loyaltyMember.suspended ? ' · Suspended' : '') + '</div></div>'
        + '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center"><button onclick="lcOpenPhone(&quot;' + lcEsc(loyaltyMember.phone) + '&quot;)" style="background:rgba(192,132,252,0.16);color:#e9d5ff;border:1px solid rgba(192,132,252,0.4);padding:7px 10px;border-radius:8px;font-size:10.5px;font-weight:600;cursor:pointer;white-space:nowrap">' + (loyaltyMember.name_pending ? 'Add name' : 'Edit name / card') + '</button>' + (!(loyaltyMember.schedule || []).length ? '<small style="background:rgba(245,196,48,0.16);color:#f5c430;border:1px solid rgba(245,196,48,0.4);border-radius:8px;padding:6px 10px;font-size:10.5px;font-weight:600;white-space:nowrap">⏳ Rewards pending admin setup</small>' : '') + lcAvailable.map(function (r) {
            return '<button onclick="lcApplyRewardToOrder(\'' + o.id + '\',\'' + loyaltyMember.id + '\',' + r.day + ',\'' + String(r.item).replace(/'/g, "\\'") + '\')" '
              + 'style="background:#c084fc;color:#1a0820;border:none;border-radius:8px;padding:7px 10px;font-size:10.5px;font-weight:700;cursor:pointer;white-space:nowrap">'
              + '🎁 ' + lcEsc(r.item) + '</button>';
          }).join('') + '</div>'
        + '</div>';
    });

    var collectedSoFar = o.table_code ? tsCollectedAmount(itemsArr) : 0;
    var remainingBill = Math.max(0, Math.round(((o.total || 0) - collectedSoFar) * 100) / 100);
    var totalBox = collectedSoFar > 0
      ? '<div style="display:flex;justify-content:space-between;align-items:center;'
        + 'background:linear-gradient(135deg,rgba(74,222,128,0.14),rgba(245,196,48,0.06));'
        + 'border:1.5px solid rgba(74,222,128,0.4);border-radius:12px;padding:10px 14px;margin-bottom:10px">'
        + '<div>'
        + '<div style="font-size:10px;font-weight:700;letter-spacing:2px;color:rgba(74,222,128,0.9)">REMAINING</div>'
        + '<div style="font-size:10.5px;color:rgba(245,234,220,.6);margin-top:2px">💰 ₹' + collectedSoFar + ' collected of ₹' + (o.total || 0) + '</div>'
        + '</div>'
        + '<span style="font-family:Fraunces,Georgia,serif;font-size:26px;font-weight:900;color:#f5c430">₹' + remainingBill + '</span>'
        + '</div>'
      : '<div style="display:flex;justify-content:space-between;align-items:center;'
        + 'background:linear-gradient(135deg,rgba(245,196,48,0.18),rgba(245,196,48,0.06));'
        + 'border:1.5px solid rgba(245,196,48,0.4);border-radius:12px;padding:10px 14px;margin-bottom:10px">'
        + '<span style="font-size:10px;font-weight:700;letter-spacing:2px;color:rgba(245,196,48,0.85)">TOTAL</span>'
        + '<span style="font-family:Fraunces,Georgia,serif;font-size:26px;font-weight:900;color:#f5c430">₹' + (o.total || 0) + '</span>'
        + '</div>';

    return '<div class="k-ticket" id="kt-' + o.id + '" data-s="' + o.status + '">'
      + '<div class="k-top"><div class="k-tok">' + headline + '</div>'
      + '<div class="k-badge">' + o.status.toUpperCase() + '</div>'
      + '<div class="k-age">' + age + '</div></div>'
      + '<div style="font-size:11.5px;color:rgba(245,234,220,.65);margin-bottom:9px;font-weight:600">' + metaLine + payBadge + '</div>'
      + loyaltyBox
      + '<div style="background:rgba(0,0,0,0.22);border-radius:10px;padding:9px 12px;margin-bottom:10px">' + itemsHtml + '</div>'
      + totalBox
      + '<div style="display:flex;gap:8px">'
      + '<button class="k-btn" onclick="' + primaryAction.onclick + '" style="flex:1;padding:12px;'
      + 'background:' + primaryAction.bg + ';border:1.5px solid ' + primaryAction.border + ';'
      + 'color:' + primaryAction.color + ';font-size:12.5px;font-weight:700;border-radius:10px;cursor:pointer">'
      + primaryAction.label + '</button>'
      + '<button onclick="kToggleMoreActions(\'' + o.id + '\')" style="width:42px;flex-shrink:0;border-radius:10px;'
      + 'background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);color:rgba(245,234,220,.6);'
      + 'font-size:16px;cursor:pointer">⋯</button>'
      + '</div>'
      + kMoreActionsRow(o)
      + '</div>';
  }).join('');
}

// Picks the single most relevant next action for an order's current
// stage — replaces the old row of 5-6 equally-weighted buttons. Every
// other action (Print, Cancel, and any alternate path) lives in the
// inline "more actions" row below instead, so one thing is always
// obviously "next."
function kPrimaryActionFor(o) {
  if (o.status === 'pending') {
    return { label: '▶ Start Preparing', onclick: "kBump('" + o.id + "','preparing')",
      bg: 'rgba(255,255,255,.05)', border: 'rgba(255,255,255,.09)', color: 'rgba(255,255,255,.4)' };
  }
  if (o.status === 'preparing') {
    return { label: '✓ Mark Ready', onclick: "kBump('" + o.id + "','ready')",
      bg: 'rgba(192,132,252,.14)', border: 'rgba(192,132,252,.3)', color: '#c084fc' };
  }
  if (o.status === 'ready' && o.table_code) {
    return { label: '🍽️ Mark All Delivered', onclick: "kMarkDelivered('" + o.id + "')",
      bg: 'rgba(74,222,128,.1)', border: 'rgba(74,222,128,.3)', color: '#4ade80' };
  }
  if (o.status === 'ready' && !o.table_code) {
    return { label: '✓ Collected', onclick: "kCollectOrder('" + o.id + "','" + (o.payment_status || 'pending') + "'," + (o.total || 0) + ")",
      bg: 'rgba(74,222,128,.1)', border: 'rgba(74,222,128,.3)', color: '#4ade80' };
  }
  if (o.status === 'delivered' && o.table_code) {
    var remainingA = Math.max(0, Math.round(((o.total || 0) - tsCollectedAmount(tsParseItems(o.items))) * 100) / 100);
    return { label: '💰 Mark Bill Collected', onclick: "openSplitPaymentPicker('" + o.id + "'," + remainingA + ",{type:'table',tableCode:'" + o.table_code + "'})",
      bg: 'rgba(34,197,94,.12)', border: 'rgba(34,197,94,.35)', color: '#15803d' };
  }
  // fallback — shouldn't normally hit this, but keeps a safe default
  return { label: 'Mark Ready', onclick: "kBump('" + o.id + "','ready')",
    bg: 'rgba(255,255,255,.05)', border: 'rgba(255,255,255,.09)', color: 'rgba(255,255,255,.4)' };
}

// ── "More actions" — an inline row built directly into the ticket
// card, hidden by default and toggled by the ⋯ button. No floating or
// fixed-position element at all, so it can never get lost behind other
// tickets or misplaced by scrolling, no matter how many orders are in
// the queue at once — it's just normal, contained document flow.
var _kExpandedOrderId = null;

function kMoreActionsRow(o) {
  var isOpen = _kExpandedOrderId === o.id;
  var items = [];
  items.push({ icon: '✏️', label: 'Add / Edit', color: '#c084fc', onclick: "kOpenOrderEditFromKitchen('" + o.id + "')" });
  if (o.table_code && o.status !== 'delivered') {
    var remainingB = Math.max(0, Math.round(((o.total || 0) - tsCollectedAmount(tsParseItems(o.items))) * 100) / 100);
    items.push({ icon: '💰', label: 'Bill Collected', color: '#4ade80',
      onclick: "openSplitPaymentPicker('" + o.id + "'," + remainingB + ",{type:'table',tableCode:'" + o.table_code + "'})" });
  }
  items.push({ icon: '🖨️', label: 'Print', color: '#f0c96b', onclick: "printStoreInvoice('" + o.id + "')" });
  items.push({ icon: '❌', label: 'Cancel', color: '#f87171', onclick: "kCancelOrder('" + o.id + "')" });

  var buttonsHtml = items.map(function (i) {
    return '<div onclick="' + i.onclick + '" style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;'
      + 'padding:10px 4px;border-radius:9px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);'
      + 'cursor:pointer;font-size:10.5px;font-weight:700;color:' + i.color + '">'
      + '<span style="font-size:15px">' + i.icon + '</span>' + i.label + '</div>';
  }).join('');

  return '<div id="k-more-' + o.id + '" style="display:' + (isOpen ? 'flex' : 'none') + ';gap:6px;margin-top:8px">' + buttonsHtml + '</div>';
}

function kToggleMoreActions(orderId) {
  _kExpandedOrderId = _kExpandedOrderId === orderId ? null : orderId;
  var row = document.getElementById('k-more-' + orderId);
  // Toggle just this one row directly rather than re-rendering the whole
  // list — avoids losing scroll position or interrupting anything else
  // mid-update on a busy Kitchen screen.
  if (row) row.style.display = (_kExpandedOrderId === orderId) ? 'flex' : 'none';
  // Collapse any other order's row that might have been left open.
  document.querySelectorAll('[id^="k-more-"]').forEach(function (el) {
    if (el.id !== 'k-more-' + orderId) el.style.display = 'none';
  });
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

// Small live count badge sitting right next to the "ORDER QUEUE"
// subtitle — updated every time renderKitchen() runs (load, manual
// refresh, realtime updates, and the 15s polling fallback all funnel
// through there, so this always reflects what's actually on screen).
function injectKitchenOrderCountBadge() {
  var attempts = 0;
  var poll = setInterval(function () {
    attempts++;
    var sub = document.querySelector('#pg-kitchen .k-sub');
    var titleEl = document.querySelector('#pg-kitchen .k-title');
    if (sub && sub.parentElement) {
      clearInterval(poll);

      // Give the "Kitchen" title itself a richer, more premium treatment —
      // subtle glow behind the serif type instead of flat white text.
      if (titleEl) {
        titleEl.style.textShadow = '0 0 24px rgba(245,196,48,0.35), 0 0 2px rgba(255,255,255,0.4)';
        titleEl.style.letterSpacing = '.5px';
      }

      if (document.getElementById('k-order-count')) return;

      var badge = document.createElement('div');
      badge.id = 'k-order-count';
      badge.style.cssText = 'display:inline-flex;align-items:center;gap:5px;margin-top:8px;'
        + 'background:linear-gradient(135deg,rgba(245,196,48,0.22),rgba(245,196,48,0.08));'
        + 'border:1px solid rgba(245,196,48,0.4);color:#f5c430;font-size:13px;font-weight:800;'
        + 'letter-spacing:.5px;padding:6px 14px;border-radius:20px;'
        + 'box-shadow:0 0 18px rgba(245,196,48,0.25),inset 0 1px 0 rgba(255,255,255,0.08);'
        + 'font-family:Fraunces,Georgia,serif';
      badge.innerHTML = '🔥 <span id="k-order-count-num">0</span>';
      sub.parentElement.appendChild(badge);
    } else if (attempts >= 20) {
      clearInterval(poll);
    }
  }, 300);
}

function updateKitchenOrderCountBadge(count) {
  var num = document.getElementById('k-order-count-num');
  if (num) num.textContent = count + (count === 1 ? ' order' : ' orders');
}

function injectKitchenRefreshButton() {
  var actionsGroup = kHdrActionsGroup();
  if (!actionsGroup) return;

  var btn = document.createElement('div');
  btn.id = 'kitchen-refresh-btn';
  btn.onclick = kitchenManualRefresh;
  btn.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:8px 14px;'
    + 'border-radius:20px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);'
    + 'color:rgba(245,234,220,.75);font-size:11px;font-weight:700;cursor:pointer;'
    + 'font-family:\'DM Sans\',sans-serif;transition:background .15s';
  btn.onmouseenter = function () { btn.style.background = 'rgba(255,255,255,.12)'; };
  btn.onmouseleave = function () { btn.style.background = 'rgba(255,255,255,.06)'; };
  btn.innerHTML = '<span id="kitchen-refresh-icon" style="display:inline-block">🔄</span> Refresh';

  actionsGroup.appendChild(btn);

  var style = document.createElement('style');
  style.textContent = '@keyframes kitchenRefreshSpin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
  document.head.appendChild(style);
}

// Shared right-side header action group — History, Refresh, and Bookings
// all join this SAME container instead of each inserting into the header
// directly, which was producing the uneven, scattered spacing (and in
// History's case, actually inserting itself before the title entirely).
function kHdrActionsGroup() {
  var kHdr = document.querySelector('#pg-kitchen .k-hdr');
  if (!kHdr) return null;
  return document.getElementById('k-hdr-actions'); // now defined directly in store.html's header markup
}

async function kitchenManualRefresh() {
  await kitchenRefresh(true); // manual tap — show the icon spin + toast
}

// Silent counterpart used by the realtime subscription — same actual
// refresh logic, but no toast on every single live update (which would
// get spammy fast with multiple staff active on Kitchen at once).
async function kitchenSilentRefresh() {
  await kitchenRefresh(false);
}

var _kRefreshPending = null;
var _kRefreshTimer = null;
var _kLastRefresh = 0;

function kitchenIsVisible() {
  var page = document.getElementById('pg-kitchen');
  return !document.hidden && page && page.classList.contains('active');
}

function kitchenRefresh(showFeedback) {
  if (!showFeedback && !kitchenIsVisible()) return Promise.resolve();
  // Collapse event bursts into one trailing refresh, preserving events that
  // arrive while a request is still reading an older database snapshot.
  if (!showFeedback && (_kRefreshPending || Date.now() - _kLastRefresh < 3000)) {
    if (!_kRefreshTimer) _kRefreshTimer = setTimeout(function () {
      _kRefreshTimer = null;
      kitchenRefresh(false);
    }, 3000);
    return _kRefreshPending || Promise.resolve();
  }
  if (_kRefreshPending) return _kRefreshPending;
  if (_kRefreshTimer) { clearTimeout(_kRefreshTimer); _kRefreshTimer = null; }
  _kLastRefresh = Date.now();
  _kRefreshPending = kitchenFetchOrders(showFeedback).finally(function () {
    _kRefreshPending = null;
  });
  return _kRefreshPending;
}

async function kitchenFetchOrders(showFeedback) {
  var icon = document.getElementById('kitchen-refresh-icon');
  if (showFeedback && icon) icon.style.animation = 'kitchenRefreshSpin .6s linear';

  try {
    var today = new Date().toISOString().slice(0, 10);
    var res = await db.from('store_orders')
      .select('*')
      .gte('created_at', today + 'T00:00:00.000Z')
      .in('status', ['pending', 'preparing', 'ready'])
      .order('created_at', { ascending: true });

    if (res.error) throw res.error;
    var orders = res.data || [];
    var loyaltyMap = typeof lcLoyaltyMapFor === 'function' ? await lcLoyaltyMapFor(orders) : {};
    renderKitchen(orders, loyaltyMap);
    if (typeof loadProductionRequests === 'function') loadProductionRequests();
    if (showFeedback) showStoreToast('🔄 Refreshed');
  } catch (e) {
    if (showFeedback) showStoreToast('Refresh error: ' + e.message);
  } finally {
    if (showFeedback && icon) setTimeout(function () { icon.style.animation = ''; }, 600);
  }
}

// ── Polling safety net ──
// Realtime SHOULD keep Kitchen in sync instantly on its own, but if a
// subscription silently misses events (a network hiccup, a connection
// drop that doesn't visibly error, or a Supabase realtime hiccup) new
// orders and status changes stop showing up until something else forces
// a fetch — exactly the "only updates after I manually refresh" symptom.
// Check once a minute when visible. Realtime still supplies prompt updates;
// background browser tabs must not continuously query the database.
var _kPollTimer = null;

function kStartPolling() {
  if (_kPollTimer) return; // already running — never stack multiple intervals
  _kPollTimer = setInterval(function () {
    if (kitchenIsVisible()) {
      kitchenSilentRefresh();
    }
  }, 60000);
}

document.addEventListener('visibilitychange', function () {
  if (kitchenIsVisible()) kitchenSilentRefresh();
});

function kStopPolling() {
  if (_kPollTimer) { clearInterval(_kPollTimer); _kPollTimer = null; }
}

// Starts once, early, and just stays running in the background — the
// interval callback itself checks whether Kitchen is the active page
// each time, so there's no need to start/stop it on every navigation.
(function () {
  var attempts = 0;
  var poll = setInterval(function () {
    attempts++;
    if (typeof isAdmin !== 'undefined' && isAdmin) {
      clearInterval(poll);
      kStartPolling();
    } else if (attempts >= 20) {
      clearInterval(poll);
    }
  }, 300);
})();

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
// Settles whatever is LEFT on the bill (openSplitPaymentPicker is always
// called with the remaining balance, not the raw order total — see
// tsBillAndClose/kPrimaryActionFor/kMoreActionsRow), so this always fully
// closes the order. It merges into any prior item-level partial
// collections (see icFinalize) rather than overwriting them, so per-item
// "Collect" payments made earlier still show up correctly in the final
// payment_split and every item is marked fully paid.
async function spFinalizePayment(splitObj, summaryMethod, breakdownText, cashReceived, changeGiven) {
  try {
    var existing = await db.from('store_orders').select('items, total, payment_split').eq('id', _spOrderId).single();
    if (existing.error) throw existing.error;

    var items = Array.isArray(existing.data.items) ? existing.data.items : JSON.parse(existing.data.items || '[]');
    items.forEach(function (i) { i.paidQty = i.qty; }); // fully settling the order now — every item counts as paid

    var prevSplit = existing.data.payment_split
      ? (typeof existing.data.payment_split === 'string' ? JSON.parse(existing.data.payment_split) : existing.data.payment_split)
      : {};
    var mergedSplit = {};
    Object.keys(prevSplit).forEach(function (k) { mergedSplit[k] = prevSplit[k]; });
    Object.keys(splitObj).forEach(function (k) { mergedSplit[k] = Math.round(((mergedSplit[k] || 0) + splitObj[k]) * 100) / 100; });

    var labels = { cash: 'Cash', upi: 'UPI', upi_qr: 'Scan QR', card: 'Card' };
    var mergedMethods = Object.keys(mergedSplit).filter(function (k) { return mergedSplit[k] > 0; });
    var mergedSummaryMethod = mergedMethods.length === 1 ? mergedMethods[0] : (mergedMethods.length > 1 ? 'split' : summaryMethod);
    var mergedBreakdownText = mergedMethods.map(function (k) { return labels[k] + ' ₹' + mergedSplit[k]; }).join(' + ');

    await db.from('store_orders').update({
      status: 'collected',
      payment_status: 'paid',
      payment_method: mergedSummaryMethod,
      payment_split: JSON.stringify(mergedSplit),
      items: JSON.stringify(items),
      collected_at: new Date().toISOString()
    }).eq('id', _spOrderId);

    var context = _spContext;
    var orderId = _spOrderId;
    closeSplitPaymentPicker();

    var changeNote = (changeGiven && changeGiven > 0) ? (' · Change given: ₹' + changeGiven) : '';
    showStoreToast('✅ Collected · ' + breakdownText + changeNote);
    kitchenManualRefresh();

    // Auto-add the cash portion to the Cash Counter's running balance —
    // no separate manual re-entry needed. Wrapped in its own try/catch so
    // this never blocks the actual payment collection if it fails for
    // any reason (e.g. cash_counter_entries table not set up yet).
    if (splitObj.cash > 0) {
      try {
        var label = context.type === 'table' ? ('Table ' + context.tableCode) : ('Order ' + orderId.slice(0, 8));
        var staffName = (typeof _staffSession !== 'undefined' && _staffSession && _staffSession.name)
          ? _staffSession.name : ((typeof isAdmin !== 'undefined' && isAdmin) ? 'Admin' : null);
        await db.from('cash_counter_entries').insert([{
          entry_type: 'order_payment',
          amount: splitObj.cash,
          note: 'Cash payment — ' + label,
          staff_name: staffName
        }]);
        // If the Cash Counter sheet happens to already be open, refresh it live.
        var ccSheet = document.getElementById('cc-sheet');
        if (ccSheet && ccSheet.style.display === 'block' && typeof loadCashCounter === 'function') loadCashCounter();
      } catch (ccErr) {
        // Cash Counter table may not exist yet — payment itself still succeeded, so stay quiet here.
      }
    }

    if (context.type === 'table') {
      await sendTableBillWhatsApp(orderId, context.tableCode, mergedBreakdownText);
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
// Item-Level Partial Bill Collection — for a shared table where each
// diner pays for their own item(s) instead of one person settling the
// whole table bill at once. Tap 💰 on any item in the Kitchen ticket,
// say how many of that item's quantity is being paid for right now, and
// that amount comes off the table's remaining bill (shown in the
// ticket's REMAINING box) and gets highlighted paid on the item itself.
// Once every item's quantity has been paid for, the order finalizes
// itself exactly like a normal "Bill Collected" — status flips to
// collected and it drops off the Kitchen queue.
// ══════════════════════════════════════════════════════════════
var _icOrderId = null;
var _icItems = [];
var _icSelection = {};
var _icMethod = null;
var _icBusy = false;
var _icSnapshot = null;

function icMoney(value) { return Math.round(Number(value) * 100) / 100; }
function icEscape(value) {
  return String(value).replace(/[&<>"']/g, function(c) {
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function icAmount() {
  return icMoney(Object.keys(_icSelection).reduce(function(sum,index) {
    return sum + _icSelection[index] * Number(_icItems[index].price);
  },0));
}
async function openItemCollectPicker(orderId, itemIndex) {
  if (_icBusy) return;
  try {
    var res = await db.from('store_orders')
      .select('id, items, total, payment_split, payment_method, table_code, customer_phone, status, payment_status')
      .eq('id',orderId).single();
    if (res.error) throw res.error;
    var order=res.data;
    if (!order || !order.table_code || ['collected','cancelled'].includes(order.status) || order.payment_status==='paid') throw new Error('This table is no longer open for collection.');
    var items=Array.isArray(order.items)?order.items:JSON.parse(order.items||'[]');
    order.collected_amount=tsCollectedAmount(items);
    var selected=items[itemIndex];
    if (!selected || selected.complimentary || Number(selected.price)<=0 || Number(selected.qty)-Number(selected.paidQty||0)<=0) throw new Error('This item has no unpaid pieces.');
    closeItemCollectPicker();
    _icOrderId=orderId;
    _icItems=items;
    _icSnapshot=order;
    _icSelection={};
    _icSelection[itemIndex]=Number(selected.qty)-Number(selected.paidQty||0);
    var overlay=document.createElement('div');
    overlay.id='ic-overlay';
    overlay.style.cssText='position:fixed;inset:0;background:rgba(18,10,30,.65);z-index:4400;display:flex;align-items:center;justify-content:center;padding:16px;font-family:Arial,sans-serif';
    overlay.onclick=function(e){if(e.target===overlay)closeItemCollectPicker();};
    overlay.innerHTML='<div id="ic-card" role="dialog" aria-modal="true" aria-labelledby="ic-title" style="background:#fff;color:#261330;border-radius:22px;width:100%;max-width:520px;max-height:90vh;overflow:auto;padding:22px;box-sizing:border-box">'
      +'<h2 id="ic-title" style="margin:0 0 8px">Collect payment · '+icEscape(order.table_code)+'</h2>'
      +'<p style="font-size:14px;color:#786880">Choose pieces from any items below. Collect them together in one payment.</p>'
      +'<div id="ic-items"></div><div style="margin:18px 0;padding:14px;background:#f5eeff;border-radius:12px">Collect now <strong id="ic-amount" style="float:right"></strong><div id="ic-after" style="font-size:12px;margin-top:8px"></div></div>'
      +'<div id="ic-method-body"></div><button onclick="closeItemCollectPicker()" style="width:100%;padding:12px;margin-top:14px;border-radius:12px">Cancel</button></div>';
    document.body.appendChild(overlay);
    icRenderItems();
    icRenderMethodBody();
  } catch(e) { showStoreToast('Error: '+e.message); }
}
function icRenderItems() {
  document.getElementById('ic-items').innerHTML=_icItems.map(function(item,index) {
    var remaining=Math.max(0,Number(item.qty)-Number(item.paidQty||0));
    var eligible=remaining>0 && !item.complimentary && Number(item.price)>0;
    var qty=_icSelection[index]||0;
    return '<div style="padding:12px 0;border-bottom:1px solid #eee;opacity:'+(eligible?'1':'.55')+'">'
      +'<div style="display:flex;align-items:center;gap:10px"><strong style="flex:1">'+icEscape(item.name)+'</strong>'
      +(eligible?'<button aria-label="Remove one '+icEscape(item.name)+'" onclick="icStepQty('+index+',-1)" '+(qty===0?'disabled':'')+'>−</button><span style="min-width:24px;text-align:center">'+qty+'</span><button aria-label="Add one '+icEscape(item.name)+'" onclick="icStepQty('+index+',1)" '+(qty>=remaining?'disabled':'')+'>+</button>':'<span>'+(item.complimentary?'Complimentary':Number(item.price)<=0?'No charge':'Paid')+'</span>')
      +'</div><div style="font-size:12px;color:#786880;margin-top:8px">₹'+icMoney(item.price).toFixed(2)+' each · '+remaining+' unpaid'+(qty?' · Selected ₹'+icMoney(qty*item.price).toFixed(2):'')+'</div></div>';
  }).join('');
  document.getElementById('ic-amount').textContent='₹'+icAmount().toFixed(2);
  document.getElementById('ic-after').textContent='Table balance after payment: ₹'+icMoney(_icSnapshot.total-(_icSnapshot.collected_amount||0)-icAmount()).toFixed(2);
}
function icStepQty(index,delta) {
  if (_icBusy) return;
  var item=_icItems[index];
  if (!item || item.complimentary || Number(item.price)<=0) return;
  _icSelection[index]=Math.max(0,Math.min(Number(item.qty)-Number(item.paidQty||0),(_icSelection[index]||0)+delta));
  if (!_icSelection[index]) delete _icSelection[index];
  _icMethod=null;
  icRenderItems();
  icRenderMethodBody();
}

function icRenderMethodBody() {
  var body = document.getElementById('ic-method-body');
  if (!body) return;
  var methodGrid = Object.keys(SP_METHOD_META).map(function (key) {
    var m = SP_METHOD_META[key];
    var selected = _icMethod === key;
    return '<div onclick="icSelectMethod(\'' + key + '\')" style="padding:14px 8px;border-radius:14px;text-align:center;'
      + 'cursor:pointer;background:' + (selected ? m.color : m.bg) + ';border:1.5px solid ' + m.border + '">'
      + '<div style="font-size:22px;margin-bottom:3px">' + m.icon + '</div>'
      + '<div style="font-size:11px;font-weight:700;color:' + (selected ? '#fff' : m.color) + '">' + m.label + '</div>'
      + '</div>';
  }).join('');

  var cashSection = _icMethod === 'cash'
    ? '<div style="background:#fff8e6;border:1.5px solid rgba(245,196,48,0.4);border-radius:16px;padding:14px;margin-top:12px">'
      + '<div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:#b87410;margin-bottom:8px">AMOUNT RECEIVED</div>'
      + '<input id="ic-cash-received" type="number" inputmode="decimal" placeholder="₹ 0" oninput="icUpdateChange()" '
      + 'style="width:100%;padding:12px;border-radius:12px;border:1.5px solid rgba(245,196,48,0.5);'
      + 'font-family:Fraunces,Georgia,serif;font-size:20px;font-weight:900;text-align:center;color:#1a0820;outline:none;box-sizing:border-box">'
      + '<div id="ic-change-display" style="text-align:center;margin-top:10px;font-size:13px;font-weight:700"></div>'
      + '<button onclick="icConfirmCash()" style="width:100%;padding:13px;margin-top:12px;'
      + 'background:linear-gradient(135deg,#6e0977,#9c0ca1);color:#fff;font-size:13px;font-weight:700;'
      + 'border:none;border-radius:12px;cursor:pointer">✅ Confirm Cash Collect</button>'
      + '</div>'
    : (_icMethod ? '<button onclick="icFinalize(_icMethod,null,null)" style="width:100%;padding:14px;margin-top:12px;background:#6e0977;color:white;border:0;border-radius:12px">Confirm collected ₹' + icAmount().toFixed(2) + '</button>' : '');

  body.innerHTML = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px">' + methodGrid + '</div>' + cashSection;
}

function icSelectMethod(key) {
  if (_icBusy || !SP_METHOD_META[key]) return;
  if (icAmount()<=0) { showStoreToast('Select at least one unpaid piece.'); return; }
  _icMethod=key;
  icRenderMethodBody();
}

function icUpdateChange() {
  var amount = icAmount();
  var received = parseFloat(document.getElementById('ic-cash-received').value) || 0;
  var change = Math.round((received - amount) * 100) / 100;
  var display = document.getElementById('ic-change-display');
  if (received === 0) {
    display.textContent = '';
  } else if (change > 0) {
    display.style.color = '#15803d';
    display.innerHTML = '💰 Change to return: ₹' + change;
  } else if (change < 0) {
    display.style.color = '#dc2626';
    display.textContent = '⚠️ ₹' + Math.abs(change) + ' short';
  } else {
    display.style.color = '#15803d';
    display.textContent = '✅ Exact amount — no change needed';
  }
}

async function icConfirmCash() {
  var amount = icAmount();
  var received = parseFloat(document.getElementById('ic-cash-received').value) || 0;
  if (received < amount) {
    showStoreToast('Cash received must cover ₹' + amount.toFixed(2));
    return;
  }
  var change = Math.max(0, Math.round((received - amount) * 100) / 100);
  await icFinalize('cash', received, change);
}

// Save only if the items, total and status still match the loaded order.
async function icFinalize(method, cashReceived, changeGiven) {
  if (_icBusy || !_icOrderId || !SP_METHOD_META[method] || icAmount()<=0) return;
  _icBusy=true;
  document.getElementById('ic-card').style.pointerEvents='none';
  try {
    var res = await db.from('store_orders')
      .select('items, total, payment_split, table_code, customer_phone, status, payment_status')
      .eq('id', _icOrderId).single();
    if (res.error) throw res.error;

    var items = Array.isArray(res.data.items) ? res.data.items : JSON.parse(res.data.items || '[]');
    if (['collected','cancelled'].includes(res.data.status) || res.data.payment_status==='paid') throw new Error('Order is already closed. Reopen the table.');
    if (Number(res.data.total)!==Number(_icSnapshot.total) || tsCollectedAmount(items)!==Number(_icSnapshot.collected_amount||0) || JSON.stringify(items)!==JSON.stringify(_icItems)) throw new Error('This bill has changed. Close and reopen collection to review it.');
    var amount=icAmount();
    var previouslyCollected=tsCollectedAmount(items);
    var originalItemsFilter=JSON.stringify(res.data.items);
    var selectedNames=[];
    Object.keys(_icSelection).forEach(function(index) {
      var item=items[index],qty=_icSelection[index];
      if (!Number.isInteger(qty) || qty<=0 || item.complimentary || qty>Number(item.qty)-Number(item.paidQty||0)) throw new Error('Selected quantity is no longer available.');
      item.paidQty=Number(item.paidQty||0)+qty;
      selectedNames.push(item.name+' ×'+qty);
    });
    if (amount>icMoney(res.data.total-previouslyCollected)) throw new Error('Selection exceeds the balance. Use Bill Collected for an adjusted bill.');

    var splitObj = res.data.payment_split
      ? (typeof res.data.payment_split === 'string' ? JSON.parse(res.data.payment_split) : res.data.payment_split)
      : {};
    splitObj[method] = Math.round(((splitObj[method] || 0) + amount) * 100) / 100;

    var newCollected = tsCollectedAmount(items);
    var total = res.data.total || 0;
    var remaining = Math.round((total - newCollected) * 100) / 100;

    var labels = { cash: 'Cash', upi: 'UPI', upi_qr: 'Scan QR', card: 'Card' };
    var usedMethods = Object.keys(splitObj).filter(function (k) { return splitObj[k] > 0; });
    var summaryMethod = usedMethods.length === 1 ? usedMethods[0] : (usedMethods.length > 1 ? 'split' : method);
    var breakdownText = usedMethods.map(function (k) { return labels[k] + ' ₹' + splitObj[k]; }).join(' + ');

    var updatePayload = {
      items: JSON.stringify(items),
      payment_split: JSON.stringify(splitObj),
      payment_method: summaryMethod
    };

    var fullyClosed = remaining === 0;
    if (fullyClosed) {
      updatePayload.status = 'collected';
      updatePayload.payment_status = 'paid';
      updatePayload.collected_at = new Date().toISOString();
    }

    var write=db.from('store_orders').update(updatePayload).eq('id',_icOrderId).eq('total',res.data.total).eq('status',res.data.status);
    write=write.filter('items','eq',originalItemsFilter);
    var upd=await write.select('id');
    if (upd.error) throw upd.error;
    if (!upd.data || upd.data.length!==1) throw new Error('Payment was not saved: the bill changed or access was denied. Refresh before collecting.');

    var orderId = _icOrderId;
    var tableCode = res.data.table_code;
    _icBusy=false;
    closeItemCollectPicker();

    var m = SP_METHOD_META[method];
    var changeNote = (changeGiven && changeGiven > 0) ? (' · Change: ₹' + changeGiven) : '';
    showStoreToast(fullyClosed
      ? '✅ ' + (tableCode || 'Order') + ' fully paid — closed & cleared from Kitchen'
      : '💰 Collected ₹' + amount + ' (' + m.label + ')' + changeNote + ' · ₹' + Math.max(0, remaining) + ' left');
    kitchenManualRefresh();

    if (method === 'cash') {
      try {
        var staffName = (typeof _staffSession !== 'undefined' && _staffSession && _staffSession.name)
          ? _staffSession.name : ((typeof isAdmin !== 'undefined' && isAdmin) ? 'Admin' : null);
        await db.from('cash_counter_entries').insert([{
          entry_type: 'order_payment',
          amount: amount,
          note: 'Cash payment — ' + selectedNames.join(', ') + (tableCode ? (' — Table ' + tableCode) : ''),
          staff_name: staffName
        }]);
        var ccSheet = document.getElementById('cc-sheet');
        if (ccSheet && ccSheet.style.display === 'block' && typeof loadCashCounter === 'function') loadCashCounter();
      } catch (ccErr) {
        // Cash Counter table may not exist yet — payment itself still succeeded.
      }
    }

    if (fullyClosed && tableCode) {
      await sendTableBillWhatsApp(orderId, tableCode, breakdownText);
    }
  } catch (e) {
    showStoreToast('Error: ' + e.message);
  } finally {
    _icBusy=false;
    var card=document.getElementById('ic-card');
    if(card)card.style.pointerEvents='';
  }
}

function closeItemCollectPicker() {
  if (_icBusy) return;
  var el = document.getElementById('ic-overlay');
  if (el) el.remove();
  _icOrderId = null;
  _icSelection = {};
  _icItems = [];
  _icSnapshot = null;
  _icMethod = null;
}

// ══════════════════════════════════════════════════════════════
// Kitchen Order History — modern slide-in drawer from the left,
// showing today's completed/cancelled orders. Each entry expands to
// show full item details on tap.
// ══════════════════════════════════════════════════════════════
var _khOpen = false;
var _khExpandedId = null;

function _khInit() {
  buildKitchenHistoryDrawer();
  injectKitchenHistoryButton();
}
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _khInit); } else { _khInit(); }

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
    var actionsGroup = kHdrActionsGroup();
    if (actionsGroup) {
      clearInterval(poll);
      if (document.getElementById('kitchen-history-btn')) return;

      var btn = document.createElement('div');
      btn.id = 'kitchen-history-btn';
      btn.onclick = toggleKitchenHistory;
      btn.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:8px 14px;'
        + 'border-radius:20px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);'
        + 'color:rgba(245,234,220,.75);font-size:11px;font-weight:700;cursor:pointer;'
        + 'font-family:\'DM Sans\',sans-serif;transition:background .15s';
      btn.onmouseenter = function () { btn.style.background = 'rgba(255,255,255,.12)'; };
      btn.onmouseleave = function () { btn.style.background = 'rgba(255,255,255,.06)'; };
      btn.innerHTML = '📋 History';
      actionsGroup.appendChild(btn); // was inserting before the title entirely — now joins the same right-side group
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
var _khCachedLoyaltyMap = {};

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
  _khCachedLoyaltyMap = typeof lcLoyaltyMapFor === 'function' ? await lcLoyaltyMapFor(_khCachedOrders) : {};
  renderKitchenHistory(_khCachedOrders, _khCachedLoyaltyMap);
}

// Every loyalty card tied to an order's customer/group phones — a table
// of friends can each hold their own card, so this can be more than one.
function khLoyaltyCardsFor(o, loyaltyMap) {
  if (!loyaltyMap || loyaltyMap._unavailable || typeof lcOrderPhones !== 'function') return [];
  var seen = {};
  var cards = [];
  lcOrderPhones(o).forEach(function (phone) {
    var m = loyaltyMap[lcLast10(phone)];
    if (m && !seen[m.id]) { seen[m.id] = true; cards.push(m); }
  });
  return cards;
}

function renderKitchenHistory(orders, loyaltyMap) {
  loyaltyMap = loyaltyMap || _khCachedLoyaltyMap || {};
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

    var custBits = [];
    if (o.customer_name) custBits.push('🙋 ' + lcEsc(o.customer_name));
    if (o.customer_phone) custBits.push('📞 ' + lcEsc(o.customer_phone));
    if (Array.isArray(o.customer_group_phones) && o.customer_group_phones.length) {
      custBits.push('👥 +' + o.customer_group_phones.length + ' friend' + (o.customer_group_phones.length === 1 ? '' : 's'));
    }
    var custLine = custBits.length
      ? '<div style="font-size:11px;color:rgba(245,234,220,.5);margin-top:4px">' + custBits.join('  ·  ') + '</div>'
      : '';

    // A group order can carry more than one loyalty card — one per
    // friend on the table — so this shows every distinct card found,
    // not just the primary customer's.
    var loyaltyCards = khLoyaltyCardsFor(o, loyaltyMap);
    var loyaltyChips = loyaltyCards.length
      ? '<div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:6px">' + loyaltyCards.map(function (m) {
          var cycleLen = (m.schedule || []).length ? Math.max.apply(null, m.schedule.map(function (s) { return s.day; })) : 100;
          return '<span style="display:inline-flex;align-items:center;gap:4px;background:rgba(192,132,252,0.14);'
            + 'border:1px solid rgba(192,132,252,0.35);color:#e9d5ff;border-radius:20px;padding:4px 10px;'
            + 'font-size:10px;font-weight:600;white-space:nowrap">💳 ' + lcEsc(m.card_code) + ' · Day ' + m.stamp_count + '/' + cycleLen + '</span>';
        }).join('') + '</div>'
      : '';

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
      + custLine
      + loyaltyChips
      + '<div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px">'
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
  renderKitchenHistory(_khCachedOrders, _khCachedLoyaltyMap); // re-render from cache, no need to re-fetch just to toggle
}

// ══════════════════════════════════════════════════════════════
// New Order Sound Alert — Admin gets a loud, distinctive chime +
// toast the moment ANY new order lands (table, walk-in, or customer
// self-checkout), even if they're on a different tab of the app.
// Uses a generated tone (Web Audio API) instead of an audio file —
// no external file to host, loads instantly, works offline.
// ══════════════════════════════════════════════════════════════
var _noaCh = null;

function _noaInit() {
  waitForAdminThenSubscribeOrderAlerts();
}
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _noaInit); } else { _noaInit(); }

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
