(function () {
  const { api, fmtTime, elapsed, toast, connectSocket } = window.HPRMS;
  const N = window.HPRMSNotify;
  const $ = (s) => document.querySelector(s);

  const STORAGE_KEY = 'hprms.steward.session';
  let session = null;
  let orders = [];
  let sock = null;
  const flashing = new Set();

  function readSession() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); }
    catch (_) { return null; }
  }
  function saveSession(s) {
    if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STORAGE_KEY);
  }

  async function boot() {
    const m = location.pathname.match(/^\/steward\/(\d+)/);
    const explicitId = m ? parseInt(m[1], 10) : null;
    session = readSession();
    if (explicitId && (!session || session.id !== explicitId)) {
      session = null;
    }
    if (session && session.id && session.token) {
      window.HPRMS.setOperatorToken(session.token);
      await mountApp();
    } else showLogin();
  }

  function showLogin() {
    $('#loginGate').hidden = false;
    $('#appHdr').hidden = true;
    $('#kdsGrid').hidden = true;
    setTimeout(() => $('#pinInput').focus(), 50);
  }

  $('#loginBtn').addEventListener('click', login);
  $('#pinInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });

  async function login() {
    const pin = $('#pinInput').value.trim();
    $('#loginErr').textContent = '';
    if (!pin) { $('#loginErr').textContent = 'Enter your PIN.'; return; }
    try {
      const r = await api('/stewards/login', { method: 'POST', body: { pin } });
      session = { ...r.steward, token: r.token };
      saveSession(session);
      $('#pinInput').value = '';
      await mountApp();
    } catch (e) {
      $('#loginErr').textContent = e.message || 'Sign-in failed';
    }
  }

  $('#logoutBtn').addEventListener('click', () => {
    saveSession(null);
    window.HPRMS.clearOperatorToken();
    if (sock) try { sock.disconnect(); } catch (_) {}
    sock = null;
    session = null;
    orders = [];
    history.replaceState({}, '', '/steward');
    showLogin();
  });

  async function mountApp() {
    history.replaceState({}, '', '/steward/' + session.id);
    $('#loginGate').hidden = true;
    $('#appHdr').hidden = false;
    $('#kdsGrid').hidden = false;
    $('#hdrTitle').textContent = session.name;
    $('#hdrBadge').textContent = 'St #' + session.id;
    N.setBaseTitle('Steward ' + session.name);
    N.requestDesktop();

    window.HPRMS.setOperatorToken(session.token);

    if (sock) { try { sock.disconnect(); } catch (_) {} }
    sock = connectSocket(['steward:' + session.id, 'role:steward']);
    sock.on('order:assigned', onAssigned);
    sock.on('order:ready', onReady);
    sock.on('order:update', onUpdate);

    await refresh();
    setInterval(render, 30000);
  }

  async function refresh() {
    orders = await api('/stewards/' + session.id + '/orders');
    // Re-arm any ready orders that were already waiting when we opened the page.
    N.stopAllRings();
    for (const o of orders) if (o.status === 'ready') startRingFor(o);
    render();
  }

  function ringKey(o) { return 'st-' + session.id + '-' + o.id; }
  function startRingFor(o) {
    flashing.add(o.id);
    N.startRing(ringKey(o), {
      label: 'Order ready - Table ' + o.table_id,
      profile: 'default',
      desktop: {
        title: 'READY \u00B7 Table ' + o.table_id,
        body: 'Pick up from ' + (o.station === 'BAR' ? 'Klong' : 'Dopwai'),
        tag: ringKey(o),
      },
    });
  }
  function stopRingFor(o) {
    flashing.delete(o.id);
    N.stopRing(ringKey(o));
  }

  function render() {
    const root = $('#kdsGrid');
    const ready = orders.filter((o) => o.status === 'ready').length;
    const active = orders.length;
    $('#kdsCount').textContent = ready + ' ready / ' + active + ' total';
    if (orders.length === 0) {
      root.innerHTML = '<div class="empty"><h3>No assignments right now</h3><p>You\'ll be alerted as soon as an order is assigned to you.</p></div>';
      return;
    }
    root.innerHTML = '';
    for (const o of orders) root.appendChild(card(o));
  }

  function card(o) {
    const w = document.createElement('div');
    w.className = 'ticket ' + o.status;
    if (flashing.has(o.id)) w.classList.add('flash');
    const items = o.items.map((it) => `
      <li>
        <span class="qty">${it.qty}\u00D7</span>
        <span class="nm">${it.name}${needsVariantLabel(it.variant_label) ? '<small>' + it.variant_label + '</small>' : ''}</span>
      </li>`).join('');
    const stationPill = o.station === 'BAR'
      ? '<span class="station-pill bar">PICK FROM KLONG</span>'
      : '<span class="station-pill">PICK FROM DOPWAI</span>';
    const statusPill = `<span class="status-pill ${o.status}">${o.status.toUpperCase()}</span>`;
    const action = o.status === 'ready'
      ? `<button class="btn success" data-id="${o.id}">Mark Delivered</button>`
      : `<button class="btn ghost" disabled>${labelFor(o.status)}</button>`;
    const ts = o.ready_at || o.created_at;
    w.innerHTML = `
      <div class="top">
        <div>
          <div class="table">TABLE ${o.table_id}${stationPill}${statusPill}</div>
          <div class="kot">${o.kot_no} \u00B7 ${fmtTime(ts)}</div>
        </div>
        <div class="age">${elapsed(ts)}</div>
      </div>
      <ul>${items}</ul>
      <div class="actions">${action}</div>`;
    w.addEventListener('click', async (e) => {
      const id = e.target.dataset.id;
      if (!id) return;
      stopRingFor(o);
      try {
        await api('/orders/' + id + '/transition', { method: 'POST', body: { to: 'delivered', actor: 'steward:' + session.id } });
        toast('Delivered to Table ' + o.table_id);
      } catch (err) {
        toast(err.message);
        if (o.status === 'ready') startRingFor(o);
      }
    });
    return w;
  }

  function labelFor(status) {
    if (status === 'placed') return 'Waiting for kitchen / bar to accept...';
    if (status === 'accepted') return 'Cooking - not ready yet';
    return status;
  }

  function needsVariantLabel(v) {
    if (!v) return false;
    return !['plate', 'bowl', 'glass', 'cup', 'piece', 'shot', 'house'].includes(v);
  }

  function onAssigned(o) {
    if (o.steward_id !== session.id) return;
    if (!orders.find((x) => x.id === o.id)) orders.push(o);
    render();
    // Soft single chime - not a persistent ring (the steward isn't blocked yet).
    N.notify({
      title: 'New assignment \u00B7 Table ' + o.table_id,
      body: o.items.map((it) => it.qty + '\u00D7 ' + it.name).join(', '),
      profile: 'soft',
      tag: 'st-' + session.id + '-' + o.id,
    });
    toast('Assigned: ' + o.kot_no);
  }

  function onReady(o) {
    if (o.steward_id !== session.id) return;
    const idx = orders.findIndex((x) => x.id === o.id);
    if (idx >= 0) orders[idx] = o; else orders.push(o);
    render();
    startRingFor(o);   // <-- persistent ring until delivered
  }

  function onUpdate(o) {
    if (o.steward_id !== session.id) return;
    const idx = orders.findIndex((x) => x.id === o.id);
    if (['delivered', 'cancelled'].includes(o.status)) {
      stopRingFor(o);
      if (idx >= 0) orders.splice(idx, 1);
    } else if (idx >= 0) {
      orders[idx] = o;
    } else {
      orders.push(o);
    }
    render();
  }

  boot();
})();
