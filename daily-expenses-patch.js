/**
 * daily-expenses-patch.js — ChocoCravings On Store
 * Feature: Daily Expenses — quick logging for daily fresh purchases
 * (milk, vegetables, bread, fruits, sugar, etc.) made when opening the
 * outlet. Feeds directly into Day Close (today's Net Profit) and Sales
 * Reports (Net Profit trend across any period, including Custom range).
 *
 * Load AFTER store-patch.js, right before </body>:
 *   <script src="daily-expenses-patch.js"></script>
 *
 * Requires DB setup: run create-daily-expenses-table.sql once in Supabase.
 * Requires: `db`, `showStoreToast()` — already global.
 *
 * Available to regular admins (not super-user gated) since whoever does
 * the morning shopping needs to log it — same reasoning as Inventory
 * and Display Stock.
 */

var EXPENSE_CATEGORIES = ['Milk & Dairy', 'Vegetables', 'Fruits', 'Bread & Bakery', 'Sugar & Staples', 'Other'];
var _deTodayList = [];

document.addEventListener('DOMContentLoaded', function () {
  buildExpensesUI();
  waitForAdminThenInject();
});

function waitForAdminThenInject() {
  var attempts = 0;
  var poll = setInterval(function () {
    attempts++;
    if (typeof isAdmin !== 'undefined' && isAdmin) {
      clearInterval(poll);
      injectExpensesMenuEntry();
    } else if (attempts >= 20) {
      clearInterval(poll);
    }
  }, 300);
}

function deLogName() {
  if (typeof _staffSession !== 'undefined' && _staffSession && _staffSession.name) return _staffSession.name;
  if (typeof isAdmin !== 'undefined' && isAdmin) return 'Admin';
  return null;
}

function deTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

async function getExpensesTotal(startDate, endDate) {
  try {
    var res = await db.from('daily_expenses').select('amount')
      .gte('expense_date', startDate).lte('expense_date', endDate);
    return (res.data || []).reduce(function (s, r) { return s + (r.amount || 0); }, 0);
  } catch (e) {
    return 0;
  }
}

function injectExpensesMenuEntry() {
  var fabMenu = document.getElementById('admin-fab-menu');
  if (!fabMenu) return;
  var entry = document.createElement('div');
  entry.onclick = function () { openExpenses(); closeAdminMenu(); };
  entry.style.cssText = 'display:flex;align-items:center;gap:10px;padding:13px 16px;'
    + 'cursor:pointer;transition:background .15s;border-bottom:1px solid #f5f0f8';
  entry.onmouseover = function () { entry.style.background = '#f5eeff'; };
  entry.onmouseout  = function () { entry.style.background = 'transparent'; };
  entry.innerHTML =
      '<div style="width:32px;height:32px;border-radius:8px;background:rgba(110,9,119,0.1);'
    + 'display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">💰</div>'
    + '<div><div style="font-size:13px;font-weight:600;color:#1a0820">Daily Expenses</div>'
    + '<div style="font-size:11px;color:#9c0ca1;margin-top:1px">Milk, veggies, bread & more</div></div>';
  fabMenu.appendChild(entry);
}

function buildExpensesUI() {
  var overlay = document.createElement('div');
  overlay.id = 'de-overlay';
  overlay.onclick = closeExpenses;
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);'
    + 'z-index:4000;backdrop-filter:blur(4px)';
  document.body.appendChild(overlay);

  var sheet = document.createElement('div');
  sheet.id = 'de-sheet';
  sheet.style.cssText = 'display:none;position:fixed;bottom:0;left:0;right:0;background:#fff;'
    + 'border-radius:22px 22px 0 0;border-top:1px solid #e8d0f0;z-index:4001;'
    + 'padding:0 0 28px;font-family:\'DM Sans\',sans-serif;max-height:90vh;overflow-y:auto';
  sheet.innerHTML =
      '<div style="width:40px;height:4px;border-radius:2px;background:#ddd0ea;margin:14px auto 0"></div>'
    + '<div style="padding:16px 20px 12px;border-bottom:1px solid #f0e8f8;display:flex;'
    +   'align-items:center;justify-content:space-between">'
    +   '<div>'
    +     '<div style="font-size:9px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;'
    +       'color:#9c0ca1;margin-bottom:4px">Admin</div>'
    +     '<div style="font-size:18px;font-weight:700;color:#1a0820">Daily Expenses</div>'
    +   '</div>'
    +   '<div style="display:flex;gap:8px;align-items:center">'
    +     '<div onclick="openDeHistory()" style="font-size:11px;font-weight:700;color:#6e0977;'
    +       'cursor:pointer;padding:8px 12px;background:#f5eeff;border-radius:10px">📜 History</div>'
    +     '<div onclick="closeExpenses()" style="width:34px;height:34px;border-radius:50%;'
    +       'background:#f5eeff;border:1px solid #e0c8f0;display:flex;align-items:center;'
    +       'justify-content:center;cursor:pointer;font-size:14px;color:#6e0977">✕</div>'
    +   '</div>'
    + '</div>'
    + '<div style="padding:18px 20px 0">'
    +   '<div style="background:linear-gradient(135deg,rgba(220,38,38,0.08),rgba(220,38,38,0.02));'
    +     'border:1.5px solid rgba(220,38,38,0.25);border-radius:14px;padding:16px;text-align:center;margin-bottom:16px">'
    +     '<div style="font-size:10px;font-weight:700;color:#dc2626;letter-spacing:1.5px">TODAY\'S TOTAL EXPENSES</div>'
    +     '<div id="de-today-total" style="font-family:Fraunces,Georgia,serif;font-size:28px;font-weight:900;'
    +       'color:#dc2626;margin-top:4px">₹0</div>'
    +   '</div>'

    +   '<div style="display:flex;gap:8px;margin-bottom:10px">'
    +     '<select id="de-category" style="flex:1;padding:12px 10px;border-radius:12px;'
    +       'border:1.5px solid rgba(18,10,30,0.12);font-family:inherit;font-size:13px;background:#fff;cursor:pointer"></select>'
    +   '</div>'
    +   '<input id="de-item-name" placeholder="What did you buy? (e.g. Milk 5L, Tomatoes 2kg)" style="width:100%;'
    +     'padding:12px 14px;border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);font-family:inherit;'
    +     'font-size:14px;outline:none;box-sizing:border-box;margin-bottom:10px">'
    +   '<div style="display:flex;gap:8px;margin-bottom:10px">'
    +     '<input id="de-amount" type="number" step="any" placeholder="Amount (₹)" style="flex:1;padding:12px 14px;'
    +       'border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);font-family:inherit;font-size:14px;'
    +       'outline:none;box-sizing:border-box">'
    +     '<input id="de-vendor" placeholder="Vendor (optional)" style="flex:1;padding:12px 14px;'
    +       'border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);font-family:inherit;font-size:14px;'
    +       'outline:none;box-sizing:border-box">'
    +   '</div>'
    +   '<button onclick="addExpense()" style="width:100%;padding:13px;background:linear-gradient(135deg,'
    +     '#6e0977,#9c0ca1);color:#fff;font-size:13px;font-weight:700;border:none;border-radius:12px;'
    +     'cursor:pointer;margin-bottom:16px">➕ Add Expense</button>'
    + '</div>'
    + '<div id="de-today-list" style="padding:0 20px;display:flex;flex-direction:column;gap:8px"></div>';
  document.body.appendChild(sheet);

  var catSel = document.getElementById('de-category');
  EXPENSE_CATEGORIES.forEach(function (c) {
    var opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    catSel.appendChild(opt);
  });

  buildDeHistoryUI();
}

function openExpenses() {
  document.getElementById('de-overlay').style.display = 'block';
  document.getElementById('de-sheet').style.display   = 'block';
  loadTodayExpenses();
}
function closeExpenses() {
  document.getElementById('de-overlay').style.display = 'none';
  document.getElementById('de-sheet').style.display   = 'none';
}

async function loadTodayExpenses() {
  var today = deTodayStr();
  var res = await db.from('daily_expenses').select('*').eq('expense_date', today).order('created_at', { ascending: false });
  _deTodayList = res.data || [];
  renderTodayExpenses();
}

function renderTodayExpenses() {
  var total = _deTodayList.reduce(function (s, r) { return s + (r.amount || 0); }, 0);
  document.getElementById('de-today-total').textContent = '₹' + total.toFixed(2);

  var list = document.getElementById('de-today-list');
  if (!_deTodayList.length) {
    list.innerHTML = '<div style="text-align:center;padding:20px;color:#b090c0;font-size:12px">No expenses logged yet today.</div>';
    return;
  }
  list.innerHTML = _deTodayList.map(function (r) {
    return '<div style="display:flex;align-items:center;justify-content:space-between;background:#f5eeff;'
      + 'border:1px solid #e0c8f0;border-radius:12px;padding:10px 14px">'
      + '<div style="flex:1">'
      + '<div style="font-size:13px;font-weight:700;color:#1a0820">' + r.item_name + '</div>'
      + '<div style="font-size:11px;color:#9c0ca1">' + r.category + (r.vendor ? ' · ' + r.vendor : '') + '</div>'
      + '</div>'
      + '<div style="font-size:14px;font-weight:700;color:#dc2626;margin-right:8px">₹' + r.amount.toFixed(2) + '</div>'
      + '<div onclick="deleteExpense(\'' + r.id + '\')" style="width:26px;height:26px;border-radius:50%;'
      + 'background:#fff;border:1px solid #e0c8f0;display:flex;align-items:center;justify-content:center;'
      + 'cursor:pointer;font-size:12px;color:#e05080">✕</div>'
      + '</div>';
  }).join('');
}

async function addExpense() {
  var category = document.getElementById('de-category').value;
  var itemName = (document.getElementById('de-item-name').value || '').trim();
  var amount = parseFloat(document.getElementById('de-amount').value);
  var vendor = (document.getElementById('de-vendor').value || '').trim();

  if (!itemName) { showStoreToast('Enter what you bought'); return; }
  if (isNaN(amount) || amount <= 0) { showStoreToast('Enter a valid amount'); return; }

  try {
    await db.from('daily_expenses').insert([{
      expense_date: deTodayStr(),
      category: category,
      item_name: itemName,
      amount: amount,
      vendor: vendor || null,
      logged_by: deLogName()
    }]);
    document.getElementById('de-item-name').value = '';
    document.getElementById('de-amount').value = '';
    document.getElementById('de-vendor').value = '';
    showStoreToast('✅ ' + itemName + ' added');
    loadTodayExpenses();
  } catch (e) {
    showStoreToast('Error: ' + e.message);
  }
}

async function deleteExpense(id) {
  if (!confirm('Remove this expense entry?')) return;
  await db.from('daily_expenses').delete().eq('id', id);
  showStoreToast('Removed');
  loadTodayExpenses();
}

function buildDeHistoryUI() {
  var overlay = document.createElement('div');
  overlay.id = 'de-hist-overlay';
  overlay.onclick = closeDeHistory;
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);'
    + 'z-index:4100;backdrop-filter:blur(4px)';
  document.body.appendChild(overlay);

  var sheet = document.createElement('div');
  sheet.id = 'de-hist-sheet';
  sheet.style.cssText = 'display:none;position:fixed;bottom:0;left:0;right:0;background:#fff;'
    + 'border-radius:22px 22px 0 0;border-top:1px solid #e8d0f0;z-index:4101;'
    + 'padding:0 0 28px;font-family:\'DM Sans\',sans-serif;max-height:85vh;overflow-y:auto';
  sheet.innerHTML =
      '<div style="width:40px;height:4px;border-radius:2px;background:#ddd0ea;margin:14px auto 0"></div>'
    + '<div style="padding:16px 20px 12px;border-bottom:1px solid #f0e8f8;display:flex;'
    +   'align-items:center;justify-content:space-between">'
    +   '<div style="font-size:18px;font-weight:700;color:#1a0820">Expense History</div>'
    +   '<div onclick="closeDeHistory()" style="width:34px;height:34px;border-radius:50%;'
    +     'background:#f5eeff;border:1px solid #e0c8f0;display:flex;align-items:center;'
    +     'justify-content:center;cursor:pointer;font-size:14px;color:#6e0977">✕</div>'
    + '</div>'
    + '<div id="de-hist-list" style="padding:16px 20px;display:flex;flex-direction:column;gap:8px"></div>';
  document.body.appendChild(sheet);
}

function openDeHistory() {
  document.getElementById('de-hist-overlay').style.display = 'block';
  document.getElementById('de-hist-sheet').style.display   = 'block';
  loadDeHistory();
}
function closeDeHistory() {
  document.getElementById('de-hist-overlay').style.display = 'none';
  document.getElementById('de-hist-sheet').style.display   = 'none';
}

async function loadDeHistory() {
  var list = document.getElementById('de-hist-list');
  list.innerHTML = '<div style="text-align:center;padding:20px;color:#b090c0;font-size:12px">Loading…</div>';

  var res = await db.from('daily_expenses').select('*').order('expense_date', { ascending: false }).order('created_at', { ascending: false }).limit(100);
  var rows = res.data || [];
  if (!rows.length) {
    list.innerHTML = '<div style="text-align:center;padding:30px 20px;color:#b090c0;font-size:13px">No expenses logged yet.</div>';
    return;
  }

  var byDate = {};
  rows.forEach(function (r) {
    if (!byDate[r.expense_date]) byDate[r.expense_date] = [];
    byDate[r.expense_date].push(r);
  });

  var html = '';
  Object.keys(byDate).sort().reverse().forEach(function (date) {
    var dayTotal = byDate[date].reduce(function (s, r) { return s + (r.amount || 0); }, 0);
    html += '<div style="font-size:12px;font-weight:700;color:#c2607a;margin:10px 0 6px;display:flex;'
      + 'justify-content:space-between"><span>' + date + '</span><span style="color:#dc2626">₹' + dayTotal.toFixed(2) + '</span></div>';
    byDate[date].forEach(function (r) {
      html += '<div style="display:flex;justify-content:space-between;background:#f5eeff;border:1px solid #e0c8f0;'
        + 'border-radius:10px;padding:9px 12px;margin-bottom:6px;font-size:12px">'
        + '<span style="color:#1a0820;font-weight:600">' + r.item_name + ' <span style="color:#9a8aaa;font-weight:400">(' + r.category + ')</span></span>'
        + '<span style="color:#dc2626;font-weight:700">₹' + r.amount.toFixed(2) + '</span></div>';
    });
  });
  list.innerHTML = html;
}
