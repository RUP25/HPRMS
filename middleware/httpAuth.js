'use strict';

const authTokens = require('../services/authTokens');
const { timingSafeEqualStrings, verifyGuestCredentials } = require('../services/tableGuestAuth');
const { foldDecimalNdToAscii } = require('../services/pinDigitFold');

function getBearer(req) {
  const h = req.headers.authorization;
  if (!h || typeof h !== 'string') return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

function requireRoles(...roles) {
  const allow = new Set(roles);
  return (req, res, next) => {
    const token = getBearer(req);
    const payload = token ? authTokens.verify(token) : null;
    if (!payload || !allow.has(payload.role)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    req.auth = payload;
    next();
  };
}

/** POST /orders uses body.table_id; GET ... uses params.tableId */
function requireTableGuest(req, res, next) {
  const tidRaw = req.params.tableId ?? req.body?.table_id;
  const tid = parseInt(tidRaw, 10);
  const hdr = req.headers['x-table-token'];
  const token = typeof hdr === 'string' ? hdr.trim() : '';
  if (!tid || !token) {
    return res.status(401).json({ error: 'Table guest token required (X-Table-Token)' });
  }
  if (!verifyGuestCredentials(tid, token)) {
    return res.status(403).json({ error: 'Invalid table credentials' });
  }
  req.guestTableId = tid;
  next();
}

/** Normalize PIN from .env or device (NFKC, strip ZWSP / bidi marks / BOM). */
function normalizeOperatorPin(val) {
  if (val === undefined || val === null) return '';
  let s = String(val).replace(/\r/g, '').replace(/^\uFEFF/, '');
  try {
    s = s.normalize('NFKC');
  } catch (_) {
    /* ignore invalid unicode */
  }
  return s
    .replace(/[\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069\u200E\u200F]/g, '')
    .trim();
}

function pinOk(envVal, submitted) {
  const exp = foldDecimalNdToAscii(normalizeOperatorPin(envVal));
  const got = foldDecimalNdToAscii(normalizeOperatorPin(submitted));
  if (!exp || !got) return false;
  return timingSafeEqualStrings(exp, got);
}

function assertTransitionAllowed(auth, order, toStatus) {
  const role = auth.role;
  if (role === 'admin' || role === 'billing') return;

  if (role === 'steward') {
    if (auth.stewardId !== order.steward_id) {
      throw Object.assign(new Error('Not assigned to this order'), { status: 403 });
    }
    if (order.status !== 'ready' || toStatus !== 'delivered') {
      throw Object.assign(new Error('Stewards may only mark ready orders as delivered'), { status: 403 });
    }
    return;
  }

  if (role === 'kitchen') {
    if (order.station !== 'KITCHEN') {
      throw Object.assign(new Error('Not authorized for this station'), { status: 403 });
    }
    const ok =
      (order.status === 'placed' && ['accepted', 'cancelled'].includes(toStatus)) ||
      (order.status === 'accepted' && ['ready', 'cancelled'].includes(toStatus));
    if (!ok) {
      throw Object.assign(new Error('Transition not allowed for kitchen'), { status: 403 });
    }
    return;
  }

  if (role === 'bar') {
    if (order.station !== 'BAR') {
      throw Object.assign(new Error('Not authorized for this station'), { status: 403 });
    }
    const ok =
      (order.status === 'placed' && ['accepted', 'cancelled'].includes(toStatus)) ||
      (order.status === 'accepted' && ['ready', 'cancelled'].includes(toStatus));
    if (!ok) {
      throw Object.assign(new Error('Transition not allowed for bar'), { status: 403 });
    }
    return;
  }

  throw Object.assign(new Error('Unauthorized'), { status: 403 });
}

function assertOrderReadAllowed(auth, order) {
  if (!order) return;
  const role = auth.role;
  if (role === 'admin' || role === 'billing') return;
  if (role === 'kitchen' && order.station === 'KITCHEN') return;
  if (role === 'bar' && order.station === 'BAR') return;
  if (role === 'steward' && auth.stewardId === order.steward_id) return;
  throw Object.assign(new Error('Forbidden'), { status: 403 });
}

module.exports = {
  getBearer,
  verifyToken: authTokens.verify,
  requireRoles,
  requireTableGuest,
  pinOk,
  normalizeOperatorPin,
  assertTransitionAllowed,
  assertOrderReadAllowed,
};
