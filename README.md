# Hotel Poinisuk - Restaurant Management System (HPRMS)

QR-based ordering for **Klong Lounge Bar** and **Dopwai Restaurant**, with kitchen / bar
displays, steward dispatch, and **idempotent** posting of finished bills into the
hotel's IDS billing software so the cashier never has to re-enter anything.

---

## Quick start (Windows / PowerShell)

```powershell
cd C:\Users\rupkh\Desktop\Project\HPRMS

# 1. install dependencies (one-time)
npm install

# 2. set up environment
copy .env.example .env       # then edit .env (especially PUBLIC_BASE_URL & IDS_*)

# 3. initialize SQLite + seed 10 tables + seed full Klong/Dopwai menu
npm run init-db

# 4. start the server
npm start
```

Open http://localhost:3000 in a browser. Operator pages (**Admin**, **Kitchen**, **Bar**, **Billing**, **Steward**) ask for a PIN on first load.

> Guest URLs must include the per-table token: `/t/5?t=…` from printed QRs (`npm run qr`) or from **Admin → QR Codes**. Plain `/t/5` will not load the menu.

> When deploying for real-world use, set `PUBLIC_BASE_URL` to a domain or LAN IP that
> phones can reach (e.g. `http://192.168.1.50:3000`) and re-generate the QR codes.

### Production checklist

1. Set **`NODE_ENV=production`** and **`AUTH_SECRET`** to a random string of **at least 24 characters** (the server will refuse to start otherwise).
2. Set **`PUBLIC_BASE_URL`** (and optionally **`CORS_ORIGINS`**) to your HTTPS origin(s) so browsers and Socket.IO only accept your domain(s).
3. Put **`TRUST_PROXY=1`** when running behind nginx / a load balancer so client IPs (and login rate limits) are correct.
4. Change default **`ADMIN_PIN`**, **`KITCHEN_PIN`**, **`BAR_PIN`**, **`BILLING_PIN`**, and steward PINs in the database — defaults are for demos only.
5. Run **`npm run build:customer`** before deploy so `/customer/customer-app.js` matches `client/src`.
6. Keep **`db/*.sqlite`** on persistent disk and back it up; run **`npm run init-db`** once per environment to migrate schema.

For local development, **`AUTH_SECRET`** can be shorter; production startup rules apply only when **`NODE_ENV=production`**.

---

## Surfaces

| URL              | Who uses it                                          |
| ---------------- | ---------------------------------------------------- |
| `/t/:tableId?t=<token>` | **Customer** - opened by scanning a table QR (token required) |
| `/kitchen`       | **Dopwai** kitchen display (KDS)                     |
| `/bar`           | **Klong** bar display                                |
| `/steward`       | **Steward** dispatch (ready -> delivered)            |
| `/admin`         | **Manager** dashboard - floor, bills, IDS, menu, QR  |
| `/`              | Landing page with quick links                        |

All operator screens use real-time WebSocket updates (Socket.IO).

---

## Generating the 10 table QR codes

```powershell
npm run qr
```

This writes PNGs and HTML using **`PUBLIC_BASE_URL`** and each table's **`guest_token`** from the database (added automatically by `npm run init-db`):

- `qr-codes/table-1.png` … `table-N.png` (high resolution, ready to print)
- `qr-codes/print-sheet.html` - one branded card per table; open and print

The first 4 tables are tagged to **Klong**, tables 5-10 to **Dopwai** (edit
`db/init.js` -> `seedTables` to change the split). The customer app shows both
menus regardless of where the QR was scanned, so guests at a bar table can still
order food and vice versa.

---

## How an order flows

1. **Guest scans QR** -> opens `/t/3?t=<guest_token>` -> sees full Klong + Dopwai menu.
2. **Guest taps Add** on items, then **Place Order**.
3. The server **splits** the cart by station:
   - Drinks/cocktails/wine/beer items go to **Klong (BAR)** - one KOT.
   - Food items go to **Dopwai (KITCHEN)** - one KOT.
4. KOTs appear instantly on `/bar` and `/kitchen`.
5. Bartender / chef taps **Accept** -> **Mark Ready**.
6. Steward sees the ready ticket on `/steward`, picks it up, taps **Mark Delivered**.
7. When the table asks for the check, the manager opens it on `/admin` -> **Bills**
   -> **Post to IDS** -> **Settle (Cash / Card / UPI / Charge to Room)**.

A single bill row holds **everything** consumed at the table during that session
across both outlets.

---

## IDS billing integration (no double work)

This is the part that prevents your cashier from re-typing every check.

`services/idsClient.js` is the single, isolated point of contact with IDS. The
billing layer (`services/billingService.js`) wraps every call with **idempotency
guarantees**:

- Each session/table can only have **one bill** (`bills.session_id` is `UNIQUE`).
- `bills.ids_status` is one of `pending | posted | failed`.
- `postToIds(billId)` will **refuse to re-post** any bill whose status is already
  `posted`, unless `force: true` is sent (audit-logged).
- Successful posts persist `ids_reference`, full `ids_payload`, and full
  `ids_response` for auditing.
- Settling a bill only marks the local payment status and frees the table; it does
  **not** trigger a second IDS post.

### Wiring to your live IDS server

1. Edit `.env`:
   ```env
   IDS_ENABLED=true
   IDS_BASE_URL=https://your-ids-server.example.com/api
   IDS_API_KEY=...
   IDS_HOTEL_CODE=POINISUK
   IDS_OUTLET_KLONG=KLONG
   IDS_OUTLET_DOPWAI=DOPWAI
   IDS_USERNAME=hprms-bot       # if your IDS uses basic auth instead of bearer
   IDS_PASSWORD=...
   ```

2. Open `services/idsClient.js` and adjust **two functions** to match your IDS
   tenant's contract:
   - `buildPayload(bill)` - rename the JSON keys / wrap them in the envelope
     your IDS expects (e.g. `CheckNumber`, `Outlet`, `LineItems`).
   - `postBill(payload)` - point at the correct endpoint path (e.g.
     `/v1/fnb/checks` vs `/api/poscheck/post`) and adjust auth headers.

3. Restart the server. The admin dashboard's IDS dot turns green and posts go to
   the real server.

If `IDS_ENABLED=false` (default) every "Post to IDS" returns a mock reference
(`MOCK-INV...`) so you can demo or pilot the system without an IDS instance.

---

## Tech

- **Node.js 18+ / 22**, **Express**, **Socket.IO**, **better-sqlite3**, **qrcode**
- Vanilla HTML/CSS/JS front-ends (no build step) - runs on any phone browser
- Single SQLite file at `db/hprms.sqlite` (WAL mode)

## File map

```
HPRMS/
  server.js              Express + Socket.IO bootstrap
  routes/api.js          REST API (menu, orders, bills, IDS, transitions)
  services/
    menuService.js       Reads menu catalog
    orderService.js      Place / route / transition orders, KOT numbering
    billingService.js    Bill creation, totals, settlement, idempotent IDS post
    idsClient.js         <-- IDS adapter; tweak buildPayload + postBill here
  db/init.js             SQLite schema + seed (10 tables, full menu)
  data/menu.json         The structured Klong + Dopwai menu (source of truth)
  scripts/generate-qr.js Generate 10 printable QR codes
  public/                All UIs (customer, kitchen, bar, steward, admin)
```

## Operating notes

- Default tax assumption: **GST 5%, Service 0%** (set via `.env`). Adjust to your
  actual rates - the customer screen shows the breakdown live.
- The customer's cart is saved in `localStorage` per table id, so an accidental
  refresh doesn't lose the order.
- All state-changing actions are written to `audit_log` with actor + detail.
- Menu items can be temporarily disabled in **Admin -> Menu** (e.g. when a dish
  is 86'd) - they immediately disappear from every guest's screen on next load.
- Late items added to a table just append to the same open session and the bill
  is recomputed on demand.

## Roadmap (deferred for v1)

- Hardware printer (KOT printer at Klong/Dopwai pass) via ESC/POS
- Room-charge guest lookup against PMS (currently records `room` as free text)
- Cashier PIN gate on `/admin/settle`
- Per-item modifiers (extra cheese, no onion) - foundation is already there in the
  `order_items.note` field
