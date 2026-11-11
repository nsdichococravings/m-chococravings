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
  + '.ccx-hd{position:relative;color:#fff;padding:12px 20px 20px;border-radius:28px 28px 22px 22px;'
  +   'background:radial-gradient(120% 90% at 100% 0%,rgba(255,233,194,.18),transparent 60%),linear-gradient(160deg,#2b0a35 0%,#5a0b63 55%,#1a0820 100%)}'
  + '.ccx-grab{width:42px;height:4px;border-radius:2px;background:rgba(255,255,255,.3);margin:0 auto 12px}'
  + '.ccx-top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}'
  + '.ccx-eb{font-size:10px;font-weight:700;letter-spacing:.26em;text-transform:uppercase;color:rgba(255,233,194,.78)}'
  + '.ccx-t{font-family:"Cormorant Garamond",Georgia,serif;font-size:32px;font-weight:600;line-height:1;margin-top:4px}'
  + '.ccx-t em{font-style:italic;color:#e8c98f;font-weight:500}'
  + '.ccx-x{flex:none;width:38px;height:38px;border-radius:50%;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#fff;font-size:14px;cursor:pointer}'
  + '.ccx-bal{margin-top:18px;text-align:center}'
  + '.ccx-bal small{display:block;font-size:10px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:rgba(255,233,194,.75)}'
  + '.ccx-bal b{display:block;font-family:"Cormorant Garamond",Georgia,serif;font-size:clamp(40px,12vw,52px);font-weight:700;line-height:1.05;color:#ffe9c2;margin-top:4px}'
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
  + '.ccx-empty{text-align:center;padding:14px;color:#8d7f90;font-size:12.5px}'
  + '.ccx-ic svg{width:17px!important;height:17px!important}'
  + '.ccx-chips{display:flex;gap:8px;flex-wrap:wrap;margin:-2px 0 12px}'
  + '.ccx-chip{min-height:34px;padding:0 14px;border-radius:999px;border:1px solid #ece2d8;background:#fff;color:#4a3a50;font:600 12px "DM Sans",sans-serif;cursor:pointer;transition:background .15s,border-color .15s}'
  + '.ccx-chip:active{transform:scale(.96)}'
  + '.ccx-chip.amt{font-family:"Cormorant Garamond",Georgia,serif;font-size:15px;font-weight:700;color:#3a0a46}'
  + '.ccx-chip.on{background:#f7eef6;border-color:#e3c9e1;color:#6e0977}'
  + '.ccx-cta.sub{background:linear-gradient(135deg,#5c1428 0%,#a33a52 100%)}'
  + '.ccx-cta:disabled{opacity:.6}'
  + '.ccx-src{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:14px}'
  + '.ccx-src>div{background:#fffdfa;border:1px solid #ece2d8;border-radius:18px;padding:12px 10px;min-width:0}'
  + '.ccx-src span{display:flex;align-items:center;gap:6px;font-size:9.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#8d7f90;white-space:nowrap}'
  + '.ccx-src span i{width:7px;height:7px;border-radius:50%;flex:none}'
  + '.ccx-src b{display:block;font-family:"Cormorant Garamond",Georgia,serif;font-size:20px;font-weight:700;color:#3a0a46;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
  + '.ccx-src small{display:block;font-size:10.5px;color:#8d7f90;margin-top:2px}'
  + '.ccx-hrow{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}'
  + '.ccx-hrow .ccx-h{margin:0;flex:1}'
  + '.ccx-f{display:flex;gap:2px;padding:3px;border-radius:999px;background:#f3ece4;flex:none}'
  + '.ccx-f button{border:0;background:transparent;border-radius:999px;padding:6px 11px;font:600 11px "DM Sans",sans-serif;color:#6b5a70;cursor:pointer}'
  + '.ccx-f button.on{background:#fff;color:#3a0a46;box-shadow:0 2px 8px -4px rgba(58,10,70,.3)}';
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
  var src = { cafe: 0, store: 0, adj: 0 }, srcN = { cafe: 0, store: 0, adj: 0 };
  var kindOf = function (r) { var note = r.note || ''; return /^NSDI Store cash/.test(note) ? 'store' : (r.entry_type === 'order_payment' ? 'cafe' : 'adj'); };
  todayEntries.forEach(function (r) { var k = kindOf(r); src[k] += Number(r.amount) || 0; srcN[k]++; });
  _ccEntries = todayEntries.map(function (r) {
    var v = Number(r.amount) || 0, isAdd = v >= 0, k = kindOf(r);
    var note = r.note || (isAdd ? 'Cash added' : 'Cash removed');
    var time = new Date(r.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).toLowerCase();
    return { dir: isAdd ? 'in' : 'out', html: '<div class="ccx-e"><span class="ccx-ic ' + k + '">' + ccIcon(k === 'adj' ? (isAdd ? 'plus' : 'minus') : k) + '</span>'
      + '<div class="ccx-e-m"><b>' + esc(note) + '</b><small>' + time + (r.staff_name ? ' · ' + esc(r.staff_name) : '') + '</small></div>'
      + '<div class="ccx-e-v ' + (isAdd ? 'in' : 'out') + '">' + (isAdd ? '+' : '−') + ccMoney(Math.abs(v)) + '</div></div>' };
  });

  document.getElementById('ccx-sum').innerHTML =
      '<div class="ccx-bal"><small>Cash in the drawer</small><b>' + ccMoney(balance) + '</b></div>'
    + '<div class="ccx-row"><div><span>Opening</span><b>' + ccMoney(opening) + '</b></div>'
    + '<div class="in"><span>In today</span><b>+' + ccMoney(cashIn) + '</b></div>'
    + '<div class="out"><span>Out today</span><b>−' + ccMoney(cashOut) + '</b></div></div>'
    + '<div class="ccx-upd">Updated ' + new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).toLowerCase()
    + ' · refreshes while open · <button type="button" onclick="loadCashCounter()">Refresh</button></div>';

  var srcCell = function (k, label, dot) {
    var v = src[k];
    return '<div><span><i style="background:' + dot + '"></i>' + label + '</span><b>' + (v < 0 ? '−' : '') + ccMoney(Math.abs(v)) + '</b>'
      + '<small>' + srcN[k] + (srcN[k] === 1 ? ' entry' : ' entries') + '</small></div>';
  };
  var amtChips = [100, 500, 1000, 2000].map(function (n) { return '<button type="button" class="ccx-chip amt" onclick="ccQuickAmount(' + n + ')">₹' + n.toLocaleString('en-IN') + '</button>'; }).join('');
  var noteChips = ['Opening cash', 'Change from bank', 'Milk purchase', 'Bank deposit'].map(function (t) { return '<button type="button" class="ccx-chip" onclick="ccQuickNote(this)">' + t + '</button>'; }).join('');

  body.innerHTML =
      (!hasAnyEntries
        ? '<div class="ccx-note">No entries yet, so the counter starts at ₹0. If there is already cash in the drawer, add it below as your first entry (e.g. "Opening cash").</div>'
        : '')
    + '<div class="ccx-src">' + srcCell('cafe', 'Cafe', '#6e0977') + srcCell('store', 'Store', '#b08d57') + srcCell('adj', 'Manual', '#8d7f90') + '</div>'
    + '<div class="ccx-card"><div class="ccx-h">Adjust the drawer</div>'
    + '<div class="ccx-seg"><button type="button" id="cc-type-add" class="add' + (_ccAdjustType === 'add' ? ' on' : '') + '" onclick="ccSetAdjustType(\'add\')">+ Add cash</button>'
    + '<button type="button" id="cc-type-subtract" class="sub' + (_ccAdjustType !== 'add' ? ' on' : '') + '" onclick="ccSetAdjustType(\'subtract\')">− Remove cash</button></div>'
    + '<input id="cc-amount" class="ccx-in ccx-amt" type="number" inputmode="decimal" step="any" min="0" placeholder="₹ Amount" oninput="ccUpdateCta()">'
    + '<div class="ccx-chips">' + amtChips + '</div>'
    + '<input id="cc-note" class="ccx-in" maxlength="120" placeholder="Note (optional)" oninput="ccSyncNoteChips()">'
    + '<div class="ccx-chips">' + noteChips + '</div>'
    + '<button type="button" id="cc-save" class="ccx-cta" onclick="ccSubmitAdjustment()">Save entry</button></div>'
    + '<div class="ccx-card"><div class="ccx-hrow"><div class="ccx-h">Today</div>'
    + (todayEntries.length ? '<div class="ccx-f" role="tablist">' + ['all', 'in', 'out'].map(function (f) {
        return '<button type="button" data-f="' + f + '" class="' + (_ccFilter === f ? 'on' : '') + '" onclick="ccSetFilter(\'' + f + '\')">' + { all: 'All', in: 'In', out: 'Out' }[f] + '</button>'; }).join('') + '</div>' : '')
    + '</div><div id="cc-entries"></div></div>';
  ccRenderEntries();
  ccUpdateCta();
}

var _ccEntries = [], _ccFilter = 'all';
function ccIcon(k) {
  var p = {
    cafe: '<path d="M5 9h11v5a5 5 0 0 1-5 5H10a5 5 0 0 1-5-5z"/><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16"/><path d="M8 3.5v2M11 3.5v2"/>',
    store: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>'
  }[k] || '';
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + '</svg>';
}
function ccSetFilter(f) {
  _ccFilter = f;
  document.querySelectorAll('#cc-body .ccx-f button').forEach(function (b) { b.classList.toggle('on', b.dataset.f === f); });
  ccRenderEntries();
}
function ccRenderEntries() {
  var box = document.getElementById('cc-entries'); if (!box) return;
  var list = _ccEntries.filter(function (e) { return _ccFilter === 'all' || e.dir === _ccFilter; });
  box.innerHTML = list.length ? list.map(function (e) { return e.html; }).join('')
    : '<div class="ccx-empty">' + (_ccEntries.length ? 'Nothing here for today.' : 'No cash in or out yet today.') + '</div>';
}
function ccQuickAmount(n) {
  var a = document.getElementById('cc-amount'); if (!a) return;
  a.value = n; ccUpdateCta();
}
function ccQuickNote(btn) {
  var n = document.getElementById('cc-note'); if (!n) return;
  n.value = n.value === btn.textContent ? '' : btn.textContent;
  ccSyncNoteChips();
}
function ccSyncNoteChips() {
  var n = document.getElementById('cc-note');
  document.querySelectorAll('#cc-body .ccx-chip:not(.amt)').forEach(function (c) { c.classList.toggle('on', !!n && n.value === c.textContent); });
}
function ccUpdateCta() {
  var btn = document.getElementById('cc-save'), a = document.getElementById('cc-amount'); if (!btn) return;
  var v = a ? parseFloat(a.value) : NaN, add = _ccAdjustType === 'add';
  btn.classList.toggle('sub', !add);
  btn.textContent = v > 0 ? (add ? 'Add ' + ccMoney(v) + ' to drawer' : 'Remove ' + ccMoney(v) + ' from drawer') : 'Save entry';
}

var _ccAdjustType = 'add';
function ccSetAdjustType(type) {
  _ccAdjustType = type;
  var addBtn = document.getElementById('cc-type-add'), subBtn = document.getElementById('cc-type-subtract');
  if (addBtn) addBtn.classList.toggle('on', type === 'add');
  if (subBtn) subBtn.classList.toggle('on', type !== 'add');
  ccUpdateCta();
}

async function ccSubmitAdjustment() {
  var amountRaw = parseFloat(document.getElementById('cc-amount').value);
  var note = document.getElementById('cc-note').value.trim();

  if (isNaN(amountRaw) || amountRaw <= 0) { showStoreToast('Enter a valid amount'); return; }

  var signedAmount = _ccAdjustType === 'add' ? amountRaw : -amountRaw;
  var staffName = (typeof _staffSession !== 'undefined' && _staffSession && _staffSession.name)
    ? _staffSession.name
    : 'Admin';

  var saveBtn = document.getElementById('cc-save');
  if (saveBtn && saveBtn.disabled) return; // no double entries from a double tap
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
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
    if (saveBtn) { saveBtn.disabled = false; ccUpdateCta(); }
  }
}
