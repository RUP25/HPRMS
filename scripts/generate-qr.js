'use strict';

const path = require('path');

require('dotenv').config({
  path: path.join(__dirname, '..', '.env'),
  override: true,
});

const fs = require('fs');
const QRCode = require('qrcode');
const { init: initDb, getDb } = require('../db/init');

const BASE =
  String(process.env.PUBLIC_BASE_URL || '')
    .trim()
    .replace(/\/$/, '') ||
  String(process.env.RENDER_EXTERNAL_URL || '')
    .trim()
    .replace(/\/$/, '') ||
  `http://localhost:${process.env.PORT || 3000}`;
const OUT = path.join(__dirname, '..', 'qr-codes');
const COUNT = parseInt(process.env.TABLE_COUNT || '20', 10);
const KLONG_TABLES = parseInt(process.env.KLONG_TABLES || '8', 10);

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

async function main() {
  initDb();
  const db = getDb();

  const indexLines = [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    '<title>Hotel Poinisuk - Table QR Codes</title>',
    '<style>',
    'body{font-family:Georgia,serif;background:#fff;color:#1a1a1a;margin:0;padding:24px}',
    '.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:24px}',
    '.card{border:2px solid #4a1d72;border-radius:14px;padding:18px;text-align:center;background:#fff;page-break-inside:avoid}',
    '.h{font-size:13px;letter-spacing:3px;color:#4a1d72;text-transform:uppercase;margin-bottom:6px}',
    '.t{font-size:36px;font-weight:700;letter-spacing:2px;margin:4px 0}',
    '.s{font-size:11px;color:#555;margin-top:8px}',
    '.out{font-size:12px;color:#7a3aa8;text-transform:uppercase;letter-spacing:2px;margin-bottom:12px}',
    'img{width:220px;height:220px}',
    'h1{font-family:Georgia,serif;color:#4a1d72;margin:0 0 6px}',
    '.lede{color:#555;margin-bottom:24px}',
    '@media print {.no-print{display:none}}',
    '</style></head><body>',
    '<h1>Hotel Poinisuk - Scan to Order</h1>',
    `<p class="lede">Print this page (one card per table). Each QR opens the guest menu for that table with an embedded security token.<br>Base URL: <code>${BASE}</code></p>`,
    '<div class="grid">',
  ];

  for (let i = 1; i <= COUNT; i++) {
    const row = db.prepare('SELECT guest_token FROM tables WHERE id = ?').get(i);
    const tok = row && row.guest_token ? String(row.guest_token) : '';
    if (!tok) console.warn(`[qr] Table ${i}: missing guest_token — run npm run init-db`);
    const url = `${BASE}/t/${i}${tok ? '?t=' + encodeURIComponent(tok) : ''}`;
    const file = path.join(OUT, `table-${i}.png`);
    await QRCode.toFile(file, url, { width: 600, margin: 1, color: { dark: '#1a1a1a', light: '#ffffff' } });
    const dataUrl = await QRCode.toDataURL(url, { width: 600, margin: 1 });
    const outlet = i <= KLONG_TABLES ? 'Klong Lounge Bar' : 'Dopwai Restaurant';
    indexLines.push(`
      <div class="card">
        <div class="h">Hotel Poinisuk</div>
        <div class="out">${outlet}</div>
        <div class="t">TABLE ${i}</div>
        <img src="${dataUrl}" alt="QR Table ${i}">
        <div class="s">Scan to view menu &amp; order</div>
        <div class="s" style="opacity:.6">${url}</div>
      </div>
    `);
    console.log(`  -> ${file}  (${url})`);
  }
  indexLines.push('</div></body></html>');
  const html = path.join(OUT, 'print-sheet.html');
  fs.writeFileSync(html, indexLines.join('\n'));
  console.log(`\nPrint sheet: ${html}`);
  console.log(`Open it in a browser and use Ctrl/Cmd-P to print.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
