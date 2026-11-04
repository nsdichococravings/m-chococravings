/* NSDI Store entry on the home page.
 * Shows nothing until the store is open for this person (or they are staff).
 * Runs after the page has loaded and makes one small call (grocery_entry),
 * so the home page, loyalty card and On Store are not slowed down.
 * The last answer is saved, so the cards appear at once on the next visit. */
(function () {
  'use strict';
  var KEY = 'ns_entry_v1';
  var COLORS = {
    peach: ['#fff1e6', '#4a1d05', '#ffd8b5', '#c2410c'], mint: ['#e6f6ef', '#0d3b2e', '#bfead5', '#0f766e'],
    sky: ['#eaf2ff', '#0b2a5b', '#c9dcff', '#1d4ed8'], blush: ['#fdebf3', '#4d0b2c', '#f8c9de', '#be185d'],
    lemon: ['#fff8d6', '#3d3100', '#fde98a', '#a16207'], lilac: ['#f3ecff', '#2e1065', '#ddd0ff', '#6d28d9']
  };
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) { return '₹' + Number(n || 0).toLocaleString('en-IN'); }
  function client() { try { return typeof db !== 'undefined' && db && db.rpc ? db : null; } catch (e) { return null; } }

  var styled = false;
  function css() {
    if (styled) return; styled = true;
    var s = document.createElement('style');
    s.textContent = '.nse{margin:0 0 22px}.nse-hd{display:flex;justify-content:space-between;align-items:baseline;padding:0 16px 10px}'
      + '.nse-eb{font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#8a6d12}'
      + '.nse-all{font-size:13px;font-weight:600;color:#6e0977;text-decoration:none;padding:6px 0}'
      + '.nse-rail{display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;padding:2px 16px 10px;scrollbar-width:none}.nse-rail::-webkit-scrollbar{display:none}'
      + '.nse-c{flex:0 0 200px;height:290px;border-radius:24px;overflow:hidden;display:flex;flex-direction:column;scroll-snap-align:start;text-decoration:none;box-shadow:0 8px 22px rgba(61,5,67,.12)}'
      + '.nse-art{height:160px;position:relative;display:flex;align-items:center;justify-content:center;overflow:hidden}.nse-art img{width:100%;height:100%;object-fit:cover}'
      + '.nse-tag{position:absolute;top:12px;left:12px;font-size:9.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;padding:4px 8px;border-radius:999px;color:#fff}'
      + '.nse-pk{width:86px;height:114px;border-radius:28px 28px 10px 10px;background:#efe3c8;border:2px solid #c9a633;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:3px;overflow:hidden;box-shadow:0 12px 24px rgba(0,0,0,.16)}'
      + '.nse-pk b{width:100%;background:#6e0977;color:#fff;text-align:center;font-size:16px;padding:6px 0}.nse-pk i{font-style:normal;font-size:8px;font-weight:700;letter-spacing:.12em;color:#3d0543}'
      + '.nse-bd{flex:1;padding:12px 14px 14px;display:flex;flex-direction:column;gap:4px}'
      + '.nse-t{font-family:"Cormorant Garamond",Georgia,serif;font-size:22px;font-weight:700;line-height:1.05}.nse-s{font-size:12px;opacity:.85}'
      + '.nse-cta{margin-top:auto;align-self:flex-start;font-size:12.5px;font-weight:700;padding:8px 13px;border-radius:999px;color:#fff}'
      + '.nse-pv{margin:0 16px 10px;font-size:11.5px;background:#fff4d6;color:#5c4300;border-radius:10px;padding:7px 10px}';
    document.head.appendChild(s);
  }

  function render(d) {
    var box = document.getElementById('ns-entry');
    if (!box) return;
    if (!d || !d.show) { box.innerHTML = ''; return; }
    css();
    var cards = (d.slides || []).map(function (p) {
      var c = COLORS[p.color] || COLORS.peach, off = p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0;
      return '<a class="nse-c" href="/grocery#/p/' + encodeURIComponent(p.id) + '" style="background:' + c[0] + ';color:' + c[1] + '">'
        + '<div class="nse-art" style="background:' + c[2] + '"><span class="nse-tag" style="background:' + c[3] + '">' + (off ? off + '% off' : 'New') + '</span>'
        + (p.thumb ? '<img src="' + h(p.thumb) + '" alt="' + h(p.name) + '" loading="lazy" decoding="async">' : '<div class="nse-pk"><b>' + h(String(p.unit_label || 'Pack').toUpperCase()) + '</b><i>NSDI STORE</i></div>')
        + '</div><div class="nse-bd"><span class="nse-t">' + h(p.title) + '</span><span class="nse-s">' + h(p.text || (p.unit_label + ' · ' + money(p.price))) + '</span>'
        + '<span class="nse-cta" style="background:' + c[3] + '">Buy now →</span></div></a>';
    });
    var m = COLORS.mint, s = COLORS.sky;
    cards.push('<a class="nse-c" href="/grocery#/ask" style="background:' + m[0] + ';color:' + m[1] + '"><div class="nse-art" style="background:' + m[2] + '"><span class="nse-tag" style="background:' + m[3] + '">Your say</span>'
      + '<div class="nse-pk" style="background:#fff"><b style="background:' + m[3] + '">+ ASK</b><i style="color:' + m[1] + '">YOUR LIST</i></div></div>'
      + '<div class="nse-bd"><span class="nse-t">What should we stock next?</span><span class="nse-s">Tell us and we bring it in.</span><span class="nse-cta" style="background:' + m[3] + '">Tell us →</span></div></a>');
    if (!(d.slides || []).length) {
      cards.unshift('<a class="nse-c" href="/grocery" style="background:' + s[0] + ';color:' + s[1] + '"><div class="nse-art" style="background:' + s[2] + '"><span class="nse-tag" style="background:' + s[3] + '">New</span><div style="font-size:56px" aria-hidden="true">🛍️</div></div>'
        + '<div class="nse-bd"><span class="nse-t">NSDI Store</span><span class="nse-s">Daily essentials · pick up at the outlet</span><span class="nse-cta" style="background:' + s[3] + '">Open →</span></div></a>');
    }
    box.innerHTML = '<section class="nse" aria-label="NSDI Store"><div class="nse-hd"><span class="nse-eb">New in NSDI Store</span><a class="nse-all" href="/grocery">Open store →</a></div>'
      + (d.preview ? '<div class="nse-pv">Staff preview: customers do not see this yet. <a href="/grocery-admin.html" style="color:#6e0977;font-weight:700">Manage store →</a></div>' : '')
      + '<div class="nse-rail">' + cards.join('') + '</div></section>';
  }

  function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} }
  function saved() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { return null; } }

  var busy = false, last = 0;
  function refresh() {
    var c = client(); if (!c || busy || Date.now() - last < 60000) return;
    busy = true; last = Date.now();
    c.rpc('grocery_entry').then(function (r) {
      busy = false;
      if (r.error) return;           // function not installed yet, or offline: keep what is shown
      save(r.data); render(r.data);
    }, function () { busy = false; });
  }

  // After sign-in, take the customer back to where they were in NSDI Store.
  function maybeReturn() {
    var c = client(); if (!c) return;
    var back; try { back = JSON.parse(localStorage.getItem('ns_return') || 'null'); } catch (e) { back = null; }
    if (!back || !back.to || Date.now() - back.at > 20 * 60000 || !/^\/grocery(#|$)/.test(back.to)) return;
    c.auth.getSession().then(function (r) {
      if (r && r.data && r.data.session) { localStorage.removeItem('ns_return'); location.href = back.to; }
    }, function () {});
  }

  render(saved());
  function later() {
    var idle = window.requestIdleCallback || function (f) { return setTimeout(f, 1); };
    setTimeout(function () { idle(refresh, { timeout: 4000 }); }, 1500);
    maybeReturn();
    var c = client();
    if (c && c.auth && c.auth.onAuthStateChange) c.auth.onAuthStateChange(function (ev) { if (ev === 'SIGNED_IN' || ev === 'SIGNED_OUT') { if (ev === 'SIGNED_OUT') { save(null); render(null); last = 0; } setTimeout(refresh, 800); } });
  }
  if (document.readyState === 'complete') later(); else window.addEventListener('load', later);
})();
