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
    cc_production_requests: 'id,product_name,outlet_name,quantity,status,requested_by,approved_by,approved_at',
    cc_production_recipes: 'id,product_name,yield_qty,yield_kg,ingredients,packaging,created_at,approved_by',
    cc_production_batches: 'id,product_name,outlet_name,status,planned_qty,planned_kg,actual_qty,collected_qty,material_cost,packaging_cost,labor_cost,overhead_cost,total_cost,unit_cost,completed_at',
    store_orders: 'id,items,status,payment_status,created_at'
  };
  const state = { tab: 'Dashboard', data: {}, errors: [], ready: false, loading: false, busy: false, refreshed: null };
  let root, channel, refreshTimer, previousFocus, loadId = 0, previousOverflow = '', authListener, stockTimer, stockLoading = false, pendingRequest = null;
  let approverNames = {}, stockUpdated = null;
  let collectionHistory = [], historyLoading = false;
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
  function approvedBy(row) { return row.approved_by ? esc(approverNames[row.approved_by] || 'Name unavailable') + (row.approved_at ? '<br><span class="pd-muted">' + esc(date(row.approved_at)) + '</span>' : '') : 'Not approved'; }
  async function loadApprovers() {
    const ids = [...new Set([...rows('requests'), ...rows('recipes')].map(r => r.approved_by).filter(Boolean))];
    if (!ids.length) return;
    const result = await dbClient().rpc('cc_production_approver_names', { p_ids: ids });
    if (result.error) { state.errors.push('Approval names: install the production fixes SQL patch. ' + result.error.message); return; }
    (result.data || []).forEach(r => { approverNames[r.user_id] = r.display_name; });
  }
  function stockVisible() { return root && !root.hidden && !document.hidden && ['Dashboard','Outlet'].includes(state.tab); }
  async function refreshStock() {
    if (!stockVisible() || !state.ready || state.loading || state.busy || stockLoading || root.querySelector('dialog').open) return;
    stockLoading = true;
    const generation = loadId;
    try {
      const data = await readAll('display_stock');
      if (generation !== loadId || !stockVisible()) return;
      state.data.outlet = data; stockUpdated = new Date(); render();
    } catch (error) { announce('Outlet stock could not refresh: ' + error.message); }
    finally { stockLoading = false; }
  }
  function startStockFallback() {
    clearInterval(stockTimer);
    // Narrow fallback for projects where Realtime publication is not configured.
    stockTimer = setInterval(refreshStock, 60000);
    if (stockTimer && stockTimer.unref) stockTimer.unref();
  }
  async function loadCollectionHistory() {
    if (historyLoading) return;
    historyLoading = true;
    try {
      const result = await dbClient().from('cc_production_movements')
        .select('item_name,quantity,collected_by,created_at').eq('kind', 'collection_in')
        .order('created_at', { ascending: false }).limit(5);
      if (!result.error) collectionHistory = result.data || [];
    } catch (_) { /* keep showing the last known history */ }
    finally { historyLoading = false; renderKitchen(); }
  }
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
    await loadApprovers();
    if (generation !== loadId) return;
    if (Object.prototype.hasOwnProperty.call(state.data,'outlet')) stockUpdated = new Date();
    state.loading = false; state.refreshed = new Date(); render(); renderKitchen(); loadCollectionHistory();
  }
  function readyPanel() {
    const batches = rows('batches').filter(b => b.status === 'completed' && num(b.actual_qty) > num(b.collected_qty));
    return '<section class="pd-card"><h3>Ready for collection</h3>' + (batches.length ? batches.map(b => '<div class="pd-line"><strong>' + esc(b.product_name) + '</strong><p class="pd-muted">' + esc(b.outlet_name) + ' · ' + date(b.completed_at) + '</p><div class="pd-value">' + (num(b.actual_qty) - num(b.collected_qty)) + ' <span class="pd-muted">pcs</span></div>' + button('collect', 'Confirm collection', b.id, !state.ready) + '</div>').join('') : empty('Completed batches will appear here.')) + '</section>';
  }
  function productionTable() {
    return table(['Product / outlet', 'Requested', 'Status', 'Approved by', 'Action'], rows('requests').map(r => [esc(r.product_name) + '<br><span class="pd-muted">' + esc(r.outlet_name) + '</span>', esc(r.quantity) + ' pcs', badge(r.status), approvedBy(r), r.status === 'pending' ? button('approve', 'Approve sales request', r.id, !state.ready) : r.status === 'approved' ? button('start', 'Plan & start baking', r.id, !state.ready) : '—']));
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
    announce(stockVisible() && stockUpdated ? 'Outlet stock checked ' + stockUpdated.toLocaleTimeString('en-IN') + ' · Auto-check every 60 seconds while visible' : state.refreshed ? 'Updated ' + state.refreshed.toLocaleTimeString('en-IN') : '');
  }
  function materialOptions(kind) { return options(rows(kind).map(r => ({ value: r.name, label: r.name + ' (' + r.unit + ')' })), 'value', 'label'); }
  function ingredientRow(kind) {
    return '<div class="pd-ingredient" data-kind="' + kind + '">' + select('ingredient_name', kind === 'materials' ? 'Ingredient' : 'Packaging', materialOptions(kind)) + field('ingredient_quantity', 'Quantity per base yield', 'number', '', 'min="0.000001" step="any"') + '<button type="button" data-action="remove-line">Remove</button></div>';
  }
  async function showForm(action, id) {
    if (!state.ready || state.busy) return;
    if (action === 'start') state.data.recipes = await readAll('cc_production_recipes');
    // Load form-only reference data on demand, rather than on every stock refresh.
    const required = action === 'request' ? ['menu'] : action === 'recipe' ? ['menu','materials','packaging'] : action === 'start' ? ['recipes'] : [];
    const missing = required.filter(key => !Object.prototype.hasOwnProperty.call(state.data,key));
    const loaded = await Promise.all(missing.map(key => readAll(sources[key])));
    missing.forEach((key,index) => { state.data[key] = loaded[index]; });
    const request = rows('requests').find(r => r.id === id), batch = rows('batches').find(b => b.id === id);
    let title, html;
    const matchingRecipes = request ? rows('recipes').filter(r => r.product_name === request.product_name).sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)) || String(b.id).localeCompare(String(a.id))) : [];
    if (action === 'start' && !matchingRecipes.length) {
      pendingRequest = request;
      const dialog = root.querySelector('dialog');
      dialog.innerHTML = '<h3>No production recipe for ' + esc(request.product_name) + '</h3><p>Add and approve a recipe with its ingredients, base piece yield and weight before baking. Recipes in the older recipe guide are not automatically production recipes.</p><div class="pd-line pd-row">' + button('cancel','Cancel') + button('create-missing-recipe','Create recipe for this product') + '</div>';
      dialog.showModal(); return;
    }
    if (action === 'request') { title = 'Sales production request'; html = select('product_name', 'Product', options(rows('menu'), 'name', 'name')) + '<div class="pd-fields">' + field('quantity', 'Required pieces', 'number', '', 'min="1" step="1"') + field('due_date', 'Required date', 'date', today()) + '</div><p class="pd-muted">Destination: Main outlet. A sales-authorized account must approve this request before baking.</p>'; }
    if (action === 'start') { title = 'Plan & start: ' + request.product_name; html = '<label>Approved recipe version<select name="recipe_id" required>' + matchingRecipes.map((r,index) => '<option value="' + esc(r.id) + '"' + (index === 0 ? ' selected' : '') + '>Version ' + (matchingRecipes.length-index) + ' · ' + esc(date(r.created_at)) + ' · ' + esc(r.yield_qty) + ' pcs / ' + esc(r.yield_kg) + ' kg · ' + esc(r.id.slice(0,8)) + '</option>').join('') + '</select></label><div class="pd-fields">' + field('planned_qty', 'Planned pieces', 'number', request.quantity, 'min="1" step="1" readonly') + field('planned_kg', 'Planned kg (from recipe)', 'number', Number((num(request.quantity)*num(matchingRecipes[0].yield_kg)/num(matchingRecipes[0].yield_qty)).toFixed(6)), 'min="0.000001" step="any" readonly') + '</div><p class="pd-muted">Recipe ingredients are scaled by pieces and deducted atomically when you start baking.</p>'; }
    if (action === 'complete') { title = 'Submit baked batch'; html = '<div class="pd-fields">' + field('actual_qty', 'Actual good pieces', 'number', batch.planned_qty, 'min="1" step="1"') + field('actual_kg', 'Actual output kg', 'number', batch.planned_kg, 'min="0.001" step="any"') + field('labor_cost', 'Direct labor ₹', 'number', 0, 'min="0" step="0.01"') + field('overhead_cost', 'Production overhead ₹', 'number', 0, 'min="0" step="0.01"') + '</div><p class="pd-muted">Packaging scales to actual output. Ingredient usage is the frozen recipe quantity issued at start. Record exceptional usage through a reviewed stock correction before closing this batch.</p>'; }
    if (action === 'collect') { title = 'Confirm outlet collection'; html = '<p>' + esc(batch.product_name) + ' · ' + (num(batch.actual_qty) - num(batch.collected_qty)) + ' pieces available</p>' + field('quantity', 'Pieces received by Main outlet', 'number', num(batch.actual_qty) - num(batch.collected_qty), 'min="1" step="1" max="' + (num(batch.actual_qty) - num(batch.collected_qty)) + '"') + field('collected_by', 'Collected by', 'text', '', 'maxlength="120"') + '<p class="pd-muted">Only confirm quantities physically received. This adds them to outlet stock once.</p>'; }
    if (action === 'purchase') { title = 'Record material or packaging stock-in'; html = '<div class="pd-fields">' + select('kind', 'Type', '<option value="raw">Raw material</option><option value="packaging">Packaging</option>') + field('name', 'Material name') + select('unit', 'Stock unit', ['kg','g','l','ml','pcs'].map(u => '<option>' + u + '</option>').join('')) + field('category', 'Category', 'text', 'General') + field('quantity', 'Received quantity', 'number', '', 'min="0.000001" step="any"') + field('total_cost', 'Total purchase cost ₹', 'number', '', 'min="0.01" step="0.01"') + field('purchase_date', 'Stock-in date', 'date', today()) + '</div><p class="pd-muted">Use an existing material’s exact name and unit to replenish it.</p>'; }
    if (action === 'recipe') { title = 'Add approved recipe version'; html = select('product_name', 'Product', options(rows('menu'), 'name', 'name')) + '<div class="pd-fields">' + field('yield_qty', 'Base yield in pieces', 'number', '', 'min="1" step="1"') + field('yield_kg', 'Base output kg', 'number', '', 'min="0.001" step="any"') + '</div><div id="pd-recipe-lines">' + ingredientRow('materials') + '</div><div class="pd-row">' + button('ingredient', 'Add ingredient') + button('packaging-line', 'Add packaging') + '</div>'; }
    const dialog = root.querySelector('dialog');
    dialog.innerHTML = '<form><h3 id="pd-form-title">' + esc(title) + '</h3><div class="pd-error" role="alert"></div>' + html + '<div class="pd-line pd-row"><button type="button" data-action="cancel">Cancel</button><button type="submit" class="pd-primary">' + (action === 'start' ? 'Start baking' : 'Save') + '</button></div></form>';
    dialog.setAttribute('aria-labelledby', 'pd-form-title'); dialog.showModal();
    if (action === 'start') dialog.querySelector('[name=recipe_id]').addEventListener('change', event => {
      const recipe = matchingRecipes.find(r => r.id === event.target.value);
      dialog.querySelector('[name=planned_kg]').value = Number((num(request.quantity)*num(recipe.yield_kg)/num(recipe.yield_qty)).toFixed(6));
    });
    if (action === 'recipe' && pendingRequest) {
      const chosen = [...dialog.querySelector('[name=product_name]').options].find(o => o.value === pendingRequest.product_name);
      if (chosen) chosen.selected = true;
    }
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
        if (action === 'recipe' && pendingRequest) {
          const requestId = pendingRequest.id; pendingRequest = null;
          state.busy = false; await showForm('start', requestId);
        }
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
  function histTime(value) { return new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  function renderKitchen() {
    const kitchen = document.getElementById('pg-kitchen'); if (!kitchen || !state.ready) return;
    const header = kitchen.querySelector('.k-hdr');
    const ready = rows('batches').filter(b => b.status === 'completed' && num(b.actual_qty) > num(b.collected_qty));
    let panel = kitchen.querySelector('.pd-kitchen-ready');
    if (!ready.length) { if (panel) { panel.remove(); panel = null; } }
    else {
      if (!panel) {
        panel = document.createElement('aside'); panel.className = 'pd-kitchen-ready';
        if (header) header.insertAdjacentElement('afterend', panel); else kitchen.appendChild(panel);
      }
      const total = ready.reduce((s, b) => s + num(b.actual_qty) - num(b.collected_qty), 0);
      panel.innerHTML = '<div class="pdk-top"><div class="pdk-eyebrow">🔔 Ready for collection</div><button type="button" class="pdk-link" data-action="open-dashboard">Full dashboard ›</button></div>'
        + '<div class="pdk-count">' + total + '<span>pcs total</span></div>'
        + ready.map(b => '<div class="pdk-item"><div class="pdk-item-row"><div class="pdk-item-name">' + esc(b.product_name) + '</div><div class="pdk-item-qty">' + (num(b.actual_qty) - num(b.collected_qty)) + ' pcs</div></div>'
          + '<div class="pdk-item-form"><input type="text" class="pdk-collector" placeholder="Collector name" maxlength="120"><button type="button" class="pdk-mark-btn" data-action="mark-collected" data-id="' + esc(b.id) + '">Mark collected</button></div></div>').join('');
    }
    let history = kitchen.querySelector('.pd-kitchen-history');
    if (!history) { history = document.createElement('aside'); history.className = 'pd-kitchen-history'; }
    const anchor = panel || header;
    if (anchor) { if (history.previousElementSibling !== anchor) anchor.insertAdjacentElement('afterend', history); }
    else kitchen.appendChild(history);
    history.innerHTML = '<div class="pdk-eyebrow">Recent collections</div>' + (collectionHistory.length
      ? collectionHistory.map(h => '<div class="pdk-hist-row"><div class="pdk-hist-name">' + esc(h.item_name) + '<span>' + num(h.quantity) + ' pcs</span></div><div class="pdk-hist-meta">' + esc(h.collected_by || 'Unrecorded') + ' · ' + histTime(h.created_at) + '</div></div>').join('')
      : '<div class="pdk-hist-empty">No collections recorded yet.</div>');
  }
  async function markCollected(batchId, button, input) {
    const batch = rows('batches').find(b => b.id === batchId);
    const name = input.value.trim();
    if (!name) { input.focus(); if (window.showStoreToast) window.showStoreToast('Enter who is collecting this.'); return; }
    if (!batch) return;
    const remaining = num(batch.actual_qty) - num(batch.collected_qty);
    if (remaining <= 0) return;
    button.disabled = true; input.disabled = true;
    const key = button.dataset.key || (button.dataset.key = crypto.randomUUID());
    try {
      await command('collect', { id: batch.id, quantity: remaining, collected_by: name }, key);
      await refresh();
      await loadCollectionHistory();
      if (window.showStoreToast) window.showStoreToast('✅ Marked collected');
    } catch (error) {
      button.disabled = false; input.disabled = false;
      if (window.showStoreToast) window.showStoreToast('Error: ' + (error.message || 'Could not mark collected'));
    }
  }
  function initKitchenPanel() {
    const kitchen = document.getElementById('pg-kitchen'); if (!kitchen || kitchen.dataset.pdkBound) return;
    kitchen.dataset.pdkBound = '1';
    kitchen.addEventListener('click', event => {
      if (event.target.closest('[data-action="open-dashboard"]')) { open('Production').catch(() => {}); return; }
      const btn = event.target.closest('[data-action="mark-collected"]');
      if (!btn || btn.disabled) return;
      const item = btn.closest('.pdk-item'); const input = item && item.querySelector('.pdk-collector');
      if (input) markCollected(btn.dataset.id, btn, input);
    });
    kitchen.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || !event.target.classList.contains('pdk-collector')) return;
      event.preventDefault();
      const item = event.target.closest('.pdk-item'); const btn = item && item.querySelector('.pdk-mark-btn');
      if (btn) btn.click();
    });
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
    startStockFallback();
  }
  function subscribe() {
    if (!channel && state.ready) {
      channel = dbClient().channel('cc-production-workspace');
      ['cc_production_requests','cc_production_batches','cc_production_recipes','cc_production_movements','inventory_items','packaging_materials','display_stock','store_orders'].forEach(name => channel.on('postgres_changes', { event: '*', schema: 'public', table: name }, scheduleRefresh));
      channel.subscribe();
    }
  }
  function scheduleRefresh(event) {
    if (document.hidden) return;
    const kitchen = document.getElementById('pg-kitchen');
    if (root.hidden && !(kitchen && kitchen.classList.contains('active'))) return;
    const activeTables = (root.hidden ? ['batches'] : screenSources[state.tab]).map(key => sources[key]);
    const stockEvent = event && ['store_orders','display_stock'].includes(event.table) && stockVisible();
    const historyEvent = event && event.table === 'cc_production_movements' && kitchen && kitchen.classList.contains('active');
    if (event && event.table && !activeTables.includes(event.table) && !stockEvent && !historyEvent) return;
    if (!root.hidden && state.tab === 'Profit report') { announce('Data may have changed. Select Refresh to update this report.'); return; }
    if (historyEvent && !stockEvent) { loadCollectionHistory(); return; }
    if (refreshTimer || root.querySelector('dialog').open || state.busy) return;
    const delay = Math.max(2000, 15000 - (Date.now() - (state.refreshed ? state.refreshed.getTime() : 0)));
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      if (document.hidden || state.loading || state.busy || root.querySelector('dialog').open || (root.hidden && !(kitchen && kitchen.classList.contains('active')))) return;
      if (stockEvent) refreshStock(); else refresh().catch(error => announce(error.message));
    }, delay);
  }
  function close() { clearTimeout(refreshTimer); clearInterval(stockTimer); refreshTimer = null; root.hidden = true; document.body.style.overflow = previousOverflow; if (previousFocus) previousFocus.focus(); }
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
        else if (action === 'create-missing-recipe') { root.querySelector('dialog').close(); await showForm('recipe'); }
        else if (action === 'remove-line') target.closest('.pd-ingredient').remove();
        else if (action === 'ingredient' || action === 'packaging-line') root.querySelector('#pd-recipe-lines').insertAdjacentHTML('beforeend', ingredientRow(action === 'ingredient' ? 'materials' : 'packaging'));
        else if (action === 'export') exportCosts();
        else if (action === 'approve') { if (!state.busy) { state.busy = true; target.disabled = true; try { await command('approve', { id: target.dataset.id }, target.dataset.key || (target.dataset.key = crypto.randomUUID())); await refresh(); } finally { state.busy = false; target.disabled = false; } } }
        else if (['request','recipe','purchase','start','complete','collect'].includes(action)) { pendingRequest = null; await showForm(action, target.dataset.id); }
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
    const kitchenFab = document.getElementById('kitchen-fab');
    if (kitchenFab) kitchenFab.addEventListener('click', () => { if (window.isAdmin && window.db) refresh().catch(() => {}); });
    initKitchenPanel();
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
    state.ready = true; subscribe(); loadCollectionHistory();
    if (!authListener && dbClient().auth.onAuthStateChange) authListener = dbClient().auth.onAuthStateChange(event => {
      if (event !== 'SIGNED_OUT') return;
      ++loadId; state.data = {}; state.ready = false; collectionHistory = []; close();
      root.querySelector('dialog').close();
      document.getElementById('pd-staff-entry')?.remove();
      document.querySelector('.pd-kitchen-ready')?.remove();
      document.querySelector('.pd-kitchen-history')?.remove();
      if (channel) { dbClient().removeChannel(channel); channel = null; }
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
