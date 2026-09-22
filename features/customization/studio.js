// ── CUSTOM ORDER ──
var customSelections = { occasion:'Birthday', shape:'Rectangle', theme:'Floral', serves:'1 kg', flavour:'Classic Dark Chocolate', egg:'Eggless', layers:'1', Fauxball:'None', butterfly:'None', topper:'None', acrylicStyle:'Clear', drizzle:'None' };
function selTopperChip(el, val) {
  document.querySelectorAll('.cust-chip[data-group="topper"]').forEach(function(c) {
    c.style.background  = 'var(--card)';
    c.style.borderColor = 'var(--bdr)';
  });
  el.style.background  = 'rgba(107,47,206,.15)';
  el.style.borderColor = 'var(--p)';
  customSelections.topper = val;

  var nameWrap    = document.getElementById('topper-name-wrap');
  var acrylicWrap = document.getElementById('acrylic-style-wrap');
  if (nameWrap)    nameWrap.style.display    = val !== 'None' ? 'block' : 'none';
  if (acrylicWrap) acrylicWrap.style.display = val === 'Acrylic Topper' ? 'block' : 'none';
  updateBrowniePreview();
}

function selAcrylic(el, style) {
  document.querySelectorAll('.acrylic-chip').forEach(function(c) {
    c.style.background  = 'var(--card)';
    c.style.borderColor = 'var(--bdr)';
    var lbl = c.querySelector('div:last-child');
    if (lbl) lbl.style.color = 'var(--dim)';
  });
  el.style.background  = 'rgba(255,255,255,.1)';
  el.style.borderColor = 'rgba(255,255,255,.3)';
  var lbl = el.querySelector('div:last-child');
  if (lbl) lbl.style.color = 'var(--white)';
  customSelections.acrylicStyle = style;
}

function selChip(el, group) {
  document.querySelectorAll('.cust-chip[data-group="' + group + '"]').forEach(function(c) {
    c.style.background  = 'var(--card)';
    c.style.borderColor = 'var(--bdr)';
    var lbl = c.querySelector('div:last-child');
    if (lbl) lbl.style.color = 'var(--dim)';
  });
  el.style.background  = 'rgba(107,47,206,.15)';
  el.style.borderColor = 'var(--p)';
  var lbl = el.querySelector('div:last-child');
  if (lbl) lbl.style.color = 'var(--pl)';
  customSelections[group] = el.getAttribute('data-val');

  // ── Hide occasion input if switching away from My Own ──
  if (group === 'occasion' && el.getAttribute('data-val') !== 'My Own') {
    var wrap = document.getElementById('occasion-custom-wrap');
    if (wrap) wrap.style.display = 'none';
  }

  // Inside selChip(), after setting customSelections[group]:
  if (group === 'flavour') {
    var val = el.getAttribute('data-val');
    // Reset loaded base when switching flavour
    _fbvSelected = 'Plain';
    customSelections.flavourBase = 'Plain';
    updateFlavourEditBtn(); // ← hide indicator from previous chip first
    if (val === 'Classic Dark Chocolate' || val === 'Couverture Belgian') {
      setTimeout(openFlavourSheet, 200);
    }
  }

  updateBrowniePreview();
}

// ── BROWNIE PREVIEW ──
// Dynamic price map — loaded from Supabase
var PRICE_MAP = {
  'Eggless':  {},
  'With Egg': {}
};

async function loadCakePricing() {
  try {
    var { data, error } = await db
      .from('cake_pricing')
      .select('egg_type, weight, price_min, price_max')
      .eq('is_active', true);

    if (error || !data || data.length === 0) {
      console.warn('cake_pricing load failed — using defaults');
      return;
    }

    // Reset
    PRICE_MAP = { 'Eggless': {}, 'With Egg': {} };

    data.forEach(function(row) {
      if (!PRICE_MAP[row.egg_type]) PRICE_MAP[row.egg_type] = {};
      PRICE_MAP[row.egg_type][row.weight] = [row.price_min, row.price_max];
    });

    console.log('✅ Cake pricing loaded:', PRICE_MAP);

  } catch(e) {
    console.warn('loadCakePricing error:', e.message);
  }
}

// Layer add-ons per KG
var LAYER_ADDON = { '1': 0, '2': 150, '3': 300 };

// Topper add-ons (flat fee)
var TOPPER_ADDON = {
  'None': 0,
  'Acrylic Topper': 250,
  'White Chocolate Name': 50,
  'Dark Chocolate Name': 25
};

// Decoration add-ons
var FauxBALL_ADDON = { 'None': 0, 'Faux Ball – 1 Corner': 80, 'Faux Balls – 4 Corners': 200 };
var BUTTERFLY_ADDON = { 'None': 0, '1 Butterfly': 40, '3 Butterflies': 110 };

function calcKg(serves) {
  var map = { '0.5 kg':0.5, '1 kg':1, '1.5 kg':1.5, '2 kg':2, '3 kg':3, '5 kg+':5 };
  return map[serves] || 1;
}

var THEME_COLORS = {
  'Floral':      ['#F9A8D4','#FBCFE8','#FCE7F3'],
  'Jungle':      ['#4ADE80','#86EFAC','#BBF7D0'],
  'Avengers':    ['#EF4444','#3B82F6','#F59E0B'],
  'Princess':    ['#E879F9','#F0ABFC','#F5D0FE'],
  'Galaxy':      ['#818CF8','#6366F1','#4338CA'],
  'Minimalist':  ['#D1D5DB','#9CA3AF','#6B7280'],
  'Retro':       ['#F59E0B','#FBBF24','#FCD34D'],
  'Sports':      ['#22C55E','#16A34A','#15803D'],
  'Custom':      ['#C084FC','#A855F7','#7C3AED'],
};

var OCCASION_ICONS = {
  'Birthday':'🎂','Anniversary':'💑','Baby Shower':'👶',
  'Graduation':'🎓','Corporate':'💼','Other':'✨'
};

var SIMILAR_REFS = {
  'Birthday':   ['🎂 Floral Slab','🌸 Pink Dream','🎀 Ribbon Cake'],
  'Anniversary':['💑 Gold Drip','🌹 Rose Slab','💍 Elegant White'],
  'Baby Shower':['👶 Pastel Slab','🍼 Blue/Pink','🌈 Soft Rainbow'],
  'Graduation': ['🎓 Cap & Scroll','📚 Book Slab','⭐ Star Theme'],
  'Corporate':  ['💼 Logo Slab','🏆 Trophy','📊 Branded Box'],
  'Other':      ['🎨 Artisan','🌟 Premium','✨ Bespoke'],
};

function drawBrownieCanvas() {
  var canvas = document.getElementById('brownie-canvas');
  if (!canvas) return;
  var ctx = canvas.getContext('2d');
  var w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  var shape   = customSelections.shape   || 'Rectangle';
  var theme   = customSelections.theme   || 'Floral';
  var flavour = customSelections.flavour || 'Classic Dark Chocolate';

  // Base brownie colour from flavour
  var baseColor = flavour.includes('Nutella') ? '#92400E'
                : flavour.includes('Triple')  ? '#1C1917'
                : flavour.includes('Couverture') ? '#292524'
                : '#3B1A0A';
  var topColor  = flavour.includes('Nutella') ? '#B45309'
                : flavour.includes('Couverture') ? '#44403C'
                : '#5C2D0A';

  // Draw shape
  ctx.save();
  ctx.beginPath();
  if (shape === 'Round') {
    ctx.ellipse(50, 50, 40, 40, 0, 0, Math.PI * 2);
  } else if (shape === 'Heart') {
    ctx.moveTo(50, 35);
    ctx.bezierCurveTo(50,30, 25,20, 25,40);
    ctx.bezierCurveTo(25,60, 50,75, 50,80);
    ctx.bezierCurveTo(50,75, 75,60, 75,40);
    ctx.bezierCurveTo(75,20, 50,30, 50,35);
  } else if (shape === 'Square') {
    ctx.roundRect ? ctx.roundRect(10, 10, 80, 80, 8) : ctx.rect(10, 10, 80, 80);
  } else { // Rectangle
    ctx.roundRect ? ctx.roundRect(5, 18, 90, 64, 8) : ctx.rect(5, 18, 90, 64);
  }
  ctx.fillStyle = baseColor;
  ctx.fill();
  ctx.fillStyle = topColor;
  ctx.globalAlpha = 0.5;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = 'rgba(255,255,255,.12)';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();

  // Draw layer lines on slab
  var layers = parseInt(customSelections.layers || '1');
  if (layers > 1) {
    var yPositions = shape === 'Round' ? [45] : shape === 'Square' ? [43] : [42];
    if (layers === 3) yPositions = shape === 'Round' ? [38,55] : shape === 'Square' ? [37,57] : [36,56];
    yPositions.forEach(function(y) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,.25)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3,2]);
      ctx.beginPath();
      if (shape === 'Round') {
        ctx.moveTo(15, y); ctx.lineTo(85, y);
      } else if (shape === 'Square') {
        ctx.moveTo(12, y); ctx.lineTo(88, y);
      } else {
        ctx.moveTo(7, y); ctx.lineTo(93, y);
      }
      ctx.stroke();
      ctx.restore();
    });
  }

  // Theme decoration dots
  var tc = THEME_COLORS[theme] || THEME_COLORS['Floral'];
  var decoPositions = shape === 'Round'
    ? [[35,35],[60,30],[50,60],[70,55],[30,60]]
    : shape === 'Square'
    ? [[25,25],[65,25],[45,50],[25,70],[65,70]]
    : [[20,35],[50,28],[80,35],[30,62],[65,62]];

  decoPositions.forEach(function(pos, i) {
    ctx.beginPath();
    ctx.arc(pos[0], pos[1], 5, 0, Math.PI * 2);
    ctx.fillStyle = tc[i % tc.length];
    ctx.globalAlpha = 0.85;
    ctx.fill();
    ctx.globalAlpha = 1;
  });

  // Message text hint
  var msg = document.getElementById('custom-message');
  if (msg && msg.value.trim()) {
    ctx.save();
    ctx.font = 'bold 7px sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,.7)';
    ctx.textAlign = 'center';
    var text = msg.value.trim().slice(0, 14);
    ctx.fillText(text, 50, shape === 'Round' ? 52 : 52);
    ctx.restore();
  }
}

function updateBrowniePreview() {
  drawBrownieCanvas();

  // Title
  var titleEl = document.getElementById('prev-title');
  var occ = customSelections.occasion || 'Birthday';
  var shape = customSelections.shape  || 'Rectangle';
  var theme = customSelections.theme  || 'Floral';
  if (titleEl) titleEl.textContent = occ + ' ' + shape + ' Slab';

  // Tags
  var tagsEl = document.getElementById('prev-tags');
  if (tagsEl) {
    var egg = customSelections.egg || 'Eggless';
    tagsEl.innerHTML =
      '<span style="font-size:10px;padding:2px 8px;border-radius:8px;background:rgba(107,47,206,.2);color:#C084FC">' + shape + '</span> '
    + '<span style="font-size:10px;padding:2px 8px;border-radius:8px;background:rgba(255,255,255,.07);color:#9F7ABA">' + theme + '</span> '
    + '<span style="font-size:10px;padding:2px 8px;border-radius:8px;background:' + (egg==='Eggless'?'rgba(34,197,94,.12)':'rgba(244,114,182,.12)') + ';color:' + (egg==='Eggless'?'#4ADE80':'#F472B6') + '">' + (egg==='Eggless'?'💚':'❤️') + ' ' + egg + '</span>';
  }

  // Serves
  var servesEl = document.getElementById('prev-serves');
  if (servesEl) servesEl.textContent = (customSelections.serves || '1 kg') + '  (~8–10 pcs)';

  // Price estimate — base + layers + topper + deco
  var priceEl = document.getElementById('prev-price');
  if (priceEl) {
    var egg2   = customSelections.egg    || 'Eggless';
    var srv    = customSelections.serves || '1 kg';
    var layers = customSelections.layers || '1';
    var topper = customSelections.topper || 'None';
    var Faux    = customSelections.Fauxball    || 'None';
    var butter = customSelections.butterfly  || 'None';
    var kg     = calcKg(srv);

    var base = (PRICE_MAP[egg2] || PRICE_MAP['Eggless'])[srv] || [900,1300];
    var layerAdd   = (LAYER_ADDON[layers]   || 0) * kg;
    var topperAdd  = TOPPER_ADDON[topper]   || 0;
    var FauxAdd     = FauxBALL_ADDON[Faux]     || 0;
    var butterAdd  = BUTTERFLY_ADDON[butter]|| 0;
    var extra      = layerAdd + topperAdd + FauxAdd + butterAdd;

    // Live loaded base price estimate
    var loadedBaseLive = 0;
    var fbvKey = customSelections.flavourBase || 'Plain';
    var fbvLiveMap = {
      'Plain':0, 'Nuts Loaded':80, 'Seeds Loaded':60,
      'Hazelnut Loaded':100, 'Walnut Loaded':90, 'Dark Choco Loaded':70
    };
    loadedBaseLive = (fbvLiveMap[fbvKey] || 0) * kg;

    var lo = Math.round(base[0] + extra + loadedBaseLive);
    var hi = Math.round(base[1] + extra + loadedBaseLive);

    // Build breakdown hint
    var parts = [];
    if (layerAdd)  parts.push((layers==='2'?'Double':'Triple')+' layer +₹'+Math.round(layerAdd));
    if (topperAdd) parts.push('Topper +₹'+topperAdd);
    if (FauxAdd)    parts.push('Faux ball +₹'+FauxAdd);
    if (butterAdd) parts.push('Butterfly +₹'+butterAdd);

    priceEl.innerHTML = 'Est. <strong style="color:var(--gold)">₹'+lo+' – ₹'+hi+'</strong>'
      + (parts.length ? '<br><span style="font-size:9px;color:var(--faint)">'+parts.join(' · ')+'</span>' : '');
  }

  // Similar references
  var simEl = document.getElementById('prev-similar');
  if (simEl) {
    var refs = SIMILAR_REFS[customSelections.occasion] || SIMILAR_REFS['Birthday'];
    var tc   = THEME_COLORS[customSelections.theme]    || THEME_COLORS['Floral'];
    simEl.innerHTML = refs.map(function(r, i) {
      return '<div style="flex-shrink:0;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);'
        + 'border-radius:10px;padding:8px 10px;text-align:center;min-width:72px">'
        + '<div style="width:32px;height:32px;border-radius:8px;background:' + (tc[i] || '#6B2FCE')
        + '1A;border:1px solid ' + (tc[i] || '#6B2FCE') + '55;margin:0 auto 5px;display:flex;align-items:center;justify-content:center;font-size:14px">'
        + r.split(' ')[0] + '</div>'
        + '<div style="font-size:9px;color:rgba(255,255,255,.5);line-height:1.3">' + r.split(' ').slice(1).join(' ') + '</div>'
        + '</div>';
    }).join('');
  }
}

function validateCustomDate(inp) {
  var minDate = new Date();
  minDate.setDate(minDate.getDate() + 7);
  var selected = new Date(inp.value);
  var msgEl = document.getElementById('custom-date-msg');
  if (inp.value && selected < minDate) {
    msgEl.style.display = 'block';
    inp.style.borderColor = 'var(--pink)';
  } else {
    msgEl.style.display = 'none';
    inp.style.borderColor = inp.value ? 'var(--p)' : 'var(--bdr)';
  }
}

async function submitCustomOrder() {

  // Require login to submit
  if (!currentUser || !currentUser.db_id) {
    showToast('Please sign in to submit your order 🍫');
    setTimeout(function(){ window.location.href = 'auth.html'; }, 1200);
    return;
  }
  
  // Check if editing existing order
  if (window._editingOrderId) {
    await updateCustomOrder();
    return;
  }

  var dateVal  = document.getElementById('custom-date').value;
  var msgVal   = document.getElementById('custom-message').value.trim();
  var notesVal = document.getElementById('custom-notes').value.trim();
  var topName  = (document.getElementById('topper-name') || {}).value || '';

  // ── VALIDATION ──
  var errors = [];

  var requiredGroups = [
    { key:'occasion', label:'Occasion' },
    { key:'theme',    label:'Theme' },
    { key:'serves',   label:'Weight / KG' },
    { key:'flavour',  label:'Flavour Base' },
    { key:'egg',      label:'Egg Preference' }
  ];

  requiredGroups.forEach(function(g) {
    if (!customSelections[g.key]) {
      errors.push(g.label);
      document.querySelectorAll('.cust-chip[data-group="' + g.key + '"]').forEach(function(c) {
        c.style.borderColor = 'var(--pink)';
        setTimeout(function(){ c.style.borderColor = 'var(--bdr)'; }, 2000);
      });
    }
  });

  var dateInp   = document.getElementById('custom-date');
  var dateMsgEl = document.getElementById('custom-date-msg');
  if (!dateVal) {
    errors.push('Delivery Date');
    dateInp.style.borderColor = 'var(--pink)';
    dateMsgEl.textContent     = '⚠️ Please select a delivery date';
    dateMsgEl.style.display   = 'block';
    setTimeout(function(){ dateInp.style.borderColor = 'var(--bdr)'; }, 2000);
  } else {
    var minDate = new Date(); minDate.setDate(minDate.getDate() + 7);
    if (new Date(dateVal) < minDate) {
      errors.push('Delivery Date (min 7 days)');
      dateInp.style.borderColor = 'var(--pink)';
      dateMsgEl.textContent     = '⚠️ Please select a date at least 7 days from today';
      dateMsgEl.style.display   = 'block';
      setTimeout(function(){ dateInp.style.borderColor = 'var(--bdr)'; }, 2000);
    } else {
      dateMsgEl.style.display = 'none';
    }
  }

  if (errors.length > 0) {
    showToast('⚠️ Please fill: ' + errors[0]);
    var firstMissing = requiredGroups.find(function(g){ return !customSelections[g.key]; });
    if (firstMissing) {
      var el = document.querySelector('.cust-chip[data-group="' + firstMissing.key + '"]');
      if (el) el.scrollIntoView({ behavior:'smooth', block:'center' });
    } else {
      dateInp.scrollIntoView({ behavior:'smooth', block:'center' });
    }
    return;
  }
  // ── END VALIDATION ──

  if (!currentUser || !currentUser.db_id) { showToast('Please log in to place an order'); return; }

  var btn = document.getElementById('custom-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Placing order...'; }

  var user    = currentUser || {};
  var dateStr = new Date(dateVal).toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' });

  // Get sequential order number from DB
  var orderNum = genOrderNum();

  // Calculate estimated price
  var egg2    = customSelections.egg    || 'Eggless';
  var srv     = customSelections.serves || '1 kg';
  var layers  = customSelections.layers || '1';
  var topper  = customSelections.topper || 'None';
  var Faux     = customSelections.Fauxball    || 'None';
  var butter  = customSelections.butterfly  || 'None';
  var kg      = calcKg(srv);
  var base    = (PRICE_MAP[egg2] || PRICE_MAP['Eggless'])[srv] || [900,1300];
  var extra   = (LAYER_ADDON[layers]||0)*kg + (TOPPER_ADDON[topper]||0) + (FauxBALL_ADDON[Faux]||0) + (BUTTERFLY_ADDON[butter]||0);
  var estTotal = Math.round((base[0]+base[1])/2 + extra);
   // ── Fetch loaded base price from Supabase ──
  var loadedBasePrice = 0;
  var loadedBase = customSelections.flavourBase || 'Plain';
  try {
    var { data: fbvRow } = await db
      .from('flavour_base_pricing')
      .select('price_per_kg')
      .eq('base_key', loadedBase)
      .eq('is_active', true)
      .single();
    if (fbvRow) loadedBasePrice = (fbvRow.price_per_kg || 0) * kg;
  } catch(e) { console.warn('flavour base price fetch:', e.message); }
  // Build detailed custom config JSON
  var customConfig = {
    type: 'custom_slab',
    occasion:      customSelections.occasion,
    shape:         customSelections.shape,
    theme:         customSelections.theme,
    weight:        srv,
    layers:        {'1':'Single','2':'Double','3':'Triple'}[layers] + ' layer',
    flavour:       customSelections.flavour,
    egg:           egg2,
    Fauxball:       Faux !== 'None' ? Faux : null,
    butterfly:     butter !== 'None' ? butter : null,
    topper:        topper !== 'None' ? topper + (customSelections.acrylicStyle && topper === 'Acrylic Topper' ? ' (' + customSelections.acrylicStyle + ')' : '') : null,
    topper_name:   topName || null,
    brownie_msg:   msgVal  || null,
    delivery_date: dateVal,
    special_notes: notesVal || null,
    est_price_lo:  base[0] + extra,
    est_price_hi:  base[1] + extra
  };

  // Insert order into DB
  var orderData = {
    order_number:      orderNum,
    customer_id:       user.db_id,
    customer_name:     user.name || 'Customer',
    customer_phone:    user.phone || '',
    customer_email:    user.email || null,
    delivery_address:  user.city  || 'To be confirmed',
    delivery_city:     user.city  || 'TBD',
    subtotal:          estTotal,
    topping_total:     extra,
    delivery_fee:      0,
    total:             estTotal,
    payment_method:    currentPayMethod,
    payment_status:    'pending',
    utr_number:        currentPayTab === 'upi'  ? currentUtrValue : null,
    amount_paid:       currentAdvanceMode === 'partial' ? Math.ceil(currentOrderTotal / 2) : (currentPayTab === 'cod' ? 0 : currentOrderTotal),
    balance_due:       currentAdvanceMode === 'partial' ? (currentOrderTotal - Math.ceil(currentOrderTotal / 2)) : (currentPayTab === 'cod' ? currentOrderTotal : 0),
    is_partial_payment: currentAdvanceMode === 'partial',
    status:            'pending',
    egg_preference:    egg2 === 'Eggless' ? 'eggless' : 'egg',
    special_notes:     'Custom slab order — see custom_orders table',
    is_custom:         true
  };

  try {
    var { data: ord, error: ordErr } = await db.from('orders').insert([orderData]).select('id,order_number').single();
    if (ordErr) throw ordErr;

    // Insert into custom_orders table
    var topperName = (document.getElementById('topper-name') || {}).value || '';
    var customRow = {
      order_id:        ord.id,
      customer_id:     user.db_id,
      occasion:        customSelections.occasion,
      loaded_base:     customSelections.flavourBase || 'Plain',
      loaded_base_price: loadedBasePrice,
      shape:           customSelections.shape,
      theme:           customSelections.theme,
      weight_kg:       customSelections.serves,
      layers:          {'1':'Single','2':'Double','3':'Triple'}[customSelections.layers] + ' layer',
      flavour:         customSelections.flavour,
      egg_preference:  egg2,
      faux_ball:        customSelections.Fauxball !== 'None' ? customSelections.Fauxball : null,
      drizzle:          customSelections.drizzle !== 'None' ? customSelections.drizzle : null,
      butterfly:       customSelections.butterfly !== 'None' ? customSelections.butterfly : null,
      topper_type:     customSelections.topper !== 'None' ? customSelections.topper : null,
      topper_style:    customSelections.topper === 'Acrylic Topper' ? customSelections.acrylicStyle : null,
      topper_name:     topperName || null,
      brownie_message: msgVal   || null,
      delivery_date:   dateVal,
      special_notes:   notesVal || null,
      est_price_lo:    base[0] + extra,
      est_price_hi:    base[1] + extra
    };
    var { error: customInsertError } = await db.from('custom_orders').insert([customRow]);
    if (customInsertError) console.error('custom_orders insert failed:', customInsertError.message);

    // Insert status history
    await db.from('order_status_history').insert([{
      order_id:    ord.id,
      from_status: null,
      to_status:   'pending',
      changed_by:  'customer',
      note:        'Custom slab enquiry placed'
    }]);

    // Send WhatsApp to NSDI
    var waMsg = encodeURIComponent(
      '🍫 *Custom Brownie Enquiry — ' + ord.order_number + '*\n\n'
      + '👤 ' + user.name + ' · ' + user.phone + '\n\n'
      + '🎉 Occasion: ' + customSelections.occasion + '\n'
      + '▬  Shape: ' + customSelections.shape + '\n'
      + '🎨 Theme: ' + customSelections.theme + '\n'
      + '⚖️ Weight: ' + srv + '\n'
      + '🍰 Layers: ' + customConfig.layers + '\n'
      + '🍫 Flavour: ' + customSelections.flavour + '\n'
      + (customSelections.flavourBase && customSelections.flavourBase !== 'Plain'
      ? '🥜 Loaded Base: ' + customSelections.flavourBase + '\n'
      : '')
      + '🥚 Egg: ' + egg2 + '\n'
      + '📅 Delivery: ' + dateStr + '\n'
      + (msgVal   ? '✍️ Brownie Msg: ' + msgVal + '\n' : '')
      + (Faux  !== 'None' ? '🟡 Faux Ball: ' + Faux + '\n' : '')
      + (customSelections.drizzle !== 'None' ? '🍫 Drizzle: ' + customSelections.drizzle + '\n' : '')
      + (butter !== 'None' ? '🦋 Butterfly: ' + butter + '\n' : '')
      + (topper !== 'None' ? '✨ Topper: ' + customConfig.topper + (topName ? ' — "'+topName+'"' : '') + '\n' : '')
      + (notesVal ? '📝 Notes: ' + notesVal + '\n' : '')
      + '\n💰 Est. ₹' + (base[0]+extra) + ' – ₹' + (base[1]+extra)
      + '\n\n_Order ID: ' + ord.order_number + ' · Pending your confirmation_'
    );

    window.open('https://wa.me/' + NSDI_PHONE + '?text=' + waMsg, '_blank');

    showToast('✅ Enquiry sent! Order #' + ord.order_number + ' placed!');
    setTimeout(function() {
      showPage('tracking');
    }, 2000);

  } catch(err) {
    showToast('Error: ' + (err.message || 'Could not place order'));
    console.error('Custom order error:', err);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '📲 Send Enquiry via WhatsApp'; }
  }
}

async function updateCustomOrder() {
  var orderId   = window._editingOrderId;
  var customId  = window._editingCustomId;
  var dateVal   = document.getElementById('custom-date').value;
  var msgVal    = document.getElementById('custom-message').value.trim();
  var notesVal  = document.getElementById('custom-notes').value.trim();
  var topName   = (document.getElementById('topper-name') || {}).value || '';

  if (!dateVal) { showToast('Please select a delivery date'); return; }

  var btn = document.getElementById('custom-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }

  var egg2   = customSelections.egg    || 'Eggless';
  var srv    = customSelections.serves || '1 kg';
  var layers = customSelections.layers || '1';
  var topper = customSelections.topper || 'None';
  var Faux    = customSelections.Fauxball    || 'None';
  var butter = customSelections.butterfly  || 'None';
  var kg     = calcKg(srv);
  var base   = (PRICE_MAP[egg2] || PRICE_MAP['Eggless'])[srv] || [900,1300];

   

    var extra  = (LAYER_ADDON[layers]||0)*kg 
              + (TOPPER_ADDON[topper]||0) 
              + (FauxBALL_ADDON[Faux]||0) 
              + (BUTTERFLY_ADDON[butter]||0)
              + loadedBasePrice;
  var customRow = {
    occasion:        customSelections.occasion,
    shape:           customSelections.shape,
    theme:           customSelections.theme,
    weight_kg:       srv,
    layers:          {'1':'Single','2':'Double','3':'Triple'}[layers] + ' layer',
    flavour:         customSelections.flavour,
    egg_preference:  egg2,
    Faux_ball:        Faux !== 'None' ? Faux : null,
    butterfly:       butter !== 'None' ? butter : null,
    topper_type:     topper !== 'None' ? topper : null,
    topper_style:    customSelections.topper === 'Acrylic Topper' ? customSelections.acrylicStyle : null,
    topper_name:     topName || null,
    brownie_message: msgVal || null,
    delivery_date:   dateVal,
    special_notes:   notesVal || null,
    est_price_lo:    base[0]+extra,
    est_price_hi:    base[1]+extra,
    last_edited_at:  new Date().toISOString()
  };

  try {
    if (customId) {
      var { error } = await db.from('custom_orders').update(customRow).eq('id', customId);
      if (error) throw error;
    } else {
      customRow.order_id = orderId;
      customRow.customer_id = currentUser.db_id;
      var { error } = await db.from('custom_orders').insert([customRow]);
      if (error) throw error;
    }

    // Log update in history
    await db.from('order_status_history').insert([{
      order_id: orderId, from_status: 'pending', to_status: 'pending',
      changed_by: 'customer', note: 'Customer updated custom order details'
    }]);

    // Reset edit mode
    window._editingOrderId  = null;
    window._editingCustomId = null;
    var btn2 = document.getElementById('custom-submit-btn');
    if (btn2) { btn2.disabled=false; btn2.textContent='📲 Send Enquiry via WhatsApp'; btn2.style.background=''; }

    showToast('✅ Order updated!');
    setTimeout(function() { loadAndShowOrders(); }, 800);

  } catch(err) {
    showToast('Error: ' + (err.message || 'Could not update'));
    if (btn) { btn.disabled=false; btn.textContent='💾 Update My Order'; }
  }
}

// Reset edit mode when leaving custom-order page
var _origShowPage = showPage;

// Set min date for custom order date picker
(function setMinDate() {
  var inp = document.getElementById('custom-date');
  if (inp) {
    var d = new Date(); d.setDate(d.getDate() + 7);
    inp.min = d.toISOString().split('T')[0];
  }
})();


async function loadCakeStudioConfig() {
  try {
    var [flavRes, frostRes, tierRes, sizeRes, weightRes, touchRes] = await Promise.all([
      db.from('cake_flavours').select('*').eq('is_active', true).order('sort_order'),
      db.from('cake_frostings').select('*').eq('is_active', true).order('sort_order'),
      db.from('cake_tiers').select('*').eq('is_active', true).order('sort_order'),
      db.from('cake_sizes').select('*').eq('is_active', true).order('sort_order'),
      db.from('cake_weights').select('*').eq('is_active', true).order('sort_order'),
      db.from('cake_finishing_touches').select('*').eq('is_active', true).order('sort_order'),
    ]);

    var flavours = flavRes.data || [];
    var frostings = frostRes.data || [];
    var tiers = tierRes.data || [];
    var sizes = sizeRes.data || [];
    var weights = weightRes.data || [];
    var touches = touchRes.data || [];

    // ── FLAVOURS ──
    var flavEl = document.getElementById('cs-flavours');
    if (flavEl && flavours.length > 0) {
      flavEl.innerHTML = flavours.map(function(f, i) {
        var tags = (f.tags || []).map(function(t){ return '<span class="ftag">' + t + '</span>'; }).join('');
        var isActive = i === 0;
        if (isActive) { S.flavor = f.key; }
        return '<div class="fcard' + (isActive ? ' active' : '') + '" data-f="' + f.key + '" onclick="setFlavor(\'' + f.key + '\')">'
          + '<div class="fcard-head"><div class="fswatch"></div><div>'
          + '<div class="ftitle">' + f.name + '</div>'
          + '</div></div>'
          + '<div class="fdesc">' + (f.description || '') + '</div>'
          + '</div>';
      }).join('');

      // Apply fcard CSS per key
      flavours.forEach(function(f) {
        var el = document.querySelector('.fcard[data-f="' + f.key + '"]');
        if (el) {
          var accent = f.key === 'vanilla' ? '#c9a040' : '#c04070';
          el.style.setProperty('--card-accent', accent);
        }
      });

      // Apply fswatch gradient per key
      document.querySelectorAll('.fcard[data-f="vanilla"] .fswatch').forEach(function(s) {
        s.style.background = 'radial-gradient(circle at 35% 35%,#f8efc8,#d4a050 55%,#8a5818)';
      });
      document.querySelectorAll('.fcard[data-f="chocberry"] .fswatch').forEach(function(s) {
        s.style.background = 'radial-gradient(circle at 35% 35%,#702020,#3a0e0e 55%,#1a0508)';
      });
    }

    // ── FROSTINGS ──
    var frostEl = document.getElementById('cs-frostings');
    if (frostEl && frostings.length > 0) {
      frostEl.innerHTML = frostings.map(function(f, i) {
        var isActive = i === 0;
        var hexNum = parseInt((f.hex_color || '#f5f0e8').replace('#', ''), 16);
        if (isActive) { S.frostCol = hexNum; S.frostType = f.key; }
        return '<button class="fbtn' + (isActive ? ' active' : '') + '" onclick="setFrost(this,\'' + f.key + '\',' + hexNum + ')">'
          + '<div class="frost-swatch" style="background:' + (f.swatch_css || 'radial-gradient(circle at 38% 32%,#fff8f0,#ede0c8 55%,#d0bea0)') + '"></div>'
          + '<div class="frost-name">' + f.name.replace(' ', '<br>') + '</div>'
          + '</button>';
      }).join('');
    }

    // ── TIERS ──
    var tierEl = document.getElementById('cs-tiers');
    if (tierEl && tiers.length > 0) {
      tierEl.innerHTML = tiers.map(function(t, i) {
        var isActive = i === 0;
        if (isActive) { S.tiers = t.count; }
        var icon = t.count === 1 ? '▬' : t.count === 2 ? '▬▬' : '▬▬▬';
        return '<button class="pill' + (isActive ? ' active' : '') + '" onclick="setTiers(this,' + t.count + ')">'
          + '<span class="pill-icon">' + icon + '</span>' + t.label
          + '</button>';
      }).join('');
    }

    // ── SIZES ──
    var sizeEl = document.getElementById('cs-sizes');
    if (sizeEl && sizes.length > 0) {
      // Default active = middle size
      var activeIdx = Math.floor(sizes.length / 2);
      sizeEl.innerHTML = sizes.map(function(s, i) {
        var isActive = i === activeIdx;
        if (isActive) { S.size = s.inches; S.basePrice = s.base_price; }
        return '<button class="pill' + (isActive ? ' active' : '') + '" onclick="setSize(this,' + s.inches + ',' + s.base_price + ')">'
          + '<div class="pill-big">' + s.label + '</div>'
          + '<div class="pill-sub">' + s.serves_min + '–' + s.serves_max + ' pax</div>'
          + '</button>';
      }).join('');
    }

    // ── WEIGHTS ──
    var weightEl = document.getElementById('cs-weights');
    if (weightEl && weights.length > 0) {
      // Default active = 1kg
      var activeWIdx = weights.findIndex(function(w){ return w.key === '1kg'; });
      if (activeWIdx < 0) activeWIdx = 1;
      sizeEl && sizeEl; // no-op
      weightEl.innerHTML = weights.map(function(w, i) {
        var isActive = i === activeWIdx;
        if (isActive) { S.weight = w.key; S.weightExtra = w.extra_price; }
        var bigLabel = w.key.replace('kg','').replace('0.5','½');
        return '<button class="pill' + (isActive ? ' active' : '') + '" onclick="setWeight(this,\'' + w.key + '\',' + w.extra_price + ')">'
          + '<div class="pill-big">' + bigLabel + '</div>'
          + '<div class="pill-sub">' + w.key + '</div>'
          + '</button>';
      }).join('');
    }

    // ── FINISHING TOUCHES ──
    var touchEl = document.getElementById('cs-touches');
    if (touchEl && touches.length > 0) {
      var touchHtml = touches.map(function(t) {
        if (t.key === 'toys') {
          return '<button class="tchip" id="toy-btn" data-k="toys" onclick="toggleToys(this)">🧸 ' + t.name + '</button>'
            + '<div class="toy-sub" id="toy-sub">'
            + '<div class="toy-sub-lbl">Choose Theme</div>'
            + '<button class="topt" onclick="pickToy(this,\'Car\')">🚗 Car</button>'
            + '<button class="topt" onclick="pickToy(this,\'Animals\')">🦁 Animals</button>'
            + '<button class="topt" onclick="pickToy(this,\'Avengers\')">⚡ Avengers</button>'
            + '<button class="topt" onclick="pickToy(this,\'Princess\')">👑 Princess</button>'
            + '<button class="topt" onclick="pickToy(this,\'Dinosaur\')">🦕 Dinosaur</button>'
            + '<button class="topt" onclick="pickToy(this,\'Unicorn\')">🦄 Unicorn</button>'
            + '</div>';
        }
        if (t.key === 'sprinkles') {
          return '<button class="tchip" id="sprinkle-btn" data-k="sprinkles" onclick="toggleSprinkles(this)">✨ ' + t.name + '</button>'
            + '<div class="toy-sub" id="sprinkle-sub">'
            + '<div class="toy-sub-lbl">Sprinkle Colour</div>'
            + '<button class="sopt topt active" onclick="pickSprinkle(this,0xd4a820)">✦ Gold</button>'
            + '<button class="sopt topt" onclick="pickSprinkle(this,0xc8c8d0)">◆ Silver</button>'
            + '<button class="sopt topt" onclick="pickSprinkle(this,0xffffff)">◆ White</button>'
            + '<button class="sopt topt" onclick="pickSprinkle(this,0x60a8e0)">◆ Blue</button>'
            + '<button class="sopt topt" onclick="pickSprinkle(this,0xe04040)">◆ Red</button>'
            + '</div>';
        }
        var EMOJIS = { goldLeaf:'✦', fauxBalls:'🟡', chocDrips:'🍫', hbd:'🎂', flowers:'🌸', sprinkles:'✨', toys:'🧸' };
        var cost = t.extra_price || 0;
        return '<button class="tchip" data-k="' + t.key + '" onclick="setTouch(this,\'' + t.key + '\',' + cost + ')">'
          + (EMOJIS[t.key] || '') + ' ' + t.name
          + '</button>';
      }).join('');
      touchEl.innerHTML = touchHtml;
    }

    // Recalculate price with loaded values
    calcPrice();
    console.log('✅ Cake studio config loaded from Supabase');

  } catch(e) {
    console.warn('loadCakeStudioConfig error:', e.message);
  }
}



// ══════════════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════════════
const S = {
  flavor:'vanilla', frostCol:0xfff0e0, frostType:'fresh',
  tiers:1, size:8, basePrice:1000, qty:1, extras:0,
  weight:'1kg', weightExtra:200,
  touches: new Set(),
  toyOn:false, toy:null,
  sprinkleOn:false, sprinkleCol:0xd4a820,
  cakeName:'', namePlacement:'top'
};

function setWeight(btn, w, extra) {
  S.weight = w;
  S.weightExtra = extra; // kept for fallback
  btn.parentElement.querySelectorAll('.pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  calcPrice();
}

function calcPrice() {
  // ── Dynamic price from Supabase PRICE_MAP ──
  var egg2   = (S.eggType === 'egg') ? 'With Egg' : 'Eggless';
  var weight = S.weight || '1 kg';

  // Map cake studio weight keys to PRICE_MAP keys
  var weightMap = {
    '0.5kg': '0.5 kg',
    '1kg':   '1 kg',
    '1.5kg': '1.5 kg',
    '2kg':   '2 kg',
    '3kg':   '3 kg',
    '5kg':   '5 kg+'
  };
  var priceKey = weightMap[weight] || weight;

  // Get base price range from dynamic map
  var eggMap   = (PRICE_MAP && PRICE_MAP[egg2]) ? PRICE_MAP[egg2] : {};
  var base     = eggMap[priceKey] || [900, 1300];
  var midPrice = Math.round((base[0] + base[1]) / 2);

  // Tier multiplier
  var tm = S.tiers === 1 ? 1 : S.tiers === 2 ? 1.8 : 2.6;

  // Final price
  var total = Math.round(midPrice * tm * S.qty + (S.extras || 0));
  document.getElementById('pnum').textContent = total;
}

function setFlavor(f){
  S.flavor=f;
  document.querySelectorAll('.fcard').forEach(c=>c.classList.remove('active'));
  document.querySelector(`[data-f="${f}"]`).classList.add('active');
  const el=document.getElementById('clabel');
  el.classList.add('out');
  setTimeout(()=>{ el.textContent=f==='vanilla'?'Vanilla Pineapple':'Chocolate Strawberry'; el.classList.remove('out'); },400);
  rebuild();
}

function setFrost(btn,type,col){
  S.frostType=type; S.frostCol=col;
  document.querySelectorAll('.fbtn').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  rebuild();
}

function setTiers(btn,t){ S.tiers=t; document.querySelectorAll('.pill-row:nth-of-type(1) .pill').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); rebuild(); calcPrice(); }

// Use separate selectors for tier and size pill rows
function setTiersBtn(btn,t){ S.tiers=t; btn.parentElement.querySelectorAll('.pill').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); rebuild(); calcPrice(); }
function setSizeBtn(btn,s,p){ S.size=s; S.basePrice=p; btn.parentElement.querySelectorAll('.pill').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); rebuild(); calcPrice(); }

function setSize(btn,s,p){ S.size=s; S.basePrice=p; btn.parentElement.querySelectorAll('.pill').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); rebuild(); calcPrice(); }
function setTiers(btn,t){ S.tiers=t; btn.parentElement.querySelectorAll('.pill').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); rebuild(); calcPrice(); }

function setQty(d){ S.qty=Math.max(1,Math.min(20,S.qty+d)); document.getElementById('qval').textContent=S.qty; calcPrice(); }

function setTouch(btn,k,cost){
  btn.classList.toggle('active');
  if(btn.classList.contains('active')){ S.touches.add(k); S.extras+=cost; }
  else{ S.touches.delete(k); S.extras-=cost; }
  rebuild(); calcPrice();
}

function toggleToys(btn){
  S.toyOn=!S.toyOn; btn.classList.toggle('active',S.toyOn);
  document.getElementById('toy-sub').classList.toggle('on',S.toyOn);
  if(S.toyOn){ S.touches.add('toys'); S.extras+=150; }
  else{ S.touches.delete('toys'); S.extras-=150; S.toy=null; document.querySelectorAll('.topt').forEach(o=>o.classList.remove('active')); }
  rebuild(); calcPrice();
}
function pickToy(btn,t){ document.querySelectorAll('.topt').forEach(o=>o.classList.remove('active')); btn.classList.add('active'); S.toy=t; }
function setName(val){
  S.cakeName=val.trim();
  document.getElementById('name-cc').textContent=val.length+'/18';
  rebuild();
}
function setPlacement(btn,p){
  S.namePlacement=p;
  document.querySelectorAll('.pplace').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  rebuild();
}
function toggleSprinkles(btn){
  S.sprinkleOn=!S.sprinkleOn; btn.classList.toggle('active',S.sprinkleOn);
  document.getElementById('sprinkle-sub').classList.toggle('on',S.sprinkleOn);
  if(S.sprinkleOn){ S.touches.add('sprinkles'); S.extras+=40; }
  else{ S.touches.delete('sprinkles'); S.extras-=40; document.querySelectorAll('.sopt').forEach(o=>o.classList.remove('active')); }
  rebuild(); calcPrice();
}
function pickSprinkle(btn,col){
  document.querySelectorAll('.sopt').forEach(o=>o.classList.remove('active'));
  btn.classList.add('active'); S.sprinkleCol=col; rebuild();
}

function addCart(){
  // ── Validate delivery date ──
  var dateInp = document.getElementById('cake-delivery-date');
  var dateErr = document.getElementById('cake-date-err');
  var dateVal = dateInp ? dateInp.value : '';
  var minDate = new Date(); minDate.setDate(minDate.getDate() + 7);
  if (!dateVal || new Date(dateVal) < minDate) {
    if (dateErr) { dateErr.style.display = 'block'; }
    if (dateInp) {
      dateInp.style.borderColor = '#ff6b6b';
      dateInp.scrollIntoView({ behavior:'smooth', block:'center' });
      setTimeout(function(){ dateInp.style.borderColor = 'var(--border)'; }, 2000);
    }
    showToast('⚠️ Please select a delivery date (min 7 days)');
    return;
  }
  if (dateErr) dateErr.style.display = 'none';

  // ── Build cart item ──
  var label = S.tiers + '-tier ' + (S.flavor==='vanilla'?'Vanilla Pineapple':'Choc Strawberry')
            + ' Cake · ' + S.weight + ' · ' + S.frostType;
  cartItems.push({
    product_name:  'Custom Cake — ' + (S.flavor==='vanilla'?'Vanilla Pineapple':'Chocolate Strawberry'),
    name:          'Custom Cake',
    tier:          'couverture',
    egg:           'eggless',
    egg_type:      'eggless',
    pack:          S.weight + ' · ' + S.tiers + ' tier',
    pack_label:    S.weight,
    qty:           S.qty,
    quantity:      S.qty,
    base_price:    parseInt(document.getElementById('pnum').textContent),
    topping_price: 0,
    toppings:      [...S.touches],
    line_total:    parseInt(document.getElementById('pnum').textContent) * S.qty,
    sku:           'CUSTOM-CAKE-' + S.flavor.toUpperCase(),
    product_type:  'custom_cake',
    delivery_date: dateVal,
    cake_config:   JSON.stringify(S)
  });

  renderCart();

  var badge = document.getElementById('cart-badge');
  if (badge) { badge.classList.add('bump'); setTimeout(function(){ badge.classList.remove('bump'); }, 200); }

  var t = document.getElementById('toast');
  t.textContent = '🎂 Cake added to cart!';
  t.classList.add('show');
  setTimeout(function(){ t.classList.remove('show'); }, 2500);

  setTimeout(function(){ showPage('cart'); }, 1200);
}

// ══════════════════════════════════════════════════════
//  PARTICLES
// ══════════════════════════════════════════════════════
(function(){
  const c=document.getElementById('pts');
  if(!c) return;
  const ctx=c.getContext('2d');
  let W,H,p=[];
  const rs=()=>{W=c.width=innerWidth;H=c.height=innerHeight;}
  const mk=()=>{p=Array.from({length:35},()=>({x:Math.random()*W,y:Math.random()*H,r:Math.random()*1.2+0.3,vx:(Math.random()-0.5)*0.12,vy:-(Math.random()*0.16+0.04),a:Math.random()*0.18+0.04}));}
  const tick=()=>{ctx.clearRect(0,0,W,H);p.forEach(d=>{d.x+=d.vx;d.y+=d.vy;if(d.y<-4){d.y=H+4;d.x=Math.random()*W;}ctx.beginPath();ctx.arc(d.x,d.y,d.r,0,Math.PI*2);ctx.fillStyle=`rgba(170,120,30,${d.a})`;ctx.fill();});requestAnimationFrame(tick);}
  window.addEventListener('resize',()=>{rs();mk();}); rs();mk();tick();
})();

// ══════════════════════════════════════════════════════
//  THREE.JS
// ══════════════════════════════════════════════════════
let renderer,scene,camera,cakeGrp;
let drag=false,prev={x:0,y:0},ry=0.4,rx=0.08,ty=0.4,tx=0.08;

const FL={
  vanilla:{ sponge:0xe8d090, filling:0xfffae0, drizzle:0xd4a040,
            deco:[0xffe870,0x4a9a3a,0xf5c842],
            fogCol:0x1a0c04, l1:0xffe8a0, l2:0xa0c860 },
  chocberry:{ sponge:0x2a0d0d, filling:0xe04870, drizzle:0x180608,
              deco:[0xe03060,0xff5080,0xc01040],
              fogCol:0x120508, l1:0xffb0c0, l2:0xff80a0 }
};

function initGL(){
  const cv=document.getElementById('cake-canvas');
  if (!cv) { console.warn('cake-canvas not found, retrying...'); setTimeout(initGL, 200); return; }
  const wrap = document.querySelector('.canvas-wrap');
  if (!wrap || wrap.clientWidth === 0 || wrap.clientHeight === 0) {
    console.warn('canvas-wrap has zero size, retrying...');
    setTimeout(initGL, 200);
    return;
  }
  renderer=new THREE.WebGLRenderer({canvas:cv,antialias:true,alpha:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,2));
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure=1.3;

  scene=new THREE.Scene();
  scene.fog=new THREE.FogExp2(0x1a0c04,0.038);

  camera=new THREE.PerspectiveCamera(36,1,0.1,40);
  camera.position.set(0,1.8,7);
  camera.lookAt(0,0.4,0);

  // Lights
  scene.add(new THREE.AmbientLight(0xffe8c0,0.28));
  const key=new THREE.DirectionalLight(0xffe8a0,2.2);
  key.position.set(4,6,5); key.castShadow=true; key.shadow.mapSize.set(1024,1024); scene.add(key);
  const fill=new THREE.DirectionalLight(0xfff0c0,0.85);
  fill.position.set(-3,3,2); scene.add(fill);
  const rim=new THREE.DirectionalLight(0xffeedd,0.55);
  rim.position.set(0,2,-5); scene.add(rim);

  rebuild(); onResize(); loop();
  window.addEventListener('resize',onResize);

  cv.addEventListener('mousedown',e=>{drag=true;prev={x:e.clientX,y:e.clientY};});
  window.addEventListener('mouseup',()=>drag=false);
  window.addEventListener('mousemove',e=>{if(!drag)return;ty+=(e.clientX-prev.x)*0.013;tx+=(e.clientY-prev.y)*0.009;tx=Math.max(-0.55,Math.min(0.65,tx));prev={x:e.clientX,y:e.clientY};});
  cv.addEventListener('touchstart',e=>{drag=true;prev={x:e.touches[0].clientX,y:e.touches[0].clientY};},{passive:true});
  window.addEventListener('touchend',()=>drag=false);
  window.addEventListener('touchmove',e=>{if(!drag)return;ty+=(e.touches[0].clientX-prev.x)*0.013;tx+=(e.touches[0].clientY-prev.y)*0.009;tx=Math.max(-0.55,Math.min(0.65,tx));prev={x:e.touches[0].clientX,y:e.touches[0].clientY};},{passive:true});
  cv.addEventListener('wheel',e=>{camera.position.z=Math.max(3.5,Math.min(11,camera.position.z+e.deltaY*0.009));},{passive:true});
}

function mkMat(col,rough,metal,opts){
  return new THREE.MeshStandardMaterial(Object.assign({color:col,roughness:rough,metalness:metal||0},opts||{}));
}

// Canvas rounded rect helper
function roundRect(ctx,x,y,w,h,r){
  ctx.beginPath();
  ctx.moveTo(x+r,y);
  ctx.lineTo(x+w-r,y); ctx.quadraticCurveTo(x+w,y,x+w,y+r);
  ctx.lineTo(x+w,y+h-r); ctx.quadraticCurveTo(x+w,y+h,x+w-r,y+h);
  ctx.lineTo(x+r,y+h); ctx.quadraticCurveTo(x,y+h,x,y+h-r);
  ctx.lineTo(x,y+r); ctx.quadraticCurveTo(x,y,x+r,y);
  ctx.closePath();
}

function rebuild(){
  if(cakeGrp) scene.remove(cakeGrp);
  cakeGrp=new THREE.Group();

  const f=FL[S.flavor];
  const R={6:1.0,8:1.3,10:1.6}[S.size]||1.3;
  const cfgs=[{r:R,h:0.9},{r:R*0.72,h:0.85},{r:R*0.5,h:0.8}].slice(0,S.tiers);
  let yOff=0, topInfo=null;

  cfgs.forEach((tc,ti)=>{
    const lg=new THREE.Group();

    // — Sponge 1
    const sGeo=new THREE.CylinderGeometry(tc.r,tc.r,tc.h*0.38,48);
    const sMat=mkMat(f.sponge,0.88);
    const s1=new THREE.Mesh(sGeo,sMat); s1.castShadow=true; lg.add(s1);

    // — Filling ring (visible between sponges)
    const fillGeo=new THREE.CylinderGeometry(tc.r+0.04,tc.r+0.04,0.1,48);
    const fillEmissive=S.flavor==='chocberry'?new THREE.Color(0x2a0010):new THREE.Color(0x000000);
    const fillMat=mkMat(f.filling,0.42,0.02,{emissive:fillEmissive,emissiveIntensity:S.flavor==='chocberry'?0.2:0});
    const fillMesh=new THREE.Mesh(fillGeo,fillMat);
    fillMesh.position.set(0, tc.h*0.38/2+0.05, 0);
    lg.add(fillMesh);

    // — Sponge 2
    const s2=new THREE.Mesh(sGeo.clone(),sMat.clone());
    s2.position.set(0, tc.h*0.38+0.1, 0); s2.castShadow=true; lg.add(s2);

    // — Outer frosting shell
    const frRough=S.frostType==='fresh'?0.52:S.frostType==='choc'?0.34:0.22;
    const frMetal=S.frostType==='fresh'?0.02:0.12;
    const frMat=mkMat(S.frostCol,frRough,frMetal,{side:THREE.DoubleSide});
    const frGeo=new THREE.CylinderGeometry(tc.r+0.05,tc.r+0.05,tc.h*0.88,48,1,true);
    const frost=new THREE.Mesh(frGeo,frMat);
    frost.position.set(0, tc.h*0.88/2-0.02, 0); frost.castShadow=true; lg.add(frost);

    // — Top cap (organic bumpy surface)
    const capGeo=new THREE.CylinderGeometry(tc.r+0.045,tc.r+0.05,0.1,48,4);
    const capPos=capGeo.attributes.position;
    for(let i=0;i<capPos.count;i++){
      if(capPos.getY(i)>0.03){
        capPos.setX(i,capPos.getX(i)+(Math.random()-0.5)*0.04);
        capPos.setZ(i,capPos.getZ(i)+(Math.random()-0.5)*0.04);
        capPos.setY(i,capPos.getY(i)+Math.random()*0.045);
      }
    }
    capPos.needsUpdate=true; capGeo.computeVertexNormals();
    const capMesh=new THREE.Mesh(capGeo,frMat.clone());
    capMesh.position.set(0, tc.h*0.88+0.03, 0); lg.add(capMesh);

    // ── THICK GOLD DRIPS (TubeGeometry — matches real ganache drips in photo)
    const dripActive = S.touches.has('chocDrips');
    const dripCol  = dripActive ? 0xc9860a : f.drizzle;
    const dripCount= dripActive ? 16 : 7;
    const dripMat  = mkMat(dripCol, 0.18, 0.55, {emissive:new THREE.Color(dripActive?0x7a4000:0x3a2000), emissiveIntensity:0.3});
    for(let d=0;d<dripCount;d++){
      const angle=(d/dripCount)*Math.PI*2 + (Math.random()-0.5)*0.18;
      const dripLen=0.28+Math.random()*0.42;
      const thick=dripActive?(0.022+Math.random()*0.024):(0.009+Math.random()*0.009);
      const curve=new THREE.CatmullRomCurve3([
        new THREE.Vector3(Math.cos(angle)*(tc.r+0.04), tc.h*0.87,           Math.sin(angle)*(tc.r+0.04)),
        new THREE.Vector3(Math.cos(angle)*(tc.r+0.05), tc.h*0.87-dripLen*0.4, Math.sin(angle)*(tc.r+0.05)),
        new THREE.Vector3(Math.cos(angle)*(tc.r+0.05), tc.h*0.87-dripLen*0.85,Math.sin(angle)*(tc.r+0.05)),
        new THREE.Vector3(Math.cos(angle)*(tc.r+0.04), tc.h*0.87-dripLen,    Math.sin(angle)*(tc.r+0.04)),
      ]);
      const tube=new THREE.Mesh(new THREE.TubeGeometry(curve,10,thick,8,false),dripMat.clone());
      // Drip bulb at bottom
      const bulb=new THREE.Mesh(new THREE.SphereGeometry(thick*1.6,8,6),dripMat.clone());
      bulb.position.set(Math.cos(angle)*(tc.r+0.045), tc.h*0.87-dripLen, Math.sin(angle)*(tc.r+0.045));
      lg.add(tube); lg.add(bulb);
    }

    // ── GOLD SPLATTER DOTS (always on, matches real cake)
    const splatterMat=mkMat(0xd4a820,0.08,0.9,{emissive:new THREE.Color(0x886000),emissiveIntensity:0.4});
    for(let i=0;i<40;i++){
      const angle=Math.random()*Math.PI*2;
      const onSide=Math.random()>0.4;
      const sz=0.006+Math.random()*0.012;
      const sp=new THREE.Mesh(new THREE.SphereGeometry(sz,7,6),splatterMat.clone());
      if(onSide){
        const yy=Math.random()*tc.h*0.82;
        sp.position.set(Math.cos(angle)*(tc.r+0.055), yy, Math.sin(angle)*(tc.r+0.055));
      } else {
        const rr=Math.random()*tc.r*0.85;
        sp.position.set(Math.cos(angle)*rr, tc.h*0.92+sz, Math.sin(angle)*rr);
      }
      lg.add(sp);
    }

    // — Gold cake board (bottom tier only) + name letter blocks
    if(ti===0){
      const boardR=tc.r+0.24;
      const board=new THREE.Mesh(
        new THREE.CylinderGeometry(boardR,boardR,0.055,64),
        mkMat(0xc8a030,0.28,0.55)
      );
      board.position.set(0,-0.07,0); board.receiveShadow=true; lg.add(board);

      // Name letter blocks around base board perimeter (matches "KAARMUGI LAN" in photo)
      if(S.cakeName && S.namePlacement==='board'){
        const letters=S.cakeName.toUpperCase().replace(/\s/g,'');
        const letterCount=Math.min(letters.length,20);
        const blockSize=0.095;
        const boardPerim=2*Math.PI*boardR;
        const spacing=Math.min(boardPerim/letterCount, blockSize*1.5);
        const totalArc=(spacing*letterCount)/boardR;
        const startAngle=-totalArc/2;
        for(let li=0;li<letterCount;li++){
          const a=startAngle+(li+0.5)*(totalArc/letterCount);
          const bx=Math.cos(a)*boardR;
          const bz=Math.sin(a)*boardR;
          // Block (dark chocolate)
          const block=new THREE.Mesh(
            new THREE.BoxGeometry(blockSize,blockSize*0.9,blockSize),
            mkMat(0x1e0a04,0.7,0.05)
          );
          block.position.set(bx, -0.02, bz);
          block.rotation.y=-a;
          lg.add(block);
          // Letter canvas texture
          const lc=document.createElement('canvas'); lc.width=64; lc.height=64;
          const lx=lc.getContext('2d');
          lx.fillStyle='#9060c0'; lx.font='bold 36px Georgia'; lx.textAlign='center'; lx.textBaseline='middle';
          lx.fillText(letters[li],32,34);
          const ltex=new THREE.CanvasTexture(lc);
          const lface=new THREE.Mesh(new THREE.PlaneGeometry(blockSize*0.85,blockSize*0.8),new THREE.MeshStandardMaterial({map:ltex,transparent:true,roughness:0.5}));
          lface.position.set(bx+Math.cos(a)*blockSize*0.52, -0.02, bz+Math.sin(a)*blockSize*0.52);
          lface.rotation.y=-a;
          lg.add(lface);
        }
      }
    }

    lg.position.set(0,yOff,0);
    if(ti===cfgs.length-1) topInfo={lg,tc,topY:tc.h*0.93};

    // ── TIER JUNCTION BALLS (scattered at each tier join, like photo)
    if(ti>0 && S.touches.has('fauxBalls')){
      const junctY=yOff-0.06;
      const junctCnt=Math.round(tc.r*14);
      const jCols=[{c:0xd4a820,r:0.1,m:0.7},{c:0xf5f0ea,r:0.2,m:0.1}];
      for(let i=0;i<junctCnt;i++){
        const angle=(i/junctCnt)*Math.PI*2+(Math.random()-0.5)*0.4;
        const pick=jCols[Math.floor(Math.random()*jCols.length)];
        const sz=0.04+Math.random()*0.05;
        const jm=new THREE.Mesh(new THREE.SphereGeometry(sz,12,10),mkMat(pick.c,pick.r,pick.m));
        jm.position.set(Math.cos(angle)*(tc.r+0.06), junctY+sz, Math.sin(angle)*(tc.r+0.06));
        jm.castShadow=true; cakeGrp.add(jm);
      }
    }

    yOff+=tc.h*0.9+0.06;
    cakeGrp.add(lg);
  });

  // ━━ TOP TIER DECORATIONS ━━━━━━━━━━━━━━━━━━━━━━━━━━
  if(topInfo){
    const {lg,tc,topY}=topInfo;
    const flav=FL[S.flavor];

    // Base flavour deco (fruit on top)
    if(S.flavor==='vanilla'){
      for(let d=0;d<5;d++){
        const angle=(d/5)*Math.PI*2;
        const m=new THREE.Mesh(new THREE.BoxGeometry(0.1,0.09,0.1),mkMat(flav.deco[d%3],0.5));
        m.position.set(Math.cos(angle)*(tc.r*0.6), topY+0.1, Math.sin(angle)*(tc.r*0.6));
        m.rotation.y=Math.random(); lg.add(m);
      }
    } else {
      const pool=new THREE.Mesh(new THREE.CylinderGeometry(tc.r*0.44,tc.r*0.44,0.022,36),mkMat(0xc02040,0.3,0,{transparent:true,opacity:0.75}));
      pool.position.set(0, topY+0.04, 0); lg.add(pool);
      for(let d=0;d<5;d++){
        const angle=(d/5)*Math.PI*2;
        const m=new THREE.Mesh(new THREE.SphereGeometry(0.09+Math.random()*0.03,12,8),mkMat(flav.deco[d%3],0.4));
        m.position.set(Math.cos(angle)*(tc.r*0.58), topY+0.1, Math.sin(angle)*(tc.r*0.58));
        m.castShadow=true; lg.add(m);
      }
    }

    // ── FRESH FRUIT
    if(S.touches.has('freshFruit')){
      const fc=[0xff4040,0xff6030,0xffd700,0x44cc44,0xff69b4,0xff8844];
      for(let i=0;i<8;i++){
        const angle=(i/8)*Math.PI*2+0.35;
        const m=new THREE.Mesh(new THREE.SphereGeometry(0.07+Math.random()*0.04,10,8),mkMat(fc[i%fc.length],0.35,0.03));
        m.position.set(Math.cos(angle)*(tc.r*0.52), topY+0.13+Math.random()*0.05, Math.sin(angle)*(tc.r*0.52));
        m.castShadow=true; lg.add(m);
      }
    }

    // ── FAUX BALLS — clustered like real cake photo (gold + white, grouped not ringed)
    if(S.touches.has('fauxBalls')){
      // Main cluster: dense group on back-right of top (like photo)
      const clusterAngle=Math.PI*0.35; // offset angle for cluster
      const goldMat =mkMat(0xd4a820,0.06,0.88,{emissive:new THREE.Color(0x886000),emissiveIntensity:0.3});
      const whiteMat=mkMat(0xf5f0ea,0.15,0.08,{emissive:new THREE.Color(0x222222),emissiveIntensity:0.1});
      const ballDefs=[
        // [r, offsetX, offsetZ, height, isGold]
        [0.14,  0.0,   0.0,  0.16, true ],  // big gold centre
        [0.11,  0.18,  0.04, 0.12, false],  // white
        [0.12, -0.12,  0.08, 0.13, false],  // white
        [0.10,  0.10, -0.14, 0.11, true ],  // gold
        [0.09, -0.18, -0.06, 0.10, false],  // white
        [0.07,  0.22, -0.08, 0.08, true ],  // small gold
        [0.06, -0.06,  0.20, 0.07, false],  // small white
        [0.08,  0.0,  -0.22, 0.09, true ],  // gold
        [0.05,  0.28,  0.08, 0.06, false],  // tiny white
        [0.06, -0.26,  0.10, 0.07, true ],  // tiny gold
      ];
      const cx=Math.cos(clusterAngle)*(tc.r*0.55);
      const cz=Math.sin(clusterAngle)*(tc.r*0.55);
      ballDefs.forEach(([r,ox,oz,h,isGold])=>{
        const bm=new THREE.Mesh(new THREE.SphereGeometry(r,14,12),isGold?goldMat.clone():whiteMat.clone());
        bm.position.set(cx+ox, topY+h, cz+oz);
        bm.castShadow=true; lg.add(bm);
      });
      // Scattered few around edge (like photo shows some on sides)
      const edgePts=[[0.6,Math.PI*1.1],[0.5,Math.PI*1.6],[0.65,Math.PI*0.8]];
      edgePts.forEach(([frac,ang])=>{
        const isGold=Math.random()>0.5;
        const r=0.06+Math.random()*0.05;
        const em=new THREE.Mesh(new THREE.SphereGeometry(r,12,10),isGold?goldMat.clone():whiteMat.clone());
        em.position.set(Math.cos(ang)*(tc.r*frac), topY+r, Math.sin(ang)*(tc.r*frac));
        em.castShadow=true; lg.add(em);
      });
    }

    // ── GOLD LEAF FANS (like photo — geometric gold fan shapes on sides of cake)
    if(S.touches.has('goldLeaf')){
      const fanMat=mkMat(0xd4a820,0.05,0.92,{emissive:new THREE.Color(0x8a5000),emissiveIntensity:0.35,side:THREE.DoubleSide});
      [Math.PI*0.15, Math.PI*1.15].forEach(fanAngle=>{
        const fg=new THREE.Group();
        const fx=Math.cos(fanAngle)*(tc.r+0.06);
        const fz=Math.sin(fanAngle)*(tc.r+0.06);
        fg.position.set(fx, topY+0.12, fz);
        fg.rotation.y=-fanAngle;
        // Fan ribs radiating from base
        const ribCount=14;
        const fanSpan=Math.PI*0.68;
        const ribLen=0.28;
        for(let ri=0;ri<ribCount;ri++){
          const ra=-fanSpan/2+(ri/(ribCount-1))*fanSpan;
          const ribPts=[
            new THREE.Vector3(0,0,0),
            new THREE.Vector3(Math.sin(ra)*ribLen, Math.cos(ra)*ribLen, 0)
          ];
          const rib=new THREE.Line(new THREE.BufferGeometry().setFromPoints(ribPts),new THREE.LineBasicMaterial({color:0xd4a820}));
          fg.add(rib);
        }
        // Arc connecting ribs
        const arcPts=[];
        for(let ai=0;ai<=20;ai++){const at=-fanSpan/2+(ai/20)*fanSpan; arcPts.push(new THREE.Vector3(Math.sin(at)*ribLen,Math.cos(at)*ribLen,0));}
        fg.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(arcPts),new THREE.LineBasicMaterial({color:0xd4a820})));
        lg.add(fg);
      });
    }

    // ── SPRINKLES (balls scattered on top+sides)
    if(S.touches.has('sprinkles')){
      const spProps={
        [0xd4a820]:{rough:0.05,metal:0.95,emissive:0xaa7000,ei:0.35},
        [0xc8c8d0]:{rough:0.02,metal:1.0, emissive:0x888890,ei:0.2 },
        [0xffffff]:{rough:0.12,metal:0.15,emissive:0xddeeff,ei:0.18},
        [0x60a8e0]:{rough:0.15,metal:0.08,emissive:0x1060c0,ei:0.4 },
        [0xe04040]:{rough:0.12,metal:0.06,emissive:0xaa0010,ei:0.45},
      };
      const pp=spProps[S.sprinkleCol]||{rough:0.2,metal:0.1,emissive:0x000000,ei:0};
      const mkSp=()=>mkMat(S.sprinkleCol,pp.rough,pp.metal,{emissive:new THREE.Color(pp.emissive),emissiveIntensity:pp.ei});
      for(let i=0;i<80;i++){
        const angle=Math.random()*Math.PI*2, rr=Math.random()*(tc.r*0.9);
        const rnd=Math.random(), sz=rnd<0.15?0.028+Math.random()*0.016:rnd<0.55?0.014+Math.random()*0.01:0.006+Math.random()*0.006;
        const m=new THREE.Mesh(new THREE.SphereGeometry(sz,10,8),mkSp());
        m.position.set(Math.cos(angle)*rr, topY+0.068+sz, Math.sin(angle)*rr);
        lg.add(m);
      }
      for(let i=0;i<55;i++){
        const angle=Math.random()*Math.PI*2, yFrac=Math.random();
        const rnd=Math.random(), sz=rnd<0.2?0.022+Math.random()*0.012:rnd<0.6?0.012+Math.random()*0.008:0.005+Math.random()*0.005;
        const m=new THREE.Mesh(new THREE.SphereGeometry(sz,10,8),mkSp());
        m.position.set(Math.cos(angle)*(tc.r+0.055+sz), topY-tc.h*0.85*yFrac+sz, Math.sin(angle)*(tc.r+0.055+sz));
        lg.add(m);
      }
    }

    // ── EDIBLE FLOWERS
    if(S.touches.has('flowers')){
      const fc=[0xff88aa,0xffaacc,0xaa66cc,0xffcc66,0xff7766];
      for(let fi=0;fi<5;fi++){
        const angle=(fi/5)*Math.PI*2+0.8, rr=tc.r*(0.28+Math.random()*0.4);
        const fg=new THREE.Group();
        fg.position.set(Math.cos(angle)*rr, topY+0.1, Math.sin(angle)*rr);
        for(let p=0;p<5;p++){
          const pa=(p/5)*Math.PI*2;
          const petal=new THREE.Mesh(new THREE.SphereGeometry(0.042,8,6),mkMat(fc[fi%fc.length],0.5,0,{transparent:true,opacity:0.9}));
          petal.position.set(Math.cos(pa)*0.065,0,Math.sin(pa)*0.065);
          petal.scale.set(1,0.35,1); fg.add(petal);
        }
        const centre=new THREE.Mesh(new THREE.SphereGeometry(0.032,8,6),mkMat(0xffee44,0.4));
        centre.position.set(0,0.02,0); fg.add(centre);
        lg.add(fg);
      }
    }

    // ── HAPPY BIRTHDAY TOPPER (canvas cursive text on reflective plane — like real silver topper)
    if(S.touches.has('hbd')){
      // Single centre stick
      const stickMat=mkMat(0xd8d8e0,0.05,0.92,{emissive:new THREE.Color(0x404050),emissiveIntensity:0.15});
      const stick=new THREE.Mesh(new THREE.CylinderGeometry(0.016,0.016,0.75,10),stickMat);
      stick.position.set(0, topY+0.5, 0); lg.add(stick);
      // Bow on stick
      [-1,1].forEach(side=>{
        const bow=new THREE.Mesh(new THREE.TorusGeometry(0.055,0.014,6,12,Math.PI),mkMat(0xe0e8f0,0.1,0.7));
        bow.position.set(side*0.06, topY+0.26, 0);
        bow.rotation.z=side*0.5; lg.add(bow);
      });
      // Canvas "Happy Birthday" cursive text topper
      const hc=document.createElement('canvas'); hc.width=512; hc.height=256;
      const hx=hc.getContext('2d');
      hx.clearRect(0,0,512,256);
      // Silver metallic background
      const bgGrad=hx.createLinearGradient(0,0,512,256);
      bgGrad.addColorStop(0,'rgba(195,205,215,0.96)');
      bgGrad.addColorStop(0.5,'rgba(225,232,240,0.98)');
      bgGrad.addColorStop(1,'rgba(190,200,212,0.96)');
      hx.fillStyle=bgGrad;
      roundRect(hx,8,8,496,240,18); hx.fill();
      // Dark border for definition
      hx.strokeStyle='rgba(80,90,110,0.7)'; hx.lineWidth=2.5;
      roundRect(hx,8,8,496,240,18); hx.stroke();
      // Inner rule lines
      hx.strokeStyle='rgba(80,90,110,0.25)'; hx.lineWidth=1;
      hx.beginPath(); hx.moveTo(30,42); hx.lineTo(482,42); hx.stroke();
      hx.beginPath(); hx.moveTo(30,214); hx.lineTo(482,214); hx.stroke();
      // TEXT — dark chocolate, fully visible
      hx.font='italic bold 72px Georgia, serif';
      hx.fillStyle='#1a0c04';
      hx.textAlign='center'; hx.textBaseline='middle';
      hx.fillText('Happy',256,88);
      hx.font='italic bold 65px Georgia, serif';
      hx.fillText('Birthday',256,178);
      // Subtle metallic shine — much lighter than before
      const shine=hx.createLinearGradient(0,0,0,256);
      shine.addColorStop(0,'rgba(255,255,255,0.15)');
      shine.addColorStop(0.5,'rgba(255,255,255,0)');
      hx.fillStyle=shine; hx.fillRect(0,0,512,256);
      const htex=new THREE.CanvasTexture(hc);
      const hbdPlane=new THREE.Mesh(new THREE.PlaneGeometry(tc.r*1.6,tc.r*0.8),new THREE.MeshStandardMaterial({map:htex,transparent:true,roughness:0.05,metalness:0.85,side:THREE.DoubleSide}));
      hbdPlane.position.set(0, topY+0.9, 0);
      hbdPlane.name='hbdTopper'; lg.add(hbdPlane);
    }

    // ── NAME ON CAKE (top or front side placement)
    if(S.cakeName && S.namePlacement!=='board'){
      const cvs2=document.createElement('canvas'); cvs2.width=512; cvs2.height=128;
      const ctx2=cvs2.getContext('2d');
      ctx2.clearRect(0,0,512,128);
      ctx2.fillStyle='rgba(255,245,215,0.9)';
      roundRect(ctx2,8,16,496,96,16); ctx2.fill();
      ctx2.strokeStyle='rgba(180,130,20,0.65)'; ctx2.lineWidth=2;
      roundRect(ctx2,8,16,496,96,16); ctx2.stroke();
      ctx2.strokeStyle='rgba(180,130,20,0.3)'; ctx2.lineWidth=1;
      ctx2.beginPath(); ctx2.moveTo(28,34); ctx2.lineTo(484,34); ctx2.stroke();
      ctx2.beginPath(); ctx2.moveTo(28,94); ctx2.lineTo(484,94); ctx2.stroke();
      const fontSize=S.cakeName.length>12?36:S.cakeName.length>8?42:50;
      ctx2.font=`italic ${fontSize}px Georgia, serif`;
      ctx2.fillStyle='#3a1a04'; ctx2.textAlign='center'; ctx2.textBaseline='middle';
      ctx2.fillText(S.cakeName,256,66);
      ctx2.fillStyle='rgba(180,130,20,0.7)'; ctx2.font='14px serif';
      ctx2.fillText('✦',30,64); ctx2.fillText('✦',482,64);
      const tex=new THREE.CanvasTexture(cvs2);
      const nameW=tc.r*1.3, nameH=nameW/4;
      const nameMesh=new THREE.Mesh(new THREE.PlaneGeometry(nameW,nameH),new THREE.MeshStandardMaterial({map:tex,transparent:true,roughness:0.4,metalness:0.05,side:THREE.DoubleSide}));
      if(S.namePlacement==='top'){ nameMesh.rotation.x=-Math.PI/2; nameMesh.position.set(0,topY+0.12,0); }
      else { nameMesh.position.set(0,topY*0.35,tc.r+0.07); }
      nameMesh.name='nameLabel'; lg.add(nameMesh);
    }

    // ── CANDLE + FLAME
    const candleCol=S.flavor==='vanilla'?0xffe87a:0xff4472;
    const candle=new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.04,0.35,12),mkMat(candleCol,0.6));
    candle.position.set(0, topY+0.26, 0); lg.add(candle);
    const flame=new THREE.Mesh(new THREE.SphereGeometry(0.055,10,8),mkMat(0xffcc44,0.2,0,{emissive:new THREE.Color(0xffaa00),emissiveIntensity:2.4}));
    flame.position.set(0, topY+0.5, 0); flame.name='flame'; lg.add(flame);
    const flameLight=new THREE.PointLight(0xffaa40,1.8,3.5);
    flameLight.position.set(0, topY+0.54, 0); flameLight.name='fLight'; lg.add(flameLight);
  }

  cakeGrp.position.set(0,-yOff/2,0);
  scene.add(cakeGrp);

  const fSceneCol=FL[S.flavor];
  scene.fog.color.set(fSceneCol.fogCol);
  scene.children.filter(c=>c.isDirectionalLight).forEach((l,i)=>{ if(i===0)l.color.set(fSceneCol.l1); if(i===1)l.color.set(fSceneCol.l2); });
}

window.rebuild=rebuild;

function onResize(){
  if (!renderer) return;
  const w=document.querySelector('.canvas-wrap');
  if (!w) return;
  renderer.setSize(w.clientWidth,w.clientHeight,false);
  camera.aspect=w.clientWidth/w.clientHeight; camera.updateProjectionMatrix();
}

let T=0;
function loop(){
  requestAnimationFrame(loop); T+=0.016;
  ry+=(ty-ry)*0.065; rx+=(tx-rx)*0.065;
  if(!drag) ty+=0.004;
  if(cakeGrp){
    cakeGrp.rotation.y=ry; cakeGrp.rotation.x=rx;
    cakeGrp.traverse(c=>{
      if(c.name==='flame') c.scale.setScalar(0.92+Math.sin(T*8+Math.random()*0.3)*0.13);
      if(c.name==='fLight') c.intensity=1.5+Math.sin(T*9)*0.5;
      if(c.name==='star') c.rotation.y=T*2;
      if(c.name==='hbdTopper') c.rotation.y=ry; // always face camera
    });
  }
  renderer.render(scene,camera);
}

function refGoTo(i) {
  _refIdx = (i + _refImages.length) % _refImages.length;
  var slides = document.getElementById('ref-slides');
  if (slides) slides.style.transform = 'translateX(-' + (_refIdx * 100) + '%)';
  var dots = document.getElementById('ref-dots');
  if (dots) {
    Array.from(dots.children).forEach(function(d, di) {
      d.style.width      = di === _refIdx ? '18px' : '6px';
      d.style.borderRadius = di === _refIdx ? '2px' : '50%';
      d.style.background   = di === _refIdx ? 'var(--gold)' : 'rgba(201,160,64,.28)';
    });
  }
}

function refSlide(dir) { refGoTo(_refIdx + dir); }

// Touch swipe support
(function() {
  var startX = 0;
  document.addEventListener('touchstart', function(e) {
    var el = e.target.closest('#ref-carousel');
    if (el) startX = e.touches[0].clientX;
  }, { passive: true });
  document.addEventListener('touchend', function(e) {
    var el = e.target.closest('#ref-carousel');
    if (!el) return;
    var diff = startX - e.changedTouches[0].clientX;
    if (Math.abs(diff) > 40) refSlide(diff > 0 ? 1 : -1);
  });
})();

function openRefLightbox(i) {
  _refIdx = i;
  var lb    = document.getElementById('ref-lightbox');
  var img   = document.getElementById('ref-lb-img');
  var cap   = document.getElementById('ref-lb-cap');
  if (!lb || !img) return;
  img.src           = _refImages[i].src;
  cap.textContent   = _refImages[i].cap;
  lb.style.display  = 'flex';
  refGoTo(i);
}

function closeRefLightbox() {
  var lb = document.getElementById('ref-lightbox');
  if (lb) lb.style.display = 'none';
}

// Set cake delivery date min = today + 7 days
(function(){
  var inp = document.getElementById('cake-delivery-date');
  if (inp) {
    var d = new Date(); d.setDate(d.getDate() + 7);
    inp.min = d.toISOString().split('T')[0];
  }
})();


function csPhotoNav(dir) {
  _csPhotoIdx = (_csPhotoIdx + dir + _csCurrentPhotos.length) % _csCurrentPhotos.length;
  // Pause briefly on manual nav then resume
  csPauseScroll();
  setTimeout(csResumeScroll, 4000);
  csUpdatePhoto();
}

// ── LIGHTBOX ──
function csOpenLightbox() {
  var photo = _csCurrentPhotos[_csPhotoIdx];
  if (!photo) return;
  csPauseScroll();

  var lb = document.getElementById('cs-lightbox');
  if (lb) { lb.remove(); }

  var el = document.createElement('div');
  el.id  = 'cs-lightbox';
  el.style.cssText = 'position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.96);backdrop-filter:blur(14px);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;animation:csFadeIn .25s ease';

  el.innerHTML =
    '<style>@keyframes csFadeIn{from{opacity:0}to{opacity:1}}</style>'

    // Close tap zone
    + '<div onclick="csCloseLightbox()" style="position:absolute;inset:0;z-index:0"></div>'

    // Prev
    + '<div onclick="event.stopPropagation();csLbNav(-1)" style="position:fixed;left:12px;top:50%;transform:translateY(-50%);z-index:2;width:42px;height:42px;border-radius:50%;background:rgba(201,160,64,.12);border:1px solid rgba(201,160,64,.3);display:flex;align-items:center;justify-content:center;font-size:22px;color:#e0bc5a;cursor:pointer">‹</div>'

    // Next
    + '<div onclick="event.stopPropagation();csLbNav(1)" style="position:fixed;right:12px;top:50%;transform:translateY(-50%);z-index:2;width:42px;height:42px;border-radius:50%;background:rgba(201,160,64,.12);border:1px solid rgba(201,160,64,.3);display:flex;align-items:center;justify-content:center;font-size:22px;color:#e0bc5a;cursor:pointer">›</div>'

    // Image
    + '<img id="cs-lb-img" src="' + photo.url + '" style="position:relative;z-index:1;max-width:94vw;max-height:82vh;object-fit:contain;border:1px solid rgba(201,160,64,.22);box-shadow:0 0 60px rgba(0,0,0,.8)">'

    // Tags
    + '<div id="cs-lb-tags" style="position:relative;z-index:1;display:flex;flex-wrap:wrap;justify-content:center;gap:6px">'
    + (photo.tags || []).map(function(t){
        return '<div style="font-family:\'Cinzel\',serif;font-size:7px;letter-spacing:.25em;text-transform:uppercase;padding:4px 12px;background:rgba(201,160,64,.12);border:1px solid rgba(201,160,64,.3);color:#e0bc5a">' + t + '</div>';
      }).join('')
    + '</div>'

    // Hint
    + '<div style="position:relative;z-index:1;font-family:\'Cinzel\',serif;font-size:7.5px;letter-spacing:.4em;color:rgba(201,160,64,.35);text-transform:uppercase">Tap anywhere to close</div>'

    // Dots
    + '<div id="cs-lb-dots" style="position:relative;z-index:1;display:flex;gap:6px">'
    + _csCurrentPhotos.map(function(p, i) {
        return '<div onclick="event.stopPropagation();csLbNav(' + (i - _csPhotoIdx) + ')" style="width:' + (i===_csPhotoIdx?'18':'6') + 'px;height:4px;border-radius:' + (i===_csPhotoIdx?'2':'50%') + 'px;background:' + (i===_csPhotoIdx?'var(--gold)':'rgba(201,160,64,.25)') + ';cursor:pointer;transition:all .3s"></div>';
      }).join('')
    + '</div>';

  document.body.appendChild(el);
  history.pushState({ page: 'cake-studio', sheet: 'lightbox' }, '', '#cake-studio'); // ← add this
}

function csCloseLightbox() {
  var lb = document.getElementById('cs-lightbox');
  if (lb) lb.remove();
  csResumeScroll();
}
function csLbNav(dir) {
  _csPhotoIdx = (_csPhotoIdx + dir + _csCurrentPhotos.length) % _csCurrentPhotos.length;
  var photo   = _csCurrentPhotos[_csPhotoIdx];
  var img     = document.getElementById('cs-lb-img');
  var tags    = document.getElementById('cs-lb-tags');
  var dots    = document.getElementById('cs-lb-dots');

  if (img) img.src = photo.url;
  if (tags) tags.innerHTML = (photo.tags || []).map(function(t){
    return '<div style="font-family:\'Cinzel\',serif;font-size:7px;letter-spacing:.25em;text-transform:uppercase;padding:4px 12px;background:rgba(201,160,64,.12);border:1px solid rgba(201,160,64,.3);color:#e0bc5a">' + t + '</div>';
  }).join('');
  if (dots) dots.innerHTML = _csCurrentPhotos.map(function(p, i) {
    return '<div onclick="event.stopPropagation();csLbNav(' + (i - _csPhotoIdx) + ')" style="width:' + (i===_csPhotoIdx?'18':'6') + 'px;height:4px;border-radius:' + (i===_csPhotoIdx?'2':'50%') + 'px;background:' + (i===_csPhotoIdx?'var(--gold)':'rgba(201,160,64,.25)') + ';cursor:pointer;transition:all .3s"></div>';
  }).join('');

  csUpdatePhoto();
}

function csUpdatePhoto() {
  _csCurrentPhotos = csGetMatchingPhotos();
  if (_csCurrentPhotos.length === 0) return;
  if (_csPhotoIdx >= _csCurrentPhotos.length) _csPhotoIdx = 0;

  var photo   = _csCurrentPhotos[_csPhotoIdx];
  var mainImg = document.getElementById('cs-photo-main');
  var fadeImg = document.getElementById('cs-photo-fade');

  if (mainImg && fadeImg) {
    fadeImg.src           = photo.url;
    fadeImg.style.opacity = '0';
    setTimeout(function() {
      fadeImg.style.opacity = '1';
      setTimeout(function() {
        mainImg.src           = photo.url;
        fadeImg.style.opacity = '0';
      }, 500);
    }, 50);
  }

  // Title
  var titleEl  = document.getElementById('cs-photo-title');
  var flavNames = { vanilla:'Vanilla Pineapple', chocberry:'Chocolate Strawberry' };
  if (titleEl) titleEl.textContent = flavNames[S.flavor] || S.flavor;

  // Chips
  csUpdateChips();

  // Counter
  var counter = document.getElementById('cs-photo-counter');
  if (counter) counter.textContent = (_csPhotoIdx + 1) + ' / ' + _csCurrentPhotos.length;

  // Arrows
  var showArrows = _csCurrentPhotos.length > 1;
  var prev = document.getElementById('cs-photo-prev');
  var next = document.getElementById('cs-photo-next');
  if (prev) prev.style.display = showArrows ? 'flex' : 'none';
  if (next) next.style.display = showArrows ? 'flex' : 'none';

  // Restart auto scroll when photos change
  //csStartAutoScroll();
}

// ── CAKE STUDIO AUTO SCROLL ──
var _csAutoTimer = null;
var _csIsPaused  = false;

function csStartAutoScroll() {
  csStopAutoScroll();
  if (_csCurrentPhotos.length <= 1) return;
  _csAutoTimer = setInterval(function() {
    if (_csIsPaused) return;
    _csPhotoIdx = (_csPhotoIdx + 1) % _csCurrentPhotos.length;
    var photo   = _csCurrentPhotos[_csPhotoIdx];
    var mainImg = document.getElementById('cs-photo-main');
    var fadeImg = document.getElementById('cs-photo-fade');
    if (mainImg && fadeImg) {
      fadeImg.src           = photo.url;
      fadeImg.style.opacity = '0';
      setTimeout(function() {
        fadeImg.style.opacity = '1';
        setTimeout(function() {
          mainImg.src           = photo.url;
          fadeImg.style.opacity = '0';
        }, 500);
      }, 50);
    }
    var counter = document.getElementById('cs-photo-counter');
    if (counter) counter.textContent = (_csPhotoIdx + 1) + ' / ' + _csCurrentPhotos.length;
    csUpdateChips();
  }, 3200);
}

function csStopAutoScroll() {
  if (_csAutoTimer) { clearInterval(_csAutoTimer); _csAutoTimer = null; }
}

function csPauseScroll()  { _csIsPaused = true; }
function csResumeScroll() { _csIsPaused = false; }

// ── CAKE STUDIO PHOTO SYSTEM ──
var _csPhotoIdx = 0;
var _csCurrentPhotos = [];

// Photo library — add more as you upload to Supabase
// Key format: flavor_frosting_tiers (use 'any' as wildcard)
var CS_PHOTO_MAP = [

  { flavor:'any', frost:'any', tiers:'any',
    url:'https://yjbfditboewwpgyqzryd.supabase.co/storage/v1/object/public/product-images/diya.jpeg',
    tags:['Flowers','Sprinkles','4 Tier'] },
  // Your uploaded reference
  { flavor:'any',      frost:'fresh',  tiers:'any', url:'https://yjbfditboewwpgyqzryd.supabase.co/storage/v1/object/public/product-images/cake-reference-1.jpeg',
    tags:['Gold Drips','Faux Balls','Gold Leaf','2 Tier'] },

    { flavor:'any', frost:'any', tiers:'any',
    url:'https://yjbfditboewwpgyqzryd.supabase.co/storage/v1/object/public/product-images/cake-reference-2.jpeg',
    tags:['Chocolate Frosting','1 Tier'] },

  { flavor:'any', frost:'any', tiers:'any',
    url:'https://yjbfditboewwpgyqzryd.supabase.co/storage/v1/object/public/product-images/cake-reference-3.jpeg',
    tags:['Flowers','Sprinkles','3 Tier'] },

    { flavor:'any', frost:'any', tiers:'any',
    url:'https://yjbfditboewwpgyqzryd.supabase.co/storage/v1/object/public/product-images/cake-reference-4.jpeg',
    tags:['Flowers','Sprinkles','3 Tier'] },

    { flavor:'any', frost:'any', tiers:'any',
    url:'https://yjbfditboewwpgyqzryd.supabase.co/storage/v1/object/public/product-images/cake-reference-5.jpeg',
    tags:['Flowers','Sprinkles','3 Tier'] },

    { flavor:'any', frost:'any', tiers:'any',
    url:'https://yjbfditboewwpgyqzryd.supabase.co/storage/v1/object/public/product-images/cake-reference-6.jpeg',
    tags:['Flowers','Sprinkles','3 Tier'] },

    { flavor:'any', frost:'any', tiers:'any',
    url:'https://yjbfditboewwpgyqzryd.supabase.co/storage/v1/object/public/product-images/cake-reference-7.jpeg',
    tags:['Flowers','Sprinkles','3 Tier'] },

    { flavor:'any', frost:'any', tiers:'any',
    url:'https://yjbfditboewwpgyqzryd.supabase.co/storage/v1/object/public/product-images/cake-reference-8.jpeg',
    tags:['Flowers','Sprinkles','3 Tier'] },
  // Add more as you upload — examples:
  // { flavor:'vanilla',  frost:'fresh',  tiers:2, url:'...cake-fresh-2tier.jpeg', tags:['Fresh Cream'] },
  // { flavor:'chocberry',frost:'choc',   tiers:1, url:'...cake-choc-1tier.jpeg',  tags:['Chocolate'] },
  // { flavor:'any',      frost:'truffle',tiers:'any', url:'...cake-truffle.jpeg', tags:['Truffle Dark'] },
];

function csGetMatchingPhotos() {
  var matches = CS_PHOTO_MAP.filter(function(p) {
    var flavorMatch = p.flavor === 'any' || p.flavor === S.flavor;
    var frostMatch  = p.frost  === 'any' || p.frost  === S.frostType;
    var tiersMatch  = p.tiers  === 'any' || p.tiers  === S.tiers;
    return flavorMatch && frostMatch && tiersMatch;
  });

  // Fallback: try flavor + frost only
  if (matches.length === 0) {
    matches = CS_PHOTO_MAP.filter(function(p) {
      return (p.flavor === 'any' || p.flavor === S.flavor) &&
             (p.frost  === 'any' || p.frost  === S.frostType);
    });
  }

  // Final fallback: show all
  if (matches.length === 0) matches = CS_PHOTO_MAP;
  return matches;
}

function csUpdatePhoto() {
  _csCurrentPhotos = csGetMatchingPhotos();
  if (_csCurrentPhotos.length === 0) return;

  // Keep same index if possible
  if (_csPhotoIdx >= _csCurrentPhotos.length) _csPhotoIdx = 0;

  var photo = _csCurrentPhotos[_csPhotoIdx];
  var mainImg = document.getElementById('cs-photo-main');
  var fadeImg = document.getElementById('cs-photo-fade');

  // Crossfade
  if (mainImg && fadeImg) {
    fadeImg.src     = photo.url;
    fadeImg.style.opacity = '0';
    setTimeout(function() {
      fadeImg.style.opacity = '1';
      setTimeout(function() {
        mainImg.src = photo.url;
        fadeImg.style.opacity = '0';
      }, 500);
    }, 50);
  }

  // Update title
  var titleEl = document.getElementById('cs-photo-title');
  if (titleEl) {
    var flavNames = { vanilla:'Vanilla Pineapple', chocberry:'Chocolate Strawberry' };
    titleEl.textContent = flavNames[S.flavor] || S.flavor;
  }

  // Update chips
  csUpdateChips();

  // Counter
  var counter = document.getElementById('cs-photo-counter');
  if (counter) counter.textContent = (_csPhotoIdx + 1) + ' / ' + _csCurrentPhotos.length;

  // Show/hide arrows
  var showArrows = _csCurrentPhotos.length > 1;
  var prev = document.getElementById('cs-photo-prev');
  var next = document.getElementById('cs-photo-next');
  if (prev) prev.style.display = showArrows ? 'flex' : 'none';
  if (next) next.style.display = showArrows ? 'flex' : 'none';
}

function csUpdateChips() {
  var el = document.getElementById('cs-photo-chips');
  if (!el) return;

  var frostNames  = { fresh:'Fresh Cream', choc:'Chocolate Frosting', truffle:'Truffle Dark' };
  var chips = [
    frostNames[S.frostType] || S.frostType,
    S.tiers + ' Tier',
    S.size + '"',
    S.weight
  ];

  // Add active finishing touches
  var touchNames = { goldLeaf:'Gold Leaf', fauxBalls:'Faux Balls', chocDrips:'Choc Drips', hbd:'HBD Topper', flowers:'Flowers', sprinkles:'Sprinkles' };
  S.touches.forEach(function(t) {
    if (touchNames[t]) chips.push(touchNames[t]);
  });

  el.innerHTML = chips.map(function(c) {
    return '<div style="font-family:\'Cinzel\',serif;font-size:7px;letter-spacing:.18em;text-transform:uppercase;padding:4px 10px;background:rgba(201,160,64,.15);border:1px solid rgba(201,160,64,.3);color:#e0bc5a;backdrop-filter:blur(6px)">' + c + '</div>';
  }).join('');
}

function csPhotoNav(dir) {
  _csPhotoIdx = (_csPhotoIdx + dir + _csCurrentPhotos.length) % _csCurrentPhotos.length;
  csUpdatePhoto();
}

function initCakeGL() {
  if (window._cakeGLInited) return;
  window._cakeGLInited = true;
  initGL();
  csUpdatePhoto();
  setTimeout(csStartAutoScroll, 500);
}


// ── FLAVOUR BASE VARIANT SHEET ──
var _fbvSelected = 'Plain';

function openFlavourSheet() {
  selFbvUI(_fbvSelected);
  document.getElementById('fbv-overlay').style.display = 'block';
  document.getElementById('fbv-sheet').style.display   = 'block';
  history.pushState({ page: 'custom-order', sheet: 'fbv' }, '', '#custom-order');
}

function closeFlavourSheet() {
  document.getElementById('fbv-overlay').style.display = 'none';
  document.getElementById('fbv-sheet').style.display   = 'none';
}

function cancelFlavourSheet() {
  selFbvUI(_fbvSelected); // revert UI to last confirmed
  closeFlavourSheet();
}

function selFbv(el) {
  selFbvUI(el.getAttribute('data-val'));
}

function selFbvUI(val) {
  document.querySelectorAll('.fbv-opt').forEach(function(opt) {
    var isOn = opt.getAttribute('data-val') === val;
    opt.style.background  = isOn ? 'linear-gradient(135deg,rgba(110,9,119,.1),rgba(156,12,161,.05))' : '#fff';
    opt.style.borderColor = isOn ? '#6e0977' : 'rgba(110,9,119,.12)';
    opt.style.borderWidth = isOn ? '1.5px' : '1px';
    var chk = opt.querySelector('.fbv-chk');
    if (chk) {
      chk.style.background   = isOn ? '#6e0977'               : 'transparent';
      chk.style.borderColor  = isOn ? '#6e0977'               : 'rgba(110,9,119,.2)';
      chk.style.color        = isOn ? '#fff'                  : 'transparent';
    }
    var title = opt.querySelector('.fbv-title');
    if (title) title.style.color = isOn ? '#6e0977' : '#1a0820';
  });

  _fbvSelected = val;

  // Update badge
  var badge = document.getElementById('fbv-badge-lbl');
  if (badge) badge.textContent = val + ' selected';
}

async function confirmFlavourBase() {
  customSelections.flavourBase = _fbvSelected;
  updateFlavourEditBtn();
  closeFlavourSheet();

  // ── 1. Save to Supabase if editing an existing order ──
  if (window._editingOrderId && window._editingCustomId) {
    try {
      var { error } = await db
        .from('custom_orders')
        .update({ loaded_base: _fbvSelected })
        .eq('id', window._editingCustomId);
      if (error) console.warn('loaded_base save:', error.message);
      else console.log('✅ loaded_base saved:', _fbvSelected);
    } catch(e) {
      console.warn('loaded_base update error:', e.message);
    }
  }
  showToast('✦ ' + _fbvSelected + ' saved!');
}

function updateFlavourEditBtn() {
  var isPlain   = !_fbvSelected || _fbvSelected === 'Plain';
  var emptyHint = document.getElementById('fbv-empty-hint');
  var selBadge  = document.getElementById('fbv-selected-badge');
  var badgeName = document.getElementById('fbv-badge-name');

  if (emptyHint) emptyHint.style.display = isPlain ? 'flex' : 'none';
  if (selBadge)  selBadge.style.display  = isPlain ? 'none' : 'flex';
  if (badgeName) badgeName.textContent   = _fbvSelected;

  var emojiMap = {
    'Plain':'➕', 'Nuts Loaded':'🥜', 'Seeds Loaded':'🌿',
    'Hazelnut Loaded':'🌰', 'Walnut Loaded':'🪨', 'Dark Choco Loaded':'🍫'
  };

  var inlineText = isPlain
    ? '🥜 + Choose loaded base'
    : (emojiMap[_fbvSelected] || '🥜') + ' ' + _fbvSelected + ' · Change';

  var activeStyle = isPlain
    ? 'margin-top:6px;padding:4px 8px;border-radius:8px;background:rgba(110,9,119,.12);border:1px dashed rgba(110,9,119,.3);font-size:9px;font-weight:700;color:var(--pl);text-align:center;display:block'
    : 'margin-top:6px;padding:4px 8px;border-radius:8px;background:rgba(110,9,119,.25);border:1px solid rgba(110,9,119,.5);font-size:9px;font-weight:700;color:var(--pl);text-align:center;display:block';

  var hiddenStyle = 'display:none';

  // ── Find which flavour chip is currently active ──
  var activeFlavour = customSelections.flavour || 'Classic Dark Chocolate';
  var isClassic     = activeFlavour === 'Classic Dark Chocolate';
  var isCouverture  = activeFlavour === 'Couverture Belgian';

  var classicEl    = document.getElementById('fbv-inline-classic');
  var couvertureEl = document.getElementById('fbv-inline-couverture');

  // Show indicator only in the active chip, hide in the other
  if (classicEl) {
    classicEl.textContent = inlineText;
    classicEl.style.cssText = isClassic ? activeStyle : hiddenStyle;
  }
  if (couvertureEl) {
    couvertureEl.textContent = inlineText;
    couvertureEl.style.cssText = isCouverture ? activeStyle : hiddenStyle;
  }
}

var LAYER_ADDON  = { '1': 0, '2': 150, '3': 300 };
var TOPPER_ADDON = { 'None': 0, 'Acrylic Topper': 250, 'White Chocolate Name': 50, 'Dark Chocolate Name': 25 };

async function loadCakeAddons() {
  try {
    var { data, error } = await db
      .from('cake_addons')
      .select('key, price')
      .eq('is_active', true);

    if (error || !data) return;

    data.forEach(function(row) {
      switch(row.key) {
        case 'layer_2':            LAYER_ADDON['2'] = row.price; break;
        case 'layer_3':            LAYER_ADDON['3'] = row.price; break;
        case 'topper_acrylic':     TOPPER_ADDON['Acrylic Topper']        = row.price; break;
        case 'topper_white_choco': TOPPER_ADDON['White Chocolate Name']  = row.price; break;
        case 'topper_dark_choco':  TOPPER_ADDON['Dark Chocolate Name']   = row.price; break;
        case 'faux_4corners':      FauxBALL_ADDON['Faux Balls – 4 Corners'] = row.price; break;
        case 'butterfly_3':        BUTTERFLY_ADDON['3 Butterflies']      = row.price; break;
      }
    });

    console.log('✅ Cake addons loaded');
  } catch(e) {
    console.warn('loadCakeAddons error:', e.message);
  }
}


