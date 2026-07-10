/**
 * store-patch.js — ChocoCravings On Store
 * Feature: Active Order Detection + Add Items to existing token
 *
 * INSTALL: Add this line just before </body> in store.html:
 *   <script src="store-patch.js"></script>
 */

// ── 1. Inject Active Order Banner HTML into admin-order-sheet ─
document.addEventListener('DOMContentLoaded', function () {

  // Add banner div after the customer phone row
  var phoneRow = document.getElementById('ao-cust-phone');
  if (phoneRow) {
    // Add oninput + onblur to phone field
    phoneRow.setAttribute('oninput',  'aoClearActiveCheck()');
    phoneRow.setAttribute('onblur',   'aoCheckActiveOrder()');

    // Find the customer details block (parent of phone row, then its parent)
    var custBlock = phoneRow.closest('[style*="background:#f5eeff"]');
    if (!custBlock) custBlock = phoneRow.closest('div[style]');

    // Inject banner AFTER the customer block
    if (custBlock && custBlock.parentNode) {
      var banner = document.createElement('div');
      banner.id = 'ao-active-banner';
      banner.style.cssText = 'display:none;background:#fff8e6;border:1.5px solid #f5c430;border-radius:14px;overflow:hidden;margin-top:-6px';
      banner.innerHTML = [
        '<div style="padding:10px 14px;background:rgba(184,116,16,0.08);border-bottom:1px solid rgba(245,196,48,0.3);display:flex;align-items:center;gap:8px">',
          '<div style="font-size:16px">⚡</div>',
          '<div style="font-size:11px;font-weight:700;letter-spacing:1.5px;color:#b87410">ACTIVE ORDER FOUND</div>',
          '<div id="ao-active-token" style="margin-left:auto;font-family:Fraunces,Georgia,serif;font-size:16px;font-weight:900;color:#b87410">T-000</div>',
          '<div id="ao-active-status" style="font-size:9px;font-weight:700;padding:2px 7px;border-radius:20px;background:rgba(184,116,16,0.15);color:#b87410">PENDING</div>',
        '</div>',
        '<div style="padding:10px 14px 12px">',
          '<div style="font-size:11px;color:#9a8aaa;margin-bottom:3px">Current items:</div>',
          '<div id="ao-active-items" style="font-size:12px;font-weight:600;color:#120a1e;margin-bottom:6px;line-height:1.5"></div>',
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">',
            '<div style="font-size:11px;color:#9a8aaa">Current total:</div>',
            '<div id="ao-active-total" style="font-family:Fraunces,Georgia,serif;font-size:15px;font-weight:900;color:#b87410">₹0</div>',
          '</div>',
          '<div style="display:flex;gap:8px">',
            '<button id="ao-mode-add" onclick="aoSelectMode(\'add\')"',
            '  style="flex:1;padding:10px;border-radius:10px;background:#b87410;color:#fff;font-size:12px;font-weight:700;border:none;cursor:pointer">',
            '  ➕ Add to this order',
            '</button>',
            '<button id="ao-mode-new" onclick="aoSelectMode(\'new\')"',
            '  style="flex:1;padding:10px;border-radius:10px;background:#fff;color:#9a8aaa;font-size:12px;font-weight:700;border:1.5px solid rgba(18,10,30,0.12);cursor:pointer">',
            '  🆕 New order',
            '</button>',
          '</div>',
        '</div>'
      ].join('');

      custBlock.parentNode.insertBefore(banner, custBlock.nextSibling);
    }
  }
});


// ── 2. State ──────────────────────────────────────────────────
var _aoExistingOrder = null; // null = new order | object = append to this order
var _aoCheckTimer    = null;


// ── 3. Phone check functions ──────────────────────────────────

/**
 * Called on every keystroke in the phone field.
 * Hides any existing banner and debounces the DB check.
 */
function aoClearActiveCheck() {
  clearTimeout(_aoCheckTimer);
  var banner = document.getElementById('ao-active-banner');
  if (banner) banner.style.display = 'none';
  _aoExistingOrder = null;
  aoUpdateSubmitLabel();

  var phone = (document.getElementById('ao-cust-phone') || {}).value || '';
  if (phone.replace(/\D/g, '').length === 10) {
    _aoCheckTimer = setTimeout(aoCheckActiveOrder, 600);
  }
}

/**
 * Queries Supabase for an active store_order today for this phone.
 * Shows the banner if found; hides it if not.
 */
async function aoCheckActiveOrder() {
  var phone = (document.getElementById('ao-cust-phone') || {}).value || '';
  phone = phone.replace(/\D/g, '').slice(-10);
  var banner = document.getElementById('ao-active-banner');
  if (!banner || phone.length !== 10) return;

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
        return i.name + (i.qty > 1 ? ' ×' + i.qty : '');
      }).join(', ');

      document.getElementById('ao-active-token').textContent  = o.token;
      document.getElementById('ao-active-status').textContent = o.status.toUpperCase();
      document.getElementById('ao-active-items').textContent  = itemsTxt || '—';
      document.getElementById('ao-active-total').textContent  = '₹' + o.total;
      banner.style.display = 'block';

      // Default → add to existing
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

/** Toggle between "add to existing" and "new order" modes */
function aoSelectMode(mode) {
  var btnAdd = document.getElementById('ao-mode-add');
  var btnNew = document.getElementById('ao-mode-new');

  if (mode === 'add') {
    if (btnAdd) {
      btnAdd.style.background  = '#b87410';
      btnAdd.style.color       = '#fff';
      btnAdd.style.border      = 'none';
    }
    if (btnNew) {
      btnNew.style.background  = '#fff';
      btnNew.style.color       = '#9a8aaa';
      btnNew.style.border      = '1.5px solid rgba(18,10,30,0.12)';
    }
    // Note: _aoExistingOrder is already set from aoCheckActiveOrder
  } else {
    _aoExistingOrder = null; // new order, even though active order exists
    if (btnAdd) {
      btnAdd.style.background  = '#fff';
      btnAdd.style.color       = '#9a8aaa';
      btnAdd.style.border      = '1.5px solid rgba(18,10,30,0.12)';
    }
    if (btnNew) {
      btnNew.style.background  = '#6e0977';
      btnNew.style.color       = '#fff';
      btnNew.style.border      = 'none';
    }
  }
  aoUpdateSubmitLabel();
}

/** Update submit button label + colour based on current mode */
function aoUpdateSubmitLabel() {
  // Both submit buttons (original HTML has a duplicate — patch both)
  ['ao-submit-btn', 'ao-submit-btn-2'].forEach(function (id) {
    var btn = document.getElementById(id);
    if (!btn) return;
    if (_aoExistingOrder) {
      btn.textContent       = '➕ Add Items to ' + _aoExistingOrder.token;
      btn.style.background  = 'linear-gradient(135deg,#b87410,#d4930e)';
    } else {
      btn.textContent       = '✅ Place Order';
      btn.style.background  = 'linear-gradient(135deg,#6e0977,#9c0ca1)';
    }
  });
}


// ── 4. Override openAdminOrder to reset state ─────────────────
var _origOpenAdminOrder = (typeof openAdminOrder === 'function') ? openAdminOrder : null;

function openAdminOrder() {
  // Reset add-to-existing state
  _aoExistingOrder = null;
  clearTimeout(_aoCheckTimer);
  var banner = document.getElementById('ao-active-banner');
  if (banner) banner.style.display = 'none';

  // Call original to handle sheet opening, item reset, etc.
  if (_origOpenAdminOrder) _origOpenAdminOrder();

  // Reset submit button
  aoUpdateSubmitLabel();
}


// ── 5. Override aoSubmit to handle both modes ─────────────────
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
      // Merge new items into existing
      var rawExisting = _aoExistingOrder.items;
      var existingItems = Array.isArray(rawExisting)
        ? rawExisting
        : JSON.parse(rawExisting || '[]');

      var mergedItems = existingItems.slice(); // copy
      _aoItems.forEach(function (newItem) {
        var found = mergedItems.find(function (e) { return e.name === newItem.name; });
        if (found) {
          found.qty += newItem.qty;
        } else {
          mergedItems.push({ name: newItem.name, qty: newItem.qty, price: newItem.price });
        }
      });

      var newTotal = mergedItems.reduce(function (s, i) { return s + (i.price * i.qty); }, 0);

      var upd = await db.from('store_orders')
        .update({ items: JSON.stringify(mergedItems), total: newTotal })
        .eq('id', _aoExistingOrder.id);

      if (upd.error) throw upd.error;

      showStoreToast('✅ Items added to ' + _aoExistingOrder.token);
      closeAdminOrder();
      if (typeof kitchenLoad === 'function') kitchenLoad();
    } catch (e) {
      showStoreToast('Error: ' + e.message);
    }
    if (btn) {
      btn.disabled    = false;
      btn.textContent = '➕ Add Items to ' + (_aoExistingOrder ? _aoExistingOrder.token : '');
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
    var token = await getToken();

    // Try to find existing customer record by phone
    var custId = null;
    if (custPhone.trim().length === 10) {
      try {
        var custLookup = await db.from('customers')
          .select('id')
          .eq('phone', '+91' + custPhone.replace(/\D/g, '').slice(-10))
          .maybeSingle();
        if (custLookup.data) custId = custLookup.data.id;
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
    if (typeof kitchenLoad === 'function') kitchenLoad();
  } catch (e) {
    showStoreToast('Error: ' + e.message);
  }
  if (btn) { btn.disabled = false; btn.textContent = '✅ Place Order'; }
}


// ── 6. Override subscribeKitchen for UPDATED badge ────────────
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
      if (btns[0]) btns[0].textContent = p.new.status === 'preparing' ? '⏳ Making…' : '▶ Start';
      if (btns[1]) btns[1].textContent = p.new.status === 'ready'     ? '✓ Ready!'  : '✓ Mark Ready';

      // Parse updated items
      var rawItems = p.new.items;
      var itemsArr = Array.isArray(rawItems)
        ? rawItems
        : (typeof rawItems === 'string' ? JSON.parse(rawItems) : []);

      var newTotal  = itemsArr.reduce(function (s, i) { return s + (i.price * i.qty); }, 0);
      var itemsTxt  = itemsArr.map(function (i) { return i.name + ' ×' + i.qty; }).join(' · ')
                    + ' · ₹' + newTotal;

      var kItems = card.querySelector('.k-items');
      if (kItems) kItems.textContent = itemsTxt;

      // Flash UPDATED badge when items were added (status unchanged)
      if (prevStatus === p.new.status) {
        var kTop = card.querySelector('.k-top');
        if (kTop) {
          var old = kTop.querySelector('.upd-badge');
          if (old) old.remove();

          var updBadge = document.createElement('div');
          updBadge.className = 'upd-badge';
          updBadge.textContent = '✏️ UPDATED';
          updBadge.style.cssText = [
            'margin-left:6px',
            'background:rgba(245,196,48,0.2)',
            'border:1px solid rgba(245,196,48,0.5)',
            'border-radius:20px',
            'padding:2px 9px',
            'font-size:9px',
            'font-weight:700',
            'color:#f5c430',
            'letter-spacing:1px',
            'animation:skPulse 1s ease-in-out 4'
          ].join(';');
          kTop.appendChild(updBadge);

          // Also highlight the card border briefly
          card.style.transition = 'border-color .3s';
          card.style.borderColor = 'rgba(245,196,48,0.7)';
          setTimeout(function () {
            card.style.borderColor = '';
            if (updBadge.parentNode) updBadge.remove();
          }, 8000);
        }
      }
    })
    .subscribe();
}
