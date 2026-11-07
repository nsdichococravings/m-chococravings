/**
 * festive-theme.js — On Store (store.html) and Home (index.html) dress up
 * for festivals and special days.
 *
 * Home keeps its light page (for readable text) and gets: the garland under
 * the logo bar, a soft festive glow at the top, a greeting banner
 * ("Happy Diwali, <name> 🪔") under the greeting, and the floating
 * particles while Home is open. Everything below is On Store.
 *
 * What changes while a theme is on:
 *   - the page background (colours + soft glow) behind the menu,
 *   - a garland across the header (marigolds, mango leaves, lights, bunting…),
 *   - the header tagline becomes the greeting ("Happy Diwali 🪔"),
 *   - a few gentle floating sparkles / snow / hearts / petals,
 *   - Diwali also gets a row of glowing diyas at the bottom.
 * The Kitchen screen is never themed. Motion stops for "reduce motion" users.
 *
 * Which theme: app_settings.festive_theme
 *   'auto' (default) -> by date, from CALENDAR below (India time),
 *   'off'            -> never,
 *   a theme id       -> that theme now (e.g. 'holi' on Holi, any day).
 * Admins change it in Command Center -> Festive Theme
 * (cc_set_festive_theme, migrations/20261111_festive_theme.sql).
 */
(function () {
  // ── Themes ──────────────────────────────────────────────────────
  // bg: page background. garland: header strip style. fx: floating
  // particle style. ink: tagline colour on the light header.
  var THEMES = {
    diwali: {
      name: 'Diwali', icon: '🪔', greet: 'Happy Diwali 🪔',
      bg: 'radial-gradient(90% 50% at 50% 0%,rgba(246,196,83,.35),transparent 70%),radial-gradient(60% 40% at 0% 100%,rgba(224,155,45,.28),transparent 70%),linear-gradient(170deg,#4a0a22 0%,#5b0b2c 40%,#2a0512 100%)',
      dark: true, garland: 'marigold', fx: 'sparkle', ink: '#a3194d', diyas: true
    },
    christmas: {
      name: 'Christmas', icon: '🎄', greet: 'Merry Christmas 🎄',
      bg: 'radial-gradient(80% 50% at 50% 0%,rgba(255,255,255,.18),transparent 70%),linear-gradient(170deg,#0f3d2e 0%,#145a41 50%,#0b2a20 100%)',
      dark: true, garland: 'lights', fx: 'snow', ink: '#b91c1c'
    },
    newyear: {
      name: 'New Year', icon: '🎆', greet: 'Happy New Year ✨',
      bg: 'radial-gradient(80% 50% at 50% 0%,rgba(246,196,83,.25),transparent 70%),linear-gradient(170deg,#0d1030 0%,#1b1f5c 55%,#0a0b22 100%)',
      dark: true, garland: 'lights', fx: 'confetti', ink: '#4338ca'
    },
    pongal: {
      name: 'Pongal', icon: '🌾', greet: 'Happy Pongal 🌾',
      bg: 'radial-gradient(80% 50% at 50% 0%,rgba(255,214,102,.55),transparent 70%),linear-gradient(170deg,#fff3c4 0%,#ffe08a 45%,#f2c14e 100%)',
      garland: 'mango', fx: 'petal', ink: '#9a5b00'
    },
    tamilnewyear: {
      name: 'Tamil New Year', icon: '🌸', greet: 'Puthandu Vazhthukal 🌸',
      bg: 'radial-gradient(80% 50% at 50% 0%,rgba(255,183,77,.45),transparent 70%),linear-gradient(170deg,#fff1dc 0%,#ffd8a8 55%,#ffbf7a 100%)',
      garland: 'mango', fx: 'petal', ink: '#b45309'
    },
    valentine: {
      name: "Valentine's Day", icon: '💗', greet: "Happy Valentine's Day 💗",
      bg: 'radial-gradient(80% 50% at 50% 0%,rgba(255,255,255,.45),transparent 70%),linear-gradient(170deg,#ffe0ea 0%,#ffc2d6 50%,#ff9fbf 100%)',
      garland: 'hearts', fx: 'heart', ink: '#be185d'
    },
    independence: {
      name: 'Independence Day', icon: '🇮🇳', greet: 'Happy Independence Day 🇮🇳',
      bg: 'linear-gradient(180deg,#ffe2c2 0%,#fff8ef 45%,#fff8ef 55%,#d9f2df 100%)',
      garland: 'tricolour', fx: 'tricolour', ink: '#c2410c'
    },
    republic: {
      name: 'Republic Day', icon: '🇮🇳', greet: 'Happy Republic Day 🇮🇳',
      bg: 'linear-gradient(180deg,#ffe2c2 0%,#fff8ef 45%,#fff8ef 55%,#d9f2df 100%)',
      garland: 'tricolour', fx: 'tricolour', ink: '#15803d'
    },
    holi: {
      name: 'Holi', icon: '🎨', greet: 'Happy Holi 🎨',
      bg: 'radial-gradient(40% 30% at 10% 10%,rgba(236,72,153,.35),transparent 70%),radial-gradient(40% 30% at 90% 25%,rgba(59,130,246,.3),transparent 70%),radial-gradient(45% 30% at 20% 85%,rgba(34,197,94,.3),transparent 70%),radial-gradient(40% 30% at 85% 80%,rgba(250,204,21,.4),transparent 70%),#fff7fb',
      garland: 'bunting', fx: 'colour', ink: '#c026d3'
    },
    ganesh: {
      name: 'Ganesh Chaturthi', icon: '🙏', greet: 'Happy Ganesh Chaturthi 🙏',
      bg: 'radial-gradient(80% 50% at 50% 0%,rgba(255,183,77,.5),transparent 70%),linear-gradient(170deg,#fff0d6 0%,#ffcf8a 55%,#f59e0b 100%)',
      garland: 'marigold', fx: 'petal', ink: '#c2410c'
    },
    navratri: {
      name: 'Navratri / Ayudha Pooja', icon: '🪷', greet: 'Happy Navratri 🪷',
      bg: 'radial-gradient(80% 50% at 50% 0%,rgba(244,114,182,.35),transparent 70%),linear-gradient(170deg,#fdf2ff 0%,#f5d0fe 55%,#e9a8f5 100%)',
      garland: 'marigold', fx: 'petal', ink: '#a21caf'
    }
  };

  // ── Calendar for 'auto' (India time, inclusive) ─────────────────
  // Fixed-date days repeat every year (MM-DD). Festivals that move with
  // the moon have exact dates; add next year's when known. Holi, Ganesh
  // Chaturthi and Navratri can be switched on by an admin any day.
  var CALENDAR = [
    { id: 'newyear', from: '12-31', to: '01-02' },
    { id: 'pongal', from: '01-13', to: '01-17' },
    { id: 'republic', from: '01-25', to: '01-26' },
    { id: 'valentine', from: '02-12', to: '02-14' },
    { id: 'tamilnewyear', from: '04-13', to: '04-15' },
    { id: 'independence', from: '08-14', to: '08-15' },
    { id: 'christmas', from: '12-20', to: '12-30' },
    { id: 'diwali', from: '2026-11-01', to: '2026-11-12' }, // Diwali 8 Nov 2026
    { id: 'diwali', from: '2027-10-23', to: '2027-11-02' }  // Diwali 29 Oct 2027 — check closer to the date
  ];

  function istToday() {
    var d = new Date(Date.now() + 5.5 * 3600e3);
    return d.toISOString().slice(0, 10); // YYYY-MM-DD in India time
  }
  function autoTheme(today) {
    today = today || istToday();
    var md = today.slice(5);
    for (var i = 0; i < CALENDAR.length; i++) {
      var c = CALENDAR[i];
      if (c.from.length === 10) { if (today >= c.from && today <= c.to) return c.id; continue; }
      if (c.from <= c.to ? (md >= c.from && md <= c.to) : (md >= c.from || md <= c.to)) return c.id;
    }
    return null;
  }

  // ── Drawing ─────────────────────────────────────────────────────
  function garlandSvg(kind) {
    var w = 400, h = 26, out = '', i;
    if (kind === 'marigold' || kind === 'mango') {
      out += '<path d="M0 4 Q100 16 200 4 T400 4" fill="none" stroke="#7a4a12" stroke-width="1.2"/>';
      for (i = 0; i < 20; i++) {
        var x = 10 + i * 20, y = 4 + 6 * Math.sin((x / 400) * Math.PI * 2 + Math.PI / 2) * -1 + 6;
        if (kind === 'marigold') {
          var c = i % 2 ? '#f59e0b' : '#f97316';
          out += '<circle cx="' + x + '" cy="' + y + '" r="5" fill="' + c + '"/><circle cx="' + x + '" cy="' + y + '" r="2" fill="#fde68a"/>';
          if (i % 3 === 0) out += '<path d="M' + x + ' ' + (y + 5) + 'v6" stroke="#f97316" stroke-width="2"/><circle cx="' + x + '" cy="' + (y + 13) + '" r="3" fill="#f59e0b"/>';
        } else {
          out += '<path d="M' + x + ' ' + y + 'c-4 5-3 11 0 15c3-4 4-10 0-15z" fill="' + (i % 2 ? '#15803d' : '#16a34a') + '"/>';
          if (i % 4 === 2) out += '<circle cx="' + x + '" cy="' + (y + 1) + '" r="3" fill="#f97316"/>';
        }
      }
    } else if (kind === 'lights') {
      out += '<path d="M0 4 Q50 14 100 4 T200 4 T300 4 T400 4" fill="none" stroke="#1f2937" stroke-width="1"/>';
      var cols = ['#f43f5e', '#facc15', '#22c55e', '#38bdf8', '#a855f7'];
      for (i = 0; i < 20; i++) {
        var lx = 10 + i * 20, ly = 4 + 5 * Math.abs(Math.sin((lx / 100) * Math.PI));
        out += '<rect x="' + (lx - 2) + '" y="' + ly + '" width="4" height="3" fill="#374151"/>'
          + '<ellipse class="ft-bulb" style="animation-delay:' + (i % 5) * .3 + 's" cx="' + lx + '" cy="' + (ly + 8) + '" rx="3.5" ry="5" fill="' + cols[i % 5] + '"/>';
      }
    } else if (kind === 'tricolour') {
      for (i = 0; i < 20; i++) {
        var tx = i * 20, col = ['#ff9933', '#ffffff', '#138808'][i % 3];
        out += '<path d="M' + tx + ' 2h20l-10 16z" fill="' + col + '" stroke="rgba(0,0,0,.12)" stroke-width=".6"/>';
      }
      out += '<path d="M0 2H400" stroke="#1e3a8a" stroke-width="1.2"/>';
    } else if (kind === 'bunting' || kind === 'hearts') {
      var bc = kind === 'hearts' ? ['#f43f5e', '#fb7185', '#ec4899'] : ['#ec4899', '#3b82f6', '#22c55e', '#facc15', '#a855f7'];
      out += '<path d="M0 3 Q100 10 200 3 T400 3" fill="none" stroke="#6b7280" stroke-width="1"/>';
      for (i = 0; i < 20; i++) {
        var bx = 10 + i * 20, by = 3 + 3 * Math.abs(Math.sin((bx / 200) * Math.PI));
        out += kind === 'hearts'
          ? '<path transform="translate(' + bx + ' ' + (by + 7) + ') scale(.55)" d="M0 6C-8-2-12 4-6 9L0 14L6 9C12 4 8-2 0 6Z" fill="' + bc[i % 3] + '"/>'
          : '<path d="M' + (bx - 7) + ' ' + by + 'h14l-7 13z" fill="' + bc[i % 5] + '"/>';
      }
    }
    return '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true">' + out + '</svg>';
  }

  function particle(kind, i) {
    var colours = { sparkle: ['#ffe08a', '#fff4cf', '#f6c453'], snow: ['#ffffff'], confetti: ['#facc15', '#f43f5e', '#38bdf8', '#a855f7', '#22c55e'],
      petal: ['#f97316', '#f59e0b', '#fb7185'], heart: ['#f43f5e', '#ec4899', '#fb7185'], colour: ['#ec4899', '#3b82f6', '#22c55e', '#facc15', '#a855f7'],
      tricolour: ['#ff9933', '#ffffff', '#138808'] }[kind] || ['#fff'];
    var c = colours[i % colours.length];
    var shape = {
      sparkle: '<path d="M0-7L1.6-1.6 7 0 1.6 1.6 0 7-1.6 1.6-7 0-1.6-1.6Z" fill="' + c + '"/>',
      snow: '<circle r="3.2" fill="' + c + '" fill-opacity=".9"/>',
      confetti: '<rect x="-2.5" y="-5" width="5" height="10" rx="1" fill="' + c + '"/>',
      petal: '<path d="M0-6C5-3 5 3 0 6C-5 3-5-3 0-6Z" fill="' + c + '"/>',
      heart: '<path d="M0 3C-6-3-9 2-4.5 5.5L0 9 4.5 5.5C9 2 6-3 0 3Z" fill="' + c + '"/>',
      colour: '<circle r="4.5" fill="' + c + '" fill-opacity=".75"/>',
      tricolour: '<rect x="-3" y="-3" width="6" height="6" rx="1.5" fill="' + c + '" stroke="rgba(0,0,0,.15)" stroke-width=".5"/>'
    }[kind];
    var left = (i * 37 + 7) % 100, dur = 9 + (i * 7) % 8, delay = -((i * 13) % 17), size = .8 + ((i * 5) % 6) / 10;
    return '<span class="ft-p" style="left:' + left + '%;animation-duration:' + dur + 's;animation-delay:' + delay + 's">'
      + '<svg width="' + 20 * size + '" height="' + 20 * size + '" viewBox="-10 -10 20 20">' + shape + '</svg></span>';
  }

  function diyaRow() {
    var out = '';
    for (var i = 0; i < 7; i++) {
      out += '<div class="ft-diya" style="animation-delay:' + (i * .35) + 's"><svg viewBox="-24 -32 48 40" aria-hidden="true">'
        + '<circle cx="0" cy="-12" r="18" fill="url(#ftGlow)"/>'
        + '<path class="ft-flame" d="M0-26C6-17 6-9 0-4C-6-9-6-17 0-26Z" fill="#ffd36b"/>'
        + '<path class="ft-flame" d="M0-19C3-14 3-9 0-6C-3-9-3-14 0-19Z" fill="#fff4cf"/>'
        + '<path d="M-20 0Q0 20 20 0Z" fill="#e09b2d"/><path d="M-20 0Q0 12 20 0" fill="none" stroke="#ffe08a" stroke-width="1.5"/></svg></div>';
    }
    return '<svg width="0" height="0" style="position:absolute"><defs><radialGradient id="ftGlow"><stop offset="0" stop-color="#ffd36b" stop-opacity=".5"/><stop offset="1" stop-color="#ffd36b" stop-opacity="0"/></radialGradient></defs></svg>'
      + '<div class="ft-diyas">' + out + '</div>';
  }

  var PAGE = document.getElementById('pg-menu') ? 'store' : (document.getElementById('page-home') ? 'home' : null);

  var STORE_CSS = ''
    + 'body.ft-on{background:var(--ft-bg)!important}'
    + 'body.ft-on .page:not(#pg-kitchen){background:transparent!important}'
    + 'body.ft-on .sec-lbl{background:rgba(255,251,242,.92);backdrop-filter:blur(6px);border-radius:0 0 14px 14px;margin:0 10px}'
    + '#ft-bg{position:fixed;inset:0;z-index:0;background:var(--ft-bg);pointer-events:none}';
  var HOME_CSS = ''
    + 'body:has(#page-home:not(.active)) #ft-fx{display:none}'
    + '.ft-band{position:absolute;top:0;left:0;right:0;height:360px;z-index:-1;pointer-events:none;background:var(--ft-bg);opacity:.3;'
    +   '-webkit-mask-image:linear-gradient(#000,#000 35%,transparent);mask-image:linear-gradient(#000,#000 35%,transparent)}'
    + '.ft-hg{position:absolute;left:0;right:0;bottom:-17px;height:17px;pointer-events:none}.ft-hg svg{display:block;width:100%;height:100%}'
    + 'body.ft-home #page-home .greet{padding-top:22px}'
    + '.ft-banner{position:relative;margin:2px 16px 14px;padding:12px 16px;border-radius:18px;overflow:hidden;display:flex;align-items:center;gap:12px;'
    +   'background:var(--ft-bg);box-shadow:0 8px 22px rgba(0,0,0,.12)}'
    + '.ft-banner.dark{color:#fff7e6}.ft-banner.light{color:#2a1530;border:1px solid rgba(0,0,0,.06)}'
    + '.ft-banner-t{font-family:"Cormorant Garamond",Fraunces,Georgia,serif;font-size:20px;font-weight:700;line-height:1.1}'
    + '.ft-banner.dark .ft-banner-t{color:#ffe08a}.ft-banner.light .ft-banner-t{color:var(--ft-ink)}'
    + '.ft-banner-s{font-size:11.5px;opacity:.75;margin-top:3px}'
    + '.ft-banner-i{flex:none;font-size:30px;margin-left:auto;animation:ftShimmer 3s ease-in-out infinite}';
  var CSS = ''
    + '#ft-fx{position:fixed;inset:0;z-index:250;pointer-events:none;overflow:hidden}'
    + 'body:has(#pg-kitchen.active) #ft-fx,body:has(#pg-kitchen.active) #ft-bg{display:none}'
    + '.ft-garland{display:block;height:22px;margin:0 -20px -1px;pointer-events:none}'
    + '.ft-garland svg{display:block;width:100%;height:100%}'
    + '.ft-greet{font-family:Fraunces,Georgia,serif;font-style:italic;font-weight:700;font-size:13px;letter-spacing:.3px;color:var(--ft-ink)!important;'
    +   'animation:ftShimmer 4s ease-in-out infinite;white-space:nowrap}'
    + '@keyframes ftShimmer{0%,100%{opacity:1}50%{opacity:.65}}'
    + '.ft-p{position:absolute;top:-24px;opacity:.85;animation-name:ftFall;animation-timing-function:linear;animation-iteration-count:infinite}'
    + '@keyframes ftFall{0%{transform:translate3d(0,-5vh,0) rotate(0)}50%{transform:translate3d(18px,50vh,0) rotate(180deg)}100%{transform:translate3d(-12px,108vh,0) rotate(360deg)}}'
    + '.ft-bulb{animation:ftBlink 1.5s ease-in-out infinite}@keyframes ftBlink{0%,100%{opacity:1}50%{opacity:.35}}'
    + '.ft-diyas{position:fixed;left:0;right:0;bottom:0;height:46px;display:flex;justify-content:space-around;align-items:flex-end;padding:0 4px 4px;'
    +   'background:linear-gradient(to top,rgba(42,5,18,.55),transparent)}'
    + '.ft-diya{width:40px;height:34px}.ft-diya svg{width:100%;height:100%;overflow:visible}'
    + '.ft-flame{transform-box:fill-box;transform-origin:50% 100%;animation:ftFlicker 1.6s ease-in-out infinite}'
    + '@keyframes ftFlicker{0%,100%{transform:scaleY(1)}50%{transform:scaleY(.82) translateY(1px)}}'
    + 'body:has(#cart-bar:not(.hidden)) .ft-diyas{display:none}'
    // Hints and messages that sit straight on the background get a frosted pill.
    + 'body.ft-on #cart-empty{width:max-content;max-width:90vw;margin:0 auto;padding:7px 14px;border-radius:999px;background:rgba(255,251,242,.9);backdrop-filter:blur(6px);color:#6b5a70}'
    + 'body.ft-diya #cart-empty{bottom:calc(54px + env(safe-area-inset-bottom,0px))}'
    + 'body.ft-on #items-list>:not(.mcard){grid-column:1/-1;background:rgba(255,251,242,.92);border-radius:18px;padding:18px;backdrop-filter:blur(6px)}'
    + 'body.ft-on #my-orders-strip{background:rgba(255,251,242,.94);border-radius:18px;padding:14px!important;border-top:0!important}'
    + '@media (prefers-reduced-motion:reduce){.ft-p,.ft-bulb,.ft-flame,.ft-greet{animation:none!important}.ft-p{display:none}}';

  var current = null, savedTagline = null;
  function client() {
    try { if (typeof db !== 'undefined' && db && db.from) return db; } catch (e) {}
    return window.db;
  }

  function applyHome(t) {
    document.querySelectorAll('.ft-band,.ft-hg,.ft-banner').forEach(function (e) { e.remove(); });
    if (!t) return;
    var home = document.getElementById('page-home');
    if (!home) return;
    var band = document.createElement('div'); band.className = 'ft-band'; home.insertBefore(band, home.firstChild);
    var hdr = document.querySelector('.logo-wrap');
    if (hdr) { var g = document.createElement('div'); g.className = 'ft-hg'; g.innerHTML = garlandSvg(t.garland); hdr.appendChild(g); }
    var name = '';
    try { name = String((currentUser && currentUser.name) || '').split(' ')[0].replace(/[<>&"']/g, ''); } catch (e) {}
    var greet = t.greet.replace(/\s*\S+$/, ''); // "Happy Diwali 🪔" -> "Happy Diwali"
    var b = document.createElement('div');
    b.className = 'ft-banner ' + (t.dark ? 'dark' : 'light');
    b.setAttribute('role', 'note');
    b.innerHTML = '<div><div class="ft-banner-t">' + greet + (name ? ', ' + name : '') + '</div>'
      + '<div class="ft-banner-s">Sweet wishes from NSDI ChocoCravings</div></div><div class="ft-banner-i" aria-hidden="true">' + t.icon + '</div>';
    var after = home.querySelector('.greet');
    if (after) after.parentNode.insertBefore(b, after.nextSibling); else home.insertBefore(b, band.nextSibling);
  }

  function apply(id) {
    var t = id && THEMES[id];
    if ((t ? id : null) === current) return;
    current = t ? id : null;
    if (PAGE === 'store') {
      document.body.classList.toggle('ft-on', !!t);
      document.body.classList.toggle('ft-diya', !!(t && t.diyas));
    }
    ['ft-bg', 'ft-fx'].forEach(function (x) { var e = document.getElementById(x); if (e) e.remove(); });
    document.querySelectorAll('.ft-garland').forEach(function (e) { e.remove(); });
    var tag = document.querySelector('#pg-menu .pg-hdr-right');
    if (tag && savedTagline !== null) { tag.textContent = savedTagline; tag.classList.remove('ft-greet'); }
    if (PAGE === 'home') { applyHome(null); document.body.classList.toggle('ft-home', !!t); }
    if (!t) return;

    if (!document.getElementById('ft-css')) {
      var st = document.createElement('style'); st.id = 'ft-css';
      st.textContent = CSS + (PAGE === 'store' ? STORE_CSS : PAGE === 'home' ? HOME_CSS : '');
      document.head.appendChild(st);
    }
    document.body.style.setProperty('--ft-bg', t.bg);
    document.body.style.setProperty('--ft-ink', t.ink);
    if (PAGE === 'store') { var bg = document.createElement('div'); bg.id = 'ft-bg'; document.body.insertBefore(bg, document.body.firstChild); }
    var fx = document.createElement('div'); fx.id = 'ft-fx';
    var html = ''; for (var i = 0; i < (PAGE === 'home' ? 10 : 14); i++) html += particle(t.fx, i);
    fx.innerHTML = html + (t.diyas && PAGE === 'store' ? diyaRow() : '');
    document.body.appendChild(fx);
    if (PAGE === 'home') { applyHome(t); return; }

    document.querySelectorAll('.page:not(#pg-kitchen) .pg-hdr').forEach(function (hdr) {
      var g = document.createElement('div'); g.className = 'ft-garland'; g.innerHTML = garlandSvg(t.garland);
      hdr.appendChild(g);
    });
    if (tag) {
      if (savedTagline === null) savedTagline = tag.textContent;
      tag.textContent = t.greet; tag.classList.add('ft-greet');
    }
  }

  var setting = 'auto';
  function resolve() { return setting === 'off' ? null : (THEMES[setting] ? setting : autoTheme()); }

  async function load() {
    try { var c = localStorage.getItem('cc_festive_theme'); if (c) setting = c; } catch (e) {}
    apply(resolve());
    try {
      var c = client();
      if (!c || !c.from) return;
      var r = await c.from('app_settings').select('value').eq('key', 'festive_theme').maybeSingle();
      if (r && !r.error) {
        setting = (r.data && r.data.value) || 'auto';
        try { localStorage.setItem('cc_festive_theme', setting); } catch (e) {}
        apply(resolve());
      }
    } catch (e) {}
  }

  // ── Command Center: Festive Theme (admins) ──────────────────────
  function openPicker() {
    var ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:4500;background:rgba(18,10,30,.55);backdrop-filter:blur(3px);display:flex;align-items:flex-end;justify-content:center';
    var auto = autoTheme();
    var opt = function (val, icon, label, sub) {
      var on = setting === val;
      return '<button type="button" data-v="' + val + '" style="display:flex;align-items:center;gap:12px;width:100%;text-align:left;padding:12px 14px;margin-bottom:8px;'
        + 'border-radius:14px;border:1.5px solid ' + (on ? '#6e0977' : '#eedff0') + ';background:' + (on ? '#f6ebf8' : '#fff') + ';cursor:pointer;font:inherit">'
        + '<span style="font-size:22px;width:28px;text-align:center">' + icon + '</span><span style="flex:1"><b style="font-size:14px;color:#2a1530">' + label + '</b>'
        + (sub ? '<br><span style="font-size:11.5px;color:#8a7a90">' + sub + '</span>' : '') + '</span>' + (on ? '<span style="color:#6e0977;font-weight:800">✓</span>' : '') + '</button>';
    };
    var list = opt('auto', '📅', 'Automatic', auto ? 'Today: ' + THEMES[auto].name : 'Changes by festival date · nothing today')
      + opt('off', '⚪', 'Off', 'Plain NSDI Cafe, no decorations')
      + Object.keys(THEMES).map(function (k) { return opt(k, THEMES[k].icon, THEMES[k].name, 'Show now'); }).join('');
    ov.innerHTML = '<div style="width:100%;max-width:480px;max-height:85vh;overflow-y:auto;background:#fffaf5;border-radius:24px 24px 0 0;padding:16px 16px calc(18px + env(safe-area-inset-bottom));font-family:\'Instrument Sans\',sans-serif">'
      + '<div style="width:38px;height:4px;border-radius:2px;background:#e3d3e6;margin:0 auto 12px"></div>'
      + '<div style="font-size:9px;font-weight:700;letter-spacing:2.5px;color:#c2607a">ADMIN</div>'
      + '<div style="font-family:Fraunces,Georgia,serif;font-size:22px;font-weight:900;color:#1a0820;margin:2px 0 4px">Festive Theme</div>'
      + '<div style="font-size:12px;color:#8a7a90;margin-bottom:14px">Decorates NSDI Cafe for everyone (customers and staff). The Kitchen screen stays plain.</div>'
      + list + '</div>';
    ov.addEventListener('click', async function (e) {
      if (e.target === ov) { ov.remove(); return; }
      var b = e.target.closest('button[data-v]'); if (!b) return;
      var val = b.getAttribute('data-v');
      try {
        var r = await client().rpc('cc_set_festive_theme', { p_value: val });
        if (r.error) throw r.error;
        setting = val; try { localStorage.setItem('cc_festive_theme', val); } catch (x) {}
        apply(resolve()); ov.remove();
        if (typeof showStoreToast === 'function') showStoreToast(val === 'off' ? 'Festive theme off' : '✨ ' + (THEMES[val] ? THEMES[val].name : 'Automatic') + ' theme on');
      } catch (err) {
        if (typeof showStoreToast === 'function') showStoreToast(/schema cache|does not exist/i.test(err.message || '')
          ? 'Run migrations/20261111_festive_theme.sql first' : (err.message || 'Could not change theme'));
      }
    });
    document.body.appendChild(ov);
  }

  function register() {
    if (window.registerAdminTool) window.registerAdminTool('Growth & Insights', {
      icon: function () { var a = resolve(); return a ? THEMES[a].icon : '✨'; },
      iconBg: 'rgba(246,196,83,0.18)', title: 'Festive Theme',
      subtitle: function () { var a = resolve(); return setting === 'off' ? 'Off' : a ? THEMES[a].name + (setting === 'auto' ? ' · auto' : '') : 'Automatic · nothing today'; },
      onClick: openPicker
    });
  }

  window.ccFestive = { apply: apply, autoTheme: autoTheme, themes: THEMES, open: openPicker };
  function start() {
    register(); load();
    // Home: put the customer's name in the banner once sign-in has loaded.
    if (PAGE === 'home') [1500, 4000].forEach(function (ms) {
      setTimeout(function () { if (current) applyHome(THEMES[current]); }, ms);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  // Pick up a new day (or an admin change) without a reload.
  setInterval(load, 30 * 60 * 1000);
})();
