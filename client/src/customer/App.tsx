import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from 'framer-motion';
import { CartProvider, useCart } from './cartContext';
import { categoryImageUrl } from './categoryArt';
import type {
  Category,
  ConfigPayload,
  MenuItem,
  MenuPayload,
  TablePayload,
  Variant,
} from './types';
import './customer-app.css';

const TAGLINES: Record<string, string> = {
  dopwai: 'Wrapped in heritage. Served on Ka Dopwai.',
  klong: 'Restored by tradition. The spirit of Um Klong.',
};

const LOGOS: Record<string, string | null> = {
  dopwai: '/assets/dopwai-light.svg',
  klong: null,
};

const THEME_COLOR: Record<string, string> = {
  dopwai: '#0e2a1e',
  klong: '#0d0614',
};

function parseTableId(): number | null {
  const parts = window.location.pathname.split('/').filter(Boolean);
  const idx = parts.indexOf('t');
  const raw = idx >= 0 ? parts[idx + 1] : parts[parts.length - 1];
  const n = parseInt(raw || '', 10);
  return n > 0 && !Number.isNaN(n) ? n : null;
}

function parseGuestToken(): string {
  const raw = new URLSearchParams(window.location.search).get('t');
  return (raw || '').trim();
}

function guestPrefsStorageKey(tableId: number) {
  return `hprms.guestprefs.${tableId}`;
}

function readGuestPrefsForOrder(tableId: number): {
  guest_name?: string;
  guest_phone?: string;
} {
  try {
    const raw = sessionStorage.getItem(guestPrefsStorageKey(tableId));
    if (!raw) return {};
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (!o || typeof o !== 'object') return {};
    const out: { guest_name?: string; guest_phone?: string } = {};
    if (typeof o.guest_name === 'string' && o.guest_name.trim()) {
      out.guest_name = o.guest_name.trim().slice(0, 120);
    }
    if (typeof o.guest_phone === 'string' && o.guest_phone.trim()) {
      out.guest_phone = o.guest_phone.replace(/[^\d+]/g, '').slice(0, 24);
    }
    return out;
  } catch {
    return {};
  }
}

function GuestDetailsGate({
  tableId,
  tableLabel,
  onDone,
}: {
  tableId: number;
  tableLabel: string;
  onDone: () => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');

  const finish = (prefs: Record<string, string>) => {
    if (Object.keys(prefs).length === 0) {
      sessionStorage.removeItem(guestPrefsStorageKey(tableId));
    } else {
      sessionStorage.setItem(guestPrefsStorageKey(tableId), JSON.stringify(prefs));
    }
    onDone();
  };

  return (
    <div className="guest-gate">
      <div className="guest-gate__card">
        <p className="guest-gate__eyebrow">Hotel Poinisuk</p>
        <h2 className="guest-gate__title">You&apos;re seated at</h2>
        <p className="guest-gate__table">{tableLabel}</p>
        <p className="guest-gate__hint">
          Optionally add your name and mobile — helpful if we need to reach you about
          your order. You can skip and order right away.
        </p>
        <label className="guest-gate__lab">
          Name <span className="guest-gate__opt">(optional)</span>
          <input
            type="text"
            name="guest_name"
            autoComplete="name"
            maxLength={120}
            placeholder="e.g. Priya Sharma"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="guest-gate__lab">
          Mobile <span className="guest-gate__opt">(optional)</span>
          <input
            type="tel"
            name="guest_phone"
            autoComplete="tel"
            inputMode="tel"
            maxLength={24}
            placeholder="e.g. +91 98765 43210"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
        </label>
        <div className="guest-gate__actions">
          <button type="button" className="guest-gate__skip" onClick={() => finish({})}>
            Skip — go to menu
          </button>
          <button
            type="button"
            className="guest-gate__primary"
            onClick={() => {
              const prefs: Record<string, string> = {};
              const nt = name.trim().slice(0, 120);
              const pt = phone.replace(/[^\d+]/g, '').slice(0, 24);
              if (nt) prefs.guest_name = nt;
              if (pt) prefs.guest_phone = pt;
              finish(prefs);
            }}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

function needsVariantLabel(v: string) {
  return !['plate', 'bowl', 'glass', 'cup', 'piece', 'shot', 'house'].includes(v);
}

function filterCategoryItems(cat: Category, q: string): MenuItem[] {
  if (!q) return cat.items;
  const s = q.toLowerCase();
  return cat.items.filter(
    (it) =>
      it.name.toLowerCase().includes(s) ||
      (it.description || '').toLowerCase().includes(s) ||
      it.variants.some((v) => (v.label || '').toLowerCase().includes(s)),
  );
}

function computeTotals(
  cart: { qty: number; unit_price: number }[],
  cfg: ConfigPayload | null,
) {
  const sub = cart.reduce((acc, c) => acc + c.qty * c.unit_price, 0);
  const svcPct = cfg?.service_charge_percent ?? 0;
  const gstPct = cfg?.gst_percent ?? 5;
  const svc = +(sub * (svcPct / 100)).toFixed(2);
  const gst = +((sub + svc) * (gstPct / 100)).toFixed(2);
  return {
    subtotal: +sub.toFixed(2),
    svc,
    gst,
    grand: +(sub + svc + gst).toFixed(2),
  };
}

function BookOpening({ onDone }: { onDone: () => void }) {
  const reduce = useReducedMotion();

  useEffect(() => {
    if (reduce) {
      onDone();
      return;
    }
    const t = window.setTimeout(onDone, 1700);
    return () => window.clearTimeout(t);
  }, [reduce, onDone]);

  if (reduce) return null;

  return (
    <motion.div
      className="book-intro"
      role="presentation"
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.45 }}
    >
      <div className="book-intro__texture" />
      <div className="book-intro__stage">
        <div className="book-intro__glow" />
        <div className="book-intro__spread">
          <motion.div
            className="book-intro__half book-intro__half--left"
            initial={{ rotateY: -78 }}
            animate={{ rotateY: 0 }}
            transition={{ duration: 1.05, ease: [0.16, 1, 0.3, 1] }}
            style={{ transformStyle: 'preserve-3d' } as CSSProperties}
          />
          <motion.div
            className="book-intro__half book-intro__half--right"
            initial={{ rotateY: 78 }}
            animate={{ rotateY: 0 }}
            transition={{ duration: 1.05, ease: [0.16, 1, 0.3, 1] }}
            style={{ transformStyle: 'preserve-3d' } as CSSProperties}
          />
        </div>
      </div>
      <p className="book-intro__title">Hotel Poinisuk</p>
      <p className="book-intro__subtitle">Your table menu</p>
    </motion.div>
  );
}

function InvalidTable() {
  return (
    <div
      style={{
        padding: '60px 24px',
        textAlign: 'center',
        fontFamily: 'Georgia, serif',
        color: '#7a1e1e',
      }}
    >
      <h2>Invalid table</h2>
      <p>Please re-scan the QR code on your table.</p>
    </div>
  );
}

function IncompleteQrLink() {
  return (
    <div
      style={{
        padding: '60px 24px',
        textAlign: 'center',
        fontFamily: 'Georgia, serif',
        color: '#7a1e1e',
      }}
    >
      <h2>QR link incomplete</h2>
      <p>
        This menu link is missing the guest token (
        <code style={{ fontSize: 13 }}>?t=…</code>). Scan the QR printed for
        your table after running <code style={{ fontSize: 13 }}>npm run qr</code>{' '}
        on the server.
      </p>
    </div>
  );
}

function GuestBillingTips({
  tableId,
  awaitingBill,
  totals,
  bill,
  gstPct,
  svcPct,
  fmtMoney,
  onSaved,
}: {
  tableId: number;
  awaitingBill: boolean;
  totals: {
    subtotal: number;
    service_charge: number;
    gst: number;
    grand_total: number;
  } | null;
  bill: {
    pay_status?: string;
    tip_steward?: number;
    tip_chef?: number;
    tip_bartender?: number;
  } | null;
  gstPct: number;
  svcPct: number;
  fmtMoney: (n: number) => string;
  onSaved: () => void;
}) {
  const api = window.HPRMS.api;
  const [steward, setSteward] = useState('');
  const [bartender, setBartender] = useState('');
  const [chef, setChef] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const ts = bill?.tip_steward ?? 0;
    const tb = bill?.tip_bartender ?? 0;
    const tc = bill?.tip_chef ?? 0;
    setSteward(ts > 0 ? String(ts) : '');
    setBartender(tb > 0 ? String(tb) : '');
    setChef(tc > 0 ? String(tc) : '');
  }, [bill?.tip_steward, bill?.tip_bartender, bill?.tip_chef]);

  const parseAmt = (s: string) => {
    const n = parseFloat(String(s).replace(/,/g, '').trim());
    return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
  };

  if (!awaitingBill || !totals) return null;
  if (bill?.pay_status === 'paid') return null;

  const tipStewSaved = +(Number(bill?.tip_steward ?? 0).toFixed(2));
  const tipBarSaved = +(Number(bill?.tip_bartender ?? 0).toFixed(2));
  const tipChefSaved = +(Number(bill?.tip_chef ?? 0).toFixed(2));
  const dirty =
    parseAmt(steward) !== tipStewSaved ||
    parseAmt(bartender) !== tipBarSaved ||
    parseAmt(chef) !== tipChefSaved;

  const save = async () => {
    setSaving(true);
    try {
      await api(`/sessions/by-table/${tableId}/tips`, {
        method: 'PATCH',
        body: {
          tip_steward: parseAmt(steward),
          tip_bartender: parseAmt(bartender),
          tip_chef: parseAmt(chef),
        },
      });
      window.HPRMS.toast('Tips saved for your bill');
      onSaved();
    } catch (e) {
      window.HPRMS.toast(
        e instanceof Error ? e.message : 'Could not save tips',
      );
    } finally {
      setSaving(false);
    }
  };

  const tipSum =
    (bill?.tip_steward != null ? +Number(bill.tip_steward) : 0) +
    (bill?.tip_bartender != null ? +Number(bill.tip_bartender) : 0) +
    (bill?.tip_chef != null ? +Number(bill.tip_chef) : 0);

  return (
    <section className="guest-tips-section card">
      <h3>Your bill</h3>
      <p className="muted guest-tips-lead">
        All orders are served. Here is your check. Optional tips thank your steward,
        bartender (Klong / bar), and kitchen team — they appear on the cashier&apos;s
        screen when you pay.
      </p>

      <div className="guest-tips-totals">
        <div className="guest-tips-row">
          <span>Subtotal</span>
          <span>{fmtMoney(totals.subtotal)}</span>
        </div>
        {totals.service_charge > 0 ? (
          <div className="guest-tips-row">
            <span>Service charge ({svcPct}%)</span>
            <span>{fmtMoney(totals.service_charge)}</span>
          </div>
        ) : null}
        <div className="guest-tips-row">
          <span>GST ({gstPct}%)</span>
          <span>{fmtMoney(totals.gst)}</span>
        </div>
        <div className="guest-tips-row guest-tips-row--grand">
          <span>Bill total</span>
          <span>{fmtMoney(totals.grand_total)}</span>
        </div>
      </div>

      <div className="guest-tips-fields">
        <label className="guest-tips-lab">
          Tip for steward (optional)
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={1}
            placeholder="0"
            value={steward}
            onChange={(e) => setSteward(e.target.value)}
          />
        </label>
        <label className="guest-tips-lab">
          Tip for bartender / bar (optional)
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={1}
            placeholder="0"
            value={bartender}
            onChange={(e) => setBartender(e.target.value)}
          />
        </label>
        <label className="guest-tips-lab">
          Tip for chef / kitchen (optional)
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={1}
            placeholder="0"
            value={chef}
            onChange={(e) => setChef(e.target.value)}
          />
        </label>
      </div>

      <button
        type="button"
        className="guest-tips-save"
        disabled={saving || !dirty}
        onClick={() => void save()}
      >
        {saving ? 'Saving…' : dirty ? 'Save tips' : 'Tips saved'}
      </button>

      {tipSum > 0 ? (
        <p className="guest-tips-note muted">
          Tips recorded: {fmtMoney(tipSum)} (paid separately to the cashier with your
          settlement).
        </p>
      ) : (
        <p className="guest-tips-note muted">
          You can skip tips — settle only the bill total at the desk.
        </p>
      )}
    </section>
  );
}

function MenuInner({
  cfg,
  table,
  menu,
  guestToken,
}: {
  cfg: ConfigPayload;
  table: TablePayload;
  menu: MenuPayload;
  guestToken: string;
}) {
  const { cart, addToCart, qtyInCart, clearCart } = useCart();
  const fmtMoney = window.HPRMS.fmtMoney;
  const api = window.HPRMS.api;

  const [outlet, setOutlet] = useState<'dopwai' | 'klong'>(
    (table.outlet as 'dopwai' | 'klong') || 'dopwai',
  );
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeNavCatId, setActiveNavCatId] = useState<string | null>(null);
  const [variantItem, setVariantItem] = useState<MenuItem | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [scrollTopVisible, setScrollTopVisible] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [note, setNote] = useState('');
  const [sessionOrders, setSessionOrders] = useState<unknown>(null);
  const [bigAlert, setBigAlert] = useState<{
    title: string;
    kot: string;
    body: string;
  } | null>(null);

  const searchTrim = search.trim().toLowerCase();

  const categories = useMemo(() => {
    let cats = menu.categories.filter((c) => c.outlet === outlet);
    if (searchTrim) {
      cats = cats
        .map((c) => ({
          ...c,
          items: filterCategoryItems(c, searchTrim),
        }))
        .filter((c) => c.items.length > 0);
    }
    return cats;
  }, [menu.categories, outlet, searchTrim]);

  useEffect(() => {
    document.body.dataset.outlet = outlet;
    const tc = document.getElementById('themeColor');
    if (tc) tc.setAttribute('content', THEME_COLOR[outlet] || '#1a1024');
  }, [outlet]);

  useEffect(() => {
    document.body.classList.toggle('has-cart-fab', cart.length > 0);
    return () => document.body.classList.remove('has-cart-fab');
  }, [cart.length]);

  useEffect(() => {
    const onScroll = () => {
      setScrollTopVisible(window.scrollY > 260);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const refreshSession = useCallback(async () => {
    const tableId = table.id;
    try {
      const s = (await api(`/sessions/by-table/${tableId}`)) as Record<
        string,
        unknown
      > | null;
      setSessionOrders(s);
    } catch {
      setSessionOrders(null);
    }
  }, [api, table.id]);

  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  const navigateToCategory = useCallback((catId: string) => {
    setExpandedId(catId);
    setActiveNavCatId(catId);
    requestAnimationFrame(() => {
      document.getElementById(`menu-cat-${catId}`)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  }, []);

  useEffect(() => {
    setExpandedId(null);
  }, [outlet, searchTrim]);

  useEffect(() => {
    if (categories.length === 0) {
      setActiveNavCatId(null);
      return;
    }
    setActiveNavCatId((prev) =>
      prev && categories.some((c) => c.id === prev)
        ? prev
        : categories[0].id,
    );
  }, [categories]);

  useEffect(() => {
    if (categories.length === 0) return;
    const ids = new Set(categories.map((c) => c.id));
    const observer = new IntersectionObserver(
      (entries) => {
        const sorted = [...entries]
          .filter((e) => e.isIntersecting && e.intersectionRatio >= 0.08)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const top = sorted[0];
        if (!top?.target?.id?.startsWith('menu-cat-')) return;
        const id = top.target.id.slice('menu-cat-'.length);
        if (!ids.has(id)) return;
        setActiveNavCatId(id);
      },
      {
        root: null,
        rootMargin: '-88px 0px -52% 0px',
        threshold: [0, 0.06, 0.12, 0.22, 0.38],
      },
    );
    const t = window.requestAnimationFrame(() => {
      for (const c of categories) {
        const el = document.getElementById(`menu-cat-${c.id}`);
        if (el) observer.observe(el);
      }
    });
    return () => {
      window.cancelAnimationFrame(t);
      observer.disconnect();
    };
  }, [categories]);

  useEffect(() => {
    const tableId = table.id;
    if (typeof window.io !== 'function') return undefined;
    const sock = window.io({
      transports: ['websocket', 'polling'],
      auth: {
        guestTable: tableId,
        guestToken,
      },
    });
    sock.on('connect', () => {
      sock.emit('join', [`table:${tableId}`]);
    });
    sock.on('order:update', refreshSession);
    sock.on(
      'order:cancelled',
      (o: { kot_no?: number; station?: string }) => {
        refreshSession();
        setBigAlert({
          title: 'Order Cancelled',
          kot:
            'KOT ' +
            o.kot_no +
            ' · ' +
            (o.station === 'BAR' ? 'Klong' : 'Dopwai'),
          body:
            'The ' +
            (o.station === 'BAR' ? 'bar' : 'kitchen') +
            ' was unable to prepare this order. Please ask a steward if you need help.',
        });
        window.HPRMSNotify?.chord('urgent');
        window.setTimeout(() => window.HPRMSNotify?.chord('urgent'), 700);
        if (navigator.vibrate) {
          try {
            navigator.vibrate([400, 120, 400, 120, 600]);
          } catch {
            /* ignore */
          }
        }
      },
    );
    sock.on('order:delivered', () => {
      refreshSession();
      window.HPRMS.toast(
        'Your order has reached your table. Enjoy!',
      );
    });
    sock.on('bill:update', refreshSession);
    return () => {
      try {
        sock.disconnect();
      } catch {
        /* ignore */
      }
    };
  }, [refreshSession, table.id, guestToken]);

  useEffect(() => {
    window.HPRMSNotify?.requestDesktop?.();
  }, []);

  const totals = computeTotals(cart, cfg);

  const sessionOrderList = useMemo(() => {
    if (!sessionOrders || typeof sessionOrders !== 'object') return [];
    const o = sessionOrders as { orders?: unknown[] };
    return Array.isArray(o.orders) ? o.orders : [];
  }, [sessionOrders]);

  const guestBillSnap = useMemo(() => {
    if (!sessionOrders || typeof sessionOrders !== 'object') return null;
    const s = sessionOrders as {
      awaiting_bill?: unknown;
      totals?: {
        subtotal: number;
        service_charge: number;
        gst: number;
        grand_total: number;
      };
      bill?: {
        pay_status?: string;
        tip_steward?: number;
        tip_bartender?: number;
        tip_chef?: number;
      } | null;
    };
    return {
      awaiting_bill: !!s.awaiting_bill,
      totals: s.totals ?? null,
      bill: s.bill ?? null,
    };
  }, [sessionOrders]);

  const openVariants = (it: MenuItem) => {
    if (!it.variants?.length) return;
    if (it.variants.length === 1) {
      addToCart(it, it.variants[0], 1);
      return;
    }
    setVariantItem(it);
  };

  const placeOrder = async () => {
    if (cart.length === 0) return;
    setPlacing(true);
    try {
      const prefs = readGuestPrefsForOrder(table.id);
      await api('/orders', {
        method: 'POST',
        body: {
          table_id: table.id,
          cart: cart.map((c) => ({
            menu_item_id: c.menu_item_id,
            variant_label: c.variant_label,
            qty: c.qty,
          })),
          note: note.trim() || undefined,
          ...(prefs.guest_name ? { guest_name: prefs.guest_name } : {}),
          ...(prefs.guest_phone ? { guest_phone: prefs.guest_phone } : {}),
        },
      });
      clearCart();
      setNote('');
      setCartOpen(false);
      refreshSession();
      window.HPRMS.toast('Order placed');
    } catch (e) {
      window.HPRMS.toast(
        'Could not place: ' + (e instanceof Error ? e.message : 'error'),
      );
    } finally {
      setPlacing(false);
    }
  };

  const isKlong = outlet === 'klong';
  const tagline = TAGLINES[outlet] || '';

  const toggleCat = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  return (
    <>
      <header className="hero">
        <div className="hero-overlay" />
        <div className="hero-top">
          <div className="hotel-mark">
            <img src="/assets/logo.png" alt="Hotel Poinisuk" />
            <div>
              <span className="ht-line">HOTEL</span>
              <span className="ht-name">POINISUK</span>
            </div>
          </div>
          <div className="table-badge">
            <span className="tb-line">YOUR TABLE</span>
            <span className="tb-id">{table.label}</span>
          </div>
        </div>
        <div className="hero-stage">
          <div
            className="hero-klong-type"
            hidden={!isKlong}
            aria-hidden={!isKlong}
          >
            <div
              className="hero-klong-frame"
              role="group"
              aria-label="Klong Lounge Bar"
            >
              <p className="hero-klong-main">KLONG</p>
              <p className="hero-klong-subline">LOUNGE BAR</p>
            </div>
          </div>
          <img
            className="hero-logo"
            src={LOGOS[outlet] || '/assets/logo.png'}
            alt={outlet === 'dopwai' ? 'Dopwai Restaurant' : 'Outlet'}
            hidden={isKlong}
            aria-hidden={isKlong}
          />
          <p className="hero-tag">{tagline}</p>
        </div>
        <p className="outlet-slider-hint" aria-hidden="true">
          Swipe to choose restaurant or bar
        </p>
        <div className="hero-foot" role="tablist" aria-label="Choose outlet">
          {(['dopwai', 'klong'] as const).map((o) => (
            <button
              key={o}
              type="button"
              role="tab"
              aria-selected={outlet === o}
              className={'oswitch' + (outlet === o ? ' active' : '')}
              data-outlet={o}
              onClick={() => {
                if (o === outlet) return;
                setOutlet(o);
                setExpandedId(null);
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
            >
              <span className="osw-name">{o === 'dopwai' ? 'Dopwai' : 'Klong'}</span>
              <span className="osw-sub">
                {o === 'dopwai' ? 'Restaurant' : 'Lounge Bar'}
              </span>
            </button>
          ))}
        </div>
      </header>

      <div className="search-wrap">
        <div className="search-pill" role="search">
          <label className="search-sr-label" htmlFor="menuSearch">
            Search menu
          </label>
          <span className="search-icon-wrap" aria-hidden="true">
            <svg
              className="search-svg"
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </span>
          <input
            id="menuSearch"
            type="search"
            placeholder="Search dishes, drinks, categories…"
            autoComplete="off"
            enterKeyHint="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {searchTrim ? (
            <button
              type="button"
              className="search-clear"
              aria-label="Clear search"
              onClick={() => setSearch('')}
            >
              &times;
            </button>
          ) : null}
        </div>
      </div>

      <div id="alertBanner" className="alert" hidden />

      <section
        className="story-panel"
        id="dopwaiStory"
        hidden={outlet !== 'dopwai'}
        aria-labelledby="storyTitle"
      >
        <figure className="story-image">
          <img
            src="/assets/dopwai-leaf.png"
            alt="A bowl of rice and curry served on a Ka Dopwai areca leaf"
          />
          <figcaption>
            Served on Ka Dopwai &middot; the leaf of the areca tree
          </figcaption>
        </figure>
        <div className="story-text">
          <span className="story-eyebrow">Our heritage</span>
          <h2 id="storyTitle" className="story-title">
            Ka Dopwai
          </h2>
          <p className="story-sub">The leaf that holds our story.</p>
          <p>
            &quot;Ka Dopwai&quot; is the leaf of the areca tree — useful and
            versatile, it cradles food without breaking even when the meal is
            hot.
          </p>
        </div>
      </section>

      <section
        className="story-panel story-klong"
        id="klongStory"
        hidden={outlet !== 'klong'}
        aria-labelledby="storyTitleKlong"
      >
        <div className="story-klong-lockup">
          <figure className="story-klong-sketch">
            <div className="story-klong-sketch-pad">
              <img
                src="/assets/klong-sketch.png?v=4"
                alt="Hand-drawn Klong sign"
                decoding="async"
              />
            </div>
            <figcaption className="story-klong-gourd-quote">
              The gourd in our name
            </figcaption>
          </figure>
        </div>
        <div className="story-text">
          <span className="story-eyebrow">The name</span>
          <h2 id="storyTitleKlong" className="story-title">
            Um Klong
          </h2>
          <p className="story-sub">Nature&apos;s cup, raised in good company.</p>
          <p>
            <em>Um klong</em> refers to a drink from the bottle gourd — valued
            for wellbeing and recovery after you&apos;ve given your all.
          </p>
        </div>
      </section>

      <main className="content">
        <div className="menu-book">
          <div className="menu-book__pattern" />
          <div className="menu-book__inner">
            {categories.length > 0 ? (
              <CategoryNavStrip
                categories={categories}
                activeId={activeNavCatId}
                onSelect={navigateToCategory}
              />
            ) : null}
            <p className="menu-book__hint">Tap a chapter to open dishes</p>

            {searchTrim && categories.length === 0 ? (
              <p className="search-empty-book">No items match your search.</p>
            ) : null}

            {!searchTrim && categories.length === 0 ? (
              <p className="search-empty-book">
                No items in this outlet right now.
              </p>
            ) : null}

            {categories.map((cat, index) => (
              <CategorySpread
                key={cat.id}
                cat={cat}
                index={index}
                expanded={expandedId === cat.id}
                onToggle={() => toggleCat(cat.id)}
                fmtMoney={fmtMoney}
                qtyInCart={qtyInCart}
                addToCart={addToCart}
                onChoose={(it) => openVariants(it)}
              />
            ))}
          </div>
        </div>

        {sessionOrderList.length > 0 ? (
          <section className="status-section card">
            <h3>Your orders</h3>
            <ul className="orders">
              {sessionOrderList.map((o, i) => (
                <SessionOrderRow
                  key={String((o as { id?: unknown }).id ?? `ord-${i}`)}
                  order={o as Record<string, unknown>}
                />
              ))}
            </ul>
          </section>
        ) : null}

        {guestBillSnap ? (
          <GuestBillingTips
            tableId={table.id}
            awaitingBill={guestBillSnap.awaiting_bill}
            totals={guestBillSnap.totals}
            bill={guestBillSnap.bill}
            gstPct={cfg.gst_percent ?? 5}
            svcPct={cfg.service_charge_percent ?? 0}
            fmtMoney={fmtMoney}
            onSaved={refreshSession}
          />
        ) : null}
      </main>

      {cart.length > 0 ? (
        <button
          type="button"
          className="cart-fab"
          onClick={() => setCartOpen(true)}
        >
          <span className="cart-icon">&#128722;</span>
          <span className="cart-count">
            {cart.reduce((s, c) => s + c.qty, 0)}
          </span>
          <span className="cart-amt">{fmtMoney(totals.subtotal)}</span>
          <span className="cart-cta">View cart</span>
        </button>
      ) : null}

      {scrollTopVisible ? (
        <button
          type="button"
          className="scroll-top-btn"
          aria-label="Back to top"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
          >
            <path d="m18 15-6-6-6 6" />
          </svg>
        </button>
      ) : null}

      <div
        className="sheet"
        hidden={!cartOpen}
        aria-hidden={!cartOpen}
      >
        <button
          type="button"
          className="sheet-bg"
          aria-label="Close cart"
          onClick={() => setCartOpen(false)}
        />
        <div className="sheet-card" role="dialog" aria-modal="true">
          <div className="sheet-h">
            <h3>
              Your Order &middot; <span>{table.label}</span>
            </h3>
            <button
              type="button"
              className="x"
              aria-label="Close"
              onClick={() => setCartOpen(false)}
            >
              &times;
            </button>
          </div>
          {cart.length === 0 ? (
            <p className="empty-cart muted">Your cart is empty.</p>
          ) : (
            <ul className="cart-list">
              {cart.map((c, i) => (
                <li key={i}>
                  <div className="nm">
                    {c.name}
                    {needsVariantLabel(c.variant_label) ? (
                      <small>{c.variant_label}</small>
                    ) : null}
                  </div>
                  <div className="qty">
                    <button
                      type="button"
                      onClick={() =>
                        addToCart(
                          {
                            id: c.menu_item_id,
                            category: '',
                            outlet,
                            station: '',
                            name: c.name,
                            description: null,
                            veg: null,
                            variants: [
                              { label: c.variant_label, price: c.unit_price },
                            ],
                          },
                          { label: c.variant_label, price: c.unit_price },
                          -1,
                        )
                      }
                    >
                      −
                    </button>
                    <span>{c.qty}</span>
                    <button
                      type="button"
                      onClick={() =>
                        addToCart(
                          {
                            id: c.menu_item_id,
                            category: '',
                            outlet,
                            station: '',
                            name: c.name,
                            description: null,
                            veg: null,
                            variants: [
                              { label: c.variant_label, price: c.unit_price },
                            ],
                          },
                          { label: c.variant_label, price: c.unit_price },
                          1,
                        )
                      }
                    >
                      +
                    </button>
                  </div>
                  <div className="lt">{fmtMoney(c.qty * c.unit_price)}</div>
                </li>
              ))}
            </ul>
          )}
          <textarea
            className="note"
            placeholder="Note for kitchen / bar (optional)"
            maxLength={200}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <div className="totals">
            <div>
              <span>Subtotal</span>
              <b>{fmtMoney(totals.subtotal)}</b>
            </div>
            {cfg.service_charge_percent > 0 ? (
              <div className="muted">
                <span>Service ({cfg.service_charge_percent}%)</span>
                <b>{fmtMoney(totals.svc)}</b>
              </div>
            ) : null}
            <div className="muted">
              <span>
                GST <small>({cfg.gst_percent}%)</small>
              </span>
              <b>{fmtMoney(totals.gst)}</b>
            </div>
            <div className="grand">
              <span>Total</span>
              <b>{fmtMoney(totals.grand)}</b>
            </div>
          </div>
          <button
            type="button"
            className="btn place"
            disabled={cart.length === 0 || placing}
            onClick={() => void placeOrder()}
          >
            {placing ? 'Placing…' : 'Place Order'}
          </button>
          <p className="finefoot">
            Bill is settled at the front desk &middot; the steward will deliver
            to your table.
          </p>
        </div>
      </div>

      <div
        className="modal"
        hidden={!variantItem}
        aria-hidden={!variantItem}
      >
        <button
          type="button"
          className="modal-bg"
          aria-label="Close"
          onClick={() => setVariantItem(null)}
        />
        <div className="modal-card" role="dialog" aria-modal="true">
          <div className="modal-h">
            <h3>{variantItem?.name}</h3>
            <button
              type="button"
              className="x"
              aria-label="Close"
              onClick={() => setVariantItem(null)}
            >
              &times;
            </button>
          </div>
          {variantItem?.description ? (
            <p className="muted">{variantItem.description}</p>
          ) : null}
          <div className="variants">
            {(variantItem?.variants || []).map((v) => (
              <button
                key={v.label}
                type="button"
                onClick={() => {
                  addToCart(variantItem!, v, 1);
                  setVariantItem(null);
                }}
              >
                <span>{v.label}</span>
                <b>{fmtMoney(v.price)}</b>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bigalert" hidden={!bigAlert} aria-hidden={!bigAlert}>
        <div className="bigalert-card" role="alertdialog" aria-modal="true">
          <div className="bigalert-icon">&#9888;</div>
          <h2>{bigAlert?.title}</h2>
          <p className="kot-line">{bigAlert?.kot}</p>
          <p className="ba-body">{bigAlert?.body}</p>
          <button
            type="button"
            className="btn place"
            onClick={() => setBigAlert(null)}
          >
            I understand
          </button>
        </div>
      </div>
    </>
  );
}

function CategoryNavStrip({
  categories,
  activeId,
  onSelect,
}: {
  categories: Category[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!activeId || !scrollRef.current) return;
    const btn = Array.from(
      scrollRef.current.querySelectorAll<HTMLElement>('[data-cat]'),
    ).find((el) => el.dataset.cat === activeId);
    btn?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }, [activeId]);

  return (
    <nav className="menu-subnav" aria-label="Jump to menu category">
      <span className="menu-subnav__label">Sections</span>
      <div className="menu-subnav__scroll" ref={scrollRef}>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            data-cat={c.id}
            className={
              'menu-subnav__pill' +
              (activeId === c.id ? ' menu-subnav__pill--active' : '')
            }
            aria-current={activeId === c.id ? true : undefined}
            onClick={() => onSelect(c.id)}
          >
            {c.name}
          </button>
        ))}
      </div>
    </nav>
  );
}

function SessionOrderRow({ order }: { order: Record<string, unknown> }) {
  const fmtTime = window.HPRMS.fmtTime;
  const station = order.station === 'BAR' ? 'Klong' : 'Dopwai';
  const items = Array.isArray(order.items)
    ? (order.items as { qty: number; name: string; variant_label?: string }[])
    : [];
  const lines = items
    .map(
      (it) =>
        `${it.qty}× ${it.name}${
          it.variant_label && needsVariantLabel(it.variant_label)
            ? ` (${it.variant_label})`
            : ''
        }`,
    )
    .join(', ');
  const chip = (() => {
    const map: Record<string, [string, string]> = {
      placed: ['warn', 'Placed'],
      accepted: ['gold', 'Preparing'],
      ready: ['', 'Ready'],
      delivered: ['veg', 'Delivered'],
      cancelled: ['nv', 'Cancelled'],
    };
    const st = String(order.status || '');
    const [cls, label] = map[st] || ['muted', st];
    return <span className={'chip ' + cls}>{label}</span>;
  })();
  return (
    <li>
      <div className="head">
        <strong style={{ fontFamily: 'var(--serif)', fontSize: '16px' }}>
          {station}
        </strong>
        {chip}
      </div>
      <div className="muted" style={{ fontSize: '13px' }}>
        {lines}
      </div>
      <div className="kot">
        KOT {order.kot_no as number} · placed{' '}
        {fmtTime(String(order.created_at || ''))}
      </div>
    </li>
  );
}

function CategorySpread({
  cat,
  index,
  expanded,
  onToggle,
  fmtMoney,
  qtyInCart,
  addToCart,
  onChoose,
}: {
  cat: Category;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  fmtMoney: (n: number) => string;
  qtyInCart: (id: string, label: string) => number;
  addToCart: (it: MenuItem, v: Variant, delta: number) => void;
  onChoose: (it: MenuItem) => void;
}) {
  const flip = index % 2 === 1;
  const primarySrc = categoryImageUrl(cat.icon, cat.id);
  const picsumFallback = `https://picsum.photos/seed/${encodeURIComponent(cat.id)}/600/600`;
  const [heroSrc, setHeroSrc] = useState(primarySrc);
  useEffect(() => {
    setHeroSrc(primarySrc);
  }, [primarySrc]);
  const preview =
    cat.items[0]?.description?.slice(0, 120) ||
    `Explore ${cat.items.length} selection${cat.items.length === 1 ? '' : 's'} from ${cat.name}.`;

  return (
    <motion.article
      layout
      id={`menu-cat-${cat.id}`}
      className={'cat-spread' + (flip ? ' cat-spread--flip' : '')}
      initial={false}
    >
      <div className="cat-spread__copy">
        <p className="cat-spread__kicker">Chapter {index + 1}</p>
        <h2 className="cat-spread__title">
          <button
            type="button"
            onClick={onToggle}
            style={{
              all: 'unset',
              cursor: 'pointer',
              display: 'inline',
            }}
          >
            {cat.name}
          </button>
        </h2>
        <p className="cat-spread__sub">{preview}</p>
        <div className="cat-spread__rule" />
        <button
          type="button"
          className="cat-spread__cta"
          onClick={onToggle}
          style={{
            all: 'unset',
            cursor: 'pointer',
            display: 'inline',
          }}
        >
          {expanded ? 'Close chapter ↑' : 'Open dishes →'}
        </button>
      </div>
      <div className="cat-spread__hero">
        <button
          type="button"
          className="cat-spread__plate-btn"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${cat.name}`}
          onClick={onToggle}
        >
          <span className="cat-spread__ring" />
          <div className="cat-spread__plate">
            <img
              src={heroSrc}
              alt=""
              loading="lazy"
              decoding="async"
              onError={() => setHeroSrc(picsumFallback)}
            />
          </div>
        </button>
      </div>

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            key="items"
            className="cat-items-shell"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="cat-items">
              {cat.items.map((it) => (
                <BookItemRow
                  key={it.id}
                  item={it}
                  fmtMoney={fmtMoney}
                  qtyInCart={qtyInCart}
                  addToCart={addToCart}
                  onChoose={onChoose}
                />
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.article>
  );
}

function BookItemRow({
  item,
  fmtMoney,
  qtyInCart,
  addToCart,
  onChoose,
}: {
  item: MenuItem;
  fmtMoney: (n: number) => string;
  qtyInCart: (id: string, label: string) => number;
  addToCart: (it: MenuItem, v: Variant, delta: number) => void;
  onChoose: (it: MenuItem) => void;
}) {
  const variants = item.variants || [];
  const minP =
    variants.length > 0 ? Math.min(...variants.map((v) => v.price)) : 0;
  const priceLabel =
    variants.length > 1 ? `from ${fmtMoney(minP)}` : fmtMoney(minP);
  const veg = item.veg === true ? 'veg' : item.veg === false ? 'nv' : '';
  const single = variants.length === 1 ? variants[0] : null;
  const inCart = single
    ? qtyInCart(item.id, single.label)
    : variants.reduce((s, v) => s + qtyInCart(item.id, v.label), 0);

  return (
    <div className="book-item">
      {veg ? (
        <span className={'veg-mark' + (veg === 'nv' ? ' nv' : '')} />
      ) : (
        <span className="veg-spacer" />
      )}
      <div className="book-item__body">
        <h4 className="book-item__name">{item.name}</h4>
        {item.description ? (
          <p className="book-item__desc">{item.description}</p>
        ) : null}
        <div className="book-item__row">
          <span className="book-item__price">{priceLabel}</span>
          {single && inCart > 0 ? (
            <QtyMini
              item={item}
              variant={single}
              qty={inCart}
              addToCart={addToCart}
            />
          ) : (
            <button
              type="button"
              className="add"
              onClick={() => {
                if (variants.length === 1) addToCart(item, variants[0], 1);
                else onChoose(item);
              }}
            >
              {inCart > 0 ? `${inCart} · add more` : variants.length > 1 ? 'Choose' : 'Add +'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function QtyMini({
  item,
  variant,
  qty,
  addToCart,
}: {
  item: MenuItem;
  variant: Variant;
  qty: number;
  addToCart: (it: MenuItem, v: Variant, delta: number) => void;
}) {
  return (
    <div className="qty">
      <button type="button" onClick={() => addToCart(item, variant, -1)}>
        −
      </button>
      <span>{qty}</span>
      <button type="button" onClick={() => addToCart(item, variant, 1)}>
        +
      </button>
    </div>
  );
}

export function App() {
  const tableId = parseTableId();
  const guestToken = parseGuestToken();
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<'loading' | 'intro' | 'guest' | 'menu'>(
    'loading',
  );
  const [data, setData] = useState<{
    cfg: ConfigPayload;
    table: TablePayload;
    menu: MenuPayload;
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!tableId || !guestToken) return;
    window.HPRMS.setTableGuestAuth(tableId, guestToken);
    let cancelled = false;
    (async () => {
      try {
        const api = window.HPRMS.api;
        const [cfg, table, menu] = await Promise.all([
          api('/config') as Promise<ConfigPayload>,
          api('/tables/' + tableId) as Promise<TablePayload>,
          api('/menu') as Promise<MenuPayload>,
        ]);
        if (cancelled) return;
        setData({ cfg, table, menu });
        setPhase(reduceMotion ? 'guest' : 'intro');
      } catch (e) {
        if (!cancelled) {
          setErr(e instanceof Error ? e.message : 'Could not load menu');
          setPhase('menu');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tableId, guestToken, reduceMotion]);

  if (!tableId) return <InvalidTable />;
  if (!guestToken) return <IncompleteQrLink />;
  if (err && !data) {
    return (
      <p style={{ padding: 48, textAlign: 'center', color: '#b3261e' }}>
        Could not load menu: {err}
      </p>
    );
  }

  return (
    <CartProvider tableId={tableId}>
      <AnimatePresence>
        {phase === 'intro' && data ? (
          <BookOpening key="book-intro" onDone={() => setPhase('guest')} />
        ) : null}
      </AnimatePresence>
      {phase === 'guest' && data ? (
        <GuestDetailsGate
          tableId={tableId}
          tableLabel={data.table.label}
          onDone={() => setPhase('menu')}
        />
      ) : null}
      {phase === 'loading' ? (
        <div className="loading" style={{ padding: 80, textAlign: 'center' }}>
          <span className="spinner" />
          Loading menu…
        </div>
      ) : null}
      {phase === 'menu' && data ? (
        <MenuInner
          cfg={data.cfg}
          table={data.table}
          menu={data.menu}
          guestToken={guestToken}
        />
      ) : null}
    </CartProvider>
  );
}
