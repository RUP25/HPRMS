'use strict';

const { getDb } = require('../db/init');
const {
  listSessionOrders,
  nextBillNumber,
  getOpenSession,
} = require('./orderService');
const ids = require('./idsClient');

const GST = parseFloat(process.env.GST_PERCENT || '5');
const SVC = parseFloat(process.env.SERVICE_CHARGE_PERCENT || '0');

let ioRef = null;
function setIo(io) { ioRef = io; }
function emit(event, payload) { if (ioRef) ioRef.emit(event, payload); }

function calcTotals(orders) {
  let subtotal = 0;
  for (const o of orders) {
    if (o.status === 'cancelled') continue;
    for (const it of o.items) subtotal += it.line_total;
  }
  subtotal = +subtotal.toFixed(2);
  const svc = +(subtotal * (SVC / 100)).toFixed(2);
  const gst = +((subtotal + svc) * (GST / 100)).toFixed(2);
  const grand = +(subtotal + svc + gst).toFixed(2);
  return { subtotal, service_charge: svc, gst, grand_total: grand };
}

function getOrCreateBill(sessionId, { allowCreate = true } = {}) {
  const db = getDb();
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId);
  if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });

  let bill = db.prepare('SELECT * FROM bills WHERE session_id = ?').get(sessionId);
  const orders = listSessionOrders(sessionId);

  if (!bill) {
    if (!allowCreate) return null;
    const totals = calcTotals(orders);
    const billNo = nextBillNumber(db);
    const info = db.prepare(
      `INSERT INTO bills (session_id, bill_no, table_id, subtotal, service_charge, gst, grand_total, tip_steward, tip_chef, tip_bartender)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 0, 0)`
    ).run(sessionId, billNo, session.table_id, totals.subtotal, totals.service_charge, totals.gst, totals.grand_total);
    bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(info.lastInsertRowid);
  } else {
    const totals = calcTotals(orders);
    db.prepare(
      `UPDATE bills SET subtotal = ?, service_charge = ?, gst = ?, grand_total = ? WHERE id = ?`
    ).run(totals.subtotal, totals.service_charge, totals.gst, totals.grand_total, bill.id);
    bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(bill.id);
  }

  bill.orders = orders;
  bill.session = session;
  return bill;
}

function getBillById(billId) {
  const db = getDb();
  const bill = db.prepare('SELECT * FROM bills WHERE id = ?').get(billId);
  if (!bill) return null;
  bill.orders = listSessionOrders(bill.session_id);
  bill.session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(bill.session_id);
  return bill;
}

function listOpenBills() {
  const db = getDb();
  return db.prepare(
    `SELECT b.*, t.label AS table_label
     FROM bills b JOIN tables t ON t.id = b.table_id
     WHERE b.pay_status = 'unpaid'
     ORDER BY b.created_at DESC`
  ).all();
}

function listBills(limit = 100) {
  const db = getDb();
  return db.prepare(
    `SELECT b.*, t.label AS table_label
     FROM bills b JOIN tables t ON t.id = b.table_id
     ORDER BY b.created_at DESC LIMIT ?`
  ).all(limit);
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

/** Paid bills for one calendar day (local server TZ). `dayYmd` = YYYY-MM-DD */
function analyticsByOutletDay(dayYmd) {
  const db = getDb();
  const settledTs = `COALESCE(s.closed_at, b.created_at)`;
  return db.prepare(
    `SELECT t.outlet AS outlet,
            COUNT(*) AS bill_count,
            COALESCE(SUM(b.grand_total), 0) AS revenue
     FROM bills b
     JOIN tables t ON t.id = b.table_id
     JOIN sessions s ON s.id = b.session_id
     WHERE b.pay_status = 'paid'
       AND date(${settledTs}, 'localtime') = date(?)
     GROUP BY t.outlet`
  ).all(dayYmd);
}

/** Paid bills for one calendar month (local). `ym` = YYYY-MM */
function analyticsByOutletMonth(ym) {
  const db = getDb();
  const settledTs = `COALESCE(s.closed_at, b.created_at)`;
  return db.prepare(
    `SELECT t.outlet AS outlet,
            COUNT(*) AS bill_count,
            COALESCE(SUM(b.grand_total), 0) AS revenue
     FROM bills b
     JOIN tables t ON t.id = b.table_id
     JOIN sessions s ON s.id = b.session_id
     WHERE b.pay_status = 'paid'
       AND strftime('%Y-%m', ${settledTs}, 'localtime') = ?
     GROUP BY t.outlet`
  ).all(ym);
}

function mergeOutletMetrics(rows) {
  const o = {
    klong: { bills: 0, revenue: 0 },
    dopwai: { bills: 0, revenue: 0 },
  };
  for (const r of rows) {
    const key = r.outlet === 'klong' ? 'klong' : 'dopwai';
    o[key].bills = r.bill_count;
    o[key].revenue = +Number(r.revenue).toFixed(2);
  }
  return o;
}

function resolveAnalyticsRange(query = {}) {
  const db = getDb();
  const clock = db.prepare(`SELECT date('now', 'localtime') AS date_local, strftime('%Y-%m', 'now', 'localtime') AS month_ym`).get();

  let day =
    query.day !== undefined && query.day !== null && String(query.day).trim() !== ''
      ? String(query.day).trim()
      : clock.date_local;
  if (!DAY_RE.test(day)) {
    throw Object.assign(new Error('Invalid day — use YYYY-MM-DD'), { status: 400 });
  }

  let month =
    query.month !== undefined && query.month !== null && String(query.month).trim() !== ''
      ? String(query.month).trim()
      : clock.month_ym;
  if (!MONTH_RE.test(month)) {
    throw Object.assign(new Error('Invalid month — use YYYY-MM'), { status: 400 });
  }

  const mm = Number(month.split('-')[1]);
  if (mm < 1 || mm > 12) {
    throw Object.assign(new Error('Invalid month — use YYYY-MM'), { status: 400 });
  }

  return { day, month };
}

/**
 * Optional query: day=YYYY-MM-DD, month=YYYY-MM (each defaults to server local today / this month).
 */
function analyticsSummary(query = {}) {
  const { day, month } = resolveAnalyticsRange(query);
  return {
    day: mergeOutletMetrics(analyticsByOutletDay(day)),
    month: mergeOutletMetrics(analyticsByOutletMonth(month)),
    labels: { day, month },
  };
}

const LIST_LIMIT = 500;

function normalizeOutletFilter(query) {
  const raw = query.outlet;
  if (raw === undefined || raw === null || String(raw).trim() === '') return null;
  const o = String(raw).trim().toLowerCase();
  if (o === 'klong' || o === 'dopwai') return o;
  throw Object.assign(new Error('Invalid outlet — use klong or dopwai'), { status: 400 });
}

/** Paid bills on one day with table + session guest fields (for billing desk). */
function listPaidBillsForDay(query = {}) {
  const { day } = resolveAnalyticsRange(query);
  const outlet = normalizeOutletFilter(query);
  const db = getDb();
  const settledTs = `COALESCE(s.closed_at, b.created_at)`;
  const lim = LIST_LIMIT + 1;
  let rows;
  if (outlet) {
    rows = db.prepare(
      `SELECT b.id, b.bill_no, b.table_id, t.label AS table_label, t.outlet AS outlet,
              b.grand_total, b.pay_method,
              ${settledTs} AS settled_at,
              s.guest_name AS guest_name, s.guest_phone AS guest_phone, s.room_no AS room_no, s.pax AS pax
       FROM bills b
       JOIN tables t ON t.id = b.table_id
       JOIN sessions s ON s.id = b.session_id
       WHERE b.pay_status = 'paid'
         AND date(${settledTs}, 'localtime') = date(?)
         AND t.outlet = ?
       ORDER BY settled_at ASC
       LIMIT ?`
    ).all(day, outlet, lim);
  } else {
    rows = db.prepare(
      `SELECT b.id, b.bill_no, b.table_id, t.label AS table_label, t.outlet AS outlet,
              b.grand_total, b.pay_method,
              ${settledTs} AS settled_at,
              s.guest_name AS guest_name, s.guest_phone AS guest_phone, s.room_no AS room_no, s.pax AS pax
       FROM bills b
       JOIN tables t ON t.id = b.table_id
       JOIN sessions s ON s.id = b.session_id
       WHERE b.pay_status = 'paid'
         AND date(${settledTs}, 'localtime') = date(?)
       ORDER BY settled_at ASC
       LIMIT ?`
    ).all(day, lim);
  }
  const truncated = rows.length > LIST_LIMIT;
  const bills = (truncated ? rows.slice(0, LIST_LIMIT) : rows).map((r) => ({
    ...r,
    grand_total: +Number(r.grand_total).toFixed(2),
  }));
  return { bills, truncated };
}

function listPaidBillsForMonth(query = {}) {
  const { month } = resolveAnalyticsRange(query);
  const outlet = normalizeOutletFilter(query);
  const db = getDb();
  const settledTs = `COALESCE(s.closed_at, b.created_at)`;
  const lim = LIST_LIMIT + 1;
  let rows;
  if (outlet) {
    rows = db.prepare(
      `SELECT b.id, b.bill_no, b.table_id, t.label AS table_label, t.outlet AS outlet,
              b.grand_total, b.pay_method,
              ${settledTs} AS settled_at,
              s.guest_name AS guest_name, s.guest_phone AS guest_phone, s.room_no AS room_no, s.pax AS pax
       FROM bills b
       JOIN tables t ON t.id = b.table_id
       JOIN sessions s ON s.id = b.session_id
       WHERE b.pay_status = 'paid'
         AND strftime('%Y-%m', ${settledTs}, 'localtime') = ?
         AND t.outlet = ?
       ORDER BY settled_at DESC
       LIMIT ?`
    ).all(month, outlet, lim);
  } else {
    rows = db.prepare(
      `SELECT b.id, b.bill_no, b.table_id, t.label AS table_label, t.outlet AS outlet,
              b.grand_total, b.pay_method,
              ${settledTs} AS settled_at,
              s.guest_name AS guest_name, s.guest_phone AS guest_phone, s.room_no AS room_no, s.pax AS pax
       FROM bills b
       JOIN tables t ON t.id = b.table_id
       JOIN sessions s ON s.id = b.session_id
       WHERE b.pay_status = 'paid'
         AND strftime('%Y-%m', ${settledTs}, 'localtime') = ?
       ORDER BY settled_at DESC
       LIMIT ?`
    ).all(month, lim);
  }
  const truncated = rows.length > LIST_LIMIT;
  const bills = (truncated ? rows.slice(0, LIST_LIMIT) : rows).map((r) => ({
    ...r,
    grand_total: +Number(r.grand_total).toFixed(2),
  }));
  return { bills, truncated };
}

/**
 * Idempotently post a bill to IDS.
 * Once a bill has ids_status='posted', it will NOT be re-posted.
 * Returns the up-to-date bill.
 */
async function postToIds(billId, { actor = 'admin', force = false } = {}) {
  const db = getDb();
  const bill = getBillById(billId);
  if (!bill) throw Object.assign(new Error('Bill not found'), { status: 404 });
  if (bill.ids_status === 'posted' && !force) {
    return bill;
  }

  const payload = ids.buildPayload(bill);
  let resp;
  try {
    resp = await ids.postBill(payload);
  } catch (err) {
    db.prepare(
      `UPDATE bills SET ids_status = 'failed', ids_response = ? WHERE id = ?`
    ).run(JSON.stringify({ error: err.message, payload }), billId);
    db.prepare(
      "INSERT INTO audit_log (actor, action, ref_type, ref_id, detail) VALUES (?, 'ids_post_failed', 'bill', ?, ?)"
    ).run(actor, String(billId), err.message);
    throw err;
  }

  db.prepare(
    `UPDATE bills SET ids_status = 'posted', ids_reference = ?, ids_posted_at = datetime('now'),
     ids_payload = ?, ids_response = ? WHERE id = ?`
  ).run(resp.reference || null, JSON.stringify(payload), JSON.stringify(resp), billId);
  db.prepare(
    "INSERT INTO audit_log (actor, action, ref_type, ref_id, detail) VALUES (?, 'ids_posted', 'bill', ?, ?)"
  ).run(actor, String(billId), resp.reference || 'no-ref');
  emit('bill:update', { billId });
  return getBillById(billId);
}

const MAX_TIP = 500000;

function normalizeTipAmount(raw) {
  const n = typeof raw === 'number' ? raw : parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(Math.min(n, MAX_TIP) * 100) / 100;
}

/**
 * Guest-set appreciation tips (steward / chef). Ensures an unpaid bill row exists.
 */
function setGuestTipsForTable(
  tableId,
  { tip_steward = 0, tip_chef = 0, tip_bartender = 0 } = {},
) {
  const db = getDb();
  const session = getOpenSession(tableId);
  if (!session) throw Object.assign(new Error('No open session at this table'), { status: 404 });

  const bill = getOrCreateBill(session.id);
  if (bill.pay_status === 'paid') {
    throw Object.assign(new Error('Bill already settled'), { status: 400 });
  }

  const ts = normalizeTipAmount(tip_steward);
  const tc = normalizeTipAmount(tip_chef);
  const tb = normalizeTipAmount(tip_bartender);
  db.prepare(
    'UPDATE bills SET tip_steward = ?, tip_chef = ?, tip_bartender = ? WHERE id = ?',
  ).run(ts, tc, tb, bill.id);
  emit('bill:update', { billId: bill.id });
  emit('floor:update', { tableId });
  return getBillById(bill.id);
}

function settleBill(billId, { method = 'cash', actor = 'admin' } = {}) {
  const db = getDb();
  const bill = getBillById(billId);
  if (!bill) throw Object.assign(new Error('Bill not found'), { status: 404 });
  if (bill.pay_status === 'paid') return bill;

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE bills SET pay_status = 'paid', pay_method = ? WHERE id = ?`
    ).run(method, billId);
    db.prepare(
      "UPDATE sessions SET status = 'closed', closed_at = datetime('now'), bill_id = ? WHERE id = ?"
    ).run(billId, bill.session_id);
    db.prepare("UPDATE tables SET status = 'free' WHERE id = ?").run(bill.table_id);
    db.prepare(
      "INSERT INTO audit_log (actor, action, ref_type, ref_id, detail) VALUES (?, 'bill_settled', 'bill', ?, ?)"
    ).run(actor, String(billId), method);
  });
  tx();
  emit('floor:update', { tableId: bill.table_id });
  emit('bill:update', { billId });
  return getBillById(billId);
}

module.exports = {
  setIo,
  calcTotals,
  getOrCreateBill,
  getBillById,
  listOpenBills,
  listBills,
  analyticsSummary,
  listPaidBillsForDay,
  listPaidBillsForMonth,
  postToIds,
  setGuestTipsForTable,
  settleBill,
};
