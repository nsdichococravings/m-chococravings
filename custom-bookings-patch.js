/**
 * custom-bookings-patch.js — ChocoCravings On Store
 * Feature: Custom Cake/Brownie Booking Calendar — for walk-in customers
 * who enquire in person about birthday cakes/brownies and book a
 * specific date, with advance or full payment. Staff/Admin enter these
 * manually — this is deliberately simple, not tied to the existing
 * complex cake_custom_orders schema.
 *
 * Load AFTER store-patch.js, right before </body>:
 *   <script src="custom-bookings-patch.js"></script>
 *
 * Requires DB setup: run add-custom-bookings-table.sql once.
 * Requires: `db`, `showStoreToast()` — already global.
 */

var _cbMonthOffset = 0;
var _cbSelectedDate = null;
var _cbCachedBookings = [];

document.addEventListener('DOMContentLoaded', function () {
  buildCustomBookingsUI();
  waitForAdminThenInjectBookings();
});

function waitForAdminThenInjectBookings() {
  var attempts = 0;
  var poll = setInterval(function () {
    attempts++;
    if (typeof isAdmin !== 'undefined' && isAdmin) {
      clearInterval(poll);
      injectCustomBookingsMenuEntry();
      injectKitchenBookingsButton();
      refreshReminderBadge();
      refreshKitchenBookingsBadge();
    } else if (attempts >= 20) {
      clearInterval(poll);
    }
  }, 300);
}

// Direct-access button right in the Kitchen header (next to Refresh/
// History), so staff don't need to dig through the Admin FAB menu for
// something they'll likely check multiple times a day. Tapping it
// "maximizes" the same Custom Bookings sheet already built — no
// duplicate calendar logic, just a faster way in.
function injectKitchenBookingsButton() {
  var attempts = 0;
  var poll = setInterval(function () {
    attempts++;
    var kHdr = document.querySelector('#pg-kitchen .k-hdr');
    if (kHdr) {
      clearInterval(poll);
      if (document.getElementById('kitchen-bookings-btn')) return;

      var btn = document.createElement('div');
      btn.id = 'kitchen-bookings-btn';
      btn.onclick = function () { openCustomBookings(); };
      btn.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:8px 14px;position:relative;'
        + 'border-radius:20px;background:rgba(214,51,108,0.12);border:1px solid rgba(214,51,108,0.25);'
        + 'color:#f5a8c0;font-size:11px;font-weight:700;cursor:pointer;margin-left:8px;'
        + 'font-family:\'DM Sans\',sans-serif;transition:background .15s';
      btn.onmouseenter = function () { btn.style.background = 'rgba(214,51,108,0.2)'; };
      btn.onmouseleave = function () { btn.style.background = 'rgba(214,51,108,0.12)'; };
      btn.innerHTML = '🎂 Bookings <span id="kitchen-bookings-badge" style="display:none;background:#dc2626;'
        + 'color:#fff;font-size:9px;font-weight:700;border-radius:20px;padding:1px 6px;margin-left:2px">0</span>';

      kHdr.appendChild(btn);
      refreshKitchenBookingsBadge();
    } else if (attempts >= 20) {
      clearInterval(poll);
    }
  }, 300);
}

// Shows TODAY's booking count on the Kitchen button — complements the
// FAB menu badge (which shows the 2-day-ahead reminder count) with a
// different, equally useful number for right-now context.
async function refreshKitchenBookingsBadge() {
  var today = new Date().toISOString().slice(0, 10);
  var res = await db.from('custom_bookings').select('id')
    .eq('booking_date', today)
    .not('status', 'eq', 'cancelled');

  var badge = document.getElementById('kitchen-bookings-badge');
  if (!badge) return;
  var count = (res.data || []).length;
  badge.textContent = count;
  badge.style.display = count > 0 ? 'inline-block' : 'none';
}

function injectCustomBookingsMenuEntry() {
  if (document.getElementById('cb-menu-entry')) return;
  var fabMenu = document.getElementById('admin-fab-menu');
  if (!fabMenu) return;

  var entry = document.createElement('div');
  entry.id = 'cb-menu-entry';
  entry.onclick = function () { openCustomBookings(); closeAdminMenu(); };
  entry.style.cssText = 'display:flex;align-items:center;gap:10px;padding:13px 16px;position:relative;'
    + 'cursor:pointer;transition:background .15s;border-bottom:1px solid #f5f0f8';
  entry.onmouseover = function () { entry.style.background = '#f5eeff'; };
  entry.onmouseout  = function () { entry.style.background = 'transparent'; };
  entry.innerHTML =
      '<div style="width:32px;height:32px;border-radius:8px;background:rgba(214,51,108,0.12);'
    + 'display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">🎂</div>'
    + '<div style="flex:1"><div style="font-size:13px;font-weight:600;color:#1a0820">Custom Bookings</div>'
    + '<div style="font-size:11px;color:#9c0ca1;margin-top:1px">Cake & party order calendar</div></div>'
    + '<span id="cb-reminder-badge" style="display:none;background:#dc2626;color:#fff;font-size:10px;'
    + 'font-weight:700;border-radius:20px;padding:2px 8px;flex-shrink:0">0</span>';

  fabMenu.appendChild(entry);
}

async function refreshReminderBadge() {
  var target = new Date();
  target.setDate(target.getDate() + 2);
  var targetStr = target.toISOString().slice(0, 10);

  var res = await db.from('custom_bookings').select('id')
    .eq('booking_date', targetStr)
    .not('status', 'eq', 'cancelled');

  var badge = document.getElementById('cb-reminder-badge');
  if (!badge) return;
  var count = (res.data || []).length;
  badge.textContent = count;
  badge.style.display = count > 0 ? 'inline-block' : 'none';
}

// ══════════════════════════════════════════════════════════════
// Main sheet
// ══════════════════════════════════════════════════════════════
function buildCustomBookingsUI() {
  var overlay = document.createElement('div');
  overlay.id = 'cb-overlay';
  overlay.onclick = closeCustomBookings;
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);'
    + 'z-index:4000;backdrop-filter:blur(4px)';
  document.body.appendChild(overlay);

  var sheet = document.createElement('div');
  sheet.id = 'cb-sheet';
  sheet.style.cssText = 'display:none;position:fixed;bottom:0;left:0;right:0;background:#fdf5e3;'
    + 'border-radius:22px 22px 0 0;z-index:4001;padding:0 0 28px;'
    + 'font-family:\'DM Sans\',sans-serif;max-height:92vh;overflow-y:auto';
  sheet.innerHTML =
      '<div style="width:40px;height:4px;border-radius:2px;background:#ddd0ea;margin:14px auto 0"></div>'
    + '<div style="padding:16px 20px 12px;display:flex;align-items:center;justify-content:space-between">'
    +   '<div>'
    +     '<div style="font-size:9px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:#c2607a">ADMIN</div>'
    +     '<div style="font-family:Fraunces,Georgia,serif;font-size:20px;font-weight:900;color:#1a0820">🎂 Custom Bookings</div>'
    +   '</div>'
    +   '<div onclick="closeCustomBookings()" style="width:34px;height:34px;border-radius:50%;'
    +     'background:#fff;border:1px solid #e0c8f0;display:flex;align-items:center;'
    +     'justify-content:center;cursor:pointer;font-size:14px;color:#6e0977">✕</div>'
    + '</div>'
    + '<div id="cb-reminder-banner" style="display:none;margin:0 20px 14px"></div>'
    + '<div style="padding:0 20px 12px;display:flex;gap:8px">'
    +   '<div id="cb-tab-calendar" onclick="cbSetTab(\'calendar\')" style="flex:1;text-align:center;padding:10px;'
    +     'border-radius:12px;font-size:12px;font-weight:700;cursor:pointer;background:#6e0977;color:#fff">📅 Calendar</div>'
    +   '<div id="cb-tab-reports" onclick="cbSetTab(\'reports\')" style="flex:1;text-align:center;padding:10px;'
    +     'border-radius:12px;font-size:12px;font-weight:700;cursor:pointer;background:#fff;color:#9a8aaa;border:1px solid #e0c8f0">📊 Reports</div>'
    + '</div>'
    + '<div id="cb-calendar-view" style="padding:0 20px">'
    +   '<button onclick="openBookingForm()" style="width:100%;padding:14px;margin-bottom:16px;'
    +     'background:linear-gradient(135deg,#6e0977,#9c0ca1);color:#fff;font-size:13px;font-weight:700;'
    +     'border:none;border-radius:14px;cursor:pointer">➕ New Booking</button>'
    +   '<div style="display:flex;align-items:center;justify-content:center;gap:16px;margin-bottom:14px">'
    +     '<div onclick="shiftBookingMonth(-1)" style="width:34px;height:34px;border-radius:50%;background:#fff;'
    +       'border:1px solid #e0c8f0;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#6e0977">‹</div>'
    +     '<div id="cb-month-label" style="font-family:Fraunces,Georgia,serif;font-size:17px;font-weight:900;color:#1a0820;min-width:150px;text-align:center">—</div>'
    +     '<div onclick="shiftBookingMonth(1)" style="width:34px;height:34px;border-radius:50%;background:#fff;'
    +       'border:1px solid #e0c8f0;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#6e0977">›</div>'
    +   '</div>'
    +   '<div id="cb-calendar-grid"></div>'
    +   '<div id="cb-day-detail" style="margin-top:16px"></div>'
    + '</div>'
    + '<div id="cb-reports-view" style="display:none;padding:0 20px"></div>';
  document.body.appendChild(sheet);

  buildBookingFormModal();
  buildBookingDetailModal();
}

function openCustomBookings() {
  _cbMonthOffset = 0;
  _cbSelectedDate = null;
  document.getElementById('cb-overlay').style.display = 'block';
  document.getElementById('cb-sheet').style.display = 'block';
  cbSetTab('calendar');
  loadBookingsCalendar();
}
function closeCustomBookings() {
  document.getElementById('cb-overlay').style.display = 'none';
  document.getElementById('cb-sheet').style.display = 'none';
}

function getCbMonthRange(offset) {
  var d = new Date();
  d.setMonth(d.getMonth() + offset);
  var start = new Date(d.getFullYear(), d.getMonth(), 1);
  var end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { start: start, end: end, label: start.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' }) };
}

function shiftBookingMonth(dir) {
  _cbMonthOffset += dir;
  _cbSelectedDate = null;
  loadBookingsCalendar();
}

async function loadBookingsCalendar() {
  var range = getCbMonthRange(_cbMonthOffset);
  document.getElementById('cb-month-label').textContent = range.label;

  var startStr = range.start.toISOString().slice(0, 10);
  var endStr = range.end.toISOString().slice(0, 10);

  var res = await db.from('custom_bookings').select('*')
    .gte('booking_date', startStr)
    .lte('booking_date', endStr)
    .not('status', 'eq', 'cancelled')
    .order('booking_date', { ascending: true });

  _cbCachedBookings = res.data || [];
  renderReminderBanner();
  renderCalendarGrid(range);
  document.getElementById('cb-day-detail').innerHTML = '';
}

function renderReminderBanner() {
  var target = new Date();
  target.setDate(target.getDate() + 2);
  var targetStr = target.toISOString().slice(0, 10);
  var upcoming = _cbCachedBookings.filter(function (b) { return b.booking_date === targetStr; });

  var banner = document.getElementById('cb-reminder-banner');
  if (!upcoming.length) { banner.style.display = 'none'; return; }

  banner.style.display = 'block';
  banner.innerHTML = '<div style="background:linear-gradient(135deg,rgba(220,38,38,0.1),rgba(220,38,38,0.03));'
    + 'border:1.5px solid rgba(220,38,38,0.3);border-radius:14px;padding:14px">'
    + '<div style="font-size:12px;font-weight:700;color:#dc2626;margin-bottom:4px">🔔 REMINDER — 2 DAYS AWAY</div>'
    + upcoming.map(function (b) {
        return '<div style="font-size:12px;color:#8a2020;padding:2px 0">' + b.customer_name + ' — ' + (b.theme || 'Custom order')
          + ' · ' + new Date(b.booking_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + '</div>';
      }).join('')
    + '</div>';
}

function renderCalendarGrid(range) {
  var grid = document.getElementById('cb-calendar-grid');
  var byDate = {};
  _cbCachedBookings.forEach(function (b) {
    if (!byDate[b.booking_date]) byDate[b.booking_date] = [];
    byDate[b.booking_date].push(b);
  });

  var today = new Date().toISOString().slice(0, 10);
  var firstDay = range.start.getDay();
  var daysInMonth = range.end.getDate();
  var dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  var headerHtml = dayNames.map(function (d) {
    return '<div style="text-align:center;font-size:10px;font-weight:700;color:#9a8aaa;padding:4px 0">' + d + '</div>';
  }).join('');

  var cellsHtml = '';
  for (var i = 0; i < firstDay; i++) cellsHtml += '<div></div>';

  for (var d = 1; d <= daysInMonth; d++) {
    var cellDate = new Date(range.start.getFullYear(), range.start.getMonth(), d);
    var dateStr = cellDate.toISOString().slice(0, 10);
    var bookingsToday = byDate[dateStr] || [];
    var isToday = dateStr === today;
    var isSelected = dateStr === _cbSelectedDate;
    var hasBookings = bookingsToday.length > 0;

    cellsHtml += '<div onclick="selectBookingDay(\'' + dateStr + '\')" style="aspect-ratio:1;border-radius:10px;'
      + 'display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;position:relative;'
      + 'background:' + (isSelected ? '#6e0977' : hasBookings ? 'rgba(214,51,108,0.12)' : '#fff') + ';'
      + 'border:' + (isToday ? '1.5px solid #6e0977' : '1px solid #f0e0f5') + '">'
      + '<span style="font-size:12px;font-weight:700;color:' + (isSelected ? '#fff' : hasBookings ? '#d6336c' : '#1a0820') + '">' + d + '</span>'
      + (hasBookings ? '<span style="font-size:8px;font-weight:700;color:' + (isSelected ? '#fff' : '#d6336c') + ';margin-top:1px">' + bookingsToday.length + '</span>' : '')
      + '</div>';
  }

  grid.innerHTML = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-bottom:4px">' + headerHtml + '</div>'
    + '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px">' + cellsHtml + '</div>';
}

function selectBookingDay(dateStr) {
  _cbSelectedDate = dateStr;
  renderCalendarGrid(getCbMonthRange(_cbMonthOffset));

  var bookingsToday = _cbCachedBookings.filter(function (b) { return b.booking_date === dateStr; });
  var detail = document.getElementById('cb-day-detail');
  var dateLabel = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  if (!bookingsToday.length) {
    detail.innerHTML = '<div style="text-align:center;padding:20px;color:#9a8aaa;font-size:12px;background:#fff;border-radius:14px">'
      + 'No bookings on ' + dateLabel + '.</div>';
    return;
  }

  detail.innerHTML = '<div style="font-size:11px;font-weight:700;letter-spacing:1.5px;color:#c2607a;margin-bottom:10px">' + dateLabel.toUpperCase() + '</div>'
    + bookingsToday.map(function (b) {
        var balance = (b.total_amount || 0) - (b.advance_paid || 0);
        return '<div onclick="openBookingDetail(\'' + b.id + '\')" style="background:#fff;border:1.5px solid #f0d8e5;'
          + 'border-radius:14px;padding:14px;margin-bottom:8px;cursor:pointer">'
          + '<div style="display:flex;justify-content:space-between;align-items:center">'
          + '<span style="font-size:14px;font-weight:700;color:#1a0820">' + b.customer_name + '</span>'
          + '<span style="font-family:Fraunces,Georgia,serif;font-size:15px;font-weight:900;color:#6e0977">₹' + (b.total_amount || 0) + '</span>'
          + '</div>'
          + '<div style="font-size:11px;color:#9a8aaa;margin-top:2px">' + (b.delivery_type === 'doorstep' ? '🚪' : '🏪') + ' ' + (b.theme || 'Custom order') + (balance > 0 ? ' · ₹' + balance + ' balance due' : ' · Fully paid') + '</div>'
          + '</div>';
      }).join('');
}

// ══════════════════════════════════════════════════════════════
// New Booking form
// ══════════════════════════════════════════════════════════════
function buildBookingFormModal() {
  var overlay = document.createElement('div');
  overlay.id = 'cbf-overlay';
  overlay.onclick = function (e) { if (e.target === overlay) closeBookingForm(); };
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:4100;'
    + 'align-items:flex-end;justify-content:center;font-family:\'DM Sans\',sans-serif';
  overlay.innerHTML = '<div id="cbf-card" style="background:#fff;border-radius:24px 24px 0 0;width:100%;max-width:480px;'
    + 'max-height:90vh;overflow-y:auto;padding:22px"></div>';
  document.body.appendChild(overlay);
}

function openBookingForm() {
  var card = document.getElementById('cbf-card');
  var today = new Date().toISOString().slice(0, 10);
  card.innerHTML =
      '<div style="width:40px;height:4px;border-radius:2px;background:#e8d8f0;margin:0 auto 16px"></div>'
    + '<div style="font-family:Fraunces,Georgia,serif;font-size:20px;font-weight:900;color:#1a0820;margin-bottom:16px">🎂 New Booking</div>'
    + cbLabel('BOOKING / DELIVERY DATE')
    + '<input id="cbf-date" type="date" min="' + today + '" class="cbf-input" style="margin-bottom:12px">'
    + cbLabel('DELIVERY TIME')
    + '<input id="cbf-time" type="time" class="cbf-input" style="margin-bottom:12px">'
    + cbLabel('DELIVERY TYPE')
    + '<div style="display:flex;gap:8px;margin-bottom:12px">'
    + '<div id="cbf-deliv-outlet" onclick="cbSetDeliveryType(\'outlet\')" class="cbf-pay-btn cbf-pay-on">🏪 Outlet Pickup</div>'
    + '<div id="cbf-deliv-doorstep" onclick="cbSetDeliveryType(\'doorstep\')" class="cbf-pay-btn">🚪 Door Step</div>'
    + '</div>'
    + '<div id="cbf-address-wrap" style="display:none;margin-bottom:12px">'
    + cbLabel('DELIVERY ADDRESS')
    + '<textarea id="cbf-address" rows="2" placeholder="Full delivery address..." class="cbf-input" style="resize:none"></textarea>'
    + '</div>'
    + cbLabel('CUSTOMER NAME')
    + '<input id="cbf-name" placeholder="Customer name" class="cbf-input" style="margin-bottom:12px">'
    + cbLabel('CONTACT NUMBER')
    + '<input id="cbf-phone" type="tel" inputmode="numeric" maxlength="10" placeholder="10-digit phone" class="cbf-input" style="margin-bottom:12px">'
    + cbLabel('NAME ON THE CAKE')
    + '<input id="cbf-cakename" placeholder="e.g. Happy Birthday Aarav" class="cbf-input" style="margin-bottom:12px">'
    + cbLabel('THEME')
    + '<input id="cbf-theme" placeholder="e.g. Superhero, Floral, Unicorn" class="cbf-input" style="margin-bottom:12px">'
    + cbLabel('PARTICULARS / NOTES')
    + '<textarea id="cbf-particulars" rows="2" placeholder="Flavor, size, special requests..." class="cbf-input" style="margin-bottom:12px;resize:none"></textarea>'
    + '<div style="display:flex;gap:10px;margin-bottom:12px">'
    + '<div style="flex:1">' + cbLabel('TOTAL AMOUNT') + '<input id="cbf-total" type="number" placeholder="₹0" class="cbf-input"></div>'
    + '<div style="flex:1">' + cbLabel('ADVANCE PAID') + '<input id="cbf-advance" type="number" placeholder="₹0" class="cbf-input"></div>'
    + '</div>'
    + cbLabel('PAYMENT TYPE')
    + '<div style="display:flex;gap:8px;margin-bottom:18px">'
    + '<div id="cbf-pay-advance" onclick="cbSetPayType(\'advance\')" class="cbf-pay-btn cbf-pay-on">Advance Paid</div>'
    + '<div id="cbf-pay-full" onclick="cbSetPayType(\'full\')" class="cbf-pay-btn">Full Payment</div>'
    + '</div>'
    + '<button onclick="saveBooking()" style="width:100%;padding:14px;background:linear-gradient(135deg,#6e0977,#9c0ca1);'
    + 'color:#fff;font-size:14px;font-weight:700;border:none;border-radius:14px;cursor:pointer">💾 Save Booking</button>'
    + '<button onclick="closeBookingForm()" style="width:100%;padding:12px;margin-top:8px;background:transparent;'
    + 'color:#9a8aaa;font-size:12px;font-weight:600;border-radius:12px;border:none;cursor:pointer">Cancel</button>'
    + '<style>.cbf-input{width:100%;padding:12px 14px;border-radius:12px;border:1.5px solid rgba(18,10,30,0.12);'
    + 'font-family:inherit;font-size:13px;outline:none;box-sizing:border-box}'
    + '.cbf-pay-btn{flex:1;padding:11px;text-align:center;border-radius:12px;border:1.5px solid rgba(18,10,30,0.1);'
    + 'font-size:12px;font-weight:700;color:#9a8aaa;cursor:pointer}'
    + '.cbf-pay-on{background:#6e0977;border-color:#6e0977;color:#fff}</style>';

  document.getElementById('cbf-overlay').style.display = 'flex';
  _cbPayType = 'advance';
  _cbDeliveryType = 'outlet';
}

function cbLabel(text) {
  return '<div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:#c2607a;margin-bottom:6px">' + text + '</div>';
}

var _cbPayType = 'advance';
var _cbDeliveryType = 'outlet';

function cbSetDeliveryType(type) {
  _cbDeliveryType = type;
  document.getElementById('cbf-deliv-outlet').classList.toggle('cbf-pay-on', type === 'outlet');
  document.getElementById('cbf-deliv-doorstep').classList.toggle('cbf-pay-on', type === 'doorstep');
  document.getElementById('cbf-address-wrap').style.display = type === 'doorstep' ? 'block' : 'none';
}
function cbSetPayType(type) {
  _cbPayType = type;
  document.getElementById('cbf-pay-advance').classList.toggle('cbf-pay-on', type === 'advance');
  document.getElementById('cbf-pay-full').classList.toggle('cbf-pay-on', type === 'full');
}

function closeBookingForm() {
  document.getElementById('cbf-overlay').style.display = 'none';
}

async function saveBooking() {
  var date = document.getElementById('cbf-date').value;
  var time = document.getElementById('cbf-time').value;
  var name = document.getElementById('cbf-name').value.trim();
  var phoneRaw = document.getElementById('cbf-phone').value.trim();
  var cakeName = document.getElementById('cbf-cakename').value.trim();
  var theme = document.getElementById('cbf-theme').value.trim();
  var particulars = document.getElementById('cbf-particulars').value.trim();
  var total = parseFloat(document.getElementById('cbf-total').value) || 0;
  var advance = parseFloat(document.getElementById('cbf-advance').value) || 0;
  var address = document.getElementById('cbf-address').value.trim();

  if (!date) { showStoreToast('Pick a booking date'); return; }
  if (!name) { showStoreToast('Enter customer name'); return; }
  var phoneDigits = phoneRaw.replace(/\D/g, '').slice(-10);
  if (phoneDigits.length !== 10) { showStoreToast('Enter a valid 10-digit phone number'); return; }
  if (total <= 0) { showStoreToast('Enter the total amount'); return; }
  if (_cbDeliveryType === 'doorstep' && !address) { showStoreToast('Enter the delivery address'); return; }

  var staffName = (typeof _staffSession !== 'undefined' && _staffSession && _staffSession.name)
    ? _staffSession.name : 'Admin';

  // Format the time input (HH:MM, 24hr) into a friendlier 12hr display string.
  var timeDisplay = null;
  if (time) {
    var parts = time.split(':');
    var h = parseInt(parts[0]);
    var m = parts[1];
    var ampm = h >= 12 ? 'PM' : 'AM';
    var h12 = h % 12 || 12;
    timeDisplay = h12 + ':' + m + ' ' + ampm;
  }

  try {
    await db.from('custom_bookings').insert([{
      customer_name: name, customer_phone: phoneDigits, booking_date: date,
      delivery_time: timeDisplay, delivery_type: _cbDeliveryType,
      delivery_address: _cbDeliveryType === 'doorstep' ? address : null,
      cake_name_text: cakeName || null, theme: theme || null, particulars: particulars || null,
      total_amount: total, advance_paid: _cbPayType === 'full' ? total : advance,
      payment_type: _cbPayType, status: 'booked', created_by: staffName
    }]);
    showStoreToast('✅ Booking saved for ' + name);
    closeBookingForm();
    loadBookingsCalendar();
    refreshReminderBadge();
    refreshKitchenBookingsBadge();
  } catch (e) {
    showStoreToast('Error: ' + e.message);
  }
}

// ══════════════════════════════════════════════════════════════
// Booking Detail popup
// ══════════════════════════════════════════════════════════════
function buildBookingDetailModal() {
  var overlay = document.createElement('div');
  overlay.id = 'cbd-overlay';
  overlay.onclick = function (e) { if (e.target === overlay) closeBookingDetail(); };
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.65);z-index:4200;'
    + 'align-items:center;justify-content:center;padding:20px;font-family:\'DM Sans\',sans-serif';
  overlay.innerHTML = '<div id="cbd-card" style="background:#fff;border-radius:22px;width:100%;max-width:400px;'
    + 'max-height:85vh;overflow-y:auto;padding:22px"></div>';
  document.body.appendChild(overlay);
}

async function openBookingDetail(id) {
  var b = _cbCachedBookings.find(function (x) { return x.id === id; });
  if (!b) return;

  var balance = (b.total_amount || 0) - (b.advance_paid || 0);
  var statusMeta = {
    booked: { label: 'Booked', color: '#b87410', bg: 'rgba(184,116,16,0.1)' },
    in_progress: { label: 'In Progress', color: '#6e0977', bg: 'rgba(110,9,119,0.1)' },
    ready: { label: 'Ready', color: '#15803d', bg: 'rgba(34,197,94,0.1)' },
    delivered: { label: 'Delivered', color: '#4ade80', bg: 'rgba(74,222,128,0.1)' }
  }[b.status] || { label: b.status, color: '#9a8aaa', bg: '#f5f5f5' };

  var card = document.getElementById('cbd-card');
  card.innerHTML =
      '<div style="text-align:center;margin-bottom:16px">'
    + '<div style="display:inline-block;padding:6px 16px;border-radius:20px;background:' + statusMeta.bg + ';'
    + 'color:' + statusMeta.color + ';font-size:11px;font-weight:700">' + statusMeta.label + '</div></div>'
    + '<div style="font-family:Fraunces,Georgia,serif;font-size:22px;font-weight:900;color:#1a0820;text-align:center;margin-bottom:2px">' + b.customer_name + '</div>'
    + '<div style="text-align:center;font-size:12px;color:#9a8aaa;margin-bottom:18px">📞 ' + b.customer_phone + '</div>'
    + cbDetailRow('📅 Delivery Date', new Date(b.booking_date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))
    + (b.delivery_time ? cbDetailRow('⏰ Delivery Time', b.delivery_time) : '')
    + cbDetailRow(b.delivery_type === 'doorstep' ? '🚪 Delivery Type' : '🏪 Delivery Type', b.delivery_type === 'doorstep' ? 'Door Step' : 'Outlet Pickup')
    + (b.delivery_type === 'doorstep' && b.delivery_address ? cbDetailRow('📍 Address', b.delivery_address) : '')
    + cbDetailRow('🎂 Name on Cake', b.cake_name_text || '—')
    + cbDetailRow('🎨 Theme', b.theme || '—')
    + cbDetailRow('📝 Particulars', b.particulars || '—')
    + '<div style="background:#fff8e6;border:1.5px solid rgba(245,196,48,0.35);border-radius:14px;padding:14px;margin-top:14px">'
    + cbAmountRow('Total Amount', b.total_amount)
    + cbAmountRow('Advance Paid', b.advance_paid)
    + '<div style="display:flex;justify-content:space-between;padding-top:8px;margin-top:6px;border-top:1px solid rgba(245,196,48,0.3)">'
    + '<span style="font-size:13px;font-weight:700;color:#1a0820">Balance Due</span>'
    + '<span style="font-family:Fraunces,Georgia,serif;font-size:16px;font-weight:900;color:' + (balance > 0 ? '#dc2626' : '#15803d') + '">₹' + balance + '</span></div>'
    + '</div>'
    + '<div style="font-size:10px;font-weight:700;letter-spacing:1.5px;color:#c2607a;margin:16px 0 8px">UPDATE STATUS</div>'
    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">'
    + cbStatusBtn(b.id, 'booked', 'Booked')
    + cbStatusBtn(b.id, 'in_progress', 'In Progress')
    + cbStatusBtn(b.id, 'ready', 'Ready')
    + cbStatusBtn(b.id, 'delivered', 'Delivered')
    + '</div>'
    + '<button onclick="cancelBooking(\'' + b.id + '\')" style="width:100%;padding:12px;background:rgba(220,38,38,0.08);'
    + 'color:#dc2626;font-size:12px;font-weight:700;border:1.5px solid rgba(220,38,38,0.25);border-radius:12px;cursor:pointer;margin-bottom:8px">🗑️ Cancel Booking</button>'
    + '<button onclick="closeBookingDetail()" style="width:100%;padding:12px;background:transparent;'
    + 'color:#9a8aaa;font-size:12px;font-weight:600;border-radius:12px;border:none;cursor:pointer">Close</button>';

  document.getElementById('cbd-overlay').style.display = 'flex';
}

function cbDetailRow(label, value) {
  return '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f5f0f8;font-size:13px">'
    + '<span style="color:#9a8aaa">' + label + '</span><span style="color:#1a0820;font-weight:600;text-align:right;max-width:60%">' + value + '</span></div>';
}
function cbAmountRow(label, amt) {
  return '<div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12px">'
    + '<span style="color:#8a6a1a">' + label + '</span><span style="font-weight:700;color:#b87410">₹' + (amt || 0) + '</span></div>';
}
function cbStatusBtn(id, status, label) {
  return '<div onclick="updateBookingStatus(\'' + id + '\',\'' + status + '\')" style="padding:10px;text-align:center;'
    + 'border-radius:10px;background:#f5eeff;border:1px solid #e0c8f0;color:#6e0977;font-size:11px;font-weight:700;cursor:pointer">' + label + '</div>';
}

async function updateBookingStatus(id, status) {
  await db.from('custom_bookings').update({ status: status }).eq('id', id);
  showStoreToast('✅ Status updated');
  closeBookingDetail();
  loadBookingsCalendar();
}

async function cancelBooking(id) {
  if (!confirm('Cancel this booking? This cannot be undone.')) return;
  await db.from('custom_bookings').update({ status: 'cancelled' }).eq('id', id);
  showStoreToast('Booking cancelled');
  closeBookingDetail();
  loadBookingsCalendar();
  refreshReminderBadge();
  refreshKitchenBookingsBadge();
}

function closeBookingDetail() {
  document.getElementById('cbd-overlay').style.display = 'none';
}

// ══════════════════════════════════════════════════════════════
// Booking Sales Reports — Week / Month / Year, scoped entirely to
// custom_bookings, completely separate from regular Sales Reports.
// Uses delivery/booking date as the basis for period filtering — a
// birthday cake booked in August for a September party counts as
// September's business, since that's when it's actually delivered.
// ══════════════════════════════════════════════════════════════
var _cbReportPeriod = 'week';

function cbSetTab(tab) {
  var calBtn = document.getElementById('cb-tab-calendar');
  var repBtn = document.getElementById('cb-tab-reports');
  calBtn.style.background = tab === 'calendar' ? '#6e0977' : '#fff';
  calBtn.style.color = tab === 'calendar' ? '#fff' : '#9a8aaa';
  calBtn.style.border = tab === 'calendar' ? 'none' : '1px solid #e0c8f0';
  repBtn.style.background = tab === 'reports' ? '#6e0977' : '#fff';
  repBtn.style.color = tab === 'reports' ? '#fff' : '#9a8aaa';
  repBtn.style.border = tab === 'reports' ? 'none' : '1px solid #e0c8f0';

  document.getElementById('cb-calendar-view').style.display = tab === 'calendar' ? 'block' : 'none';
  document.getElementById('cb-reports-view').style.display = tab === 'reports' ? 'block' : 'none';

  if (tab === 'reports') loadBookingReport();
}

function cbGetReportRange(period) {
  var now = new Date();
  var start;
  if (period === 'week') {
    start = new Date(now.getTime() - 7 * 86400000);
  } else if (period === 'month') {
    start = new Date(now.getTime() - 30 * 86400000);
  } else {
    start = new Date(now.getTime() - 365 * 86400000);
  }
  return { start: start, end: now };
}

async function loadBookingReport() {
  var view = document.getElementById('cb-reports-view');
  view.innerHTML = '<div style="text-align:center;padding:30px;color:#9a8aaa;font-size:12px">Loading…</div>';

  var range = cbGetReportRange(_cbReportPeriod);
  var startStr = range.start.toISOString().slice(0, 10);
  var endStr = range.end.toISOString().slice(0, 10);

  var res = await db.from('custom_bookings').select('*')
    .gte('booking_date', startStr)
    .lte('booking_date', endStr)
    .not('status', 'eq', 'cancelled');

  renderBookingReport(res.data || []);
}

function cbSetReportPeriod(period) {
  _cbReportPeriod = period;
  ['week', 'month', 'year'].forEach(function (p) {
    var el = document.getElementById('cb-rp-' + p);
    if (!el) return;
    el.style.background = p === period ? '#6e0977' : '#fff';
    el.style.color = p === period ? '#fff' : '#9a8aaa';
    el.style.border = p === period ? 'none' : '1px solid #e0c8f0';
  });
  loadBookingReport();
}

function renderBookingReport(bookings) {
  var totalRevenue = bookings.reduce(function (s, b) { return s + (b.total_amount || 0); }, 0);
  var totalCollected = bookings.reduce(function (s, b) { return s + (b.advance_paid || 0); }, 0);
  var totalPending = totalRevenue - totalCollected;
  var count = bookings.length;
  var avgValue = count ? totalRevenue / count : 0;

  var outletCount = bookings.filter(function (b) { return b.delivery_type !== 'doorstep'; }).length;
  var doorstepCount = count - outletCount;
  var outletPct = count ? Math.round((outletCount / count) * 100) : 0;
  var doorstepPct = 100 - outletPct;

  var periodLabels = { week: 'Last 7 Days', month: 'Last 30 Days', year: 'Last 12 Months' };

  var view = document.getElementById('cb-reports-view');
  view.innerHTML =
      '<div style="display:flex;gap:8px;margin-bottom:16px">'
    + reportPeriodBtn('week', 'Week')
    + reportPeriodBtn('month', 'Month')
    + reportPeriodBtn('year', 'Year')
    + '</div>'
    + '<div style="font-size:11px;color:#9a8aaa;text-align:center;margin-bottom:14px">' + periodLabels[_cbReportPeriod] + ' · based on delivery date</div>'

    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">'
    + reportStatCard('TOTAL SALES', '₹' + totalRevenue.toFixed(0), '#6e0977')
    + reportStatCard('BOOKINGS', count, '#6e0977')
    + '</div>'

    + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px">'
    + reportStatCard('AVG BOOKING VALUE', '₹' + avgValue.toFixed(0), '#b87410')
    + reportStatCard('PENDING BALANCE', '₹' + totalPending.toFixed(0), totalPending > 0 ? '#dc2626' : '#15803d')
    + '</div>'

    + '<div style="background:#fff;border:1.5px solid #f0d8e5;border-radius:16px;padding:16px;margin-bottom:12px">'
    + '<div style="font-size:11px;font-weight:700;letter-spacing:1.5px;color:#c2607a;margin-bottom:12px">COLLECTED VS PENDING</div>'
    + reportBarRow('Collected', totalCollected, totalRevenue, '#15803d')
    + reportBarRow('Pending', totalPending, totalRevenue, '#dc2626')
    + '</div>'

    + '<div style="background:#fff;border:1.5px solid #f0d8e5;border-radius:16px;padding:16px">'
    + '<div style="font-size:11px;font-weight:700;letter-spacing:1.5px;color:#c2607a;margin-bottom:12px">DELIVERY TYPE BREAKDOWN</div>'
    + '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px">'
    + '<span>🏪 Outlet Pickup</span><span style="font-weight:700">' + outletCount + ' (' + outletPct + '%)</span></div>'
    + '<div style="height:8px;border-radius:4px;background:#f5eeff;overflow:hidden;margin-bottom:12px">'
    + '<div style="height:100%;width:' + outletPct + '%;background:#6e0977"></div></div>'
    + '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:6px">'
    + '<span>🚪 Door Step</span><span style="font-weight:700">' + doorstepCount + ' (' + doorstepPct + '%)</span></div>'
    + '<div style="height:8px;border-radius:4px;background:#f5eeff;overflow:hidden">'
    + '<div style="height:100%;width:' + doorstepPct + '%;background:#d6336c"></div></div>'
    + '</div>';
}

function reportPeriodBtn(period, label) {
  var on = period === _cbReportPeriod;
  return '<div id="cb-rp-' + period + '" onclick="cbSetReportPeriod(\'' + period + '\')" style="flex:1;text-align:center;'
    + 'padding:9px;border-radius:10px;font-size:12px;font-weight:700;cursor:pointer;'
    + 'background:' + (on ? '#6e0977' : '#fff') + ';color:' + (on ? '#fff' : '#9a8aaa') + ';'
    + 'border:' + (on ? 'none' : '1px solid #e0c8f0') + '">' + label + '</div>';
}

function reportStatCard(label, value, color) {
  return '<div style="background:#fff;border:1.5px solid #f0d8e5;border-radius:14px;padding:14px">'
    + '<div style="font-size:9px;font-weight:700;letter-spacing:1px;color:#9a8aaa">' + label + '</div>'
    + '<div style="font-family:Fraunces,Georgia,serif;font-size:20px;font-weight:900;color:' + color + ';margin-top:4px">' + value + '</div></div>';
}

function reportBarRow(label, amt, total, color) {
  var pct = total > 0 ? Math.round((amt / total) * 100) : 0;
  return '<div style="margin-bottom:10px">'
    + '<div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px">'
    + '<span style="color:#4a3a5a">' + label + '</span><span style="font-weight:700;color:' + color + '">₹' + amt.toFixed(0) + '</span></div>'
    + '<div style="height:8px;border-radius:4px;background:#f5eeff;overflow:hidden">'
    + '<div style="height:100%;width:' + pct + '%;background:' + color + '"></div></div></div>';
}
