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

// Called by other admin patch files instead of touching the FAB menu DOM
// directly. opts: { icon, title, subtitle, onClick, badgeId, superAdminOnly }
window.registerAdminTool = function (category, opts) {
  if (!_ccTools[category]) _ccTools[category] = [];
  _ccTools[category].push(opts);
  if (_ccOpen) renderCommandCenter(); // live-update if already open (e.g. late-registering tool)
};

function _ccInit() {
  buildCommandCenterUI();
  replaceFabMenuBehavior();
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
      pill.style.display = 'none'; // replaced entirely by the panel's own always-visible edge tab below

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
  document.getElementById('acc-overlay').style.display = 'block';
  document.getElementById('acc-sheet').style.transform = CC_OPEN_TRANSFORM;
  document.getElementById('acc-tab').style.left = '360px';
  _ccOpen = true;
  renderCommandCenter();
}
function ccSlideClosed() {
  document.getElementById('acc-overlay').style.display = 'none';
  document.getElementById('acc-sheet').style.transform = CC_CLOSED_TRANSFORM;
  document.getElementById('acc-tab').style.left = '0px';
  _ccOpen = false;
}
function ccToggleSlide() {
  if (_ccOpen) ccSlideClosed(); else ccSlideOpen();
}

function buildCommandCenterUI() {
  var overlay = document.createElement('div');
  overlay.id = 'acc-overlay';
  overlay.onclick = function () { if (typeof closeAdminMenu === 'function') closeAdminMenu(); };
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(12,8,16,0.55);'
    + 'z-index:498;backdrop-filter:blur(3px)';
  document.body.appendChild(overlay);

  var sheet = document.createElement('div');
  sheet.id = 'acc-sheet';
  sheet.style.cssText = 'position:fixed;top:0;left:0;bottom:0;width:360px;max-width:88vw;'
    + 'background:linear-gradient(165deg,#fffbf2,#fdf5e3);z-index:499;'
    + 'transform:translateX(-100%);transition:transform .32s cubic-bezier(.4,0,.2,1);'
    + 'font-family:\'Instrument Sans\',sans-serif;overflow-y:auto;box-shadow:12px 0 40px rgba(18,10,30,0.25)';
  sheet.innerHTML =
      '<div style="padding:22px 20px 10px;display:flex;align-items:flex-start;justify-content:space-between">'
    +   '<div>'
    +     '<div style="font-size:9px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:#c2607a">ADMIN</div>'
    +     '<div style="font-family:Fraunces,Georgia,serif;font-size:20px;font-weight:900;color:#1a0820;margin-top:2px">🍫 Command Center</div>'
    +   '</div>'
    +   '<div onclick="closeAdminMenu()" style="width:32px;height:32px;border-radius:50%;'
    +     'background:rgba(18,10,30,0.06);display:flex;align-items:center;justify-content:center;'
    +     'cursor:pointer;font-size:14px;color:#6e0977;flex-shrink:0">✕</div>'
    + '</div>'
    + '<div id="acc-body" style="padding:6px 20px 28px"></div>';
  document.body.appendChild(sheet);

  // Standalone, always-visible tab — replaces the old floating pill
  // entirely. Its own `left` position is synced (in ccSlideOpen/Closed)
  // to sit at the panel's edge whether open or closed, so it reads as
  // one attached handle even though it's a separate fixed element —
  // avoids clipping issues a truly-nested child would hit against the
  // panel's own overflow:auto scroll area.
  var tab = document.createElement('div');
  tab.id = 'acc-tab';
  tab.onclick = ccToggleSlide;
  tab.style.cssText = 'position:fixed;top:50%;left:0px;transform:translateY(-50%);'
    + 'width:40px;height:88px;background:linear-gradient(135deg,#6e0977,#9c0ca1);'
    + 'border-radius:0 16px 16px 0;z-index:500;cursor:pointer;'
    + 'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;'
    + 'box-shadow:4px 0 16px rgba(110,9,119,0.4);transition:left .32s cubic-bezier(.4,0,.2,1)';
  tab.innerHTML = '<span style="font-size:16px">⚙️</span>'
    + '<span style="writing-mode:vertical-rl;font-size:9px;font-weight:700;letter-spacing:1px;color:#fff">ADMIN</span>';
  document.body.appendChild(tab);
}

function renderCommandCenter() {
  var body = document.getElementById('acc-body');
  if (!body) return;

  _ccCallbacks = []; // reset — each render rebuilds indices fresh, otherwise this grows forever and refs go stale

  var html = '';
  CC_CATEGORIES.forEach(function (cat) {
    var tools = (_ccTools[cat] || []).filter(function (t) { return !t.superAdminOnly || t._allowedSuper; });
    if (!tools.length) return;

    html += '<div style="margin-bottom:18px">'
      + '<div style="font-size:10px;font-weight:700;letter-spacing:2px;color:#c2607a;margin-bottom:10px">' + cat.toUpperCase() + '</div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">'
      + tools.map(function (t) { return ccToolCard(t); }).join('')
      + '</div></div>';
  });

  body.innerHTML = html || '<div style="text-align:center;padding:30px;color:#9a8aaa;font-size:12px">No tools available.</div>';
}

function ccToolCard(t) {
  var badgeHtml = t.badgeId
    ? '<span id="' + t.badgeId + '-cc" style="display:none;background:#dc2626;color:#fff;font-size:9px;'
      + 'font-weight:700;border-radius:20px;padding:2px 7px;position:absolute;top:10px;right:10px">0</span>'
    : '';
  // icon/subtitle can be a plain string, or a function returning one —
  // the latter is for tools whose display changes based on live state
  // (e.g. the Store Open/Closed toggle), re-evaluated on every render.
  var icon = typeof t.icon === 'function' ? t.icon() : t.icon;
  var title = typeof t.title === 'function' ? t.title() : t.title;
  var subtitle = typeof t.subtitle === 'function' ? t.subtitle() : t.subtitle;
  var iconBg = typeof t.iconBg === 'function' ? t.iconBg() : (t.iconBg || 'rgba(110,9,119,0.1)');
  return '<div onclick="ccInvoke(this)" data-onclick-ref="' + ccRegisterCallback(t) + '" style="position:relative;'
    + 'background:#fff;border:1.5px solid #f0e0f5;border-radius:16px;padding:14px 12px;cursor:pointer">'
    + badgeHtml
    + '<div style="width:36px;height:36px;border-radius:10px;background:' + iconBg + ';'
    + 'display:flex;align-items:center;justify-content:center;font-size:18px;margin-bottom:8px">' + icon + '</div>'
    + '<div style="font-size:12.5px;font-weight:700;color:#1a0820;line-height:1.3">' + title + '</div>'
    + '<div style="font-size:10.5px;color:#9a8aaa;margin-top:2px;line-height:1.3">' + subtitle + '</div>'
    + '</div>';
}

// Callback refs — since onClick is a real function, not a string, we
// store it in an array and reference by index in the onclick attribute.
var _ccCallbacks = [];
function ccRegisterCallback(tool) {
  _ccCallbacks.push(tool);
  return _ccCallbacks.length - 1;
}
function ccInvoke(el) {
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
window.ccUpdateBadge = function (badgeId, count) {
  var el = document.getElementById(badgeId + '-cc');
  if (!el) return;
  el.textContent = count;
  el.style.display = count > 0 ? 'inline-block' : 'none';
};