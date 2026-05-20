/* PartsPort — shared site behavior: mobile nav + cart badge */
(function () {
  'use strict';
  var KEY = 'partsport_cart_v1';

  function getCart() {
    try { return JSON.parse(localStorage.getItem(KEY)) || []; }
    catch (e) { return []; }
  }
  function saveCart(c) { localStorage.setItem(KEY, JSON.stringify(c)); updateBadge(); }
  function count() { return getCart().reduce(function (n, i) { return n + i.qty; }, 0); }

  function updateBadge() {
    var c = count();
    document.querySelectorAll('[data-cart-count]').forEach(function (el) {
      el.textContent = c;
      el.hidden = c === 0;
    });
  }

  var toggle = document.querySelector('.nav-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var links = document.querySelector('.nav-links');
      if (links) links.classList.toggle('open');
    });
  }

  window.PartsPortCart = { KEY: KEY, getCart: getCart, saveCart: saveCart, count: count, updateBadge: updateBadge };
  updateBadge();
})();
