/**
 * customer-returns-patch.js — ChocoCravings On Store
 * Feature: Customer Returns (Reports > Customer Returns, owner only).
 *
 *  - New vs returning customers for 30 / 60 / 90 days, and how many
 *    first-timers came back for a 2nd visit.
 *  - Missing regulars (3+ visits, nothing for 30-180 days) with their
 *    favourite item. Tick them and send a personal push ("We miss you
 *    {name}! Your {item} is waiting") to those with the app; the rest get
 *    a WhatsApp button with the same message filled in.
 *  - Top regulars of the last 90 days.
 * Data: cc_customer_returns / cc_winback_send / cc_winback_mark
 * (migrations/20260970_customer_returns_stock_count.sql).
 * Load AFTER reports-hub-patch.js.
 */

var _crDays = 30, _crData = null;
var CR_DEFAULT_TITLE = 'We miss you, {name}! 🍫';
var CR_DEFAULT_BODY = 'Your {item} is waiting at ChocoCravings. Show this message at the counter this week for a special treat.';

function crEsc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function crRs(v) { return '₹' + Math.round(Number(v) || 0).toLocaleString('en-IN'); }
function crAgo(d) { d = Number(d) || 0; return d === 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago'; }
function crFill(text, c) {
  var first = String(c.name || '').trim().split(/\s+/)[0] || 'friend';
  return String(text).replace(/\{name\}/g, first).replace(/\{item\}/g, c.fav || 'favourite treat');
}

function buildCustomerReturnsUI() {
  if (document.getElementById('cr-sheet')) return;
  var overlay = document.createElement('div');
  overlay.id = 'cr-overlay'; overlay.onclick = closeCustomerReturns;
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:3950;backdrop-filter:blur(4px)';
  document.body.appendChild(overlay);
  var sheet = document.createElement('div');
  sheet.id = 'cr-sheet'; sheet.setAttribute('role', 'dialog'); sheet.setAttribute('aria-label', 'Customer returns');
  sheet.style.cssText = 'display:none;position:fixed;bottom:0;left:50%;transform:translateX(-50%);width:100%;max-width:620px;background:#fffbf2;'
    + 'border-radius:24px 24px 0 0;z-index:3951;max-height:92vh;overflow-y:auto;font-family:\'Instrument Sans\',\'DM Sans\',sans-serif;'
    + 'padding-bottom:calc(24px + env(safe-area-inset-bottom,0px))';
  sheet.innerHTML =
      '<div style="position:sticky;top:0;background:#fffbf2;z-index:1;padding:14px 20px 12px;border-bottom:1px solid #f0e4d4">'
    +   '<div style="width:40px;height:4px;border-radius:2px;background:#e6d6c4;margin:0 auto 12px"></div>'
    +   '<div style="display:flex;align-items:center;gap:10px">'
    +     '<div style="flex:1"><div style="font-size:9px;font-weight:700;letter-spacing:2.5px;color:#9c0ca1;text-transform:uppercase">Owner</div>'
    +     '<div style="font-family:Fraunces,Georgia,serif;font-size:20px;font-weight:900;color:#1a0820">Customer returns</div></div>'
    +     '<div id="cr-days" role="group" aria-label="Period" style="display:flex;gap:4px"></div>'
    +     '<button type="button" onclick="closeCustomerReturns()" aria-label="Close" style="width:36px;height:36px;border-radius:50%;border:0;background:rgba(18,10,30,.06);font-size:16px;color:#3b1a08;cursor:pointer">✕</button>'
    +   '</div></div>'
    + '<div id="cr-body" style="padding:16px 20px"></div>';
  document.body.appendChild(sheet);
  sheet.addEventListener('change', function (e) { if (e.target.classList.contains('cr-pick') || e.target.id === 'cr-all') crPickChanged(e.target); });
}

function openCustomerReturns() {
  buildCustomerReturnsUI();
  document.getElementById('cr-overlay').style.display = 'block';
  document.getElementById('cr-sheet').style.display = 'block';
  crLoad(_crDays);
}
function closeCustomerReturns() {
  var o = document.getElementById('cr-overlay'), s = document.getElementById('cr-sheet');
  if (o) o.style.display = 'none'; if (s) s.style.display = 'none';
}

function crRenderDays() {
  document.getElementById('cr-days').innerHTML = [30, 60, 90].map(function (d) {
    var on = d === _crDays;
    return '<button type="button" onclick="crLoad(' + d + ')" aria-pressed="' + on + '" style="padding:7px 10px;border-radius:999px;font-size:11px;font-weight:700;cursor:pointer;'
      + (on ? 'background:#6e0977;color:#fff;border:1px solid #6e0977' : 'background:#fff;color:#6e0977;border:1px solid #e6d6c4') + '">' + d + 'd</button>';
  }).join('');
}

async function crLoad(days) {
  _crDays = days; crRenderDays();
  var body = document.getElementById('cr-body');
  body.innerHTML = '<div style="text-align:center;padding:30px;color:#9a8aaa;font-size:12px">Loading…</div>';
  var res = await db.rpc('cc_customer_returns', { p_days: days });
  if (days !== _crDays) return;
  if (res.error) {
    var msg = res.error.message || '';
    body.innerHTML = '<div style="padding:20px;border-radius:14px;background:#fff3f3;color:#991b1b;font-size:13px">'
      + (/cc_customer_returns|schema cache/i.test(msg) ? 'The database update is missing. Run migrations/20260970_customer_returns_stock_count.sql in Supabase.' : crEsc(msg)) + '</div>';
    return;
  }
  _crData = res.data || {};
  crRender();
}

function crStat(label, value, sub) {
  return '<div style="background:#fff;border:1px solid #f0e4d4;border-radius:14px;padding:12px 14px"><div style="font-size:11px;color:#9a8aaa">' + label + '</div>'
    + '<div style="font-family:Fraunces,Georgia,serif;font-size:24px;font-weight:900;color:#1a0820;line-height:1.2">' + value + '</div>'
    + '<div style="font-size:11px;color:#7a6a86">' + sub + '</div></div>';
}
function crSection(title, sub, html) {
  return '<div style="margin-top:22px"><div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#c2607a;text-transform:uppercase">' + title + '</div>'
    + (sub ? '<div style="font-size:12px;color:#7a6a86;margin:4px 0 10px">' + sub + '</div>' : '<div style="height:10px"></div>') + html + '</div>';
}

function crRender() {
  var d = _crData, s = d.summary || {}, sv = d.second_visit || {}, missing = d.missing || [], top = d.top || [];
  var retPct = s.active ? Math.round(s.returning / s.active * 100) : 0;
  var secPct = sv.first_timers ? Math.round(sv.came_back / sv.first_timers * 100) : null;
  var html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px">'
    + crStat('Customers', s.active || 0, 'last ' + s.days + ' days')
    + crStat('New', s.new || 0, 'first visit in this period')
    + crStat('Returning', (s.returning || 0) + ' <span style="font-size:13px;color:#7a6a86">(' + retPct + '%)</span>', 'had been before')
    + crStat('2nd visit', secPct == null ? '—' : secPct + '%', secPct == null ? 'not enough first-timers yet' : (sv.came_back + ' of ' + sv.first_timers + ' first-timers came back'))
    + '</div><div style="font-size:11px;color:#9a8aaa;margin-top:8px">Counted by phone number on counter orders and app accounts. Orders without a phone are not included.</div>';

  var withApp = missing.filter(function (m) { return m.has_app; }).length;
  html += crSection('Missing regulars · ' + missing.length,
    '3+ visits before, but nothing for over 30 days. Most valuable first. ' + (withApp ? withApp + ' have the app (push); the rest can be messaged on WhatsApp.' : 'None have the app with notifications on, so use WhatsApp.'),
    missing.length ? (
      '<div style="background:#fff;border:1px solid #f0e4d4;border-radius:14px;padding:12px 14px;margin-bottom:10px">'
      + '<label style="display:block;font-size:11px;font-weight:700;color:#6a5a76">Title<input id="cr-title" maxlength="80" value="' + crEsc(CR_DEFAULT_TITLE) + '" style="display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:9px 10px;border:1px solid #e6d6c4;border-radius:9px;font:inherit;font-weight:400"></label>'
      + '<label style="display:block;font-size:11px;font-weight:700;color:#6a5a76;margin-top:8px">Message<textarea id="cr-body-text" maxlength="300" rows="3" style="display:block;width:100%;box-sizing:border-box;margin-top:4px;padding:9px 10px;border:1px solid #e6d6c4;border-radius:9px;font:inherit;font-weight:400;resize:vertical">' + crEsc(CR_DEFAULT_BODY) + '</textarea></label>'
      + '<div style="font-size:11px;color:#9a8aaa;margin-top:6px">{name} = first name, {item} = their favourite item. Write the offer you want to give.</div>'
      + '<div style="display:flex;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap"><label style="font-size:12px;font-weight:600;color:#3b1a08;display:flex;align-items:center;gap:6px"><input type="checkbox" id="cr-all"> Select all</label>'
      + '<button type="button" id="cr-send" onclick="crSendPush()" disabled style="margin-left:auto;padding:10px 14px;border-radius:11px;border:0;font-size:12px;font-weight:700;color:#fff;background:linear-gradient(135deg,#6e0977,#9c0ca1);cursor:pointer;opacity:.45">📲 Send push</button></div></div>'
      + missing.map(function (m, i) {
          return '<div style="display:flex;gap:10px;align-items:flex-start;background:#fff;border:1px solid #f0e4d4;border-radius:12px;padding:10px 12px;margin-bottom:8px">'
            + '<input type="checkbox" class="cr-pick" data-i="' + i + '" aria-label="Select ' + crEsc(m.name || m.phone) + '" style="margin-top:3px;width:18px;height:18px">'
            + '<div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:700;color:#1a0820">' + crEsc(m.name || 'No name') + ' <span style="font-size:11px;font-weight:600;color:#9a8aaa">' + crEsc(m.phone) + '</span></div>'
            + '<div style="font-size:12px;color:#6a5a76">' + m.visits + ' visits · ' + crRs(m.spent) + ' · last ' + crAgo(m.days_since) + (m.fav ? ' · loves ' + crEsc(m.fav) : '') + '</div>'
            + (m.messaged_at ? '<div style="font-size:11px;color:#15803d;margin-top:2px">✓ Messaged ' + new Date(m.messaged_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + '</div>' : '')
            + '</div>'
            + (m.has_app ? '<span style="font-size:10px;font-weight:700;color:#6e0977;background:rgba(110,9,119,.08);border-radius:999px;padding:4px 8px;white-space:nowrap">📱 App</span>'
              : '<button type="button" onclick="crWhatsApp(' + i + ')" style="font-size:11px;font-weight:700;color:#15803d;background:#fff;border:1px solid rgba(21,128,61,.35);border-radius:999px;padding:6px 10px;cursor:pointer;white-space:nowrap">WhatsApp</button>')
            + '</div>';
        }).join(''))
      : '<div style="font-size:13px;color:#15803d">No regulars missing 👍</div>');

  html += crSection('Top regulars · last 90 days', 'Your most loyal customers. Thank them, or ask them for a review.',
    top.length ? top.map(function (t, i) {
      return '<div style="display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-top:' + (i ? '1px solid #f0e4d4' : '0') + ';font-size:13px">'
        + '<span><b>' + crEsc(t.name || t.phone) + '</b>' + (t.fav ? ' <span style="color:#9a8aaa">· ' + crEsc(t.fav) + '</span>' : '') + '</span>'
        + '<span style="white-space:nowrap;color:#6a5a76">' + t.visits + ' visits · ' + crRs(t.spent) + '</span></div>';
    }).join('') : '<div style="font-size:13px;color:#9a8aaa">Not enough repeat visits yet.</div>');

  document.getElementById('cr-body').innerHTML = html;
}

function crPicked() {
  return Array.prototype.slice.call(document.querySelectorAll('#cr-sheet .cr-pick:checked')).map(function (el) { return _crData.missing[Number(el.dataset.i)]; });
}
function crPickChanged(el) {
  if (el.id === 'cr-all') document.querySelectorAll('#cr-sheet .cr-pick').forEach(function (c) { c.checked = el.checked; });
  var picked = crPicked(), push = picked.filter(function (m) { return m.has_app; }).length, btn = document.getElementById('cr-send');
  btn.disabled = !picked.length; btn.style.opacity = picked.length ? '1' : '.45';
  btn.textContent = picked.length ? '📲 Send to ' + picked.length + (push < picked.length ? ' (' + push + ' by push)' : '') : '📲 Send push';
}

async function crSendPush() {
  var picked = crPicked(); if (!picked.length) return;
  var title = document.getElementById('cr-title').value.trim(), body = document.getElementById('cr-body-text').value.trim();
  if (!title || !body) { showStoreToast('Write a title and a message'); return; }
  var push = picked.filter(function (m) { return m.has_app; }).length;
  if (!confirm('Send this to ' + picked.length + ' customer' + (picked.length === 1 ? '' : 's') + '?\n\n' + crFill(title, picked[0]) + '\n' + crFill(body, picked[0])
      + (push < picked.length ? '\n\n' + (picked.length - push) + ' do not have the app — you will get WhatsApp buttons for them.' : ''))) return;
  var btn = document.getElementById('cr-send'); btn.disabled = true;
  var res = await db.rpc('cc_winback_send', { p_phones: picked.map(function (m) { return m.phone; }), p_title: title, p_body: body });
  if (res.error) { btn.disabled = false; showStoreToast('Not sent: ' + res.error.message); return; }
  var r = res.data || {}, noApp = r.no_app || [];
  showStoreToast('📲 Sent to ' + (r.pushed || 0) + ' by push' + (noApp.length ? ' · ' + noApp.length + ' to WhatsApp' : ''));
  await crLoad(_crDays);
  if (noApp.length) crShowWhatsAppList(noApp, title, body);
}

function crWaLink(c, title, body) {
  return 'https://wa.me/91' + encodeURIComponent(c.phone) + '?text=' + encodeURIComponent(crFill(title, c) + '\n' + crFill(body, c));
}
function crWhatsApp(i) {
  var c = _crData.missing[i];
  var title = (document.getElementById('cr-title') || {}).value || CR_DEFAULT_TITLE, body = (document.getElementById('cr-body-text') || {}).value || CR_DEFAULT_BODY;
  window.open(crWaLink(c, title, body), '_blank', 'noopener');
  db.rpc('cc_winback_mark', { p_phone: c.phone, p_channel: 'whatsapp', p_message: body }).then(function () { crLoad(_crDays); });
}
function crShowWhatsAppList(list, title, body) {
  var box = document.createElement('div');
  box.style.cssText = 'margin-top:12px;background:#f0fdf4;border:1px solid rgba(21,128,61,.3);border-radius:14px;padding:12px 14px';
  box.innerHTML = '<div style="font-size:12px;font-weight:700;color:#15803d;margin-bottom:8px">No app — send on WhatsApp (tap each)</div>'
    + list.map(function (c) {
        return '<a href="' + crWaLink(c, title, body) + '" target="_blank" rel="noopener" data-phone="' + crEsc(c.phone) + '" style="display:flex;justify-content:space-between;padding:8px 0;border-top:1px solid rgba(21,128,61,.15);color:#14532d;text-decoration:none;font-size:13px">'
          + '<span>' + crEsc(c.name || c.phone) + '</span><b>WhatsApp ›</b></a>';
      }).join('');
  box.addEventListener('click', function (e) {
    var a = e.target.closest('a[data-phone]'); if (!a) return;
    db.rpc('cc_winback_mark', { p_phone: a.dataset.phone, p_channel: 'whatsapp', p_message: body });
    a.style.opacity = '.5';
  });
  var body0 = document.getElementById('cr-body');
  body0.insertBefore(box, body0.children[1] || null);
}
