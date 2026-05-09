'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'hprms.sqlite');
const TABLE_COUNT = parseInt(process.env.TABLE_COUNT || '20', 10);
const STEWARD_COUNT = parseInt(process.env.STEWARD_COUNT || '10', 10);

function getDb() {
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tables (
      id INTEGER PRIMARY KEY,
      label TEXT NOT NULL,
      outlet TEXT NOT NULL DEFAULT 'dopwai',
      capacity INTEGER NOT NULL DEFAULT 4,
      status TEXT NOT NULL DEFAULT 'free',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      outlet TEXT NOT NULL,
      station TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      veg INTEGER,
      variants_json TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_id INTEGER NOT NULL REFERENCES tables(id),
      opened_at TEXT NOT NULL DEFAULT (datetime('now')),
      closed_at TEXT,
      bill_id INTEGER,
      status TEXT NOT NULL DEFAULT 'open',
      pax INTEGER,
      guest_name TEXT,
      room_no TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_open ON sessions(table_id, status);

    CREATE TABLE IF NOT EXISTS stewards (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      pin TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id),
      table_id INTEGER NOT NULL REFERENCES tables(id),
      kot_no TEXT NOT NULL UNIQUE,
      station TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'placed',
      note TEXT,
      steward_id INTEGER REFERENCES stewards(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      accepted_at TEXT,
      ready_at TEXT,
      delivered_at TEXT,
      cancelled_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(station, status);

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      menu_item_id TEXT NOT NULL REFERENCES menu_items(id),
      name TEXT NOT NULL,
      variant_label TEXT,
      qty INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      line_total REAL NOT NULL,
      note TEXT
    );

    CREATE TABLE IF NOT EXISTS bills (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES sessions(id) UNIQUE,
      bill_no TEXT NOT NULL UNIQUE,
      table_id INTEGER NOT NULL,
      subtotal REAL NOT NULL,
      gst REAL NOT NULL,
      service_charge REAL NOT NULL DEFAULT 0,
      grand_total REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      ids_status TEXT NOT NULL DEFAULT 'pending',
      ids_reference TEXT,
      ids_posted_at TEXT,
      ids_payload TEXT,
      ids_response TEXT,
      pay_status TEXT NOT NULL DEFAULT 'unpaid',
      pay_method TEXT,
      tip_steward REAL NOT NULL DEFAULT 0,
      tip_chef REAL NOT NULL DEFAULT 0,
      tip_bartender REAL NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_bills_ids ON bills(ids_status);

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      actor TEXT,
      action TEXT NOT NULL,
      ref_type TEXT,
      ref_id TEXT,
      detail TEXT
    );
  `);

  // Soft migrations for existing DBs created before steward_id existed.
  const ordCols = db.prepare('PRAGMA table_info(orders)').all().map(r => r.name);
  if (!ordCols.includes('steward_id')) {
    db.exec('ALTER TABLE orders ADD COLUMN steward_id INTEGER REFERENCES stewards(id)');
  }

  // Indexes that depend on (possibly newly-added) columns.
  db.exec('CREATE INDEX IF NOT EXISTS idx_orders_steward ON orders(steward_id, status)');

  const tblCols = db.prepare('PRAGMA table_info(tables)').all().map((r) => r.name);
  if (!tblCols.includes('guest_token')) {
    db.exec('ALTER TABLE tables ADD COLUMN guest_token TEXT');
  }
  const needGuestTok = db
    .prepare("SELECT id FROM tables WHERE guest_token IS NULL OR guest_token = ''")
    .all();
  const updTok = db.prepare('UPDATE tables SET guest_token = ? WHERE id = ?');
  for (const row of needGuestTok) {
    updTok.run(crypto.randomBytes(16).toString('hex'), row.id);
  }

  const sessCols = db.prepare('PRAGMA table_info(sessions)').all().map((r) => r.name);
  if (!sessCols.includes('guest_phone')) {
    db.exec('ALTER TABLE sessions ADD COLUMN guest_phone TEXT');
  }

  const billCols = db.prepare('PRAGMA table_info(bills)').all().map((r) => r.name);
  if (!billCols.includes('tip_steward')) {
    db.exec('ALTER TABLE bills ADD COLUMN tip_steward REAL NOT NULL DEFAULT 0');
  }
  if (!billCols.includes('tip_chef')) {
    db.exec('ALTER TABLE bills ADD COLUMN tip_chef REAL NOT NULL DEFAULT 0');
  }
  if (!billCols.includes('tip_bartender')) {
    db.exec('ALTER TABLE bills ADD COLUMN tip_bartender REAL NOT NULL DEFAULT 0');
  }
}

function seedTables(db) {
  const klongTables = Math.min(
    TABLE_COUNT,
    Math.max(1, parseInt(process.env.KLONG_TABLES || '8', 10)),
  );
  const insert = db.prepare(
    'INSERT OR IGNORE INTO tables (id, label, outlet, capacity, guest_token) VALUES (?, ?, ?, ?, ?)'
  );
  const tx = db.transaction(() => {
    for (let i = 1; i <= TABLE_COUNT; i++) {
      const outlet = i <= klongTables ? 'klong' : 'dopwai';
      insert.run(i, `Table ${i}`, outlet, 4, crypto.randomBytes(16).toString('hex'));
    }
  });
  tx();
}

function seedStewards(db) {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO stewards (id, name, pin, active) VALUES (?, ?, ?, 1)'
  );
  const names = [
    'Rohan',  'Aarav',  'Anish',  'Karan',  'Daniel',
    'Eli',    'Banti',  'Rishav', 'Shivam', 'Pranay',
  ];
  const tx = db.transaction(() => {
    for (let i = 1; i <= STEWARD_COUNT; i++) {
      const name = names[i - 1] || `Steward ${i}`;
      const pin = String(100 + i);
      insert.run(i, name, pin);
    }
  });
  tx();
}

function seedMenu(db) {
  const menuPath = path.join(__dirname, '..', 'data', 'menu.json');
  if (!fs.existsSync(menuPath)) return;
  const data = JSON.parse(fs.readFileSync(menuPath, 'utf8'));
  const outletStation = {};
  for (const o of Object.keys(data.outlets || {})) outletStation[o] = data.outlets[o].station;
  const catOutlet = {};
  for (const c of data.categories || []) catOutlet[c.id] = c.outlet;

  const upsert = db.prepare(`
    INSERT INTO menu_items (id, category, outlet, station, name, description, veg, variants_json, enabled, updated_at)
    VALUES (@id, @category, @outlet, @station, @name, @description, @veg, @variants_json, 1, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      category=excluded.category, outlet=excluded.outlet, station=excluded.station,
      name=excluded.name, description=excluded.description, veg=excluded.veg,
      variants_json=excluded.variants_json, updated_at=datetime('now')
  `);
  const tx = db.transaction(() => {
    for (const it of data.items || []) {
      const outlet = catOutlet[it.category] || 'dopwai';
      const station = outletStation[outlet] || 'KITCHEN';
      upsert.run({
        id: it.id,
        category: it.category,
        outlet,
        station,
        name: it.name,
        description: it.description || null,
        veg: typeof it.veg === 'boolean' ? (it.veg ? 1 : 0) : null,
        variants_json: JSON.stringify(it.variants || []),
      });
    }
  });
  tx();
}

function init() {
  const db = getDb();
  migrate(db);
  seedTables(db);
  seedStewards(db);
  seedMenu(db);
  return db;
}

if (require.main === module) {
  const db = init();
  const t = db.prepare('SELECT COUNT(*) AS c FROM tables').get().c;
  const s = db.prepare('SELECT COUNT(*) AS c FROM stewards').get().c;
  const m = db.prepare('SELECT COUNT(*) AS c FROM menu_items').get().c;
  console.log(`[hprms] DB ready at ${DB_PATH} - tables=${t}, stewards=${s}, menu_items=${m}`);
}

module.exports = { getDb, init, DB_PATH };
