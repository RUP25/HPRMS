(function () {
  const { api, fmtMoney, fmtTime, toast, connectSocket, setOperatorToken, clearOperatorToken, getOperatorToken, normalizeOperatorPinInput } =
    window.HPRMS;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  let cfg = null;
  let menuItems = [];
  let categoryCatalog = { categories: [], outlets: {} };
  let tables = [];
  let bills = [];
  let menuFilter = { q: '', outlet: '' };

  $('#admLoginBtn').addEventListener('click', adminLogin);
  $('#admPinInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') adminLogin();
  });
  $('#admLogoutBtn').addEventListener('click', () => {
    clearOperatorToken();
    location.reload();
  });

  async function adminLogin() {
    $('#admLoginErr').textContent = '';
    const pin = normalizeOperatorPinInput($('#admPinInput').value);
    if (!pin) {
      $('#admLoginErr').textContent = 'Enter PIN.';
      return;
    }
    try {
      const r = await api('/auth/login', {
        method: 'POST',
        body: { role: 'admin', pin },
        skipGuestHeader: true,
      });
      setOperatorToken(r.token);
      $('#admLoginGate').hidden = true;
      await bootApp();
    } catch (e) {
      $('#admLoginErr').textContent = e.message || 'Sign-in failed';
    }
  }

  async function resumeOrGate() {
    const tok = getOperatorToken();
    if (tok) {
      setOperatorToken(tok);
      try {
        await api('/tables');
        $('#admLoginGate').hidden = true;
        await bootApp();
        return;
      } catch (_) {
        clearOperatorToken();
      }
    }
    $('#admLoginGate').hidden = false;
    setTimeout(() => $('#admPinInput').focus(), 50);
  }

  async function bootApp() {
    $('#billModal').hidden = true;
    $('#itemModal').hidden = true;
    $('#stewardModal').hidden = true;
    cfg = await api('/config');
    renderIdsState();
    setupTabs();
    setupMenuToolbar();
    setupItemForm();
    setupStewardForm();

    await Promise.all([refreshFloor(), refreshMenu(), renderQR(), refreshStewards()]);
    refreshBills();

    const sock = connectSocket(['role:admin']);
    sock.on('floor:update', refreshFloor);
    sock.on('order:new', () => { refreshFloor(); refreshStewards(); });
    sock.on('order:update', () => { refreshFloor(); refreshStewards(); });
    sock.on('bill:update', () => { refreshBills(); refreshFloor(); });
  }

  function renderIdsState() {
    const dot = $('#idsDot'); const lab = $('#idsLabel');
    if (cfg.ids_enabled) { dot.className = 'dot live'; lab.textContent = 'IDS connected'; }
    else { dot.className = 'dot mock'; lab.textContent = 'IDS in mock mode'; }
  }

  function setupTabs() {
    $$('.navbtn').forEach((b) => b.addEventListener('click', () => {
      $$('.navbtn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      const tab = b.dataset.tab;
      $$('.tab-panel').forEach((p) => p.hidden = true);
      $('#tab-' + tab).hidden = false;
      if (tab === 'bills')    refreshBills();
      if (tab === 'stewards') refreshStewards();
      if (tab === 'menu')     refreshMenu();
    }));
  }

  // ---------- Floor ----------
  async function refreshFloor() {
    tables = await api('/tables');
    const grid = $('#floorGrid');
    grid.innerHTML = '';
    let occupied = 0;
    for (const t of tables) {
      const occ = !!t.session;
      if (occ) occupied++;
      const stateCls = occ ? (t.derived_status || 'occupied') : 'free';
      const tile = document.createElement('div');
      tile.className = 'tile ' + stateCls;
      const outletName = t.outlet === 'klong' ? 'Klong / Bar' : 'Dopwai / Restaurant';
      const pill = !occ ? '' :
        t.derived_status === 'awaiting_bill' ? '<span class="pill">Awaiting bill</span>' :
        t.derived_status === 'in_service'    ? '<span class="pill">In service</span>'    :
        '<span class="pill">Occupied</span>';
      tile.innerHTML = `
        <div class="meta">${outletName}</div>
        <h3>${t.label}</h3>
        <div class="muted">${occ ? 'Open since ' + fmtTime(t.session.opened_at) : 'Free'}</div>
        ${pill}
        <div class="summary">
          <span class="muted">Active</span><b>${t.open_orders || 0}</b>
        </div>`;
      tile.addEventListener('click', () => openTable(t));
      grid.appendChild(tile);
    }
    $('#floorMeta').textContent = `${occupied} of ${tables.length} tables occupied`;
  }

  async function openTable(t) {
    if (!t.session) return toast(t.label + ' is free.');
    try {
      const bill = await api('/sessions/' + t.session.id + '/bill', { method: 'POST' });
      showBillModal(bill, t);
    } catch (e) { toast(e.message); }
  }

  // ---------- Bills ----------
  async function refreshBills() {
    const showAll = $('#showAllBills').checked;
    bills = await api('/bills' + (showAll ? '' : '?open=true'));
    const list = $('#billsList');
    list.innerHTML = '';
    if (bills.length === 0) {
      list.innerHTML = '<p class="muted" style="padding:30px;text-align:center">No bills yet.</p>';
      return;
    }
    for (const b of bills) {
      const row = document.createElement('div');
      row.className = 'bill-row';
      const idsChip = idsChipFor(b);
      const payChip = b.pay_status === 'paid'
        ? '<span class="chip veg">Paid' + (b.pay_method ? ' \u00B7 ' + b.pay_method : '') + '</span>'
        : '<span class="chip warn">Unpaid</span>';
      row.innerHTML = `
        <span class="bn">${b.bill_no}</span>
        <span><b>${b.table_label}</b></span>
        <span class="muted">${fmtTime(b.created_at)}</span>
        <span class="gt">${fmtMoney(b.grand_total)}</span>
        <span>${payChip}</span>
        <span>${idsChip}</span>`;
      row.addEventListener('click', async () => {
        const full = await api('/bills/' + b.id);
        showBillModal(full);
      });
      list.appendChild(row);
    }
  }

  function idsChipFor(b) {
    const map = {
      pending: ['warn',  'IDS pending'],
      posted:  ['veg',   'IDS posted'],
      failed:  ['nv',    'IDS failed'],
    };
    const [cls, label] = map[b.ids_status] || ['muted', b.ids_status];
    return `<span class="chip ${cls}">${label}</span>`;
  }

  $('#showAllBills').addEventListener('change', refreshBills);

  function showBillModal(bill, table) {
    $('#bmTitle').textContent = bill.bill_no + ' \u00B7 ' + (table ? table.label : ('Table ' + bill.table_id));
    const lines = [];
    let totalQty = 0;
    let pendingCount = 0;
    for (const o of bill.orders || []) {
      if (o.status === 'cancelled') continue;
      if (o.status !== 'delivered') pendingCount++;
      lines.push(`<tr><td colspan="4" style="color:#4a1d72;padding-top:10px"><b>${o.station === 'BAR' ? 'Klong' : 'Dopwai'} \u00B7 KOT ${o.kot_no}</b> <span class="muted">\u00B7 ${o.status}</span></td></tr>`);
      for (const it of o.items) {
        totalQty += it.qty;
        lines.push(`<tr>
          <td>${it.qty}\u00D7</td>
          <td>${it.name}${it.variant_label ? ' ('+it.variant_label+')' : ''}</td>
          <td class="r">${fmtMoney(it.unit_price)}</td>
          <td class="r">${fmtMoney(it.line_total)}</td>
        </tr>`);
      }
    }
    const idsBlock = bill.ids_status === 'posted'
      ? `<div class="ids-block"><b>Posted to IDS</b> at ${fmtTime(bill.ids_posted_at)} \u00B7 ref <code>${bill.ids_reference || '\u2014'}</code></div>`
      : bill.ids_status === 'failed'
        ? `<div class="ids-block" style="border-color:#b3261e;background:#fdecea"><b>IDS posting failed.</b> Retry below.</div>`
        : `<div class="ids-block">Not yet posted to IDS. Posting is idempotent \u2014 a successful post will never re-bill.</div>`;
    const warning = pendingCount > 0
      ? `<div class="ids-block" style="border-color:#b3261e;background:#fdecea;margin-bottom:10px"><b>${pendingCount} order(s) still in service.</b> Bill cannot be settled yet.</div>`
      : '';
    $('#bmBody').innerHTML = `
      ${warning}
      <div class="bill-print">
        <div class="h">
          <h4>${cfg.hotel}</h4>
          <div>${bill.table_id ? 'Table ' + bill.table_id : ''} \u00B7 ${fmtTime(bill.created_at)}</div>
          <div class="muted">${bill.bill_no}</div>
        </div>
        <table>
          <thead><tr><th>Qty</th><th>Item</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead>
          <tbody>${lines.join('')}</tbody>
          <tfoot>
            <tr class="totals"><td colspan="3" class="r">Subtotal (${totalQty} items)</td><td class="r">${fmtMoney(bill.subtotal)}</td></tr>
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
      acts.push(`<button class="btn success" data-act="settle:cash" ${pendingCount ? 'disabled' : ''}>Settle (Cash)</button>`);
      acts.push(`<button class="btn gold"    data-act="settle:card" ${pendingCount ? 'disabled' : ''}>Settle (Card)</button>`);
      acts.push(`<button class="btn ghost"   data-act="settle:upi"  ${pendingCount ? 'disabled' : ''}>Settle (UPI)</button>`);
      acts.push(`<button class="btn ghost"   data-act="settle:room" ${pendingCount ? 'disabled' : ''}>Charge to Room</button>`);
    }
    acts.push(`<button class="btn ghost" data-act="print">Print</button>`);
    $('#bmActions').innerHTML = acts.join('');
    $('#bmActions').onclick = async (e) => {
      const a = e.target.dataset.act;
      if (!a) return;
      try {
        if (a === 'post') {
          const updated = await api('/bills/' + bill.id + '/post-ids', { method: 'POST', body: { actor: 'admin' } });
          toast('Posted to IDS \u00B7 ' + (updated.ids_reference || 'mock'));
          showBillModal(updated, table);
          refreshBills();
        } else if (a.startsWith('settle:')) {
          const method = a.split(':')[1];
          const updated = await api('/bills/' + bill.id + '/settle', { method: 'POST', body: { method } });
          toast('Bill settled \u00B7 ' + method);
          showBillModal(updated, table);
          refreshBills();
          refreshFloor();
        } else if (a === 'print') {
          window.print();
        }
      } catch (err) { toast(err.message); }
    };

    $('#billModal').hidden = false;
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) $('#billModal').hidden = true;
    if (e.target.closest('[data-close-item]')) $('#itemModal').hidden = true;
    if (e.target.closest('[data-close-steward]')) $('#stewardModal').hidden = true;
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Esc') {
      $('#billModal').hidden = true;
      $('#itemModal').hidden = true;
      $('#stewardModal').hidden = true;
    }
  });

  // ---------- Menu (search + CRUD) ----------
  function setupMenuToolbar() {
    let t;
    $('#menuSearch').addEventListener('input', (e) => {
      menuFilter.q = e.target.value.trim();
      clearTimeout(t);
      t = setTimeout(refreshMenu, 180);
    });
    $('#menuOutletFilter').addEventListener('change', (e) => {
      menuFilter.outlet = e.target.value;
      refreshMenu();
    });
    $('#menuAddBtn').addEventListener('click', () => openItemForm(null));
  }

  async function refreshMenu() {
    if (!categoryCatalog.categories.length) {
      categoryCatalog = await api('/menu/categories');
      const sel = $('#if_category');
      sel.innerHTML = '';
      for (const c of categoryCatalog.categories) {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = (c.outlet === 'klong' ? 'Klong / ' : 'Dopwai / ') + c.name;
        sel.appendChild(opt);
      }
    }
    const params = new URLSearchParams();
    if (menuFilter.q) params.set('q', menuFilter.q);
    if (menuFilter.outlet) params.set('outlet', menuFilter.outlet);
    menuItems = await api('/menu/admin' + (params.toString() ? '?' + params.toString() : ''));

    const list = $('#menuList');
    list.innerHTML = '';
    if (menuItems.length === 0) {
      list.innerHTML = `<p class="muted" style="padding:24px;text-align:center">No items match "${menuFilter.q}"</p>`;
      $('#menuMeta').textContent = '0 items';
      return;
    }
    for (const it of menuItems) {
      const minPrice = (it.variants[0] || {}).price || 0;
      const variantSummary = it.variants.length === 1
        ? it.variants[0].label
        : it.variants.length + ' variants';
      const r = document.createElement('div');
      r.className = 'menu-row' + (it.enabled ? '' : ' disabled');
      r.innerHTML = `
        <span class="id">${it.id}</span>
        <span class="nm">${it.name}</span>
        <span class="ct">${it.category}</span>
        <span class="ct">${it.outlet}</span>
        <span class="vc">${variantSummary}</span>
        <span class="pr">${fmtMoney(minPrice)}</span>
        <span class="actions">
          <button class="btn ghost" data-act="edit" data-id="${it.id}">Edit</button>
          <button class="btn ${it.enabled ? 'ghost' : 'success'}" data-act="toggle" data-id="${it.id}">${it.enabled ? 'Disable' : 'Enable'}</button>
        </span>`;
      list.appendChild(r);
    }
    $('#menuMeta').textContent = `${menuItems.length} items`;

    list.onclick = async (e) => {
      const id = e.target.dataset.id;
      const act = e.target.dataset.act;
      if (!id || !act) return;
      e.stopPropagation();
      if (act === 'toggle') {
        await api('/menu/' + id + '/toggle', { method: 'POST' });
        toast('Updated');
        refreshMenu();
      } else if (act === 'edit') {
        const it = menuItems.find((x) => x.id === id);
        openItemForm(it);
      }
    };
  }

  function setupItemForm() {
    $('#if_addVariant').addEventListener('click', () => addVariantRow({ label: '', price: '' }));
    $('#itemForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = $('#if_id').value.trim();
      const variants = collectVariants();
      const body = {
        name: $('#if_name').value.trim(),
        description: $('#if_desc').value.trim(),
        category: $('#if_category').value,
        veg: $('#if_veg').value === '' ? null : $('#if_veg').value === 'true',
        variants,
      };
      try {
        if (id) {
          await api('/menu/' + id, { method: 'PATCH', body });
          toast('Saved');
        } else {
          await api('/menu', { method: 'POST', body });
          toast('Added');
        }
        $('#itemModal').hidden = true;
        refreshMenu();
      } catch (err) { toast(err.message); }
    });
    $('#if_delete').addEventListener('click', async () => {
      const id = $('#if_id').value.trim();
      if (!id) return;
      if (!confirm('Delete this item? Historical orders will keep working (auto-disabled if in use).')) return;
      try {
        await api('/menu/' + id, { method: 'DELETE' });
        toast('Removed');
        $('#itemModal').hidden = true;
        refreshMenu();
      } catch (err) { toast(err.message); }
    });
  }

  function openItemForm(item) {
    $('#imTitle').textContent = item ? 'Edit ' + item.id : 'Add menu item';
    $('#if_id').value = item ? item.id : '';
    $('#if_name').value = item ? item.name : '';
    $('#if_desc').value = item ? (item.description || '') : '';
    $('#if_veg').value = item == null || item.veg == null ? '' : (item.veg ? 'true' : 'false');
    $('#if_category').value = item ? item.category : ($('#if_category').options[0] && $('#if_category').options[0].value) || '';
    $('#if_variants').innerHTML = '';
    const variants = item && item.variants && item.variants.length ? item.variants : [{ label: 'plate', price: '' }];
    for (const v of variants) addVariantRow(v);
    $('#if_delete').hidden = !item;
    $('#itemModal').hidden = false;
    setTimeout(() => $('#if_name').focus(), 30);
  }

  function addVariantRow(v) {
    const wrap = document.createElement('div');
    wrap.className = 'variant-row';
    wrap.innerHTML = `
      <input class="vr-label" placeholder="Label (e.g. plate, 30ml)" value="${(v.label || '').replace(/"/g, '&quot;')}">
      <input class="vr-price" type="number" min="0" step="1" placeholder="Price" value="${v.price ?? ''}">
      <button type="button" class="btn ghost" data-rmv>Remove</button>`;
    wrap.querySelector('[data-rmv]').addEventListener('click', () => wrap.remove());
    $('#if_variants').appendChild(wrap);
  }

  function collectVariants() {
    const rows = Array.from($('#if_variants').querySelectorAll('.variant-row'));
    return rows.map((r) => ({
      label: r.querySelector('.vr-label').value.trim(),
      price: parseFloat(r.querySelector('.vr-price').value),
    })).filter((v) => v.label && Number.isFinite(v.price));
  }

  // ---------- Stewards ----------
  function setupStewardForm() {
    $('#stewardAddBtn').addEventListener('click', () => openStewardForm(null));
    $('#stewardForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = $('#sf_id').value.trim();
      const name = $('#sf_name').value.trim();
      const pin = $('#sf_pin').value.trim();
      const active = $('#sf_active').checked;
      try {
        if (id) {
          const body = { name, active };
          if (pin) body.pin = pin;
          await api('/stewards/load/detail/' + id, { method: 'PATCH', body });
          toast('Saved');
        } else {
          if (!pin) {
            toast('Enter a PIN for the new steward');
            $('#sf_pin').focus();
            return;
          }
          await api('/stewards/load/create', { method: 'POST', body: { name, pin, active } });
          toast('Added');
        }
        $('#stewardModal').hidden = true;
        refreshStewards();
      } catch (err) {
        toast(err.message);
      }
    });
    $('#sf_delete').addEventListener('click', async () => {
      const id = $('#sf_id').value.trim();
      if (!id) return;
      if (!confirm('Remove this steward? Orders they were assigned to will keep history but lose steward linkage.')) return;
      try {
        await api('/stewards/load/detail/' + id, { method: 'DELETE' });
        toast('Removed');
        $('#stewardModal').hidden = true;
        refreshStewards();
      } catch (err) {
        toast(err.message);
      }
    });
  }

  async function openStewardForm(id) {
    $('#sfModalTitle').textContent = id ? 'Edit steward #' + id : 'Add steward';
    $('#sf_id').value = id ? String(id) : '';
    $('#sf_name').value = '';
    $('#sf_pin').value = '';
    const hint = $('#sf_pin_hint');
    if (id) {
      hint.textContent = 'Leave PIN blank to keep the current PIN.';
      $('#sf_pin').removeAttribute('required');
      $('#sf_pin').placeholder = '';
    } else {
      hint.textContent = 'Steward signs in with this PIN on the steward device.';
      $('#sf_pin').required = true;
      $('#sf_pin').placeholder = '';
    }
    $('#sf_active').checked = true;
    $('#sf_delete').hidden = !id;
    if (id) {
      try {
        const s = await api('/stewards/load/detail/' + id);
        $('#sf_name').value = s.name || '';
        $('#sf_active').checked = !!s.active;
      } catch (err) {
        toast(err.message);
        return;
      }
    }
    $('#stewardModal').hidden = false;
    setTimeout(() => $('#sf_name').focus(), 30);
  }

  async function refreshStewards() {
    const stewards = await api('/stewards/load');
    const list = $('#stewardList');
    if (!list) return;
    list.innerHTML = '';
    list.onclick = null;
    if (stewards.length === 0) {
      list.innerHTML =
        '<p class="muted" style="padding:24px;text-align:center">No stewards yet. Use &quot;+ Add steward&quot; to create one.</p>';
      return;
    }
    for (const s of stewards) {
      const row = document.createElement('div');
      row.className = 'steward-row';
      row.innerHTML = `
        <span class="id">#${s.id}</span>
        <span class="nm">${s.name}</span>
        <span class="stat"><b>${s.active_load}</b><span class="lab">Active load</span></span>
        <span class="stat"><b>${s.delivered_today || 0}</b><span class="lab">Delivered today</span></span>
        <span><button type="button" class="chip ${s.active ? 'veg' : 'muted'}" data-act="duty" data-id="${s.id}" data-active="${s.active ? '1' : '0'}">${s.active ? 'On duty' : 'Off duty'}</button></span>
        <span class="actions">
          <button type="button" class="btn ghost" data-act="edit" data-id="${s.id}">Edit</button>
          <button type="button" class="btn danger" data-act="delete" data-id="${s.id}">Delete</button>
        </span>`;
      list.appendChild(row);
    }
    list.onclick = async (e) => {
      const btn = e.target.closest('button[data-act]');
      if (!btn || !list.contains(btn)) return;
      const act = btn.dataset.act;
      const sid = btn.dataset.id;
      if (!sid) return;
      e.stopPropagation();
      if (act === 'duty') {
        const cur = btn.dataset.active === '1';
        try {
          await api('/stewards/load/detail/' + sid + '/active', { method: 'POST', body: { active: !cur } });
          toast(cur ? 'Marked off duty' : 'Marked on duty');
          refreshStewards();
        } catch (err) {
          toast(err.message);
        }
      } else if (act === 'edit') {
        openStewardForm(Number(sid));
      } else if (act === 'delete') {
        if (!confirm('Remove this steward? Orders they were assigned to will keep history but lose steward linkage.')) return;
        try {
          await api('/stewards/load/detail/' + sid, { method: 'DELETE' });
          toast('Removed');
          refreshStewards();
        } catch (err) {
          toast(err.message);
        }
      }
    };
  }

  // ---------- QR codes ----------
  async function renderQR() {
    const grid = $('#qrGrid');
    grid.innerHTML = '';
    const tables = await api('/tables');
    const base = location.origin;
    for (const t of tables) {
      const card = document.createElement('div');
      card.className = 'qr-card';
      const url = base + '/t/' + t.id + '?t=' + encodeURIComponent(t.guest_token || '');
      card.innerHTML = `
        <canvas></canvas>
        <div class="lab">${t.label}</div>
        <div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:2px">${t.outlet === 'klong' ? 'Klong' : 'Dopwai'}</div>
        <div class="url">${url}</div>`;
      grid.appendChild(card);
      QRCode.toCanvas(card.querySelector('canvas'), url, { width: 200, margin: 1 });
    }
  }

  resumeOrGate();
})();
