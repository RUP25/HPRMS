'use strict';

const crypto = require('crypto');
const { getDb } = require('../db/init');

function timingSafeEqualStrings(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function verifyGuestCredentials(tableId, token) {
  const tid = parseInt(tableId, 10);
  if (!tid || !token || typeof token !== 'string') return false;
  const db = getDb();
  const row = db.prepare('SELECT guest_token FROM tables WHERE id = ?').get(tid);
  if (!row || !row.guest_token) return false;
  return timingSafeEqualStrings(String(token).trim(), String(row.guest_token));
}

module.exports = { verifyGuestCredentials, timingSafeEqualStrings };
