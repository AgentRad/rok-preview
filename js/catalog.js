/* PartsPort — catalog page: search, filters, product detail, order drawer */
(function () {
  'use strict';

  var PP = window.PartsPort;
  var CART = window.PartsPortCart;
  var PRODUCTS = PP.products;
  var FEE_RATE = 0.04;

  /* ---------- helpers ---------- */
  function $(s, c) { return (c || document).querySelector(s); }
  function money(n) {
    return '$' + n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function etaText(d) {
    return d === 1 ? '1 business day' : d + ' business days';
  }
  function bySku(sku) {
    return PRODUCTS.filter(function (p) { return p.sku === sku; })[0];
  }

  /* ---------- state ---------- */
  var state = {
    q: '',
    cats: [],          // selected category names
    inStock: false,
    maxEta: 0,         // 0 = any
    sort: 'featured'
  };

  /* ---------- filtering ---------- */
  function matches(p) {
    if (state.cats.length && state.cats.indexOf(p.category) === -1) return false;
    if (state.inStock && p.stock <= 0) return false;
    if (state.maxEta && p.etaDays > state.maxEta) return false;
    if (state.q) {
      var hay = (p.name + ' ' + p.manufacturer + ' ' + p.category + ' ' +
        p.sku + ' ' + p.supplier).toLowerCase();
      var tokens = state.q.toLowerCase().split(/\s+/).filter(Boolean);
      for (var i = 0; i < tokens.length; i++) {
        if (hay.indexOf(tokens[i]) === -1) return false;
      }
    }
    return true;
  }

  function sorted(list) {
    var l = list.slice();
    switch (state.sort) {
      case 'price-asc': l.sort(function (a, b) { return a.price - b.price; }); break;
      case 'price-desc': l.sort(function (a, b) { return b.price - a.price; }); break;
      case 'eta': l.sort(function (a, b) { return a.etaDays - b.etaDays; }); break;
      case 'rating': l.sort(function (a, b) { return b.rating - a.rating; }); break;
      default: l.sort(function (a, b) { return b.rating * b.reviews - a.rating * a.reviews; });
    }
    return l;
  }

  /* ---------- filter sidebar ---------- */
  function renderFilters() {
    var cats = {};
    PRODUCTS.forEach(function (p) { cats[p.category] = (cats[p.category] || 0) + 1; });
    var names = Object.keys(cats).sort();

    var html = '<div class="filter-group"><h3>Category</h3>';
    names.forEach(function (name) {
      var checked = state.cats.indexOf(name) > -1 ? ' checked' : '';
      html += '<label class="filter-opt"><input type="checkbox" data-cat="' +
        name + '"' + checked + '> ' + name +
        '<span class="count">' + cats[name] + '</span></label>';
    });
    html += '</div>';

    html += '<div class="filter-group"><h3>Availability</h3>' +
      '<label class="filter-opt"><input type="checkbox" id="f-instock"' +
      (state.inStock ? ' checked' : '') + '> In stock now</label></div>';

    html += '<div class="filter-group"><h3>Delivery</h3>';
    [['Any lead time', 0], ['Within 2 days', 2], ['Within 5 days', 5]].forEach(function (o) {
      var checked = state.maxEta === o[1] ? ' checked' : '';
      html += '<label class="filter-opt"><input type="radio" name="eta" data-eta="' +
        o[1] + '"' + checked + '> ' + o[0] + '</label>';
    });
    html += '</div>';

    html += '<button class="filter-clear" id="f-clear">Clear all filters</button>';

    var box = $('#filters');
    box.innerHTML = html;

    box.querySelectorAll('[data-cat]').forEach(function (el) {
      el.addEventListener('change', function () {
        var name = el.getAttribute('data-cat');
        if (el.checked) state.cats.push(name);
        else state.cats = state.cats.filter(function (c) { return c !== name; });
        syncUrl(); renderGrid();
      });
    });
    $('#f-instock', box).addEventListener('change', function (e) {
      state.inStock = e.target.checked; renderGrid();
    });
    box.querySelectorAll('[data-eta]').forEach(function (el) {
      el.addEventListener('change', function () {
        state.maxEta = parseInt(el.getAttribute('data-eta'), 10); renderGrid();
      });
    });
    $('#f-clear', box).addEventListener('click', function () {
      state.q = ''; state.cats = []; state.inStock = false; state.maxEta = 0;
      var ns = $('#nav-search-input'); if (ns) ns.value = '';
      syncUrl(); renderFilters(); renderGrid();
    });
  }

  /* ---------- product grid ---------- */
  function cardHtml(p) {
    var avail = p.stock > 0
      ? '<span class="dot eta">Delivery in ' + p.etaDays + ' day' + (p.etaDays > 1 ? 's' : '') + '</span>'
      : '<span class="dot stock-out">Backorder</span>';
    return '<button class="product-card" data-sku="' + p.sku + '">' +
      '<div class="product-thumb"><span class="thumb-badge">' + p.category + '</span>' +
      PP.iconFor(p.icon) + '</div>' +
      '<div class="product-body">' +
      '<div class="product-mfr">' + p.manufacturer + '</div>' +
      '<div class="product-name">' + p.name + '</div>' +
      '<div class="product-meta">' +
      '<div class="product-price">' + money(p.price) +
      ' <span class="unit">/ ' + p.unit + '</span></div>' +
      '<div class="product-sub"><span class="dot rating">&#9733; ' + p.rating.toFixed(1) +
      '</span>' + avail + '</div>' +
      '<div class="product-sub"><span>Sold by ' + p.supplier + '</span></div>' +
      '</div></div></button>';
  }

  function renderGrid() {
    var list = sorted(PRODUCTS.filter(matches));
    var grid = $('#grid');
    if (!list.length) {
      grid.innerHTML = '<div class="empty-state"><h3>No parts match your search</h3>' +
        '<p>Try a different term, or clear filters. Need something not listed? ' +
        'We source it &mdash; <a href="/suppliers/">request a part</a>.</p></div>';
    } else {
      grid.innerHTML = list.map(cardHtml).join('');
      grid.querySelectorAll('.product-card').forEach(function (el) {
        el.addEventListener('click', function () {
          openDetail(el.getAttribute('data-sku'), true);
        });
      });
    }
    $('#results-count').innerHTML = '<strong>' + list.length + '</strong> part' +
      (list.length === 1 ? '' : 's') +
      (state.q ? ' for &ldquo;' + escapeHtml(state.q) + '&rdquo;' : '');
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------- product detail ---------- */
  function openDetail(sku, push) {
    var p = bySku(sku);
    if (!p) return;
    if (push) history.pushState({ sku: sku }, '', '?sku=' + encodeURIComponent(sku));
    renderDetail(p);
  }

  function renderDetail(p) {
    $('#catalog-view').hidden = true;
    var view = $('#detail-view');
    view.hidden = false;
    window.scrollTo(0, 0);

    var specs = Object.keys(p.specs).map(function (k) {
      return '<tr><td>' + k + '</td><td>' + p.specs[k] + '</td></tr>';
    }).join('');

    var stockLine = p.stock > 0
      ? '<span class="v" style="color:#1a7f4b">' + p.stock.toLocaleString() + ' in stock</span>'
      : '<span class="v" style="color:#b4431f">Backorder &middot; ' + (p.etaDays + 7) + ' days</span>';

    view.innerHTML =
      '<div class="detail"><div class="breadcrumb">' +
      '<a href="/">Home</a> &rsaquo; <a href="#" id="bc-catalog">Catalog</a> &rsaquo; ' +
      '<a href="#" id="bc-cat">' + p.category + '</a> &rsaquo; ' + p.sku + '</div>' +
      '<div class="detail-grid">' +
      '<div class="detail-gallery">' + PP.iconFor(p.icon) + '</div>' +
      '<div>' +
      '<div class="detail-mfr">' + p.manufacturer + '</div>' +
      '<h1>' + p.name + '</h1>' +
      '<div class="detail-rating"><span class="rating">&#9733; ' + p.rating.toFixed(1) +
      '</span><span>' + p.reviews + ' verified reviews</span>' +
      '<span>&middot;</span><span>SKU ' + p.sku + '</span></div>' +
      '<div class="detail-price">' + money(p.price) +
      ' <span class="unit">/ ' + p.unit + '</span></div>' +
      '<div class="detail-buybox">' +
      '<div class="buybox-row"><span>Delivery ETA</span>' +
      '<span class="v" style="color:#1a7f4b">' + etaText(p.etaDays) + '</span></div>' +
      '<div class="buybox-row"><span>Availability</span>' + stockLine + '</div>' +
      '<div class="buybox-row"><span>Sold &amp; fulfilled by</span>' +
      '<span class="v">' + p.supplier + ' &#9733; ' + p.rating.toFixed(1) + '</span></div>' +
      '<div class="qty-row"><span style="font-size:14px;font-weight:600">Qty</span>' +
      '<div class="qty-stepper"><button id="d-minus" aria-label="Decrease">&minus;</button>' +
      '<span id="d-qty">1</span><button id="d-plus" aria-label="Increase">+</button></div></div>' +
      '<button class="btn btn-primary btn-block" id="d-add">Add to order</button>' +
      '<button class="btn btn-ghost btn-block" id="d-quote" style="margin-top:9px">' +
      'Request bulk quote</button>' +
      '<div class="fee-note">PartsPort verifies the supplier, handles payment, and ' +
      'delivers the part. A ' + (FEE_RATE * 100) + '% service fee is added at checkout &mdash; ' +
      'you are not charged until the part ships.</div>' +
      '</div></div></div>' +
      '<div class="detail-specs"><h3>Specifications</h3>' +
      '<table class="spec-table"><tbody>' + specs + '</tbody></table>' +
      '<div class="detail-desc">' + p.desc + '</div></div>' +
      '<div style="margin-top:28px"><a href="#" class="btn btn-ghost btn-sm" id="bc-back">' +
      '&larr; Back to all parts</a></div>' +
      '</div>';

    var qty = 1;
    var qEl = $('#d-qty', view);
    $('#d-minus', view).addEventListener('click', function () {
      qty = Math.max(1, qty - 1); qEl.textContent = qty;
    });
    $('#d-plus', view).addEventListener('click', function () {
      qty += 1; qEl.textContent = qty;
    });
    $('#d-add', view).addEventListener('click', function () {
      addToCart(p.sku, qty); openDrawer();
    });
    $('#d-quote', view).addEventListener('click', function () {
      toast('Quote request sent &mdash; a sourcing rep will reply within 1 business day.');
    });
    ['#bc-catalog', '#bc-cat', '#bc-back'].forEach(function (id) {
      var el = $(id, view);
      if (el) el.addEventListener('click', function (e) {
        e.preventDefault();
        if (id === '#bc-cat') {
          state.cats = [p.category];
          renderFilters();
        }
        history.pushState({}, '', location.pathname);
        showCatalog();
      });
    });
  }

  function showCatalog() {
    $('#detail-view').hidden = true;
    $('#catalog-view').hidden = false;
    renderGrid();
    window.scrollTo(0, 0);
  }

  /* ---------- cart / order drawer ---------- */
  function addToCart(sku, qty) {
    var cart = CART.getCart();
    var line = cart.filter(function (i) { return i.sku === sku; })[0];
    if (line) line.qty += qty;
    else cart.push({ sku: sku, qty: qty });
    CART.saveCart(cart);
    renderDrawer();
    var p = bySku(sku);
    toast('Added &mdash; ' + p.name);
  }

  function setQty(sku, qty) {
    var cart = CART.getCart();
    if (qty <= 0) {
      cart = cart.filter(function (i) { return i.sku !== sku; });
    } else {
      cart.forEach(function (i) { if (i.sku === sku) i.qty = qty; });
    }
    CART.saveCart(cart);
    renderDrawer();
  }

  function renderDrawer() {
    var cart = CART.getCart();
    var body = $('#drawer-body');
    var foot = $('#drawer-foot');

    if (!cart.length) {
      body.innerHTML = '<div class="drawer-empty">' +
        '<p style="font-weight:600;color:#14181f">Your order is empty</p>' +
        '<p style="margin-top:6px">Add parts from the catalog to build an order.</p></div>';
      foot.innerHTML = '';
      return;
    }

    var subtotal = 0;
    var maxEta = 0;
    body.innerHTML = cart.map(function (line) {
      var p = bySku(line.sku);
      if (!p) return '';
      subtotal += p.price * line.qty;
      maxEta = Math.max(maxEta, p.etaDays);
      return '<div class="cart-item">' +
        '<div class="ci-thumb">' + PP.iconFor(p.icon) + '</div>' +
        '<div style="flex:1">' +
        '<div class="ci-mfr">' + p.manufacturer + '</div>' +
        '<div class="ci-name">' + p.name + '</div>' +
        '<div class="ci-controls">' +
        '<div class="qty-stepper"><button data-dec="' + p.sku + '">&minus;</button>' +
        '<span>' + line.qty + '</span><button data-inc="' + p.sku + '">+</button></div>' +
        '<button class="ci-remove" data-rm="' + p.sku + '">Remove</button>' +
        '<span class="ci-price">' + money(p.price * line.qty) + '</span>' +
        '</div></div></div>';
    }).join('');

    var fee = subtotal * FEE_RATE;
    foot.innerHTML =
      '<div class="fee-row" style="border:0;padding:4px 0"><span>Subtotal</span>' +
      '<span>' + money(subtotal) + '</span></div>' +
      '<div class="fee-row" style="border:0;padding:4px 0"><span>PartsPort fee &amp; delivery (' +
      (FEE_RATE * 100) + '%)</span><span class="amber">' + money(fee) + '</span></div>' +
      '<div class="fee-row total" style="border:0"><span>Order total</span>' +
      '<span>' + money(subtotal + fee) + '</span></div>' +
      '<p style="font-size:12.5px;color:#5b6573;margin:4px 0 12px">' +
      'Estimated delivery in ' + etaText(maxEta) + '.</p>' +
      '<button class="btn btn-primary btn-block" id="checkout-btn">Proceed to checkout</button>';

    body.querySelectorAll('[data-inc]').forEach(function (el) {
      el.addEventListener('click', function () {
        var sku = el.getAttribute('data-inc');
        var l = CART.getCart().filter(function (i) { return i.sku === sku; })[0];
        setQty(sku, l.qty + 1);
      });
    });
    body.querySelectorAll('[data-dec]').forEach(function (el) {
      el.addEventListener('click', function () {
        var sku = el.getAttribute('data-dec');
        var l = CART.getCart().filter(function (i) { return i.sku === sku; })[0];
        setQty(sku, l.qty - 1);
      });
    });
    body.querySelectorAll('[data-rm]').forEach(function (el) {
      el.addEventListener('click', function () { setQty(el.getAttribute('data-rm'), 0); });
    });
    $('#checkout-btn').addEventListener('click', function () {
      toast('Checkout is a demo &mdash; payment &amp; delivery would happen here.');
    });
  }

  function openDrawer() {
    renderDrawer();
    $('#drawer').classList.add('open');
    $('#drawer-overlay').classList.add('open');
  }
  function closeDrawer() {
    $('#drawer').classList.remove('open');
    $('#drawer-overlay').classList.remove('open');
  }

  /* ---------- toast ---------- */
  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.innerHTML = '<span class="check">&#10003;</span>' + msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3200);
  }

  /* ---------- url + nav search ---------- */
  function syncUrl() {
    var params = [];
    if (state.q) params.push('q=' + encodeURIComponent(state.q));
    if (state.cats.length === 1) params.push('cat=' + encodeURIComponent(state.cats[0]));
    history.replaceState({}, '', params.length ? '?' + params.join('&') : location.pathname);
  }

  function readUrl() {
    var sp = new URLSearchParams(location.search);
    if (sp.get('q')) state.q = sp.get('q');
    if (sp.get('cat')) state.cats = [sp.get('cat')];
  }

  /* ---------- init ---------- */
  function init() {
    readUrl();
    renderFilters();

    var navInput = $('#nav-search-input');
    if (navInput) {
      navInput.value = state.q;
      var form = navInput.closest('form');
      if (form) form.addEventListener('submit', function (e) {
        e.preventDefault();
        state.q = navInput.value.trim();
        history.replaceState({}, '', location.pathname);
        syncUrl();
        showCatalog();
        navInput.blur();
      });
      navInput.addEventListener('input', function () {
        state.q = navInput.value.trim();
        if (!$('#detail-view').hidden) showCatalog();
        else renderGrid();
      });
    }

    $('#sort').addEventListener('change', function (e) {
      state.sort = e.target.value; renderGrid();
    });

    $('#drawer-overlay').addEventListener('click', closeDrawer);
    $('#drawer-close').addEventListener('click', closeDrawer);
    $('#cart-btn').addEventListener('click', openDrawer);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeDrawer();
    });

    var ft = $('#filter-toggle');
    if (ft) ft.addEventListener('click', function () {
      var f = $('#filters');
      f.hidden = !f.hidden;
    });

    window.addEventListener('popstate', function () {
      var sp = new URLSearchParams(location.search);
      var sku = sp.get('sku');
      if (sku && bySku(sku)) openDetail(sku, false);
      else showCatalog();
    });

    renderDrawer();

    var sku = new URLSearchParams(location.search).get('sku');
    if (sku && bySku(sku)) renderDetail(bySku(sku));
    else renderGrid();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }

})();
