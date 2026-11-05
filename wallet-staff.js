/**
 * wallet-staff.js — NSDI Wallet for staff (store.html).
 *
 * 1. Helpers the Kitchen's Collect Payment screen uses
 *    (table-service-patch.js): look up a wallet by phone, keep cash
 *    change in it, and pay part or all of a bill from it.
 * 2. Command Center -> "Customer Wallets": look up any customer's balance
 *    and history; admins can correct a balance (with a note).
 *
 * All checks are in the database (cc_wallet_staff, migrations/20261108).
 */
function swEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
function swPhone10(p) { var d = String(p || '').replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; }
function swMoney(n) { n = Number(n) || 0; return '₹' + (Math.round(n * 100) / 100).toLocaleString('en-IN'); }
function swStaffName() {
  return (typeof _staffSession !== 'undefined' && _staffSession && _staffSession.name)
    ? _staffSession.name : ((typeof isAdmin !== 'undefined' && isAdmin) ? 'Admin' : null);
}

async function swCall(action, payload) {
  if (!window.db) throw new Error('Store connection is not ready.');
  payload = payload || {};
  if (!payload.staff_name) payload.staff_name = swStaffName();
  var res = await window.db.rpc('cc_wallet_staff', { p_action: action, p_payload: payload });
  if (res.error) {
    throw new Error(/schema cache|does not exist/i.test(res.error.message)
      ? 'Wallet is not installed yet. Run migrations/20261108_customer_wallet.sql.'
      : res.error.message);
  }
  return res.data;
}
window.swCall = swCall;
window.swPhone10 = swPhone10;
window.swMoney = swMoney;

// ── Command Center: Customer Wallets ──
var _swDialog = null, _swData = null, _swBusy = false;

function swOpen() {
  if (!_swDialog) {
    var d = document.createElement('dialog');
    d.style.cssText = 'width:min(520px,calc(100% - 24px));max-height:92dvh;padding:0;border:1px solid #eadfeb;'
      + 'border-radius:22px;background:#fffaf3;color:#291830;font:14px \'DM Sans\',Arial,sans-serif';
    d.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;padding:20px 24px;'
      +   'position:sticky;top:0;background:#fffaf3;border-bottom:1px solid #eadfeb;z-index:1">'
      +   '<div><div style="font-size:10px;letter-spacing:2px;color:#8c647f">NSDI WALLET</div>'
      +     '<h2 style="font:24px Georgia,serif;margin:5px 0 0">Customer Wallets</h2></div>'
      +   '<button type="button" onclick="swClose()" style="font-size:26px;border:0;background:transparent;cursor:pointer">×</button>'
      + '</div>'
      + '<div style="padding:14px 24px 24px">'
      +   '<div style="display:flex;gap:8px"><input id="sw-q" type="tel" inputmode="numeric" placeholder="Customer mobile number" '
      +     'style="flex:1;padding:11px;border:1px solid #ddcce2;border-radius:9px;font:inherit;min-height:42px" '
      +     'onkeydown="if(event.key===\'Enter\'){event.preventDefault();swLookup();}">'
      +   '<button onclick="swLookup()" style="cursor:pointer;border:1px solid #e2cfe6;background:white;color:#790c88;'
      +     'border-radius:10px;padding:10px 14px;font:inherit">Look up</button></div>'
      +   '<div id="sw-msg" style="min-height:18px;font-size:13px;color:#a02929;margin-top:8px"></div>'
      +   '<div id="sw-out"></div>'
      + '</div>';
    d.addEventListener('cancel', function (e) { e.preventDefault(); swClose(); });
    document.body.appendChild(d);
    _swDialog = d;
  }
  _swData = null;
  document.getElementById('sw-out').innerHTML = '';
  swMsg('');
  if (!_swDialog.open) _swDialog.showModal();
  setTimeout(function () { var q = document.getElementById('sw-q'); if (q) q.focus(); }, 50);
}
function swClose() { if (!_swBusy && _swDialog && _swDialog.open) _swDialog.close(); }
function swMsg(t) { var el = document.getElementById('sw-msg'); if (el) el.textContent = t || ''; }

async function swLookup() {
  if (_swBusy) return;
  var phone = swPhone10(document.getElementById('sw-q').value);
  if (!phone) { swMsg('Enter a 10-digit mobile number'); return; }
  _swBusy = true; swMsg('');
  try { _swData = await swCall('lookup', { phone: phone }); swRender(); }
  catch (e) { swMsg(e.message); } finally { _swBusy = false; }
}

var SW_KIND = { topup: 'Added with UPI', change: 'Change kept', spend: 'Paid an order', adjust: 'Correction' };
function swRender() {
  var d = _swData, el = document.getElementById('sw-out');
  if (!el || !d) return;
  el.innerHTML = '<div style="border-radius:18px;padding:18px 20px;color:#fff;margin-top:6px;'
    + 'background:linear-gradient(135deg,#2b0a35,#6e0977 60%,#1a0820)">'
    + '<div style="font-size:9px;font-weight:700;letter-spacing:2.5px;color:rgba(255,255,255,.6)">BALANCE · ••••' + swEsc(d.phone10.slice(-4)) + '</div>'
    + '<div style="font:700 36px Georgia,serif;margin-top:4px">' + swMoney(d.balance) + '</div></div>'
    + '<h3 style="font-size:14px;margin:18px 0 6px">History</h3>'
    + ((d.txns || []).length ? d.txns.map(function (t) {
        var a = Number(t.amount);
        return '<div style="display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid #eadfeb">'
          + '<div><div style="font-weight:600">' + swEsc(t.kind === 'adjust' && t.note ? t.note : (SW_KIND[t.kind] || t.kind)) + '</div>'
          + '<div style="font-size:11px;color:#79677e">' + new Date(t.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
          + (t.order_id ? ' · Order ' + swEsc(String(t.order_id).slice(0, 8)) : '') + '</div></div>'
          + '<div style="font-weight:800;color:' + (a >= 0 ? '#15803d' : '#291830') + '">' + (a >= 0 ? '+' : '−') + swMoney(Math.abs(a)) + '</div></div>';
      }).join('') : '<p style="font-size:13px;color:#79677e">No activity yet.</p>')
    + '<details style="margin-top:16px;border-top:1px solid #eadfeb;padding-top:10px">'
    +   '<summary style="cursor:pointer;font-size:12px;color:#79677e">Correct balance (admin)</summary>'
    +   '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">'
    +     '<input id="sw-adj-amt" type="number" step="0.01" placeholder="+50 or -20" style="width:110px;padding:10px;border:1px solid #ddcce2;border-radius:9px;font:inherit">'
    +     '<input id="sw-adj-note" maxlength="120" placeholder="Reason" style="flex:1;min-width:140px;padding:10px;border:1px solid #ddcce2;border-radius:9px;font:inherit">'
    +     '<button onclick="swAdjust()" style="cursor:pointer;background:#790c88;color:#fff;border:0;border-radius:10px;padding:10px 14px;font:inherit">Save</button>'
    +   '</div></details>';
}

async function swAdjust() {
  if (_swBusy || !_swData) return;
  var amt = parseFloat(document.getElementById('sw-adj-amt').value);
  var note = document.getElementById('sw-adj-note').value.trim();
  if (!amt) { swMsg('Enter an amount, e.g. 50 or -20'); return; }
  if (!note) { swMsg('Add a reason'); return; }
  if (!confirm((amt > 0 ? 'Add ' : 'Remove ') + swMoney(Math.abs(amt)) + (amt > 0 ? ' to' : ' from') + ' this wallet?')) return;
  _swBusy = true;
  try {
    await swCall('adjust', { phone: _swData.phone10, amount: amt, note: note });
    _swData = await swCall('lookup', { phone: _swData.phone10 });
    swMsg(''); swRender(); showStoreToast('✅ Wallet updated');
  } catch (e) { swMsg(e.message); } finally { _swBusy = false; }
}

window.openCustomerWallets = swOpen;
(function () {
  function reg() {
    if (window.registerAdminTool) window.registerAdminTool('Daily Operations', {
      icon: '◈', iconBg: 'rgba(201,166,51,0.18)',
      title: 'Customer Wallets', subtitle: 'Balance, history & corrections',
      onClick: swOpen
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', reg); else reg();
})();
