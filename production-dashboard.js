/* Production workspace: real Supabase data only. Stock writes use transactional RPCs. */
(function () {
  'use strict';
  const tabs = ['Dashboard', 'Production', 'Materials', 'Recipes', 'Outlet', 'Profit report'];
  const sources = { materials: 'inventory_items', packaging: 'packaging_materials', purchases: 'material_purchases', menu: 'store_menu', outlet: 'display_stock', requests: 'cc_production_requests', recipes: 'cc_production_recipes', batches: 'cc_production_batches', orders: 'store_orders' };
  const screenSources = {
    Dashboard: ['materials','outlet','requests','batches'], Production: ['requests','recipes','batches'],
    Materials: ['materials','packaging','purchases'], Recipes: ['recipes','menu','materials','packaging'],
    Outlet: ['outlet','batches'], 'Profit report': ['orders','batches']
  };
  const columns = {
    inventory_items: 'id,name,unit,current_stock,cost_per_unit,low_stock_threshold',
    packaging_materials: 'id,name,unit,category,current_stock,cost_per_unit',
    material_purchases: 'id,item_name,quantity,unit,cost_total,purchase_date',
    store_menu: 'id,name', display_stock: 'id,item_name,current_stock,low_stock_threshold',
    cc_production_requests: 'id,product_name,outlet_name,quantity,status',
    cc_production_recipes: 'id,product_name,yield_qty,yield_kg,ingredients,packaging,created_at',
    cc_production_batches: 'id,product_name,outlet_name,status,planned_qty,planned_kg,actual_qty,collected_qty,material_cost,packaging_cost,labor_cost,overhead_cost,total_cost,unit_cost,completed_at',
    store_orders: 'id,items,status,payment_status,created_at'
  };
  const state = { tab: 'Dashboard', data: {}, errors: [], ready: false, loading: false, busy: false, refreshed: null };
  let root, channel, refreshTimer, previousFocus, loadId = 0, previousOverflow = '', authListener;
  const esc = value => String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = value => Number.isFinite(Number(value)) ? Number(value) : 0;
  const cash = value => value == null ? 'Cost unavailable' : '₹' + num(value).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const rows = name => state.data[name] || [];
  const date = value => value ? new Date(value).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : '—';
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const empty = text => '<div class="pd-empty">' + esc(text) + '</div>';
  const button = (action, text, id, disabled) => '<button type="button" data-action="' + action + '"' + (id ? ' data-id="' + esc(id) + '"' : '') + (disabled ? ' disabled' : '') + '>' + esc(text) + '</button>';
  const badge = text => '<span class="pd-badge">' + esc(text) + '</span>';
  const table = (headers, data) => data.length ? '<div class="pd-scroll"><table><thead><tr>' + headers.map(h => '<th scope="col">' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + data.map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>' : empty('No records yet.');
  const cards = data => '<div class="pd-stats">' + data.map(r => '<section class="pd-card"><div class="pd-muted">' + esc(r[0]) + '</div><div class="pd-value">' + esc(r[1]) + '</div><div class="pd-muted">' + esc(r[2]) + '</div></section>').join('') + '</div>';
  const field = (name, label, type, value, extra) => '<label>' + esc(label) + '<input name="' + name + '" type="' + (type || 'text') + '" value="' + esc(value == null ? '' : value) + '" ' + (extra || '') + ' required></label>';
  const options = (data, valueKey, labelKey) => data.map(r => '<option value="' + esc(r[valueKey]) + '">' + esc(r[labelKey]) + '</option>').join('');
  const select = (name, label, values) => '<label>' + esc(label) + '<select name="' + name + '" required><option value="">Select…</option>' + values + '</select></label>';
  function announce(text) { root.querySelector('[role="status"]').textContent = text; }
  function dbClient() { if (!window.db) throw new Error('Store connection is not ready. Please try again.'); return window.db; }
  async function readAll(tableName) {
    const result = [];
    for (let from = 0; ; from += 500) {
      let query = dbClient().from(tableName).select(columns[tableName]);
      if (tableName === 'material_purchases') query = query.order('purchase_date', { ascending: false }).order('id').limit(100);
      else if (tableName === 'store_orders') query = query.gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString()).eq('status','collected').eq('payment_status','paid').order('created_at').order('id');
      else query = query.order('id');
      const response = await query.range(from, tableName === 'material_purchases' ? 99 : from + 499);
      if (response.error) throw response.error;
      result.push(...(response.data || []));
      if (tableName === 'material_purchases' || !response.data || response.data.length < 500) return result;
    }
  }
  async function refresh() {
    const generation = ++loadId;
    state.loading = true; render();
    const capability = await dbClient().rpc('cc_production_access');
    if (generation !== loadId) return;
    state.ready = !capability.error && capability.data === true;
    if (!state.ready) {
      state.data = {}; state.loading = false;
      state.errors = [capability.error ? capability.error.message : 'This account has not been granted production access.'];
      render(); return;
    }
    const keys = root.hidden ? ['batches'] : screenSources[state.tab];
    const entries = keys.map(key => [key, sources[key]]);
    const results = await Promise.allSettled(entries.map(([, name]) => readAll(name)));
    if (generation !== loadId) return;
    state.errors = []; state.data = {};
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') state.data[entries[i][0]] = result.value;
      else state.errors.push(entries[i][1] + ': ' + (result.reason.message || 'Could not load'));
    });
    state.loading = false; state.refreshed = new Date(); render(); renderKitchen();
  }
  function readyPanel() {
    const batches = rows('batches').filter(b => b.status === 'completed' && num(b.actual_qty) > num(b.collected_qty));
    return '<section class="pd-card"><h3>Ready for collection</h3>' + (batches.length ? batches.map(b => '<div class="pd-line"><strong>' + esc(b.product_name) + '</strong><p class="pd-muted">' + esc(b.outlet_name) + ' · ' + date(b.completed_at) + '</p><div class="pd-value">' + (num(b.actual_qty) - num(b.collected_qty)) + ' <span class="pd-muted">pcs</span></div>' + button('collect', 'Confirm collection', b.id, !state.ready) + '</div>').join('') : empty('Completed batches will appear here.')) + '</section>';
  }
  function productionTable() {
    return table(['Product / outlet', 'Requested', 'Status', 'Action'], rows('requests').map(r => [esc(r.product_name) + '<br><span class="pd-muted">' + esc(r.outlet_name) + '</span>', esc(r.quantity) + ' pcs', badge(r.status), r.status === 'pending' ? button('approve', 'Approve sales request', r.id, !state.ready) : r.status === 'approved' ? button('start', 'Plan & start baking', r.id, !state.ready) : '—']));
  }
  function render() {
    if (!root) return;
    root.querySelector('nav').innerHTML = tabs.map(t => '<button type="button" data-tab="' + t + '" aria-pressed="' + (state.tab === t) + '">' + t + '</button>').join('');
    const content = root.querySelector('main');
    if (state.loading) { content.innerHTML = '<h2>' + state.tab + '</h2>' + empty('Loading current stock and production records…'); return; }
    let html = '<div class="pd-title pd-row"><div><h2>' + state.tab + '</h2><p class="pd-muted">Central kitchen → Main outlet · Current records</p></div>' + button('refresh', 'Refresh') + '</div>';
    if (!state.ready) html += '<div class="pd-notice">Production actions are unavailable until the production database migration is installed and your account is authorized.</div>';
    if (state.errors.length) html += '<details class="pd-error"><summary>Some data could not be loaded (' + state.errors.length + ')</summary>' + state.errors.map(esc).join('<br>') + '</details>';
    const raw = rows('materials');
    const totalValue = raw.length && raw.every(r => r.cost_per_unit != null) ? raw.reduce((sum, r) => sum + num(r.current_stock) * num(r.cost_per_unit), 0) : null;
    const readyQty = rows('batches').filter(b => b.status === 'completed').reduce((sum, b) => sum + num(b.actual_qty) - num(b.collected_qty), 0);
    if (state.tab === 'Dashboard') html += cards([['Raw material value', cash(totalValue), 'Current recorded unit costs'], ['Ready at kitchen', readyQty + ' pcs', 'Awaiting collection'], ['Outlet stock', rows('outlet').reduce((s, r) => s + num(r.current_stock), 0) + ' pcs', 'Current display stock'], ['Active requests', rows('requests').filter(r => !['fulfilled', 'cancelled'].includes(r.status)).length, 'Sales demand']]) + '<div class="pd-grid"><div class="pd-stack"><section class="pd-card"><div class="pd-row"><h3>Production requests</h3>' + button('request', 'New sales request', null, !state.ready) + '</div>' + productionTable() + '</section><section class="pd-card"><h3>Low stock</h3>' + table(['Material', 'Available', 'Reorder level'], raw.filter(r => num(r.current_stock) <= num(r.low_stock_threshold)).map(r => [esc(r.name), esc(r.current_stock) + ' ' + esc(r.unit), esc(r.low_stock_threshold)])) + '</section></div>' + readyPanel() + '</div>';
    if (state.tab === 'Production') html += '<div class="pd-grid"><div class="pd-stack"><section class="pd-card"><div class="pd-row"><h3>Sales requests</h3>' + button('request', 'New sales request', null, !state.ready) + '</div>' + productionTable() + '</section><section class="pd-card"><h3>Batches</h3>' + table(['Product', 'Planned', 'Actual', 'Cost', 'Status / action'], rows('batches').map(b => [esc(b.product_name), esc(b.planned_qty) + ' pcs / ' + esc(b.planned_kg) + ' kg', b.actual_qty == null ? '—' : esc(b.actual_qty) + ' pcs', cash(b.total_cost), badge(b.status) + ' ' + (b.status === 'baking' ? button('complete', 'Submit baked batch', b.id, !state.ready) : '')])) + '</section></div>' + readyPanel() + '</div>';
    if (state.tab === 'Materials') html += '<div class="pd-stack"><section class="pd-card"><div class="pd-row"><h3>Raw materials</h3>' + button('purchase', 'Record stock-in', null, !state.ready) + '</div>' + table(['Material', 'Available', 'Unit cost', 'Stock value'], raw.map(r => [esc(r.name), esc(r.current_stock) + ' ' + esc(r.unit), cash(r.cost_per_unit), r.cost_per_unit == null ? 'Cost unavailable' : cash(num(r.current_stock) * num(r.cost_per_unit))])) + '</section><section class="pd-card"><h3>Packaging by category</h3>' + table(['Packaging', 'Category', 'Available', 'Unit cost'], rows('packaging').map(r => [esc(r.name), esc(r.category || 'Uncategorized'), esc(r.current_stock) + ' ' + esc(r.unit), cash(r.cost_per_unit)])) + '</section><section class="pd-card"><h3>Stock-in history</h3>' + table(['Date', 'Material', 'Quantity', 'Total cost'], rows('purchases').slice().sort((a,b) => String(b.purchase_date).localeCompare(String(a.purchase_date))).slice(0,100).map(r => [date(r.purchase_date), esc(r.item_name), esc(r.quantity) + ' ' + esc(r.unit), cash(r.cost_total)])) + '</section></div>';
    if (state.tab === 'Recipes') html += '<section class="pd-card"><div class="pd-row"><h3>Production recipes</h3>' + button('recipe', 'Add recipe version', null, !state.ready) + '</div>' + table(['Product / revision', 'Base yield', 'Ingredients', 'Packaging'], rows('recipes').map(r => [esc(r.product_name) + '<br><span class="pd-muted">' + date(r.created_at) + ' · ' + esc(r.id.slice(0,8)) + '</span>', esc(r.yield_qty) + ' pcs / ' + esc(r.yield_kg) + ' kg', (r.ingredients || []).map(i => esc(i.name) + ': ' + esc(i.quantity) + ' ' + esc(i.unit)).join('<br>'), (r.packaging || []).map(i => esc(i.name) + ': ' + esc(i.quantity) + ' ' + esc(i.unit)).join('<br>') || 'None'])) + '</section>';
    if (state.tab === 'Outlet') html += '<div class="pd-grid"><section class="pd-card"><h3>Main outlet stock</h3>' + table(['Product', 'Available', 'Reorder level'], rows('outlet').map(r => [esc(r.item_name), esc(r.current_stock) + ' pcs', esc(r.low_stock_threshold)])) + '<p class="pd-muted">Sales continue through the existing order screen. Its database stock deduction remains the only sales stock writer.</p></section>' + readyPanel() + '</div>';
    if (state.tab === 'Profit report') {
      const sales = new Map();
      rows('orders').filter(o => o.status === 'collected' && o.payment_status === 'paid').forEach(o => {
        (Array.isArray(o.items) ? o.items : []).forEach(i => {
          const record = sales.get(i.name) || { quantity: 0, gross: 0 };
          record.quantity += num(i.qty); record.gross += num(i.qty) * num(i.price); sales.set(i.name, record);
        });
      });
      html += '<div class="pd-stack"><section class="pd-card"><h3>Paid, collected item sales · Last 30 days</h3>' + table(['Item', 'Pieces sold', 'Item gross sales', 'Actual profit'], [...sales].map(([name, r]) => [esc(name), esc(r.quantity), cash(r.gross), 'Cost allocation unavailable'])) + '<p class="pd-muted">Line prices before order-level discounts and refunds. Only paid orders marked collected are included.</p></section><section class="pd-card"><div class="pd-row"><h3>Production cost by batch</h3>' + button('export', 'Export batch costs') + '</div>' + table(['Product', 'Baked', 'Collected', 'Ingredients', 'Packaging', 'Labor / overhead', 'Cost / piece'], rows('batches').filter(b => b.status === 'completed').map(b => [esc(b.product_name), esc(b.actual_qty), esc(b.collected_qty), cash(b.material_cost), cash(b.packaging_cost), cash(num(b.labor_cost) + num(b.overhead_cost)), cash(b.unit_cost)])) + '<div class="pd-notice pd-line">Item sales profit requires historical order-to-batch cost allocation. Existing orders do not provide that link, so this screen does not present estimated costs as actual profit.</div></section></div>';
    }
    content.innerHTML = html;
    announce(state.refreshed ? 'Updated ' + state.refreshed.toLocaleTimeString('en-IN') : '');
  }
  function materialOptions(kind) { return options(rows(kind).map(r => ({ value: r.name, label: r.name + ' (' + r.unit + ')' })), 'value', 'label'); }
  function ingredientRow(kind) {
    return '<div class="pd-ingredient" data-kind="' + kind + '">' + select('ingredient_name', kind === 'materials' ? 'Ingredient' : 'Packaging', materialOptions(kind)) + field('ingredient_quantity', 'Quantity per base yield', 'number', '', 'min="0.000001" step="any"') + '<button type="button" data-action="remove-line">Remove</button></div>';
  }
  async function showForm(action, id) {
    if (!state.ready || state.busy) return;
    // Load form-only reference data on demand, rather than on every stock refresh.
    const required = action === 'request' ? ['menu'] : action === 'recipe' ? ['menu','materials','packaging'] : action === 'start' ? ['recipes'] : [];
    const missing = required.filter(key => !Object.prototype.hasOwnProperty.call(state.data,key));
    const loaded = await Promise.all(missing.map(key => readAll(sources[key])));
    missing.forEach((key,index) => { state.data[key] = loaded[index]; });
    const request = rows('requests').find(r => r.id === id), batch = rows('batches').find(b => b.id === id);
    let title, html;
    if (action === 'request') { title = 'Sales production request'; html = select('product_name', 'Product', options(rows('menu'), 'name', 'name')) + '<div class="pd-fields">' + field('quantity', 'Required pieces', 'number', '', 'min="1" step="1"') + field('due_date', 'Required date', 'date', today()) + '</div><p class="pd-muted">Destination: Main outlet. A sales-authorized account must approve this request before baking.</p>'; }
    if (action === 'start') { title = 'Plan & start: ' + request.product_name; html = select('recipe_id', 'Approved recipe version', rows('recipes').filter(r => r.product_name === request.product_name).map(r => '<option value="' + esc(r.id) + '">' + esc(date(r.created_at)) + ' · ' + esc(r.yield_qty) + ' pcs / ' + esc(r.yield_kg) + ' kg</option>').join('')) + '<div class="pd-fields">' + field('planned_qty', 'Planned pieces', 'number', request.quantity, 'min="1" step="1"') + field('planned_kg', 'Planned kg', 'number', '', 'min="0.001" step="any"') + '</div><p class="pd-muted">Recipe ingredients are scaled by pieces and deducted atomically when you start baking.</p>'; }
    if (action === 'complete') { title = 'Submit baked batch'; html = '<div class="pd-fields">' + field('actual_qty', 'Actual good pieces', 'number', batch.planned_qty, 'min="1" step="1"') + field('actual_kg', 'Actual output kg', 'number', batch.planned_kg, 'min="0.001" step="any"') + field('labor_cost', 'Direct labor ₹', 'number', 0, 'min="0" step="0.01"') + field('overhead_cost', 'Production overhead ₹', 'number', 0, 'min="0" step="0.01"') + '</div><p class="pd-muted">Packaging scales to actual output. Ingredient usage is the frozen recipe quantity issued at start. Record exceptional usage through a reviewed stock correction before closing this batch.</p>'; }
    if (action === 'collect') { title = 'Confirm outlet collection'; html = '<p>' + esc(batch.product_name) + ' · ' + (num(batch.actual_qty) - num(batch.collected_qty)) + ' pieces available</p>' + field('quantity', 'Pieces received by Main outlet', 'number', num(batch.actual_qty) - num(batch.collected_qty), 'min="1" step="1" max="' + (num(batch.actual_qty) - num(batch.collected_qty)) + '"') + '<p class="pd-muted">Only confirm quantities physically received. This adds them to outlet stock once.</p>'; }
    if (action === 'purchase') { title = 'Record material or packaging stock-in'; html = '<div class="pd-fields">' + select('kind', 'Type', '<option value="raw">Raw material</option><option value="packaging">Packaging</option>') + field('name', 'Material name') + select('unit', 'Stock unit', ['kg','g','l','ml','pcs'].map(u => '<option>' + u + '</option>').join('')) + field('category', 'Category', 'text', 'General') + field('quantity', 'Received quantity', 'number', '', 'min="0.000001" step="any"') + field('total_cost', 'Total purchase cost ₹', 'number', '', 'min="0.01" step="0.01"') + field('purchase_date', 'Stock-in date', 'date', today()) + '</div><p class="pd-muted">Use an existing material’s exact name and unit to replenish it.</p>'; }
    if (action === 'recipe') { title = 'Add approved recipe version'; html = select('product_name', 'Product', options(rows('menu'), 'name', 'name')) + '<div class="pd-fields">' + field('yield_qty', 'Base yield in pieces', 'number', '', 'min="1" step="1"') + field('yield_kg', 'Base output kg', 'number', '', 'min="0.001" step="any"') + '</div><div id="pd-recipe-lines">' + ingredientRow('materials') + '</div><div class="pd-row">' + button('ingredient', 'Add ingredient') + button('packaging-line', 'Add packaging') + '</div>'; }
    const dialog = root.querySelector('dialog');
    dialog.innerHTML = '<form><h3 id="pd-form-title">' + esc(title) + '</h3><div class="pd-error" role="alert"></div>' + html + '<div class="pd-line pd-row"><button type="button" data-action="cancel">Cancel</button><button type="submit" class="pd-primary">' + (action === 'start' ? 'Start baking' : 'Save') + '</button></div></form>';
    dialog.setAttribute('aria-labelledby', 'pd-form-title'); dialog.showModal();
    // The same key is retained after transport errors so a retry cannot repost stock.
    const key = crypto.randomUUID();
    dialog.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault(); if (state.busy) return;
      const values = Object.fromEntries(new FormData(event.target));
      if (action === 'recipe') {
        values.ingredients = []; values.packaging = [];
        dialog.querySelectorAll('.pd-ingredient').forEach(line => {
          const name = line.querySelector('select').value, item = rows(line.dataset.kind).find(r => r.name === name);
          if (item) values[line.dataset.kind === 'materials' ? 'ingredients' : 'packaging'].push({ name, unit: item.unit, quantity: Number(line.querySelector('input').value) });
        });
      }
      state.busy = true; dialog.querySelector('[type=submit]').disabled = true;
      try {
        await command(action, { ...values, id }, key); dialog.close(); await refresh();
      } catch (error) { dialog.querySelector('[role=alert]').textContent = error.message || 'Unable to save. Retry to check the same operation.'; }
      finally { state.busy = false; dialog.querySelector('[type=submit]').disabled = false; }
    });
  }
  async function command(action, payload, key) {
    if (!navigator.onLine) throw new Error('Connect to the internet before posting stock changes.');
    const result = await dbClient().rpc('cc_production_command', { p_action: action, p_payload: payload, p_key: key });
    if (result.error) throw result.error;
    return result.data;
  }
  function exportCosts() {
    const data = [['Product','Completed','Pieces','Collected','Ingredient cost','Packaging cost','Labor','Overhead','Unit cost']].concat(rows('batches').filter(b => b.status === 'completed').map(b => [b.product_name,b.completed_at,b.actual_qty,b.collected_qty,b.material_cost,b.packaging_cost,b.labor_cost,b.overhead_cost,b.unit_cost]));
    const csv = data.map(r => r.map(v => '"' + String(v == null ? '' : v).replace(/^[=+@-]/, "'$&").replace(/"/g, '""') + '"').join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'production-costs-' + today() + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function renderKitchen() {
    const kitchen = document.getElementById('pg-kitchen'); if (!kitchen || !state.ready) return;
    let panel = kitchen.querySelector('.pd-kitchen-ready');
    if (!panel) { panel = document.createElement('aside'); panel.className = 'pd-kitchen-ready'; kitchen.appendChild(panel); panel.addEventListener('click', () => open('Production')); }
    const count = rows('batches').filter(b => b.status === 'completed').reduce((s,b) => s + num(b.actual_qty) - num(b.collected_qty), 0);
    panel.innerHTML = '<strong>Ready for collection</strong><p>' + count + ' pieces awaiting outlet receipt</p><button type="button">Open production & collect</button>';
  }
  async function open(tab) {
    if (!root) init();
    if (!window.db) { if (window.showStoreToast) window.showStoreToast('Store connection is not ready yet.'); return; }
    const session = await dbClient().auth.getUser();
    if (!session.data.user) { if (window.showStoreToast) window.showStoreToast('Sign in with an authorized account to open production.'); return; }
    previousFocus = document.activeElement;
    if (root.hidden) previousOverflow = document.body.style.overflow;
    state.tab = tabs.includes(tab) ? tab : 'Dashboard'; root.hidden = false; document.body.style.overflow = 'hidden'; root.querySelector('[data-action=close]').focus();
    if (window.closeAdminMenu) window.closeAdminMenu();
    await refresh();
    subscribe();
  }
  function subscribe() {
    if (!channel && state.ready) {
      channel = dbClient().channel('cc-production-workspace');
      ['cc_production_requests','cc_production_batches','cc_production_recipes','inventory_items','packaging_materials','display_stock','store_orders'].forEach(name => channel.on('postgres_changes', { event: '*', schema: 'public', table: name }, scheduleRefresh));
      channel.subscribe();
    }
  }
  function scheduleRefresh(event) {
    if (document.hidden) return;
    const kitchen = document.getElementById('pg-kitchen');
    if (root.hidden && !(kitchen && kitchen.classList.contains('active'))) return;
    const activeTables = (root.hidden ? ['batches'] : screenSources[state.tab]).map(key => sources[key]);
    if (event && event.table && !activeTables.includes(event.table)) return;
    if (!root.hidden && state.tab === 'Profit report') { announce('Data may have changed. Select Refresh to update this report.'); return; }
    if (refreshTimer || root.querySelector('dialog').open || state.busy) return;
    const delay = Math.max(2000, 15000 - (Date.now() - (state.refreshed ? state.refreshed.getTime() : 0)));
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      if (document.hidden || state.loading || state.busy || root.querySelector('dialog').open || (root.hidden && !(kitchen && kitchen.classList.contains('active')))) return;
      refresh().catch(error => announce(error.message));
    }, delay);
  }
  function close() { clearTimeout(refreshTimer); refreshTimer = null; root.hidden = true; document.body.style.overflow = previousOverflow; if (previousFocus) previousFocus.focus(); }
  function init() {
    if (root) return;
    root = document.createElement('section'); root.id = 'production-workspace'; root.hidden = true;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Production workspace');
    root.innerHTML = '<header class="pd-header"><div><div class="pd-brand">ChocoCravings · Production</div><div class="pd-muted">Stock, baking & outlet operations</div></div>' + button('close','Back to store') + '</header><nav aria-label="Production pages"></nav><div class="pd-status" role="status" aria-live="polite"></div><main></main><dialog></dialog>';
    document.body.appendChild(root);
    root.addEventListener('click', async event => {
      const target = event.target.closest('button'); if (!target || target.disabled) return;
      const action = target.dataset.action;
      try {
        if (target.dataset.tab) { state.tab = target.dataset.tab; clearTimeout(refreshTimer); refreshTimer = null; await refresh(); return; }
        if (action === 'close') close();
        else if (action === 'refresh') await refresh();
        else if (action === 'cancel') { if (!state.busy) root.querySelector('dialog').close(); }
        else if (action === 'remove-line') target.closest('.pd-ingredient').remove();
        else if (action === 'ingredient' || action === 'packaging-line') root.querySelector('#pd-recipe-lines').insertAdjacentHTML('beforeend', ingredientRow(action === 'ingredient' ? 'materials' : 'packaging'));
        else if (action === 'export') exportCosts();
        else if (action === 'approve') { if (!state.busy) { state.busy = true; target.disabled = true; try { await command('approve', { id: target.dataset.id }, target.dataset.key || (target.dataset.key = crypto.randomUUID())); await refresh(); } finally { state.busy = false; target.disabled = false; } } }
        else if (['request','recipe','purchase','start','complete','collect'].includes(action)) await showForm(action, target.dataset.id);
      } catch (error) { announce(error.message || 'Operation failed.'); }
    });
    root.querySelector('dialog').addEventListener('cancel', event => { if (state.busy) event.preventDefault(); });
    root.addEventListener('keydown', event => {
      if (root.querySelector('dialog').open) return;
      if (event.key === 'Escape') close();
      if (event.key === 'Tab') {
        const controls = [...root.querySelectorAll('button:not(:disabled), input, select')].filter(el => el.getClientRects().length);
        const first = controls[0], last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
    if (window.registerAdminTool) window.registerAdminTool('Daily Operations', { icon: '🏭', title: 'Production Dashboard', subtitle: 'Stock, baking, collection & costs', onClick: () => open().catch(error => window.showStoreToast && window.showStoreToast(error.message)) });
    const kitchen = document.getElementById('kitchen-fab');
    if (kitchen) kitchen.addEventListener('click', () => { if (window.isAdmin && window.db) refresh().catch(() => {}); });
    window.addEventListener('online', scheduleRefresh);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleRefresh(); });
  }
  window.openProductionDashboard = open;
  window.ccProductionCanUse = async function () {
    try { const response = await dbClient().rpc('cc_production_access'); return !response.error && response.data === true; }
    catch (_) { return false; }
  };
  window.initializeProductionAccess = async function () {
    if (!await window.ccProductionCanUse()) return;
    if (!window.isAdmin && !document.getElementById('pd-staff-entry')) {
      const entry = document.createElement('button'); entry.id = 'pd-staff-entry'; entry.textContent = 'Production & outlet';
      entry.style.cssText = 'position:fixed;bottom:88px;right:18px;z-index:400;padding:12px 16px;border:0;border-radius:12px;background:#790c88;color:white;cursor:pointer';
      entry.addEventListener('click', () => open().catch(error => window.showStoreToast && window.showStoreToast(error.message))); document.body.appendChild(entry);
    }
    // Login discovers access only; bulk reads wait until a production screen opens.
    state.ready = true; subscribe();
    if (!authListener && dbClient().auth.onAuthStateChange) authListener = dbClient().auth.onAuthStateChange(event => {
      if (event !== 'SIGNED_OUT') return;
      ++loadId; state.data = {}; state.ready = false; close();
      root.querySelector('dialog').close();
      document.getElementById('pd-staff-entry')?.remove();
      document.querySelector('.pd-kitchen-ready')?.remove();
      if (channel) { dbClient().removeChannel(channel); channel = null; }
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
