'use strict';

const crypto = require('crypto');

const TTL_MS = parseInt(process.env.AUTH_TOKEN_TTL_MS || String(12 * 60 * 60 * 1000), 10);

function secretKey() {
  const raw = process.env.AUTH_SECRET || '';
  if (raw.length < 16) {
    console.warn(
      '[hprms] AUTH_SECRET is missing or short — using an insecure dev-only fallback. Use a strong secret (24+ chars for production with NODE_ENV=production).',
    );
    return crypto.createHash('sha256').update('hprms-dev-insecure-fallback').digest();
  }
  return crypto.createHash('sha256').update(raw, 'utf8').digest();
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secretKey()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expect = crypto.createHmac('sha256', secretKey()).update(body).digest('base64url');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expect, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (_) {
    return null;
  }
}

function issueOperatorToken(role) {
  const exp = Date.now() + TTL_MS;
  return {
    token: sign({ v: 1, role, exp }),
    exp,
  };
}

function issueStewardToken(stewardId) {
  const exp = Date.now() + TTL_MS;
  return {
    token: sign({ v: 1, role: 'steward', stewardId, exp }),
    exp,
  };
}

module.exports = {
  verify,
  issueOperatorToken,
  issueStewardToken,
  TTL_MS,
};
