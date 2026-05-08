'use strict';

/**
 * IDS Billing Adapter (Hotel Poinisuk)
 * --------------------------------------------------------------------
 * IDS Next FX / SmartHotel typically exposes REST endpoints to post
 * F&B settlements (KOTs / checks) into the central PMS so cashiers
 * don't re-enter them. The exact endpoint, auth and body shape vary by
 * deployment - this module isolates that contract behind one function:
 *
 *     postBill(payload) -> { ok, reference }
 *
 * To wire in your live IDS:
 *   1. Set IDS_ENABLED=true in .env
 *   2. Set IDS_BASE_URL, IDS_API_KEY (or IDS_USERNAME/IDS_PASSWORD),
 *      IDS_HOTEL_CODE, IDS_OUTLET_KLONG, IDS_OUTLET_DOPWAI
 *   3. Adjust `buildPayload` to match the field names IDS expects.
 *      The HPRMS billing layer enforces idempotency: once a bill has
 *      ids_status='posted' it will never be posted again.
 */

const axios = require('axios');

const enabled = () => /^true$/i.test(process.env.IDS_ENABLED || '');
const baseUrl = () => process.env.IDS_BASE_URL || '';
const apiKey = () => process.env.IDS_API_KEY || '';
const hotelCode = () => process.env.IDS_HOTEL_CODE || 'POINISUK';
const outletCode = (outletKey) =>
  outletKey === 'klong'
    ? (process.env.IDS_OUTLET_KLONG || 'KLONG')
    : (process.env.IDS_OUTLET_DOPWAI || 'DOPWAI');

function buildPayload(bill) {
  const lines = [];
  for (const o of bill.orders || []) {
    if (o.status === 'cancelled') continue;
    for (const it of o.items) {
      lines.push({
        kot_no: o.kot_no,
        outlet_code: outletCode(o.station === 'BAR' ? 'klong' : 'dopwai'),
        item_code: it.menu_item_id,
        item_name: it.name,
        variant: it.variant_label,
        qty: it.qty,
        rate: it.unit_price,
        amount: it.line_total,
      });
    }
  }

  return {
    hotel_code: hotelCode(),
    bill_no: bill.bill_no,
    table_id: bill.table_id,
    session_id: bill.session_id,
    subtotal: bill.subtotal,
    service_charge: bill.service_charge,
    gst: bill.gst,
    grand_total: bill.grand_total,
    tip_steward: +(Number(bill.tip_steward || 0).toFixed(2)),
    tip_chef: +(Number(bill.tip_chef || 0).toFixed(2)),
    tip_bartender: +(Number(bill.tip_bartender || 0).toFixed(2)),
    posted_at: new Date().toISOString(),
    source: 'HPRMS',
    lines,
  };
}

async function postBill(payload) {
  if (!enabled()) {
    return {
      ok: true,
      mock: true,
      reference: `MOCK-${payload.bill_no}`,
      note: 'IDS_ENABLED=false; not actually posted to IDS.',
    };
  }
  const url = `${baseUrl().replace(/\/$/, '')}/fnb/checks`;
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey()) headers['Authorization'] = `Bearer ${apiKey()}`;

  let auth;
  if (process.env.IDS_USERNAME && process.env.IDS_PASSWORD) {
    auth = { username: process.env.IDS_USERNAME, password: process.env.IDS_PASSWORD };
  }

  const r = await axios.post(url, payload, { headers, auth, timeout: 15000 });
  return {
    ok: true,
    mock: false,
    reference: r.data?.reference || r.data?.id || r.data?.check_no || null,
    raw: r.data,
  };
}

module.exports = { buildPayload, postBill, enabled };
