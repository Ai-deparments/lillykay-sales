import { config } from '../config.js';
import { one, all, kvGet } from '../db.js';
import { now, jparse, money, currency } from '../util.js';
import { setIntegration } from './settings.js';

/*
  BILLZ — asosiy hisob manbasi (SOT 02). Tizim BILLZ'dan faqat O‘QIYDI.
  Holatlar:
   - live: BILLZ_SECRET_TOKEN bor va ulanish tekshirilgan (haqiqiy API ish boshida akkauntda tekshiriladi)
   - demo: kalit yo‘q — lokal jadvaldagi namuna ma’lumotlar (panelda ochiq «demo» deb ko‘rsatiladi)
  Ma’lumot eskirgan bo‘lsa (24 soatdan eski) — «stale», agent narx/qoldiqni aytmaydi.
*/
const STALE_MS = 24 * 3600e3;

export function billzMode() { return config.billzToken ? 'live' : 'demo'; }

export function refreshStatus() {
  if (billzMode() === 'demo') { setIntegration('billz', 'demo', 'BILLZ kaliti kiritilmagan — demo ma’lumot ishlatilmoqda'); return; }
  // Qayta ishga tushganda: avval sinxron bo‘lgan bo‘lsa — holat «ulangan» bo‘lib qoladi (keyingi sinxrongacha «kutilmoqda» deb turmaydi)
  const at = Number(kvGet('billz_hourly_at') || 0);
  if (kvGet('billz_ready') && at) {
    const c = one(`SELECT (SELECT count(*) FROM branches WHERE billz_shop_id IS NOT NULL) b, (SELECT count(*) FROM products WHERE billz_id IS NOT NULL) p,
      (SELECT count(*) FROM customers WHERE billz_id IS NOT NULL AND is_demo=0) c, (SELECT count(*) FROM purchases WHERE is_demo=0) x`);
    const hm = new Date(at + 5 * 3600e3).toISOString().slice(11, 16);
    setIntegration('billz', 'ok', `Ulangan · oxirgi sinxron ${hm} · ${c.b} magazin, ${c.p} tovar, ${c.c} mijoz, ${c.x} xarid qatori`);
  } else setIntegration('billz', 'pending', 'Kalit kiritilgan · birinchi sinxron bir daqiqa ichida boshlanadi');
}

/* Filial turlari (do‘kon / ombor) — katalog ro‘yxatida har tovar uchun so‘ralmasin, 30 soniya xotirada */
let kindsCache = { at: 0, map: new Map() };
export function branchKinds() {
  if (now() - kindsCache.at > 30e3) kindsCache = { at: now(), map: new Map(all('SELECT name, kind FROM branches').map(b => [b.name, b.kind])) };
  return kindsCache.map;
}
export const resetBranchKinds = () => { kindsCache.at = 0; };

/* Mahsulot narxi va qoldig‘i — manba va yangilanish vaqti bilan. Qoldiq: do‘konlarda (darhol) va omborda — alohida. */
export function priceStock(p) {
  const stock = jparse(p.stock_json, {});
  const kinds = branchKinds();
  let store = 0, warehouse = 0;
  for (const [b, q] of Object.entries(stock)) { const n = Number(q) || 0; if (kinds.get(b) === 'ombor') warehouse += n; else store += n; }
  const synced = p.stock_synced_at || null;
  const stale = !synced || now() - synced > STALE_MS;
  const prices = jparse(p.price_json, {}) || {};
  const varied = [...new Set(Object.values(prices).filter(x => x.price > 0).map(x => x.price))].length > 1;
  const promos = Object.entries(prices).filter(([, x]) => x.promo).map(([b, x]) => ({ branch: b, price: x.promo, name: x.promo_name || null }));
  // Aksiya — bitta ko‘rinish (AI matni, izohga javob, budjet filtri uchun): narxi bor do‘konlardagi (ombor emas) eng ko‘p uchragan aksiya narxi.
  // partial — aksiya narxi bor do‘konlarning hammasida emas (qaysilarida — branches). Oddiy narxdan arzon bo‘lmagan «aksiya» hisoblanmaydi.
  const shops = Object.entries(prices).filter(([b, x]) => x.price > 0 && kinds.get(b) !== 'ombor');
  const onPromo = shops.filter(([, x]) => x.promo > 0 && x.promo < x.price);
  let promoInfo = null;
  if (onPromo.length) {
    const freq = new Map();
    for (const [, x] of onPromo) freq.set(x.promo, (freq.get(x.promo) || 0) + 1);
    const best = [...freq].sort((a, c) => c[1] - a[1] || a[0] - c[0])[0][0];
    const at = onPromo.filter(([, x]) => x.promo === best);
    promoInfo = { price: best, name: at[0][1].promo_name || null, partial: at.length < shops.length, branches: at.map(([b]) => b) };
  }
  return {
    price: p.price ?? null,
    currency: currency(),
    ...(varied ? { price_by_branch: Object.fromEntries(Object.entries(prices).filter(([, x]) => x.price > 0).map(([b, x]) => [b, money(x.price)])) } : {}),
    ...(promos.length ? { promo: promos } : {}),
    ...(promoInfo ? { promo_info: promoInfo } : {}),
    stock_by_branch: stock,
    stock_total: store + warehouse,
    stock_store: store,
    stock_warehouse: warehouse,
    warehouses: Object.keys(stock).filter(b => kinds.get(b) === 'ombor'),
    source: p.is_demo ? 'BILLZ (demo)' : p.billz_id ? 'BILLZ' : 'qo‘lda kiritilgan',
    synced_at: synced ? new Date(synced).toISOString() : null,
    stale
  };
}

/* Tasdiqlangan mijoz uchungina xaridlar va keshbek (SOT 01, 06) */
export function customerProfile(customerId) {
  const c = customerId && one('SELECT * FROM customers WHERE id=?', customerId);
  if (!c || !c.verified_at) return { verified: false };
  const buys = all(`SELECT p.*, COALESCE(pr.name, p.product_name) AS product_name, b.name AS branch FROM purchases p LEFT JOIN branches b ON b.id=p.branch_id LEFT JOIN products pr ON pr.id=p.product_id
                    WHERE p.customer_id=? ORDER BY p.sold_at DESC LIMIT 30`, c.id);
  const cb = one('SELECT * FROM cashback WHERE customer_id=?', c.id);
  return {
    verified: true, customer_id: c.id, name: c.name, billz_id: c.billz_id, verified_how: c.verified_how,
    purchases: buys.map(b => ({ date: new Date(b.sold_at).toISOString().slice(0, 10), item: b.kind === 'return' ? `${b.product_name} — qaytarish` : b.product_name,
      qty: b.qty, amount: b.kind === 'return' ? -b.amount : b.amount, branch: b.branch || b.branch_name,
      returned: b.returned_at ? new Date(b.returned_at).toISOString().slice(0, 10) : null, kind: b.kind })),
    cashback: cb ? { amount: cb.amount, synced_at: new Date(cb.synced_at).toISOString(), stale: now() - cb.synced_at > STALE_MS,
      source: c.is_demo ? 'BILLZ (demo)' : 'BILLZ' } : null
  };
}

/* Telefon raqamini normallashtirish: +998XXXXXXXXX */
export function normPhone(s) {
  const d = String(s || '').replace(/\D/g, '');
  if (d.length === 9) return '+998' + d;
  if (d.length === 12 && d.startsWith('998')) return '+' + d;
  return d ? '+' + d : null;
}
/* Telefon bo‘yicha mijoz: asosiy yoki qo‘shimcha raqam. Bir raqam bir nechta mijozda bo‘lsa — kimligi aniq emas, tasdiqlanmaydi
   (boshqa odamning xaridi va keshbeki ko‘rsatilmasin). */
export function customerByPhone(phone) {
  const p = normPhone(phone);
  if (!p) return null;
  const rows = all(`SELECT * FROM customers WHERE phone=? OR (',' || COALESCE(phones,'') || ',') LIKE ?`, p, `%,${p},%`);
  return rows.length === 1 ? rows[0] : null;
}
