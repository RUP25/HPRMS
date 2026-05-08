'use strict';

const path = require('path');
const fs = require('fs');

// Always load `.env` next to this file — not cwd (fixes wrong ADMIN_PIN when started from another folder).
const ENV_PATH = path.join(__dirname, '.env');
const dotenvResult = require('dotenv').config({
  path: ENV_PATH,
  override: true,
});

const http = require('http');
const express = require('express');
const morgan = require('morgan');
const cors = require('cors');
const compression = require('compression');
const { Server } = require('socket.io');

const { init, getDb } = require('./db/init');
const apiRouter = require('./routes/api');
const orderService = require('./services/orderService');
const billingService = require('./services/billingService');
const authTokens = require('./services/authTokens');
const { verifyGuestCredentials } = require('./services/tableGuestAuth');
const { normalizeOperatorPin } = require('./middleware/httpAuth');

require('./services/pinDigitFold').ndDecimalBlocksOfTen();

const isProd = process.env.NODE_ENV === 'production';

function assertProductionSecrets() {
  if (!isProd) return;
  const sec = String(process.env.AUTH_SECRET || '').trim();
  if (sec.length < 24) {
    console.error(
      '[hprms] Refusing to start: NODE_ENV=production requires AUTH_SECRET (at least 24 characters).',
    );
    process.exit(1);
  }
}

assertProductionSecrets();
init();

function normalizedPublicBaseUrl() {
  const explicit = String(process.env.PUBLIC_BASE_URL || '')
    .trim()
    .replace(/\/$/, '');
  if (explicit) return explicit;
  return String(process.env.RENDER_EXTERNAL_URL || '')
    .trim()
    .replace(/\/$/, '');
}

function parseAllowedOrigins() {
  const raw = process.env.CORS_ORIGINS || '';
  const fromEnv = raw
    .split(',')
    .map((s) => s.trim().replace(/\/$/, ''))
    .filter(Boolean);
  const pub = normalizedPublicBaseUrl();
  const list = [...fromEnv];
  if (pub && !list.includes(pub)) list.push(pub);
  return list;
}

function buildCorsOptions() {
  if (!isProd) {
    return { origin: true, credentials: false };
  }
  const allowed = parseAllowedOrigins();
  if (allowed.length === 0) {
    console.warn(
      '[hprms] Production: set CORS_ORIGINS and/or PUBLIC_BASE_URL to restrict browser/API origins (currently allowing any origin).',
    );
    return { origin: true, credentials: false };
  }
  return { origin: allowed, credentials: false };
}

const corsOptions = buildCorsOptions();

const app = express();
const server = http.createServer(app);

if (process.env.TRUST_PROXY === '1' || /^true$/i.test(process.env.TRUST_PROXY || '')) {
  app.set('trust proxy', 1);
}

const io = new Server(server, {
  cors: {
    origin: corsOptions.origin,
    methods: ['GET', 'POST'],
  },
});

orderService.setIo(io);
billingService.setIo(io);

io.use((socket, next) => {
  socket.data.operator = null;
  socket.data.guestTableId = null;
  const { token, guestTable, guestToken } = socket.handshake.auth || {};

  if (token) {
    const payload = authTokens.verify(token);
    if (!payload) return next(new Error('Unauthorized'));
    socket.data.operator = payload;
    return next();
  }

  const gt = parseInt(guestTable, 10);
  if (gt && guestToken && verifyGuestCredentials(gt, String(guestToken))) {
    socket.data.guestTableId = gt;
    return next();
  }

  return next(new Error('Unauthorized'));
});

io.on('connection', (socket) => {
  socket.on('join', (room) => {
    if (typeof room !== 'string') return;
    const op = socket.data.operator;
    const guestTid = socket.data.guestTableId;

    const tableM = /^table:(\d+)$/.exec(room);
    if (tableM) {
      const id = parseInt(tableM[1], 10);
      if (guestTid === id) return void socket.join(room);
      if (op && ['admin', 'billing', 'kitchen', 'bar', 'steward'].includes(op.role)) {
        return void socket.join(room);
      }
      return;
    }

    const stM = /^station:(bar|kitchen)$/.exec(room);
    if (stM) {
      if (!op) return;
      if (op.role === 'admin' || op.role === 'billing') return void socket.join(room);
      if (op.role === 'kitchen' && room === 'station:kitchen') return void socket.join(room);
      if (op.role === 'bar' && room === 'station:bar') return void socket.join(room);
      return;
    }

    const roleM = /^role:(steward|admin|billing)$/.exec(room);
    if (roleM) {
      if (!op) return;
      const r = roleM[1];
      if (r === 'admin' && op.role === 'admin') return void socket.join(room);
      if (r === 'billing' && (op.role === 'billing' || op.role === 'admin')) {
        return void socket.join(room);
      }
      if (r === 'steward' && op.role === 'steward') return void socket.join(room);
      return;
    }

    const stewM = /^steward:(\d+)$/.exec(room);
    if (stewM) {
      const sid = parseInt(stewM[1], 10);
      if (!op) return;
      if (op.role === 'admin') return void socket.join(room);
      if (op.role === 'steward' && op.stewardId === sid) return void socket.join(room);
      return;
    }
  });
});

app.use(compression());

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

app.use(cors(corsOptions));
app.use(express.json({ limit: '256kb', strict: true }));
app.use(isProd ? morgan('combined') : morgan('dev'));

app.use('/api', apiRouter);

app.use('/assets', express.static(path.join(__dirname, 'public', 'assets')));
app.use('/shared', express.static(path.join(__dirname, 'public', 'shared')));

app.get('/t/:tableId', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'customer', 'index.html')),
);
app.use('/customer', express.static(path.join(__dirname, 'public', 'customer')));

app.get('/kitchen', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'kitchen', 'index.html')),
);
app.use('/kitchen-static', express.static(path.join(__dirname, 'public', 'kitchen')));

app.get('/bar', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'bar', 'index.html')),
);
app.use('/bar-static', express.static(path.join(__dirname, 'public', 'bar')));

app.get('/steward', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'steward', 'index.html')),
);
app.get('/steward/:id', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'steward', 'index.html')),
);
app.use('/steward-static', express.static(path.join(__dirname, 'public', 'steward')));

app.get('/admin', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'admin', 'index.html')),
);
app.use('/admin-static', express.static(path.join(__dirname, 'public', 'admin')));

app.get('/billing', (req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'billing', 'index.html')),
);
app.use('/billing-static', express.static(path.join(__dirname, 'public', 'billing')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use(express.static(path.join(__dirname, 'public')));

app.use((err, req, res, next) => {
  console.error('[hprms] error', err);
  const raw = Number(err.status);
  const status = Number.isFinite(raw) && raw >= 400 ? raw : 500;
  const msg =
    isProd && status >= 500 ? 'Server error' : err.message || 'Server error';
  res.status(status).json({ error: msg });
});

process.on('unhandledRejection', (reason) => {
  console.error('[hprms] unhandledRejection', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[hprms] uncaughtException', err);
  process.exit(1);
});

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`[hprms] listening on http://${HOST}:${PORT} (${isProd ? 'production' : 'development'})`);
  if (!isProd) {
    console.log('[hprms] Customer URL pattern: /t/:tableId?t=<guest_token>  (run npm run qr)');
    console.log('[hprms] Operator surfaces: /kitchen  /bar  /steward  /admin  /billing');
    const adm = normalizeOperatorPin(process.env.ADMIN_PIN);
    console.log('[hprms] ADMIN_PIN effective length (after normalize):', adm.length);
  }
  if (dotenvResult.error) {
    console.warn('[hprms] dotenv:', dotenvResult.error.message);
  }
  if (!isProd || !fs.existsSync(ENV_PATH)) {
    console.log('[hprms] Env file:', ENV_PATH, fs.existsSync(ENV_PATH) ? '(found)' : '(MISSING — copy .env.example)');
  }
});

function shutdown(signal) {
  console.log(`[hprms] ${signal} received, closing…`);
  server.close(() => {
    try {
      getDb().close();
    } catch (_) {
      /* ignore */
    }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 15000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
