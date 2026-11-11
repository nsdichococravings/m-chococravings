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

// A function (not a var): _ccInit() runs before this line is reached.
function ccxCss() { return ''
  + '#cc-overlay{position:fixed;inset:0;background:rgba(26,8,32,.5);z-index:4000;backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px)}'
  + '#cc-sheet{position:fixed;bottom:0;left:0;right:0;z-index:4001;max-height:92vh;overflow-y:auto;background:#faf6f0;color:#24112b;'
  +   'border-radius:28px 28px 0 0;font-family:"DM Sans",sans-serif;box-shadow:0 -20px 50px -20px rgba(26,8,32,.45);-webkit-font-smoothing:antialiased}'
  + '@media(min-width:700px){#cc-sheet{left:50%;right:auto;width:560px;transform:translateX(-50%)}}'
  + '.ccx-hd{position:sticky;top:0;z-index:2;color:#fff;padding:12px 20px 20px;border-radius:28px 28px 22px 22px;'
  +   'background:radial-gradient(120% 90% at 100% 0%,rgba(255,233,194,.18),transparent 60%),linear-gradient(160deg,#2b0a35 0%,#5a0b63 55%,#1a0820 100%)}'
  + '.ccx-grab{width:42px;height:4px;border-radius:2px;background:rgba(255,255,255,.3);margin:0 auto 12px}'
  + '.ccx-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}'
  + '.ccx-eb{font-size:10px;font-weight:700;letter-spacing:.26em;text-transform:uppercase;color:rgba(255,233,194,.78)}'
  + '.ccx-t{font-family:"Cormorant Garamond",Georgia,serif;font-size:32px;font-weight:600;line-height:1;margin-top:4px}'
  + '.ccx-t em{font-style:italic;color:#e8c98f;font-weight:500}'
  + '.ccx-x{flex:none;width:38px;height:38px;border-radius:50%;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#fff;font-size:14px;cursor:pointer}'
  + '.ccx-bal{margin-top:18px;text-align:center}'
  + '.ccx-bal small{display:block;font-size:10px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:rgba(255,233,194,.75)}'
  + '.ccx-bal b{display:block;font-family:"Cormorant Garamond",Georgia,serif;font-size:52px;font-weight:700;line-height:1.05;color:#ffe9c2;margin-top:4px}'
  + '.ccx-row{display:grid;grid-template-columns:repeat(3,1fr);margin-top:16px;border-radius:18px;background:rgba(255,255,255,.07);border:1px solid rgba(255,233,194,.18);overflow:hidden}'
  + '.ccx-row>div{padding:10px 6px;text-align:center}.ccx-row>div+div{border-left:1px solid rgba(255,233,194,.18)}'
  + '.ccx-row span{display:block;font-size:9px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;color:rgba(255,255,255,.6)}'
  + '.ccx-row b{display:block;font-family:"Cormorant Garamond",Georgia,serif;font-size:20px;font-weight:700;margin-top:3px;color:#fff7ea}'
  + '.ccx-row .in b{color:#9fdcb7}.ccx-row .out b{color:#f4a3b3}'
  + '.ccx-upd{font-size:10.5px;color:rgba(255,255,255,.55);margin-top:10px;text-align:center}'
  + '.ccx-upd button{border:0;background:none;color:#ffe9c2;font:700 10.5px "DM Sans",sans-serif;cursor:pointer;text-decoration:underline;text-underline-offset:2px}'
  + '#cc-body{padding:16px 16px calc(24px + env(safe-area-inset-bottom))}'
  + '.ccx-card{background:#fffdfa;border:1px solid #ece2d8;border-radius:22px;padding:16px;margin-bottom:14px;box-shadow:0 10px 30px -18px rgba(58,10,70,.18)}'
  + '.ccx-h{display:flex;align-items:center;gap:10px;font-size:10px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#b08d57;margin:0 0 12px}'
  + '.ccx-h::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,#ece2d8,transparent)}'
  + '.ccx-seg{display:flex;gap:4px;padding:4px;border-radius:999px;background:#f3ece4;margin-bottom:12px}'
  + '.ccx-seg button{flex:1;min-height:40px;border:0;border-radius:999px;background:transparent;color:#4a3a50;font:600 13px "DM Sans",sans-serif;cursor:pointer}'
  + '.ccx-seg button.on.add{background:#fff;color:#2f7a4b;box-shadow:0 0 0 1px #d3e8da,0 6px 14px -10px rgba(47,122,75,.6)}'
  + '.ccx-seg button.on.sub{background:#fff;color:#a33a52;box-shadow:0 0 0 1px #f3dde2,0 6px 14px -10px rgba(163,58,82,.6)}'
  + '.ccx-in{display:block;width:100%;box-sizing:border-box;padding:13px 14px;border-radius:14px;border:1px solid #ece2d8;background:#fff;font:400 15px "DM Sans",sans-serif;color:#24112b;outline:none;margin-bottom:10px}'
  + '.ccx-in:focus{border-color:#6e0977;box-shadow:0 0 0 3px rgba(110,9,119,.08)}'
  + '.ccx-amt{font-family:"Cormorant Garamond",Georgia,serif;font-size:24px;font-weight:700}'
  + '.ccx-cta{width:100%;min-height:52px;border:0;border-radius:999px;color:#fff;font:600 13.5px "DM Sans",sans-serif;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;'
  +   'background:linear-gradient(135deg,#3a0a46 0%,#6e0977 60%,#8e1a8f 100%);box-shadow:0 0 0 1px rgba(176,141,87,.35) inset,0 12px 26px -12px rgba(58,10,70,.55)}'
  + '.ccx-note{font-size:12px;line-height:1.5;color:#6b5228;background:#f6eedf;border:1px solid #ecdcbf;border-radius:16px;padding:12px 14px;margin-bottom:14px}'
  + '.ccx-e{display:flex;align-items:center;gap:12px;padding:12px 0;border-top:1px solid #f3ece4}'
  + '.ccx-h+.ccx-e{border-top:0;padding-top:0}'
  + '.ccx-ic{flex:none;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:700}'
  + '.ccx-ic.cafe{background:#f7eef6;color:#6e0977}.ccx-ic.store{background:#f6eedf;color:#8a6a33}.ccx-ic.adj{background:#f3ece4;color:#4a3a50}'
  + '.ccx-e-m{flex:1;min-width:0}.ccx-e-m b{display:block;font-size:13px;font-weight:600;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}'
  + '.ccx-e-m small{display:block;font-size:11px;color:#8d7f90;margin-top:2px}'
  + '.ccx-e-v{flex:none;font-family:"Cormorant Garamond",Georgia,serif;font-size:20px;font-weight:700}'
  + '.ccx-e-v.in{color:#2f7a4b}.ccx-e-v.out{color:#a33a52}'
  + '.ccx-empty{text-align:center;padding:14px;color:#8d7f90;font-size:12.5px}';
}

function buildCashCounterUI() {
  if (!document.getElementById('ccx-css')) { var st = document.createElement('style'); st.id = 'ccx-css'; st.textContent = ccxCss(); document.head.appendChild(st); }
  var overlay = document.createElement('div');
  overlay.id = 'cc-overlay';
  overlay.onclick = closeCashCounter;
  overlay.style.display = 'none';
  document.body.appendChild(overlay);

  var sheet = document.createElement('div');
  sheet.id = 'cc-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Cash Counter');
  sheet.style.display = 'none';
  sheet.innerHTML = '<div class="ccx-hd" id="ccx-hd"><div class="ccx-grab"></div><div class="ccx-top"><div><div class="ccx-eb">Admin</div><div class="ccx-t">Cash <em>Counter</em></div></div>'
    + '<button type="button" class="ccx-x" aria-label="Close" onclick="closeCashCounter()">✕</button></div><div id="ccx-sum"></div></div>'
    + '<div id="cc-body"></div>';
  document.body.appendChild(sheet);
}

var _ccRefreshTimer = null;
function openCashCounter() {
  document.getElementById('cc-overlay').style.display = 'block';
  document.getElementById('cc-sheet').style.display   = 'block';
  loadCashCounter();
  // Cash collected on another phone shows up while this sheet is open.
  clearInterval(_ccRefreshTimer);
  _ccRefreshTimer = setInterval(function () {
    var sh = document.getElementById('cc-sheet');
    if (!sh || sh.style.display !== 'block') { clearInterval(_ccRefreshTimer); return; }
    if (!document.hidden && !_ccLoading) loadCashCounter(true);
  }, 20000);
}
function closeCashCounter() {
  clearInterval(_ccRefreshTimer);
  document.getElementById('cc-overlay').style.display = 'none';
  document.getElementById('cc-sheet').style.display   = 'none';
}

// The balance is the sum of every entry ever logged. Supabase returns at most
// 1,000 rows per request, so a single select stopped counting new entries once
// the ledger passed 1,000 rows. Read it in pages instead.
async function ccSumAllCash() {
  var total = 0, from = 0, page = 1000;
  for (var i = 0; i < 200; i++) {
    var res = await db.from('cash_counter_entries').select('id,amount').order('id', { ascending: true }).range(from, from + page - 1);
    if (res.error) throw res.error;
    var rows = res.data || [];
    rows.forEach(function (r) { total += Number(r.amount) || 0; });
    if (rows.length < page) break;
    from += page;
  }
  return Math.round(total * 100) / 100;
}
window.ccSumAllCash = ccSumAllCash;
async function getCashCounterBalance() { return ccSumAllCash(); }

// Midnight in India, so "today" is right between 12 am and 5:30 am too.
function ccDayStartIso() {
  return new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10) + 'T00:00:00+05:30';
}
function ccMoney(n) { n = Math.round((Number(n) || 0) * 100) / 100; return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 }); }
var _ccLoading = false;

async function loadCashCounter(quiet) {
  var body = document.getElementById('cc-body');
  // A quiet refresh keeps what's typed in the amount / note boxes.
  if (quiet) {
    var a = document.getElementById('cc-amount'), n = document.getElementById('cc-note');
    if ((a && a.value) || (n && n.value) || (document.activeElement && body.contains(document.activeElement))) return;
  } else {
    body.innerHTML = '<div style="text-align:center;padding:30px;color:#9a8aaa;font-size:12px">Loading…</div>';
  }
  _ccLoading = true;
  var balance, todayEntries;
  try {
    balance = await getCashCounterBalance();
    var todayRes = await db.from('cash_counter_entries').select('*')
      .gte('created_at', ccDayStartIso())
      .order('created_at', { ascending: false });
    if (todayRes.error) throw todayRes.error;
    todayEntries = todayRes.data || [];
  } catch (e) {
    _ccLoading = false;
    if (!quiet) body.innerHTML = '<div style="text-align:center;padding:24px;color:#dc2626;font-size:12.5px">Could not load the Cash Counter: ' + ((e && e.message) || e) + '</div>';
    return;
  }
  _ccLoading = false;
  var hasAnyEntries = balance !== 0 || todayEntries.length > 0;
  var cashIn = 0, cashOut = 0;
  todayEntries.forEach(function (r) { var v = Number(r.amount) || 0; if (v >= 0) cashIn += v; else cashOut += -v; });
  var opening = balance - (cashIn - cashOut);

  var esc = function (v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var entriesHtml = todayEntries.length
    ? todayEntries.map(function (r) {
        var v = Number(r.amount) || 0, isAdd = v >= 0;
        var note = r.note || (isAdd ? 'Cash added' : 'Cash removed');
        var kind = /^NSDI Store cash/.test(note) ? ['store', '🛍'] : (r.entry_type === 'order_payment' ? ['cafe', '☕'] : ['adj', isAdd ? '+' : '−']);
        var time = new Date(r.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
        return '<div class="ccx-e"><span class="ccx-ic ' + kind[0] + '">' + kind[1] + '</span>'
          + '<div class="ccx-e-m"><b>' + esc(note) + '</b><small>' + time + (r.staff_name ? ' · ' + esc(r.staff_name) : '') + '</small></div>'
          + '<div class="ccx-e-v ' + (isAdd ? 'in' : 'out') + '">' + (isAdd ? '+' : '−') + ccMoney(Math.abs(v)) + '</div></div>';
      }).join('')
    : '<div class="ccx-empty">No cash in or out yet today.</div>';

  document.getElementById('ccx-sum').innerHTML =
      '<div class="ccx-bal"><small>Cash in the drawer</small><b>' + ccMoney(balance) + '</b></div>'
    + '<div class="ccx-row"><div><span>Opening</span><b>' + ccMoney(opening) + '</b></div>'
    + '<div class="in"><span>In today</span><b>+' + ccMoney(cashIn) + '</b></div>'
    + '<div class="out"><span>Out today</span><b>−' + ccMoney(cashOut) + '</b></div></div>'
    + '<div class="ccx-upd">Updated ' + new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).toLowerCase()
    + ' · refreshes while open · <button type="button" onclick="loadCashCounter()">Refresh</button></div>';

  body.innerHTML =
      (!hasAnyEntries
        ? '<div class="ccx-note">No entries yet, so the counter starts at ₹0. If there is already cash in the drawer, add it below as your first entry (e.g. "Opening cash").</div>'
        : '')
    + '<div class="ccx-card"><div class="ccx-h">Adjust the drawer</div>'
    + '<div class="ccx-seg"><button type="button" id="cc-type-add" class="add' + (_ccAdjustType === 'add' ? ' on' : '') + '" onclick="ccSetAdjustType(\'add\')">+ Add cash</button>'
    + '<button type="button" id="cc-type-subtract" class="sub' + (_ccAdjustType !== 'add' ? ' on' : '') + '" onclick="ccSetAdjustType(\'subtract\')">− Remove cash</button></div>'
    + '<input id="cc-amount" class="ccx-in ccx-amt" type="number" inputmode="decimal" step="any" placeholder="₹ Amount">'
    + '<input id="cc-note" class="ccx-in" placeholder="Note (e.g. Change from bank, Milk purchase)">'
    + '<button type="button" class="ccx-cta" onclick="ccSubmitAdjustment()">Save entry</button></div>'
    + '<div class="ccx-card"><div class="ccx-h">Today\'s cash in &amp; out</div>' + entriesHtml + '</div>';
}

var _ccAdjustType = 'add';
function ccSetAdjustType(type) {
  _ccAdjustType = type;
  var addBtn = document.getElementById('cc-type-add'), subBtn = document.getElementById('cc-type-subtract');
  if (addBtn) addBtn.classList.toggle('on', type === 'add');
  if (subBtn) subBtn.classList.toggle('on', type !== 'add');
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
    var ins = await db.from('cash_counter_entries').insert([{
      entry_type: 'adjustment',
      amount: signedAmount,
      note: note || null,
      staff_name: staffName
    }]);
    if (ins.error) throw ins.error; // was silently ignored before
    showStoreToast('✅ Logged ' + (_ccAdjustType === 'add' ? '+₹' : '-₹') + amountRaw);
    loadCashCounter();
  } catch (e) {
    showStoreToast('Error: ' + e.message);
  }
}
