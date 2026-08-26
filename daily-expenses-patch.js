/**
 * daily-expenses-patch.js — ChocoCravings On Store
 * Feature: Daily Expenses (ad-hoc purchases: milk, vegetables, bread,
 * fruits, sugar, etc.) PLUS Recurring Expenses (rent, staff wages,
 * electricity — fixed costs that don't get manually logged every day
 * but still need to count toward true Net Profit).
 *
 * getExpensesTotal(startDate, endDate) is the shared helper used by
 * both day-close-patch.js and sales-reports-patch.js. It now returns
 * ad-hoc expenses in that date range PLUS a prorated share of every
 * active recurring expense (e.g. a monthly rent of ₹15,000 contributes
 * roughly ₹500/day, ₹3,500/week, etc.) — so Net Profit reflects real
 * fixed costs, not just what happened to get typed in that day.
 *
 * Load AFTER store-patch.js, right before </body>:
 *   <script src="daily-expenses-patch.js"></script>
 *
 * Requires DB setup: create-daily-expenses-table.sql (ad-hoc expenses)
 * AND add-recurring-expenses-table.sql (fixed costs) — run both once.
 * Requires: `db`, `showStoreToast()` — already global.
 */

var EXPENSE_CATEGORIES = ['Milk & Dairy', 'Vegetables', 'Fruits', 'Bread & Bakery', 'Sugar & Staples', 'Other'];
var RECURRING_FREQUENCIES = ['daily', 'weekly', 'monthly'];
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

// ══════════════════════════════════════════════════════════════
// Shared helper — used by Day Close and Sales Reports
// ══════════════════════════════════════════════════════════════
async function getExpensesTotal(startDate, endDate) {
  try {
    var adhocRes = await db.from('daily_expenses').select('amount')
      .gte('expense_date', startDate).lte('expense_date', endDate);
    var adhocTotal = (adhocRes.data || []).reduce(function (s, r) { return s + (r.amount || 0); }, 0);

    var recurringTotal = await getRecurringExpensesProrated(startDate, endDate);

    return adhocTotal + recurringTotal;
  } catch (e) {
    return 0;
  }
}

// Prorates every active recurring expense across the given date range.
// A ₹15,000/month rent contributes (15000/30) per day of the range.
async function getRecurringExpensesProrated(startDate, endDate) {
  try {
    var res = await db.from('recurring_expenses').select('amount, frequency').eq('active', true);
    var rows = res.data || [];
    if (!rows.length) return 0;

    var days = Math.max(1, Math.round((new Date(endDate) - new Date(startDate)) / 86400000) + 1);

    return rows.reduce(function (sum, r) {
      var dailyRate = r.frequency === 'monthly' ? r.amount / 30
        : r.frequency === 'weekly' ? r.amount / 7
        : r.amount; // daily
      return sum + dailyRate * days;
    }, 0);
  } catch (e) {
    return 0;
  }
}

// ══════════════════════════════════════════════════════════════
// Admin FAB entry
// ══════════════════════════════════════════════════════════════
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
    + '<div style="font-size:11px;color:#9c0ca1;margin-top:1px">Purchases &amp; fixed costs</div></div>';
  fabMenu.appendChild(entry);
}

// ══════════════════════════════════════════════════════════════
// Main sheet — tabs: Today / History / Recurring
// ══════════════════════════════════════════════════════════════
var _deTab = 'today';

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
    + '<div style="padding:16px 20px 12px;border-bottom:1px solid #f0e8f8">'
    +   '<div style="font-size:9px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;'
    +     'color:#9c0ca1;margin-bottom:4px">Admin</div>'
    +   '<div style="display:flex;align-items:center;justify-content:space-between">'
    +     '<div style="font-size:18px;font-weight:700;color:#1a0820">Daily Expenses</div>'
    +     '<div onclick="closeExpenses()" style="width:34px;height:34px;border-radius:50%;'
    +       'background:#f5eeff;border:1px solid #e0c8f0;display:flex;align-items:center;'
    +       'justify-content:center;cursor:pointer;font-size:14px;color:#6e0977">✕</div>'
    +   '</div>'
    + '</div>'
    + '<div style="display:flex;gap:6px;padding:14px 20px 0">'
    +   '<div id="de-tab-today" onclick="deSetTab(\'today\')" style="flex:1;padding:9px;border-radius:10px;'
    +     'text-align:center;font-size:11px;font-weight:700;cursor:pointer;background:#6e0977;color:#fff">Today</div>'
    +   '<div id="de-tab-history" onclick="deSetTab(\'history\')" style="flex:1;padding:9px;border-radius:10px;'
    +     'text-align:center;font-size:11px;font-weight:700;cursor:pointer;border:1.5px solid rgba(18,10,30,0.1);color:#9a8aaa">History</div>'
    +   '<div id="de-tab-recurring" onclick="deSetTab(\'recurring\')" style="flex:1;padding:9px;border-radius:10px;'
    +     'text-align:center;font-size:11px;font-weight:700;cursor:pointer;border:1.5px solid rgba(18,10,30,0.1);color:#9a8aaa">🔁 Recurring</div>'
    + '</div>'
    + '<div id="de-body" style="padding:16px 20px 0"></div>';
  document.body.appendChild(sheet);
}

function openExpenses() {
  document.getElementById('de-overlay').style.display = 'block';
  document.getElementById('de-sheet').style.display   = 'block';
  deSetTab('today');
}
function closeExpenses() {
  document.getElementById('de-overlay').style.display = 'none';
  document.getElementById('de-sheet').style.display   = 'none';
}

function deSetTab(tab) {
  _deTab = tab;
  ['today', 'history', 'recurring'].forEach(function (t) {
    var el = document.getElementById('de-tab-' + t);
    if (!el) return;
    var on = t === tab;
    el.style.background = on ? '#6e0977' : 'transparent';
    el.style.color = on ? '#fff' : '#9a8aaa';
    el.style.border = on ? 'none' : '1.5px solid rgba(18,10,30,0.1)';
  });
  if (tab === 'today') renderTodayTab();
  else if (tab === 'history') renderHistoryTab();
  else renderRecurringTab();
}

// ══════════════════════════════════════════════════════════════
// TODAY — ad-hoc purchases
// ══════════════════════════════════════════════════════════════
async function renderTodayTab() {
  var body = document.getElementById('de-body');
  body.innerHTML = '<div style="text-align:center;padding:20px;color:#b090c0;font-size:12px">Loading…</div>';

  var today = deTodayStr();
  var res = await db.from('daily_expenses').select('*').eq('expense_date', today).order('created_at', { ascending: false });
  _deTodayList = res.data || [];
  var total = _deTodayList.reduce(function (s, r) { return s + (r.amount || 0); }, 0);

  var catOptions = EXPENSE_CATEGORIES.map(function (c) { return '<option>' + c + '</option>'; }).join('');

  body.innerHTML =
      '<div style="background:linear-gradient(135deg,rgba(220,38,38,0.08),rgba(220,38,38,0.02));'
    + 'border:1.5px solid rgba(220,38,38,0.25);border-radius:14px;padding:16px;text-align:center;margin-bottom:16px">'
    + '<div style="font-size:10px;font-weight:700;color:#dc2626;letter-spacing:1.5px">TODAY\'S PURCHASES</div>'
    + '<div style="font-family:Fraunces,Georgia,serif;font-size:28px;font-weight:900;color:#dc2626;margin-top:4px">₹' + total.toFixed(2) + '</div>'
    + '</div>'
    + '<select id="de-category" style="width:100%;padding:12px 10px;border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);'
    + 'font-family:inherit;font-size:13px;background:#fff;cursor:pointer;margin-bottom:10px">' + catOptions + '</select>'
    + '<input id="de-item-name" placeholder="What did you buy? (e.g. Milk 5L, Tomatoes 2kg)" style="width:100%;'
    + 'padding:12px 14px;border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);font-family:inherit;'
    + 'font-size:14px;outline:none;box-sizing:border-box;margin-bottom:10px">'
    + '<div style="display:flex;gap:8px;margin-bottom:10px">'
    + '<input id="de-amount" type="number" step="any" placeholder="Amount (₹)" style="flex:1;padding:12px 14px;'
    + 'border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);font-family:inherit;font-size:14px;outline:none;box-sizing:border-box">'
    + '<input id="de-vendor" placeholder="Vendor (optional)" style="flex:1;padding:12px 14px;'
    + 'border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);font-family:inherit;font-size:14px;outline:none;box-sizing:border-box">'
    + '</div>'
    + '<button onclick="addExpense()" style="width:100%;padding:13px;background:linear-gradient(135deg,#6e0977,#9c0ca1);'
    + 'color:#fff;font-size:13px;font-weight:700;border:none;border-radius:12px;cursor:pointer;margin-bottom:16px">➕ Add Expense</button>'
    + '<div id="de-today-list" style="display:flex;flex-direction:column;gap:8px"></div>';

  renderTodayExpenseList();
}

function renderTodayExpenseList() {
  var list = document.getElementById('de-today-list');
  if (!list) return;
  if (!_deTodayList.length) {
    list.innerHTML = '<div style="text-align:center;padding:20px;color:#b090c0;font-size:12px">No expenses logged yet today.</div>';
    return;
  }
  list.innerHTML = _deTodayList.map(function (r) {
    return '<div style="display:flex;align-items:center;justify-content:space-between;background:#f5eeff;'
      + 'border:1px solid #e0c8f0;border-radius:12px;padding:10px 14px">'
      + '<div style="flex:1"><div style="font-size:13px;font-weight:700;color:#1a0820">' + r.item_name + '</div>'
      + '<div style="font-size:11px;color:#9c0ca1">' + r.category + (r.vendor ? ' · ' + r.vendor : '') + '</div></div>'
      + '<div style="font-size:14px;font-weight:700;color:#dc2626;margin-right:8px">₹' + r.amount.toFixed(2) + '</div>'
      + '<div onclick="deleteExpense(\'' + r.id + '\')" style="width:26px;height:26px;border-radius:50%;background:#fff;'
      + 'border:1px solid #e0c8f0;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:12px;color:#e05080">✕</div>'
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
      expense_date: deTodayStr(), category: category, item_name: itemName,
      amount: amount, vendor: vendor || null, logged_by: deLogName()
    }]);
    showStoreToast('✅ ' + itemName + ' added');
    renderTodayTab();
  } catch (e) {
    showStoreToast('Error: ' + e.message);
  }
}

async function deleteExpense(id) {
  if (!confirm('Remove this expense entry?')) return;
  await db.from('daily_expenses').delete().eq('id', id);
  showStoreToast('Removed');
  renderTodayTab();
}

// ══════════════════════════════════════════════════════════════
// HISTORY — past ad-hoc expenses, grouped by date
// ══════════════════════════════════════════════════════════════
async function renderHistoryTab() {
  var body = document.getElementById('de-body');
  body.innerHTML = '<div style="text-align:center;padding:20px;color:#b090c0;font-size:12px">Loading…</div>';

  var res = await db.from('daily_expenses').select('*').order('expense_date', { ascending: false }).order('created_at', { ascending: false }).limit(100);
  var rows = res.data || [];
  if (!rows.length) {
    body.innerHTML = '<div style="text-align:center;padding:30px 20px;color:#b090c0;font-size:13px">No expenses logged yet.</div>';
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
  body.innerHTML = html;
}

// ══════════════════════════════════════════════════════════════
// RECURRING — fixed costs (rent, wages, electricity)
// ══════════════════════════════════════════════════════════════
async function renderRecurringTab() {
  var body = document.getElementById('de-body');
  body.innerHTML = '<div style="text-align:center;padding:20px;color:#b090c0;font-size:12px">Loading…</div>';

  var freqOptions = RECURRING_FREQUENCIES.map(function (f) {
    return '<option value="' + f + '">' + f.charAt(0).toUpperCase() + f.slice(1) + '</option>';
  }).join('');

  var res = await db.from('recurring_expenses').select('*').order('created_at', { ascending: false });
  var rows = res.data || [];
  var monthlyEquivalent = rows.filter(function (r) { return r.active; }).reduce(function (sum, r) {
    var monthly = r.frequency === 'monthly' ? r.amount : r.frequency === 'weekly' ? r.amount * 4.33 : r.amount * 30;
    return sum + monthly;
  }, 0);

  var listHtml = rows.length
    ? rows.map(function (r) {
        return '<div style="display:flex;align-items:center;justify-content:space-between;background:#f5eeff;'
          + 'border:1px solid #e0c8f0;border-radius:12px;padding:10px 14px;margin-bottom:8px' + (r.active ? '' : ';opacity:.5') + '">'
          + '<div style="flex:1"><div style="font-size:13px;font-weight:700;color:#1a0820">' + r.name + '</div>'
          + '<div style="font-size:11px;color:#9c0ca1">₹' + r.amount.toFixed(0) + ' / ' + r.frequency + (r.active ? '' : ' · inactive') + '</div></div>'
          + '<div onclick="toggleRecurringActive(\'' + r.id + '\',' + r.active + ')" style="font-size:10px;font-weight:700;padding:4px 10px;'
          + 'border-radius:20px;background:' + (r.active ? 'rgba(34,197,94,0.1)' : 'rgba(220,38,38,0.08)') + ';'
          + 'color:' + (r.active ? '#15803d' : '#dc2626') + ';cursor:pointer;margin-right:8px">' + (r.active ? 'Active' : 'Inactive') + '</div>'
          + '<div onclick="deleteRecurring(\'' + r.id + '\')" style="width:26px;height:26px;border-radius:50%;background:#fff;'
          + 'border:1px solid #e0c8f0;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:12px;color:#e05080">✕</div>'
          + '</div>';
      }).join('')
    : '<div style="text-align:center;padding:20px;color:#b090c0;font-size:12px">No recurring costs added yet.</div>';

  body.innerHTML =
      '<div style="background:linear-gradient(135deg,rgba(110,9,119,0.08),rgba(110,9,119,0.02));'
    + 'border:1.5px solid rgba(110,9,119,0.25);border-radius:14px;padding:16px;text-align:center;margin-bottom:16px">'
    + '<div style="font-size:10px;font-weight:700;color:#6e0977;letter-spacing:1.5px">MONTHLY FIXED COSTS TOTAL</div>'
    + '<div style="font-family:Fraunces,Georgia,serif;font-size:26px;font-weight:900;color:#6e0977;margin-top:4px">₹' + monthlyEquivalent.toFixed(0) + '</div>'
    + '<div style="font-size:10px;color:#9a8aaa;margin-top:4px">Automatically prorated into Net Profit for any period you view</div>'
    + '</div>'
    + '<input id="rec-name" placeholder="e.g. Shop Rent, Staff Wages, Electricity" style="width:100%;padding:12px 14px;'
    + 'border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);font-family:inherit;font-size:14px;outline:none;'
    + 'box-sizing:border-box;margin-bottom:10px">'
    + '<div style="display:flex;gap:8px;margin-bottom:10px">'
    + '<input id="rec-amount" type="number" step="any" placeholder="Amount (₹)" style="flex:1;padding:12px 14px;'
    + 'border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);font-family:inherit;font-size:14px;outline:none;box-sizing:border-box">'
    + '<select id="rec-frequency" style="flex:1;padding:12px 10px;border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);'
    + 'font-family:inherit;font-size:13px;background:#fff;cursor:pointer">' + freqOptions + '</select>'
    + '</div>'
    + '<button onclick="addRecurring()" style="width:100%;padding:13px;background:linear-gradient(135deg,#6e0977,#9c0ca1);'
    + 'color:#fff;font-size:13px;font-weight:700;border:none;border-radius:12px;cursor:pointer;margin-bottom:16px">➕ Add Recurring Cost</button>'
    + listHtml;
}

async function addRecurring() {
  var name = (document.getElementById('rec-name').value || '').trim();
  var amount = parseFloat(document.getElementById('rec-amount').value);
  var frequency = document.getElementById('rec-frequency').value;

  if (!name) { showStoreToast('Enter a name for this cost'); return; }
  if (isNaN(amount) || amount <= 0) { showStoreToast('Enter a valid amount'); return; }

  try {
    await db.from('recurring_expenses').insert([{ name: name, amount: amount, frequency: frequency, active: true, logged_by: deLogName() }]);
    showStoreToast('✅ ' + name + ' added');
    renderRecurringTab();
  } catch (e) {
    showStoreToast('Error: ' + e.message);
  }
}

async function toggleRecurringActive(id, current) {
  await db.from('recurring_expenses').update({ active: !current }).eq('id', id);
  renderRecurringTab();
}

async function deleteRecurring(id) {
  if (!confirm('Remove this recurring cost? This stops it counting toward future Net Profit calculations.')) return;
  await db.from('recurring_expenses').delete().eq('id', id);
  showStoreToast('Removed');
  renderRecurringTab();
}
