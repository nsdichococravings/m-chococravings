/**
 * birthday-report-patch.js — ChocoCravings On Store
 * Staff-facing daily birthday report — who's customer birthday is
 * today, and who's coming up in the next 4 days.
 *
 * "Runs automatically" here means the same thing every other staff
 * alert in this app already means — there is no server-side cron
 * anywhere in this app, so this checks the moment an admin/staff
 * opens the app (mirrors the existing new-order-chime pattern) rather
 * than running as a genuinely background job.
 *
 * Requires: db, showStoreToast(), registerAdminTool(), ccUpdateBadge()
 * — already global by the time this loads (admin-command-center.js
 * loads first; see checkadminbadge-override.js's load order).
 */

var _brDialog = null;
var _brReport = null;

function brMaskPhone(p) {
  p = String(p || '');
  return p.length > 4 ? ('••••••' + p.slice(-4)) : p;
}

function brEsc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

async function brLoad() {
  try {
    var res = await db.rpc('cc_birthday_report');
    if (res.error) throw res.error;
    _brReport = res.data;
    brNotify();
    if (typeof ccUpdateBadge === 'function') ccUpdateBadge('birthday-report', (_brReport.today || []).length);
    if (_brDialog && _brDialog.open) brRender();
  } catch (e) {
    console.warn('birthday report:', e.message);
  }
}

// Surfaces itself the moment it loads, same as the new-order chime —
// staff never has to remember to open a report to see this.
function brNotify() {
  if (!_brReport) return;
  var today = (_brReport.today || []);
  var upcoming = (_brReport.upcoming || []);
  if (today.length) {
    var names = today.map(function (c) { return c.name; }).join(', ');
    showStoreToast('🎉 Birthday today: ' + names);
  }
  if (upcoming.length) {
    showStoreToast('🎂 ' + upcoming.length + ' birthday' + (upcoming.length === 1 ? '' : 's') + ' coming up in the next 4 days');
  }
}

function brInit() {
  if (_brDialog) return;
  var d = document.createElement('dialog');
  d.id = 'br-dialog';
  d.style.cssText = 'width:min(560px,calc(100% - 24px));max-height:92dvh;padding:0;border:1px solid #eadfeb;'
    + 'border-radius:22px;background:#fffaf3;color:#291830;font:14px \'DM Sans\',Arial,sans-serif';
  d.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:20px 24px;'
    +   'position:sticky;top:0;background:#fffaf3;border-bottom:1px solid #eadfeb;z-index:1">'
    +   '<div><div style="font-size:10px;letter-spacing:2px;color:#8c647f">CHOCOCRAVINGS</div>'
    +     '<h2 style="font:27px Georgia,serif;margin:5px 0 0">🎂 Birthdays</h2></div>'
    +   '<button type="button" onclick="brClose()" style="font-size:26px;border:0;background:transparent;cursor:pointer">×</button>'
    + '</div>'
    + '<div id="br-body" style="padding:0 24px 24px"></div>';
  d.addEventListener('cancel', function (e) { e.preventDefault(); brClose(); });
  document.body.appendChild(d);
  _brDialog = d;
}

function brOpen() {
  brInit();
  if (!_brDialog.open) _brDialog.showModal();
  brRender();
  if (!_brReport) brLoad();
}

function brClose() {
  if (_brDialog && _brDialog.open) _brDialog.close();
}

function brRender() {
  var body = document.getElementById('br-body');
  if (!body) return;

  if (!_brReport) {
    body.innerHTML = '<p style="text-align:center;color:#79677e;padding:30px 0">Loading…</p>';
    return;
  }

  var today = _brReport.today || [];
  var upcoming = _brReport.upcoming || [];

  if (!today.length && !upcoming.length) {
    body.innerHTML = '<div style="text-align:center;padding:40px 0">'
      + '<div style="font-size:32px;margin-bottom:8px">🎈</div>'
      + '<div style="font:19px Georgia,serif;color:#291830">No birthdays in the next 4 days</div>'
      + '<div style="font-size:12px;color:#a08b9f;margin-top:4px">Checked as of ' + brEsc(_brReport.checked_date || '') + '</div>'
      + '</div>';
    return;
  }

  body.innerHTML = brSection('🎉 Today', today, true) + brSection('🎂 Coming up', upcoming, false);
}

function brSection(title, list, isToday) {
  if (!list.length) return '';
  return '<h3 style="font-size:15px;margin:18px 0 8px">' + title + '</h3>'
    + list.map(function (c) { return brCard(c, isToday); }).join('');
}

function brCard(c, isToday) {
  var digits = String(c.phone || '').replace(/\D/g, '');
  var waLink = digits.length >= 10 ? 'https://wa.me/' + digits : null;
  var telLink = c.phone ? 'tel:' + c.phone : null;
  var dob = c.date_of_birth ? new Date(c.date_of_birth + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'long' }) : '';
  var whenLine = isToday
    ? 'Today · ' + dob
    : (c.days_until === 1 ? 'Tomorrow' : 'In ' + c.days_until + ' days') + ' · ' + dob;

  return '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;'
    + 'border:1px solid #eadfeb;background:white;border-radius:14px;padding:12px 14px;margin-bottom:8px">'
    + '<div style="min-width:0">'
    +   '<div style="font-weight:700;font-size:14px;color:#291830;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + brEsc(c.name || 'Unnamed') + '</div>'
    +   '<div style="font-size:11px;color:#79677e;margin-top:2px">' + brEsc(whenLine) + (c.phone ? ' · ' + brMaskPhone(c.phone) : '') + '</div>'
    + '</div>'
    + '<div style="display:flex;gap:6px;flex-shrink:0">'
    +   (telLink ? '<a href="' + telLink + '" style="text-decoration:none;display:flex;align-items:center;justify-content:center;'
        + 'width:36px;height:36px;border-radius:50%;background:#f5eeff;font-size:15px">📞</a>' : '')
    +   (waLink ? '<a href="' + waLink + '" target="_blank" rel="noopener" style="text-decoration:none;display:flex;align-items:center;justify-content:center;'
        + 'width:36px;height:36px;border-radius:50%;background:#e7fbee;font-size:15px">💬</a>' : '')
    + '</div>'
    + '</div>';
}

function _brRegister() {
  if (window.registerAdminTool) {
    window.registerAdminTool('Growth & Insights', {
      icon: '🎂', iconBg: 'rgba(245,158,11,0.12)',
      title: 'Birthday Report', subtitle: "Today's & upcoming birthdays",
      badgeId: 'birthday-report',
      onClick: brOpen
    });
  }
  brLoad();
}
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _brRegister); } else { _brRegister(); }
window.openBirthdayReport = brOpen;
