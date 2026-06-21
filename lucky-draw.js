// ═══════════════════════════════════════════════════════════
//  NSDI ChocoCravings — Lucky Draw Popup
//  File: lucky-draw.js
//
//  HOW TO USE:
//  1. Run the Supabase SQL (see bottom of this file)
//  2. Keep lucky-draw.html as a separate file in your project root
//  3. Add ONE line in index.html just before </body>:
//        <script src="/lucky-draw.js"></script>
//  4. Done — JS auto-fetches lucky-draw.html and injects it
//
//  DEPENDENCIES:
//  - Supabase JS SDK (already loaded in index.html as `db`)
//  - lucky-draw.html in your project root
// ═══════════════════════════════════════════════════════════

(function() {

  // ── STATE ──
  var _ldFav  = '';
  var _ldSrc  = '';
  var _ldStep = 1;
  var _ldSubmitting = false;

  // ── LOAD HTML + INIT ──
  async function loadAndInit() {
    try {

      // ── CHECK 1: Admin flag — is lucky draw active? ──
      var flagRes = await db.from('app_settings')
        .select('value')
        .eq('key', 'lucky_draw_active')
        .single();

      if (!flagRes.data || flagRes.data.value !== 'yes') {
        console.log('Lucky draw is disabled by admin');
        return;
      }

      // ── CHECK 2: Has this phone already entered? ──
      // Try to get phone from logged-in customer
      var phone = null;
      try {
        var session = await db.auth.getSession();
        var user = session.data && session.data.session ? session.data.session.user : null;
        if (user) {
          var cust = await db.from('customers')
            .select('phone')
            .eq('email', user.email)
            .maybeSingle();
          if (cust.data && cust.data.phone) phone = cust.data.phone;
        }
      } catch(e) {}

      if (phone) {
        var existing = await db.from('lucky_draw_entries')
          .select('id')
          .eq('phone', phone)
          .maybeSingle();
        if (existing.data) {
          console.log('Already entered lucky draw');
          localStorage.setItem('cc_lucky_draw_entered', 'yes'); // cache it
          return;
        }
      }

      // ── CHECK 3: Snoozed? (closed without submitting) ──
      try {
        var snoozed = localStorage.getItem('cc_lucky_draw_snoozed');
        if (snoozed && Date.now() < parseInt(snoozed)) {
          console.log('Lucky draw snoozed — will show again later');
          return;
        }
        // Snooze expired — clear it
        localStorage.removeItem('cc_lucky_draw_snoozed');
      } catch(e) {}

    } catch(e) {
      console.warn('Lucky draw check error:', e.message);
      return; // fail safe — don't show on error
    }
    try {
      // Fetch lucky-draw.html and inject into body
     // Load via dynamic script tag — works on file:// too
        var script = document.createElement('script');
        script.src = '/lucky-draw.html';

        // Use fetch with local fallback
        var baseUrl = window.location.origin === 'null' 
          ? window.location.href.replace('index.html','') 
          : window.location.origin;

        var res  = await fetch(baseUrl + '/lucky-draw.html');
        if (!res.ok) { console.warn('lucky-draw.html not found'); return; }
        var html = await res.text();
        var wrapper = document.createElement('div');
        wrapper.innerHTML = html;
        document.body.appendChild(wrapper);

      // Attach overlay close on background click
      var ov = document.getElementById('ld-overlay');
      if (ov) {
        ov.addEventListener('click', function(e) {
          if (e.target === ov) window.closeLuckyDraw();
        });
      }

      // Show popup after 2.5s
      setTimeout(window.openLuckyDraw, 2500);

    } catch(e) {
      console.warn('Lucky draw load error:', e.message);
    }
  }

  // ── OPEN ──
  window.openLuckyDraw = function() {
    var ov = document.getElementById('ld-overlay');
    if (!ov) return;
    ov.style.display = 'flex';
    _ldReset();
  };

window.closeLuckyDraw = function() {
  var ov = document.getElementById('ld-overlay');
  if (ov) ov.style.display = 'none';

  // Only suppress future shows if they actually submitted
  // If just closed — show again after 30 minutes
  if (!_ldSubmitting) {
    try {
      var snoozeUntil = Date.now() + (30 * 60 * 1000); // 30 mins
      localStorage.setItem('cc_lucky_draw_snoozed', snoozeUntil);
    } catch(e) {}
  }
};

  // ── RESET ──
  function _ldReset() {
    _ldFav  = '';
    _ldSrc  = '';
    _ldStep = 1;
    _ldSubmitting = false;

    ['ld-s1','ld-s2','ld-s3','ld-success'].forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
    var s1 = document.getElementById('ld-s1');
    if (s1) s1.style.display = 'block';

    var pips = document.getElementById('ld-pips');
    if (pips) pips.style.display = 'flex';

    _ldUpdatePips();

    document.querySelectorAll('.ld-fav').forEach(function(c) {
      c.style.background  = 'rgba(255,255,255,0.04)';
      c.style.borderColor = 'rgba(255,255,255,0.08)';
      var chk = c.querySelector('.ld-chk');
      if (chk) chk.style.display = 'none';
    });

    document.querySelectorAll('.ld-src').forEach(function(c) {
      c.style.background  = 'rgba(255,255,255,0.04)';
      c.style.borderColor = 'rgba(255,255,255,0.08)';
      var txt = c.querySelector('span:last-child');
      if (txt) txt.style.color = 'rgba(255,255,255,0.6)';
    });

    var nameInp  = document.getElementById('ld-name');
    var phoneInp = document.getElementById('ld-phone');
    if (nameInp)  nameInp.value  = '';
    if (phoneInp) phoneInp.value = '';

    ['ld-btn1','ld-btn2','ld-btn3'].forEach(function(id) {
      var btn = document.getElementById(id);
      if (btn) { btn.disabled = true; btn.style.opacity = '0.3'; }
    });
  }

  // ── PICK FAVOURITE ──
  window.ldPickFav = function(el, val) {
    document.querySelectorAll('.ld-fav').forEach(function(c) {
      c.style.background  = 'rgba(255,255,255,0.04)';
      c.style.borderColor = 'rgba(255,255,255,0.08)';
      var chk = c.querySelector('.ld-chk');
      if (chk) chk.style.display = 'none';
    });
    el.style.background  = 'rgba(201,150,43,0.1)';
    el.style.borderColor = 'rgba(201,150,43,0.6)';
    var chk = el.querySelector('.ld-chk');
    if (chk) chk.style.display = 'flex';
    _ldFav = val;
    var btn = document.getElementById('ld-btn1');
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
  };

  // ── PICK SOURCE ──
  window.ldPickSrc = function(el, val) {
    document.querySelectorAll('.ld-src').forEach(function(c) {
      c.style.background  = 'rgba(255,255,255,0.04)';
      c.style.borderColor = 'rgba(255,255,255,0.08)';
      var txt = c.querySelector('span:last-child');
      if (txt) txt.style.color = 'rgba(255,255,255,0.6)';
    });
    el.style.background  = 'rgba(201,150,43,0.1)';
    el.style.borderColor = 'rgba(201,150,43,0.5)';
    var txt = el.querySelector('span:last-child');
    if (txt) txt.style.color = 'rgba(201,150,43,0.9)';
    _ldSrc = val;
    var btn = document.getElementById('ld-btn3');
    if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
  };

  // ── CHECK STEP 2 INPUTS ──
  window.ldChk2 = function() {
    var n = (document.getElementById('ld-name')  || {}).value || '';
    var p = (document.getElementById('ld-phone') || {}).value || '';
    var valid = n.trim().length > 1 && p.replace(/\D/g,'').length === 10;
    var btn = document.getElementById('ld-btn2');
    if (btn) { btn.disabled = !valid; btn.style.opacity = valid ? '1' : '0.3'; }
  };

  // ── GO TO STEP ──
  window.ldGoTo = function(n) {
    var cur = document.getElementById('ld-s' + _ldStep);
    if (!cur) return;
    cur.style.opacity    = '0';
    cur.style.transform  = 'translateY(-8px)';
    cur.style.transition = 'all .22s';
    setTimeout(function() {
      cur.style.display   = 'none';
      cur.style.opacity   = '';
      cur.style.transform = '';
      _ldStep = n;
      var next = document.getElementById('ld-s' + _ldStep);
      if (next) {
        next.style.display    = 'block';
        next.style.opacity    = '0';
        next.style.transform  = 'translateY(10px)';
        next.style.transition = 'all .3s';
        requestAnimationFrame(function() {
          next.style.opacity   = '1';
          next.style.transform = 'translateY(0)';
        });
      }
      _ldUpdatePips();
    }, 220);
  };

  // ── UPDATE PIPS ──
  function _ldUpdatePips() {
    for (var i = 1; i <= 3; i++) {
      var pip = document.getElementById('ld-pip' + i);
      if (!pip) continue;
      if (i < _ldStep) {
        pip.style.background = 'rgba(201,150,43,0.9)';
        pip.style.width = '28px';
      } else if (i === _ldStep) {
        pip.style.background = 'rgba(201,150,43,0.55)';
        pip.style.width = '44px';
      } else {
        pip.style.background = 'rgba(255,255,255,0.1)';
        pip.style.width = '28px';
      }
    }
  }

  // ── GENERATE TICKET ──
  function _genTicket() {
    return 'CC-' + Math.floor(10000 + Math.random() * 90000);
  }

  // ── SUBMIT ──
  window.ldSubmit = async function() {
    if (_ldSubmitting) return;
    _ldSubmitting = true;

    var btn = document.getElementById('ld-btn3');
    if (btn) { btn.disabled = true; btn.textContent = 'Entering...'; btn.style.opacity = '0.7'; }

    var name   = (document.getElementById('ld-name')  || {}).value || '';
    var phone  = (document.getElementById('ld-phone') || {}).value || '';
    var ticket = _genTicket();

    name  = name.trim();
    phone = phone.replace(/\D/g,'');
    if (phone.length === 10) phone = '+91' + phone;

    // Save to Supabase
    try {
      var result = await db.from('lucky_draw_entries').insert([{
        name:          name,
        phone:         phone,
        favourite:     _ldFav,
        source:        _ldSrc || 'Unknown',
        ticket_number: ticket
      }]);
      if (result.error) console.warn('Lucky draw DB error:', result.error.message);
    } catch(e) {
      console.warn('Lucky draw error:', e.message);
    }

    // Mark as entered — never show again
    try {
      localStorage.setItem('cc_lucky_draw_entered', ticket);
      localStorage.setItem('cc_lucky_draw_name',    name);
    } catch(e) {}

    // Show success
    var s3   = document.getElementById('ld-s3');
    var pips = document.getElementById('ld-pips');
    var succ = document.getElementById('ld-success');

    if (s3)   s3.style.display   = 'none';
    if (pips) pips.style.display = 'none';

    var tn = document.getElementById('ld-ticket-num');
    var tt = document.getElementById('ld-ticket-name');
    var tf = document.getElementById('ld-ticket-fav');
    if (tn) tn.textContent = '#' + ticket;
    if (tt) tt.textContent = name;
    if (tf) tf.textContent = 'Favourite: ' + _ldFav;

    if (succ) {
      succ.style.display    = 'block';
      succ.style.opacity    = '0';
      succ.style.transform  = 'translateY(12px)';
      succ.style.transition = 'all .4s';
      requestAnimationFrame(function() {
        succ.style.opacity   = '1';
        succ.style.transform = 'translateY(0)';
      });
    }
  };

  // ── WHATSAPP SHARE ──
  window.ldShare = function() {
    var ticket = (document.getElementById('ld-ticket-num') || {}).textContent || '';
    var msg =
      '🍫 I just entered the NSDI ChocoCravings Launch Day Lucky Draw!\n\n' +
      'My favourite: ' + _ldFav + '\n' +
      'My ticket: ' + ticket + '\n\n' +
      'Join and win a sweet surprise on launch day! 🎁\n' +
      'https://chococravings.netlify.app';
    window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank');
  };

  // ── BOOT ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadAndInit);
  } else {
    loadAndInit();
  }

})();

