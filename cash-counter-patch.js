/**
 * cash-counter-patch.js — ChocoCravings On Store
 * Feature: Cash Counter — a running cash drawer balance that carries
 * over day to day (yesterday's closing = today's opening, mechanically,
 * since it's one continuous ledger). Staff can add or subtract amounts
 * anytime (change from bank, petty cash taken out, correcting a miscount,
 * etc.) with a note, and see the full history.
 *
 * Load AFTER store-patch.js, right before </body>:
 *   <script src="cash-counter-patch.js"></script>
 *
 * Requires DB setup: run add-cash-counter-table.sql once.
 * Requires: `db`, `showStoreToast()` — already global.
 * Gated the same way as Daily Expenses/Day Close — any confirmed Admin.
 */

function _ccInit() {
  buildCashCounterUI();
  waitForAdminThenInjectCashCounter();
}
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _ccInit); } else { _ccInit(); }

function waitForAdminThenInjectCashCounter() {
  var attempts = 0;
  var poll = setInterval(function () {
    attempts++;
    if (typeof isAdmin !== 'undefined' && isAdmin) {
      clearInterval(poll);
      injectCashCounterMenuEntry();
    } else if (attempts >= 20) {
      clearInterval(poll);
    }
  }, 300);
}

function injectCashCounterMenuEntry() {
  registerAdminTool('Financial', {
    icon: '💵', iconBg: 'rgba(34,197,94,0.12)',
    title: 'Cash Counter', subtitle: 'Running cash drawer balance',
    onClick: openCashCounter
  });
}

function buildCashCounterUI() {
  var overlay = document.createElement('div');
  overlay.id = 'cc-overlay';
  overlay.onclick = closeCashCounter;
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);'
    + 'z-index:4000;backdrop-filter:blur(4px)';
  document.body.appendChild(overlay);

  var sheet = document.createElement('div');
  sheet.id = 'cc-sheet';
  sheet.style.cssText = 'display:none;position:fixed;bottom:0;left:0;right:0;background:#fff;'
    + 'border-radius:22px 22px 0 0;border-top:1px solid #e8d0f0;z-index:4001;'
    + 'padding:0 0 28px;font-family:\'DM Sans\',sans-serif;max-height:90vh;overflow-y:auto';
  sheet.innerHTML =
      '<div style="width:40px;height:4px;border-radius:2px;background:#ddd0ea;margin:14px auto 0"></div>'
    + '<div style="padding:16px 20px 12px;border-bottom:1px solid #f0e8f8">'
    +   '<div style="font-size:9px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;'
    +     'color:#9c0ca1;margin-bottom:4px">Admin</div>'
    +   '<div style="display:flex;align-items:center;justify-content:space-between">'
    +     '<div style="font-size:18px;font-weight:700;color:#1a0820">Cash Counter</div>'
    +     '<div onclick="closeCashCounter()" style="width:34px;height:34px;border-radius:50%;'
    +       'background:#f5eeff;border:1px solid #e0c8f0;display:flex;align-items:center;'
    +       'justify-content:center;cursor:pointer;font-size:14px;color:#6e0977">✕</div>'
    +   '</div>'
    + '</div>'
    + '<div id="cc-body" style="padding:16px 20px 0"></div>';
  document.body.appendChild(sheet);
}

function openCashCounter() {
  document.getElementById('cc-overlay').style.display = 'block';
  document.getElementById('cc-sheet').style.display   = 'block';
  loadCashCounter();
}
function closeCashCounter() {
  document.getElementById('cc-overlay').style.display = 'none';
  document.getElementById('cc-sheet').style.display   = 'none';
}

async function getCashCounterBalance() {
  var res = await db.from('cash_counter_entries').select('amount');
  return (res.data || []).reduce(function (s, r) { return s + (r.amount || 0); }, 0);
}

async function loadCashCounter() {
  var body = document.getElementById('cc-body');
  body.innerHTML = '<div style="text-align:center;padding:30px;color:#9a8aaa;font-size:12px">Loading…</div>';

  var balance = await getCashCounterBalance();
  var todayRes = await db.from('cash_counter_entries').select('*')
    .eq('entry_date', new Date().toISOString().slice(0, 10))
    .order('created_at', { ascending: false });
  var todayEntries = todayRes.data || [];

  var hasAnyEntries = (await db.from('cash_counter_entries').select('id').limit(1)).data.length > 0;

  var entriesHtml = todayEntries.length
    ? todayEntries.map(function (r) {
        var isAdd = r.amount >= 0;
        var time = new Date(r.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
        return '<div style="display:flex;justify-content:space-between;align-items:center;background:#f5eeff;'
          + 'border:1px solid #e0c8f0;border-radius:12px;padding:11px 14px;margin-bottom:8px">'
          + '<div><div style="font-size:13px;font-weight:700;color:#1a0820">' + (r.note || (isAdd ? 'Cash added' : 'Cash removed')) + '</div>'
          + '<div style="font-size:11px;color:#9a8aaa">' + time + (r.staff_name ? ' · ' + r.staff_name : '') + '</div></div>'
          + '<div style="font-size:14px;font-weight:700;color:' + (isAdd ? '#15803d' : '#dc2626') + '">'
          + (isAdd ? '+' : '') + '₹' + r.amount + '</div></div>';
      }).join('')
    : '<div style="text-align:center;padding:16px;color:#9a8aaa;font-size:12px">No adjustments logged today yet.</div>';

  body.innerHTML =
      '<div style="background:linear-gradient(135deg,rgba(184,116,16,0.1),rgba(184,116,16,0.02));'
    + 'border:1.5px solid rgba(184,116,16,0.3);border-radius:16px;padding:20px;text-align:center;margin-bottom:16px">'
    + '<div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#b87410">CURRENT CASH BALANCE</div>'
    + '<div style="font-family:Fraunces,Georgia,serif;font-size:36px;font-weight:900;color:#b87410;margin-top:4px">₹' + balance.toFixed(0) + '</div>'
    + '</div>'
    + (!hasAnyEntries
        ? '<div style="background:#fff8e6;border:1.5px solid rgba(245,196,48,0.35);border-radius:14px;padding:14px;'
          + 'margin-bottom:16px;font-size:12px;color:#8a6a1a">💡 No entries yet — this counter starts at ₹0. If you already '
          + 'have cash in the drawer, log it below as your first adjustment (e.g. "Initial cash on hand").</div>'
        : '')
    + '<div style="display:flex;gap:8px;margin-bottom:10px">'
    + '<button onclick="ccSetAdjustType(\'add\')" id="cc-type-add" class="cc-type-btn cc-type-on" '
    + 'style="flex:1;padding:11px;border-radius:12px;border:1.5px solid rgba(34,197,94,0.35);'
    + 'background:rgba(34,197,94,0.1);color:#15803d;font-size:13px;font-weight:700;cursor:pointer">➕ Add Cash</button>'
    + '<button onclick="ccSetAdjustType(\'subtract\')" id="cc-type-subtract" class="cc-type-btn" '
    + 'style="flex:1;padding:11px;border-radius:12px;border:1.5px solid rgba(18,10,30,0.1);'
    + 'background:#fff;color:#9a8aaa;font-size:13px;font-weight:700;cursor:pointer">➖ Remove Cash</button>'
    + '</div>'
    + '<input id="cc-amount" type="number" step="any" placeholder="Amount (₹)" style="width:100%;padding:12px 14px;'
    + 'border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);font-family:inherit;font-size:14px;'
    + 'outline:none;box-sizing:border-box;margin-bottom:10px">'
    + '<input id="cc-note" placeholder="Note (e.g. Change from bank, Milk purchase)" style="width:100%;padding:12px 14px;'
    + 'border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);font-family:inherit;font-size:14px;'
    + 'outline:none;box-sizing:border-box;margin-bottom:14px">'
    + '<button onclick="ccSubmitAdjustment()" style="width:100%;padding:13px;background:linear-gradient(135deg,#6e0977,#9c0ca1);'
    + 'color:#fff;font-size:13px;font-weight:700;border:none;border-radius:12px;cursor:pointer;margin-bottom:18px">💾 Log Adjustment</button>'
    + '<div style="font-size:11px;letter-spacing:2px;color:#c2607a;font-weight:700;margin-bottom:10px">TODAY\'S ADJUSTMENTS</div>'
    + entriesHtml;
}

var _ccAdjustType = 'add';
function ccSetAdjustType(type) {
  _ccAdjustType = type;
  var addBtn = document.getElementById('cc-type-add');
  var subBtn = document.getElementById('cc-type-subtract');
  if (type === 'add') {
    addBtn.style.background = 'rgba(34,197,94,0.1)'; addBtn.style.borderColor = 'rgba(34,197,94,0.35)'; addBtn.style.color = '#15803d';
    subBtn.style.background = '#fff'; subBtn.style.borderColor = 'rgba(18,10,30,0.1)'; subBtn.style.color = '#9a8aaa';
  } else {
    subBtn.style.background = 'rgba(220,38,38,0.1)'; subBtn.style.borderColor = 'rgba(220,38,38,0.35)'; subBtn.style.color = '#dc2626';
    addBtn.style.background = '#fff'; addBtn.style.borderColor = 'rgba(18,10,30,0.1)'; addBtn.style.color = '#9a8aaa';
  }
}

async function ccSubmitAdjustment() {
  var amountRaw = parseFloat(document.getElementById('cc-amount').value);
  var note = document.getElementById('cc-note').value.trim();

  if (isNaN(amountRaw) || amountRaw <= 0) { showStoreToast('Enter a valid amount'); return; }

  var signedAmount = _ccAdjustType === 'add' ? amountRaw : -amountRaw;
  var staffName = (typeof _staffSession !== 'undefined' && _staffSession && _staffSession.name)
    ? _staffSession.name
    : 'Admin';

  try {
    await db.from('cash_counter_entries').insert([{
      entry_type: 'adjustment',
      amount: signedAmount,
      note: note || null,
      staff_name: staffName
    }]);
    showStoreToast('✅ Logged ' + (_ccAdjustType === 'add' ? '+₹' : '-₹') + amountRaw);
    loadCashCounter();
  } catch (e) {
    showStoreToast('Error: ' + e.message);
  }
}
