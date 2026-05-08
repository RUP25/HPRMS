'use strict';

const express = require('express');
const router = express.Router();

const menuService = require('../services/menuService');
const orderService = require('../services/orderService');
const billingService = require('../services/billingService');
const stewardService = require('../services/stewardService');
const { getDb } = require('../db/init');
const authTokens = require('../services/authTokens');
const rateLimitLogin = require('../middleware/rateLimit').loginWindow;
const {
  requireRoles,
  requireTableGuest,
  pinOk,
  normalizeOperatorPin,
  assertTransitionAllowed,
  assertOrderReadAllowed,
} = require('../middleware/httpAuth');

router.get('/health', (req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

router.get('/config', (req, res) => {
  res.json({
    hotel: process.env.HOTEL_NAME || 'Hotel Poinisuk',
    restaurant: process.env.RESTAURANT_NAME || 'Dopwai',
    bar: process.env.BAR_NAME || 'Klong',
    gst_percent: parseFloat(process.env.GST_PERCENT || '5'),
    service_charge_percent: parseFloat(process.env.SERVICE_CHARGE_PERCENT || '0'),
    ids_enabled: /^true$/i.test(process.env.IDS_ENABLED || ''),
  });
});

function envPinRaw(role) {
  const map = {
    admin: process.env.ADMIN_PIN,
    kitchen: process.env.KITCHEN_PIN,
    bar: process.env.BAR_PIN,
    billing: process.env.BILLING_PIN || process.env.ADMIN_PIN,
  };
  return normalizeOperatorPin(map[role]);
}

router.post('/auth/login', rateLimitLogin(), (req, res) => {
  const role = ((req.body && req.body.role) || '').toString().trim();
  const pinRaw = req.body && req.body.pin;
  const pin =
    pinRaw === undefined || pinRaw === null ? '' : String(pinRaw).trim();
  const env = envPinRaw(role);
  if (!role || !['admin', 'kitchen', 'bar', 'billing'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  if (!env) {
    console.warn('[hprms] auth/login: missing PIN in env for role:', role);
    return res.status(503).json({ error: 'Login not configured for this role' });
  }
  if (!pin) {
    return res.status(400).json({ error: 'PIN required' });
  }
  if (!pinOk(env, pin)) {
    const gn = normalizeOperatorPin(pin);
    console.warn(
      '[hprms] auth/login failed role=%s (normalized PIN lengths submitted=%d expected=%d)',
      role,
      gn.length,
      env.length
    );
    return res.status(401).json({ error: 'Invalid PIN' });
  }
  const { token, exp } = authTokens.issueOperatorToken(role);
  res.json({ ok: true, role, token, expires_at: new Date(exp).toISOString() });
});

router.get('/tables', requireRoles('admin', 'billing'), (req, res) => {
  const includeGuestToken = req.auth.role === 'admin';
  res.json(orderService.listFloor({ includeGuestToken }));
});

router.get('/tables/:id', (req, res) => {
  const db = getDb();
  const t = db.prepare('SELECT * FROM tables WHERE id = ?').get(parseInt(req.params.id, 10));
  if (!t) return res.status(404).json({ error: 'Table not found' });
  delete t.guest_token;
  res.json(t);
});

router.get('/menu', (req, res) => {
  const outlet = req.query.outlet;
  const query = req.query.q;
  res.json(menuService.listMenu({ outlet, query }));
});

router.get('/menu/categories', (req, res) => res.json(menuService.listCategories()));

router.get('/menu/admin', requireRoles('admin'), (req, res) =>
  res.json(menuService.listForAdmin({ outlet: req.query.outlet, query: req.query.q }))
);

router.get('/menu/:itemId', (req, res) => {
  const it = menuService.getItem(req.params.itemId);
  if (!it) return res.status(404).json({ error: 'Not found' });
  res.json(it);
});

router.post('/menu', requireRoles('admin'), (req, res) => {
  try {
    res.status(201).json(menuService.createItem(req.body || {}));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.patch('/menu/:itemId', requireRoles('admin'), (req, res) => {
  try {
    res.json(menuService.updateItem(req.params.itemId, req.body || {}));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.delete('/menu/:itemId', requireRoles('admin'), (req, res) => {
  try {
    res.json(menuService.deleteItem(req.params.itemId));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/menu/:itemId/toggle', requireRoles('admin'), (req, res) => {
  const item = menuService.getItem(req.params.itemId);
  if (!item) return res.status(404).json({ error: 'Item not found' });
  menuService.setEnabled(req.params.itemId, !item.enabled);
  res.json({ ok: true, enabled: !item.enabled });
});

router.post('/orders', requireTableGuest, (req, res) => {
  try {
    const { table_id, cart, note, guest_name, guest_phone } = req.body || {};
    if (!table_id) return res.status(400).json({ error: 'table_id required' });
    const tid = parseInt(table_id, 10);
    if (tid !== req.guestTableId) {
      return res.status(403).json({ error: 'Token does not match table' });
    }
    const gn =
      guest_name !== undefined ? String(guest_name).trim().slice(0, 120) : undefined;
    const gp =
      guest_phone !== undefined ? String(guest_phone).replace(/[^\d+]/g, '').slice(0, 24) : undefined;
    const created = orderService.placeOrder({
      tableId: tid,
      cart,
      note,
      guest_name: gn === '' ? undefined : gn,
      guest_phone: gp === '' ? undefined : gp,
    });
    res.status(201).json({ ok: true, orders: created });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/orders', requireRoles('admin', 'billing', 'kitchen', 'bar'), (req, res) => {
  const station = req.query.station;
  const auth = req.auth;

  if (station === 'ready') {
    if (!['admin', 'billing'].includes(auth.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return res.json(orderService.listReadyOrders());
  }

  if (!station) return res.status(400).json({ error: 'station required (BAR|KITCHEN|ready)' });

  if (station === 'KITCHEN' && !['admin', 'billing', 'kitchen'].includes(auth.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  if (station === 'BAR' && !['admin', 'billing', 'bar'].includes(auth.role)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  const statuses = (req.query.statuses || '').split(',').filter(Boolean);
  res.json(orderService.listOrdersForStation(station, statuses));
});

router.get('/orders/:id', requireRoles('admin', 'billing', 'kitchen', 'bar', 'steward'), (req, res) => {
  const order = orderService.getOrder(parseInt(req.params.id, 10));
  if (!order) return res.status(404).json({ error: 'Order not found' });
  try {
    assertOrderReadAllowed(req.auth, order);
  } catch (e) {
    return res.status(e.status || 403).json({ error: e.message });
  }
  res.json(order);
});

router.post('/orders/:id/transition', requireRoles('admin', 'billing', 'kitchen', 'bar', 'steward'), (req, res) => {
  try {
    const orderId = parseInt(req.params.id, 10);
    const order = orderService.getOrder(orderId);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    assertTransitionAllowed(req.auth, order, req.body.to);
    const updated = orderService.transition(orderId, req.body.to, { actor: req.body.actor || 'system' });
    res.json(updated);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/sessions/by-table/:tableId', requireTableGuest, (req, res) => {
  const tid = parseInt(req.params.tableId, 10);
  if (tid !== req.guestTableId) return res.status(403).json({ error: 'Token does not match table' });
  const session = orderService.getOpenSession(tid);
  if (!session) return res.json(null);
  const orders = orderService.listSessionOrders(session.id);
  session.orders = orders;

  const db = getDb();
  const stats = db
    .prepare(
      `SELECT
          SUM(CASE WHEN status IN ('placed','accepted','ready') THEN 1 ELSE 0 END) AS undelivered,
          SUM(CASE WHEN status NOT IN ('cancelled') THEN 1 ELSE 0 END) AS active_total
        FROM orders WHERE session_id = ?`,
    )
    .get(session.id);
  const hasUndelivered = (stats.undelivered || 0) > 0;
  const activeTotal = stats.active_total || 0;
  session.awaiting_bill = !hasUndelivered && activeTotal > 0;

  session.totals = billingService.calcTotals(orders);
  const billRow = db
    .prepare(
      `SELECT id, bill_no, subtotal, service_charge, gst, grand_total, pay_status,
              tip_steward, tip_chef, tip_bartender FROM bills WHERE session_id = ?`,
    )
    .get(session.id);
  session.bill = billRow || null;

  res.json(session);
});

router.patch('/sessions/by-table/:tableId/tips', requireTableGuest, (req, res) => {
  try {
    const tid = parseInt(req.params.tableId, 10);
    if (tid !== req.guestTableId) {
      return res.status(403).json({ error: 'Token does not match table' });
    }
    const body = req.body || {};
    const bill = billingService.setGuestTipsForTable(tid, {
      tip_steward: body.tip_steward,
      tip_chef: body.tip_chef,
      tip_bartender: body.tip_bartender,
    });
    res.json({
      ok: true,
      tip_steward: +(Number(bill.tip_steward ?? 0).toFixed(2)),
      tip_chef: +(Number(bill.tip_chef ?? 0).toFixed(2)),
      tip_bartender: +(Number(bill.tip_bartender ?? 0).toFixed(2)),
      bill_no: bill.bill_no,
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/bills', requireRoles('admin', 'billing'), (req, res) => {
  if (req.query.open === 'true') return res.json(billingService.listOpenBills());
  const analyticsFlag = String(req.query.analytics || '').toLowerCase();
  if (analyticsFlag === '1' || analyticsFlag === 'true' || analyticsFlag === 'summary') {
    try {
      return res.json(billingService.analyticsSummary(req.query || {}));
    } catch (e) {
      return res.status(e.status || 400).json({ error: e.message });
    }
  }
  if (analyticsFlag === 'bills-day') {
    try {
      return res.json(billingService.listPaidBillsForDay(req.query || {}));
    } catch (e) {
      return res.status(e.status || 400).json({ error: e.message });
    }
  }
  if (analyticsFlag === 'bills-month') {
    try {
      return res.json(billingService.listPaidBillsForMonth(req.query || {}));
    } catch (e) {
      return res.status(e.status || 400).json({ error: e.message });
    }
  }
  res.json(billingService.listBills(parseInt(req.query.limit, 10) || 100));
});

function billsAnalyticsHandler(req, res) {
  try {
    res.json(billingService.analyticsSummary(req.query || {}));
  } catch (e) {
    res.status(e.status || 400).json({ error: e.message });
  }
}

/** Extra paths for direct API use (some proxies only forward GET /api/bills?…). */
router.get('/bills/load/analytics', requireRoles('admin', 'billing'), billsAnalyticsHandler);

router.get('/bills/analytics/summary', requireRoles('admin', 'billing'), billsAnalyticsHandler);

router.get('/bills/:id', requireRoles('admin', 'billing'), (req, res) => {
  const b = billingService.getBillById(parseInt(req.params.id, 10));
  if (!b) return res.status(404).json({ error: 'Bill not found' });
  res.json(b);
});

router.post('/sessions/:sessionId/bill', requireRoles('admin', 'billing'), (req, res) => {
  try {
    res.json(billingService.getOrCreateBill(parseInt(req.params.sessionId, 10)));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/bills/:id/post-ids', requireRoles('admin', 'billing'), async (req, res) => {
  try {
    const b = await billingService.postToIds(parseInt(req.params.id, 10), {
      actor: req.body.actor || 'admin',
      force: !!req.body.force,
    });
    res.json(b);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/bills/:id/settle', requireRoles('admin', 'billing'), (req, res) => {
  try {
    res.json(
      billingService.settleBill(parseInt(req.params.id, 10), {
        method: req.body.method || 'cash',
        actor: req.body.actor || 'cashier',
      })
    );
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/stewards', requireRoles('admin'), (req, res) => res.json(stewardService.listStewards()));

router.get('/stewards/load', requireRoles('admin'), (req, res) => res.json(stewardService.loadStats()));

/*
 * Admin steward CRUD lives under `/stewards/load/...` so it shares the same URL prefix as the
 * dashboard endpoint (some reverse proxies only forward `/api/stewards/load*`).
 * Canonical REST paths `/stewards`, `/stewards/:id` remain for direct API access.
 */
router.get('/stewards/load/detail/:id', requireRoles('admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const s = stewardService.getSteward(id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json(s);
});

router.post('/stewards/load/create', requireRoles('admin'), (req, res) => {
  try {
    const created = stewardService.createSteward(req.body || {});
    res.status(201).json(created);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.patch('/stewards/load/detail/:id', requireRoles('admin'), (req, res) => {
  try {
    res.json(stewardService.updateSteward(parseInt(req.params.id, 10), req.body || {}));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.delete('/stewards/load/detail/:id', requireRoles('admin'), (req, res) => {
  try {
    res.json(stewardService.deleteSteward(parseInt(req.params.id, 10)));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/stewards/load/detail/:id/active', requireRoles('admin'), (req, res) => {
  stewardService.setActive(parseInt(req.params.id, 10), !!req.body.active);
  res.json({ ok: true });
});

router.post('/stewards/login', rateLimitLogin(), (req, res) => {
  const s = stewardService.loginByPin(req.body && req.body.pin);
  if (!s) return res.status(401).json({ error: 'Invalid PIN' });
  const { token, exp } = authTokens.issueStewardToken(s.id);
  res.json({
    ok: true,
    token,
    expires_at: new Date(exp).toISOString(),
    steward: { id: s.id, name: s.name },
  });
});

router.post('/stewards', requireRoles('admin'), (req, res) => {
  try {
    const created = stewardService.createSteward(req.body || {});
    res.status(201).json(created);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/stewards/:id', requireRoles('admin'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const s = stewardService.getSteward(id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  res.json(s);
});

router.patch('/stewards/:id', requireRoles('admin'), (req, res) => {
  try {
    res.json(stewardService.updateSteward(parseInt(req.params.id, 10), req.body || {}));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.delete('/stewards/:id', requireRoles('admin'), (req, res) => {
  try {
    res.json(stewardService.deleteSteward(parseInt(req.params.id, 10)));
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/stewards/:id/orders', requireRoles('admin', 'steward'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (req.auth.role === 'steward' && req.auth.stewardId !== id) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  res.json(stewardService.ordersForSteward(id, { includeDelivered: req.query.delivered === '1' }));
});

router.post('/stewards/:id/active', requireRoles('admin'), (req, res) => {
  stewardService.setActive(parseInt(req.params.id, 10), !!req.body.active);
  res.json({ ok: true });
});

router.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

module.exports = router;
