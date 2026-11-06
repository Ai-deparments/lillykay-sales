import { config } from '../config.js';
import { one, all, run, tx, kvGet, kvSet } from '../db.js';
import { now, local } from '../util.js';
import { setIntegration } from './settings.js';
import { audit } from '../core/audit.js';
import { billz, billzAll, BillzError } from './billz-api.js';
import { normPhone } from './billz.js';
import { hasDemo, removeDemo } from './demo.js';

/*
  BILLZ → tizim sinxroni (faqat O‘QISH). Manba: docs.billz.io.
  - Magazinlar (/v1/shop) → filiallar (billz_shop_id bilan).
  - Tovarlar (/v2/products): har soat — o‘zgarganlari (last_updated_date, UTC), har kuni — to‘liq ro‘yxat.
    To‘liq ro‘yxatda yo‘q tovar o‘chirilmaydi — qoldig‘i 0 bo‘ladi (karta va tarix saqlanadi). Natija faqat hamma sahifa olingach qo‘llanadi.
  - Mijozlar (/v1/client) har kuni: ism, telefonlar, keshbek balansi. Kontakt ulashilganda — shu raqam bo‘yicha darhol so‘rov.
  - Xaridlar (/v1/customer-purchases-table): bugungisi har soat, kechagisi har kuni to‘liq (BILLZ tavsiyasi: qaytarish kechroq kiritilishi mumkin),
    birinchi ulanishda — 12 oy oyma-oy. Oyna almashtiriladi: shu kunlardagi BILLZ qatorlari o‘chirilib, qaytadan yoziladi.
  Vaqt: hisobotlar kompaniya vaqtida (Toshkent, UTC+5), last_updated_date — UTC.
*/

const HOUR = 3600e3, DAY = 864e5;
const tashkentDay = ts => local(ts).date;
const dayStart = date => Date.parse(`${date}T00:00:00+05:00`);
const utcStamp = ts => new Date(ts).toISOString().slice(0, 19).replace('T', ' ');
const mode = arr => { const m = new Map(); let best = null, n = 0; for (const x of arr) { const k = (m.get(x) || 0) + 1; m.set(x, k); if (k > n) { n = k; best = x; } } return best; };
const num = v => { const x = Number(v); return Number.isFinite(x) ? x : null; };

export const billzLive = () => Boolean(config.billzToken);

/* ---------- magazinlar → filiallar ---------- */
export async function syncShops() {
  const { items } = await billzAll('/v1/shop', { listKey: 'shops', limit: 100 });
  let added = 0;
  tx(() => {
    for (const s of items) {
      if (!s?.id || !String(s.name || '').trim()) continue;
      const name = String(s.name).trim().slice(0, 60);
      const byId = one('SELECT * FROM branches WHERE billz_shop_id=?', s.id);
      if (byId) {
        if (byId.name !== name && !one('SELECT 1 FROM branches WHERE name=? AND id<>?', name, byId.id)) run('UPDATE branches SET name=? WHERE id=?', name, byId.id);
        continue;
      }
      const byName = one('SELECT * FROM branches WHERE lower(name)=lower(?) AND billz_shop_id IS NULL', name);
      if (byName) { run('UPDATE branches SET billz_shop_id=? WHERE id=?', s.id, byName.id); continue; }
      const free = one('SELECT 1 FROM branches WHERE name=?', name) ? `${name} (BILLZ)` : name;
      run('INSERT INTO branches(name,billz_shop_id,note,kind) VALUES(?,?,?,?)', free, s.id, 'BILLZ magazinidan', looksWarehouse(name) ? 'ombor' : 'dokon');
      added++;
    }
  });
  return { shops: items.length, added };
}
/* Ombor nomdan aniqlanadi (SKLAD, склад, ombor, warehouse); keyin «Xodimlar va filiallar»da qo‘lda o‘zgartiriladi */
export const looksWarehouse = name => /sklad|склад|ombor|warehouse/i.test(String(name || ''));
const shopNames = () => Object.fromEntries(all('SELECT billz_shop_id, name FROM branches WHERE billz_shop_id IS NOT NULL').map(r => [r.billz_shop_id, r.name]));

/* ---------- tovarlar: narx va qoldiq magazinlar kesimida ---------- */
function upsertProduct(p, shops, t) {
  if (!p?.id || !String(p.name || '').trim()) return 0;
  const stock = {};
  for (const sm of p.shop_measurement_values || []) {
    const n = shops[sm.shop_id] || sm.shop_name || sm.shop_id;
    stock[n] = (stock[n] || 0) + (num(sm.active_measurement_value) || 0);
  }
  const prices = {};
  for (const sp of p.shop_prices || []) {
    const n = shops[sp.shop_id] || sp.shop_name || sp.shop_id, price = Math.round(num(sp.retail_price) || 0);
    // promo_price faqat promos to‘ldirilgan bo‘lsa amal qiladi (BILLZ hujjati)
    const promo = sp.promos?.length && num(sp.promo_price) > 0 ? Math.round(sp.promo_price) : null;
    prices[n] = { price, currency: sp.retail_currency || 'UZS', ...(promo ? { promo, promo_name: String(sp.promos[0]?.name || '').slice(0, 80) } : {}) };
  }
  // Narx — kompaniya hisob valyutasida (Sozlamalar). BILLZ’dagi valyuta belgisiga tayanilmaydi: Photobuy’da «UZS» belgili narxlar ham
  // aslida USD (2026-09-20 tekshiruvi: chek summasi / narx = 1,000). Magazinlarda farq qilsa — eng ko‘p uchragani, qolgani price_json’da.
  const price = mode(Object.values(prices).filter(x => x.price > 0).map(x => x.price));
  // Photobuy BILLZ’ida model SKU’da, «name» esa tovar turi (238 ta «Осветительный прибор»). Nom umumiy bo‘lsa (raqamsiz) —
  // ko‘rinadigan nom «MODEL — tur»: agent va sotuvchi aniq tovarni ko‘radi. Toifa bo‘sh bo‘lsa — tur toifa sifatida.
  const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
  const typeName = clean(p.name), sku = clean(p.sku) || null;
  const name = (sku && !/\d/.test(typeName) && !typeName.toLowerCase().includes(sku.toLowerCase()) ? `${sku} — ${typeName}` : typeName).slice(0, 200);
  const category = clean((p.categories || []).map(c => c?.name).filter(Boolean)[0]) || (!/\d/.test(typeName) ? typeName : null);
  let row = one('SELECT id FROM products WHERE billz_id=?', p.id);
  // Qo‘lda kiritilgan (Katalog agenti) karta shu nomda bo‘lsa — BILLZ bilan bog‘lanadi: tekshirilgan tavsif saqlanadi
  if (!row) row = one('SELECT id FROM products WHERE billz_id IS NULL AND is_demo=0 AND (lower(name)=lower(?) OR (sku IS NOT NULL AND lower(sku)=lower(?)))', name, sku || '');
  const skuFree = sku && !one('SELECT 1 FROM products WHERE sku=? AND id<>?', sku, row?.id ?? -1) ? sku : null;
  // Rasm: BILLZ'da to'ldirilgan bo'lsa olinadi; bo'sh bo'lsa paneldagi mavjud rasm saqlanadi
  const photo = Array.isArray(p.photos) && p.photos.length ? (typeof p.photos[0] === 'string' ? p.photos[0] : p.photos[0]?.url || p.photos[0]?.photo_url || p.photos[0]?.image_url) : null;
  const image = clean(p.main_image_url_full || p.main_image_url || photo || '') || null;
  const vals = [p.id, name, clean(p.brand_name) || null, category, skuFree, p.barcode || null, price ?? null, JSON.stringify(prices), JSON.stringify(stock), image, t, t, t];
  if (row) {
    run(`UPDATE products SET billz_id=?, name=?, brand=COALESCE(?,brand), category=COALESCE(?,category), sku=COALESCE(?,sku), barcode=?, price=?, price_json=?,
      stock_json=?, image_url=COALESCE(?,image_url), stock_synced_at=?, billz_seen_at=?, updated_at=? WHERE id=?`, ...vals, row.id);
    return 0;
  }
  run(`INSERT INTO products(billz_id,name,brand,category,sku,barcode,price,price_json,stock_json,image_url,stock_synced_at,billz_seen_at,updated_at,first_seen_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, ...vals, t);
  return 1;
}

export async function syncProducts({ full = false } = {}) {
  const shops = shopNames(), started = now();
  const since = full ? null : num(kvGet('billz_products_at'));
  const query = { include_empty_stocks: 'true', ...(since ? { last_updated_date: utcStamp(since - 10 * 60e3) } : {}) };
  const { items, count } = await billzAll('/v2/products', { listKey: 'products', limit: 200, query });
  if (full && items.length < count) throw new BillzError(200, { message: `tovarlar ro‘yxati chala keldi (${items.length}/${count}) — qo‘llanmadi` }, '/v2/products');
  let added = 0, zeroed = 0;
  const prev = num(kvGet('billz_products_count'));
  tx(() => {
    for (const p of items) added += upsertProduct(p, shops, started);
    if (full) {
      // Hajm keskin kamaygan bo‘lsa (masalan ruxsat o‘zgargan) — ommaviy «qoldiq 0» qo‘llanmaydi
      if (prev && count < prev * 0.5) audit('sys', 'BILLZ', 'Tovarlar soni keskin kamaydi — yo‘qolganlar belgilanmadi', { data: `${prev} → ${count}` });
      else zeroed = run(`UPDATE products SET stock_json='{}', stock_synced_at=? WHERE billz_id IS NOT NULL AND is_demo=0 AND (billz_seen_at IS NULL OR billz_seen_at<?) AND stock_json<>'{}'`, started, started).changes;
    }
  });
  kvSet('billz_products_at', started);
  if (full) kvSet('billz_products_count', count);
  return { fetched: items.length, added, zeroed };
}

/* ---------- mijozlar: telefon va keshbek ---------- */
function upsertClient(c, t) {
  if (!c?.id) return null;
  const phones = [...new Set((c.phone_numbers || []).map(normPhone).filter(Boolean))];
  const name = [c.first_name, c.last_name].filter(Boolean).join(' ').trim().slice(0, 120) || null;
  const row = one('SELECT id FROM customers WHERE billz_id=?', String(c.id));
  let id = row?.id;
  if (row) run('UPDATE customers SET name=COALESCE(?,name), phone=?, phones=?, billz_ext_id=?, synced_at=? WHERE id=?', name, phones[0] || null, phones.join(',') || null, c.external_id == null ? null : String(c.external_id), t, id);
  else id = Number(run('INSERT INTO customers(name,phone,phones,billz_id,billz_ext_id,synced_at,created_at) VALUES(?,?,?,?,?,?,?)',
    name, phones[0] || null, phones.join(',') || null, String(c.id), c.external_id == null ? null : String(c.external_id), t, t).lastInsertRowid);
  if (num(c.balance) != null) run('INSERT INTO cashback(customer_id,amount,synced_at) VALUES(?,?,?) ON CONFLICT(customer_id) DO UPDATE SET amount=excluded.amount, synced_at=excluded.synced_at', id, Math.round(num(c.balance) * 100) / 100, t);   // tiyingacha: $0.40 ham yo‘qolmasin
  return id;
}

export async function syncClients() {
  const started = now();
  const { items } = await billzAll('/v1/client', { listKey: 'clients', limit: 100 });
  tx(() => { for (const c of items) upsertClient(c, started); });
  kvSet('billz_clients_at', started);
  return { clients: items.length };
}

/* Kontakt ulashilganda: shu raqam bo‘yicha BILLZ’dan darhol (keshbek yangi bo‘lsin). Topilmasa yoki xato — null (lokal ma’lumot ishlatiladi). */
export async function refreshClientByPhone(phone) {
  const p = normPhone(phone);
  if (!billzLive() || !p) return null;
  for (const variant of [p, p.replace('+', '')]) {
    try {
      const j = await billz('GET', '/v1/client', { query: { phone_number: variant, limit: 5, page: 1 } });
      const list = j?.clients || [];
      if (list.length) { const t = now(); return tx(() => list.map(c => upsertClient(c, t))); }
    } catch (e) { audit('sys', 'BILLZ', 'Mijozni telefon bo‘yicha so‘rashda xato', { result: e.message }); return null; }
  }
  return [];
}

/* ---------- xaridlar va qaytarishlar ---------- */
/* Qator maydonlari — haqiqiy javob bo‘yicha tekshirilgan (2026-09-20): created_at (kompaniya vaqti, «YYYY-MM-DD hh:mm:ss»), shop_id/shop_name,
   order_type («Продажа», «Возврат», «Обмен»), order_id/order_number, customer_id (BILLZ mijoz UUID)/customer_number, phone_numbers (odatda null),
   product_id/product_name/product_sku/product_barcode, categories_path (massiv), gross_sales/net_sales, sold_/returned_measurement_value.
   MUHIM: hisobotlar shop_ids’siz bo‘sh qaytadi (xatosiz) — har doim magazinlar ro‘yxati beriladi.
   Kutilgan maydon topilmasa — sinxron to‘xtaydi va panelda haqiqiy maydon nomlari ko‘rsatiladi (taxmin bilan yozilmaydi). */
const F = {
  date: ['created_at', 'date', 'sold_at', 'order_date'],
  shop: ['shop_name', 'shop'],
  type: ['order_type', 'transaction_type'],
  receipt: ['order_id', 'order_number', 'transaction_id'],
  shopId: ['shop_id'],
  custId: ['customer_id'],
  productId: ['product_id'],
  seller: ['seller_name', 'seller_names', 'seller'],
  custNo: ['customer_number'],
  phones: ['phone_numbers', 'customer_phones', 'phone_number'],
  product: ['product_name', 'name'],
  sku: ['product_sku', 'sku'],
  barcode: ['product_barcode', 'barcode'],
  category: ['categories_path', 'level_1', 'category'],
  net: ['net_sales', 'net_gross_sales'],
  gross: ['gross_sales'],
  soldQty: ['sold_measurement_value', 'measurement_value'],
  retQty: ['returned_measurement_value']
};
const get = (r, k) => { for (const f of F[k]) if (r[f] !== undefined && r[f] !== null && r[f] !== '') return r[f]; return null; };
function checkShape(r) {
  const miss = ['date', 'product'].filter(k => get(r, k) == null).concat(get(r, 'net') == null && get(r, 'gross') == null ? ['summa'] : []);
  if (miss.length) throw new BillzError(200, { message: `xarid qatori tuzilmasi kutilganidan farq qiladi (yo‘q: ${miss.join(', ')}; bor: ${Object.keys(r).sort().join(', ')})` }, '/v1/customer-purchases-table');
}
function parseTs(v) {
  if (typeof v === 'number') return v > 1e12 ? v : v * 1000;
  const s = String(v).trim().replace(' ', 'T');
  return Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s.length === 10 ? s + 'T12:00:00' : s}+05:00`); // vaqt mintaqasi yo‘q — kompaniya vaqti
}

export async function syncPurchases(fromDate, toDate) {
  const shopIds = all('SELECT billz_shop_id FROM branches WHERE billz_shop_id IS NOT NULL').map(r => r.billz_shop_id);
  if (!shopIds.length) throw new BillzError(200, { message: 'magazinlar ro‘yxati yo‘q — avval magazinlar sinxroni kerak' }, '/v1/customer-purchases-table');
  const { items } = await billzAll('/v1/customer-purchases-table', { listKey: 'purchases', limit: 100,
    query: { start_date: fromDate, end_date: toDate, with_customers: 'false', currency: 'UZS', shop_ids: shopIds.join(',') } });
  if (items.length) checkShape(items[0]);
  const start = dayStart(fromDate), end = dayStart(toDate) + DAY;
  const branchRows = all('SELECT id, name, billz_shop_id FROM branches');
  const branchId = new Map(branchRows.map(b => [b.name.toLowerCase(), b.id])), branchByShop = new Map(branchRows.filter(b => b.billz_shop_id).map(b => [b.billz_shop_id, b]));
  const prods = all('SELECT id, sku, barcode, name, billz_id FROM products WHERE is_demo=0');
  const byBillz = new Map(prods.filter(x => x.billz_id).map(x => [x.billz_id, x.id]));
  const bySku = new Map(prods.filter(x => x.sku).map(x => [x.sku, x.id])), byBc = new Map(prods.filter(x => x.barcode).map(x => [x.barcode, x.id]));
  const byName = new Map(prods.map(x => [x.name.toLowerCase(), x.id])), nameOf = new Map(prods.map(x => [x.id, x.name]));
  let sales = 0, returns = 0, skipped = 0;
  tx(() => {
    run('DELETE FROM purchases WHERE is_demo=0 AND sold_at>=? AND sold_at<?', start, end);
    const lineNo = new Map();
    for (const r of items) {
      const ts = parseTs(get(r, 'date'));
      if (!Number.isFinite(ts) || ts < start || ts >= end) { skipped++; continue; }
      const shopRow = get(r, 'shopId') ? branchByShop.get(String(get(r, 'shopId'))) : null;
      const shop = shopRow?.name || (get(r, 'shop') ? String(get(r, 'shop')) : null);
      const type = String(get(r, 'type') || '').toUpperCase();
      const sold = num(get(r, 'soldQty')) || 0, ret = num(get(r, 'retQty')) || 0;
      const amountRaw = num(get(r, 'net')) ?? num(get(r, 'gross')) ?? 0;
      const isReturn = /RETURN|ВОЗВРАТ|QAYTAR/.test(type) || (ret > 0 && sold <= 0) || (amountRaw < 0 && sold <= 0);
      const custId = get(r, 'custId'), custNo = get(r, 'custNo'), phonesRaw = get(r, 'phones');
      // Mijozsiz savdo: BILLZ «bo‘sh» UUID qo‘yadi (00000000-…) — hech kimga bog‘lanmaydi (customer_number bo‘yicha ham)
      const anonymous = custId != null && /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(String(custId));
      let cust = custId != null && !anonymous ? one('SELECT id FROM customers WHERE billz_id=?', String(custId)) : null;
      if (!cust && !anonymous && custNo != null) cust = one('SELECT id FROM customers WHERE billz_ext_id=?', String(custNo));
      if (!cust && !anonymous && phonesRaw) {
        const ph = normPhone(Array.isArray(phonesRaw) ? phonesRaw[0] : String(phonesRaw).split(/[,;]/)[0]);
        const found = ph ? all('SELECT id FROM customers WHERE phone=? AND is_demo=0', ph) : [];
        if (found.length === 1) cust = found[0];
      }
      const pname = String(get(r, 'product') || '').slice(0, 200), sku = get(r, 'sku') ? String(get(r, 'sku')) : null, bc = get(r, 'barcode') ? String(get(r, 'barcode')) : null;
      const prodId = (get(r, 'productId') && byBillz.get(String(get(r, 'productId')))) || (sku && bySku.get(sku)) || (bc && byBc.get(bc)) || byName.get(pname.toLowerCase()) || null;
      const shownName = (prodId && nameOf.get(prodId)) || pname; // xarid tarixida ham «MODEL — tur», umumiy «Объектив» emas
      const receipt = `billz:${get(r, 'receipt') ?? `${shop}|${get(r, 'date')}`}`;
      const line = (lineNo.get(receipt) || 0) + 1; lineNo.set(receipt, line);
      const qty = Math.max(1, Math.round(isReturn ? (ret || Math.abs(sold) || 1) : (sold || 1)));
      const seller = get(r, 'seller'), sellerName = Array.isArray(seller) ? seller.join(', ') : seller;
      const cat = get(r, 'category'), category = Array.isArray(cat) ? cat.join(' / ') : cat;
      // Summa yaxlitlanmaydi (sentlar bilan): oylik yig‘indi BILLZ hisobotiga aynan teng bo‘lsin
      const ins = run(`INSERT OR IGNORE INTO purchases(receipt,line,customer_id,product_id,product_name,qty,amount,branch_id,branch_name,seller_name,category,sold_at,returned_at,kind,sku,order_type,is_demo)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)`, receipt, line, cust?.id ?? null, prodId, shownName, qty, Math.abs(amountRaw),
        shopRow?.id ?? (shop ? branchId.get(shop.toLowerCase()) ?? null : null), shop, sellerName ? String(sellerName).slice(0, 120) : null, category ? String(category).slice(0, 200) : null,
        ts, isReturn ? ts : null, isReturn ? 'return' : 'sale', sku, get(r, 'type') ? String(get(r, 'type')).slice(0, 40) : null);
      if (!ins.changes) skipped++; else if (isReturn) returns++; else sales++;
    }
  });
  return { from: fromDate, to: toDate, rows: items.length, sales, returns, skipped };
}

/* ---------- xodimlar (panelga qo‘shish uchun tavsiya) ----------
   Faqat ism, rol va magazin nomlari saqlanadi. BILLZ javobidagi telefon, parol xeshi va boshqa maydonlar olinmaydi.
   Integratsiya kalitining foydalanuvchisi (rolsiz, nomida «api») chiqariladi. Ruxsat bo‘lmasa (403) — jim o‘tkaziladi. */
export async function syncStaff() {
  let items;
  try { ({ items } = await billzAll('/v1/user', { listKey: 'users', limit: 100 })); }
  catch (e) { if (e.status === 403 || e.status === 404) return { staff: 0, skipped: true }; throw e; }
  const shops = shopNames();
  const staff = items.filter(u => (u.roles || []).length && !/\bapi\b/i.test(`${u.first_name} ${u.last_name}`) && !u.deleted_at).map(u => ({
    billz_id: String(u.id), name: [u.first_name, u.last_name].map(x => String(x || '').trim()).filter(Boolean).join(' ').slice(0, 80),
    roles: (u.roles || []).map(r => r?.name || r?.role_name || '').filter(Boolean).slice(0, 6),
    shops: (u.shops || []).map(s => shops[s?.id] || s?.name || '').filter(Boolean)
  })).filter(u => u.name);
  kvSet('billz_staff', JSON.stringify(staff));
  return { staff: staff.length };
}

/* Tarix oynasi: back=0 — kechagi oyning 1-kunidan kechagidan oldingi kungacha; back=k — k oy oldingi to‘liq oy (sanalar Toshkent bo‘yicha) */
export function backfillWindow(yesterday, back) {
  const [y, m] = yesterday.split('-').map(Number);
  const idx = y * 12 + (m - 1) - back, yy = Math.floor(idx / 12), mm = idx % 12 + 1;
  const pad = n => String(n).padStart(2, '0');
  const from = `${yy}-${pad(mm)}-01`;
  const last = new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  const dayBefore = new Date(Date.parse(`${yesterday}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
  return { from, to: back === 0 ? dayBefore : `${yy}-${pad(mm)}-${pad(last)}` };
}

/* ---------- jadval ---------- */
let busy = false, lastError = null;
const stamp = () => local().hm;

/* Har daqiqada chaqiriladi; nima qilish kerakligini o‘zi hal qiladi. force — panel tugmasi. */
export async function billzTick({ force = false } = {}) {
  if (!billzLive() || busy) return { skipped: true };
  if (!force && now() < (num(kvGet('billz_retry_at')) || 0)) return { skipped: true };
  busy = true;
  const done = [];
  try {
    const t = now(), today = tashkentDay(t), yesterday = tashkentDay(t - DAY), hm = local(t).hm;
    const lastHourly = num(kvGet('billz_hourly_at')) || 0;
    const firstRun = !kvGet('billz_ready');
    if (firstRun || force || kvGet('billz_daily_date') !== today && hm >= '05:00') {
      done.push(['magazinlar', await syncShops()]);
      done.push(['tovarlar (to‘liq)', await syncProducts({ full: true })]);
      done.push(['mijozlar', await syncClients()]);
      done.push(['xodimlar', await syncStaff()]);
      done.push(['xaridlar (kecha)', await syncPurchases(yesterday, yesterday)]);
      done.push(['xaridlar (bugun)', await syncPurchases(today, today)]);
      kvSet('billz_daily_date', today); kvSet('billz_hourly_at', t); kvSet('billz_ready', 1);
      // Haqiqiy ma’lumot keldi: demo savdo, mijoz va tovarlar hisobot, reja va qayta sotuvga aralashmasin
      if (firstRun && hasDemo()) { removeDemo('BILLZ ulandi (avtomatik)'); done.push(['demo', { olib_tashlandi: 1 }]); }
    } else if (t - lastHourly >= HOUR) {
      done.push(['tovarlar (o‘zgargan)', await syncProducts()]);
      done.push(['xaridlar (bugun)', await syncPurchases(today, today)]);
      kvSet('billz_hourly_at', t);
    }
    // Tarix: 12 oy, har tikda bitta oy (so‘rovlar chegarasi va boshqa ishlar to‘xtab qolmasin)
    const back = num(kvGet('billz_backfill_months')) || 0;
    if (kvGet('billz_ready') && back < 12 && !done.length) {
      const { from, to } = backfillWindow(yesterday, back);
      if (from <= to) done.push([`xaridlar tarixi ${from.slice(0, 7)}`, await syncPurchases(from, to)]);
      kvSet('billz_backfill_months', back + 1);
    }
    lastError = null;
    kvSet('billz_retry_at', 0);
    if (done.length) {
      const counts = one(`SELECT (SELECT count(*) FROM products WHERE billz_id IS NOT NULL) p, (SELECT count(*) FROM customers WHERE billz_id IS NOT NULL AND is_demo=0) c,
        (SELECT count(*) FROM purchases WHERE is_demo=0) x, (SELECT count(*) FROM branches WHERE billz_shop_id IS NOT NULL) b`);
      setIntegration('billz', 'ok', `Ulangan · oxirgi sinxron ${stamp()} · ${counts.b} magazin, ${counts.p} tovar, ${counts.c} mijoz, ${counts.x} xarid qatori`);
      audit('sys', 'BILLZ', 'Sinxron', { data: done.map(([k, v]) => `${k}: ${Object.entries(v).map(([a, b]) => `${a} ${b}`).join(', ')}`).join(' · '), result: 'OK' });
    }
    return { ok: true, done };
  } catch (e) {
    lastError = e.message;
    const auth = e.status === 401 || e.status === 403;
    // Kalit xato bo‘lsa — soatda bir marta urinadi (BILLZ’ni behuda so‘rovlar bilan band qilmaslik); boshqa xato — 15 daqiqa
    kvSet('billz_retry_at', now() + (auth ? HOUR : 15 * 60e3));
    setIntegration('billz', 'error', auth
      ? `Kalit qabul qilinmadi (${e.status}). BILLZ → Настройки → Настройки компании → Ключи интеграции: yangi kalit oling va serverda sozla.sh billz bilan kiriting.`
      : `Sinxron to‘xtadi: ${e.message}`);
    audit('sys', 'BILLZ', 'Sinxron xatosi', { result: e.message });
    return { ok: false, error: e.message, done };
  } finally { busy = false; }
}
export const billzBusy = () => busy;
