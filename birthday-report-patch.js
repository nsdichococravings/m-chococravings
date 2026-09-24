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

  return '<div id="br-card-' + c.id + '" style="border:1px solid #eadfeb;background:white;border-radius:14px;padding:12px 14px;margin-bottom:8px">'
    + '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px">'
    + '<div style="min-width:0">'
    +   '<div style="font-weight:700;font-size:14px;color:#291830;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + brEsc(c.name || 'Unnamed') + '</div>'
    +   '<div style="font-size:11px;color:#79677e;margin-top:2px">' + brEsc(whenLine) + (c.phone ? ' · ' + brEsc(c.phone) : '') + '</div>'
    + '</div>'
    + '<div style="display:flex;gap:6px;flex-shrink:0">'
    +   (telLink ? '<a href="' + telLink + '" style="text-decoration:none;display:flex;align-items:center;justify-content:center;'
        + 'width:36px;height:36px;border-radius:50%;background:#f5eeff;font-size:15px">📞</a>' : '')
    +   (waLink ? '<a href="' + waLink + '" target="_blank" rel="noopener" style="text-decoration:none;display:flex;align-items:center;justify-content:center;'
        + 'width:36px;height:36px;border-radius:50%;background:#e7fbee;font-size:15px">💬</a>' : '')
    + '</div>'
    + '</div>'
    + '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;padding-top:10px;border-top:1px solid #f5eeff">'
    +   brChip(c.id, 'wishes_sent', c.wishes_sent, 'Wishes sent')
    +   brChip(c.id, 'card_sent', c.card_sent, 'Card sent')
    +   '<button type="button" onclick="brOpenPoster(\'' + c.id + '\')" style="cursor:pointer;border:1px solid #e2cfe6;background:white;color:#790c88;'
    +     'border-radius:20px;padding:5px 10px;font-size:10.5px;font-weight:600">🎨 Send card</button>'
    + '</div>'
    + '</div>';
}

function brChip(customerId, field, checked, label) {
  return '<button type="button" onclick="brToggle(\'' + customerId + '\',\'' + field + '\')" style="cursor:pointer;'
    + 'border:1px solid ' + (checked ? '#86efac' : '#ddcce2') + ';background:' + (checked ? '#ecfdf3' : 'white') + ';'
    + 'color:' + (checked ? '#15803d' : '#79677e') + ';border-radius:20px;padding:5px 10px;font-size:10.5px;font-weight:600">'
    + (checked ? '✅' : '⬜') + ' ' + brEsc(label) + '</button>';
}

// Finds a customer's entry in the currently-loaded report (today or
// upcoming) so toggles/poster sends can update it in place.
function brFind(customerId) {
  if (!_brReport) return null;
  return (_brReport.today || []).concat(_brReport.upcoming || []).filter(function (c) { return c.id === customerId; })[0] || null;
}

async function brToggle(customerId, field) {
  var c = brFind(customerId);
  if (!c) return;
  var next = !c[field];
  c[field] = next; // optimistic — flip immediately, revert on failure
  brRender();
  try {
    var res = await db.rpc('cc_birthday_mark', { p_customer_id: customerId, p_field: field, p_value: next });
    if (res.error) throw res.error;
  } catch (e) {
    c[field] = !next;
    brRender();
    showStoreToast('Could not update: ' + e.message);
  }
}

// ══════════════════════════════════════════════════════════════
// Birthday card poster — a branded, shareable image generated right
// in the browser (HTML5 canvas), so staff has an actual card to send,
// not just a text message. Downloadable everywhere; shares as a real
// image file via the Web Share API where the browser supports it
// (mobile Chrome/Safari — this is a PWA, mostly used on phones).
// ══════════════════════════════════════════════════════════════
var _brPosterDialog = null;
var _brPosterCustomerId = null;

function brWrapLines(ctx, text, maxWidth) {
  var words = String(text || '').split(' ');
  var lines = [];
  var line = '';
  words.forEach(function (w) {
    var test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  });
  if (line) lines.push(line);
  return lines;
}

async function brDrawPoster(canvas, name) {
  if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }
  var ctx = canvas.getContext('2d');
  var W = canvas.width, H = canvas.height;

  ctx.fillStyle = '#29112f';
  ctx.fillRect(0, 0, W, H);
  var grad = ctx.createRadialGradient(W * 0.82, H * 0.14, 10, W * 0.82, H * 0.14, W);
  grad.addColorStop(0, '#672477');
  grad.addColorStop(1, 'rgba(103,36,119,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(245,196,48,0.5)';
  ctx.lineWidth = 5;
  ctx.strokeRect(34, 34, W - 68, H - 68);

  ctx.textAlign = 'center';

  ctx.fillStyle = '#dabc84';
  ctx.font = '600 26px Georgia, serif';
  ctx.fillText('C H O C O C R A V I N G S', W / 2, 150);

  ctx.font = '130px sans-serif';
  ctx.fillText('🎉🎂🎉', W / 2, 340);

  ctx.fillStyle = '#fff3df';
  ctx.font = '700 62px Georgia, serif';
  ctx.fillText('Happy Birthday!', W / 2, 460);

  ctx.fillStyle = '#f5c430';
  ctx.font = 'italic 700 52px Georgia, serif';
  var nameLines = brWrapLines(ctx, name || 'Friend', W - 200);
  var nameY = 560;
  nameLines.slice(0, 2).forEach(function (line) {
    ctx.fillText(line, W / 2, nameY);
    nameY += 62;
  });

  ctx.fillStyle = '#dcc2df';
  ctx.font = '30px "DM Sans", Arial, sans-serif';
  var msgLines = brWrapLines(ctx, 'Wishing you a day as sweet as our chocolates 🍫', W - 220);
  var msgY = Math.max(nameY + 40, H - 190);
  msgLines.forEach(function (line) {
    ctx.fillText(line, W / 2, msgY);
    msgY += 40;
  });

  ctx.fillStyle = '#dabc84';
  ctx.font = '600 26px Georgia, serif';
  ctx.fillText('— With love, ChocoCravings', W / 2, H - 90);
}

function brPosterInit() {
  if (_brPosterDialog) return;
  var d = document.createElement('dialog');
  d.id = 'br-poster-dialog';
  d.style.cssText = 'width:min(420px,calc(100% - 24px));padding:0;border:1px solid #eadfeb;'
    + 'border-radius:22px;background:#fffaf3;color:#291830;font:14px \'DM Sans\',Arial,sans-serif';
  d.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px">'
    +   '<h2 style="font:20px Georgia,serif;margin:0">🎨 Birthday Card</h2>'
    +   '<button type="button" onclick="brClosePoster()" style="font-size:24px;border:0;background:transparent;cursor:pointer">×</button>'
    + '</div>'
    + '<div style="padding:0 20px 20px">'
    +   '<canvas id="br-poster-canvas" width="1080" height="1080" style="width:100%;border-radius:14px;display:block"></canvas>'
    +   '<div id="br-poster-actions" style="display:flex;gap:10px;margin-top:14px"></div>'
    + '</div>';
  d.addEventListener('cancel', function (e) { e.preventDefault(); brClosePoster(); });
  document.body.appendChild(d);
  _brPosterDialog = d;
}

async function brOpenPoster(customerId) {
  var c = brFind(customerId);
  if (!c) return;
  _brPosterCustomerId = customerId;
  brPosterInit();
  if (!_brPosterDialog.open) _brPosterDialog.showModal();

  var canvas = document.getElementById('br-poster-canvas');
  await brDrawPoster(canvas, c.name);

  var actions = document.getElementById('br-poster-actions');
  var canShare = typeof navigator.share === 'function';
  actions.innerHTML =
      '<button type="button" onclick="brDownloadPoster()" style="flex:1;cursor:pointer;background:#790c88;color:#fff;border:0;'
    +   'border-radius:10px;padding:12px;min-height:44px;font:inherit;font-weight:600">⬇️ Download</button>'
    + (canShare
        ? '<button type="button" onclick="brSharePoster()" style="flex:1;cursor:pointer;background:white;color:#790c88;'
          + 'border:1px solid #e2cfe6;border-radius:10px;padding:12px;min-height:44px;font:inherit;font-weight:600">📤 Share</button>'
        : '');
}

function brClosePoster() {
  if (_brPosterDialog && _brPosterDialog.open) _brPosterDialog.close();
}

function brPosterBlob() {
  var canvas = document.getElementById('br-poster-canvas');
  return new Promise(function (resolve) { canvas.toBlob(resolve, 'image/png'); });
}

async function brDownloadPoster() {
  var blob = await brPosterBlob();
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'birthday-card.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 2000);
  brMarkCardSent();
}

async function brSharePoster() {
  try {
    var blob = await brPosterBlob();
    var file = new File([blob], 'birthday-card.png', { type: 'image/png' });
    if (navigator.canShare && !navigator.canShare({ files: [file] })) {
      return brDownloadPoster(); // falls back to download if this device can't share images
    }
    await navigator.share({ files: [file], title: 'Happy Birthday!' });
    brMarkCardSent();
  } catch (e) {
    if (e && e.name === 'AbortError') return; // user cancelled the share sheet — not an error
    showStoreToast('Could not share: ' + e.message);
  }
}

function brMarkCardSent() {
  var c = _brPosterCustomerId && brFind(_brPosterCustomerId);
  if (c && !c.card_sent) brToggle(_brPosterCustomerId, 'card_sent');
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
