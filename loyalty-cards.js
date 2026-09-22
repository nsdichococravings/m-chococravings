/**
 * Loyalty Cards — ChocoCravings On Store
 * Staff-operated replacement for the old login/code-based Premium Cards.
 * No customer account, no email/phone verification, no order linking.
 * Staff looks a customer up by the phone number they already collect at
 * order time (or the short "NSDI-CARD-XXXX" code), and directly sets
 * the visit/stamp count each time — no automatic calculation.
 */
var _lcDialog = null;
var _lcMembers = null;   // last lookup results (array)
var _lcMember = null;    // currently selected member row
var _lcBusy = false;

function lcInit() {
  if (_lcDialog) return;
  var d = document.createElement('dialog');
  d.id = 'lc-dialog';
  d.style.cssText = 'width:min(560px,calc(100% - 24px));max-height:92dvh;padding:0;border:1px solid #eadfeb;'
    + 'border-radius:22px;background:#fffaf3;color:#291830;font:14px \'DM Sans\',Arial,sans-serif';
  d.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:20px 24px;'
    +   'position:sticky;top:0;background:#fffaf3;border-bottom:1px solid #eadfeb;z-index:1">'
    +   '<div><div style="font-size:10px;letter-spacing:2px;color:#8c647f">CHOCOCRAVINGS</div>'
    +     '<h2 style="font:27px Georgia,serif;margin:5px 0 0">Loyalty Cards</h2></div>'
    +   '<button type="button" onclick="lcClose()" style="font-size:26px;border:0;background:transparent;cursor:pointer">×</button>'
    + '</div>'
    + '<div id="lc-body" style="padding:0 24px 24px"></div>';
  d.addEventListener('cancel', function (e) { e.preventDefault(); lcClose(); });
  document.body.appendChild(d);
  _lcDialog = d;
}

function lcOpen() {
  lcInit();
  if (!_lcDialog.open) _lcDialog.showModal();
  _lcMembers = null;
  _lcMember = null;
  lcRender();
}

function lcClose() {
  if (_lcBusy) return;
  if (_lcDialog && _lcDialog.open) _lcDialog.close();
  _lcMembers = null;
  _lcMember = null;
}

function lcEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function lcMaskPhone(p) {
  p = String(p || '');
  return p.length > 4 ? ('••••••' + p.slice(-4)) : p;
}

async function lcCommand(action, payload) {
  if (!window.db) throw new Error('Store connection is not ready.');
  var res = await window.db.rpc('cc_loyalty_command', { p_action: action, p_payload: payload || {} });
  if (res.error) {
    throw new Error(res.error.message.indexOf('schema cache') !== -1
      ? 'Loyalty Cards is not installed yet. Ask admin to run the Loyalty Cards SQL migration.'
      : res.error.message);
  }
  return res.data;
}

function lcRender() {
  var body = document.getElementById('lc-body');
  if (!body) return;
  var html = '<div id="lc-msg" style="min-height:18px;font-size:13px;color:#a02929"></div>'
    + '<label style="display:block;margin:10px 0 4px;font-size:13px">Customer mobile number or card code</label>'
    + '<div style="display:flex;gap:10px;align-items:flex-start">'
    +   '<input id="lc-query" type="text" placeholder="9876543210 or NSDI-CARD-8994" '
    +     'style="flex:1;padding:12px;border:1px solid #ddcce2;border-radius:9px;font:inherit;min-height:44px" '
    +     'onkeydown="if(event.key===\'Enter\'){event.preventDefault();lcLookup();}">'
    +   '<button onclick="lcLookup()" style="cursor:pointer;border:1px solid #e2cfe6;background:white;color:#790c88;'
    +     'border-radius:10px;padding:11px 15px;min-height:44px;font:inherit">Look up</button>'
    + '</div>'
    + '<div id="lc-results"></div>';
  body.innerHTML = html;
  lcRenderResults();
}

async function lcLookup() {
  var q = (document.getElementById('lc-query').value || '').trim();
  if (!q) { lcMsg('Enter a mobile number or card code'); return; }
  lcBusy(true);
  try {
    var res = await lcCommand('lookup', { query: q });
    _lcMembers = res.members || [];
    _lcMember = _lcMembers.length === 1 ? _lcMembers[0] : null;
    lcMsg('');
    lcRenderResults();
  } catch (e) {
    lcMsg(e.message);
  } finally {
    lcBusy(false);
  }
}

function lcMsg(text) {
  var el = document.getElementById('lc-msg');
  if (el) el.textContent = text || '';
}

function lcBusy(v) {
  _lcBusy = v;
  var el = document.getElementById('lc-dialog');
  if (el) el.style.opacity = v ? '.7' : '1';
}

function lcRenderResults() {
  var el = document.getElementById('lc-results');
  if (!el) return;

  if (_lcMember) {
    el.innerHTML = lcMemberCard(_lcMember);
    return;
  }

  if (_lcMembers && _lcMembers.length > 1) {
    el.innerHTML = '<p style="font-size:12px;color:#79677e;margin:16px 0 8px">Multiple cards match — pick the right customer:</p>'
      + _lcMembers.map(function (m, i) {
          return '<div onclick="lcPick(' + i + ')" style="display:flex;justify-content:space-between;align-items:center;'
            + 'padding:12px 0;border-bottom:1px solid #eadfeb;cursor:pointer">'
            + '<div>' + lcEsc(m.name) + '<div style="font-size:11px;color:#79677e">' + lcEsc(m.card_code) + ' · ' + lcMaskPhone(m.phone) + '</div></div>'
            + '<span style="color:#790c88;font-weight:700">Select ›</span>'
            + '</div>';
        }).join('');
    return;
  }

  if (_lcMembers && _lcMembers.length === 0) {
    el.innerHTML = '<p style="font-size:13px;color:#79677e;margin:16px 0">No card found for that number/code.</p>'
      + lcIssueFormHtml();
    return;
  }

  el.innerHTML = '<details style="margin-top:18px;border-top:1px solid #eadfeb;padding-top:14px"><summary style="cursor:pointer;font-weight:600">'
    + 'Issue a new card instead</summary>' + lcIssueFormHtml() + '</details>';
}

function lcPick(i) {
  _lcMember = _lcMembers[i];
  lcRenderResults();
}

function lcMemberCard(m) {
  var available = (m.schedule || []).filter(function (s) { return s.day <= m.stamp_count && (m.redeemed_days || []).indexOf(s.day) === -1; });
  var upcoming = (m.schedule || []).filter(function (s) { return s.day > m.stamp_count; }).sort(function (a, b) { return a.day - b.day; })[0];
  var redeemed = (m.schedule || []).filter(function (s) { return (m.redeemed_days || []).indexOf(s.day) !== -1; });

  return '<div style="background:radial-gradient(ellipse at right top,#672477,transparent 70%),#29112f;'
    + 'border:1px solid #a37d47;border-radius:18px;padding:22px;color:#fff3df;margin-top:16px">'
    + '<div style="display:flex;justify-content:space-between;color:#dabc84;font-size:10px;letter-spacing:2px">'
    + '<span>CHOCOCRAVINGS LOYALTY</span><span>' + (m.suspended ? 'SUSPENDED' : 'ACTIVE') + '</span></div>'
    + '<div style="font:26px Georgia,serif;margin-top:10px">' + lcEsc(m.name) + '</div>'
    + '<div style="font-size:12px;color:#dcc2df;margin-top:4px">' + lcMaskPhone(m.phone) + '</div>'
    + '<div style="display:flex;justify-content:space-between;margin-top:20px;font-size:12px">'
    + '<span style="font-size:20px;font-weight:700;letter-spacing:1px">' + lcEsc(m.card_code) + '</span>'
    + '<span>Cycle ' + m.cycle + '</span></div></div>'

    + '<div style="margin:18px 0"><div style="display:flex;justify-content:space-between;align-items:center">'
    + '<h3 style="font-size:17px;margin:0">Visit count</h3><strong>' + m.stamp_count + ' / 100</strong></div>'
    + '<progress max="100" value="' + m.stamp_count + '" style="width:100%;height:8px;accent-color:#790c88;margin-top:8px"></progress>'
    + '<div style="display:flex;gap:10px;align-items:center;margin-top:12px">'
    + '<input id="lc-stamp-input" type="number" min="0" max="100" value="' + m.stamp_count + '" '
    +   'style="width:90px;padding:11px;border:1px solid #ddcce2;border-radius:9px;font:inherit">'
    + '<button onclick="lcSetStamp()" style="cursor:pointer;background:#790c88;color:#fff;border:0;border-radius:10px;'
    +   'padding:11px 16px;min-height:44px;font:inherit">Save count</button>'
    + (m.stamp_count >= 100 ? '<button onclick="lcCompleteCycle()" style="cursor:pointer;background:white;color:#790c88;'
        + 'border:1px solid #e2cfe6;border-radius:10px;padding:11px 16px;min-height:44px;font:inherit">Complete cycle → new card</button>' : '')
    + '</div>'
    + (upcoming ? '<p style="font-size:12px;color:#79677e;margin-top:10px">Next: ' + lcEsc(upcoming.item) + ' at day ' + upcoming.day
        + ' (' + (upcoming.day - m.stamp_count) + ' more)</p>' : '')
    + '</div>'

    + (available.length ? '<div style="border:1px solid #eadfeb;background:white;padding:16px;border-radius:14px;margin:18px 0">'
        + '<h3 style="font-size:15px;margin:0 0 10px">🎁 Ready to give</h3>'
        + available.map(function (s) {
            return '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0">'
              + '<span>' + lcEsc(s.item) + ' <small style="color:#79677e">day ' + s.day + '</small></span>'
              + '<button onclick="lcRedeem(' + s.day + ')" style="cursor:pointer;border:1px solid #e2cfe6;background:white;'
              +   'color:#790c88;border-radius:10px;padding:8px 12px;font:inherit">Mark given</button></div>';
          }).join('') + '</div>' : '')

    + (redeemed.length ? '<p style="font-size:12px;color:#79677e">Already given: ' + redeemed.map(function (s) { return lcEsc(s.item) + ' (day ' + s.day + ')'; }).join(', ') + '</p>' : '')

    + '<div style="display:flex;gap:10px;margin-top:14px">'
    + '<button onclick="lcSuspend(' + (!m.suspended) + ')" style="cursor:pointer;border:1px solid #e2cfe6;background:white;'
    +   'color:' + (m.suspended ? '#15803d' : '#a02929') + ';border-radius:10px;padding:10px 14px;font:inherit">'
    +   (m.suspended ? 'Reactivate membership' : 'Suspend membership') + '</button>'
    + '<button onclick="_lcMember=null;_lcMembers=null;lcRenderResults();" style="cursor:pointer;border:0;background:transparent;'
    +   'color:#79677e;padding:10px 14px;font:inherit">‹ New search</button>'
    + '</div>';
}

async function lcSetStamp() {
  var input = document.getElementById('lc-stamp-input');
  var count = parseInt(input.value, 10);
  if (isNaN(count) || count < 0 || count > 100) { lcMsg('Enter a stamp count from 0 to 100'); return; }
  lcBusy(true);
  try {
    var staffName = (typeof _staffSession !== 'undefined' && _staffSession && _staffSession.name)
      ? _staffSession.name : ((typeof isAdmin !== 'undefined' && isAdmin) ? 'Admin' : null);
    _lcMember = await lcCommand('set_stamp', { member_id: _lcMember.id, count: count, staff_name: staffName });
    lcMsg('');
    lcRenderResults();
    showStoreToast('✅ Stamp count updated');
  } catch (e) { lcMsg(e.message); } finally { lcBusy(false); }
}

async function lcCompleteCycle() {
  if (!confirm('Start a new 100-day card for ' + _lcMember.name + '? This resets the visit count to 0.')) return;
  lcBusy(true);
  try {
    _lcMember = await lcCommand('complete_cycle', { member_id: _lcMember.id });
    lcMsg('');
    lcRenderResults();
    showStoreToast('🎉 New cycle started');
  } catch (e) { lcMsg(e.message); } finally { lcBusy(false); }
}

async function lcRedeem(day) {
  lcBusy(true);
  try {
    _lcMember = await lcCommand('redeem', { member_id: _lcMember.id, day: day });
    lcMsg('');
    lcRenderResults();
    showStoreToast('🎁 Reward marked given');
  } catch (e) { lcMsg(e.message); } finally { lcBusy(false); }
}

async function lcSuspend(suspended) {
  var reason = prompt(suspended ? 'Reason for suspending this membership:' : 'Reason for reactivating this membership:');
  if (!reason) return;
  lcBusy(true);
  try {
    _lcMember = await lcCommand('suspend', { member_id: _lcMember.id, suspended: suspended, reason: reason });
    lcMsg('');
    lcRenderResults();
  } catch (e) { lcMsg(e.message); } finally { lcBusy(false); }
}

// ── Issue a new card ──
var _lcScheduleDays = [];

function lcIssueFormHtml() {
  var options = (typeof MENU !== 'undefined')
    ? Object.keys(MENU).reduce(function (acc, cat) { return acc.concat((MENU[cat].items || []).map(function (i) { return i.name; })); }, [])
    : [];
  var optHtml = options.map(function (n) { return '<option>' + lcEsc(n) + '</option>'; }).join('');
  var prefillPhone = document.getElementById('lc-query') ? (document.getElementById('lc-query').value || '').replace(/\D/g, '') : '';

  return '<div style="margin-top:8px">'
    + '<label style="display:block;margin:10px 0 4px;font-size:13px">Customer name<input id="lc-new-name" '
    +   'style="width:100%;padding:12px;border:1px solid #ddcce2;border-radius:9px;font:inherit;min-height:44px;margin-top:4px"></label>'
    + '<label style="display:block;margin:10px 0 4px;font-size:13px">Mobile number<input id="lc-new-phone" type="tel" value="' + lcEsc(prefillPhone) + '" '
    +   'placeholder="9876543210" style="width:100%;padding:12px;border:1px solid #ddcce2;border-radius:9px;font:inherit;min-height:44px;margin-top:4px"></label>'
    + '<div style="display:flex;gap:10px;align-items:flex-end;margin:14px 0 6px">'
    +   '<label style="flex:1;font-size:13px">Reward every<select id="lc-new-interval" style="width:100%;padding:12px;border:1px solid #ddcce2;'
    +     'border-radius:9px;font:inherit;min-height:44px;margin-top:4px"><option value="10">10 days</option><option value="15">15 days</option></select></label>'
    +   '<label style="flex:1;font-size:13px">Complimentary item<select id="lc-new-item" style="width:100%;padding:12px;border:1px solid #ddcce2;'
    +     'border-radius:9px;font:inherit;min-height:44px;margin-top:4px">' + optHtml + '</select></label>'
    + '</div>'
    + '<button type="button" onclick="lcBuildSchedule()" style="cursor:pointer;border:1px solid #e2cfe6;background:white;color:#790c88;'
    +   'border-radius:10px;padding:11px 15px;min-height:44px;font:inherit">Build reward milestones</button>'
    + '<div id="lc-new-schedule" style="margin-top:10px"></div>'
    + '<button onclick="lcIssue()" style="cursor:pointer;background:#790c88;color:#fff;border:0;border-radius:10px;'
    +   'padding:13px 16px;min-height:44px;font:inherit;margin-top:14px;width:100%">Issue card</button>'
    + '</div>';
}

function lcBuildSchedule() {
  var interval = Number(document.getElementById('lc-new-interval').value);
  var item = document.getElementById('lc-new-item').value;
  var days = [];
  for (var d = interval; d < 100; d += interval) days.push(d);
  days.push(100);
  var opts = Array.prototype.map.call(document.getElementById('lc-new-item').options, function (o) { return o.value; });
  document.getElementById('lc-new-schedule').innerHTML = days.map(function (d) {
    return '<label style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;font-size:13px">Day ' + d
      + '<select data-day="' + d + '" style="width:60%;padding:9px;border:1px solid #ddcce2;border-radius:9px;font:inherit">'
      + opts.map(function (n) { return '<option ' + (n === item ? 'selected' : '') + '>' + lcEsc(n) + '</option>'; }).join('')
      + '</select></label>';
  }).join('');
}

async function lcIssue() {
  var name = (document.getElementById('lc-new-name').value || '').trim();
  var phoneRaw = (document.getElementById('lc-new-phone').value || '').replace(/\D/g, '');
  var phone = phoneRaw.length === 10 ? '+91' + phoneRaw : (phoneRaw.length ? phoneRaw : '');
  var scheduleEls = document.querySelectorAll('#lc-new-schedule [data-day]');
  if (!name) { lcMsg('Enter the customer\'s name'); return; }
  if (phoneRaw.length !== 10) { lcMsg('Enter a valid 10-digit mobile number'); return; }
  if (!scheduleEls.length) { lcMsg('Build and review the reward milestones first'); return; }
  var schedule = Array.prototype.map.call(scheduleEls, function (s) { return { day: Number(s.dataset.day), item: s.value }; });

  lcBusy(true);
  try {
    _lcMember = await lcCommand('issue', { name: name, phone: phone, schedule: schedule });
    _lcMembers = [_lcMember];
    lcMsg('');
    showStoreToast('✅ Card issued — ' + _lcMember.card_code);
    lcRenderResults();
  } catch (e) { lcMsg(e.message); } finally { lcBusy(false); }
}

// ══════════════════════════════════════════════════════════════
// Kitchen integration — shows a table order's loyalty card (code,
// visit count, any reward ready) right on its ticket when the order's
// phone number matches an existing card, and lets staff apply an
// unlocked reward straight to that order's bill.
// ══════════════════════════════════════════════════════════════
function lcLast10(phone) {
  var digits = String(phone || '').replace(/\D/g, '');
  return digits.slice(-10);
}

// Batch-fetches loyalty cards for every table order's phone in one
// round trip. Never throws — Kitchen must still render fine even if
// Loyalty Cards isn't installed yet or the call fails for any reason.
function lcParseGroupPhones(value) {
  var result=[];
  String(value || '').split(',').forEach(function(part) {
    part=part.trim(); if(!part) return;
    if(!/^\+?[0-9 ()-]+$/.test(part)) throw new Error('Enter valid mobile numbers separated by commas.');
    var digits=part.replace(/\D/g,'');
    if(digits.length===12 && digits.slice(0,2)==='91') digits=digits.slice(2);
    if(digits.length!==10) throw new Error('Each mobile number must contain 10 digits (optional +91).');
    var phone='+91'+digits;
    if(result.indexOf(phone)===-1) result.push(phone);
  });
  if(result.length>20) throw new Error('Enter at most 20 friends per order.');
  return result;
}
function lcOrderPhones(order) {
  var values=[order.customer_phone].concat(Array.isArray(order.customer_group_phones)?order.customer_group_phones:[]);
  var result=[];
  values.forEach(function(p) { try { lcParseGroupPhones(p).forEach(function(n) {if(result.indexOf(n)<0) result.push(n);}); } catch(e) {} });
  return result;
}

async function lcLoyaltyMapFor(orders) {
  var phones = [];
  var seen = {};
  (orders || []).forEach(function (o) {
    lcOrderPhones(o).forEach(function(phone) {
      var last10=lcLast10(phone);
      if(!seen[last10]) { seen[last10]=true; phones.push(phone); }
    });
  });
  if (!phones.length) return {};
  try {
    var res = await lcCommand('lookup_many', { phones: phones });
    var map = {};
    (res.members || []).forEach(function (m) { map[lcLast10(m.phone)] = m; });
    return map;
  } catch (e) {
    return {_unavailable:true};
  }
}

// One item's reward status for a given card: available now, still
// locked, or already given.
function lcRewardsFor(member) {
  return (member.schedule || []).map(function (s) {
    var status = (member.redeemed_days || []).indexOf(s.day) !== -1 ? 'redeemed'
      : s.day <= member.stamp_count ? 'available' : 'locked';
    return { day: s.day, item: s.item, status: status };
  });
}

// Applies one unlocked reward to a specific table order: finds a
// matching, not-already-complimentary unit of that item in the order,
// marks it complimentary (splitting the line if more than one was
// ordered), recomputes the total, and marks the reward redeemed. If the
// item isn't in the order at all, asks staff to add it first rather
// than guessing.
async function lcApplyRewardToOrder(orderId, memberId, day, itemName) {
  try {
    var res = await db.from('store_orders').select('items,total').eq('id', orderId).single();
    if (res.error) throw res.error;
    var items = Array.isArray(res.data.items) ? res.data.items : JSON.parse(res.data.items || '[]');
    var idx = items.findIndex(function (i) { return i.name === itemName && !i.complimentary; });
    if (idx === -1) {
      showStoreToast('Add ' + itemName + ' to this order first, then apply the reward.');
      return;
    }
    if (items[idx].qty > 1) {
      items[idx].qty -= 1;
      items.splice(idx + 1, 0, { name: itemName, price: items[idx].price, qty: 1, complimentary: true });
    } else {
      items[idx].complimentary = true;
    }
    var newTotal = items.reduce(function (s, i) { return s + (i.complimentary ? 0 : i.price * i.qty); }, 0);

    var upd = await db.from('store_orders').update({ items: JSON.stringify(items), total: newTotal }).eq('id', orderId);
    if (upd.error) throw upd.error;

    await lcCommand('redeem', { member_id: memberId, day: day });
    showStoreToast('🎁 ' + itemName + ' applied free — reward redeemed');
    if (typeof kitchenManualRefresh === 'function') kitchenManualRefresh();
  } catch (e) {
    showStoreToast('Error: ' + e.message);
  }
}
window.lcLoyaltyMapFor = lcLoyaltyMapFor;
window.lcRewardsFor = lcRewardsFor;
window.lcApplyRewardToOrder = lcApplyRewardToOrder;

// ── Entry points ──
function _lcRegister() {
  if (window.registerAdminTool) {
    window.registerAdminTool('Daily Operations', {
      icon: '♛', iconBg: 'rgba(121,12,136,0.12)',
      title: 'Loyalty Cards', subtitle: 'Look up, stamp & issue cards',
      onClick: lcOpen
    });
  }
}
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _lcRegister); } else { _lcRegister(); }
window.openLoyaltyCards = lcOpen;
