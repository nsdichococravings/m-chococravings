/**
 * menu-art.js — ChocoCravings On Store
 * Illustrated artwork for menu cards that don't have a real photo yet.
 * menuArt(item, category) picks a drawing from the item's name (then its
 * category) and tints it by flavour, e.g. "Strawberry Milkshake" → pink
 * shake, "Cold Coffee" → iced glass, "Blondie" → golden brownie stack.
 * A real photo uploaded in Manage Menu always replaces the artwork.
 *
 * Returns a data: URI (each SVG is self-contained, so gradient ids never
 * clash between cards). Results are cached per drawing + flavour.
 * Load BEFORE menu-search-patch.js; store.html's menuCardHtml() uses it.
 */
(function () {
  // ── Flavour tints ─────────────────────────────────────────────
  var FLAVOURS = [
    [/red\s*velvet/, '#b3263a', '#7a1426'],
    [/straw|rose|pink|falooda/, '#f28ba8', '#d45b80'],
    [/mango/, '#ffc23d', '#f29a12'],
    [/blue\s*berr|black\s*currant|grape/, '#7b5fc7', '#523a9a'],
    [/pista|pistachio|mint|matcha|kiwi|green/, '#9fcf6a', '#6aa23c'],
    [/vanilla|white|milk(?!shake)|badam|almond|coconut/, '#f7e8c8', '#e2c995'],
    [/caramel|butterscotch|biscoff|lotus|toffee|honey|blondie/, '#e0a24a', '#b9741f'],
    [/oreo|kitkat|black\s*forest/, '#3b2a2a', '#1f1414'],
    [/orange/, '#ffa14a', '#f07a12'],
    [/water\s*melon/, '#ff5d6c', '#d9354a'],
    [/lime|lemon|mojito|nimbu/, '#c6e86b', '#8fbf2f'],
    [/pineapple/, '#ffd84a', '#e9b417'],
    [/apple/, '#ff6b5e', '#d8403a'],
    [/choc|nutella|cocoa|brownie|mocha|fudge|coffee|espresso/, '#7a4a2c', '#4a2617']
  ];
  function flavour(name, fallback) {
    for (var i = 0; i < FLAVOURS.length; i++) if (FLAVOURS[i][0].test(name)) return [FLAVOURS[i][1], FLAVOURS[i][2]];
    return fallback || ['#7a4a2c', '#4a2617'];
  }

  // ── Shared pieces ─────────────────────────────────────────────
  function svg(bgA, bgB, body, defs) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">'
      + '<defs><radialGradient id="bg" cx=".32" cy=".28" r=".95"><stop offset="0" stop-color="' + bgA + '"/><stop offset="1" stop-color="' + bgB + '"/></radialGradient>'
      + '<radialGradient id="sh" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#2a1208" stop-opacity=".35"/><stop offset="1" stop-color="#2a1208" stop-opacity="0"/></radialGradient>'
      + '<linearGradient id="gl" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity=".55"/><stop offset=".35" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#fff" stop-opacity=".35"/></linearGradient>'
      + (defs || '') + '</defs>'
      + '<rect width="200" height="200" fill="url(#bg)"/>'
      + '<circle cx="168" cy="28" r="46" fill="#fff" opacity=".10"/><circle cx="22" cy="182" r="38" fill="#fff" opacity=".07"/>'
      + body + '</svg>';
  }
  function shadow(cx, cy, rx) { return '<ellipse cx="' + cx + '" cy="' + cy + '" rx="' + rx + '" ry="' + (rx * 0.22) + '" fill="url(#sh)"/>'; }
  function steam(x, y) {
    return '<g fill="none" stroke="#fff" stroke-width="3.5" stroke-linecap="round" opacity=".55">'
      + '<path d="M' + x + ' ' + y + 'c-8-10 8-14 0-26"/><path d="M' + (x + 16) + ' ' + (y + 4) + 'c-8-10 8-14 0-26"/><path d="M' + (x - 16) + ' ' + (y + 4) + 'c-8-10 8-14 0-26"/></g>';
  }
  function grad(id, a, b, vertical) {
    return '<linearGradient id="' + id + '" x1="0" y1="0" x2="' + (vertical ? 0 : 1) + '" y2="' + (vertical ? 1 : 0) + '"><stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/></linearGradient>';
  }

  // ── Drawings (viewBox 200×200) ───────────────────────────────
  var DRAW = {
    hotCup: function (f, opts) {
      var dark = opts.dark;
      return svg('#f6dfc3', '#9b6440',
        shadow(100, 160, 70)
        + '<ellipse cx="100" cy="152" rx="66" ry="14" fill="#fbf6f0"/><ellipse cx="100" cy="149" rx="50" ry="9" fill="#e9dfd6"/>'
        + '<path d="M152 98c22-2 26 30 0 32" fill="none" stroke="#f3ebe3" stroke-width="10"/>'
        + '<path d="M50 88h104l-8 52c-2 10-12 14-44 14s-42-4-44-14z" fill="url(#cup)"/>'
        + '<ellipse cx="102" cy="88" rx="52" ry="13" fill="#fff"/>'
        + '<ellipse cx="102" cy="89" rx="45" ry="9.5" fill="' + (dark ? '#3b1d10' : f[1]) + '"/>'
        + (opts.art ? '<path d="M102 84c-10 0-16 5-10 8 4 2 6-2 10-2s6 4 10 2c6-3 0-8-10-8z" fill="#f4e2c6" opacity=".95"/><circle cx="102" cy="92" r="2.4" fill="#f4e2c6"/>' : '')
        + '<path d="M58 96c4 22 6 34 10 44" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".45"/>'
        + steam(102, 66),
        grad('cup', '#ffffff', '#e7dcd2'));
    },
    espresso: function (f) {
      return svg('#f1d3b4', '#6e4127',
        shadow(100, 156, 56)
        + '<ellipse cx="100" cy="150" rx="52" ry="11" fill="#fbf6f0"/>'
        + '<path d="M136 112c16 0 18 22 0 22" fill="none" stroke="#f3ebe3" stroke-width="8"/>'
        + '<path d="M66 104h72l-6 34c-2 8-8 11-30 11s-28-3-30-11z" fill="url(#cup)"/>'
        + '<ellipse cx="102" cy="104" rx="36" ry="9" fill="#fff"/><ellipse cx="102" cy="105" rx="31" ry="6.5" fill="#c58a52"/>'
        + '<ellipse cx="96" cy="104" rx="10" ry="2.5" fill="#e3b27c" opacity=".8"/>'
        + steam(102, 86),
        grad('cup', '#ffffff', '#e7dcd2'));
    },
    icedGlass: function (f, opts) {
      var cream = opts.cream;
      return svg('#e9f3f6', '#7d5a45',
        shadow(100, 170, 52)
        + '<path d="M62 52h76l-9 110c-1 8-6 10-29 10s-28-2-29-10z" fill="#fff" opacity=".35"/>'
        + '<path d="M65 74h70l-7 86c-1 6-6 8-28 8s-27-2-28-8z" fill="url(#liq)"/>'
        + (cream ? '<path d="M64 74h72c2-14-10-24-20-20-4-10-26-10-32 0-12-4-24 6-20 20z" fill="#fff6ea"/>' : '')
        + '<g fill="#fff" opacity=".55"><rect x="78" y="96" width="18" height="18" rx="4" transform="rotate(-12 87 105)"/><rect x="104" y="112" width="18" height="18" rx="4" transform="rotate(14 113 121)"/><rect x="84" y="128" width="16" height="16" rx="4" transform="rotate(6 92 136)"/></g>'
        + '<rect x="108" y="22" width="9" height="84" rx="4" fill="' + (opts.straw || '#6e0977') + '" transform="rotate(14 112 64)"/>'
        + '<path d="M62 52h76l-9 110c-1 8-6 10-29 10s-28-2-29-10z" fill="url(#gl)" opacity=".7"/>'
        + '<path d="M70 60l6 96" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".6"/>',
        grad('liq', f[0], f[1], true));
    },
    shake: function (f) {
      return svg('#fde9ee', f[1],
        shadow(100, 172, 50)
        + '<path d="M66 70h68l-8 92c-1 7-5 9-26 9s-25-2-26-9z" fill="url(#liq)"/>'
        + '<path d="M60 70c-4-18 12-26 22-22 4-14 32-14 36 0 10-4 26 4 22 22z" fill="#fff8f0"/>'
        + '<circle cx="100" cy="40" r="9" fill="#d8233c"/><path d="M100 31c2-8 8-10 12-10" stroke="#3f7d2c" stroke-width="3" fill="none" stroke-linecap="round"/>'
        + '<rect x="114" y="14" width="9" height="74" rx="4" fill="#ffffff" transform="rotate(16 118 52)"/><rect x="114" y="14" width="9" height="74" rx="4" fill="' + f[1] + '" opacity=".35" transform="rotate(16 118 52)"/>'
        + '<path d="M60 70h80l-8 92c-1 7-5 9-26 9h-12c-21 0-25-2-26-9z" fill="url(#gl)" opacity=".55"/>'
        + '<g fill="#fff" opacity=".6"><circle cx="82" cy="100" r="2"/><circle cx="112" cy="122" r="2"/><circle cx="94" cy="140" r="1.6"/></g>',
        grad('liq', f[0], f[1], true));
    },
    juice: function (f) {
      return svg('#f3f9e8', f[1],
        shadow(100, 170, 50)
        + '<path d="M66 58h68l-8 104c-1 7-5 9-26 9s-25-2-26-9z" fill="url(#liq)" opacity=".92"/>'
        + '<circle cx="130" cy="58" r="22" fill="' + f[1] + '"/><circle cx="130" cy="58" r="17" fill="' + f[0] + '"/>'
        + '<g stroke="' + f[1] + '" stroke-width="2" opacity=".6"><path d="M130 41v34M113 58h34M118 46l24 24M142 46l-24 24"/></g>'
        + '<path d="M80 36l12 120" stroke="#ffffff" stroke-width="7" stroke-linecap="round"/>'
        + '<g fill="#fff" opacity=".55"><circle cx="90" cy="96" r="2.5"/><circle cx="108" cy="118" r="2"/><circle cx="96" cy="138" r="2.5"/><circle cx="114" cy="84" r="1.6"/></g>'
        + '<path d="M62 58h76l-9 104c-1 7-5 9-29 9s-28-2-29-9z" fill="url(#gl)" opacity=".6"/>'
        + '<path d="M70 66l6 90" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".55"/>',
        grad('liq', f[0], f[1], true));
    },
    tea: function (f) {
      return svg('#f4e7cf', '#8c5a2b',
        shadow(100, 162, 60)
        + '<ellipse cx="100" cy="154" rx="58" ry="12" fill="#fbf6f0"/>'
        + '<path d="M66 84h68l-6 58c-1 8-8 12-28 12s-27-4-28-12z" fill="#fff" opacity=".45"/>'
        + '<path d="M68 96h64l-5 46c-1 7-8 10-27 10s-26-3-27-10z" fill="url(#liq)"/>'
        + '<ellipse cx="100" cy="96" rx="32" ry="6" fill="' + f[0] + '"/>'
        + '<path d="M66 84h68l-6 58c-1 8-8 12-28 12s-27-4-28-12z" fill="url(#gl)" opacity=".7"/>'
        + '<path d="M120 70c10 6 22 2 26-8-12-4-22 0-26 8z" fill="#7aa84a"/>'
        + steam(100, 74),
        grad('liq', '#e6a548', '#b3651c', true));
    },
    brownie: function (f, opts) {
      var top = opts.blondie ? '#e9b45c' : f[0], side = opts.blondie ? '#c88a34' : f[1];
      return svg('#f6e1c9', '#7a4a2c',
        shadow(100, 160, 72)
        + '<ellipse cx="100" cy="150" rx="74" ry="16" fill="#fbf6f0"/>'
        + '<path d="M44 118l46-16 50 14v24l-50 16-46-14z" fill="' + side + '"/><path d="M44 118l46-16 50 14-48 16z" fill="' + top + '"/>'
        + '<path d="M66 94l42-14 44 12v22l-44 14-42-12z" fill="' + side + '" opacity=".95"/><path d="M66 94l42-14 44 12-42 14z" fill="' + top + '"/>'
        + '<g fill="' + (opts.blondie ? '#7a4a2c' : '#2a120a') + '" opacity=".65"><circle cx="96" cy="92" r="3"/><circle cx="118" cy="88" r="2.5"/><circle cx="132" cy="96" r="3"/><circle cx="70" cy="118" r="2.6"/><circle cx="90" cy="122" r="2.4"/></g>'
        + '<path d="M70 92c10 4 30 6 44-2" stroke="#fff" stroke-width="2.5" fill="none" opacity=".35"/>'
        + '<path d="M100 74c6-6 16-6 20 0" stroke="' + (opts.blondie ? '#fff4dc' : '#3b1d10') + '" stroke-width="5" fill="none" stroke-linecap="round" opacity=".9"/>');
    },
    cake: function (f) {
      return svg('#fbe4ea', f[1],
        shadow(100, 164, 70)
        + '<ellipse cx="100" cy="156" rx="72" ry="14" fill="#fbf6f0"/>'
        + '<path d="M40 136l70-58 52 34v30l-52 18-70-12z" fill="#fff6ea"/>'
        + '<path d="M40 136l70 12 52-18v30l-52 18-70-12z" fill="url(#side)"/>'
        + '<path d="M42 146l68 12 50-17" stroke="#fff6ea" stroke-width="5" fill="none"/>'
        + '<path d="M40 136l70-58 52 34-52 18z" fill="' + f[0] + '"/>'
        + '<path d="M40 136l70 12 52-18" stroke="' + f[1] + '" stroke-width="4" fill="none"/>'
        + '<circle cx="108" cy="92" r="9" fill="#d8233c"/><path d="M108 83c2-8 8-10 12-9" stroke="#3f7d2c" stroke-width="3" fill="none" stroke-linecap="round"/>',
        grad('side', f[0], f[1], true));
    },
    cookie: function (f) {
      var dough = /choc|nutella|cocoa|oreo|brownie/.test(f.name) ? ['#8a5434', '#5e3420'] : ['#e8b46a', '#c98a3c'];
      return svg('#f7e6cf', '#9b6a3c',
        shadow(104, 156, 66)
        + '<circle cx="86" cy="104" r="48" fill="' + dough[1] + '"/><circle cx="86" cy="100" r="46" fill="' + dough[0] + '"/>'
        + '<circle cx="124" cy="122" r="40" fill="' + dough[1] + '"/><circle cx="124" cy="118" r="38" fill="' + dough[0] + '"/>'
        + '<g fill="#3b1d10"><path d="M70 86l8-3 4 7-7 4z"/><path d="M98 96l8-2 3 8-8 3z"/><path d="M78 118l7-3 4 6-7 4z"/><path d="M118 104l8-2 3 7-8 3z"/><path d="M134 128l7-3 4 6-7 4z"/><path d="M110 134l7-2 3 7-8 2z"/></g>'
        + '<path d="M64 80c10-10 26-12 36-6" stroke="#fff" stroke-width="3" fill="none" opacity=".3" stroke-linecap="round"/>');
    },
    cupcake: function (f) {
      return svg('#fde6ef', f[1],
        shadow(100, 168, 52)
        + '<path d="M62 108h76l-10 56H72z" fill="#c98a3c"/><g stroke="#a86a26" stroke-width="3"><path d="M76 108l4 56M92 108l2 56M108 108l-2 56M124 108l-4 56"/></g>'
        + '<path d="M56 110c-6-20 16-30 24-24 0-22 40-22 40 0 8-6 30 4 24 24z" fill="' + f[0] + '"/>'
        + '<path d="M72 80c0-16 28-24 34-8 10-6 22 4 14 18-12 6-36 6-48-10z" fill="' + f[0] + '"/>'
        + '<path d="M70 96c12 8 44 8 60 0" stroke="' + f[1] + '" stroke-width="3" fill="none" opacity=".5"/>'
        + '<circle cx="100" cy="56" r="9" fill="#d8233c"/>'
        + '<g fill="#fff"><rect x="78" y="94" width="6" height="2.5" rx="1" transform="rotate(30 81 95)"/><rect x="112" y="98" width="6" height="2.5" rx="1" transform="rotate(-30 115 99)"/><rect x="96" y="84" width="6" height="2.5" rx="1"/></g>');
    },
    iceCream: function (f) {
      return svg('#e8f4fb', '#5c8fb8',
        shadow(100, 168, 46)
        + '<path d="M70 100l30 70 30-70z" fill="#e2a85a"/><g stroke="#b97a2f" stroke-width="2.5" opacity=".8"><path d="M78 108l34 40M92 104l26 30M120 106l-34 42M106 104l-24 30"/></g>'
        + '<circle cx="84" cy="94" r="22" fill="' + f[0] + '"/><circle cx="116" cy="94" r="22" fill="#f7e8c8"/>'
        + '<circle cx="100" cy="68" r="24" fill="' + (f.name.match(/straw|rose|pink/) ? '#f28ba8' : '#7a4a2c') + '"/>'
        + '<path d="M82 66c4-10 18-14 26-8" stroke="#fff" stroke-width="3" fill="none" opacity=".45" stroke-linecap="round"/>'
        + '<circle cx="100" cy="44" r="7" fill="#d8233c"/>');
    },
    affogato: function () {
      return svg('#f3d9bd', '#5a2e1a',
        shadow(100, 170, 56)
        + '<path d="M58 80h84l-10 74c-2 10-12 14-32 14s-30-4-32-14z" fill="#fff" opacity=".4"/>'
        + '<path d="M62 118h76l-6 36c-2 9-11 12-32 12s-30-3-32-12z" fill="#4a2617"/>'
        + '<rect x="70" y="122" width="26" height="22" rx="4" fill="#3b1d10"/><rect x="102" y="128" width="24" height="20" rx="4" fill="#3b1d10"/>'
        + '<circle cx="100" cy="100" r="28" fill="#f7e8c8"/><path d="M78 96c6 10 18 18 34 14 6-2 12-8 14-14" fill="#7a4a2c" opacity=".85"/>'
        + '<path d="M86 86c6-8 18-10 26-4" stroke="#fff" stroke-width="3" fill="none" opacity=".6" stroke-linecap="round"/>'
        + '<path d="M58 80h84l-10 74c-2 10-12 14-32 14s-30-4-32-14z" fill="url(#gl)" opacity=".55"/>');
    },
    chocolate: function (f) {
      return svg('#f3dccb', '#4a2617',
        shadow(100, 160, 70)
        + '<g transform="rotate(-14 100 110)"><rect x="46" y="70" width="108" height="76" rx="8" fill="#3b1d10"/>'
        + '<g fill="' + f[0] + '"><rect x="52" y="76" width="30" height="20" rx="3"/><rect x="85" y="76" width="30" height="20" rx="3"/><rect x="118" y="76" width="30" height="20" rx="3"/>'
        + '<rect x="52" y="99" width="30" height="20" rx="3"/><rect x="85" y="99" width="30" height="20" rx="3"/><rect x="118" y="99" width="30" height="20" rx="3"/>'
        + '<rect x="52" y="122" width="30" height="18" rx="3"/><rect x="85" y="122" width="30" height="18" rx="3"/><rect x="118" y="122" width="30" height="18" rx="3"/></g>'
        + '<rect x="40" y="118" width="122" height="34" rx="4" fill="#c8a24a"/><rect x="40" y="118" width="122" height="34" rx="4" fill="url(#gl)" opacity=".5"/></g>');
    },
    savoury: function () {
      return svg('#fde3cf', '#b3401f',
        shadow(100, 162, 72)
        + '<ellipse cx="100" cy="148" rx="74" ry="18" fill="#fbf6f0"/><ellipse cx="100" cy="144" rx="60" ry="12" fill="#efe4d8"/>'
        + '<path d="M54 140l26-52 26 52z" fill="#e3a14a"/><path d="M96 142l24-46 26 46z" fill="#d9903a"/>'
        + '<path d="M60 136l20-40" stroke="#fff3dc" stroke-width="3" opacity=".6"/><path d="M102 138l18-36" stroke="#fff3dc" stroke-width="3" opacity=".6"/>'
        + '<path d="M138 70c10 4 16 18 10 30-6-6-16-16-10-30z" fill="#d8233c"/><path d="M138 70c0-6 4-10 8-10" stroke="#3f7d2c" stroke-width="3" fill="none" stroke-linecap="round"/>'
        + steam(84, 80));
    },
    combo: function (f) {
      return svg('#f4dfc6', '#6e4127',
        shadow(100, 164, 78)
        + '<ellipse cx="72" cy="150" rx="40" ry="9" fill="#fbf6f0"/>'
        + '<path d="M44 96h56l-6 40c-1 8-8 12-22 12s-21-4-22-12z" fill="#fff"/><ellipse cx="72" cy="96" rx="28" ry="7" fill="#fff"/><ellipse cx="72" cy="97" rx="23" ry="5" fill="#7a4a2c"/>'
        + '<path d="M100 104c14 0 14 20 0 20" fill="none" stroke="#f3ebe3" stroke-width="6"/>'
        + '<path d="M110 132l30-10 32 9v16l-32 10-30-9z" fill="#4a2617"/><path d="M110 132l30-10 32 9-31 10z" fill="#7a4a2c"/>'
        + '<g fill="#2a120a" opacity=".7"><circle cx="134" cy="128" r="2.4"/><circle cx="150" cy="130" r="2.2"/></g>'
        + steam(72, 78));
    },
    plate: function () {
      return svg('#f6e3d6', '#7a4a6e',
        shadow(100, 158, 72)
        + '<ellipse cx="100" cy="146" rx="74" ry="20" fill="#fbf6f0"/><ellipse cx="100" cy="142" rx="56" ry="13" fill="#efe4d8"/>'
        + '<path d="M70 110c0-24 60-24 60 0 0 14-14 24-30 24s-30-10-30-24z" fill="#d9903a"/>'
        + '<path d="M78 104c10-10 34-10 44 0" stroke="#fff3dc" stroke-width="4" fill="none" opacity=".6" stroke-linecap="round"/>'
        + '<g fill="#6e0977" opacity=".8"><circle cx="92" cy="100" r="3"/><circle cx="108" cy="98" r="3"/><circle cx="100" cy="112" r="3"/></g>');
    }
  };

  // ── Choosing a drawing ───────────────────────────────────────
  // First match wins, so more specific names come first.
  var RULES = [
    [/affogato/, 'affogato'],
    [/combo|meal|pack|box/, 'combo'],
    [/shake|frappe|smoothie/, 'shake'],
    [/cold\s*coffee|iced|ice\s*coffee|cold\s*brew/, 'icedGlass', { cream: true, straw: '#6e0977' }],
    [/juice|lime|lemon|mojito|soda|orange|water\s*melon|pineapple|cooler|nimbu/, 'juice'],
    [/espresso|ristretto|short\s*black/, 'espresso'],
    [/hot\s*choc|cocoa/, 'hotCup', { dark: true }],
    [/latte|cappuccino|flat\s*white|mocha/, 'hotCup', { art: true }],
    [/coffee|americano|chukku|filter|kaapi|kapi/, 'hotCup', {}],
    [/tea|chai|kahwa|green\s*tea/, 'tea'],
    [/blondie/, 'brownie', { blondie: true }],
    [/brownie|fudge/, 'brownie', {}],
    [/cupcake|muffin/, 'cupcake'],
    [/cake|pastry|slice|cheesecake|tiramisu/, 'cake'],
    [/cookie|biscuit/, 'cookie'],
    [/ice\s*cream|sundae|scoop|gelato|kulfi/, 'iceCream'],
    [/chocolate\s*bar|bar$|truffle|bonbon|dark\s*choc/, 'chocolate'],
    [/samosa|puff|sandwich|maggi|fries|nachos|spicy|masala|bajji|cutlet|roll/, 'savoury']
  ];
  var BY_CATEGORY = {
    Coffee: ['hotCup', {}], Tea: ['tea'], Desserts: ['brownie', {}], Brownies: ['brownie', {}], Cakes: ['cake'],
    Cookies: ['cookie'], IceCream: ['iceCream'], Milkshake: ['shake'], Chocolate: ['chocolate'], Spicy: ['savoury'],
    Combo: ['combo'], Blondie: ['brownie', { blondie: true }], Cupcake: ['cupcake'], Others: ['juice'] // shown as "Fresh Juices"
  };

  var cache = {};
  window.menuArt = function (item, category) {
    var name = String((item && item.name) || '').toLowerCase();
    var pick = null;
    for (var i = 0; i < RULES.length && !pick; i++) if (RULES[i][0].test(name)) pick = RULES[i];
    var kind = pick ? pick[1] : (BY_CATEGORY[category] || ['plate'])[0];
    var opts = (pick ? pick[2] : (BY_CATEGORY[category] || [])[1]) || {};
    if (/juice/.test(category || '') && !pick) kind = 'juice';
    var f = flavour(name, kind === 'juice' ? ['#ffa14a', '#f07a12'] : kind === 'tea' ? ['#e6a548', '#b3651c'] : null);
    f.name = name;
    var key = kind + '|' + f[0] + '|' + JSON.stringify(opts) + '|' + (kind === 'cookie' || kind === 'iceCream' ? name : '');
    if (!cache[key]) cache[key] = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(DRAW[kind](f, opts));
    return cache[key];
  };
})();
