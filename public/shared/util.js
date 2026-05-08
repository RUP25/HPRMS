window.HPRMS = (function () {
  const OP_TOKEN_KEY = 'hprms.operatorToken';

  /** Operator surfaces share Bearer auth via sessionStorage for REST + Socket.IO */
  let tableGuestAuth = null;

  const fmtMoney = (n) =>
    '\u20B9' + (Number(n) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const fmtTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso.endsWith('Z') || iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const elapsed = (iso) => {
    if (!iso) return '';
    const d = new Date(iso.endsWith('Z') || iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
    const s = Math.max(0, Math.floor((Date.now() - d.getTime()) / 1000));
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    if (m < 60) return m + 'm ' + (s % 60) + 's';
    return Math.floor(m / 60) + 'h ' + (m % 60) + 'm';
  };

  function setOperatorToken(t) {
    if (t) sessionStorage.setItem(OP_TOKEN_KEY, t);
    else sessionStorage.removeItem(OP_TOKEN_KEY);
  }

  function getOperatorToken() {
    return sessionStorage.getItem(OP_TOKEN_KEY);
  }

  function clearOperatorToken() {
    sessionStorage.removeItem(OP_TOKEN_KEY);
  }

  /** Match server /auth/login: NFKC + strip bidi/invisible + digits only (tel/password autofill on iOS). */
  function normalizeOperatorPinInput(raw) {
    if (raw == null) return '';
    let s = String(raw).trim();
    s = s.replace(/[\u200B-\u200D\uFEFF\u202A-\u202E\u2066-\u2069\u200E\u200F]/g, '');
    try {
      s = s.normalize('NFKC');
    } catch (_) {
      /* ignore */
    }
    return s.replace(/\D/g, '');
  }

  /** Guest ordering + socket: send X-Table-Token on each API request */
  function setTableGuestAuth(tableId, token) {
    tableGuestAuth =
      tableId != null && token ? { tableId: Number(tableId), token: String(token) } : null;
  }

  async function api(path, opts = {}) {
    const skipGuestHeader = !!opts.skipGuestHeader;
    const skipBearer =
      path.startsWith('/auth/') || path.startsWith('/stewards/login');
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    const bearer = !skipBearer && (opts.operatorToken ?? getOperatorToken());
    if (bearer) headers.Authorization = 'Bearer ' + bearer;
    if (!skipGuestHeader && tableGuestAuth && path.indexOf('/auth/') !== 0) {
      headers['X-Table-Token'] = tableGuestAuth.token;
    }
    const { headers: _h, body: reqBody, operatorToken: _o, skipGuestHeader: _s, ...fetchRest } = opts;
    const r = await fetch('/api' + path, {
      method: 'GET',
      ...fetchRest,
      headers,
      body: reqBody !== undefined ? JSON.stringify(reqBody) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
    return data;
  }

  function toast(msg) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._h);
    el._h = setTimeout(() => el.classList.remove('show'), 2200);
  }

  /**
   * @param {string[]} rooms
   * @param {{ auth?: object, operatorToken?: string, guestTableId?: number, guestToken?: string }} [socketOpts]
   */
  function connectSocket(rooms = [], socketOpts = {}) {
    const auth = { ...(socketOpts.auth || {}) };
    const ot = socketOpts.operatorToken ?? getOperatorToken();
    if (ot) auth.token = ot;
    if (socketOpts.guestTableId != null && socketOpts.guestToken) {
      auth.guestTable = socketOpts.guestTableId;
      auth.guestToken = socketOpts.guestToken;
    }
    const s = io({ transports: ['websocket', 'polling'], auth });
    s.on('connect', () => {
      for (const room of rooms) s.emit('join', room);
    });
    s.on('connect_error', (err) => {
      console.warn('[hprms] socket auth failed:', err && err.message);
    });
    return s;
  }

  return {
    fmtMoney,
    fmtTime,
    elapsed,
    api,
    toast,
    connectSocket,
    setOperatorToken,
    getOperatorToken,
    clearOperatorToken,
    setTableGuestAuth,
    normalizeOperatorPinInput,
  };
})();
