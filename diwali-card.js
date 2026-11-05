/**
 * diwali-card.js — festive Home card: Diwali Assorted Brownie Box, 500 g, ₹750.
 *
 * A large card above "Our Brownies" with "Add to cart". The box goes into
 * the normal cart and checkout (order_items keeps its name and price).
 * Shows until DIWALI_UNTIL, then hides by itself.
 *
 * Uses index.html globals: cartItems, renderCart, showToast, showPage.
 */
(function () {
  var DIWALI_UNTIL = '2026-11-30T23:59:59+05:30';
  var BOX = { name: 'Diwali Assorted Brownie Box', pack: '500 g', price: 750 };

  if (Date.now() > new Date(DIWALI_UNTIL).getTime()) return;

  var css = ''
    + '.dw{position:relative;margin:4px 16px 22px;border-radius:26px;overflow:hidden;color:#fff7e6;cursor:pointer;'
    +   'background:radial-gradient(120% 90% at 85% 0%,#7a1238 0%,transparent 60%),linear-gradient(150deg,#3a0718 0%,#5b0b2c 45%,#26040f 100%);'
    +   'box-shadow:0 14px 34px rgba(58,7,24,.35);-webkit-tap-highlight-color:transparent}'
    + '.dw-art{position:relative;height:190px}'
    + '.dw-art svg{position:absolute;inset:0;width:100%;height:100%}'
    + '.dw-tag{position:absolute;top:14px;left:14px;font-size:10px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;'
    +   'padding:5px 10px;border-radius:999px;background:linear-gradient(135deg,#f6c453,#e09b2d);color:#3a0718}'
    + '.dw-bd{position:relative;padding:4px 20px 20px}'
    + '.dw-eb{font-size:10px;font-weight:700;letter-spacing:.22em;text-transform:uppercase;color:#f6c453}'
    + '.dw-t{font-family:"Cormorant Garamond",Georgia,serif;font-size:30px;font-weight:700;line-height:1.02;margin-top:4px;color:#fff7e6}'
    + '.dw-s{font-size:12.5px;color:rgba(255,247,230,.72);margin-top:6px}'
    + '.dw-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:16px}'
    + '.dw-p{font-family:"Cormorant Garamond",Georgia,serif;font-size:32px;font-weight:700;color:#f6c453;line-height:1}'
    + '.dw-p small{font-family:inherit;font-size:13px;color:rgba(255,247,230,.6);font-weight:500;margin-left:4px}'
    + '.dw-btn{flex:none;border:0;border-radius:999px;padding:12px 18px;font-family:inherit;font-size:14px;font-weight:800;cursor:pointer;'
    +   'color:#3a0718;background:linear-gradient(135deg,#ffe08a,#f6c453 55%,#e09b2d);box-shadow:0 8px 20px rgba(246,196,83,.35)}'
    + '.dw-btn:active{transform:scale(.97)}'
    + '@keyframes dwFlicker{0%,100%{transform:scaleY(1);opacity:1}50%{transform:scaleY(.86) translateY(1px);opacity:.85}}'
    + '@keyframes dwTwinkle{0%,100%{opacity:.25}50%{opacity:1}}'
    + '.dw-flame{transform-box:fill-box;transform-origin:50% 100%;animation:dwFlicker 1.6s ease-in-out infinite}'
    + '.dw-spark{animation:dwTwinkle 2.4s ease-in-out infinite}'
    + '@media (prefers-reduced-motion:reduce){.dw-flame,.dw-spark{animation:none}}';

  // Gift box with ribbon, brownie squares peeking out, diyas and sparkles.
  function art() {
    var sparks = [[40, 30, 0], [300, 26, .6], [338, 70, 1.2], [70, 92, 1.8], [250, 18, .9], [20, 140, 1.5], [355, 140, .3]]
      .map(function (s) {
        return '<g class="dw-spark" style="animation-delay:' + s[2] + 's" transform="translate(' + s[0] + ' ' + s[1] + ')">'
          + '<path d="M0-6L1.4-1.4 6 0 1.4 1.4 0 6-1.4 1.4-6 0-1.4-1.4Z" fill="#ffe08a"/></g>';
      }).join('');
    function diya(x, d) {
      return '<g transform="translate(' + x + ' 160)">'
        + '<path d="M-22 0Q0 22 22 0Z" fill="#e09b2d"/><path d="M-22 0Q0 14 22 0" fill="none" stroke="#ffe08a" stroke-width="1.5"/>'
        + '<ellipse cx="0" cy="-3" rx="18" ry="5" fill="rgba(255,224,138,.25)"/>'
        + '<path class="dw-flame" style="animation-delay:' + d + 's" d="M0-26C6-17 6-9 0-4C-6-9-6-17 0-26Z" fill="#ffd36b"/>'
        + '<path class="dw-flame" style="animation-delay:' + d + 's" d="M0-19C3-14 3-9 0-6C-3-9-3-14 0-19Z" fill="#fff4cf"/>'
        + '<circle cx="0" cy="-12" r="22" fill="url(#dwGlow)"/></g>';
    }
    return '<svg viewBox="0 0 375 190" preserveAspectRatio="xMidYMid slice" aria-hidden="true">'
      + '<defs><radialGradient id="dwGlow"><stop offset="0" stop-color="#ffd36b" stop-opacity=".45"/><stop offset="1" stop-color="#ffd36b" stop-opacity="0"/></radialGradient>'
      + '<linearGradient id="dwBox" x1="0" x2="1"><stop offset="0" stop-color="#7a1238"/><stop offset="1" stop-color="#a3194d"/></linearGradient>'
      + '<linearGradient id="dwGold" x1="0" x2="1"><stop offset="0" stop-color="#ffe08a"/><stop offset="1" stop-color="#e09b2d"/></linearGradient></defs>'
      // Rangoli ring behind the box
      + '<g transform="translate(188 102)" fill="none" stroke="#f6c453" stroke-opacity=".22">'
      +   '<circle r="78"/><circle r="64" stroke-dasharray="2 6"/>'
      +   [0, 45, 90, 135].map(function (a) { return '<ellipse rx="86" ry="20" transform="rotate(' + a + ')"/>'; }).join('')
      + '</g>'
      + sparks
      // Box
      + '<g transform="translate(128 58)">'
      +   '<rect x="6" y="40" width="108" height="78" rx="8" fill="url(#dwBox)" stroke="#f6c453" stroke-opacity=".5"/>'
      // Brownies peeking out
      +   '<rect x="18" y="22" width="26" height="24" rx="4" fill="#4a2312"/><rect x="18" y="22" width="26" height="7" rx="3" fill="#6b3a1e"/>'
      +   '<rect x="47" y="18" width="26" height="28" rx="4" fill="#3b1a0b"/><rect x="47" y="18" width="26" height="7" rx="3" fill="#f3e3c8"/>'
      +   '<rect x="76" y="22" width="26" height="24" rx="4" fill="#5a2c14"/><rect x="76" y="22" width="26" height="7" rx="3" fill="#c98b4a"/>'
      +   '<rect x="0" y="36" width="120" height="16" rx="6" fill="#8e1642" stroke="#f6c453" stroke-opacity=".6"/>'
      +   '<rect x="54" y="36" width="12" height="82" fill="url(#dwGold)"/>'
      +   '<path d="M60 36C44 18 30 26 40 36M60 36C76 18 90 26 80 36" fill="none" stroke="url(#dwGold)" stroke-width="5" stroke-linecap="round"/>'
      +   '<circle cx="60" cy="36" r="5" fill="#ffe08a"/>'
      + '</g>'
      + diya(58, 0) + diya(318, .7)
      + '</svg>';
  }

  function render() {
    var anchor = document.getElementById('ns-entry');
    if (!anchor || document.getElementById('diwali-card')) return;
    var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    var el = document.createElement('div');
    el.id = 'diwali-card';
    el.innerHTML = '<div class="dw" role="group" aria-label="Diwali special: ' + BOX.name + '">'
      + '<div class="dw-art"><span class="dw-tag">Diwali Special</span>' + art() + '</div>'
      + '<div class="dw-bd"><div class="dw-eb">Festive gift box</div>'
      + '<div class="dw-t">Assorted Brownie Box</div>'
      + '<div class="dw-s">' + BOX.pack + ' of our assorted brownies, packed to gift. Happy Diwali ✨</div>'
      + '<div class="dw-row"><div class="dw-p">₹' + BOX.price + '<small>/ ' + BOX.pack + '</small></div>'
      + '<button type="button" class="dw-btn" onclick="event.stopPropagation();ccAddDiwaliBox(this)">Add to cart</button></div>'
      + '</div></div>';
    el.firstChild.addEventListener('click', function () { var b = el.querySelector('.dw-btn'); if (b) window.ccAddDiwaliBox(b); });
    anchor.parentNode.insertBefore(el, anchor.nextSibling);
  }

  window.ccAddDiwaliBox = function (btn) {
    try {
      var existing = cartItems.find(function (i) { return i.name === BOX.name && i.pack === BOX.pack; });
      if (existing) { existing.qty = (existing.qty || 1) + 1; existing.quantity = existing.qty; }
      else cartItems.push({
        product_name: BOX.name, name: BOX.name, tier: 'premium',
        egg: 'eggless', egg_type: 'eggless', pack: BOX.pack, pack_label: BOX.pack,
        qty: 1, quantity: 1, base_price: BOX.price, topping_price: 0, toppings: [],
        line_total: BOX.price, sku: 'DIWALI-ASSORTED-500G'
      });
      if (typeof renderCart === 'function') renderCart();
      if (typeof showToast === 'function') showToast('🪔 Diwali Box added to cart');
      if (btn) {
        var t = btn.textContent; btn.textContent = '✓ Added';
        setTimeout(function () { btn.textContent = t; }, 1300);
      }
    } catch (e) { if (typeof showToast === 'function') showToast('Could not add to cart'); }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else render();
})();
