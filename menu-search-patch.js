/**
 * menu-search-patch.js — ChocoCravings On Store
 * Feature: Instant search on the main customer/counter menu (#pg-menu),
 * so finding an item doesn't require scrolling through category tabs.
 *
 * Load AFTER store-patch.js (order relative to table-service-patch.js /
 * staff-order-patch.js doesn't matter), right before </body>:
 *   <script src="menu-search-patch.js"></script>
 *
 * Overrides renderItems() and setTab() from store.html's core script to
 * add search support, following the same override pattern as
 * store-patch.js / table-service-patch.js.
 *
 * Requires: MENU, cart, tab, catOf(), allItems(), updateBar(), add(), rem()
 * — all already global on this page.
 */

document.addEventListener('DOMContentLoaded', function () {
  injectMenuSearchBar();
});
window.addEventListener('pageshow', function (event) {
  if (event.persisted) clearMenuSearch(false);
});

function injectMenuSearchBar() {
  if (document.getElementById('menu-search')) return;
  var secLbl = document.querySelector('.sec-lbl');
  if (!secLbl) return;

  var wrap = document.createElement('div');
  wrap.style.cssText = 'padding:10px 20px 0;background:#fdf5e3';
  wrap.innerHTML =
      '<div style="position:relative">'
    + '<span style="position:absolute;left:14px;top:50%;transform:translateY(-50%);font-size:14px;color:#9a8aaa">🔍</span>'
    + '<style>#menu-search:empty:before{content:attr(data-placeholder);color:#82758b;pointer-events:none}</style>'
    + '<div id="menu-search" contenteditable="plaintext-only" role="searchbox" tabindex="0" aria-multiline="false" inputmode="search" aria-label="Search menu items" data-placeholder="Search menu..." oninput="onMenuSearchInput()" '
    +   'style="width:100%;min-height:44px;white-space:pre;overflow-x:auto;padding:12px 14px 12px 38px;border-radius:24px;border:1.5px solid rgba(18,10,30,0.1);'
    +   'background:#fffbf2;font-family:\'Instrument Sans\',sans-serif;font-size:14px;outline:none;'
    +   'box-sizing:border-box;color:#120a1e"></div>'
    + '</div>';

  secLbl.parentNode.insertBefore(wrap, secLbl);
  var search = document.getElementById('menu-search');
  // No form input: browser contact autofill must not supply the menu query.
  search.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') { event.preventDefault(); search.blur(); }
    if (event.key === 'Escape') { event.preventDefault(); clearMenuSearch(); }
  });
  search.addEventListener('beforeinput', function (event) {
    if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') event.preventDefault();
  });
  search.addEventListener('paste', function (event) {
    if (!event.clipboardData) return;
    event.preventDefault();
    var text = event.clipboardData.getData('text/plain').replace(/[\r\n]+/g, ' ');
    var selection = window.getSelection();
    if (selection && selection.rangeCount && search.contains(selection.getRangeAt(0).commonAncestorContainer)) {
      var range = selection.getRangeAt(0);
      range.deleteContents();
      var node = document.createTextNode(text);
      range.insertNode(node); range.setStartAfter(node); range.collapse(true);
      selection.removeAllRanges(); selection.addRange(range);
    } else search.appendChild(document.createTextNode(text));
    onMenuSearchInput();
  });
}

function onMenuSearchInput() {
  var search = document.getElementById('menu-search');
  if (search && !search.textContent.trim()) search.textContent = '';
  renderItems();
}

function clearMenuSearch(focus) {
  var search = document.getElementById('menu-search');
  if (search) { search.textContent = ''; if (focus !== false) search.focus(); }
  renderItems();
}

// ── Override: renderItems() — search-aware ─────────────────────
function renderItems() {
  var searchEl = document.getElementById('menu-search');
  var query = searchEl ? searchEl.textContent.trim() : '';

  if (query) {
    renderMenuSearchResults(query);
    return;
  }

  var c = MENU[tab];
  document.getElementById('sec-dot').style.background = c.dot;
  document.getElementById('sec-name').style.color = c.accent;
  document.getElementById('sec-name').textContent = tab.toUpperCase();
  document.getElementById('sec-cnt').textContent = c.items.length + ' items';

  document.getElementById('items-list').innerHTML = c.items.map(function (item, i) {
    var q = cart[item.id] || 0;
    var cls = 'item fade-up-item' + (q > 0 ? ' q-' + c.cls : '');
    var remBtn = q > 0 ? '<div class="btn-rem" onclick="rem(\'' + item.id + '\')">−</div>' : '';
    var qtyLbl = q > 0 ? '<div class="qty qty-' + c.cls + '">' + q + '</div>' : '';
    return '<div class="' + cls + '" style="animation-delay:' + (i * 0.07).toFixed(2) + 's" id="row-' + item.id + '">'
      + '<div class="item-info"><div class="item-name">' + item.name + '</div><div class="item-tag">' + item.tag + '</div></div>'
      + '<div class="item-price" id="ip-' + item.id + '">₹' + item.price + '</div>'
      + '<div class="ctrl">' + remBtn + qtyLbl + '<div class="btn-add add-' + c.cls + '" onclick="add(\'' + item.id + '\')">+</div></div>'
      + '</div>';
  }).join('');
  updateBar();
}

function renderMenuSearchResults(query) {
  var q = query.toLowerCase();
  var matches = allItems().filter(function (item) { return item.name.toLowerCase().indexOf(q) !== -1; });

  document.getElementById('sec-dot').style.background = '#c2607a';
  document.getElementById('sec-name').style.color = '#c2607a';
  document.getElementById('sec-name').textContent = 'SEARCH RESULTS';
  document.getElementById('sec-cnt').textContent = matches.length + (matches.length === 1 ? ' item' : ' items');

  document.getElementById('items-list').innerHTML = matches.length
    ? matches.map(function (item, i) {
        var c = catOf(item.id);
        var qcount = cart[item.id] || 0;
        var cls = 'item fade-up-item' + (qcount > 0 ? ' q-' + c.cls : '');
        var remBtn = qcount > 0 ? '<div class="btn-rem" onclick="rem(\'' + item.id + '\')">−</div>' : '';
        var qtyLbl = qcount > 0 ? '<div class="qty qty-' + c.cls + '">' + qcount + '</div>' : '';
        return '<div class="' + cls + '" style="animation-delay:' + (i * 0.05).toFixed(2) + 's" id="row-' + item.id + '">'
          + '<div class="item-info"><div class="item-name">' + item.name + '</div><div class="item-tag">' + item.tag + '</div></div>'
          + '<div class="item-price" id="ip-' + item.id + '">₹' + item.price + '</div>'
          + '<div class="ctrl">' + remBtn + qtyLbl + '<div class="btn-add add-' + c.cls + '" onclick="add(\'' + item.id + '\')">+</div></div>'
          + '</div>';
      }).join('')
    : '<div style="text-align:center;padding:40px 20px;font-family:Fraunces,serif;font-size:15px;color:#9a8aaa">No items match "' + query.replace(/[&<>"']/g, function(c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }) + '"</div>';

  updateBar();
}

// ── Override: setTab() — clear search when a category is tapped ─
function setTab(t) {
  var searchEl = document.getElementById('menu-search');
  if (searchEl) searchEl.textContent = '';

  tab = t;
  document.querySelectorAll('.tab').forEach(function (el) {
    el.className = el.className.replace(/\bon-\S+/g, '').trim() || 'tab';
    el.className = 'tab' + (el.id && el.id !== 'tab-' + t ? '' : '');
  });
  var activeTab = document.querySelector('[onclick="setTab(\'' + t + '\')"]');
  if (activeTab) activeTab.className = 'tab on-' + MENU[t].cls;
  renderItems();
}
