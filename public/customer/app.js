(function () {
  const { api, fmtMoney, fmtTime, toast, connectSocket } = window.HPRMS;
  const N = window.HPRMSNotify;

  const tableId = parseInt(location.pathname.split('/').pop(), 10);
  if (!tableId || isNaN(tableId)) {
    document.body.innerHTML = '<div style="padding:60px 24px;text-align:center;font-family:Georgia,serif;color:#7a1e1e"><h2>Invalid table</h2><p>Please re-scan the QR code on your table.</p></div>';
    return;
  }

  const guestTokenRaw = new URLSearchParams(location.search).get('t');
  const guestToken = guestTokenRaw ? guestTokenRaw.trim() : '';
  if (!guestToken) {
    document.body.innerHTML =
      '<div style="padding:60px 24px;text-align:center;font-family:Georgia,serif;color:#7a1e1e"><h2>QR link incomplete</h2><p>This menu link is missing the guest token. Please scan the QR printed for this table (run <code style="font-size:13px">npm run qr</code> after upgrading).</p></div>';
    return;
  }
  window.HPRMS.setTableGuestAuth(tableId, guestToken);

  const STORAGE_KEY = `hprms.cart.${tableId}`;
  let cart = [];
  try { cart = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch (_) {}
  let menu = null;
  let table = null;
  let cfg = null;
  let activeOutlet = 'dopwai';
  let searchQuery = '';

  const TAGLINES = {
    dopwai: 'Wrapped in heritage. Served on Ka Dopwai.',
    klong:  'Restored by tradition. The spirit of Um Klong.',
  };
  const LOGOS = {
    dopwai: '/assets/dopwai-light.svg',
    klong: null, /* wordmark is typographic HTML (#heroBrandKlong), not an image */
  };
  const THEME_COLOR = {
    dopwai: '#0e2a1e',
    klong:  '#0d0614',
  };

  function saveCart() { localStorage.setItem(STORAGE_KEY, JSON.stringify(cart)); }
  function $(s, c=document) { return c.querySelector(s); }
  function $$(s, c=document) { return Array.from(c.querySelectorAll(s)); }

  function syncOutletTabAttrs() {
    $$('.oswitch').forEach((b) => {
      const sel = b.dataset.outlet === activeOutlet;
      b.classList.toggle('active', sel);
      b.setAttribute('aria-selected', String(sel));
    });
  }

  function scrollActiveOutletIntoView() {
    const row = $('#outletSlider');
    const btn = row && row.querySelector('.oswitch.active');
    if (!row || !btn) return;
    if (window.matchMedia('(min-width: 600px)').matches) return;
    btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }

  function setupScrollTop() {
    const btn = $('#scrollTopBtn');
    if (!btn) return;
    let ticking = false;
    const threshold = 260;
    function update() {
      ticking = false;
      btn.hidden = window.scrollY <= threshold;
    }
    window.addEventListener('scroll', () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(update);
      }
    }, { passive: true });
    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    update();
  }

  function setupCatStripSlider() {
    const scrollEl = $('#catStripScroll');
    const wrap = $('#catStripWrap');
    const prev = $('#catStripPrev');
    const next = $('#catStripNext');
    if (!scrollEl || !wrap) return;

    const update = () => {
      const max = scrollEl.scrollWidth - scrollEl.clientWidth;
      const scrollable = max > 8;
      wrap.classList.toggle('cat-strip-wrap--scrollable', scrollable);
      const sl = scrollEl.scrollLeft;
      const atStart = !scrollable || sl <= 8;
      const atEnd = !scrollable || sl >= max - 8;
      wrap.classList.toggle('cat-strip-wrap--at-start', atStart);
      wrap.classList.toggle('cat-strip-wrap--at-end', atEnd);
      if (prev) prev.hidden = atStart || !scrollable;
      if (next) next.hidden = atEnd || !scrollable;
    };

    scrollEl.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
    window.addEventListener('resize', () => requestAnimationFrame(update), { passive: true });

    const step = () => Math.min(280, Math.max(120, scrollEl.clientWidth * 0.82));
    if (prev) {
      prev.addEventListener('click', () => {
        scrollEl.scrollBy({ left: -step(), behavior: 'smooth' });
      });
    }
    if (next) {
      next.addEventListener('click', () => {
        scrollEl.scrollBy({ left: step(), behavior: 'smooth' });
      });
    }

    wrap._catStripSliderUpdate = update;
    update();
  }

  async function boot() {
    try {
      [cfg, table, menu] = await Promise.all([
        api('/config'),
        api('/tables/' + tableId),
        api('/menu'),
      ]);
    } catch (e) {
      $('#menuRoot').innerHTML = `<p style="color:#b3261e;text-align:center;padding:40px">Could not load menu: ${e.message}</p>`;
      return;
    }
    activeOutlet = table.outlet || 'dopwai';
    applyOutletTheme(activeOutlet);

    $('#tablePill .tb-id').textContent = table.label;
    $('#sheetTable').textContent = table.label;
    $('#ttGstPct').textContent = '(' + cfg.gst_percent + '%)';
    if (cfg.service_charge_percent > 0) {
      $('#ttSvcRow').hidden = false;
      $('#ttSvcRow span').textContent = `Service (${cfg.service_charge_percent}%)`;
    }

    setupOutletTabs();
    setupSearch();
    setupStoryToggle();
    renderOutlet(activeOutlet);
    renderCart();
    requestAnimationFrame(() => requestAnimationFrame(scrollActiveOutletIntoView));
    refreshSessionStatus();
    N.requestDesktop();

    const sock = connectSocket([`table:${tableId}`], {
      guestTableId: tableId,
      guestToken,
    });
    sock.on('order:update', refreshSessionStatus);
    sock.on('order:cancelled', (o) => {
      refreshSessionStatus();
      showBigAlert({
        kind: 'cancel',
        title: 'Order Cancelled',
        kot: 'KOT ' + o.kot_no + ' \u00B7 ' + (o.station === 'BAR' ? 'Klong' : 'Dopwai'),
        body: 'The ' + (o.station === 'BAR' ? 'bar' : 'kitchen') + ' was unable to prepare this order. Please ask a steward if you need help.',
      });
    });
    sock.on('order:delivered', (o) => {
      refreshSessionStatus();
      showAlert({
        kind: 'ok',
        title: 'Delivered',
        body: 'KOT ' + o.kot_no + ' has reached your table. Enjoy!',
      });
    });
  }

  function applyOutletTheme(outlet) {
    document.body.dataset.outlet = outlet;
    const tc = document.getElementById('themeColor');
    if (tc) tc.setAttribute('content', THEME_COLOR[outlet] || '#1a1024');
    const logo = $('#heroLogo');
    const brandTxt = $('#heroBrandKlong');
    const isKlong = outlet === 'klong';

    if (brandTxt) {
      brandTxt.hidden = !isKlong;
      brandTxt.setAttribute('aria-hidden', String(!isKlong));
    }
    if (logo) {
      logo.hidden = isKlong;
      logo.setAttribute('aria-hidden', String(isKlong));
      if (!isKlong) {
        logo.src = LOGOS[outlet] || '/assets/logo.png';
        logo.alt = outlet === 'dopwai' ? 'Dopwai Restaurant' : 'Outlet';
      }
    }
    $('#heroTag').textContent = TAGLINES[outlet] || '';
    const dop = $('#dopwaiStory');
    if (dop) dop.hidden = outlet !== 'dopwai';
    const kls = $('#klongStory');
    if (kls) kls.hidden = outlet !== 'klong';
  }

  function setupStoryToggle() {
    $$('.story-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const panelId = btn.getAttribute('data-story-panel');
        const panel = panelId ? document.getElementById(panelId) : btn.closest('.story-panel');
        if (!panel) return;
        const more = panel.querySelector('.story-more');
        if (!more) return;
        const lblMore = btn.querySelector('.lbl-more');
        const lblLess = btn.querySelector('.lbl-less');
        const expanded = btn.getAttribute('aria-expanded') === 'true';
        const next = !expanded;
        btn.setAttribute('aria-expanded', String(next));
        more.hidden = !next;
        if (lblMore) lblMore.hidden = next;
        if (lblLess) lblLess.hidden = !next;
      });
    });
  }

  function setupOutletTabs() {
    $$('.oswitch').forEach((btn) => {
      btn.addEventListener('click', () => {
        const o = btn.dataset.outlet;
        if (o === activeOutlet) return;
        activeOutlet = o;
        syncOutletTabAttrs();
        applyOutletTheme(o);
        renderOutlet(o);
        scrollActiveOutletIntoView();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
    });
    syncOutletTabAttrs();
  }

  function setupSearch() {
    const input = $('#menuSearch');
    const clear = $('#searchClear');
    let t;
    input.addEventListener('input', (e) => {
      searchQuery = e.target.value.trim().toLowerCase();
      clear.hidden = !searchQuery;
      clearTimeout(t);
      t = setTimeout(() => renderOutlet(activeOutlet), 100);
    });
    clear.addEventListener('click', () => {
      input.value = '';
      searchQuery = '';
      clear.hidden = true;
      renderOutlet(activeOutlet);
      input.focus();
    });
  }

  function filterCategoryItems(cat) {
    if (!searchQuery) return cat.items;
    return cat.items.filter((it) =>
      it.name.toLowerCase().includes(searchQuery) ||
      (it.description || '').toLowerCase().includes(searchQuery) ||
      (it.variants || []).some((v) => (v.label || '').toLowerCase().includes(searchQuery))
    );
  }

  function renderOutlet(outletKey) {
    let cats = menu.categories.filter((c) => c.outlet === outletKey);
    let totalShown = 0;
    if (searchQuery) {
      cats = cats
        .map((c) => ({ ...c, items: filterCategoryItems(c) }))
        .filter((c) => c.items.length > 0);
    }
    cats.forEach((c) => { totalShown += c.items.length; });

    const strip = $('#catStrip');
    strip.innerHTML = '';
    cats.forEach((c, i) => {
      const b = document.createElement('button');
      b.textContent = c.name;
      b.dataset.cat = c.id;
      if (i === 0) b.classList.add('active');
      b.addEventListener('click', () => {
        $$('.cat-strip button').forEach((x) => x.classList.remove('active'));
        b.classList.add('active');
        b.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        const target = document.getElementById('cat-' + c.id);
        if (target) {
          const top = target.getBoundingClientRect().top + window.scrollY - 130;
          window.scrollTo({ top, behavior: 'smooth' });
        }
      });
      strip.appendChild(b);
    });

    const wrap = $('#catStripWrap');
    if (wrap && wrap._catStripSliderUpdate) {
      requestAnimationFrame(() => requestAnimationFrame(() => wrap._catStripSliderUpdate()));
    }

    const root = $('#menuRoot');
    root.innerHTML = '';
    $('#searchEmpty').hidden = !(searchQuery && totalShown === 0);

    if (cats.length === 0 && !searchQuery) {
      root.innerHTML = '<p style="text-align:center;padding:40px;color:var(--muted)">No items in this outlet right now.</p>';
      return;
    }
    for (const cat of cats) {
      const block = document.createElement('div');
      block.className = 'cat-block';
      block.id = 'cat-' + cat.id;
      block.innerHTML = `<h2>${cat.name}</h2>`;
      for (const it of cat.items) block.appendChild(itemNode(it));
      root.appendChild(block);
    }
  }

  function qtyInCart(itemId, variant) {
    return cart
      .filter((c) => c.menu_item_id === itemId && c.variant_label === variant)
      .reduce((s, c) => s + c.qty, 0);
  }

  function itemNode(it) {
    const wrap = document.createElement('div');
    wrap.className = 'item';
    const veg = it.veg === true ? 'veg' : it.veg === false ? 'nv' : '';
    const variants = it.variants || [];
    const minPrice = variants.length ? Math.min(...variants.map((v) => v.price)) : 0;
    const priceLabel = variants.length > 1
      ? `from ${fmtMoney(minPrice)}`
      : fmtMoney(minPrice);
    const inCart = variants.length === 1
      ? qtyInCart(it.id, variants[0].label)
      : variants.reduce((s, v) => s + qtyInCart(it.id, v.label), 0);

    wrap.innerHTML = `
      ${veg ? `<span class="veg-mark ${veg === 'nv' ? 'nv' : ''}"></span>` : '<span class="veg-spacer"></span>'}
      <div class="body">
        <h4>${it.name}</h4>
        ${it.description ? `<p>${it.description}</p>` : ''}
        <div class="row">
          <span class="price">${priceLabel}</span>
          <div class="action"></div>
        </div>
      </div>`;
    const action = $('.action', wrap);
    if (variants.length === 1 && inCart > 0) {
      action.appendChild(qtyControl(it, variants[0]));
    } else {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'add';
      btn.textContent = inCart > 0 ? `${inCart} \u00B7 add more` : (variants.length > 1 ? 'Choose' : 'Add +');
      btn.addEventListener('click', () => {
        if (variants.length === 1) addToCart(it, variants[0], 1);
        else openVariants(it);
      });
      action.appendChild(btn);
    }
    return wrap;
  }

  function qtyControl(it, variant) {
    const w = document.createElement('div');
    w.className = 'qty';
    w.innerHTML = '<button type="button" data-act="-">\u2212</button><span></span><button type="button" data-act="+">+</button>';
    const span = $('span', w);
    const refresh = () => { span.textContent = qtyInCart(it.id, variant.label); };
    refresh();
    w.addEventListener('click', (e) => {
      const a = e.target.dataset.act;
      if (a === '+') addToCart(it, variant, 1);
      if (a === '-') addToCart(it, variant, -1);
      refresh();
    });
    return w;
  }

  function openVariants(it) {
    if (!it || !Array.isArray(it.variants) || it.variants.length === 0) {
      toast('No options available for this item.');
      return;
    }
    $('#vmName').textContent = it.name || 'Choose option';
    if (it.description) { $('#vmDesc').hidden = false; $('#vmDesc').textContent = it.description; }
    else { $('#vmDesc').hidden = true; }
    const list = $('#vmVariants');
    list.innerHTML = '';
    for (const v of it.variants) {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = `<span>${v.label}</span><b>${fmtMoney(v.price)}</b>`;
      b.addEventListener('click', () => { addToCart(it, v, 1); closeAll(); renderOutlet(activeOutlet); });
      list.appendChild(b);
    }
    open('#variantModal');
  }

  function addToCart(it, variant, delta) {
    const idx = cart.findIndex((c) => c.menu_item_id === it.id && c.variant_label === variant.label);
    if (idx >= 0) {
      cart[idx].qty += delta;
      if (cart[idx].qty <= 0) cart.splice(idx, 1);
    } else if (delta > 0) {
      cart.push({
        menu_item_id: it.id, variant_label: variant.label,
        name: it.name, unit_price: variant.price, qty: delta,
      });
    }
    saveCart();
    renderOutlet(activeOutlet);
    renderCart();
  }

  function renderCart() {
    const fab = $('#cartFab');
    const placeBtn = $('#placeBtn');
    const emptyMsg = $('#emptyCartMsg');
    if (cart.length === 0) {
      fab.hidden = true;
      document.body.classList.remove('has-cart-fab');
      if (placeBtn) placeBtn.disabled = true;
      if (emptyMsg) emptyMsg.hidden = false;
      $('#cartList').innerHTML = '';
      $('#ttSub').textContent = fmtMoney(0);
      $('#ttGst').textContent = fmtMoney(0);
      $('#ttGrand').textContent = fmtMoney(0);
      closeAll();
      return;
    }
    if (emptyMsg) emptyMsg.hidden = true;
    fab.hidden = false;
    document.body.classList.add('has-cart-fab');
    if (placeBtn) placeBtn.disabled = false;
    const totals = compute();
    $('#cartCount').textContent = cart.reduce((s, c) => s + c.qty, 0);
    $('#cartAmt').textContent = fmtMoney(totals.subtotal);

    const list = $('#cartList');
    list.innerHTML = '';
    cart.forEach((c, i) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="nm">
          ${c.name}
          ${needsVariantLabel(c.variant_label) ? `<small>${c.variant_label}</small>` : ''}
        </div>
        <div class="qty">
          <button type="button" data-i="${i}" data-d="-1">\u2212</button>
          <span>${c.qty}</span>
          <button type="button" data-i="${i}" data-d="+1">+</button>
        </div>
        <div class="lt">${fmtMoney(c.qty * c.unit_price)}</div>`;
      list.appendChild(li);
    });
    list.onclick = (e) => {
      const i = e.target.dataset.i;
      if (i == null) return;
      cart[i].qty += parseInt(e.target.dataset.d, 10);
      if (cart[i].qty <= 0) cart.splice(i, 1);
      saveCart();
      renderOutlet(activeOutlet);
      renderCart();
    };

    $('#ttSub').textContent = fmtMoney(totals.subtotal);
    $('#ttGst').textContent = fmtMoney(totals.gst);
    $('#ttSvc').textContent = fmtMoney(totals.svc);
    $('#ttGrand').textContent = fmtMoney(totals.grand);
  }

  function needsVariantLabel(v) {
    if (!v) return false;
    return !['plate', 'bowl', 'glass', 'cup', 'piece', 'shot', 'house'].includes(v);
  }

  function compute() {
    const sub = cart.reduce((s, c) => s + c.qty * c.unit_price, 0);
    const svcPct = cfg ? cfg.service_charge_percent : 0;
    const gstPct = cfg ? cfg.gst_percent : 5;
    const svc = +(sub * (svcPct / 100)).toFixed(2);
    const gst = +((sub + svc) * (gstPct / 100)).toFixed(2);
    return { subtotal: +sub.toFixed(2), svc, gst, grand: +(sub + svc + gst).toFixed(2) };
  }

  $('#cartFab').addEventListener('click', () => open('#cartSheet'));

  document.addEventListener('click', (e) => {
    const closer = e.target.closest('[data-close]');
    if (closer) {
      e.preventDefault();
      e.stopPropagation();
      closeAll();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Esc') closeAll();
  });

  function open(sel) {
    const el = $(sel); if (!el) return;
    el.hidden = false; el.setAttribute('aria-hidden', 'false');
  }
  function closeAll() {
    $$('.sheet, .modal').forEach((x) => { x.hidden = true; x.setAttribute('aria-hidden', 'true'); });
  }

  $('#placeBtn').addEventListener('click', async () => {
    if (cart.length === 0) return;
    const btn = $('#placeBtn');
    btn.disabled = true; btn.textContent = 'Placing...';
    try {
      await api('/orders', {
        method: 'POST',
        body: {
          table_id: tableId,
          cart: cart.map((c) => ({ menu_item_id: c.menu_item_id, variant_label: c.variant_label, qty: c.qty })),
          note: $('#orderNote').value || undefined,
        },
      });
      cart = [];
      saveCart();
      $('#orderNote').value = '';
      renderCart();
      renderOutlet(activeOutlet);
      closeAll();
      showAlert({ kind: 'ok', title: 'Order placed', body: 'The kitchen / bar has it. A steward will deliver shortly.' });
      refreshSessionStatus();
    } catch (e) {
      toast('Could not place: ' + e.message);
    } finally {
      btn.disabled = false; btn.textContent = 'Place Order';
    }
  });

  async function refreshSessionStatus() {
    try {
      const s = await api('/sessions/by-table/' + tableId);
      if (!s || !s.orders || s.orders.length === 0) {
        $('#statusSection').hidden = true;
        return;
      }
      $('#statusSection').hidden = false;
      const list = $('#ordersList');
      list.innerHTML = '';
      for (const o of s.orders) {
        const li = document.createElement('li');
        const items = o.items.map((it) => `${it.qty}\u00D7 ${it.name}${needsVariantLabel(it.variant_label) ? ' ('+it.variant_label+')' : ''}`).join(', ');
        const chip = statusChip(o.status);
        const station = o.station === 'BAR' ? 'Klong' : 'Dopwai';
        li.innerHTML = `
          <div class="head">
            <strong style="font-family:var(--serif);font-size:16px">${station}</strong>
            ${chip}
          </div>
          <div class="muted" style="font-size:13px">${items}</div>
          <div class="kot">KOT ${o.kot_no} \u00B7 placed ${fmtTime(o.created_at)}</div>`;
        list.appendChild(li);
      }
    } catch (_) {}
  }

  function statusChip(status) {
    const map = {
      placed:    ['warn',  'Placed'],
      accepted:  ['gold',  'Preparing'],
      ready:     ['',      'Ready'],
      delivered: ['veg',   'Delivered'],
      cancelled: ['nv',    'Cancelled'],
    };
    const [cls, label] = map[status] || ['muted', status];
    return `<span class="chip ${cls}">${label}</span>`;
  }

  // ---------- Sticky info banner (used for non-blocking info) ----------
  function showAlert({ kind, title, body }) {
    const el = $('#alertBanner');
    if (!el) return;
    el.className = 'alert ' + (kind || 'info');
    el.innerHTML = `<strong>${title}</strong><span>${body}</span><button type="button" data-close-alert aria-label="Dismiss">&times;</button>`;
    el.hidden = false;
    el.querySelector('[data-close-alert]').addEventListener('click', () => { el.hidden = true; });
    clearTimeout(el._h);
    el._h = setTimeout(() => { el.hidden = true; }, 9000);
  }

  // ---------- Prominent full-screen alert (cancellations on guest's phone) ----------
  function showBigAlert({ kind, title, kot, body }) {
    const el = $('#bigAlert');
    el.className = 'bigalert ' + (kind === 'ok' ? 'ok' : '');
    $('#baTitle').textContent = title;
    $('#baKot').textContent = kot || '';
    $('#baBody').textContent = body;
    el.hidden = false;
    el.setAttribute('aria-hidden', 'false');

    // 3-tone urgent chime + strong vibration burst (mobile).
    N.chord('urgent');
    setTimeout(() => N.chord('urgent'), 700);
    if (navigator.vibrate) {
      try { navigator.vibrate([400, 120, 400, 120, 600]); } catch (_) {}
    }
    // Trigger native push notification too if user is on another tab.
    try {
      if ('Notification' in window && Notification.permission === 'granted'
          && document.visibilityState !== 'visible') {
        new Notification(title, { body: body, icon: '/assets/logo.png', tag: 'cancel-' + (kot || Date.now()) });
      }
    } catch (_) {}
  }
  $('#baAck').addEventListener('click', () => {
    $('#bigAlert').hidden = true;
    $('#bigAlert').setAttribute('aria-hidden', 'true');
  });

  setupScrollTop();
  setupCatStripSlider();
  boot();
})();
