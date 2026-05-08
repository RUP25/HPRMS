'use strict';

const fs = require('fs');
const path = require('path');
const { getDb } = require('../db/init');

const MENU_PATH = path.join(__dirname, '..', 'data', 'menu.json');

function readCatalog() {
  const data = JSON.parse(fs.readFileSync(MENU_PATH, 'utf8'));
  return {
    categories: data.categories || [],
    outlets: data.outlets || {
      klong: { name: 'Klong Lounge Bar', station: 'BAR' },
      dopwai: { name: 'Dopwai Restaurant', station: 'KITCHEN' },
    },
  };
}

function rowToItem(r) {
  return {
    id: r.id,
    category: r.category,
    outlet: r.outlet,
    station: r.station,
    name: r.name,
    description: r.description,
    veg: r.veg === null ? null : !!r.veg,
    variants: JSON.parse(r.variants_json || '[]'),
    enabled: !!r.enabled,
  };
}

function listMenu({ outlet, query } = {}) {
  const db = getDb();
  const { categories, outlets } = readCatalog();
  let rows;
  if (outlet) {
    rows = db.prepare('SELECT * FROM menu_items WHERE outlet = ? ORDER BY category, name').all(outlet);
  } else {
    rows = db.prepare('SELECT * FROM menu_items ORDER BY outlet, category, name').all();
  }
  let items = rows.map(rowToItem);

  if (query) {
    const q = String(query).toLowerCase();
    items = items.filter((it) =>
      it.name.toLowerCase().includes(q) ||
      (it.description || '').toLowerCase().includes(q) ||
      it.id.toLowerCase().includes(q) ||
      it.category.toLowerCase().includes(q)
    );
  }

  const grouped = {};
  for (const c of categories) {
    if (outlet && c.outlet !== outlet) continue;
    grouped[c.id] = { ...c, items: [] };
  }
  for (const it of items) {
    if (!it.enabled && !query) continue; // hide disabled in customer view; admin search keeps them
    if (!grouped[it.category]) {
      grouped[it.category] = { id: it.category, outlet: it.outlet, name: it.category, items: [] };
    }
    grouped[it.category].items.push(it);
  }

  return {
    outlets,
    categories: Object.values(grouped).filter((c) => c.items.length > 0),
    items,
  };
}

function listForAdmin({ query, outlet } = {}) {
  const db = getDb();
  let rows;
  if (outlet) {
    rows = db.prepare('SELECT * FROM menu_items WHERE outlet = ? ORDER BY outlet, category, name').all(outlet);
  } else {
    rows = db.prepare('SELECT * FROM menu_items ORDER BY outlet, category, name').all();
  }
  let items = rows.map(rowToItem);
  if (query) {
    const q = String(query).toLowerCase();
    items = items.filter((it) =>
      it.name.toLowerCase().includes(q) ||
      (it.description || '').toLowerCase().includes(q) ||
      it.id.toLowerCase().includes(q) ||
      it.category.toLowerCase().includes(q)
    );
  }
  return items;
}

function listCategories() {
  const { categories, outlets } = readCatalog();
  return { categories, outlets };
}

function getItem(id) {
  const db = getDb();
  const r = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id);
  if (!r) return null;
  return rowToItem(r);
}

function setEnabled(id, enabled) {
  const db = getDb();
  return db.prepare('UPDATE menu_items SET enabled = ?, updated_at = datetime("now") WHERE id = ?')
    .run(enabled ? 1 : 0, id);
}

function validateVariants(variants) {
  if (!Array.isArray(variants) || variants.length === 0) {
    throw Object.assign(new Error('At least one variant is required'), { status: 400 });
  }
  return variants.map((v) => {
    const label = String(v.label || '').trim();
    const price = Number(v.price);
    if (!label) throw Object.assign(new Error('Variant label required'), { status: 400 });
    if (!Number.isFinite(price) || price < 0) {
      throw Object.assign(new Error('Variant price must be a non-negative number'), { status: 400 });
    }
    return { label, price: +price.toFixed(2) };
  });
}

function categoryToOutletStation(catId) {
  const { categories, outlets } = readCatalog();
  const cat = categories.find((c) => c.id === catId);
  if (!cat) throw Object.assign(new Error(`Unknown category ${catId}`), { status: 400 });
  const outlet = outlets[cat.outlet] || { station: 'KITCHEN' };
  return { outlet: cat.outlet, station: outlet.station };
}

function nextItemId(category) {
  const db = getDb();
  const prefix = (category.startsWith('K-') || category.startsWith('D-'))
    ? category
    : (category[0] || 'X').toUpperCase() + '-' + category.toUpperCase().slice(0, 4);
  const last = db.prepare(
    `SELECT id FROM menu_items WHERE id LIKE ? ORDER BY id DESC LIMIT 1`
  ).get(prefix + '-%');
  let seq = 1;
  if (last) {
    const m = last.id.match(/-(\d+)$/);
    if (m) seq = parseInt(m[1], 10) + 1;
  }
  return `${prefix}-${String(seq).padStart(3, '0')}`;
}

function createItem({ id, category, name, description, veg, variants }) {
  if (!category) throw Object.assign(new Error('category required'), { status: 400 });
  if (!name) throw Object.assign(new Error('name required'), { status: 400 });
  const { outlet, station } = categoryToOutletStation(category);
  const variantsClean = validateVariants(variants);
  const itemId = id || nextItemId(category);
  const db = getDb();
  const exists = db.prepare('SELECT 1 FROM menu_items WHERE id = ?').get(itemId);
  if (exists) throw Object.assign(new Error(`Item id already exists: ${itemId}`), { status: 409 });
  db.prepare(`
    INSERT INTO menu_items (id, category, outlet, station, name, description, veg, variants_json, enabled, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))
  `).run(
    itemId, category, outlet, station, String(name).trim(),
    description ? String(description).trim() : null,
    typeof veg === 'boolean' ? (veg ? 1 : 0) : null,
    JSON.stringify(variantsClean)
  );
  return getItem(itemId);
}

function updateItem(id, patch) {
  const db = getDb();
  const cur = getItem(id);
  if (!cur) throw Object.assign(new Error('Item not found'), { status: 404 });

  const next = { ...cur };
  if (patch.name != null) next.name = String(patch.name).trim();
  if (patch.description != null) next.description = String(patch.description).trim() || null;
  if (patch.veg != null) next.veg = patch.veg === true || patch.veg === 'true' ? true
                          : patch.veg === false || patch.veg === 'false' ? false : null;
  if (patch.category != null) {
    const { outlet, station } = categoryToOutletStation(patch.category);
    next.category = patch.category;
    next.outlet = outlet;
    next.station = station;
  }
  if (patch.variants != null) next.variants = validateVariants(patch.variants);
  if (patch.enabled != null) next.enabled = !!patch.enabled;

  db.prepare(`
    UPDATE menu_items SET
      category = ?, outlet = ?, station = ?, name = ?, description = ?,
      veg = ?, variants_json = ?, enabled = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    next.category, next.outlet, next.station, next.name,
    next.description, next.veg === null ? null : (next.veg ? 1 : 0),
    JSON.stringify(next.variants), next.enabled ? 1 : 0, id
  );
  return getItem(id);
}

function deleteItem(id) {
  const db = getDb();
  const used = db.prepare('SELECT COUNT(*) AS c FROM order_items WHERE menu_item_id = ?').get(id).c;
  if (used > 0) {
    // Soft delete by disabling so historical bills/orders keep working.
    return updateItem(id, { enabled: false });
  }
  db.prepare('DELETE FROM menu_items WHERE id = ?').run(id);
  return { ok: true, deleted: true };
}

module.exports = {
  listMenu,
  listForAdmin,
  listCategories,
  getItem,
  setEnabled,
  createItem,
  updateItem,
  deleteItem,
};
