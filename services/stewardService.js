'use strict';

const { getDb } = require('../db/init');

function listStewards({ activeOnly = false } = {}) {
  const db = getDb();
  const q = activeOnly
    ? 'SELECT * FROM stewards WHERE active = 1 ORDER BY id'
    : 'SELECT * FROM stewards ORDER BY id';
  return db.prepare(q).all().map((s) => ({ ...s, active: !!s.active }));
}

function getSteward(id) {
  const db = getDb();
  const s = db.prepare('SELECT * FROM stewards WHERE id = ?').get(id);
  if (!s) return null;
  return { ...s, active: !!s.active };
}

function loginByPin(pin) {
  const db = getDb();
  const s = db.prepare('SELECT * FROM stewards WHERE pin = ? AND active = 1').get(String(pin));
  if (!s) return null;
  return { ...s, active: !!s.active };
}

function setActive(id, active) {
  const db = getDb();
  return db.prepare('UPDATE stewards SET active = ? WHERE id = ?').run(active ? 1 : 0, id);
}

/**
 * Pick the least-busy active steward for a new order.
 * "Busy" = number of orders currently in placed / accepted / ready states.
 * Ties broken by least recent assignment so rotation stays even.
 */
function pickAssignee() {
  const db = getDb();
  const row = db.prepare(`
    SELECT s.id,
           COUNT(o.id) AS load,
           COALESCE(MAX(o.created_at), '') AS last_assigned
    FROM stewards s
    LEFT JOIN orders o
      ON o.steward_id = s.id
     AND o.status IN ('placed', 'accepted', 'ready')
    WHERE s.active = 1
    GROUP BY s.id
    ORDER BY load ASC, last_assigned ASC, s.id ASC
    LIMIT 1
  `).get();
  return row ? row.id : null;
}

function ordersForSteward(stewardId, { includeDelivered = false } = {}) {
  const db = getDb();
  const sts = includeDelivered
    ? ['placed', 'accepted', 'ready', 'delivered']
    : ['placed', 'accepted', 'ready'];
  const placeholders = sts.map(() => '?').join(',');
  const orders = db.prepare(
    `SELECT * FROM orders
     WHERE steward_id = ? AND status IN (${placeholders})
     ORDER BY id ASC`
  ).all(stewardId, ...sts);
  for (const o of orders) {
    o.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(o.id);
  }
  return orders;
}

function pinTaken(pin, excludeId = null) {
  const db = getDb();
  const p = String(pin);
  const row =
    excludeId == null
      ? db.prepare('SELECT id FROM stewards WHERE pin = ?').get(p)
      : db.prepare('SELECT id FROM stewards WHERE pin = ? AND id != ?').get(p, excludeId);
  return !!row;
}

function createSteward({ name, pin, active = true } = {}) {
  const n = (name || '').trim();
  const p = pin != null ? String(pin).trim() : '';
  if (!n) throw Object.assign(new Error('Name required'), { status: 400 });
  if (!p) throw Object.assign(new Error('PIN required'), { status: 400 });
  if (pinTaken(p)) throw Object.assign(new Error('PIN already in use'), { status: 409 });
  const db = getDb();
  const r = db.prepare('INSERT INTO stewards (name, pin, active) VALUES (?, ?, ?)').run(n, p, active ? 1 : 0);
  return getSteward(Number(r.lastInsertRowid));
}

function updateSteward(id, patch = {}) {
  const db = getDb();
  const existing = getSteward(id);
  if (!existing) throw Object.assign(new Error('Steward not found'), { status: 404 });
  let n = existing.name;
  let p = existing.pin;
  let a = existing.active ? 1 : 0;
  if ('name' in patch) {
    const t = String(patch.name || '').trim();
    if (!t) throw Object.assign(new Error('Name required'), { status: 400 });
    n = t;
  }
  if ('pin' in patch && patch.pin != null && String(patch.pin).trim() !== '') {
    const np = String(patch.pin).trim();
    if (!np) throw Object.assign(new Error('PIN required'), { status: 400 });
    if (pinTaken(np, id)) throw Object.assign(new Error('PIN already in use'), { status: 409 });
    p = np;
  }
  if ('active' in patch) a = patch.active ? 1 : 0;
  db.prepare('UPDATE stewards SET name = ?, pin = ?, active = ? WHERE id = ?').run(n, p, a, id);
  return getSteward(id);
}

function deleteSteward(id) {
  const db = getDb();
  const existing = getSteward(id);
  if (!existing) throw Object.assign(new Error('Steward not found'), { status: 404 });
  db.prepare('UPDATE orders SET steward_id = NULL WHERE steward_id = ?').run(id);
  db.prepare('DELETE FROM stewards WHERE id = ?').run(id);
  return { ok: true };
}

function loadStats() {
  const db = getDb();
  return db.prepare(`
    SELECT s.id, s.name, s.active,
      (SELECT COUNT(*) FROM orders o
        WHERE o.steward_id = s.id AND o.status IN ('placed','accepted','ready')) AS active_load,
      (SELECT COUNT(*) FROM orders o
        WHERE o.steward_id = s.id AND o.status = 'delivered'
          AND date(o.delivered_at) = date('now', 'localtime')) AS delivered_today
    FROM stewards s ORDER BY s.id
  `).all().map((r) => ({ ...r, active: !!r.active }));
}

module.exports = {
  listStewards,
  getSteward,
  loginByPin,
  setActive,
  pickAssignee,
  ordersForSteward,
  loadStats,
  createSteward,
  updateSteward,
  deleteSteward,
};
