/**
 * inventory-patch.js — ChocoCravings On Store
 * Feature: Phase 1 Inventory Management — digital replacement for
 * paper-based ingredient tracking. Manual stock tracking + low-stock
 * alerts. (Phase 2 — auto-deduction from recipes — is a separate,
 * later build.)
 *
 * Load AFTER store-patch.js, right before </body>:
 *   <script src="inventory-patch.js"></script>
 *
 * Requires DB setup: run create-inventory-tables.sql once in Supabase.
 * Requires: `db`, `showStoreToast()` — already global on this page.
 * Uses `_staffSession` (from staff-order-patch.js) and `isAdmin` (from
 * store.html core) if present, to attribute who logged each movement —
 * both optional, falls back gracefully if either isn't loaded.
 */

var _invLowStockCount = 0;
var _invItems = [];

document.addEventListener('DOMContentLoaded', function () {
  injectInventoryMenuEntry();
  buildInventoryUI();
  refreshLowStockBadge();
});

function currentLogName() {
  if (typeof _staffSession !== 'undefined' && _staffSession && _staffSession.name) return _staffSession.name;
  if (typeof isAdmin !== 'undefined' && isAdmin) return 'Admin';
  return null;
}

// ══════════════════════════════════════════════════════════════
// Admin FAB entry with low-stock badge
// ══════════════════════════════════════════════════════════════
function injectInventoryMenuEntry() {
  var fabMenu = document.getElementById('admin-fab-menu');
  if (!fabMenu) return;

  var entry = document.createElement('div');
  entry.id = 'invtry-menu-entry';
  entry.onclick = function () { openInventory(); closeAdminMenu(); };
  entry.style.cssText = 'display:flex;align-items:center;gap:10px;padding:13px 16px;'
    + 'cursor:pointer;transition:background .15s;border-bottom:1px solid #f5f0f8';
  entry.onmouseover = function () { entry.style.background = '#f5eeff'; };
  entry.onmouseout  = function () { entry.style.background = 'transparent'; };
  entry.innerHTML =
      '<div style="width:32px;height:32px;border-radius:8px;background:rgba(110,9,119,0.1);'
    + 'display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">📦</div>'
    + '<div style="flex:1">'
    +   '<div style="font-size:13px;font-weight:600;color:#1a0820">Inventory</div>'
    +   '<div style="font-size:11px;color:#9c0ca1;margin-top:1px">Ingredient stock</div>'
    + '</div>'
    + '<div id="invtry-menu-badge" style="display:none;background:#dc2626;color:#fff;font-size:10px;'
    + 'font-weight:700;padding:2px 7px;border-radius:20px">0</div>';

  fabMenu.appendChild(entry);
}

async function refreshLowStockBadge() {
  try {
    var res = await db.from('inventory_items').select('id, current_stock, low_stock_threshold');
    var items = res.data || [];
    _invLowStockCount = items.filter(function (i) { return i.current_stock <= i.low_stock_threshold; }).length;
    var badge = document.getElementById('invtry-menu-badge');
    if (badge) {
      badge.textContent = _invLowStockCount;
      badge.style.display = _invLowStockCount > 0 ? 'inline-block' : 'none';
    }
  } catch (e) { /* db may not be ready yet on first call — safe to ignore */ }
}

// ══════════════════════════════════════════════════════════════
// Main Inventory sheet
// ══════════════════════════════════════════════════════════════
function buildInventoryUI() {
  var overlay = document.createElement('div');
  overlay.id = 'invtry-overlay';
  overlay.onclick = closeInventory;
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);'
    + 'z-index:3400;backdrop-filter:blur(4px)';
  document.body.appendChild(overlay);

  var sheet = document.createElement('div');
  sheet.id = 'invtry-sheet';
  sheet.style.cssText = 'display:none;position:fixed;bottom:0;left:0;right:0;background:#fff;'
    + 'border-radius:22px 22px 0 0;border-top:1px solid #e8d0f0;z-index:3401;'
    + 'padding:0 0 28px;font-family:\'DM Sans\',sans-serif;max-height:90vh;overflow-y:auto';
  sheet.innerHTML =
      '<div style="width:40px;height:4px;border-radius:2px;background:#ddd0ea;margin:14px auto 0"></div>'
    + '<div style="padding:16px 20px 12px;border-bottom:1px solid #f0e8f8;display:flex;'
    +   'align-items:center;justify-content:space-between">'
    +   '<div>'
    +     '<div style="font-size:9px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;'
    +       'color:#9c0ca1;margin-bottom:4px">Admin</div>'
    +     '<div style="font-size:18px;font-weight:700;color:#1a0820">Inventory</div>'
    +   '</div>'
    +   '<div style="display:flex;gap:8px;align-items:center">'
    +     '<div onclick="openInvHistory()" style="font-size:11px;font-weight:700;color:#6e0977;'
    +       'cursor:pointer;padding:8px 12px;background:#f5eeff;border-radius:10px">📜 History</div>'
    +     '<div onclick="closeInventory()" style="width:34px;height:34px;border-radius:50%;'
    +       'background:#f5eeff;border:1px solid #e0c8f0;display:flex;align-items:center;'
    +       'justify-content:center;cursor:pointer;font-size:14px;color:#6e0977">✕</div>'
    +   '</div>'
    + '</div>'
    + '<div style="padding:16px 20px 0">'
    +   '<button onclick="openAddInvItem()" style="width:100%;padding:13px;background:linear-gradient(135deg,'
    +     '#6e0977,#9c0ca1);color:#fff;font-size:13px;font-weight:700;border:none;border-radius:12px;'
    +     'cursor:pointer">➕ Add Ingredient</button>'
    + '</div>'
    + '<div id="invtry-list" style="padding:16px 20px;display:flex;flex-direction:column;gap:10px"></div>';
  document.body.appendChild(sheet);

  buildAddItemUI();
  buildMovementUI();
  buildHistoryUI();
}

function openInventory() {
  document.getElementById('invtry-overlay').style.display = 'block';
  document.getElementById('invtry-sheet').style.display   = 'block';
  loadInventoryItems();
}
function closeInventory() {
  document.getElementById('invtry-overlay').style.display = 'none';
  document.getElementById('invtry-sheet').style.display   = 'none';
}

async function loadInventoryItems() {
  var list = document.getElementById('invtry-list');
  list.innerHTML = '<div style="text-align:center;padding:20px;color:#b090c0;font-size:12px">Loading…</div>';
  var res = await db.from('inventory_items').select('*').order('name');
  _invItems = res.data || [];
  renderInventoryList();
  refreshLowStockBadge();
}

function renderInventoryList() {
  var list = document.getElementById('invtry-list');
  if (!_invItems.length) {
    list.innerHTML = '<div style="text-align:center;padding:30px 20px;color:#b090c0;font-size:13px">'
      + 'No ingredients added yet — tap "Add Ingredient" to start tracking stock.</div>';
    return;
  }
  list.innerHTML = _invItems.map(function (item) {
    var isLow = item.current_stock <= item.low_stock_threshold;
    var isOut = item.current_stock <= 0;
    var barColor = isOut ? '#dc2626' : (isLow ? '#f59e0b' : '#15803d');
    var bg = isOut ? 'rgba(220,38,38,0.06)' : (isLow ? 'rgba(245,158,11,0.06)' : '#fff');
    var border = isOut ? 'rgba(220,38,38,0.25)' : (isLow ? 'rgba(245,158,11,0.3)' : '#e0c8f0');
    var statusTxt = isOut ? '⚠️ OUT OF STOCK' : (isLow ? '⚠️ LOW STOCK' : '');

    return '<div style="background:' + bg + ';border:1.5px solid ' + border + ';border-radius:14px;padding:14px">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">'
      + '<div>'
      + '<div style="font-size:14px;font-weight:700;color:#1a0820">' + item.name + '</div>'
      + (statusTxt ? '<div style="font-size:9px;font-weight:700;color:' + barColor + ';letter-spacing:1px;margin-top:2px">' + statusTxt + '</div>' : '')
      + '</div>'
      + '<div style="text-align:right">'
      + '<div style="font-family:Fraunces,Georgia,serif;font-size:20px;font-weight:900;color:' + barColor + '">'
      + item.current_stock + ' <span style="font-size:12px;font-weight:600">' + item.unit + '</span></div>'
      + '<div style="font-size:10px;color:#9a8aaa">low at ' + item.low_stock_threshold + ' ' + item.unit + '</div>'
      + '</div></div>'
      + '<div style="display:flex;gap:6px">'
      + '<button onclick="openInvMovement(\'' + item.id + '\',\'restock\')" style="flex:1;padding:9px;'
      + 'border-radius:9px;background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);'
      + 'color:#15803d;font-size:11px;font-weight:700;cursor:pointer">➕ Restock</button>'
      + '<button onclick="openInvMovement(\'' + item.id + '\',\'use\')" style="flex:1;padding:9px;'
      + 'border-radius:9px;background:rgba(184,116,16,0.1);border:1px solid rgba(184,116,16,0.3);'
      + 'color:#b87410;font-size:11px;font-weight:700;cursor:pointer">➖ Use</button>'
      + '<button onclick="openInvMovement(\'' + item.id + '\',\'waste\')" style="flex:1;padding:9px;'
      + 'border-radius:9px;background:rgba(220,38,38,0.08);border:1px solid rgba(220,38,38,0.25);'
      + 'color:#dc2626;font-size:11px;font-weight:700;cursor:pointer">🗑 Waste</button>'
      + '<button onclick="openEditInvItem(\'' + item.id + '\')" style="width:34px;border-radius:9px;'
      + 'background:#f5eeff;border:1px solid #e0c8f0;color:#6e0977;cursor:pointer">✏️</button>'
      + '</div></div>';
  }).join('');
}

// ══════════════════════════════════════════════════════════════
// Add / Edit item sheet
// ══════════════════════════════════════════════════════════════
var _invEditId = null;

function buildAddItemUI() {
  var overlay = document.createElement('div');
  overlay.id = 'invtry-item-overlay';
  overlay.onclick = closeInvItemSheet;
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);'
    + 'z-index:3500;backdrop-filter:blur(4px)';
  document.body.appendChild(overlay);

  var sheet = document.createElement('div');
  sheet.id = 'invtry-item-sheet';
  sheet.style.cssText = 'display:none;position:fixed;bottom:0;left:0;right:0;background:#fff;'
    + 'border-radius:22px 22px 0 0;border-top:1px solid #e8d0f0;z-index:3501;'
    + 'padding:0 0 28px;font-family:\'DM Sans\',sans-serif';
  sheet.innerHTML =
      '<div style="width:40px;height:4px;border-radius:2px;background:#ddd0ea;margin:14px auto 0"></div>'
    + '<div style="padding:16px 20px 12px;border-bottom:1px solid #f0e8f8;display:flex;'
    +   'align-items:center;justify-content:space-between">'
    +   '<div id="invtry-item-title" style="font-size:18px;font-weight:700;color:#1a0820">Add Ingredient</div>'
    +   '<div onclick="closeInvItemSheet()" style="width:34px;height:34px;border-radius:50%;'
    +     'background:#f5eeff;border:1px solid #e0c8f0;display:flex;align-items:center;'
    +     'justify-content:center;cursor:pointer;font-size:14px;color:#6e0977">✕</div>'
    + '</div>'
    + '<div style="padding:18px 20px;display:flex;flex-direction:column;gap:12px">'
    +   '<input id="invtry-item-name" placeholder="Ingredient name (e.g. All-purpose Flour)" style="width:100%;'
    +     'padding:12px 14px;border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);font-family:inherit;'
    +     'font-size:14px;outline:none;box-sizing:border-box">'
    +   '<div style="display:flex;gap:8px">'
    +     '<select id="invtry-item-unit" style="flex:1;padding:12px 10px;border-radius:12px;'
    +       'border:1.5px solid rgba(18,10,30,0.12);font-family:inherit;font-size:14px;outline:none;'
    +       'background:#fff;cursor:pointer">'
    +       '<option value="kg">kg</option><option value="g">g</option>'
    +       '<option value="liter">liter</option><option value="ml">ml</option>'
    +       '<option value="pieces">pieces</option><option value="dozen">dozen</option>'
    +     '</select>'
    +     '<input id="invtry-item-stock" type="number" step="any" placeholder="Current stock" style="flex:1;'
    +       'padding:12px 14px;border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);font-family:inherit;'
    +       'font-size:14px;outline:none;box-sizing:border-box">'
    +   '</div>'
    +   '<div>'
    +     '<div style="font-size:10px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;'
    +       'color:#9c0ca1;margin-bottom:6px">Low Stock Alert Threshold</div>'
    +     '<input id="invtry-item-threshold" type="number" step="any" placeholder="e.g. 2" style="width:100%;'
    +       'padding:12px 14px;border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);font-family:inherit;'
    +       'font-size:14px;outline:none;box-sizing:border-box">'
    +     '<div style="font-size:11px;color:#9a8aaa;margin-top:5px">You\'ll get a low-stock warning once '
    +       'stock falls to or below this amount.</div>'
    +   '</div>'
    +   '<button id="invtry-item-save-btn" onclick="saveInvItem()" style="width:100%;padding:15px;'
    +     'background:linear-gradient(135deg,#6e0977,#9c0ca1);color:#fff;font-size:13px;font-weight:700;'
    +     'border:none;border-radius:14px;cursor:pointer;letter-spacing:1px">Save Ingredient</button>'
    +   '<button id="invtry-item-delete-btn" onclick="deleteInvItem()" style="display:none;width:100%;'
    +     'padding:13px;background:rgba(220,38,38,0.08);color:#dc2626;font-size:12px;font-weight:700;'
    +     'border:1px solid rgba(220,38,38,0.25);border-radius:12px;cursor:pointer">🗑 Delete Ingredient</button>'
    + '</div>';
  document.body.appendChild(sheet);
}

function openAddInvItem() {
  _invEditId = null;
  document.getElementById('invtry-item-title').textContent = 'Add Ingredient';
  document.getElementById('invtry-item-name').value = '';
  document.getElementById('invtry-item-unit').value = 'kg';
  document.getElementById('invtry-item-stock').value = '';
  document.getElementById('invtry-item-threshold').value = '';
  document.getElementById('invtry-item-delete-btn').style.display = 'none';
  document.getElementById('invtry-item-overlay').style.display = 'block';
  document.getElementById('invtry-item-sheet').style.display   = 'block';
}

function openEditInvItem(id) {
  var item = _invItems.find(function (i) { return i.id === id; });
  if (!item) return;
  _invEditId = id;
  document.getElementById('invtry-item-title').textContent = 'Edit Ingredient';
  document.getElementById('invtry-item-name').value = item.name;
  document.getElementById('invtry-item-unit').value = item.unit;
  document.getElementById('invtry-item-stock').value = item.current_stock;
  document.getElementById('invtry-item-threshold').value = item.low_stock_threshold;
  document.getElementById('invtry-item-delete-btn').style.display = 'block';
  document.getElementById('invtry-item-overlay').style.display = 'block';
  document.getElementById('invtry-item-sheet').style.display   = 'block';
}

function closeInvItemSheet() {
  document.getElementById('invtry-item-overlay').style.display = 'none';
  document.getElementById('invtry-item-sheet').style.display   = 'none';
}

async function saveInvItem() {
  var name = (document.getElementById('invtry-item-name').value || '').trim();
  var unit = document.getElementById('invtry-item-unit').value;
  var stock = parseFloat(document.getElementById('invtry-item-stock').value);
  var threshold = parseFloat(document.getElementById('invtry-item-threshold').value);

  if (!name) { showStoreToast('Enter an ingredient name'); return; }
  if (isNaN(stock)) { showStoreToast('Enter a starting stock amount'); return; }
  if (isNaN(threshold)) threshold = 0;

  var btn = document.getElementById('invtry-item-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    if (_invEditId) {
      var upd = await db.from('inventory_items').update({
        name: name, unit: unit, current_stock: stock, low_stock_threshold: threshold,
        updated_at: new Date().toISOString()
      }).eq('id', _invEditId);
      if (upd.error) throw upd.error;
    } else {
      var ins = await db.from('inventory_items').insert([{
        name: name, unit: unit, current_stock: stock, low_stock_threshold: threshold
      }]);
      if (ins.error) throw ins.error;
    }
    showStoreToast('✅ ' + name + ' saved');
    closeInvItemSheet();
    loadInventoryItems();
  } catch (e) {
    showStoreToast('Error: ' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Save Ingredient';
  }
}

async function deleteInvItem() {
  if (!_invEditId) return;
  if (!confirm('Delete this ingredient? Its movement history will also be removed.')) return;
  await db.from('inventory_items').delete().eq('id', _invEditId);
  showStoreToast('Ingredient removed');
  closeInvItemSheet();
  loadInventoryItems();
}

// ══════════════════════════════════════════════════════════════
// Restock / Use / Waste movement sheet
// ══════════════════════════════════════════════════════════════
var _invMoveItemId = null;
var _invMoveType    = null;

function buildMovementUI() {
  var overlay = document.createElement('div');
  overlay.id = 'invtry-move-overlay';
  overlay.onclick = closeInvMovement;
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);'
    + 'z-index:3500;backdrop-filter:blur(4px)';
  document.body.appendChild(overlay);

  var sheet = document.createElement('div');
  sheet.id = 'invtry-move-sheet';
  sheet.style.cssText = 'display:none;position:fixed;bottom:0;left:0;right:0;background:#fff;'
    + 'border-radius:22px 22px 0 0;border-top:1px solid #e8d0f0;z-index:3501;'
    + 'padding:0 0 28px;font-family:\'DM Sans\',sans-serif';
  sheet.innerHTML =
      '<div style="width:40px;height:4px;border-radius:2px;background:#ddd0ea;margin:14px auto 0"></div>'
    + '<div style="padding:16px 20px 12px;border-bottom:1px solid #f0e8f8">'
    +   '<div id="invtry-move-title" style="font-size:18px;font-weight:700;color:#1a0820">Restock</div>'
    +   '<div id="invtry-move-sub" style="font-size:12px;color:#9a8aaa;margin-top:2px">Item name</div>'
    + '</div>'
    + '<div style="padding:18px 20px;display:flex;flex-direction:column;gap:12px">'
    +   '<input id="invtry-move-qty" type="number" step="any" placeholder="Quantity" style="width:100%;'
    +     'padding:13px 14px;border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);font-family:inherit;'
    +     'font-size:16px;outline:none;box-sizing:border-box">'
    +   '<input id="invtry-move-note" placeholder="Note (optional) — e.g. supplier name, reason" style="width:100%;'
    +     'padding:12px 14px;border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);font-family:inherit;'
    +     'font-size:13px;outline:none;box-sizing:border-box">'
    +   '<button id="invtry-move-btn" onclick="submitInvMovement()" style="width:100%;padding:15px;'
    +     'color:#fff;font-size:13px;font-weight:700;border:none;border-radius:14px;cursor:pointer;'
    +     'letter-spacing:1px">Confirm</button>'
    + '</div>';
  document.body.appendChild(sheet);
}

function openInvMovement(itemId, type) {
  var item = _invItems.find(function (i) { return i.id === itemId; });
  if (!item) return;
  _invMoveItemId = itemId;
  _invMoveType   = type;

  var titleMap = { restock: '➕ Restock', use: '➖ Use', waste: '🗑 Waste' };
  var colorMap = { restock: '#15803d', use: '#b87410', waste: '#dc2626' };
  document.getElementById('invtry-move-title').textContent = titleMap[type] + ' — ' + item.name;
  document.getElementById('invtry-move-sub').textContent = 'Current stock: ' + item.current_stock + ' ' + item.unit;
  document.getElementById('invtry-move-qty').value = '';
  document.getElementById('invtry-move-note').value = '';
  var btn = document.getElementById('invtry-move-btn');
  btn.style.background = colorMap[type];
  btn.textContent = 'Confirm ' + titleMap[type].replace(/[➕➖🗑]\s*/, '');

  document.getElementById('invtry-move-overlay').style.display = 'block';
  document.getElementById('invtry-move-sheet').style.display   = 'block';
}

function closeInvMovement() {
  document.getElementById('invtry-move-overlay').style.display = 'none';
  document.getElementById('invtry-move-sheet').style.display   = 'none';
}

async function submitInvMovement() {
  var qty = parseFloat(document.getElementById('invtry-move-qty').value);
  var note = (document.getElementById('invtry-move-note').value || '').trim();
  if (isNaN(qty) || qty <= 0) { showStoreToast('Enter a valid quantity'); return; }

  var item = _invItems.find(function (i) { return i.id === _invMoveItemId; });
  if (!item) return;

  var newStock = _invMoveType === 'restock' ? item.current_stock + qty : item.current_stock - qty;
  if (newStock < 0) newStock = 0;

  var btn = document.getElementById('invtry-move-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  try {
    var upd = await db.from('inventory_items')
      .update({ current_stock: newStock, updated_at: new Date().toISOString() })
      .eq('id', _invMoveItemId);
    if (upd.error) throw upd.error;

    await db.from('inventory_movements').insert([{
      item_id: _invMoveItemId,
      movement_type: _invMoveType,
      quantity: qty,
      note: note || null,
      logged_by: currentLogName()
    }]);

    showStoreToast('✅ ' + item.name + ' updated');
    closeInvMovement();
    loadInventoryItems();
  } catch (e) {
    showStoreToast('Error: ' + e.message);
  } finally {
    btn.disabled = false;
  }
}

// ══════════════════════════════════════════════════════════════
// History
// ══════════════════════════════════════════════════════════════
function buildHistoryUI() {
  var overlay = document.createElement('div');
  overlay.id = 'invtry-hist-overlay';
  overlay.onclick = closeInvHistory;
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);'
    + 'z-index:3500;backdrop-filter:blur(4px)';
  document.body.appendChild(overlay);

  var sheet = document.createElement('div');
  sheet.id = 'invtry-hist-sheet';
  sheet.style.cssText = 'display:none;position:fixed;bottom:0;left:0;right:0;background:#fff;'
    + 'border-radius:22px 22px 0 0;border-top:1px solid #e8d0f0;z-index:3501;'
    + 'padding:0 0 28px;font-family:\'DM Sans\',sans-serif;max-height:85vh;overflow-y:auto';
  sheet.innerHTML =
      '<div style="width:40px;height:4px;border-radius:2px;background:#ddd0ea;margin:14px auto 0"></div>'
    + '<div style="padding:16px 20px 12px;border-bottom:1px solid #f0e8f8;display:flex;'
    +   'align-items:center;justify-content:space-between">'
    +   '<div style="font-size:18px;font-weight:700;color:#1a0820">Stock History</div>'
    +   '<div onclick="closeInvHistory()" style="width:34px;height:34px;border-radius:50%;'
    +     'background:#f5eeff;border:1px solid #e0c8f0;display:flex;align-items:center;'
    +     'justify-content:center;cursor:pointer;font-size:14px;color:#6e0977">✕</div>'
    + '</div>'
    + '<div id="invtry-hist-list" style="padding:16px 20px;display:flex;flex-direction:column;gap:8px"></div>';
  document.body.appendChild(sheet);
}

function openInvHistory() {
  document.getElementById('invtry-hist-overlay').style.display = 'block';
  document.getElementById('invtry-hist-sheet').style.display   = 'block';
  loadInvHistory();
}
function closeInvHistory() {
  document.getElementById('invtry-hist-overlay').style.display = 'none';
  document.getElementById('invtry-hist-sheet').style.display   = 'none';
}

async function loadInvHistory() {
  var list = document.getElementById('invtry-hist-list');
  list.innerHTML = '<div style="text-align:center;padding:20px;color:#b090c0;font-size:12px">Loading…</div>';

  var res = await db.from('inventory_movements')
    .select('*, inventory_items(name, unit)')
    .order('created_at', { ascending: false })
    .limit(50);
  var rows = res.data || [];

  if (!rows.length) {
    list.innerHTML = '<div style="text-align:center;padding:30px 20px;color:#b090c0;font-size:13px">No movements logged yet.</div>';
    return;
  }

  var iconMap = { restock: '➕', use: '➖', waste: '🗑' };
  var colorMap = { restock: '#15803d', use: '#b87410', waste: '#dc2626' };

  list.innerHTML = rows.map(function (r) {
    var itemName = (r.inventory_items && r.inventory_items.name) || 'Deleted item';
    var unit = (r.inventory_items && r.inventory_items.unit) || '';
    var dt = new Date(r.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    return '<div style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;background:#f5eeff;'
      + 'border-radius:12px;border:1px solid #e0c8f0">'
      + '<div style="font-size:16px;flex-shrink:0">' + (iconMap[r.movement_type] || '•') + '</div>'
      + '<div style="flex:1">'
      + '<div style="font-size:13px;font-weight:700;color:#1a0820">' + itemName + '</div>'
      + '<div style="font-size:11px;color:' + (colorMap[r.movement_type] || '#9a8aaa') + ';font-weight:600;margin-top:1px">'
      + r.movement_type.toUpperCase() + ' ' + r.quantity + ' ' + unit + '</div>'
      + (r.note ? '<div style="font-size:11px;color:#9a8aaa;margin-top:2px">' + r.note + '</div>' : '')
      + '</div>'
      + '<div style="text-align:right;flex-shrink:0">'
      + '<div style="font-size:10px;color:#9a8aaa">' + dt + '</div>'
      + (r.logged_by ? '<div style="font-size:10px;color:#6e0977;font-weight:600;margin-top:2px">👤 ' + r.logged_by + '</div>' : '')
      + '</div></div>';
  }).join('');
}
