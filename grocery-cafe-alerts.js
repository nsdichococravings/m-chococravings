/* NSDI Cafe (store.html), staff only: NSDI Store orders waiting to be packed.
 * Loaded by checkadminbadge-override.js after grocery-alerts.js, only for
 * admins and employees. Shows a pill with the count (tap → Manage NSDI Store
 * → Orders) and the same count on the Command Center's NSDI Store tile. */
(function () {
  if (!window.GroceryAlerts || typeof db === 'undefined' || !db || document.getElementById('cafe-ns-pill')) return;
  var pill = document.createElement('a');
  pill.id = 'cafe-ns-pill';
  pill.href = 'grocery-admin.html#orders';
  pill.style.cssText = 'display:none;position:fixed;right:14px;bottom:calc(96px + env(safe-area-inset-bottom,0px));z-index:450;'
    + 'align-items:center;gap:8px;padding:9px 14px 9px 9px;border-radius:999px;text-decoration:none;color:#fff;'
    + 'background:linear-gradient(135deg,#2b0a35,#5a0b63);box-shadow:0 0 0 1px rgba(217,184,122,.45) inset,0 14px 30px -12px rgba(26,8,32,.7);'
    + 'font:600 12.5px "DM Sans",system-ui,sans-serif';
  pill.innerHTML = '<span id="cafe-ns-n" style="min-width:26px;height:26px;padding:0 6px;border-radius:999px;display:flex;align-items:center;justify-content:center;'
    + 'background:radial-gradient(circle at 30% 25%,#ffe9c2,#d9b87a);color:#3a0a46;font:700 14px \'Cormorant Garamond\',Georgia,serif">0</span>'
    + '<span>NSDI Store · to pack</span>';
  document.body.appendChild(pill);
  window.GroceryAlerts.start(db, { onCount: function (n) {
    pill.style.display = n > 0 ? 'flex' : 'none';
    document.getElementById('cafe-ns-n').textContent = n > 99 ? '99+' : n;
    if (typeof window.ccUpdateBadge === 'function') window.ccUpdateBadge('grocery-orders', n);
  } });
})();
