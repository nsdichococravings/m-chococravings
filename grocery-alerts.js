/* NSDI Store new-order alerts for staff screens (Manage NSDI Store, NSDI Cafe, the app's Staff tab).
 *
 *   GroceryAlerts.start(db, { onCount: function (n) {...} })
 *
 * Asks grocery_staff_alert_state() (migrations/20261114) every 30 s while the
 * screen is on. It returns how many orders are waiting to be packed and the
 * newest one. When a newer order appears: a chime, a short banner, and the
 * 'grocery:new-order' event. The count goes to onCount() and, where the phone
 * supports it, onto the app icon. Customers get "no access" on the first call
 * and nothing else runs. Push notifications for a closed app come from the
 * database (grocery_orders_staff_alert) and the service worker. */
(function () {
  if (window.GroceryAlerts) return;
  var SEEN_KEY = 'cc_grocery_seen_order';
  var POLL_MS = 30000;
  var state = { db: null, timer: null, stopped: false, count: null, listeners: [], busy: false };

  // ── Sound: a soft two-note chime, made in the browser (no file to load) ──
  var audio = null;
  function unlockAudio() {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      if (!audio) audio = new AC();
      if (audio.state === 'suspended') audio.resume();
    } catch (e) {}
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (ev) { document.addEventListener(ev, unlockAudio, { passive: true }); });
  function chime() {
    try {
      unlockAudio();
      if (!audio) return;
      var t = audio.currentTime;
      [[880, 0], [1318.5, 0.18], [880, 0.6], [1318.5, 0.78]].forEach(function (n) {
        var o = audio.createOscillator(), g = audio.createGain();
        o.type = 'sine'; o.frequency.value = n[0];
        g.gain.setValueAtTime(0.0001, t + n[1]);
        g.gain.exponentialRampToValueAtTime(0.35, t + n[1] + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + n[1] + 0.5);
        o.connect(g); g.connect(audio.destination);
        o.start(t + n[1]); o.stop(t + n[1] + 0.55);
      });
    } catch (e) {}
    try { if (navigator.vibrate) navigator.vibrate([200, 80, 200]); } catch (e) {}
  }

  // ── Banner ──
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function banner(latest, count) {
    var old = document.getElementById('galert-banner'); if (old) old.remove();
    var b = document.createElement('a');
    b.id = 'galert-banner'; b.href = '/grocery-admin.html#orders'; b.setAttribute('role', 'alert');
    b.style.cssText = 'position:fixed;left:50%;top:calc(12px + env(safe-area-inset-top,0px));transform:translateX(-50%);z-index:100000;'
      + 'display:flex;align-items:center;gap:12px;max-width:min(92vw,420px);padding:12px 16px 12px 12px;border-radius:999px;text-decoration:none;'
      + 'background:linear-gradient(135deg,#2b0a35,#5a0b63);color:#fff;box-shadow:0 0 0 1px rgba(217,184,122,.45) inset,0 18px 40px -14px rgba(26,8,32,.7);'
      + 'font:600 13px "DM Sans",system-ui,sans-serif;animation:galertIn .35s cubic-bezier(.16,1,.3,1)';
    b.innerHTML = '<span style="flex:none;width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;'
      + 'background:radial-gradient(circle at 30% 25%,#ffe9c2,#d9b87a);color:#3a0a46;font:700 15px \'Cormorant Garamond\',Georgia,serif">' + count + '</span>'
      + '<span style="min-width:0"><span style="display:block;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#e8c98f">New NSDI Store order</span>'
      + '<span style="display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(latest.order_no) + ' · ₹' + esc(latest.total) + ' · ' + count + ' to pack</span></span>';
    if (!document.getElementById('galert-css')) {
      var st = document.createElement('style'); st.id = 'galert-css';
      st.textContent = '@keyframes galertIn{from{opacity:0;transform:translate(-50%,-14px)}to{opacity:1;transform:translate(-50%,0)}}';
      document.head.appendChild(st);
    }
    document.body.appendChild(b);
    setTimeout(function () { if (b.parentNode) b.remove(); }, 9000);
  }

  function setBadge(n) {
    try {
      if ('setAppBadge' in navigator) { n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge(); }
    } catch (e) {}
  }

  function seen() { try { return JSON.parse(localStorage.getItem(SEEN_KEY)) || null; } catch (e) { return null; } }
  function markSeen(latest) { try { localStorage.setItem(SEEN_KEY, JSON.stringify({ id: latest.id, at: latest.at })); } catch (e) {} }

  async function check() {
    if (state.stopped || state.busy || !state.db || document.hidden) return;
    state.busy = true;
    try {
      var res = await state.db.rpc('grocery_staff_alert_state');
      if (res.error) {
        // Not staff, or the database update isn't installed: stop quietly.
        if (res.error.code) stop();
        return;
      }
      var d = res.data || {}, n = Number(d.to_pack) || 0, latest = d.latest;
      var first = state.count === null;
      state.count = n;
      setBadge(n);
      state.listeners.forEach(function (fn) { try { fn(n); } catch (e) {} });
      if (latest) {
        var s = seen();
        var isNew = !s || (s.id !== latest.id && new Date(latest.at) > new Date(s.at));
        // On the first check after opening, only alert for orders from the last 10 minutes.
        if (isNew && (!first || Date.now() - new Date(latest.at).getTime() < 600000)) {
          chime(); banner(latest, n);
          try { window.dispatchEvent(new CustomEvent('grocery:new-order', { detail: latest })); } catch (e) {}
        }
        if (isNew) markSeen(latest);
      }
    } catch (e) {
      // Offline: try again next time.
    } finally {
      state.busy = false;
    }
  }

  function stop() {
    state.stopped = true;
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
    state.listeners.forEach(function (fn) { try { fn(0); } catch (e) {} });
  }

  function start(db, opts) {
    opts = opts || {};
    if (opts.onCount) {
      state.listeners.push(opts.onCount);
      if (state.count !== null) opts.onCount(state.count);
    }
    if (state.db) return; // already running
    state.db = db;
    check();
    state.timer = setInterval(check, POLL_MS);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) check(); });
    window.addEventListener('online', check);
  }

  window.GroceryAlerts = { start: start, check: check, stop: stop, chime: chime };
})();
