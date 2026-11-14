/**
 * wallet.js — the customer's NSDI Wallet (index.html).
 *
 * Home shows a slim wallet strip under the loyalty card. Tapping it opens
 * a sheet with the balance, "Add money" with UPI (Razorpay), and recent
 * activity. Money is only credited by the wallet-topup edge function
 * after Razorpay confirms the payment, so a closed app or lost connection
 * never loses a top-up: the pending one is confirmed on the next open.
 *
 * Uses index.html globals: db, currentUser, SUPABASE_URL, RAZORPAY_KEY_ID,
 * showToast. index.html calls ccWalletRefresh() whenever Home's loyalty
 * card loads.
 */
(function () {
  var CACHE = 'cc_wallet_v1', PENDING = 'cc_wallet_pending_v1';
  var QUICK = [100, 200, 500, 1000];
  var state = { uid: null, data: null, amount: 200, busy: false, loading: null };

  function rd(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function wr(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) {
    n = Number(n) || 0;
    return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }
  function toast(t) { if (typeof showToast === 'function') showToast(t); }
  function user() { return (typeof currentUser !== 'undefined' && currentUser && currentUser.db_id) ? currentUser : null; }

  var css = ''
    + '.wl-strip{margin:-6px 16px 20px;display:flex;align-items:center;gap:12px;padding:11px 12px 11px 14px;border-radius:18px;'
    +   'background:linear-gradient(120deg,#fffaf3,#fdf0e4);border:1px solid rgba(201,166,51,.45);box-shadow:0 4px 14px rgba(61,5,67,.08);cursor:pointer;-webkit-tap-highlight-color:transparent}'
    + '.wl-ico{flex:none;width:36px;height:36px;border-radius:12px;display:flex;align-items:center;justify-content:center;'
    +   'background:linear-gradient(135deg,#6e0977,#2b0a35);color:#ffd6b0;font-size:17px}'
    + '.wl-mid{flex:1;min-width:0}.wl-lbl{font-size:9px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#8a6d12}'
    + '.wl-bal{font-family:"Cormorant Garamond",Georgia,serif;font-size:22px;font-weight:700;color:#3d0543;line-height:1.05}'
    + '.wl-add{flex:none;border:0;border-radius:999px;padding:9px 14px;font-family:inherit;font-weight:700;font-size:12px;line-height:1;color:#fff;'
    +   'background:linear-gradient(135deg,#6e0977,#9c0ca1);box-shadow:0 4px 12px rgba(110,9,119,.3);cursor:pointer}'
    + '.wl-ov{position:fixed;inset:0;z-index:5000;background:rgba(18,8,24,.55);backdrop-filter:blur(3px);display:flex;align-items:flex-end;justify-content:center;opacity:0;transition:opacity .2s}'
    + '.wl-ov.on{opacity:1}.wl-sh{width:100%;max-width:480px;max-height:92vh;overflow-y:auto;background:#fffaf5;border-radius:26px 26px 0 0;'
    +   'transform:translateY(30px);transition:transform .25s cubic-bezier(.3,.8,.3,1);padding-bottom:calc(18px + env(safe-area-inset-bottom))}'
    + '.wl-ov.on .wl-sh{transform:none}'
    + '.wl-hd{position:relative;margin:10px 12px 0;border-radius:22px;padding:18px 20px 20px;color:#fff;overflow:hidden;'
    +   'background:radial-gradient(circle at 85% 0%,rgba(255,214,176,.28),transparent 55%),linear-gradient(135deg,#2b0a35,#6e0977 60%,#1a0820)}'
    + '.wl-grab{width:38px;height:4px;border-radius:2px;background:#e3d3e6;margin:10px auto 0}'
    + '.wl-x{position:absolute;top:12px;right:12px;width:30px;height:30px;border-radius:50%;border:0;background:rgba(255,255,255,.14);color:#fff;font-size:15px;cursor:pointer}'
    + '.wl-hl{font-size:9px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:rgba(255,255,255,.6)}'
    + '.wl-hb{font-family:"Cormorant Garamond",Georgia,serif;font-size:42px;font-weight:700;line-height:1;margin-top:6px;color:#fff}'
    + '.wl-hs{font-size:11px;color:rgba(255,255,255,.6);margin-top:6px}'
    + '.wl-sec{padding:18px 20px 0}.wl-t{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#8a6d12;margin-bottom:10px}'
    + '.wl-chips{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}'
    + '.wl-chip{border:1.5px solid #ead9ee;background:#fff;border-radius:12px;padding:11px 0;font-family:inherit;font-weight:700;font-size:14px;line-height:1;color:#3d0543;cursor:pointer}'
    + '.wl-chip.on{border-color:#6e0977;background:#f6ebf8;color:#6e0977}'
    + '.wl-inp{display:flex;align-items:center;gap:6px;margin-top:10px;border:1.5px solid #ead9ee;border-radius:12px;background:#fff;padding:0 14px}'
    + '.wl-inp span{font-size:18px;font-weight:700;color:#6e0977}.wl-inp input{flex:1;border:0;outline:0;background:transparent;padding:13px 0;font-family:inherit;font-weight:700;font-size:17px;line-height:1;color:#1a0820;min-width:0}'
    + '.wl-go{width:100%;margin-top:12px;border:0;border-radius:14px;padding:15px;font-family:inherit;font-weight:700;font-size:15px;line-height:1;color:#fff;cursor:pointer;'
    +   'background:linear-gradient(135deg,#6e0977,#9c0ca1);box-shadow:0 8px 20px rgba(110,9,119,.28)}.wl-go:disabled{opacity:.55}'
    + '.wl-note{font-size:11.5px;color:#7a6a80;margin-top:10px;line-height:1.45}'
    + '.wl-row{display:flex;align-items:center;gap:12px;padding:11px 0;border-bottom:1px solid #f1e6f2}.wl-row:last-child{border-bottom:0}'
    + '.wl-ri{flex:none;width:34px;height:34px;border-radius:11px;display:flex;align-items:center;justify-content:center;font-size:15px}'
    + '.wl-rm{flex:1;min-width:0}.wl-rt{font-size:13px;font-weight:700;color:#2a1530}.wl-rd{font-size:11px;color:#9a8aaa;margin-top:2px}'
    + '.wl-ra{font-size:14px;font-weight:800;white-space:nowrap}.wl-empty{font-size:12.5px;color:#9a8aaa;padding:6px 0 4px}'
    + '.wl-err{margin:12px 20px 0;padding:10px 12px;border-radius:10px;background:#fdecec;color:#a02929;font-size:12.5px}';

  function ensureCss() {
    if (document.getElementById('wl-css')) return;
    var s = document.createElement('style'); s.id = 'wl-css'; s.textContent = css; document.head.appendChild(s);
  }

  function section() {
    var el = document.getElementById('wl-section');
    if (!el) {
      var lc = document.getElementById('lc-section');
      if (!lc || !lc.parentNode) return null;
      el = document.createElement('div'); el.id = 'wl-section';
      lc.parentNode.insertBefore(el, lc.nextSibling);
    }
    return el;
  }

  function renderStrip() {
    var el = section(); if (!el) return;
    if (!user()) { el.innerHTML = ''; return; }
    ensureCss();
    var d = state.data;
    var bal = d ? money(d.balance) : '—';
    el.innerHTML = '<div class="wl-strip" role="button" tabindex="0" aria-label="Open wallet" onclick="ccWalletOpen()">'
      + '<div class="wl-ico" aria-hidden="true">◈</div>'
      + '<div class="wl-mid"><div class="wl-lbl">NSDI Wallet</div><div class="wl-bal">' + bal + '</div></div>'
      + '<button class="wl-add" type="button" onclick="event.stopPropagation();ccWalletOpen(true)">+ Add money</button>'
      + '</div>';
    var ps = document.getElementById('prof-wallet-sub');
    if (ps) ps.textContent = d ? bal + ' balance · tap to add money' : 'Pay faster at checkout';
  }

  async function load() {
    var u = user();
    if (!u) { state.uid = null; state.data = null; renderStrip(); return; }
    if (state.uid !== u.db_id) {
      state.uid = u.db_id;
      var c = rd(CACHE); state.data = (c && c.uid === u.db_id) ? c.data : null;
    }
    renderStrip();
    if (state.loading) return state.loading;
    state.loading = (async function () {
      try {
        await confirmPending(true);
        var r = await db.rpc('cc_wallet_me');
        if (r.error) throw r.error;
        if (!user() || user().db_id !== u.db_id) return;
        state.data = r.data; wr(CACHE, { uid: u.db_id, data: r.data });
        renderStrip(); renderSheet();
      } catch (e) {
        // Wallet not installed yet, or offline: keep whatever is on screen.
        if (!state.data) { var el = section(); if (el && /schema cache|does not exist/i.test((e && e.message) || '')) el.innerHTML = ''; }
      } finally { state.loading = null; }
    })();
    return state.loading;
  }

  async function edge(body) {
    var s = await db.auth.getSession();
    var sess = s && s.data && s.data.session;
    if (!sess) throw new Error('Please sign in again');
    var res = await fetch(SUPABASE_URL + '/functions/v1/wallet-topup', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + sess.access_token },
      body: JSON.stringify(body)
    });
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || data.error) throw new Error(data.error || 'Could not reach payments. Please try again.');
    return data;
  }

  // A top-up that was paid but not yet confirmed (app closed, network
  // dropped). quiet = called on load; no messages unless it was credited.
  async function confirmPending(quiet) {
    var p = rd(PENDING);
    if (!p || !p.order_id || !user() || p.uid !== user().db_id) return false;
    if (Date.now() - p.at > 3 * 864e5) { wr(PENDING, null); return false; }
    for (var i = 0; i < (quiet ? 1 : 4); i++) {
      try {
        var r = await edge({ action: 'confirm', order_id: p.order_id });
        if (r.status === 'paid') {
          wr(PENDING, null);
          if (!r.repeat) toast('✅ ' + money(r.amount) + ' added to your wallet');
          return true;
        }
      } catch (e) { if (quiet) return false; }
      if (!quiet) await new Promise(function (ok) { setTimeout(ok, 1500 * (i + 1)); });
    }
    return false;
  }

  function loadRazorpay() {
    if (window.Razorpay) return Promise.resolve();
    return new Promise(function (ok, bad) {
      var s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js';
      s.onload = ok; s.onerror = function () { bad(new Error('Could not open payment. Check your connection.')); };
      document.head.appendChild(s);
    });
  }

  async function topUp() {
    if (state.busy) return;
    var amt = Math.round(Number(state.amount));
    if (!amt || amt < 10 || amt > 10000) { state.error = 'Add from ₹10 to ₹10,000'; renderSheet(); return; }
    state.busy = true; state.error = ''; renderSheet();
    try {
      await loadRazorpay();
      var o = await edge({ action: 'create', amount: amt });
      var u = user();
      wr(PENDING, { order_id: o.order_id, uid: u.db_id, at: Date.now() });
      await new Promise(function (resolve) {
        var rzp = new window.Razorpay({
          key: o.key_id || (typeof RAZORPAY_KEY_ID !== 'undefined' ? RAZORPAY_KEY_ID : ''),
          amount: o.amount, currency: 'INR', order_id: o.order_id,
          name: 'NSDI Wallet', description: 'Add ' + money(amt) + ' to wallet',
          image: 'https://yjbfditboewwpgyqzryd.supabase.co/storage/v1/object/public/product-images/Original_on_transparent.png',
          prefill: { name: u.name || '', email: u.email || '', contact: u.phone || '' },
          config: { display: {
            blocks: { upi: { name: 'Pay with UPI', instruments: [{ method: 'upi' }] } },
            sequence: ['block.upi'], preferences: { show_default_blocks: true } } },
          theme: { color: '#6e0977' },
          modal: { ondismiss: function () { resolve(false); } },
          handler: function () { resolve(true); }
        });
        rzp.on && rzp.on('payment.failed', function () { toast('Payment failed. Please try again.'); });
        rzp.open();
      });
      // Whether the checkout says done or was closed, ask the server:
      // a UPI app can finish after the checkout is closed.
      state.busy = true; state.confirming = true; renderSheet();
      var ok = await confirmPending(false);
      state.confirming = false;
      if (!ok) {
        var still = rd(PENDING);
        if (still) state.error = 'Payment not confirmed yet. If money left your account, it will be added automatically when you reopen the app.';
      }
    } catch (e) { state.error = e.message || 'Something went wrong'; }
    state.busy = false; state.confirming = false;
    await load(); renderSheet();
  }

  var KIND = {
    topup:  { i: '↑', bg: '#e3f4e8', c: '#15803d', t: 'Added with UPI' },
    change: { i: '◎', bg: '#fdf3dc', c: '#8a6d12', t: 'Change saved at counter' },
    spend:  { i: '↓', bg: '#f6ebf8', c: '#6e0977', t: 'Paid at counter' },
    adjust: { i: '✎', bg: '#eef1f6', c: '#475569', t: 'Correction' }
  };
  function when(ts) {
    var d = new Date(ts); if (isNaN(d)) return '';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ' · ' + d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  }

  function sheetHtml() {
    var d = state.data || { balance: 0, txns: [] };
    var txns = d.txns || [];
    var amt = state.amount;
    var noPhone = d.no_phone;
    return '<div class="wl-grab"></div>'
      + '<div class="wl-hd"><button class="wl-x" type="button" aria-label="Close" onclick="ccWalletClose()">✕</button>'
      +   '<div class="wl-hl">NSDI Wallet · Balance</div>'
      +   '<div class="wl-hb">' + money(d.balance) + '</div>'
      +   '<div class="wl-hs">' + (d.phone_last4 ? 'Linked to ••••' + esc(d.phone_last4) + ' · use it at the counter' : 'Use it at the counter on your next visit') + '</div></div>'
      + (state.error ? '<div class="wl-err">' + esc(state.error) + '</div>' : '')
      + '<div class="wl-sec"><div class="wl-t">Add money</div>'
      + (noPhone
        ? '<div class="wl-note">Add your mobile number in your profile to use the wallet.</div>'
        : '<div class="wl-chips">' + QUICK.map(function (q) {
            return '<button type="button" class="wl-chip' + (Number(amt) === q ? ' on' : '') + '" onclick="ccWalletAmt(' + q + ')">₹' + q + '</button>';
          }).join('') + '</div>'
          + '<label class="wl-inp"><span>₹</span><input id="wl-amt" type="number" inputmode="numeric" min="10" max="10000" placeholder="Other amount" value="'
          +   (QUICK.indexOf(Number(amt)) === -1 && amt ? esc(amt) : '') + '" oninput="ccWalletAmt(this.value,true)"></label>'
          + '<button class="wl-go" type="button" onclick="ccWalletTopUp()"' + (state.busy ? ' disabled' : '') + '>'
          +   (state.confirming ? 'Confirming payment…' : state.busy ? 'Opening UPI…' : 'Add ' + money(amt || 0) + ' with UPI') + '</button>'
          + '<div class="wl-note">GPay · PhonePe · Paytm · any UPI app. Change you don\'t take at the counter can be saved here too.</div>')
      + '</div>'
      + '<div class="wl-sec"><div class="wl-t">Recent activity</div>'
      + (txns.length ? txns.map(function (t) {
          var k = KIND[t.kind] || KIND.adjust, a = Number(t.amount);
          var label = (t.kind === 'adjust' || /^Online order/.test(t.note || '')) && t.note ? t.note : k.t;
          return '<div class="wl-row"><div class="wl-ri" style="background:' + k.bg + ';color:' + k.c + '">' + k.i + '</div>'
            + '<div class="wl-rm"><div class="wl-rt">' + esc(label) + '</div><div class="wl-rd">' + when(t.created_at) + '</div></div>'
            + '<div class="wl-ra" style="color:' + (a >= 0 ? '#15803d' : '#2a1530') + '">' + (a >= 0 ? '+' : '−') + money(Math.abs(a)) + '</div></div>';
        }).join('') : '<div class="wl-empty">Nothing yet. Add money or save your change at the counter.</div>')
      + '</div>';
  }

  function renderSheet() {
    var sh = document.getElementById('wl-sh'); if (!sh) return;
    var focus = document.activeElement && document.activeElement.id === 'wl-amt';
    sh.innerHTML = sheetHtml();
    if (focus) { var i = document.getElementById('wl-amt'); if (i) { i.focus(); var v = i.value; i.value = ''; i.value = v; } }
  }

  window.ccWalletOpen = function (focusAdd) {
    if (!user()) { toast('Sign in to use your wallet'); return; }
    ensureCss();
    var ov = document.getElementById('wl-ov');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'wl-ov'; ov.className = 'wl-ov';
      ov.innerHTML = '<div class="wl-sh" id="wl-sh" role="dialog" aria-label="NSDI Wallet"></div>';
      ov.addEventListener('click', function (e) { if (e.target === ov) window.ccWalletClose(); });
      document.body.appendChild(ov);
    }
    state.error = '';
    renderSheet();
    requestAnimationFrame(function () { ov.classList.add('on'); });
    load();
    if (focusAdd) setTimeout(function () { var b = document.querySelector('#wl-sh .wl-go'); if (b) b.scrollIntoView({ block: 'nearest' }); }, 250);
  };
  window.ccWalletClose = function () {
    if (state.busy) return;
    var ov = document.getElementById('wl-ov'); if (!ov) return;
    ov.classList.remove('on'); setTimeout(function () { ov.remove(); }, 220);
  };
  window.ccWalletAmt = function (v, typed) {
    state.amount = typed ? (v === '' ? '' : Math.round(Number(v)) || '') : v;
    state.error = '';
    if (typed) {
      // Update just the button and chips so typing isn't interrupted.
      document.querySelectorAll('#wl-sh .wl-chip').forEach(function (c) { c.classList.toggle('on', Number(c.textContent.slice(1)) === Number(state.amount)); });
      var b = document.querySelector('#wl-sh .wl-go'); if (b && !state.busy) b.textContent = 'Add ' + money(state.amount || 0) + ' with UPI';
    } else renderSheet();
  };
  // ── Checkout: pay an online order (fully or partly) from the wallet ──
  // index.html: #ck-wallet holds the switch; openRazorpay() charges only
  // the rest; placeOrder() calls ccWalletPayOrder() once the order is saved.
  var ck = { on: false, shown: '', locked: null }; // locked: wallet share fixed when UPI opens
  function ckTotal() { try { return Number(currentOrderTotal) || 0; } catch (e) { return 0; } }
  function ckAllowed() {
    try { if (currentPayTab === 'cod' || currentAdvanceMode === 'partial') return false; } catch (e) {}
    return true;
  }
  function ckBalance() { return state.data ? Number(state.data.balance) || 0 : 0; }
  function ckUse() {
    if (ck.locked != null) return ck.locked;
    if (!ck.on || !user() || !ckAllowed()) return 0;
    return Math.round(Math.min(ckBalance(), ckTotal()) * 100) / 100;
  }
  window.ccCheckoutWalletUse = ckUse;

  css += '.ckw{display:flex;align-items:center;gap:12px;padding:12px 14px;margin-bottom:14px;border-radius:14px;cursor:pointer;'
    + 'background:linear-gradient(120deg,#fffaf3,#fdf0e4);border:1px solid rgba(201,166,51,.5);-webkit-tap-highlight-color:transparent}'
    + '.ckw.on{border-color:#6e0977;box-shadow:0 0 0 1px #6e0977 inset}'
    + '.ckw .wl-ico{width:32px;height:32px;border-radius:10px;font-size:15px}'
    + '.ckw-t{font-size:13px;font-weight:700;color:#3d0543}.ckw-s{font-size:11px;color:#8a6d12;margin-top:2px}'
    + '.ckw-sw{flex:none;width:42px;height:24px;border-radius:12px;background:#e3d3e6;position:relative;transition:background .2s}'
    + '.ckw-sw::after{content:"";position:absolute;top:3px;left:3px;width:18px;height:18px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.25);transition:transform .2s}'
    + '.ckw.on .ckw-sw{background:#6e0977}.ckw.on .ckw-sw::after{transform:translateX(18px)}';

  function ckRender() {
    var box = document.getElementById('ck-wallet');
    var page = document.getElementById('page-checkout');
    if (!box || !page || !page.classList.contains('active')) return;
    var bal = ckBalance(), total = ckTotal();
    var show = user() && state.data && !state.data.no_phone && bal > 0 && ckAllowed() && total > 0;
    if (!show) ck.on = false;
    var use = ckUse();
    var key = [show, ck.on, bal, total, use].join('|');
    if (key !== ck.shown) {
      ck.shown = key;
      ensureCss();
      box.innerHTML = !show ? '' : '<div class="ckw' + (ck.on ? ' on' : '') + '" role="switch" aria-checked="' + ck.on + '" tabindex="0" onclick="ccCheckoutWalletToggle()">'
        + '<div class="wl-ico" aria-hidden="true">◈</div>'
        + '<div style="flex:1;min-width:0"><div class="ckw-t">Use NSDI Wallet · ' + money(bal) + '</div>'
        + '<div class="ckw-s">' + (!ck.on ? 'Tap to pay with your wallet balance'
            : use >= total ? 'Whole order paid from wallet' : money(use) + ' from wallet · ' + money(total - use) + ' by UPI') + '</div></div>'
        + '<div class="ckw-sw" aria-hidden="true"></div></div>';
    }
    // Pay button label follows the wallet split.
    var btn = document.getElementById('rzp-btn');
    if (btn && !btn.disabled && use > 0) {
      var want = use >= total ? 'Pay ' + money(total) + ' from Wallet' : 'Pay ' + money(total - use) + ' by UPI + ' + money(use) + ' Wallet';
      if (btn.textContent.trim() !== want) btn.textContent = want;
      btn.dataset.wl = '1';
    } else if (btn && !btn.disabled && btn.dataset.wl) {
      delete btn.dataset.wl;
      btn.innerHTML = 'Pay ₹<span id="rzp-amt-btn">' + total + '</span>';
    }
  }
  window.ccCheckoutWalletToggle = function () { if (state.busy) return; ck.on = !ck.on; ck.locked = null; ckRender(); };
  setInterval(function () {
    var page = document.getElementById('page-checkout');
    if (page && page.classList.contains('active')) {
      if (user() && !state.data && !state.loading) load();
      ckRender();
    } else { ck.on = false; ck.shown = ''; ck.locked = null; }
  }, 600);

  // Whole order from the wallet: no UPI step, the order is saved and paid at once.
  function ckFormOk() {
    var ids = ['ck-name', 'ck-phone', 'ck-address', 'ck-city'];
    for (var i = 0; i < ids.length; i++) {
      var el = document.getElementById(ids[i]);
      if (el && !el.value.trim()) { var err = document.getElementById('ck-err'); if (err) err.style.display = 'block'; return false; }
    }
    var e2 = document.getElementById('ck-err'); if (e2) e2.style.display = 'none';
    return true;
  }
  var _origOpenRazorpay = window.openRazorpay;
  if (typeof _origOpenRazorpay === 'function') {
    window.openRazorpay = async function () {
      ck.locked = null;
      var use = ckUse(), total = ckTotal();
      if (!(use > 0 && use >= total)) {
        ck.locked = use > 0 ? use : null; // the UPI part is charged for total minus this
        return _origOpenRazorpay.apply(this, arguments);
      }
      if (state.busy || !ckFormOk()) return;
      if (!confirm('Pay ' + money(total) + ' from your NSDI Wallet?')) return;
      state.busy = true;
      var btn = document.getElementById('rzp-btn');
      if (btn) { btn.disabled = true; btn.textContent = 'Placing your order…'; }
      try {
        // Make sure the balance is current before saving the order.
        await load();
        if (ckUse() < total) { toast('Wallet balance changed. Please check and try again.'); return; }
        currentPayTab = 'wallet'; currentPayMethod = 'wallet'; currentUtrValue = '';
        await placeOrder();
      } catch (e) {
        toast('Order error: ' + (e.message || e));
      } finally {
        state.busy = false; ck.on = false; ck.shown = ''; ck.locked = null;
        try { if (currentPayTab === 'wallet') currentPayTab = 'upi'; } catch (e) {}
        if (btn) btn.disabled = false;
      }
    };
  }

  // Called by placeOrder() once the order is saved. Returns true when paid.
  window.ccWalletPayOrder = async function (orderId, amount) {
    for (var i = 0; i < 3; i++) {
      try {
        var r = await db.rpc('cc_wallet_pay_order', { p_order_id: orderId, p_amount: amount });
        if (r.error) throw r.error;
        if (state.data) state.data.balance = r.data.balance;
        ck.on = false; ck.shown = ''; ck.locked = null;
        load();
        return true;
      } catch (e) {
        var msg = (e && e.message) || '';
        if (!/network|fetch|timed out|abort/i.test(msg) || i === 2) {
          toast('Wallet could not pay ' + money(amount) + ': ' + msg + ' — this amount is still due on the order.');
          ck.locked = null;
          return false;
        }
        await new Promise(function (ok) { setTimeout(ok, 1200 * (i + 1)); });
      }
    }
    return false;
  };

  window.ccWalletTopUp = topUp;
  window.ccWalletRefresh = load;
  // Home may have loaded before this file did.
  if (user()) load();
})();
