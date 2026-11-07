/**
 * admin-command-center.js — ChocoCravings On Store
 * Feature: Replaces the flat "Admin Actions" dropdown with a categorized
 * Command Center — Daily Operations / Financial / Staff & HR / Growth &
 * Insights — instead of one ever-growing list.
 *
 * Other admin files register themselves via registerAdminTool() instead
 * of directly manipulating the FAB menu DOM — this file owns the layout.
 *
 * IMPORTANT — must load BEFORE any file that calls registerAdminTool():
 *   <script src="admin-command-center.js"></script>
 *   <script src="table-service-patch.js"></script>
 *   ...(all other admin patches)...
 *
 * Requires: `db`, `showStoreToast()`, `isAdmin` — already global.
 */

var CC_CATEGORIES = ['Daily Operations', 'Financial', 'Staff & HR', 'Growth & Insights'];
var _ccTools = { 'Daily Operations': [], 'Financial': [], 'Staff & HR': [], 'Growth & Insights': [] };
var _ccOpen = false;
var _ccAccessGranted = false;
function ccSetAccess(allowed) {
  _ccAccessGranted = allowed === true;
  if (_ccAccessGranted) setTimeout(function () { ccSaveToolList(); ccTryDeepLink(); }, 0);
  if (!_ccAccessGranted) {
    ccSlideClosed();
    _ccCallbacks = [];
    var body=document.getElementById('acc-body'); if(body) body.innerHTML='';
  }
  var tab=document.getElementById('acc-tab'), sheet=document.getElementById('acc-sheet');
  // The Command Center lives on Home now (left sidebar); NSDI Cafe keeps the
  // tools working for its links but shows no side handle.
  if(tab) tab.style.display='none';
  if(sheet) sheet.style.display=_ccAccessGranted?'block':'none';
  var pill=document.getElementById('admin-fab-pill'); if(pill) pill.style.display='none';
}
window.ccSetAccess=ccSetAccess;

// Called by other admin patch files instead of touching the FAB menu DOM
// directly. opts: { icon, title, subtitle, onClick, badgeId, superAdminOnly }
window.registerAdminTool = function (category, opts) {
  if (!_ccTools[category]) _ccTools[category] = [];
  _ccTools[category].push(opts);
  if (_ccOpen) renderCommandCenter(); // live-update if already open (e.g. late-registering tool)
  ccSaveToolList();
  ccTryDeepLink();
};

// ── Home page sidebar support ──
// The tools only work on this page, so Home (index.html) shows a saved copy
// of this admin's tool list and links back here with ?cc=<tool title>.
var CC_TOOLS_KEY = 'cc_command_tools_v1';
var _ccSaveTimer = null;
function ccVisibleTools() {
  var out = [];
  CC_CATEGORIES.forEach(function (cat) {
    (_ccTools[cat] || []).forEach(function (t) {
      if (t.superAdminOnly && !t._allowedSuper) return;
      var v = function (x) { try { return typeof x === 'function' ? x() : x; } catch (e) { return ''; } };
      out.push({ cat: cat, title: String(v(t.title) || ''), sub: String(v(t.subtitle) || ''), icon: String(v(t.icon) || ''), key: String(t.ccKey || v(t.title) || '') });
    });
  });
  return out;
}
function ccSaveToolList() {
  if (!_ccAccessGranted) return;
  try {
    clearTimeout(_ccSaveTimer);
    _ccSaveTimer = setTimeout(function () {
      try { localStorage.setItem(CC_TOOLS_KEY, JSON.stringify({ at: Date.now(), tools: ccVisibleTools() })); } catch (e) {}
    }, 800);
  } catch (e) {}
}
// store.html?cc=<title> opens that tool once it is registered (or the panel for cc=open).
var _ccDeepLink = (function () { try { return new URLSearchParams(location.search).get('cc'); } catch (e) { return null; } })();
var _ccDeepLinkUntil = Date.now() + 20000;
function ccTryDeepLink() {
  if (!_ccDeepLink || !_ccAccessGranted || Date.now() > _ccDeepLinkUntil) return;
  var want = _ccDeepLink, tool = null;
  if (want === 'open') { _ccDeepLink = null; return; } // the side panel was removed from NSDI Cafe
  {
    CC_CATEGORIES.forEach(function (cat) {
      (_ccTools[cat] || []).forEach(function (t) {
        if (tool || (t.superAdminOnly && !t._allowedSuper)) return;
        var title = typeof t.title === 'function' ? t.title() : t.title;
        if (t.ccKey === want || title === want) tool = t;
      });
    });
    if (!tool) return; // not registered yet; tried again as tools register
  }
  _ccDeepLink = null;
  try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {}
  setTimeout(function () {
    if (tool) tool.onClick();
  }, 300);
}

function _ccInit() {
  buildCommandCenterUI();
  replaceFabMenuBehavior();
  ccSetAccess(_ccAccessGranted);
}
if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', _ccInit); } else { _ccInit(); }

// The existing #admin-fab-pill button (already in store.html) still
// toggles open/closed — we just swap what opening it actually shows.
function replaceFabMenuBehavior() {
  var attempts = 0;
  var poll = setInterval(function () {
    attempts++;
    var pill = document.getElementById('admin-fab-pill');
    if (pill) {
      clearInterval(poll);
      pill.style.display = 'none'; // replaced entirely by the panel's access-controlled edge tab below

      window.openAdminMenu = function () { ccSlideOpen(); };
      window.closeAdminMenu = function () { ccSlideClosed(); };
    } else if (attempts >= 20) {
      clearInterval(poll);
    }
  }, 300);
}

// Panel sits at this "peek" position by default — only the tab handle
// shows at the screen edge, panel content just off-screen. Tapping the
// tab slides the whole thing fully into view; tapping again slides it
// back to peek. No backdrop while peeking — it's a permanent, non-
// blocking fixture, not a modal; the backdrop only appears once fully open.
var CC_OPEN_TRANSFORM = 'translateX(0)';
var CC_CLOSED_TRANSFORM = 'translateX(-100%)';

function ccSlideOpen() {
  if (!_ccAccessGranted) return;
  document.getElementById('acc-overlay').style.display = 'block';
  var sheet = document.getElementById('acc-sheet');
  sheet.style.transform = CC_OPEN_TRANSFORM;
  // The panel is narrower than 360px on phones (max-width:88vw).
  document.getElementById('acc-tab').style.left = (sheet.offsetWidth || 360) + 'px';
  _ccOpen = true;
  renderCommandCenter();
}
function ccSlideClosed() {
  var overlay=document.getElementById('acc-overlay'); if(overlay) overlay.style.display = 'none';
  var sheet=document.getElementById('acc-sheet'); if(sheet) sheet.style.transform = CC_CLOSED_TRANSFORM;
  var tab=document.getElementById('acc-tab'); if(tab) tab.style.left = '0px';
  _ccOpen = false;
}
function ccToggleSlide() {
  if (_ccOpen) ccSlideClosed(); else ccSlideOpen();
}

var CC_CSS = ''
  + '#acc-overlay{position:fixed;inset:0;background:rgba(26,8,32,.5);z-index:498;backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}'
  + '#acc-sheet{position:fixed;top:0;left:0;bottom:0;width:360px;max-width:88vw;z-index:499;overflow-y:auto;background:#faf6f0;color:#24112b;'
  +   'transform:translateX(-100%);transition:transform .32s cubic-bezier(.4,0,.2,1);font-family:"DM Sans","Instrument Sans",sans-serif;'
  +   'box-shadow:18px 0 50px -20px rgba(26,8,32,.55);-webkit-font-smoothing:antialiased}'
  + '.acc-hd{position:sticky;top:0;z-index:2;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;color:#fff;'
  +   'padding:calc(22px + env(safe-area-inset-top)) 20px 22px;border-radius:0 0 26px 0;'
  +   'background:radial-gradient(120% 90% at 100% 0%,rgba(255,233,194,.18),transparent 60%),linear-gradient(160deg,#2b0a35 0%,#5a0b63 60%,#1a0820 100%)}'
  + '.acc-eb{font-size:10px;font-weight:700;letter-spacing:.26em;text-transform:uppercase;color:rgba(255,233,194,.75)}'
  + '.acc-t{font-family:"Cormorant Garamond",Georgia,serif;font-size:32px;font-weight:600;line-height:1;margin-top:6px}'
  + '.acc-t em{font-style:italic;color:#e8c98f;font-weight:500}'
  + '.acc-x{flex:none;width:38px;height:38px;border-radius:50%;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#fff;font-size:14px;cursor:pointer}'
  + '#acc-body{padding:18px 16px 30px}'
  + '.acc-sec{margin-bottom:20px}'
  + '.acc-h{display:flex;align-items:center;gap:10px;font-size:10px;font-weight:700;letter-spacing:.24em;text-transform:uppercase;color:#b08d57;margin:0 4px 10px}'
  + '.acc-h::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,#ece2d8,transparent)}'
  + '.acc-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}'
  + '.acc-card{position:relative;display:flex;flex-direction:column;align-items:flex-start;text-align:left;padding:14px 12px 13px;border-radius:18px;cursor:pointer;'
  +   'background:#fffdfa;border:1px solid #ece2d8;font-family:inherit;box-shadow:0 10px 24px -20px rgba(58,10,70,.35);transition:transform .12s,border-color .15s}'
  + '.acc-card:hover{border-color:#d9c3d9}.acc-card:active{transform:scale(.98)}'
  + '.acc-ico{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:17px;margin-bottom:10px;'
  +   'background:radial-gradient(circle at 50% 40%,#fff,#f6eedf);box-shadow:0 0 0 1px #ecdcbf}'
  + '.acc-ct{font-size:13px;font-weight:600;color:#24112b;line-height:1.25}'
  + '.acc-cs{font-size:10.5px;color:#8d7f90;margin-top:3px;line-height:1.35}'
  + '.acc-badge{display:none;position:absolute;top:10px;right:10px;min-width:20px;text-align:center;background:#a33a52;color:#fff;font-size:10px;font-weight:700;border-radius:999px;padding:2px 7px}'
  + '.acc-none{text-align:center;padding:30px;color:#8d7f90;font-size:12.5px}'
  + '#acc-tab{position:fixed;top:50%;left:0;transform:translateY(-50%);width:38px;height:84px;z-index:500;cursor:pointer;display:none;'
  +   'align-items:center;justify-content:center;border-radius:0 18px 18px 0;color:#e8c98f;'
  +   'background:linear-gradient(160deg,#3a0a46,#6e0977);box-shadow:0 0 0 1px rgba(217,184,122,.35) inset,6px 0 18px -6px rgba(58,10,70,.55);'
  +   'transition:left .32s cubic-bezier(.4,0,.2,1)}'
  + '#acc-tab svg{width:18px;height:18px}';

function buildCommandCenterUI() {
  if (!document.getElementById('acc-css')) {
    var st = document.createElement('style'); st.id = 'acc-css'; st.textContent = CC_CSS; document.head.appendChild(st);
  }
  var overlay = document.createElement('div');
  overlay.id = 'acc-overlay';
  overlay.onclick = function () { if (typeof closeAdminMenu === 'function') closeAdminMenu(); };
  overlay.style.display = 'none';
  document.body.appendChild(overlay);

  var sheet = document.createElement('div');
  sheet.id = 'acc-sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-label', 'Command Center');
  sheet.style.display = 'none';
  sheet.innerHTML =
      '<div class="acc-hd"><div><div class="acc-eb">Admin</div><div class="acc-t">Command <em>Center</em></div></div>'
    +   '<button type="button" class="acc-x" aria-label="Close" onclick="closeAdminMenu()">✕</button></div>'
    + '<div id="acc-body"></div>';
  document.body.appendChild(sheet);

  // Standalone, access-controlled tab — its `left` is synced in
  // ccSlideOpen/Closed so it always sits at the panel's edge.
  var tab = document.createElement('div');
  tab.id = 'acc-tab';
  tab.setAttribute('role', 'button');
  tab.setAttribute('aria-label', 'Command Center');
  tab.onclick = ccToggleSlide;
  tab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">'
    + '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>';
  document.body.appendChild(tab);
}

function renderCommandCenter() {
  if (!_ccAccessGranted) return;
  var body = document.getElementById('acc-body');
  if (!body) return;

  _ccCallbacks = []; // reset — each render rebuilds indices fresh, otherwise this grows forever and refs go stale

  var html = '';
  CC_CATEGORIES.forEach(function (cat) {
    var tools = (_ccTools[cat] || []).filter(function (t) { return !t.superAdminOnly || t._allowedSuper; });
    if (!tools.length) return;
    html += '<div class="acc-sec"><div class="acc-h">' + cat + '</div><div class="acc-grid">'
      + tools.map(function (t) { return ccToolCard(t); }).join('') + '</div></div>';
  });

  body.innerHTML = html || '<div class="acc-none">No tools available.</div>';
  ccSaveToolList();
}

function ccToolCard(t) {
  var bc = t.badgeId ? (_ccBadgeCounts[t.badgeId] || 0) : 0;
  var badgeHtml = t.badgeId ? '<span id="' + t.badgeId + '-cc" class="acc-badge"' + (bc > 0 ? ' style="display:inline-block"' : '') + '>' + bc + '</span>' : '';
  // icon/subtitle can be a plain string, or a function returning one —
  // the latter is for tools whose display changes based on live state
  // (e.g. the Store Open/Closed toggle), re-evaluated on every render.
  var icon = typeof t.icon === 'function' ? t.icon() : t.icon;
  var title = typeof t.title === 'function' ? t.title() : t.title;
  var subtitle = typeof t.subtitle === 'function' ? t.subtitle() : t.subtitle;
  return '<button type="button" class="acc-card" onclick="ccInvoke(this)" data-onclick-ref="' + ccRegisterCallback(t) + '">'
    + badgeHtml
    + '<span class="acc-ico">' + icon + '</span>'
    + '<span class="acc-ct">' + title + '</span>'
    + (subtitle ? '<span class="acc-cs">' + subtitle + '</span>' : '')
    + '</button>';
}

// Callback refs — since onClick is a real function, not a string, we
// store it in an array and reference by index in the onclick attribute.
var _ccCallbacks = [];
function ccRegisterCallback(tool) {
  _ccCallbacks.push(tool);
  return _ccCallbacks.length - 1;
}
function ccInvoke(el) {
  if (!_ccAccessGranted) return;
  var idx = parseInt(el.getAttribute('data-onclick-ref'));
  var tool = _ccCallbacks[idx];
  if (!tool || !tool.onClick) return;
  if (tool.keepOpen) {
    tool.onClick();
    renderCommandCenter(); // re-render immediately so toggled state shows right away
  } else {
    closeAdminMenu();
    tool.onClick();
  }
}

// Called by any registered tool's badge-refresh logic to update the
// count shown on its Command Center card (mirrors the old badge pattern).
// Last count per badge, so it survives the panel being redrawn.
var _ccBadgeCounts = {};
window.ccUpdateBadge = function (badgeId, count) {
  _ccBadgeCounts[badgeId] = count;
  var el = document.getElementById(badgeId + '-cc');
  if (!el) return;
  el.textContent = count;
  el.style.display = count > 0 ? 'inline-block' : 'none';
};