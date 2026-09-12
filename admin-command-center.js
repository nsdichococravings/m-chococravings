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
      // Override the existing toggle functions so the pill now opens
      // the Command Center instead of the old flat dropdown.
      window.openAdminMenu = function () {
        document.getElementById('cc-sheet-overlay').style.display = 'block';
        document.getElementById('cc-sheet').style.display = 'block';
        _ccOpen = true;
        renderCommandCenter();
      };
      window.closeAdminMenu = function () {
        document.getElementById('cc-sheet-overlay').style.display = 'none';
        document.getElementById('cc-sheet').style.display = 'none';
        _ccOpen = false;
      };
    } else if (attempts >= 20) {
      clearInterval(poll);
    }
  }, 300);
}

function buildCommandCenterUI() {
  var overlay = document.createElement('div');
  overlay.id = 'cc-sheet-overlay';
  overlay.onclick = function () { if (typeof closeAdminMenu === 'function') closeAdminMenu(); };
  overlay.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,0.55);'
    + 'z-index:498;backdrop-filter:blur(3px)';
  document.body.appendChild(overlay);

  var sheet = document.createElement('div');
  sheet.id = 'cc-sheet';
  sheet.style.cssText = 'display:none;position:fixed;bottom:0;left:0;right:0;background:#fdf5e3;'
    + 'border-radius:24px 24px 0 0;z-index:499;padding:0 0 28px;'
    + 'font-family:\'Instrument Sans\',sans-serif;max-height:82vh;overflow-y:auto;'
    + 'box-shadow:0 -8px 32px rgba(0,0,0,0.2)';
  sheet.innerHTML =
      '<div style="width:40px;height:4px;border-radius:2px;background:#ddd0ea;margin:14px auto 0"></div>'
    + '<div style="padding:16px 20px 10px;display:flex;align-items:center;justify-content:space-between">'
    +   '<div>'
    +     '<div style="font-size:9px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:#9c0ca1">ADMIN</div>'
    +     '<div style="font-family:Fraunces,Georgia,serif;font-size:20px;font-weight:900;color:#1a0820;margin-top:2px">🍫 Command Center</div>'
    +   '</div>'
    +   '<div onclick="closeAdminMenu()" style="width:34px;height:34px;border-radius:50%;'
    +     'background:#fff;border:1px solid #e0c8f0;display:flex;align-items:center;'
    +     'justify-content:center;cursor:pointer;font-size:14px;color:#6e0977">✕</div>'
    + '</div>'
    + '<div id="cc-body" style="padding:6px 20px 0"></div>';
  document.body.appendChild(sheet);
}

function renderCommandCenter() {
  var body = document.getElementById('cc-body');
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
  var subtitle = typeof t.subtitle === 'function' ? t.subtitle() : t.subtitle;
  var iconBg = typeof t.iconBg === 'function' ? t.iconBg() : (t.iconBg || 'rgba(110,9,119,0.1)');
  return '<div onclick="ccInvoke(this)" data-onclick-ref="' + ccRegisterCallback(t) + '" style="position:relative;'
    + 'background:#fff;border:1.5px solid #f0e0f5;border-radius:16px;padding:14px 12px;cursor:pointer">'
    + badgeHtml
    + '<div style="width:36px;height:36px;border-radius:10px;background:' + iconBg + ';'
    + 'display:flex;align-items:center;justify-content:center;font-size:18px;margin-bottom:8px">' + icon + '</div>'
    + '<div style="font-size:12.5px;font-weight:700;color:#1a0820;line-height:1.3">' + t.title + '</div>'
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
