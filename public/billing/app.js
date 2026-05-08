(function () {
  const { api, fmtMoney, fmtTime, toast, connectSocket, setOperatorToken, clearOperatorToken, normalizeOperatorPinInput } =
    window.HPRMS;
  const N = window.HPRMSNotify;
  const $ = (s) => document.querySelector(s);

  let cfg = null;
  let tables = [];
  let bills = [];

  const BILL_TOKEN_KEY = 'hprms.saved.billing';

  N.setBaseTitle('Billing - Hotel Poinisuk');
  N.requestDesktop();

  $('#billLoginBtn').addEventListener('click', billLogin);
  $('#billPinInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') billLogin();
  });
  $('#billLogoutBtn').addEventListener('click', () => {
    clearOperatorToken();
    sessionStorage.removeItem(BILL_TOKEN_KEY);
    location.reload();
  });

  async function billLogin() {
    $('#billLoginErr').textContent = '';
    const pin = normalizeOperatorPinInput($('#billPinInput').value);
    if (!pin) {
      $('#billLoginErr').textContent = 'Enter PIN.';
      return;
    }
    try {
      const r = await api('/auth/login', {
        method: 'POST',
        body: { role: 'billing', pin },
        skipGuestHeader: true,
      });
      sessionStorage.setItem(BILL_TOKEN_KEY, r.token);
      setOperatorToken(r.token);
      $('#billLoginGate').hidden = true;
      await bootApp();
    } catch (e) {
      $('#billLoginErr').textContent = e.message || 'Sign-in failed';
    }
  }

  async function resumeOrGate() {
    const tok = sessionStorage.getItem(BILL_TOKEN_KEY);
    if (tok) {
      setOperatorToken(tok);
      try {
        await api('/tables');
        $('#billLoginGate').hidden = true;
        await bootApp();
        return;
      } catch (_) {
        clearOperatorToken();
        sessionStorage.removeItem(BILL_TOKEN_KEY);
      }
    }
    $('#billLoginGate').hidden = false;
    setTimeout(() => $('#billPinInput').focus(), 50);
  }

  function localDateStr(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function localMonthStr(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function analyticsQuerySuffix() {
    const params = new URLSearchParams();
    params.set('analytics', 'summary');
    const day = $('#analyticsDayFilter').value;
    const month = $('#analyticsMonthFilter').value;
    if (day) params.set('day', day);
    if (month) params.set('month', month);
    return '?' + params.toString();
  }

  function billsPeriodQuery(kind) {
    const params = new URLSearchParams();
    params.set('analytics', kind === 'day' ? 'bills-day' : 'bills-month');
    params.set('day', $('#analyticsDayFilter').value);
    params.set('month', $('#analyticsMonthFilter').value);
    const o = $('#periodOutletFilter').value;
    if (o) params.set('outlet', o);
    return '?' + params.toString();
  }

  function escHtml(s) {
    if (s == null) return '';
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  function guestPlain(r) {
    const parts = [];
    if (r.guest_name != null && String(r.guest_name).trim()) parts.push(String(r.guest_name).trim());
    if (r.guest_phone != null && String(r.guest_phone).trim()) parts.push(String(r.guest_phone).trim());
    if (r.room_no != null && String(r.room_no).trim()) parts.push('Rm ' + String(r.room_no).trim());
    if (r.pax != null && String(r.pax).trim() !== '' && !Number.isNaN(Number(r.pax))) parts.push(Number(r.pax) + ' pax');
    return parts.length ? parts.join(' \u00B7 ') : '';
  }

  function renderPeriodLists(dayPack, monthPack) {
    renderOnePeriod('#periodDayMeta', '#periodDayList', '#periodDayTruncate', dayPack, 'No paid bills on this day.');
    renderOnePeriod('#periodMonthMeta', '#periodMonthList', '#periodMonthTruncate', monthPack, 'No paid bills this month.');
  }

  function renderOnePeriod(metaSel, listSel, truncSel, pack, emptyMsg) {
    const meta = $(metaSel);
    const list = $(listSel);
    const trunc = $(truncSel);
    if (!meta || !list || !trunc) return;
    if (!pack || !Array.isArray(pack.bills)) {
      meta.textContent = '\u2014';
      list.innerHTML = '<p class="muted">' + emptyMsg + '</p>';
      trunc.hidden = true;
      trunc.textContent = '';
      return;
    }
    const { bills, truncated } = pack;
    meta.textContent = bills.length + ' bill' + (bills.length === 1 ? '' : 's');
    list.innerHTML = '';
    if (bills.length === 0) {
      list.innerHTML = '<p class="muted">' + emptyMsg + '</p>';
      trunc.hidden = true;
      trunc.textContent = '';
      return;
    }
    for (const r of bills) {
      const outletTag = r.outlet === 'klong' ? 'Klong' : 'Dopwai';
      const guest = guestPlain(r);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'period-bill-row';
      row.setAttribute('role', 'listitem');
      row.innerHTML =
        '<div>' +
        '<div class="bn">' +
        escHtml(r.bill_no) +
        ' \u00B7 ' +
        escHtml(r.table_label) +
        '</div>' +
        '<div class="guest">' +
        (guest ? escHtml(guest) : '<span class="muted">No guest details on file</span>') +
        '</div>' +
        '<div class="muted small">' +
        escHtml(outletTag) +
        ' \u00B7 settled ' +
        fmtTime(r.settled_at) +
        '</div>' +
        '</div>' +
        '<div>' +
        '<div class="gt">' +
        fmtMoney(r.grand_total) +
        '</div>' +
        '<div class="pay">' +
        (r.pay_method && String(r.pay_method).trim()
          ? escHtml(String(r.pay_method).trim())
          : '&mdash;') +
        '</div>' +
        '</div>';
      row.addEventListener('click', async () => {
        try {
          const full = await api('/bills/' + r.id);
          showBill(full);
        } catch (e) {
          toast(e.message);
        }
      });
      list.appendChild(row);
    }
    if (truncated) {
      trunc.hidden = false;
      trunc.textContent = 'Showing first 500 bills — pick an outlet or a shorter month if you need the rest.';
    } else {
      trunc.hidden = true;
      trunc.textContent = '';
    }
  }

  function setupAnalyticsFilters() {
    $('#analyticsDayFilter').value = localDateStr();
    $('#analyticsMonthFilter').value = localMonthStr();
    const reloadAnalytics = () => {
      refreshAnalyticsBundle().catch((e) => toast(e.message || 'Analytics failed'));
    };

    const resetBtn = $('#analyticsResetFilters');
    if (!resetBtn) return;

    if (!resetBtn.dataset.hprmsBound) {
      resetBtn.dataset.hprmsBound = '1';
      $('#analyticsDayFilter').addEventListener('change', reloadAnalytics);
      $('#analyticsMonthFilter').addEventListener('change', reloadAnalytics);
      $('#periodOutletFilter').addEventListener('change', reloadAnalytics);

      resetBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        e.stopPropagation();
        $('#analyticsDayFilter').value = localDateStr();
        $('#analyticsMonthFilter').value = localMonthStr();
        $('#periodOutletFilter').value = '';
        try {
          await refreshAll();
        } catch (err) {
          toast(err.message || 'Refresh failed');
        }
      });
    }
  }

  async function refreshAnalyticsBundle() {
    const [analytics, dayPack, monthPack] = await Promise.all([
      api('/bills' + analyticsQuerySuffix()),
      api('/bills' + billsPeriodQuery('day')),
      api('/bills' + billsPeriodQuery('month')),
    ]);
    renderAnalytics(analytics);
    renderPeriodLists(dayPack, monthPack);
  }

  async function bootApp() {
    $('#billModal').hidden = true;
    cfg = await api('/config');
    renderIds();
    setupAnalyticsFilters();
    await refreshAll();

    const sock = connectSocket(['role:billing']);
    sock.on('floor:update', refreshAll);
    sock.on('order:update', refreshAll);
    sock.on('order:new', refreshAll);
    sock.on('bill:update', refreshAll);

    setInterval(refreshAll, 20000);
  }

  function renderIds() {
    $('#idsDot').className = 'dot ' + (cfg.ids_enabled ? 'live' : 'mock');
    $('#idsLabel').textContent = cfg.ids_enabled ? 'IDS connected' : 'IDS in mock mode';
  }

  async function refreshAll() {
    const [t, openB, allB, analytics, dayPack, monthPack] = await Promise.all([
      api('/tables'),
      api('/bills?open=true'),
      api('/bills?limit=200'),
      api('/bills' + analyticsQuerySuffix()),
      api('/bills' + billsPeriodQuery('day')),
      api('/bills' + billsPeriodQuery('month')),
    ]);
    tables = t;
    bills = openB;
    renderAnalytics(analytics);
    renderPeriodLists(dayPack, monthPack);
    renderAwaiting();
    renderOpenBills();
    renderSettled(allB.filter((b) => b.pay_status === 'paid'));
  }

  function renderAnalytics(a) {
    if (!a || !a.labels) return;
    const L = a.labels;
    $('#analyticsMeta').textContent = 'Day ' + L.day + ' \u00B7 Month ' + L.month;
    function fill(prefix, slice) {
      $('#' + prefix + '-day-bills').textContent = slice.day.bills + ' bill' + (slice.day.bills === 1 ? '' : 's');
      $('#' + prefix + '-day-rev').textContent = fmtMoney(slice.day.revenue);
      $('#' + prefix + '-month-bills').textContent = slice.month.bills + ' bill' + (slice.month.bills === 1 ? '' : 's');
      $('#' + prefix + '-month-rev').textContent = fmtMoney(slice.month.revenue);
    }
    fill('klong', { day: a.day.klong, month: a.month.klong });
    fill('dopwai', { day: a.day.dopwai, month: a.month.dopwai });
  }

  function renderAwaiting() {
    const grid = $('#awaitGrid');
    grid.innerHTML = '';
    const awaiting = tables.filter((tt) => tt.session && (tt.awaiting_bill || tt.has_undelivered));
    $('#awaitMeta').textContent = awaiting.length + ' table(s) open';
    if (awaiting.length === 0) {
      grid.innerHTML = '<p class="muted" style="grid-column:1/-1;text-align:center;padding:14px">No tables open right now.</p>';
      return;
    }
    for (const t of awaiting) {
      const tile = document.createElement('div');
      tile.className = 'await-tile';
      const status = t.awaiting_bill ? 'AWAITING BILL' : 'IN SERVICE';
      const sess = t.session || {};
      const gn =
        sess.guest_name && String(sess.guest_name).trim()
          ? escHtml(String(sess.guest_name).trim())
          : '';
      const gp =
        sess.guest_phone && String(sess.guest_phone).trim()
          ? escHtml(String(sess.guest_phone).trim())
          : '';
      const guestRow =
        gn || gp
          ? `<div class="muted await-guest">${gn}${gn && gp ? ' · ' : ''}${gp}</div>`
          : '';
      tile.innerHTML = `
        <div class="meta">${t.outlet === 'klong' ? 'Klong / Bar' : 'Dopwai / Restaurant'}</div>
        <h3>${escHtml(String(t.label || ''))}</h3>
        ${guestRow}
        <div class="muted">Open since ${fmtTime(t.session.opened_at)} \u00B7 ${status}</div>
        <span class="grand muted" id="grand-${t.id}">View bill \u2192</span>`;
      tile.addEventListener('click', () => openTableBill(t));
      grid.appendChild(tile);
    }
  }

  function renderOpenBills() {
    const list = $('#openBills');
    list.innerHTML = '';
    $('#openMeta').textContent = bills.length + ' unpaid';
    if (bills.length === 0) {
      list.innerHTML = '<p class="muted" style="text-align:center;padding:14px">No unpaid bills.</p>';
      return;
    }
    for (const b of bills) {
      const row = document.createElement('div');
      row.className = 'bill-row';
      row.innerHTML = `
        <div>
          <div class="bn">${b.bill_no}</div>
          <div class="meta">${b.table_label} \u00B7 ${fmtTime(b.created_at)}</div>
        </div>
        <div class="gt">${fmtMoney(b.grand_total)}</div>
        <div class="chips">${idsChip(b)}</div>`;
      row.addEventListener('click', async () => {
        const full = await api('/bills/' + b.id);
        showBill(full);
      });
      list.appendChild(row);
    }
  }

  function renderSettled(settled) {
    const list = $('#settledBills');
    list.innerHTML = '';
    const today = localDateStr();
    const rows = settled.filter((b) => (b.created_at || '').startsWith(today));
    const total = rows.reduce((s, b) => s + (b.grand_total || 0), 0);
    $('#settledMeta').textContent = rows.length + ' \u00B7 ' + fmtMoney(total);
    if (rows.length === 0) {
      list.innerHTML = '<p class="muted" style="text-align:center;padding:14px">Nothing settled today yet.</p>';
      return;
    }
    for (const b of rows) {
      const row = document.createElement('div');
      row.className = 'bill-row';
      row.innerHTML = `
        <div>
          <div class="bn">${b.bill_no}</div>
          <div class="meta">${b.table_label} \u00B7 ${b.pay_method || ''}</div>
        </div>
        <div class="gt">${fmtMoney(b.grand_total)}</div>
        <div class="chips"><span class="chip veg">Paid</span></div>`;
      row.addEventListener('click', async () => {
        const full = await api('/bills/' + b.id);
        showBill(full);
      });
      list.appendChild(row);
    }
  }

  function idsChip(b) {
    const m = {
      pending: ['warn',  'IDS pending'],
      posted:  ['veg',   'IDS posted'],
      failed:  ['nv',    'IDS failed'],
    };
    const [cls, label] = m[b.ids_status] || ['muted', b.ids_status];
    return `<span class="chip ${cls}">${label}</span>`;
  }

  async function openTableBill(t) {
    if (!t.session) { toast(t.label + ' is free.'); return; }
    const bill = await api('/sessions/' + t.session.id + '/bill', { method: 'POST' });
    showBill(bill, t);
  }

  function showBill(bill, table) {
    $('#bmTitle').textContent = bill.bill_no + ' \u00B7 ' + (table ? table.label : 'Table ' + bill.table_id);
    const lines = [];
    let qty = 0;
    let pendingCount = 0;
    for (const o of bill.orders || []) {
      if (o.status === 'cancelled') continue;
      if (o.status !== 'delivered') pendingCount++;
      lines.push(`<tr><td colspan="4" style="color:#4a1d72;padding-top:10px">
        <b>${o.station === 'BAR' ? 'Klong' : 'Dopwai'} \u00B7 KOT ${o.kot_no}</b>
        <span class="muted"> \u00B7 ${o.status}</span></td></tr>`);
      for (const it of o.items) {
        qty += it.qty;
        lines.push(`<tr>
          <td>${it.qty}\u00D7</td>
          <td>${it.name}${it.variant_label ? ' (' + it.variant_label + ')' : ''}</td>
          <td class="r">${fmtMoney(it.unit_price)}</td>
          <td class="r">${fmtMoney(it.line_total)}</td></tr>`);
      }
    }

    const idsBlock = bill.ids_status === 'posted'
      ? `<div class="ids-block"><b>Posted to IDS</b> at ${fmtTime(bill.ids_posted_at)} \u00B7 ref <code>${bill.ids_reference || '\u2014'}</code><br>
         <small class="muted">A second post is blocked - the cashier will not bill twice.</small></div>`
      : bill.ids_status === 'failed'
        ? `<div class="ids-block failed"><b>IDS posting failed.</b> Use the retry button below.</div>`
        : `<div class="ids-block">Not yet posted to IDS. Posting is idempotent - a successful post will never re-bill.</div>`;

    const warning = pendingCount > 0
      ? `<div class="ids-block failed" style="margin-bottom:10px"><b>${pendingCount} order(s) still in service.</b> Wait for the steward to deliver before settling, or cancel them from the kitchen / bar.</div>`
      : '';

    const sess = bill.session || {};
    const gBits = [];
    if (sess.guest_name && String(sess.guest_name).trim()) {
      gBits.push('<span>' + escHtml(String(sess.guest_name).trim()) + '</span>');
    }
    if (sess.guest_phone && String(sess.guest_phone).trim()) {
      gBits.push('<span>' + escHtml(String(sess.guest_phone).trim()) + '</span>');
    }
    if (sess.room_no && String(sess.room_no).trim()) {
      gBits.push('<span>Rm ' + escHtml(String(sess.room_no).trim()) + '</span>');
    }
    if (sess.pax != null && String(sess.pax).trim() !== '' && !Number.isNaN(Number(sess.pax))) {
      gBits.push('<span>' + escHtml(String(sess.pax)) + ' pax</span>');
    }
    const guestStrip =
      gBits.length > 0
        ? `<div class="bill-guest-strip">Guest: ${gBits.join(' \u00B7 ')}</div>`
        : '';

    $('#bmBody').innerHTML = `
      ${warning}
      <div class="bill-print">
        <div class="h">
          <h4>${cfg.hotel}</h4>
          <div>${bill.table_id ? 'Table ' + bill.table_id : ''} \u00B7 ${fmtTime(bill.created_at)}</div>
          <div class="muted">${bill.bill_no}</div>
        </div>
        ${guestStrip}
        <table>
          <thead><tr><th>Qty</th><th>Item</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
          <tbody>${lines.join('')}</tbody>
          <tfoot>
            <tr class="totals"><td colspan="3" class="r">Subtotal (${qty} items)</td><td class="r">${fmtMoney(bill.subtotal)}</td></tr>
            ${bill.service_charge > 0 ? `<tr><td colspan="3" class="r">Service Charge</td><td class="r">${fmtMoney(bill.service_charge)}</td></tr>` : ''}
            <tr><td colspan="3" class="r">GST (${cfg.gst_percent}%)</td><td class="r">${fmtMoney(bill.gst)}</td></tr>
            <tr class="grand"><td colspan="3" class="r">GRAND TOTAL</td><td class="r">${fmtMoney(bill.grand_total)}</td></tr>
            ${(() => {
              const ts = +(Number(bill.tip_steward || 0).toFixed(2));
              const tb = +(Number(bill.tip_bartender || 0).toFixed(2));
              const tc = +(Number(bill.tip_chef || 0).toFixed(2));
              const rows = [];
              if (ts > 0) {
                rows.push('<tr><td colspan="3" class="r">Guest tip (steward)</td><td class="r">' + fmtMoney(ts) + '</td></tr>');
              }
              if (tb > 0) {
                rows.push('<tr><td colspan="3" class="r">Guest tip (bartender)</td><td class="r">' + fmtMoney(tb) + '</td></tr>');
              }
              if (tc > 0) {
                rows.push('<tr><td colspan="3" class="r">Guest tip (chef / kitchen)</td><td class="r">' + fmtMoney(tc) + '</td></tr>');
              }
              const sum = ts + tb + tc;
              if (sum > 0) {
                rows.push('<tr class="totals"><td colspan="3" class="r">Tips total <span class="muted">(collect separately)</span></td><td class="r">' + fmtMoney(sum) + '</td></tr>');
              }
              return rows.join('');
            })()}
          </tfoot>
        </table>
        ${idsBlock}
      </div>`;

    const acts = [];
    if (bill.ids_status !== 'posted') {
      acts.push(`<button class="btn" data-act="post">Post to IDS</button>`);
    } else {
      acts.push(`<button class="btn ghost" disabled>Posted \u2713</button>`);
    }
    if (bill.pay_status !== 'paid') {
      acts.push(`<button class="btn success" data-act="settle:cash"  ${pendingCount ? 'disabled title="Pending orders"' : ''}>Settle (Cash)</button>`);
      acts.push(`<button class="btn gold"    data-act="settle:card"  ${pendingCount ? 'disabled' : ''}>Settle (Card)</button>`);
      acts.push(`<button class="btn ghost"   data-act="settle:upi"   ${pendingCount ? 'disabled' : ''}>Settle (UPI)</button>`);
      acts.push(`<button class="btn ghost"   data-act="settle:room"  ${pendingCount ? 'disabled' : ''}>Charge to Room</button>`);
    }
    acts.push(`<button class="btn ghost" data-act="print">Print</button>`);
    $('#bmActions').innerHTML = acts.join('');
    $('#bmActions').onclick = async (e) => {
      const a = e.target.dataset.act;
      if (!a) return;
      try {
        if (a === 'post') {
          const updated = await api('/bills/' + bill.id + '/post-ids', { method: 'POST', body: { actor: 'billing' } });
          toast('Posted to IDS \u00B7 ' + (updated.ids_reference || 'mock'));
          showBill(updated, table);
          refreshAll();
        } else if (a.startsWith('settle:')) {
          const method = a.split(':')[1];
          if (bill.ids_status !== 'posted') {
            const yes = confirm('This bill has not been posted to IDS. Settle anyway?');
            if (!yes) return;
          }
          const updated = await api('/bills/' + bill.id + '/settle', { method: 'POST', body: { method, actor: 'billing' } });
          toast('Bill settled \u00B7 ' + method);
          showBill(updated, table);
          refreshAll();
        } else if (a === 'print') {
          window.print();
        }
      } catch (err) { toast(err.message); }
    };

    $('#billModal').hidden = false;
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) $('#billModal').hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') $('#billModal').hidden = true;
  });

  resumeOrGate();
})();
