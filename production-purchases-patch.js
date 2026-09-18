/**
 * production-purchases-patch.js — ChocoCravings On Store
 * Feature: Production Module Phase 2 — Purchase Logging.
 *
 * Two tabs:
 *  - Raw Materials: log a purchase, updates inventory_items stock +
 *    cost_per_unit together, plus logs to material_purchases for the
 *    audit trail and future profit reporting.
 *  - Packaging: same pattern but against packaging_materials — can
 *    also add a brand new packaging item on the fly if it doesn't
 *    exist yet.
 *
 * Load AFTER admin-command-center.js, right before </body>:
 *   <script src="production-purchases-patch.js"></script>
 *
 * Requires DB setup: run add-production-module-schema.sql once.
 * Requires: `db`, `showStoreToast()`, `registerAdminTool()`.
 */

var _ppTab = 'raw';

function _ppInit() {
  buildProductionPurchasesUI();
  waitForAdminThenInjectPP();
}
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _ppInit); } else { _ppInit(); }

function waitForAdminThenInjectPP() {
  var attempts = 0;
  var poll = setInterval(function () {
    attempts++;
    if (typeof isAdmin !== 'undefined' && isAdmin) {
      clearInterval(poll);
      if (typeof registerAdminTool === 'function') {
        registerAdminTool('Daily Operations', {
          icon: '📦', iconBg: 'rgba(184,116,16,0.12)',
          title: 'Production Purchases', subtitle: 'Raw materials & packaging',
          onClick: openProductionPurchases
        });
      }
    } else if (attempts >= 20) {
      clearInterval(poll);
    }
  }, 300);
}

function ppLogName() {
  if (typeof _staffSession !== 'undefined' && _staffSession && _staffSession.name) return _staffSession.name;
  if (typeof isAdmin !== 'undefined' && isAdmin) return 'Admin';
  return null;
}

function buildProductionPurchasesUI() {
  var overlay = document.createElement('div');
  overlay.id = 'pp-overlay';
  overlay.onclick = closeProductionPurchases;
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);'
    + 'z-index:4800;backdrop-filter:blur(4px)';
  document.body.appendChild(overlay);

  var sheet = document.createElement('div');
  sheet.id = 'pp-sheet';
  sheet.style.cssText = 'display:none;position:fixed;bottom:0;left:0;right:0;background:#fff;'
    + 'border-radius:22px 22px 0 0;border-top:1px solid #e8d0f0;z-index:4801;'
    + 'padding:0 0 28px;font-family:\'DM Sans\',sans-serif;max-height:90vh;overflow-y:auto';
  sheet.innerHTML =
      '<div style="width:40px;height:4px;border-radius:2px;background:#ddd0ea;margin:14px auto 0"></div>'
    + '<div style="padding:16px 20px 12px;border-bottom:1px solid #f0e8f8">'
    +   '<div style="font-size:9px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;'
    +     'color:#9c0ca1;margin-bottom:4px">Production</div>'
    +   '<div style="display:flex;align-items:center;justify-content:space-between">'
    +     '<div style="font-size:18px;font-weight:700;color:#1a0820">📦 Purchases</div>'
    +     '<div onclick="closeProductionPurchases()" style="width:34px;height:34px;border-radius:50%;'
    +       'background:#f5eeff;border:1px solid #e0c8f0;display:flex;align-items:center;'
    +       'justify-content:center;cursor:pointer;font-size:14px;color:#6e0977">✕</div>'
    +   '</div>'
    + '</div>'
    + '<div style="display:flex;gap:6px;padding:14px 20px 0">'
    +   '<div id="pp-tab-raw" onclick="ppSetTab(\'raw\')" style="flex:1;padding:9px;border-radius:10px;'
    +     'text-align:center;font-size:11px;font-weight:700;cursor:pointer;background:#6e0977;color:#fff">🌾 Raw Materials</div>'
    +   '<div id="pp-tab-packaging" onclick="ppSetTab(\'packaging\')" style="flex:1;padding:9px;border-radius:10px;'
    +     'text-align:center;font-size:11px;font-weight:700;cursor:pointer;border:1.5px solid rgba(18,10,30,0.1);color:#9a8aaa">📦 Packaging</div>'
    + '</div>'
    + '<div id="pp-body" style="padding:16px 20px 0"></div>';
  document.body.appendChild(sheet);
}

function openProductionPurchases() {
  document.getElementById('pp-overlay').style.display = 'block';
  document.getElementById('pp-sheet').style.display   = 'block';
  ppSetTab('raw');
}
function closeProductionPurchases() {
  document.getElementById('pp-overlay').style.display = 'none';
  document.getElementById('pp-sheet').style.display   = 'none';
}

function ppSetTab(tab) {
  _ppTab = tab;
  ['raw', 'packaging'].forEach(function (t) {
    var el = document.getElementById('pp-tab-' + t);
    if (!el) return;
    var on = t === tab;
    el.style.background = on ? '#6e0977' : 'transparent';
    el.style.color = on ? '#fff' : '#9a8aaa';
    el.style.border = on ? 'none' : '1.5px solid rgba(18,10,30,0.1)';
  });
  if (tab === 'raw') renderRawMaterialsTab();
  else renderPackagingTab();
}

// ══════════════════════════════════════════════════════════════
// RAW MATERIALS tab
// ══════════════════════════════════════════════════════════════
async function renderRawMaterialsTab() {
  var body = document.getElementById('pp-body');
  body.innerHTML = '<div style="text-align:center;padding:20px;color:#b090c0;font-size:12px">Loading…</div>';

  var itemsRes = await db.from('inventory_items').select('name, unit, current_stock, cost_per_unit').order('name');
  var items = itemsRes.data || [];

  var historyRes = await db.from('material_purchases').select('*')
    .eq('material_type', 'ingredient')
    .order('created_at', { ascending: false }).limit(15);
  var history = historyRes.data || [];

  var itemOptions = items.map(function (i) {
    return '<option value="' + i.name.replace(/"/g, '&quot;') + '">' + i.name + ' (' + i.current_stock + ' ' + i.unit + ' on hand · ₹' + i.cost_per_unit + '/' + i.unit + ')</option>';
  }).join('');

  body.innerHTML =
      '<div style="font-size:11px;color:#9a8aaa;line-height:1.5;margin-bottom:14px">'
    + 'Logging a purchase here updates the ingredient\'s stock AND its cost per unit together — '
    + 'this cost feeds directly into batch costing and the profit report later.</div>'

    + '<select id="pp-raw-item" style="width:100%;padding:12px 10px;border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);'
    + 'font-family:inherit;font-size:13px;background:#fff;cursor:pointer;margin-bottom:10px">'
    + '<option value="">Select ingredient...</option>' + itemOptions + '</select>'

    + '<div style="display:flex;gap:8px;margin-bottom:10px">'
    + '<input id="pp-raw-qty" type="number" step="any" placeholder="Quantity bought" style="flex:1;padding:12px 14px;'
    + 'border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);font-family:inherit;font-size:14px;outline:none;box-sizing:border-box">'
    + '<input id="pp-raw-cost" type="number" step="any" placeholder="Total cost (₹)" style="flex:1;padding:12px 14px;'
    + 'border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);font-family:inherit;font-size:14px;outline:none;box-sizing:border-box">'
    + '</div>'

    + '<input id="pp-raw-date" type="date" value="' + new Date().toISOString().slice(0, 10) + '" style="width:100%;padding:12px 14px;'
    + 'border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);font-family:inherit;font-size:13px;outline:none;box-sizing:border-box;margin-bottom:10px">'

    + '<input id="pp-raw-notes" placeholder="Notes (optional) — e.g. supplier name" style="width:100%;padding:12px 14px;'
    + 'border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);font-family:inherit;font-size:13px;outline:none;box-sizing:border-box;margin-bottom:16px">'

    + '<button onclick="ppLogRawPurchase()" style="width:100%;padding:14px;background:linear-gradient(135deg,#6e0977,#9c0ca1);'
    + 'color:#fff;font-size:13px;font-weight:700;border:none;border-radius:12px;cursor:pointer;margin-bottom:18px">➕ Log Purchase</button>'

    + '<div style="font-size:10px;letter-spacing:2px;color:#c2607a;font-weight:700;margin-bottom:10px">RECENT PURCHASES</div>'
    + (history.length
        ? history.map(function (h) { return ppHistoryRow(h); }).join('')
        : '<div style="text-align:center;padding:16px;color:#b090c0;font-size:12px">No purchases logged yet.</div>');
}

async function ppLogRawPurchase() {
  var itemName = document.getElementById('pp-raw-item').value;
  var qty = parseFloat(document.getElementById('pp-raw-qty').value);
  var cost = parseFloat(document.getElementById('pp-raw-cost').value);
  var date = document.getElementById('pp-raw-date').value;
  var notes = (document.getElementById('pp-raw-notes').value || '').trim();

  if (!itemName) { showStoreToast('Select an ingredient'); return; }
  if (isNaN(qty) || qty <= 0) { showStoreToast('Enter a valid quantity'); return; }
  if (isNaN(cost) || cost <= 0) { showStoreToast('Enter a valid total cost'); return; }

  try {
    var itemRes = await db.from('inventory_items').select('current_stock, unit').eq('name', itemName).single();
    if (itemRes.error) throw itemRes.error;

    var newStock = (itemRes.data.current_stock || 0) + qty;
    var newCostPerUnit = cost / qty; // latest purchase sets the current unit cost

    await db.from('inventory_items').update({
      current_stock: newStock, cost_per_unit: newCostPerUnit, updated_at: new Date().toISOString()
    }).eq('name', itemName);

    await db.from('material_purchases').insert([{
      material_type: 'ingredient', item_name: itemName, quantity: qty, unit: itemRes.data.unit,
      cost_total: cost, purchase_date: date, bought_by: ppLogName(), notes: notes || null
    }]);

    showStoreToast('✅ ' + itemName + ' restocked (+' + qty + ' ' + itemRes.data.unit + ')');
    renderRawMaterialsTab();
  } catch (e) {
    showStoreToast('Error: ' + e.message);
  }
}

// ══════════════════════════════════════════════════════════════
// PACKAGING tab
// ══════════════════════════════════════════════════════════════
async function renderPackagingTab() {
  var body = document.getElementById('pp-body');
  body.innerHTML = '<div style="text-align:center;padding:20px;color:#b090c0;font-size:12px">Loading…</div>';

  var itemsRes = await db.from('packaging_materials').select('*').order('category').order('name');
  var items = itemsRes.data || [];

  var historyRes = await db.from('material_purchases').select('*')
    .eq('material_type', 'packaging')
    .order('created_at', { ascending: false }).limit(15);
  var history = historyRes.data || [];

  var stockListHtml = items.length
    ? items.map(function (p) {
        var isLow = p.low_stock_threshold > 0 && p.current_stock <= p.low_stock_threshold;
        return '<div style="display:flex;justify-content:space-between;align-items:center;background:' + (isLow ? 'rgba(220,38,38,0.06)' : '#f5eeff') + ';'
          + 'border:1px solid ' + (isLow ? 'rgba(220,38,38,0.25)' : '#e0c8f0') + ';border-radius:10px;padding:9px 12px;margin-bottom:6px">'
          + '<div><div style="font-size:12.5px;font-weight:700;color:#1a0820">' + p.name + '</div>'
          + '<div style="font-size:10.5px;color:#9c0ca1">' + (p.category || '—') + '</div></div>'
          + '<div style="font-family:Fraunces,Georgia,serif;font-size:15px;font-weight:900;color:' + (isLow ? '#dc2626' : '#6e0977') + '">'
          + p.current_stock + ' ' + p.unit + '</div></div>';
      }).join('')
    : '<div style="text-align:center;padding:16px;color:#b090c0;font-size:12px">No packaging items added yet.</div>';

  body.innerHTML =
      '<div style="font-size:10px;letter-spacing:2px;color:#c2607a;font-weight:700;margin-bottom:10px">CURRENT PACKAGING STOCK</div>'
    + stockListHtml

    + '<div style="font-size:10px;letter-spacing:2px;color:#c2607a;font-weight:700;margin:16px 0 10px">LOG A PURCHASE (existing or new item)</div>'
    + '<input id="pp-pkg-name" placeholder="Item name — e.g. Small Box, Kraft Bag" style="width:100%;padding:12px 14px;'
    + 'border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);font-family:inherit;font-size:14px;outline:none;box-sizing:border-box;margin-bottom:10px">'

    + '<div style="display:flex;gap:8px;margin-bottom:10px">'
    + '<input id="pp-pkg-category" placeholder="Category (optional)" style="flex:1;padding:12px 14px;'
    + 'border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);font-family:inherit;font-size:13px;outline:none;box-sizing:border-box">'
    + '<select id="pp-pkg-unit" style="flex:1;padding:12px 10px;border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);'
    + 'font-family:inherit;font-size:13px;background:#fff;cursor:pointer">'
    + '<option value="pieces">pieces</option><option value="rolls">rolls</option><option value="packs">packs</option>'
    + '</select></div>'

    + '<div style="display:flex;gap:8px;margin-bottom:10px">'
    + '<input id="pp-pkg-qty" type="number" step="any" placeholder="Quantity bought" style="flex:1;padding:12px 14px;'
    + 'border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);font-family:inherit;font-size:14px;outline:none;box-sizing:border-box">'
    + '<input id="pp-pkg-cost" type="number" step="any" placeholder="Total cost (₹)" style="flex:1;padding:12px 14px;'
    + 'border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);font-family:inherit;font-size:14px;outline:none;box-sizing:border-box">'
    + '</div>'

    + '<button onclick="ppLogPackagingPurchase()" style="width:100%;padding:14px;background:linear-gradient(135deg,#6e0977,#9c0ca1);'
    + 'color:#fff;font-size:13px;font-weight:700;border:none;border-radius:12px;cursor:pointer;margin-bottom:18px">➕ Log Purchase</button>'

    + '<div style="font-size:10px;letter-spacing:2px;color:#c2607a;font-weight:700;margin-bottom:10px">RECENT PURCHASES</div>'
    + (history.length
        ? history.map(function (h) { return ppHistoryRow(h); }).join('')
        : '<div style="text-align:center;padding:16px;color:#b090c0;font-size:12px">No purchases logged yet.</div>');
}

async function ppLogPackagingPurchase() {
  var name = (document.getElementById('pp-pkg-name').value || '').trim();
  var category = (document.getElementById('pp-pkg-category').value || '').trim();
  var unit = document.getElementById('pp-pkg-unit').value;
  var qty = parseFloat(document.getElementById('pp-pkg-qty').value);
  var cost = parseFloat(document.getElementById('pp-pkg-cost').value);

  if (!name) { showStoreToast('Enter an item name'); return; }
  if (isNaN(qty) || qty <= 0) { showStoreToast('Enter a valid quantity'); return; }
  if (isNaN(cost) || cost <= 0) { showStoreToast('Enter a valid total cost'); return; }

  try {
    var existing = await db.from('packaging_materials').select('id, current_stock').eq('name', name).maybeSingle();
    var newCostPerUnit = cost / qty;

    if (existing.data) {
      await db.from('packaging_materials').update({
        current_stock: (existing.data.current_stock || 0) + qty,
        cost_per_unit: newCostPerUnit, updated_at: new Date().toISOString()
      }).eq('id', existing.data.id);
    } else {
      await db.from('packaging_materials').insert([{
        name: name, category: category || null, unit: unit, current_stock: qty,
        cost_per_unit: newCostPerUnit, low_stock_threshold: 0
      }]);
    }

    await db.from('material_purchases').insert([{
      material_type: 'packaging', item_name: name, quantity: qty, unit: unit,
      cost_total: cost, purchase_date: new Date().toISOString().slice(0, 10), bought_by: ppLogName()
    }]);

    showStoreToast('✅ ' + name + ' logged (+' + qty + ' ' + unit + ')');
    document.getElementById('pp-pkg-name').value = '';
    document.getElementById('pp-pkg-qty').value = '';
    document.getElementById('pp-pkg-cost').value = '';
    renderPackagingTab();
  } catch (e) {
    showStoreToast('Error: ' + e.message);
  }
}

// ── Shared purchase history row ──
function ppHistoryRow(h) {
  var perUnit = h.quantity > 0 ? (h.cost_total / h.quantity).toFixed(2) : '0';
  return '<div style="background:#f5eeff;border:1px solid #e0c8f0;border-radius:10px;padding:9px 12px;margin-bottom:6px">'
    + '<div style="display:flex;justify-content:space-between;font-size:12.5px;font-weight:700;color:#1a0820">'
    + '<span>' + h.item_name + '</span><span style="color:#dc2626">₹' + h.cost_total + '</span></div>'
    + '<div style="font-size:10.5px;color:#9a8aaa;margin-top:2px">' + h.quantity + ' ' + (h.unit || '') + ' · ₹' + perUnit + '/unit · '
    + h.purchase_date + (h.bought_by ? ' · ' + h.bought_by : '') + '</div>'
    + (h.notes ? '<div style="font-size:10.5px;color:#6e0977;margin-top:2px;font-style:italic">' + h.notes + '</div>' : '')
    + '</div>';
}
