/* Shared kitchen / bar display logic. Pass station = "BAR" or "KITCHEN" */
window.HPRMS_KDS = function (station) {
  const { api, fmtTime, elapsed, toast, connectSocket, setOperatorToken, clearOperatorToken, normalizeOperatorPinInput } =
    window.HPRMS;
  const N = window.HPRMSNotify;
  const stationLabel = station === 'BAR' ? 'Klong Bar' : 'Dopwai Kitchen';
  N.setBaseTitle(stationLabel + ' - HPRMS');
  N.requestDesktop();

  const ROLE = station === 'BAR' ? 'bar' : 'kitchen';
  const TOKEN_KEY = 'hprms.saved.' + ROLE;

  const $ = (s) => document.querySelector(s);
  const root = $('#kdsGrid');
  const counter = $('#kdsCount');
  let orders = [];
  const flashing = new Set();
  let sock = null;

  async function load() {
    orders = await api('/orders?station=' + station + '&statuses=placed,accepted,ready');
    for (const o of orders) {
      if (o.status === 'placed') startRingFor(o);
    }
    render();
  }

  function ringKey(o) {
    return 'kds-' + station + '-' + o.id;
  }

  function startRingFor(o) {
    N.startRing(ringKey(o), {
      label: 'New ' + (station === 'BAR' ? 'Klong' : 'Dopwai') + ' KOT',
      profile: 'default',
      desktop: {
        title: 'New order \u00B7 Table ' + o.table_id,
        body: o.items.map((it) => it.qty + '\u00D7 ' + it.name).join(', '),
        tag: 'order-' + o.id,
      },
    });
    flashing.add(o.id);
  }

  function stopRingFor(o) {
    N.stopRing(ringKey(o));
    flashing.delete(o.id);
  }

  function render() {
    counter.textContent = orders.length + ' active';
    if (orders.length === 0) {
      flashing.clear();
      root.innerHTML =
        '<div class="empty"><h3>No active orders</h3><p>New tickets will appear here in real-time.</p></div>';
      return;
    }
    root.innerHTML = '';
    for (const o of orders) root.appendChild(ticket(o));
  }

  function ticket(o) {
    const wrap = document.createElement('div');
    wrap.className = 'ticket ' + o.status;
    if (flashing.has(o.id)) wrap.classList.add('flash');
    const ageMin = ageMinutes(o.created_at);
    const ageCls = ageMin >= 10 ? 'bad' : ageMin >= 5 ? 'warn' : '';
    const items = o.items
      .map(
        (it) => `
      <li>
        <span class="qty">${it.qty}\u00D7</span>
        <span class="nm">${it.name}${needsVariantLabel(it.variant_label) ? `<small>${it.variant_label}</small>` : ''}${it.note ? `<small>note: ${it.note}</small>` : ''}</span>
      </li>`
      )
      .join('');
    const noteBlock = o.note ? `<div class="note">Note: ${o.note}</div>` : '';
    const stewardBadge = o.steward_id
      ? `<span class="chip muted" style="margin-left:6px">St #${o.steward_id}</span>`
      : '';
    wrap.innerHTML = `
      <div class="top">
        <div>
          <div class="table">TABLE ${o.table_id}${stewardBadge}</div>
          <div class="kot">${o.kot_no} \u00B7 ${fmtTime(o.created_at)}</div>
        </div>
        <div class="age ${ageCls}">${elapsed(o.created_at)}</div>
      </div>
      <ul>${items}</ul>
      ${noteBlock}
      <div class="actions">${actionButtons(o)}</div>`;
    wrap.addEventListener('click', async (e) => {
      const to = e.target.dataset.to;
      if (!to) return;
      stopRingFor(o);
      try {
        await api('/orders/' + o.id + '/transition', {
          method: 'POST',
          body: { to, actor: station.toLowerCase() },
        });
        toast('Order ' + o.kot_no + ' \u2192 ' + to);
      } catch (err) {
        toast(err.message);
        if (o.status === 'placed') startRingFor(o);
      }
    });
    return wrap;
  }

  function actionButtons(o) {
    if (o.status === 'placed') {
      return `<button class="btn ghost" data-to="cancelled">Cancel</button>
              <button class="btn" data-to="accepted">Accept</button>`;
    }
    if (o.status === 'accepted') {
      return `<button class="btn danger" data-to="cancelled">Cancel</button>
              <button class="btn success" data-to="ready">Mark Ready</button>`;
    }
    if (o.status === 'ready') {
      return `<button class="btn gold" disabled>Awaiting steward...</button>`;
    }
    return '';
  }

  function needsVariantLabel(v) {
    if (!v) return false;
    return !['plate', 'bowl', 'glass', 'cup', 'piece', 'shot', 'house'].includes(v);
  }

  function ageMinutes(iso) {
    if (!iso) return 0;
    const d = new Date(iso.endsWith('Z') || iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
    return Math.floor((Date.now() - d.getTime()) / 60000);
  }

  function showGate() {
    $('#kdsLoginGate').hidden = false;
    $('#kdsAppHdr').hidden = true;
    $('#kdsGrid').hidden = true;
    $('#kdsPinInput').value = '';
    setTimeout(() => $('#kdsPinInput').focus(), 50);
  }

  function hideGate() {
    $('#kdsLoginGate').hidden = true;
    $('#kdsAppHdr').hidden = false;
    $('#kdsGrid').hidden = false;
  }

  async function mount() {
    $('#kdsLoginErr').textContent = '';
    hideGate();

    if (sock) {
      try {
        sock.disconnect();
      } catch (_) {}
    }
    sock = connectSocket([station === 'BAR' ? 'station:bar' : 'station:kitchen']);

    sock.on('order:new', (o) => {
      if (o.station !== station) return;
      orders.unshift(o);
      render();
      startRingFor(o);
      toast('New ' + (station === 'BAR' ? 'Klong' : 'Dopwai') + ' KOT \u00B7 Table ' + o.table_id);
    });
    sock.on('order:update', (o) => {
      if (o.station !== station) return;
      const idx = orders.findIndex((x) => x.id === o.id);
      if (idx >= 0) {
        if (['delivered', 'cancelled', 'accepted', 'ready'].includes(o.status)) {
          stopRingFor(o);
        }
        if (['delivered', 'cancelled'].includes(o.status)) orders.splice(idx, 1);
        else orders[idx] = o;
      } else if (!['delivered', 'cancelled'].includes(o.status)) {
        orders.push(o);
      }
      render();
    });

    await load();
    setInterval(render, 30000);
  }

  async function tryResume() {
    const tok = sessionStorage.getItem(TOKEN_KEY);
    if (tok) {
      setOperatorToken(tok);
      try {
        await api('/orders?station=' + station + '&statuses=placed');
        await mount();
        return;
      } catch (_) {
        clearOperatorToken();
        sessionStorage.removeItem(TOKEN_KEY);
      }
    }
    showGate();
  }

  async function doLogin() {
    $('#kdsLoginErr').textContent = '';
    const pin = normalizeOperatorPinInput($('#kdsPinInput').value);
    if (!pin) {
      $('#kdsLoginErr').textContent = 'Enter PIN.';
      return;
    }
    try {
      const r = await api('/auth/login', {
        method: 'POST',
        body: { role: ROLE, pin },
        skipGuestHeader: true,
      });
      sessionStorage.setItem(TOKEN_KEY, r.token);
      setOperatorToken(r.token);
      await mount();
    } catch (e) {
      $('#kdsLoginErr').textContent = e.message || 'Sign-in failed';
    }
  }

  $('#kdsLoginBtn').addEventListener('click', doLogin);
  $('#kdsPinInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
  });
  $('#kdsLogoutBtn').addEventListener('click', () => {
    sessionStorage.removeItem(TOKEN_KEY);
    clearOperatorToken();
    if (sock) {
      try {
        sock.disconnect();
      } catch (_) {}
    }
    sock = null;
    orders = [];
    showGate();
  });

  tryResume();
};
