'use strict';

const { getDb } = require('../db/init');
const { getItem } = require('./menuService');
const stewards = require('./stewardService');

let ioRef = null;
function setIo(io) { ioRef = io; }
function emit(room, event, payload) { if (ioRef) ioRef.to(room).emit(event, payload); }
function broadcast(event, payload) { if (ioRef) ioRef.emit(event, payload); }

function pad(n, w) { return String(n).padStart(w, '0'); }

function nextKotNumber(db, station) {
  const today = new Date();
  const ymd = `${today.getFullYear()}${pad(today.getMonth() + 1, 2)}${pad(today.getDate(), 2)}`;
  const prefix = (station === 'BAR' ? 'B' : 'K') + ymd;
  const last = db.prepare(
    "SELECT kot_no FROM orders WHERE kot_no LIKE ? ORDER BY id DESC LIMIT 1"
  ).get(`${prefix}-%`);
  let seq = 1;
  if (last) {
    const m = last.kot_no.match(/-(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `${prefix}-${pad(seq, 4)}`;
}

function nextBillNumber(db) {
  const today = new Date();
  const ymd = `${today.getFullYear()}${pad(today.getMonth() + 1, 2)}${pad(today.getDate(), 2)}`;
  const prefix = `INV${ymd}`;
  const last = db.prepare(
    "SELECT bill_no FROM bills WHERE bill_no LIKE ? ORDER BY id DESC LIMIT 1"
  ).get(`${prefix}-%`);
  let seq = 1;
  if (last) {
    const m = last.bill_no.match(/-(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `${prefix}-${pad(seq, 4)}`;
}

function trimGuestStr(val) {
  if (val === undefined || val === null) return undefined;
  const s = String(val).trim();
  return s === '' ? null : s;
}

/** Merge optional guest_name / guest_phone onto open session (or create session). */
function ensureOpenSession(db, tableId, guestPatch = {}) {
  const existing = db.prepare("SELECT * FROM sessions WHERE table_id = ? AND status = 'open' ORDER BY id DESC LIMIT 1").get(tableId);

  let nextName = existing?.guest_name ?? null;
  let nextPhone = existing?.guest_phone ?? null;

  if (guestPatch.guest_name !== undefined) {
    const t = trimGuestStr(guestPatch.guest_name);
    if (t !== undefined && t !== null) nextName = t;
  }
  if (guestPatch.guest_phone !== undefined) {
    const t = trimGuestStr(guestPatch.guest_phone);
    if (t !== undefined && t !== null) nextPhone = t;
  }

  if (existing) {
    if (
      (guestPatch.guest_name !== undefined || guestPatch.guest_phone !== undefined) &&
      (nextName !== existing.guest_name || nextPhone !== existing.guest_phone)
    ) {
      db.prepare('UPDATE sessions SET guest_name = ?, guest_phone = ? WHERE id = ?').run(nextName, nextPhone, existing.id);
      return db.prepare('SELECT * FROM sessions WHERE id = ?').get(existing.id);
    }
    return existing;
  }

  const info = db
    .prepare('INSERT INTO sessions (table_id, guest_name, guest_phone) VALUES (?, ?, ?)')
    .run(tableId, nextName, nextPhone);
  db.prepare("UPDATE tables SET status = 'occupied' WHERE id = ?").run(tableId);
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(info.lastInsertRowid);
}

function getOpenSession(tableId) {
  const db = getDb();
  return db.prepare("SELECT * FROM sessions WHERE table_id = ? AND status = 'open' LIMIT 1").get(tableId);
}

/**
 * Place an order from a table.
 * - Splits cart by station so the bar prints a bar KOT and the kitchen a kitchen KOT.
 * - Round-robin assigns each KOT to the least-busy active steward.
 */
function placeOrder({ tableId, cart, note, guest_name, guest_phone }) {
  if (!Array.isArray(cart) || cart.length === 0) {
    throw Object.assign(new Error('Empty cart'), { status: 400 });
  }
  const db = getDb();
  const table = db.prepare('SELECT * FROM tables WHERE id = ?').get(tableId);
  if (!table) throw Object.assign(new Error('Unknown table'), { status: 404 });

  const enriched = cart.map((c) => {
    const item = getItem(c.menu_item_id);
    if (!item || !item.enabled) {
      throw Object.assign(new Error(`Menu item unavailable: ${c.menu_item_id}`), { status: 400 });
    }
    const variant = (item.variants || []).find((v) => v.label === c.variant_label) ||
                    (item.variants && item.variants.length === 1 ? item.variants[0] : null);
    if (!variant) {
      throw Object.assign(new Error(`Pick a variant for ${item.name}`), { status: 400 });
    }
    const qty = Math.max(1, parseInt(c.qty, 10) || 1);
    return {
      item, variant, qty,
      note: (c.note || '').toString().slice(0, 200),
      line_total: +(qty * variant.price).toFixed(2),
    };
  });

  const byStation = {};
  for (const e of enriched) {
    const st = e.item.station;
    (byStation[st] = byStation[st] || []).push(e);
  }

  const created = [];
  const guestPatch = {};
  if (guest_name !== undefined) guestPatch.guest_name = guest_name;
  if (guest_phone !== undefined) guestPatch.guest_phone = guest_phone;

  const tx = db.transaction(() => {
    const session = ensureOpenSession(db, tableId, guestPatch);
    for (const station of Object.keys(byStation)) {
      const kotNo = nextKotNumber(db, station);
      const stewardId = stewards.pickAssignee();
      const orderInfo = db.prepare(
        `INSERT INTO orders (session_id, table_id, kot_no, station, note, steward_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(session.id, tableId, kotNo, station, note || null, stewardId);
      const orderId = orderInfo.lastInsertRowid;
      const insLine = db.prepare(
        `INSERT INTO order_items (order_id, menu_item_id, name, variant_label, qty, unit_price, line_total, note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const e of byStation[station]) {
        insLine.run(orderId, e.item.id, e.item.name, e.variant.label, e.qty, e.variant.price, e.line_total, e.note || null);
      }
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
      created.push({ ...order, items });
    }
    db.prepare(
      "INSERT INTO audit_log (action, ref_type, ref_id, detail) VALUES ('place_order', 'session', ?, ?)"
    ).run(String(session.id), JSON.stringify({ tableId, count: created.length }));
  });
  tx();

  for (const ord of created) {
    const room = ord.station === 'BAR' ? 'station:bar' : 'station:kitchen';
    emit(room, 'order:new', ord);
    emit(`table:${tableId}`, 'order:update', ord);
    if (ord.steward_id) emit(`steward:${ord.steward_id}`, 'order:assigned', ord);
  }
  broadcast('floor:update', { tableId });
  return created;
}

function listOrdersForStation(station, statuses) {
  const db = getDb();
  const sts = statuses && statuses.length ? statuses : ['placed', 'accepted'];
  const placeholders = sts.map(() => '?').join(',');
  const orders = db.prepare(
    `SELECT * FROM orders WHERE station = ? AND status IN (${placeholders}) ORDER BY id ASC`
  ).all(station, ...sts);
  const out = [];
  for (const o of orders) {
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id);
    out.push({ ...o, items });
  }
  return out;
}

function listReadyOrders() {
  const db = getDb();
  const orders = db.prepare("SELECT * FROM orders WHERE status = 'ready' ORDER BY ready_at ASC").all();
  const out = [];
  for (const o of orders) {
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id);
    out.push({ ...o, items });
  }
  return out;
}

function getOrder(id) {
  const db = getDb();
  const o = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
  if (!o) return null;
  o.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id);
  return o;
}

function transition(orderId, toStatus, opts = {}) {
  const db = getDb();
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  if (!order) throw Object.assign(new Error('Order not found'), { status: 404 });
  const allowed = {
    placed: ['accepted', 'cancelled'],
    accepted: ['ready', 'cancelled'],
    ready: ['delivered'],
    delivered: [],
    cancelled: [],
  };
  if (!allowed[order.status].includes(toStatus)) {
    throw Object.assign(new Error(`Cannot move ${order.status} -> ${toStatus}`), { status: 409 });
  }
  const cols = {
    accepted: 'accepted_at',
    ready: 'ready_at',
    delivered: 'delivered_at',
    cancelled: 'cancelled_at',
  };
  const setExtra = cols[toStatus] ? `, ${cols[toStatus]} = datetime('now')` : '';
  db.prepare(`UPDATE orders SET status = ? ${setExtra} WHERE id = ?`).run(toStatus, orderId);
  db.prepare(
    "INSERT INTO audit_log (actor, action, ref_type, ref_id, detail) VALUES (?, 'order_transition', 'order', ?, ?)"
  ).run(opts.actor || 'system', String(orderId), JSON.stringify({ from: order.status, to: toStatus }));

  const updated = getOrder(orderId);
  const room = order.station === 'BAR' ? 'station:bar' : 'station:kitchen';
  emit(room, 'order:update', updated);
  emit(`table:${order.table_id}`, 'order:update', updated);

  if (updated.steward_id) {
    emit(`steward:${updated.steward_id}`, 'order:update', updated);
    if (toStatus === 'ready') emit(`steward:${updated.steward_id}`, 'order:ready', updated);
  }
  if (toStatus === 'cancelled') {
    emit(`table:${order.table_id}`, 'order:cancelled', updated);
  }
  if (toStatus === 'delivered') {
    emit(`table:${order.table_id}`, 'order:delivered', updated);
  }
  broadcast('floor:update', { tableId: order.table_id });
  return updated;
}

function listSessionOrders(sessionId) {
  const db = getDb();
  const orders = db.prepare('SELECT * FROM orders WHERE session_id = ? ORDER BY id ASC').all(sessionId);
  for (const o of orders) {
    o.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id);
  }
  return orders;
}

/**
 * @param {{ includeGuestToken?: boolean }} [opts]
 */
function listFloor(opts = {}) {
  const db = getDb();
  const tables = db.prepare('SELECT * FROM tables ORDER BY id').all();
  for (const t of tables) {
    if (!opts.includeGuestToken) delete t.guest_token;
    const session = db.prepare("SELECT * FROM sessions WHERE table_id = ? AND status = 'open' LIMIT 1").get(t.id);
    t.session = session || null;
    if (!session) {
      t.open_orders = 0;
      t.delivered_orders = 0;
      t.has_undelivered = false;
      t.awaiting_bill = false;
      t.derived_status = 'free';
    } else {
      const stats = db.prepare(`
        SELECT
          SUM(CASE WHEN status IN ('placed','accepted','ready') THEN 1 ELSE 0 END) AS undelivered,
          SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS delivered_count,
          SUM(CASE WHEN status NOT IN ('cancelled') THEN 1 ELSE 0 END) AS active_total
        FROM orders WHERE session_id = ?`).get(session.id);
      const hasUndelivered = (stats.undelivered || 0) > 0;
      t.open_orders = stats.undelivered || 0;
      t.delivered_orders = stats.delivered_count || 0;
      t.has_undelivered = hasUndelivered;
      t.awaiting_bill = !hasUndelivered && (stats.active_total || 0) > 0;
      t.derived_status = hasUndelivered ? 'in_service' : (t.awaiting_bill ? 'awaiting_bill' : 'occupied');
    }
  }
  return tables;
}

module.exports = {
  setIo,
  placeOrder,
  listOrdersForStation,
  listReadyOrders,
  getOrder,
  transition,
  ensureOpenSession,
  getOpenSession,
  listSessionOrders,
  listFloor,
  nextBillNumber,
};
