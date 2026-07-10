/**
 * store-patch.js — ChocoCravings On Store
 * Feature: Active Order Detection + Add Items to existing token
 *
 * INSTALL: Add just before </body> in store.html:
 *   <script src="store-patch.js"></script>
 */

// ── 1. Inject Active Order Banner HTML ────────────────────────
document.addEventListener('DOMContentLoaded', function () {
  var phoneRow = document.getElementById('ao-cust-phone');
  if (!phoneRow) return;

  phoneRow.setAttribute('oninput',  'aoClearActiveCheck()');
  phoneRow.setAttribute('onblur',   'aoCheckActiveOrder()');

  var custBlock = phoneRow.parentElement;
  while (custBlock && custBlock.parentElement &&
         !custBlock.parentElement.id.includes('ao-items')) {
    custBlock = custBlock.parentElement;
    if (custBlock.style && custBlock.style.background === 'rgb(245, 238, 255)') break;
    if (custBlock.id === 'admin-order-sheet') { custBlock = phoneRow.parentElement; break; }
  }

  var banner = document.createElement('div');
  banner.id = 'ao-active-banner';
  banner.style.cssText = 'display:none;background:#fff8e6;border:1.5px solid #f5c430;border-radius:14px;overflow:hidden';
  banner.innerHTML =
    '<div style="padding:9px 13px;background:rgba(184,116,16,0.09);border-bottom:1px solid rgba(245,196,48,0.3);display:flex;align-items:center;gap:7px">'
    + '<span style="font-size:15px">&#9889;</span>'
    + '<span style="font-size:11px;font-weight:700;letter-spacing:1.5px;color:#b87410">ACTIVE ORDER FOUND</span>'
    + '<span id="ao-active-token" style="margin-left:auto;font-family:Fraunces,Georgia,serif;font-size:15px;font-weight:700;color:#b87410">T-000</span>'
    + '<span id="ao-active-status" style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:20px;background:rgba(184,116,16,0.15);color:#b87410;margin-left:4px">PENDING</span>'
    + '</div>'
    + '<div style="padding:10px 13px 12px">'
    +   '<div style="font-size:11px;color:#9a8aaa;margin-bottom:3px">Current items:</div>'
    +   '<div id="ao-active-items" style="font-size:12px;font-weight:600;color:#120a1e;margin-bottom:5px;line-height:1.5"></div>'
    +   '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">'
    +     '<span style="font-size:11px;color:#9a8aaa">Current total:</span>'
    +     '<span id="ao-active-total" style="font-family:Fraunces,Georgia,serif;font-size:14px;font-weight:700;color:#b87410">&#8377;0</span>'
    +   '</div>'
    +   '<div style="display:flex;gap:8px">'
    +     '<button id="ao-mode-add" onclick="aoSelectMode(\'add\')" style="flex:1;padding:9px;border-radius:9px;background:#b87410;color:#fff;font-size:12px;font-weight:700;border:none;cursor:pointer;font-family:inherit">&#10133; Add to this order</button>'
    +     '<button id="ao-mode-new" onclick="aoSelectMode(\'new\')" style="flex:1;padding:9px;border-radius:9px;background:#fff;color:#9a8aaa;font-size:12px;font-weight:700;border:1.5px solid rgba(18,10,30,0.12);cursor:pointer;font-family:inherit">&#x1F195; New order</button>'
    +   '</div>'
    + '</div>';

  // Insert after the customer details block inside the sheet body
  var sheetBody = phoneRow.closest('#admin-order-sheet');
  if (sheetBody) {
    var bodyPadding = sheetBody.querySelector('[style*="flex-direction:column"]')
                  || sheetBody.querySelector('[style*="flex-direction: column"]');
    var custSection = phoneRow.closest('[style*="background:#f5eeff"]')
                   || phoneRow.closest('[style*="background: rgb(245, 238, 255)"]')
                   || phoneRow.parentElement.parentElement;
    if (custSection && custSection.parentNode) {
      custSection.parentNode.insertBefore(banner, custSection.nextSibling);
    }
  }
});


// ── 2. State ──────────────────────────────────────────────────
var _aoExistingOrder = null;
var _aoCheckTimer    = null;


// ── 3. Phone check functions ──────────────────────────────────
function aoClearActiveCheck() {
  clearTimeout(_aoCheckTimer);
  var banner = document.getElementById('ao-active-banner');
  if (banner) banner.style.display = 'none';
  _aoExistingOrder = null;
  aoUpdateSubmitLabel();
  var phone = (document.getElementById('ao-cust-phone') || {}).value || '';
  if (phone.replace(/\D/g, '').length === 10) {
    _aoCheckTimer = setTimeout(aoCheckActiveOrder, 700);
  }
}

async function aoCheckActiveOrder() {
  var phone = (document.getElementById('ao-cust-phone') || {}).value || '';
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
}

function aoSelectMode(mode) {
  var btnAdd = document.getElementById('ao-mode-add');
  var btnNew = document.getElementById('ao-mode-new');
  if (mode === 'add') {
    if (btnAdd) { btnAdd.style.background='#b87410'; btnAdd.style.color='#fff'; btnAdd.style.border='none'; }
    if (btnNew) { btnNew.style.background='#fff'; btnNew.style.color='#9a8aaa'; btnNew.style.border='1.5px solid rgba(18,10,30,0.12)'; }
  } else {
    _aoExistingOrder = null;
    if (btnAdd) { btnAdd.style.background='#fff'; btnAdd.style.color='#9a8aaa'; btnAdd.style.border='1.5px solid rgba(18,10,30,0.12)'; }
    if (btnNew) { btnNew.style.background='#6e0977'; btnNew.style.color='#fff'; btnNew.style.border='none'; }
  }
  aoUpdateSubmitLabel();
}

function aoUpdateSubmitLabel() {
  var btn = document.getElementById('ao-submit-btn');
  if (!btn) return;
  if (_aoExistingOrder) {
    btn.textContent      = '\u2795 Add Items to ' + _aoExistingOrder.token;
    btn.style.background = 'linear-gradient(135deg,#b87410,#d4930e)';
  } else {
    btn.textContent      = '\u2705 Place Order';
    btn.style.background = 'linear-gradient(135deg,#6e0977,#9c0ca1)';
  }
}


// ── 4. Override openAdminOrder (NO recursion — full inline) ───
function openAdminOrder() {
  // Reset state
  _aoItems         = [];
  _aoPayMethod     = 'cash';
  _aoExistingOrder = null;

  // Hide banner
  var banner = document.getElementById('ao-active-banner');
  if (banner) banner.style.display = 'none';

  // Show sheet
  var ov = document.getElementById('admin-order-overlay');
  var sh = document.getElementById('admin-order-sheet');
  if (!ov || !sh) { alert('Admin order sheet not found in store.html'); return; }
  ov.style.display = 'block';
  sh.style.display = 'block';

  // Populate item dropdown + reset list + reset inputs
  aoPopulateDropdown();
  aoRenderItems();
  aoCalcTotal();
  ['ao-cust-name', 'ao-cust-phone', 'ao-notes'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.value = '';
  });
  var qtyEl = document.getElementById('ao-item-qty');
  if (qtyEl) qtyEl.value = '1';

  // Reset submit button
  aoUpdateSubmitLabel();

  // Reset payment to cash (default)
  if (typeof aoSelPay === 'function') {
    var cashBtn = document.querySelector('.ao-pay');
    if (cashBtn) aoSelPay(cashBtn, 'cash');
  }
}


// ── 5. Override aoSubmit ──────────────────────────────────────
async function aoSubmit() {
  var custName  = (document.getElementById('ao-cust-name')  || {}).value || '';
  var custPhone = (document.getElementById('ao-cust-phone') || {}).value || '';
  var notes     = (document.getElementById('ao-notes')      || {}).value || '';

  if (_aoItems.length === 0) { showStoreToast('Add at least one item'); return; }

  var btn = document.getElementById('ao-submit-btn');

  // ── MODE A: Add items to existing active order ───────────────
  if (_aoExistingOrder) {
    if (btn) { btn.disabled = true; btn.textContent = 'Adding items\u2026'; }
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

      showStoreToast('\u2705 Items added to ' + _aoExistingOrder.token);
      closeAdminOrder();
      if (typeof kitchenLoad === 'function') kitchenLoad();
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

  if (btn) { btn.disabled = true; btn.textContent = 'Placing order\u2026'; }

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

    showStoreToast('\u2705 Order ' + token + ' placed for ' + custName.trim());
    closeAdminOrder();
    if (typeof kitchenLoad === 'function') kitchenLoad();
  } catch (e) {
    showStoreToast('Error: ' + e.message);
    if (btn) { btn.disabled = false; aoUpdateSubmitLabel(); }
  }
}


// ── 6. Override subscribeKitchen — UPDATED badge ──────────────
function subscribeKitchen() {
  if (kitchenCh) { try { db.removeChannel(kitchenCh); } catch (e) {} }
  kitchenCh = db.channel('kitchen-live')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'store_orders' }, function (p) {
      var card = document.getElementById('kt-' + p.new.id);
      if (!card) { kitchenLoad(); return; }
      if (p.new.status === 'collected') { card.remove(); return; }

      var prevStatus = card.dataset.s;
      card.dataset.s = p.new.status;

      var badge = card.querySelector('.k-badge');
      if (badge) badge.textContent = p.new.status.toUpperCase();

      var btns = card.querySelectorAll('.k-start,.k-ready');
      if (btns[0]) btns[0].textContent = p.new.status === 'preparing' ? '\u23f3 Making\u2026' : '\u25b6 Start';
      if (btns[1]) btns[1].textContent = p.new.status === 'ready'     ? '\u2713 Ready!'  : '\u2713 Mark Ready';

      // Update items display
      var rawItems = p.new.items;
      var itemsArr = Array.isArray(rawItems)
        ? rawItems
        : (typeof rawItems === 'string' ? JSON.parse(rawItems) : []);
      var newTotal = itemsArr.reduce(function (s, i) { return s + (i.price * i.qty); }, 0);
      var itemsTxt = itemsArr.map(function (i) { return i.name + ' \u00d7' + i.qty; }).join(' \u00b7 ')
                   + ' \u00b7 \u20b9' + newTotal;
      var kItems = card.querySelector('.k-items');
      if (kItems) kItems.textContent = itemsTxt;

      // Flash UPDATED badge only when status didn't change (items were added)
      if (prevStatus === p.new.status) {
        var kTop = card.querySelector('.k-top');
        if (kTop) {
          var old = kTop.querySelector('.upd-badge');
          if (old) old.remove();
          var upd = document.createElement('div');
          upd.className = 'upd-badge';
          upd.textContent = '\u270f\ufe0f UPDATED';
          upd.style.cssText = 'margin-left:6px;background:rgba(245,196,48,0.18);border:1px solid rgba(245,196,48,0.5);border-radius:20px;padding:2px 9px;font-size:9px;font-weight:700;color:#f5c430;letter-spacing:1px;animation:skPulse 1s ease-in-out 4';
          kTop.appendChild(upd);
          card.style.transition  = 'border-color .3s';
          card.style.borderColor = 'rgba(245,196,48,0.7)';
          setTimeout(function () {
            card.style.borderColor = '';
            if (upd.parentNode) upd.remove();
          }, 8000);
        }
      }
    })
    .subscribe();
}
