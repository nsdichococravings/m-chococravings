/**
 * remember-phone-patch.js — ChocoCravings On Store
 * Feature: Stop asking customers for their phone number every single
 * order. Fixes a gap where the phone typed at checkout was only ever
 * saved to that ONE order, never back to the customer's own profile —
 * so autoFillPhone() had nothing to find on their next visit.
 *
 * Two layers of memory:
 *  1. Logged-in customers — phone gets saved back to `customers.phone`
 *     after a successful order, so autoFillPhone() (already in
 *     store.html) picks it up automatically next time.
 *  2. Guests with no account — phone is remembered in this browser's
 *     localStorage, so the same device won't ask again either.
 *
 * Load AFTER store-patch.js, right before </body>:
 *   <script src="remember-phone-patch.js"></script>
 *
 * Requires: `db`, `cartEntries()`, `cartTotal()`, `payMethod` — all
 * already global on this page. Overrides insertStoreOrder() and
 * autoFillPhone() from store.html's core script.
 */

var REMEMBERED_PHONE_KEY = 'cc_remembered_phone';

// ── Override: insertStoreOrder() — same behavior, plus remembers phone ──
async function insertStoreOrder(token, paymentId, pmMethod, pmStatus) {
  var entries = cartEntries();
  var items   = entries.map(function (i) { return { name: i.name, qty: i.qty, price: i.price }; });
  var total   = cartTotal();
  var user    = null;
  try { var s = await db.auth.getUser(); user = s.data.user; } catch (e) {}

  var phoneInput = document.getElementById('customer-phone-input');
  var typedVal = phoneInput ? phoneInput.value.trim() : '';
  var resolvedPhone = (function () {
    if (typedVal.length === 10) return '+91' + typedVal;
    if (user && user.phone) return user.phone;
    return null;
  })();

  // Resolve the customer's name with fallbacks — the auth profile's
  // full_name often isn't set (e.g. phone-OTP signups), so fall back to
  // the customers table by email, then by phone — covering both logged-in
  // customers whose name lives in their profile row, and guests who've
  // used this phone number before under a known name.
  var resolvedName = user ? ((user.user_metadata && user.user_metadata.full_name) || null) : null;
  if (!resolvedName && user && user.email) {
    try {
      var cRes = await db.from('customers').select('name').eq('email', user.email).maybeSingle();
      if (cRes.data && cRes.data.name) resolvedName = cRes.data.name;
    } catch (e) {}
  }
  if (!resolvedName && resolvedPhone) {
    try {
      var cRes2 = await db.from('customers').select('name').eq('phone', resolvedPhone).maybeSingle();
      if (cRes2.data && cRes2.data.name) resolvedName = cRes2.data.name;
    } catch (e) {}
  }

  var res = await db.from('store_orders').insert({
    token:          token,
    customer_id:    user ? user.id : null,
    customer_name:  resolvedName,
    customer_phone: resolvedPhone,
    items:          items,
    total:          total,
    payment_method: pmMethod || payMethod,
    payment_status: pmStatus || 'paid',
    razorpay_payment_id: paymentId || null,
    status:         'pending',
  }).select().single();

  if (res.error) throw res.error;

  // Remember the phone for next time — don't let a failure here break
  // the actual order, which has already succeeded at this point.
  if (typedVal.length === 10) {
    try { localStorage.setItem(REMEMBERED_PHONE_KEY, typedVal); } catch (e) {}
    if (user && user.email) {
      try {
        await db.from('customers').update({ phone: '+91' + typedVal }).eq('email', user.email);
      } catch (e) { console.warn('remember-phone: could not save to profile', e); }
    }
  }

  return res.data;
}

// ── Override: aoCheckActiveOrder() — keeps the existing "continue
// today's active order" behavior from store-patch.js exactly as-is,
// PLUS auto-fills the customer's NAME if this phone has been used
// before (on any past order, not just today) — so staff don't have to
// ask a returning customer for their name every single visit either.
async function aoCheckActiveOrder() {
  var phoneInput = document.getElementById('ao-cust-phone');
  var phone = (phoneInput || {}).value || '';
  phone = phone.replace(/\D/g, '').slice(-10);
  var banner = document.getElementById('ao-active-banner');
  if (!banner || phone.length !== 10 || !db) return;

  try {
    var today = new Date().toISOString().slice(0, 10);
    var res = await db.from('store_orders')
      .select('id, token, status, items, total')
      .eq('customer_phone', '+91' + phone)
      .gte('created_at', today + 'T00:00:00.000Z')
      .not('status', 'in', '("collected","paid","cancelled")')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (res.data) {
      var o = res.data;
      var rawItems = o.items;
      var items = Array.isArray(rawItems) ? rawItems : JSON.parse(rawItems || '[]');
      var itemsTxt = items.map(function (i) {
        return i.name + (i.qty > 1 ? ' \u00d7' + i.qty : '');
      }).join(', ');

      document.getElementById('ao-active-token').textContent  = o.token;
      document.getElementById('ao-active-status').textContent = o.status.toUpperCase();
      document.getElementById('ao-active-items').textContent  = itemsTxt || '\u2014';
      document.getElementById('ao-active-total').textContent  = '\u20b9' + o.total;
      banner.style.display = 'block';
      _aoExistingOrder = o;
      aoSelectMode('add');
    } else {
      banner.style.display = 'none';
      _aoExistingOrder = null;
      aoUpdateSubmitLabel();
    }
  } catch (e) {
    console.error('aoCheckActiveOrder:', e);
  }

  // Name auto-fill for returning customers — runs regardless of whether
  // there's an active order today. Only fills if staff haven't already
  // typed something themselves (never overwrites manual entry).
  var nameInput = document.getElementById('ao-cust-name');
  if (nameInput && !nameInput.value.trim()) {
    try {
      var nameRes = await db.from('store_orders')
        .select('customer_name')
        .eq('customer_phone', '+91' + phone)
        .not('customer_name', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (nameRes.data && nameRes.data.customer_name) {
        nameInput.value = nameRes.data.customer_name;
        nameInput.style.background = 'rgba(34,197,94,0.08)'; // subtle highlight so staff notice it was auto-filled
      }
    } catch (e) {}
  }
}

// ── Override: openAdminOrder() — same reset behavior as store-patch.js,
// plus clears the auto-fill highlight from a previous customer lookup.
function openAdminOrder() {
  _aoItems         = [];
  _aoPayMethod     = 'cash';
  _aoExistingOrder = null;

  var banner = document.getElementById('ao-active-banner');
  if (banner) banner.style.display = 'none';

  var ov = document.getElementById('admin-order-overlay');
  var sh = document.getElementById('admin-order-sheet');
  if (!ov || !sh) { alert('Admin order sheet not found in store.html'); return; }
  ov.style.display = 'block';
  sh.style.display = 'block';

  aoPopulateDropdown();
  aoRenderItems();
  aoCalcTotal();
  ['ao-cust-name', 'ao-cust-phone', 'ao-notes'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) { el.value = ''; el.style.background = ''; }
  });
  var qtyEl = document.getElementById('ao-item-qty');
  if (qtyEl) qtyEl.value = '1';

  aoUpdateSubmitLabel();

  if (typeof aoSelPay === 'function') {
    var cashBtn = document.querySelector('.ao-pay');
    if (cashBtn) aoSelPay(cashBtn, 'cash');
  }
}
// ── Tag the phone input so Android Chrome's own autofill can offer a
// one-tap saved-number suggestion above the keyboard, for customers who
// have ever saved their number in Chrome (from this site or any other).
// This is separate from — and works alongside — the remembered-phone
// logic above; it's the closest thing to "one tap" achievable from a
// website/TWA without native Android code (the real Google Phone Number
// Hint API only works from native Android apps, not from JS in a TWA).
document.addEventListener('DOMContentLoaded', function () {
  var tryTag = function () {
    var inp = document.getElementById('customer-phone-input');
    if (inp) {
      inp.setAttribute('autocomplete', 'tel');
      inp.setAttribute('inputmode', 'tel');
      inp.setAttribute('name', 'phone'); // some autofill heuristics key off name/id too
    }
    var aoInp = document.getElementById('ao-cust-phone');
    if (aoInp) {
      aoInp.setAttribute('autocomplete', 'tel');
      aoInp.setAttribute('inputmode', 'tel');
    }
  };
  tryTag();
  // The checkout sheet's phone input isn't in the DOM until first opened
  // in some flows — retry briefly in case it wasn't there yet.
  setTimeout(tryTag, 1000);
});

async function autoFillPhone() {
  var inp = document.getElementById('customer-phone-input');
  if (!inp || inp.value.trim()) return;

  try {
    var session = await db.auth.getSession();
    var user = session.data && session.data.session ? session.data.session.user : null;

    if (user) {
      if (user.phone) {
        var p = user.phone.replace(/\D/g, '');
        if (p.startsWith('91') && p.length === 12) p = p.substring(2);
        inp.value = p;
        return;
      }
      var res = await db.from('customers').select('phone').eq('email', user.email).maybeSingle();
      if (res.data && res.data.phone) {
        var p2 = res.data.phone.replace(/\D/g, '');
        if (p2.startsWith('91') && p2.length === 12) p2 = p2.substring(2);
        inp.value = p2;
        return;
      }
    }

    // Not logged in, or logged in but no phone on file yet — fall back
    // to whatever this specific browser/device remembers from before.
    try {
      var remembered = localStorage.getItem(REMEMBERED_PHONE_KEY);
      if (remembered) inp.value = remembered;
    } catch (e) {}

  } catch (e) {
    console.log('autoFillPhone error:', e.message);
  }
}

// ── Override: aoSubmit() — identical to store-patch.js's version, minus
// the kitchenLoad() calls in both branches. kitchenLoad() tears down and
// rebuilds the Kitchen page's realtime subscription every time it runs,
// which can cause OTHER orders arriving during that reconnect window to
// be silently missed until someone manually refreshes. The realtime
// subscription already picks up every order live without this trigger.
async function aoSubmit() {
  var custName  = (document.getElementById('ao-cust-name')  || {}).value || '';
  var custPhone = (document.getElementById('ao-cust-phone') || {}).value || '';
  var notes     = (document.getElementById('ao-notes')      || {}).value || '';

  if (_aoItems.length === 0) { showStoreToast('Add at least one item'); return; }

  var btn = document.getElementById('ao-submit-btn');

  // ── MODE A: Add items to existing active order ───────────────
  if (_aoExistingOrder) {
    if (btn) { btn.disabled = true; btn.textContent = 'Adding items…'; }
    try {
      var rawExisting  = _aoExistingOrder.items;
      var existingItems = Array.isArray(rawExisting)
        ? rawExisting
        : JSON.parse(rawExisting || '[]');

      var mergedItems = existingItems.slice();
      _aoItems.forEach(function (ni) {
        var found = mergedItems.find(function (e) { return e.name === ni.name; });
        if (found) { found.qty += ni.qty; }
        else { mergedItems.push({ name: ni.name, qty: ni.qty, price: ni.price }); }
      });

      var newTotal = mergedItems.reduce(function (s, i) { return s + (i.price * i.qty); }, 0);

      var upd = await db.from('store_orders')
        .update({ items: JSON.stringify(mergedItems), total: newTotal })
        .eq('id', _aoExistingOrder.id);

      if (upd.error) throw upd.error;

      showStoreToast('✅ Items added to ' + _aoExistingOrder.token);
      closeAdminOrder();
    } catch (e) {
      showStoreToast('Error: ' + e.message);
      if (btn) { btn.disabled = false; aoUpdateSubmitLabel(); }
    }
    return;
  }

  // ── MODE B: New order ────────────────────────────────────────
  if (!custName.trim()) { showStoreToast('Enter customer name'); return; }

  var total = aoCalcTotal();
  var phone = custPhone.trim()
    ? '+91' + custPhone.replace(/\D/g, '').slice(-10)
    : 'Walk-in';

  if (btn) { btn.disabled = true; btn.textContent = 'Placing order…'; }

  try {
    var token  = await getToken();
    var custId = null;
    if (custPhone.trim().length === 10) {
      try {
        var lk = await db.from('customers')
          .select('id')
          .eq('phone', '+91' + custPhone.replace(/\D/g, '').slice(-10))
          .maybeSingle();
        if (lk.data) custId = lk.data.id;
      } catch (e) {}
    }

    var ins = await db.from('store_orders').insert([{
      token:           token,
      customer_id:     custId,
      customer_name:   custName.trim(),
      customer_phone:  phone,
      items:           JSON.stringify(_aoItems.map(function (i) {
                         return { name: i.name, qty: i.qty, price: i.price };
                       })),
      total:           total,
      payment_method:  _aoPayMethod,
      payment_status:  _aoPayMethod === 'free' ? 'complimentary' : 'paid',
      status:          'pending',
      notes:           notes.trim() || null,
      placed_by_admin: true
    }]).select('id, token').single();

    if (ins.error) throw ins.error;

    showStoreToast('✅ Order ' + token + ' placed for ' + custName.trim());
    closeAdminOrder();
  } catch (e) {
    showStoreToast('Error: ' + e.message);
    if (btn) { btn.disabled = false; aoUpdateSubmitLabel(); }
  }
}
