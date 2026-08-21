/**
 * day-close-patch.js — ChocoCravings On Store
 * Feature: Day Close — daily cash/sales reconciliation.
 *
 * Shows today's revenue broken down by payment method, with the key
 * number being EXPECTED CASH IN DRAWER (cash orders actually marked
 * paid — pending COD is shown separately, not counted as collected
 * cash yet). Admin enters what was actually counted, sees the
 * difference, and can save/close the day for a permanent record.
 *
 * Load AFTER store-patch.js, right before </body>:
 *   <script src="day-close-patch.js"></script>
 *
 * Requires DB setup: run create-day-close-table.sql once in Supabase.
 * Requires: `db`, `showStoreToast()` — already global on this page.
 */

var _dcRecord = null; // existing close record for today, if any

document.addEventListener('DOMContentLoaded', function () {
  buildDayCloseUI(); // DOM setup only, no query — safe to always run
  // No FAB entry injected here anymore — reports-hub-patch.js owns the
  // single "📈 Reports" entry and calls openDayClose() directly when its
  // "Daily Close Reports" card is tapped, gated by the super-user check
  // there instead of the plain isAdmin check this file used before.
});

function dcLogName() {
  if (typeof _staffSession !== 'undefined' && _staffSession && _staffSession.name) return _staffSession.name;
  if (typeof isAdmin !== 'undefined' && isAdmin) return 'Admin';
  return null;
}

function dcTodayStr() {
  return new Date().toISOString().slice(0, 10);
}


function buildDayCloseUI() {
  var overlay = document.createElement('div');
  overlay.id = 'dc-overlay';
  overlay.onclick = closeDayClose;
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);'
    + 'z-index:3700;backdrop-filter:blur(4px)';
  document.body.appendChild(overlay);

  var sheet = document.createElement('div');
  sheet.id = 'dc-sheet';
  sheet.style.cssText = 'display:none;position:fixed;bottom:0;left:0;right:0;background:#fff;'
    + 'border-radius:22px 22px 0 0;border-top:1px solid #e8d0f0;z-index:3701;'
    + 'padding:0 0 28px;font-family:\'DM Sans\',sans-serif;max-height:90vh;overflow-y:auto';
  sheet.innerHTML =
      '<div style="width:40px;height:4px;border-radius:2px;background:#ddd0ea;margin:14px auto 0"></div>'
    + '<div style="padding:16px 20px 12px;border-bottom:1px solid #f0e8f8;display:flex;'
    +   'align-items:center;justify-content:space-between">'
    +   '<div>'
    +     '<div style="font-size:9px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;'
    +       'color:#9c0ca1;margin-bottom:4px">Admin</div>'
    +     '<div style="font-size:18px;font-weight:700;color:#1a0820">Day Close</div>'
    +   '</div>'
    +   '<div style="display:flex;gap:8px;align-items:center">'
    +     '<div onclick="openDcHistory()" style="font-size:11px;font-weight:700;color:#6e0977;'
    +       'cursor:pointer;padding:8px 12px;background:#f5eeff;border-radius:10px">📜 History</div>'
    +     '<div onclick="closeDayClose()" style="width:34px;height:34px;border-radius:50%;'
    +       'background:#f5eeff;border:1px solid #e0c8f0;display:flex;align-items:center;'
    +       'justify-content:center;cursor:pointer;font-size:14px;color:#6e0977">✕</div>'
    +   '</div>'
    + '</div>'
    + '<div id="dc-body" style="padding:16px 20px 0"></div>';
  document.body.appendChild(sheet);

  buildDcHistoryUI();
}

function openDayClose() {
  document.getElementById('dc-overlay').style.display = 'block';
  document.getElementById('dc-sheet').style.display   = 'block';
  loadDayClose();
}
function closeDayClose() {
  document.getElementById('dc-overlay').style.display = 'none';
  document.getElementById('dc-sheet').style.display   = 'none';
  if (typeof openReportsHub === 'function') openReportsHub();
}

async function loadDayClose() {
  var body = document.getElementById('dc-body');
  body.innerHTML = '<div style="text-align:center;padding:30px;color:#b090c0;font-size:12px">Loading…</div>';

  var today = dcTodayStr();

  var res = await db.from('store_orders')
    .select('total, payment_method, payment_status, status')
    .gte('created_at', today + 'T00:00:00.000Z')
    .lt('created_at', today + 'T23:59:59.999Z')
    .not('status', 'eq', 'cancelled');
  var orders = res.data || [];

  var totalRevenue = 0, totalOrders = orders.length;
  var cashPaid = 0, cashPending = 0, upiTotal = 0, otherDigital = 0, complimentary = 0;

  orders.forEach(function (o) {
    var amt = o.total || 0;
    totalRevenue += amt;
    var pm = (o.payment_method || '').toLowerCase();
    if (o.payment_status === 'complimentary') {
      complimentary += amt;
    } else if (pm === 'cash') {
      if (o.payment_status === 'paid') cashPaid += amt; else cashPending += amt;
    } else if (pm === 'upi' || pm === 'upi_qr') {
      upiTotal += amt;
    } else {
      otherDigital += amt;
    }
  });

  var existingRes = await db.from('day_close_records').select('*').eq('close_date', today).maybeSingle();
  _dcRecord = existingRes.data || null;

  // Uses the shared getExpensesTotal() helper from daily-expenses-patch.js
  // if it's loaded — falls back to 0 gracefully if that patch isn't
  // present, so Day Close never breaks without it.
  var todayExpenses = typeof getExpensesTotal === 'function' ? await getExpensesTotal(today, today) : 0;
  var netProfit = totalRevenue - todayExpenses;

  var statusBadge = _dcRecord && _dcRecord.closed_at
    ? '<div style="display:inline-flex;align-items:center;gap:6px;background:rgba(34,197,94,0.1);'
      + 'border:1px solid rgba(34,197,94,0.3);border-radius:20px;padding:5px 12px;font-size:11px;'
      + 'font-weight:700;color:#15803d;margin-bottom:14px">✅ Closed at '
      + new Date(_dcRecord.closed_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
      + (_dcRecord.closed_by ? ' by ' + _dcRecord.closed_by : '') + '</div>'
    : '<div style="display:inline-flex;align-items:center;gap:6px;background:#fff8e6;'
      + 'border:1px solid #f5c430;border-radius:20px;padding:5px 12px;font-size:11px;'
      + 'font-weight:700;color:#8a6a1a;margin-bottom:14px">⚠️ Not closed yet today</div>';

  var rows = [
    { label: '💵 Cash (Collected)', amt: cashPaid, color: '#15803d' },
    { label: '📱 UPI', amt: upiTotal, color: '#6e0977' },
    { label: '💳 Other Digital', amt: otherDigital, color: '#b87410' },
    { label: '🎁 Complimentary', amt: complimentary, color: '#c084fc' },
    { label: '⏳ Cash (Pending COD)', amt: cashPending, color: '#dc2626' }
  ];

  var breakdownHtml = rows.map(function (r) {
    return '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;'
      + 'border-bottom:1px solid #f5f0f8">'
      + '<span style="font-size:13px;color:#1a0820;font-weight:600">' + r.label + '</span>'
      + '<span style="font-size:14px;font-weight:700;color:' + r.color + '">₹' + r.amt.toFixed(2) + '</span>'
      + '</div>';
  }).join('');

  var savedActual = _dcRecord && _dcRecord.cash_actual_counted != null ? _dcRecord.cash_actual_counted : '';
  var savedNotes = _dcRecord && _dcRecord.notes ? _dcRecord.notes : '';

  body.innerHTML = statusBadge
    + '<div style="display:flex;gap:10px;margin-bottom:10px">'
    + '<div style="flex:1;background:#f5eeff;border-radius:14px;padding:14px;text-align:center">'
    + '<div style="font-size:10px;font-weight:700;color:#9c0ca1;letter-spacing:1px">TOTAL REVENUE</div>'
    + '<div style="font-family:Fraunces,Georgia,serif;font-size:24px;font-weight:900;color:#6e0977;margin-top:4px">₹' + totalRevenue.toFixed(2) + '</div>'
    + '</div>'
    + '<div style="flex:1;background:#f5eeff;border-radius:14px;padding:14px;text-align:center">'
    + '<div style="font-size:10px;font-weight:700;color:#9c0ca1;letter-spacing:1px">TOTAL ORDERS</div>'
    + '<div style="font-family:Fraunces,Georgia,serif;font-size:24px;font-weight:900;color:#6e0977;margin-top:4px">' + totalOrders + '</div>'
    + '</div></div>'

    + '<div style="display:flex;gap:10px;margin-bottom:16px">'
    + '<div style="flex:1;background:rgba(220,38,38,0.06);border:1px solid rgba(220,38,38,0.2);border-radius:14px;padding:14px;text-align:center">'
    + '<div style="font-size:10px;font-weight:700;color:#dc2626;letter-spacing:1px">TODAY\'S EXPENSES</div>'
    + '<div style="font-family:Fraunces,Georgia,serif;font-size:22px;font-weight:900;color:#dc2626;margin-top:4px">₹' + todayExpenses.toFixed(2) + '</div>'
    + '</div>'
    + '<div style="flex:1;background:' + (netProfit >= 0 ? 'rgba(34,197,94,0.08)' : 'rgba(220,38,38,0.08)') + ';'
    + 'border:1px solid ' + (netProfit >= 0 ? 'rgba(34,197,94,0.25)' : 'rgba(220,38,38,0.25)') + ';border-radius:14px;padding:14px;text-align:center">'
    + '<div style="font-size:10px;font-weight:700;color:' + (netProfit >= 0 ? '#15803d' : '#dc2626') + ';letter-spacing:1px">NET PROFIT</div>'
    + '<div style="font-family:Fraunces,Georgia,serif;font-size:22px;font-weight:900;color:' + (netProfit >= 0 ? '#15803d' : '#dc2626') + ';margin-top:4px">₹' + netProfit.toFixed(2) + '</div>'
    + '</div></div>'

    + '<div style="font-size:10px;letter-spacing:2px;color:#c2607a;font-weight:700;margin-bottom:6px">PAYMENT BREAKDOWN</div>'
    + '<div style="background:#fff;border:1.5px solid #e0c8f0;border-radius:14px;padding:4px 14px;margin-bottom:16px">'
    + breakdownHtml
    + '</div>'

    + '<div style="background:linear-gradient(135deg,rgba(34,197,94,0.1),rgba(34,197,94,0.03));'
    + 'border:1.5px solid rgba(34,197,94,0.3);border-radius:14px;padding:16px;margin-bottom:16px;text-align:center">'
    + '<div style="font-size:10px;font-weight:700;color:#15803d;letter-spacing:1.5px">💰 EXPECTED CASH IN DRAWER</div>'
    + '<div style="font-family:Fraunces,Georgia,serif;font-size:30px;font-weight:900;color:#15803d;margin-top:6px">₹' + cashPaid.toFixed(2) + '</div>'
    + (cashPending > 0 ? '<div style="font-size:11px;color:#dc2626;margin-top:6px">+ ₹' + cashPending.toFixed(2) + ' pending COD not counted here yet</div>' : '')
    + '</div>'

    + '<div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:#9c0ca1;margin-bottom:6px">ACTUAL CASH COUNTED</div>'
    + '<input id="dc-actual-cash" type="number" step="any" placeholder="Enter counted amount" value="' + savedActual + '" '
    + 'oninput="dcUpdateDifference(' + cashPaid + ')" style="width:100%;padding:13px 14px;border-radius:12px;'
    + 'border:1.5px solid rgba(18,10,30,0.12);font-family:inherit;font-size:16px;outline:none;'
    + 'box-sizing:border-box;margin-bottom:10px">'

    + '<div id="dc-diff-display" style="text-align:center;padding:10px;border-radius:10px;margin-bottom:14px;'
    + 'font-size:13px;font-weight:700"></div>'

    + '<textarea id="dc-notes" placeholder="Notes (optional) — e.g. reason for any mismatch" style="width:100%;'
    + 'padding:12px 14px;border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);font-family:inherit;'
    + 'font-size:13px;outline:none;box-sizing:border-box;min-height:60px;resize:vertical;margin-bottom:16px">' + savedNotes + '</textarea>'

    + '<button onclick="saveDayClose(' + totalRevenue + ',' + totalOrders + ',' + cashPaid + ',' + cashPending + ',' + upiTotal + ',' + otherDigital + ',' + complimentary + ')" '
    + 'style="width:100%;padding:15px;background:linear-gradient(135deg,#6e0977,#9c0ca1);color:#fff;'
    + 'font-size:13px;font-weight:700;border:none;border-radius:14px;cursor:pointer;letter-spacing:.5px">'
    + (_dcRecord && _dcRecord.closed_at ? '✅ Update Close Record' : '✅ Close Day') + '</button>';

  dcUpdateDifference(cashPaid);
}

function dcUpdateDifference(expected) {
  var actualInput = document.getElementById('dc-actual-cash');
  var display = document.getElementById('dc-diff-display');
  if (!actualInput || !display) return;

  var actual = parseFloat(actualInput.value);
  if (isNaN(actual)) {
    display.style.background = '#f5f0f8';
    display.style.color = '#9a8aaa';
    display.textContent = 'Enter the counted amount to see the difference';
    return;
  }

  var diff = actual - expected;
  if (Math.abs(diff) < 0.01) {
    display.style.background = 'rgba(34,197,94,0.1)';
    display.style.color = '#15803d';
    display.textContent = '✅ Matches exactly';
  } else if (diff > 0) {
    display.style.background = 'rgba(59,130,246,0.1)';
    display.style.color = '#2563eb';
    display.textContent = '+ ₹' + diff.toFixed(2) + ' over';
  } else {
    display.style.background = 'rgba(220,38,38,0.1)';
    display.style.color = '#dc2626';
    display.textContent = '− ₹' + Math.abs(diff).toFixed(2) + ' short';
  }
}

async function saveDayClose(totalRevenue, totalOrders, cashPaid, cashPending, upiTotal, otherDigital, complimentary) {
  var actualInput = document.getElementById('dc-actual-cash');
  var actual = parseFloat(actualInput.value);
  if (isNaN(actual)) { showStoreToast('Enter the actual cash counted first'); return; }

  var notes = (document.getElementById('dc-notes').value || '').trim();
  var diff = actual - cashPaid;
  var today = dcTodayStr();

  try {
    var res = await db.from('day_close_records').upsert({
      close_date: today,
      total_revenue: totalRevenue,
      total_orders: totalOrders,
      cash_paid: cashPaid,
      cash_pending: cashPending,
      upi_total: upiTotal,
      other_digital_total: otherDigital,
      complimentary_total: complimentary,
      cash_actual_counted: actual,
      cash_difference: diff,
      notes: notes || null,
      closed_by: dcLogName(),
      closed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: 'close_date' });

    if (res.error) throw res.error;
    showStoreToast('✅ Day closed — ' + (Math.abs(diff) < 0.01 ? 'matches exactly' : (diff > 0 ? '+₹' + diff.toFixed(2) + ' over' : '−₹' + Math.abs(diff).toFixed(2) + ' short')));
    loadDayClose();
  } catch (e) {
    showStoreToast('Error: ' + e.message);
  }
}

function buildDcHistoryUI() {
  var overlay = document.createElement('div');
  overlay.id = 'dc-hist-overlay';
  overlay.onclick = closeDcHistory;
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);'
    + 'z-index:3800;backdrop-filter:blur(4px)';
  document.body.appendChild(overlay);

  var sheet = document.createElement('div');
  sheet.id = 'dc-hist-sheet';
  sheet.style.cssText = 'display:none;position:fixed;bottom:0;left:0;right:0;background:#fff;'
    + 'border-radius:22px 22px 0 0;border-top:1px solid #e8d0f0;z-index:3801;'
    + 'padding:0 0 28px;font-family:\'DM Sans\',sans-serif;max-height:85vh;overflow-y:auto';
  sheet.innerHTML =
      '<div style="width:40px;height:4px;border-radius:2px;background:#ddd0ea;margin:14px auto 0"></div>'
    + '<div style="padding:16px 20px 12px;border-bottom:1px solid #f0e8f8;display:flex;'
    +   'align-items:center;justify-content:space-between">'
    +   '<div style="font-size:18px;font-weight:700;color:#1a0820">Day Close History</div>'
    +   '<div onclick="closeDcHistory()" style="width:34px;height:34px;border-radius:50%;'
    +     'background:#f5eeff;border:1px solid #e0c8f0;display:flex;align-items:center;'
    +     'justify-content:center;cursor:pointer;font-size:14px;color:#6e0977">✕</div>'
    + '</div>'
    + '<div id="dc-hist-list" style="padding:16px 20px;display:flex;flex-direction:column;gap:8px"></div>';
  document.body.appendChild(sheet);
}

function openDcHistory() {
  document.getElementById('dc-hist-overlay').style.display = 'block';
  document.getElementById('dc-hist-sheet').style.display   = 'block';
  loadDcHistory();
}
function closeDcHistory() {
  document.getElementById('dc-hist-overlay').style.display = 'none';
  document.getElementById('dc-hist-sheet').style.display   = 'none';
}

async function loadDcHistory() {
  var list = document.getElementById('dc-hist-list');
  list.innerHTML = '<div style="text-align:center;padding:20px;color:#b090c0;font-size:12px">Loading…</div>';

  var res = await db.from('day_close_records').select('*').order('close_date', { ascending: false }).limit(30);
  var rows = res.data || [];

  if (!rows.length) {
    list.innerHTML = '<div style="text-align:center;padding:30px 20px;color:#b090c0;font-size:13px">No closed days yet.</div>';
    return;
  }

  list.innerHTML = rows.map(function (r) {
    var diff = r.cash_difference || 0;
    var diffColor = Math.abs(diff) < 0.01 ? '#15803d' : (diff > 0 ? '#2563eb' : '#dc2626');
    var diffTxt = Math.abs(diff) < 0.01 ? '✅ Matched' : (diff > 0 ? '+₹' + diff.toFixed(2) + ' over' : '−₹' + Math.abs(diff).toFixed(2) + ' short');
    return '<div style="background:#f5eeff;border:1px solid #e0c8f0;border-radius:12px;padding:12px 14px">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'
      + '<span style="font-size:13px;font-weight:700;color:#1a0820">' + r.close_date + '</span>'
      + '<span style="font-size:12px;font-weight:700;color:' + diffColor + '">' + diffTxt + '</span>'
      + '</div>'
      + '<div style="font-size:11px;color:#9a8aaa">Revenue ₹' + (r.total_revenue || 0).toFixed(2) + ' · '
      + (r.total_orders || 0) + ' orders · ' + (r.closed_by ? 'closed by ' + r.closed_by : 'not closed')
      + '</div>'
      + (r.notes ? '<div style="font-size:11px;color:#6e0977;margin-top:4px;font-style:italic">' + r.notes + '</div>' : '')
      + '</div>';
  }).join('');
}
