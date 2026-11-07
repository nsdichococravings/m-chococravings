/* Adds "NSDI Store" to the On Store Command Center (Daily Operations).
 * It only registers a tile; tapping it opens the separate NSDI Store admin page,
 * so nothing extra loads or runs inside On Store. */
(function () {
  function add() {
    if (typeof window.registerAdminTool !== 'function') return false;
    window.registerAdminTool('Daily Operations', {
      icon: '🛍️', iconBg: 'rgba(110,9,119,0.12)',
      title: 'NSDI Store', subtitle: 'Pickup orders · owner manages items',
      onClick: function () { window.location.href = 'grocery-admin.html'; }
    });
    return true;
  }
  if (!add()) document.addEventListener('DOMContentLoaded', add, { once: true });
})();
