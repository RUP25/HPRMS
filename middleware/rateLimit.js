'use strict';

/**
 * Simple fixed-window rate limiter by IP (best-effort; trust proxy when behind nginx).
 */

const WINDOW_MS = parseInt(process.env.RATE_LIMIT_LOGIN_WINDOW_MS || '900000', 10);
const MAX = parseInt(process.env.RATE_LIMIT_LOGIN_MAX || '40', 10);

const buckets = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [ip, b] of buckets) {
    if (now >= b.resetAt) buckets.delete(ip);
  }
}, 600000).unref();

function loginWindow() {
  return (req, res, next) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();
    let b = buckets.get(ip);
    if (!b || now >= b.resetAt) {
      b = { n: 0, resetAt: now + WINDOW_MS };
      buckets.set(ip, b);
    }
    b.n += 1;
    if (b.n > MAX) {
      const sec = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(sec));
      return res.status(429).json({ error: 'Too many login attempts. Try again later.' });
    }
    next();
  };
}

module.exports = { loginWindow };
