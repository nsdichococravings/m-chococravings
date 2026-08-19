/**
 * display-stock-patch.js — ChocoCravings On Store
 * Feature: Display Counter Stock (finished goods, not raw ingredients).
 *
 *  - Morning Count: staff walk the counter once a day, enter what's
 *    actually sitting there per menu item, save.
 *  - Live Stock: color-coded view of current counts, auto-decremented
 *    by a DATABASE TRIGGER (see create-display-stock-tables.sql)
 *    whenever ANY order — self-checkout, staff Place Order, or Tables —
 *    includes that item. Also auto-restored if an order is cancelled.
 *  - Production Requests: counter staff flag low/out items; requests
 *    show up on the Kitchen page for baking staff to fulfill, which
 *    restocks the display count automatically.
 *
 * Load AFTER store-patch.js, right before </body>:
 *   <script src="display-stock-patch.js"></script>
 *
 * Requires DB setup: run create-display-stock-tables.sql once in Supabase.
 * Requires: `db`, `MENU`, `showStoreToast()` — already global on this page.
 */

var _dsItems = {};          // item_name -> display_stock row
var _dsPendingRequests = {}; // item_name -> true if a pending request already exists
var _dsCh = null;

document.addEventListener('DOMContentLoaded', function () {
  injectDisplayStockMenuEntry();
  buildDisplayStockUI();
  injectProductionRequestsIntoKitchen();
  waitForMenuThenBadge();
  subscribeNewMenuItems();
});

// Listens for new rows in store_menu directly at the database level — this
// means a brand-new item shows up in display_stock the instant it's saved,
// no matter which admin flow created it (Manage Menu, Quick Add, or any
// future one), without needing to reopen Display Stock first.
var _dsMenuCh = null;
function subscribeNewMenuItems() {
  var wait = setInterval(function () {
    if (typeof db === 'undefined' || !db) return;
    clearInterval(wait);
    if (_dsMenuCh) { try { db.removeChannel(_dsMenuCh); } catch (e) {} }
    _dsMenuCh = db.channel('display-stock-menu-sync')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'store_menu' }, async function (payload) {
        var row = payload.new;
        if (!row || !row.name) return;
        try {
          var existing = await db.from('display_stock').select('id').eq('item_name', row.name).maybeSingle();
          if (!existing.data) {
            await db.from('display_stock').insert([{
              item_name: row.name, category: row.category, current_stock: 0, low_stock_threshold: 5
            }]);
            refreshDsBadge();
            // If Display Stock happens to be open right now, refresh whichever tab is showing.
            var sheet = document.getElementById('ds-sheet');
            if (sheet && sheet.style.display === 'block') {
              if (_dsTab === 'morning') loadMorningCount(); else loadLiveStock();
            }
          }
        } catch (e) {}
      })
      .subscribe();
  }, 300);
}

function currentLogName() {
  if (typeof _staffSession !== 'undefined' && _staffSession && _staffSession.name) return _staffSession.name;
  if (typeof isAdmin !== 'undefined' && isAdmin) return 'Admin';
  return null;
}

function waitForMenuThenBadge() {
  var attempts = 0;
  var poll = setInterval(function () {
    attempts++;
    var hasItems = typeof MENU !== 'undefined' && Object.keys(MENU).some(function (c) { return MENU[c].items.length; });
    if (hasItems || attempts >= 15) {
      clearInterval(poll);
      refreshDsBadge();
    }
  }, 400);
}

// ══════════════════════════════════════════════════════════════
// Admin FAB entry + badge
// ══════════════════════════════════════════════════════════════
function injectDisplayStockMenuEntry() {
  var fabMenu = document.getElementById('admin-fab-menu');
  if (!fabMenu) return;

  var entry = document.createElement('div');
  entry.onclick = function () { openDisplayStock(); closeAdminMenu(); };
  entry.style.cssText = 'display:flex;align-items:center;gap:10px;padding:13px 16px;'
    + 'cursor:pointer;transition:background .15s;border-bottom:1px solid #f5f0f8';
  entry.onmouseover = function () { entry.style.background = '#f5eeff'; };
  entry.onmouseout  = function () { entry.style.background = 'transparent'; };
  entry.innerHTML =
      '<div style="width:32px;height:32px;border-radius:8px;background:rgba(110,9,119,0.1);'
    + 'display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">🖥️</div>'
    + '<div style="flex:1">'
    +   '<div style="font-size:13px;font-weight:600;color:#1a0820">Display Stock</div>'
    +   '<div style="font-size:11px;color:#9c0ca1;margin-top:1px">Counter stock & requests</div>'
    + '</div>'
    + '<div id="ds-menu-badge" style="display:none;background:#dc2626;color:#fff;font-size:10px;'
    + 'font-weight:700;padding:2px 7px;border-radius:20px">0</div>';

  fabMenu.appendChild(entry);
}

async function refreshDsBadge() {
  try {
    var res = await db.from('display_stock').select('current_stock, low_stock_threshold');
    var rows = res.data || [];
    var count = rows.filter(function (r) { return r.low_stock_threshold > 0 && r.current_stock <= r.low_stock_threshold; }).length;
    var badge = document.getElementById('ds-menu-badge');
    if (badge) {
      badge.textContent = count;
      badge.style.display = count > 0 ? 'inline-block' : 'none';
    }
  } catch (e) {}
}

// ══════════════════════════════════════════════════════════════
// Main sheet — tabs: Morning Count / Live Stock
// ══════════════════════════════════════════════════════════════
var _dsTab = 'morning';

function buildDisplayStockUI() {
  var overlay = document.createElement('div');
  overlay.id = 'ds-overlay';
  overlay.onclick = closeDisplayStock;
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);'
    + 'z-index:3600;backdrop-filter:blur(4px)';
  document.body.appendChild(overlay);

  var sheet = document.createElement('div');
  sheet.id = 'ds-sheet';
  sheet.style.cssText = 'display:none;position:fixed;bottom:0;left:0;right:0;background:#fff;'
    + 'border-radius:22px 22px 0 0;border-top:1px solid #e8d0f0;z-index:3601;'
    + 'padding:0 0 28px;font-family:\'DM Sans\',sans-serif;max-height:90vh;overflow-y:auto';
  sheet.innerHTML =
      '<div style="width:40px;height:4px;border-radius:2px;background:#ddd0ea;margin:14px auto 0"></div>'
    + '<div style="padding:16px 20px 12px;border-bottom:1px solid #f0e8f8;display:flex;'
    +   'align-items:center;justify-content:space-between">'
    +   '<div style="font-size:18px;font-weight:700;color:#1a0820">Display Counter Stock</div>'
    +   '<div onclick="closeDisplayStock()" style="width:34px;height:34px;border-radius:50%;'
    +     'background:#f5eeff;border:1px solid #e0c8f0;display:flex;align-items:center;'
    +     'justify-content:center;cursor:pointer;font-size:14px;color:#6e0977">✕</div>'
    + '</div>'
    + '<div style="display:flex;gap:6px;padding:14px 20px 0">'
    +   '<div id="ds-tab-morning" onclick="dsSetTab(\'morning\')" style="flex:1;padding:9px;'
    +     'border-radius:10px;text-align:center;font-size:11px;font-weight:700;cursor:pointer;'
    +     'background:#120a1e;color:#fff">🌅 Morning Count</div>'
    +   '<div id="ds-tab-live" onclick="dsSetTab(\'live\')" style="flex:1;padding:9px;'
    +     'border-radius:10px;text-align:center;font-size:11px;font-weight:700;cursor:pointer;'
    +     'border:1.5px solid rgba(18,10,30,0.1);color:#9a8aaa">📊 Live Stock</div>'
    + '</div>'
    + '<div id="ds-body" style="padding:14px 20px 0"></div>';
  document.body.appendChild(sheet);
}

function openDisplayStock() {
  document.getElementById('ds-overlay').style.display = 'block';
  document.getElementById('ds-sheet').style.display   = 'block';
  dsSetTab('morning');
}
function closeDisplayStock() {
  document.getElementById('ds-overlay').style.display = 'none';
  document.getElementById('ds-sheet').style.display   = 'none';
}

function dsSetTab(tab) {
  _dsTab = tab;
  document.getElementById('ds-tab-morning').style.background = tab === 'morning' ? '#120a1e' : 'transparent';
  document.getElementById('ds-tab-morning').style.color      = tab === 'morning' ? '#fff' : '#9a8aaa';
  document.getElementById('ds-tab-morning').style.border     = tab === 'morning' ? 'none' : '1.5px solid rgba(18,10,30,0.1)';
  document.getElementById('ds-tab-live').style.background    = tab === 'live' ? '#120a1e' : 'transparent';
  document.getElementById('ds-tab-live').style.color         = tab === 'live' ? '#fff' : '#9a8aaa';
  document.getElementById('ds-tab-live').style.border        = tab === 'live' ? 'none' : '1.5px solid rgba(18,10,30,0.1)';

  if (tab === 'morning') loadMorningCount();
  else loadLiveStock();
}

// ══════════════════════════════════════════════════════════════
// Morning Count tab
// ══════════════════════════════════════════════════════════════
async function ensureDisplayStockRows() {
  var res = await db.from('display_stock').select('item_name');
  var existing = {};
  (res.data || []).forEach(function (r) { existing[r.item_name] = true; });

  var toInsert = [];
  Object.keys(MENU).forEach(function (cat) {
    MENU[cat].items.forEach(function (item) {
      if (!existing[item.name]) {
        toInsert.push({ item_name: item.name, category: cat, current_stock: 0, low_stock_threshold: 5 });
      }
    });
  });
  if (toInsert.length) {
    await db.from('display_stock').insert(toInsert);
  }
}

async function loadMorningCount() {
  var body = document.getElementById('ds-body');
  body.innerHTML = '<div style="text-align:center;padding:30px;color:#b090c0;font-size:12px">Loading…</div>';

  await ensureDisplayStockRows();
  var res = await db.from('display_stock').select('*').order('category').order('item_name');
  var rows = res.data || [];
  _dsItems = {};
  rows.forEach(function (r) { _dsItems[r.item_name] = r; });

  var today = new Date().toISOString().slice(0, 10);
  var countedToday = rows.some(function (r) { return r.last_counted_at && r.last_counted_at.slice(0, 10) === today; });
  var latestCount = rows.filter(function (r) { return r.last_counted_at; })
    .sort(function (a, b) { return new Date(b.last_counted_at) - new Date(a.last_counted_at); })[0];

  var bannerHtml = countedToday
    ? '<div style="background:rgba(34,197,94,0.08);border:1.5px solid rgba(34,197,94,0.35);border-radius:14px;'
      + 'padding:12px 14px;font-size:12px;color:#15803d;margin-bottom:14px;line-height:1.5">✅ Counted today'
      + (latestCount ? ' at ' + new Date(latestCount.last_counted_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
          + (latestCount.last_counted_by ? ' by ' + latestCount.last_counted_by : '') : '')
      + ' — you can still adjust and re-save if needed.</div>'
    : '<div style="background:#fff8e6;border:1.5px solid #f5c430;border-radius:14px;padding:12px 14px;'
      + 'font-size:12px;color:#8a6a1a;margin-bottom:14px;line-height:1.5">⚠️ Not counted yet today — go through '
      + 'every item below and enter what\'s actually on the counter right now.</div>';

  var listHtml = '';
  var categories = Object.keys(MENU).filter(function (c) { return MENU[c].items.length; });
  categories.forEach(function (cat) {
    var itemsInCat = MENU[cat].items;
    if (!itemsInCat.length) return;
    listHtml += '<div style="font-size:10px;letter-spacing:2px;color:#c2607a;font-weight:700;margin:14px 0 8px">' + cat.toUpperCase() + '</div>';
    itemsInCat.forEach(function (item) {
      var row = _dsItems[item.name] || { current_stock: 0 };
      listHtml += '<div style="display:flex;align-items:center;justify-content:space-between;background:#fff;'
        + 'border:1.5px solid #e0c8f0;border-radius:12px;padding:10px 14px;margin-bottom:8px">'
        + '<div style="font-size:13px;font-weight:600;color:#1a0820;flex:1">' + item.name + '</div>'
        + '<input class="ds-count-input" data-name="' + item.name.replace(/"/g, '&quot;') + '" type="number" '
        + 'value="' + row.current_stock + '" style="width:70px;padding:8px 10px;border-radius:9px;'
        + 'border:1.5px solid rgba(18,10,30,0.15);text-align:center;font-size:14px;font-weight:700;color:#6e0977">'
        + '</div>';
    });
  });

  body.innerHTML = bannerHtml + listHtml
    + '<button onclick="saveMorningCount()" style="width:100%;padding:15px;background:linear-gradient(135deg,'
    + '#6e0977,#9c0ca1);color:#fff;font-size:13px;font-weight:700;border:none;border-radius:14px;cursor:pointer;'
    + 'letter-spacing:.5px;margin:6px 0 4px">✅ Save & Complete Today\'s Count</button>';
}

async function saveMorningCount() {
  var inputs = document.querySelectorAll('.ds-count-input');
  var now = new Date().toISOString();
  var loggedBy = currentLogName();

  var updates = [];
  inputs.forEach(function (inp) {
    var name = inp.getAttribute('data-name');
    var val = parseInt(inp.value);
    if (isNaN(val)) val = 0;
    updates.push({ name: name, stock: val });
  });

  try {
    for (var i = 0; i < updates.length; i++) {
      await db.from('display_stock').update({
        current_stock: updates[i].stock,
        last_counted_at: now,
        last_counted_by: loggedBy
      }).eq('item_name', updates[i].name);
    }
    showStoreToast('✅ Morning count saved for ' + updates.length + ' items');
    refreshDsBadge();
    loadMorningCount();
  } catch (e) {
    showStoreToast('Error: ' + e.message);
  }
}

// ══════════════════════════════════════════════════════════════
// Live Stock tab
// ══════════════════════════════════════════════════════════════
async function loadLiveStock() {
  var body = document.getElementById('ds-body');
  body.innerHTML = '<div style="text-align:center;padding:30px;color:#b090c0;font-size:12px">Loading…</div>';

  await ensureDisplayStockRows();
  var res = await db.from('display_stock').select('*').order('category').order('item_name');
  var rows = res.data || [];

  var reqRes = await db.from('production_requests').select('item_name').eq('status', 'pending');
  _dsPendingRequests = {};
  (reqRes.data || []).forEach(function (r) { _dsPendingRequests[r.item_name] = true; });

  if (!rows.length) {
    body.innerHTML = '<div style="text-align:center;padding:30px;color:#b090c0;font-size:13px">'
      + 'No items yet — open Morning Count first to sync your menu.</div>';
    return;
  }

  body.innerHTML = rows.map(function (item) {
    var trackAlerts = item.low_stock_threshold > 0;
    var isOut = trackAlerts && item.current_stock <= 0;
    var isLow = trackAlerts && !isOut && item.current_stock <= item.low_stock_threshold;
    var status = isOut ? 'out' : (isLow ? 'low' : 'ok');
    var color = isOut ? '#dc2626' : (isLow ? '#f59e0b' : '#15803d');
    var bg = isOut ? 'rgba(220,38,38,0.06)' : (isLow ? 'rgba(245,158,11,0.06)' : '#fff');
    var border = isOut ? 'rgba(220,38,38,0.25)' : (isLow ? 'rgba(245,158,11,0.3)' : '#e0c8f0');
    var statusTxt = isOut ? '⚠️ OUT OF STOCK' : (isLow ? '⚠️ LOW STOCK' : '');

    var reqBtn = '';
    if (status !== 'ok') {
      reqBtn = _dsPendingRequests[item.item_name]
        ? '<button disabled style="width:100%;padding:9px;border-radius:9px;font-size:11px;font-weight:700;'
          + 'background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);color:#15803d">✓ Requested from Production</button>'
        : '<button onclick="requestProduction(\'' + item.item_name.replace(/'/g, "\\'") + '\',' + item.low_stock_threshold + ')" '
          + 'style="width:100%;padding:9px;border-radius:9px;font-size:11px;font-weight:700;cursor:pointer;'
          + 'background:rgba(110,9,119,0.1);border:1px solid rgba(110,9,119,0.3);color:#6e0977">📤 Request Production</button>';
    }

    return '<div style="background:' + bg + ';border:1.5px solid ' + border + ';border-radius:14px;padding:14px;margin-bottom:10px">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">'
      + '<div><div style="font-size:14px;font-weight:700;color:#1a0820">' + item.item_name + '</div>'
      + (statusTxt ? '<div style="font-size:9px;font-weight:700;color:' + color + ';letter-spacing:1px;margin-top:2px">' + statusTxt + '</div>' : '')
      + '</div>'
      + '<div style="font-family:Fraunces,Georgia,serif;font-size:22px;font-weight:900;color:' + color + '">' + item.current_stock + ' <span style="font-size:11px;font-weight:600;color:#9a8aaa">pcs</span></div>'
      + '</div>' + reqBtn + '</div>';
  }).join('');
}

async function requestProduction(itemName, suggestedThreshold) {
  var suggested = (suggestedThreshold || 5) + 5;
  var qtyStr = prompt('How many "' + itemName + '" should production make?', suggested);
  if (qtyStr === null) return;
  var qty = parseInt(qtyStr);
  if (isNaN(qty) || qty <= 0) { showStoreToast('Enter a valid quantity'); return; }

  try {
    await db.from('production_requests').insert([{
      item_name: itemName,
      quantity_requested: qty,
      status: 'pending',
      requested_by: currentLogName()
    }]);
    showStoreToast('📤 Requested ' + qty + ' × ' + itemName + ' from production');
    loadLiveStock();
  } catch (e) {
    showStoreToast('Error: ' + e.message);
  }
}

// ══════════════════════════════════════════════════════════════
// Production requests shown on the Kitchen page
// ══════════════════════════════════════════════════════════════
function injectProductionRequestsIntoKitchen() {
  var kHdr = document.querySelector('#pg-kitchen .k-hdr');
  if (!kHdr) return;
  var container = document.createElement('div');
  container.id = 'prod-requests-container';
  container.style.cssText = 'padding:12px 14px 0';
  container.innerHTML =
      '<div style="font-size:10px;letter-spacing:3px;color:rgba(245,234,220,.4);font-weight:700;margin-bottom:10px">'
    + '🔔 PRODUCTION REQUESTS</div>'
    + '<div id="prod-requests-list"></div>';
  kHdr.insertAdjacentElement('afterend', container);

  var kitchenFab = document.getElementById('kitchen-fab');
  if (kitchenFab) kitchenFab.addEventListener('click', loadProductionRequests);

  if (window.location.hash === '#pg-kitchen') loadProductionRequests();
  subscribeProductionRequests();
}

async function loadProductionRequests() {
  var list = document.getElementById('prod-requests-list');
  if (!list) return;
  var res = await db.from('production_requests').select('*').eq('status', 'pending').order('requested_at', { ascending: false });
  renderProductionRequests(res.data || []);
}

function renderProductionRequests(rows) {
  var list = document.getElementById('prod-requests-list');
  var container = document.getElementById('prod-requests-container');
  if (!list) return;
  if (!rows.length) {
    container.style.display = 'none';
    return;
  }
  container.style.display = 'block';
  list.innerHTML = rows.map(function (r) {
    var age = ageStr(r.requested_at);
    return '<div style="background:rgba(110,9,119,.16);border:1px solid rgba(110,9,119,.45);border-left:4px solid #6e0977;'
      + 'border-radius:14px;padding:13px;margin-bottom:10px">'
      + '<div style="display:flex;align-items:center;margin-bottom:6px">'
      + '<div style="font-family:Fraunces,Georgia,serif;font-size:18px;font-weight:900;color:#f5eadc">' + r.item_name + '</div>'
      + '<div style="margin-left:8px;background:rgba(192,132,252,.15);border:1px solid rgba(192,132,252,.3);'
      + 'border-radius:20px;padding:2px 9px;font-size:9px;font-weight:700;letter-spacing:1px;color:#c084fc">NEEDED</div>'
      + '<div style="margin-left:auto;font-size:10px;color:rgba(255,255,255,.25)">' + age + '</div></div>'
      + '<div style="font-size:11px;color:rgba(245,234,220,.5);margin-bottom:10px">Requested qty: ' + r.quantity_requested
      + ' pcs' + (r.requested_by ? ' · by ' + r.requested_by : '') + '</div>'
      + '<button onclick="fulfillProductionRequest(\'' + r.id + '\',\'' + r.item_name.replace(/'/g, "\\'") + '\',' + r.quantity_requested + ')" '
      + 'style="width:100%;padding:10px;border-radius:9px;background:rgba(74,222,128,.1);border:1px solid rgba(74,222,128,.3);'
      + 'color:#4ade80;font-size:12px;font-weight:700;cursor:pointer">✅ Mark Fulfilled — restocks display automatically</button>'
      + '</div>';
  }).join('');
}

async function fulfillProductionRequest(id, itemName, qty) {
  try {
    await db.from('production_requests').update({
      status: 'fulfilled', fulfilled_at: new Date().toISOString(), fulfilled_by: currentLogName()
    }).eq('id', id);

    var current = await db.from('display_stock').select('current_stock').eq('item_name', itemName).maybeSingle();
    var newStock = (current.data ? current.data.current_stock : 0) + qty;
    await db.from('display_stock').update({ current_stock: newStock, updated_at: new Date().toISOString() }).eq('item_name', itemName);

    showStoreToast('✅ ' + itemName + ' restocked +' + qty);
    loadProductionRequests();
    refreshDsBadge();
  } catch (e) {
    showStoreToast('Error: ' + e.message);
  }
}

function subscribeProductionRequests() {
  if (_dsCh) { try { db.removeChannel(_dsCh); } catch (e) {} }
  _dsCh = db.channel('production-requests-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'production_requests' }, function () {
      loadProductionRequests();
    })
    .subscribe();
}
