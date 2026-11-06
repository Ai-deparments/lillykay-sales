import { one, all, run, tx, kvGet, kvSet } from '../db.js';
import { now, local, money, clip, jparse, inWindow, esc, onDuty } from '../util.js';
import { getSettings } from '../services/settings.js';
import { priceStock } from '../services/billz.js';
import { audit } from '../core/audit.js';
import { tg, sendStaff, telegramRunning } from '../channels/telegram.js';
import { config } from '../config.js';
import { effective, channelOpen, sendAiFollowup } from '../services/inbox.js';
import { fokusDraft } from './fokus.js';

/*
  Chaqnoq — qayta sotuv va kampaniyalar agenti (SOT 05, 06, 07).
  - Har kuni kunlik qayta aloqa ro‘yxati: sabab + tavsiya + keshbek, sotuvchilarga vazifa.
  - Yangi tovar kampaniyasi: mos mijozlar, istisnolar, limit, idempotent yuborish.
  Qoida: BILLZ telefoni ≠ Telegram chat. Avtomatik xabar faqat botga ulangan va rozilik bergan mijozga.
*/

const DAY = 864e5;
const likeName = (name, match) => match && String(name || '').toLowerCase().includes(String(match).toLowerCase());

function recentlyContacted(customerId, days) {
  const since = now() - days * DAY;
  return Boolean(one(`SELECT 1 FROM tasks WHERE customer_id=? AND kind IN ('resale','campaign') AND created_at>? LIMIT 1`, customerId, since)
    || one(`SELECT 1 FROM campaign_sends WHERE customer_id=? AND status='sent' AND sent_at>? LIMIT 1`, customerId, since));
}
/* Sotuv qatori keyin qaytarilganmi: BILLZ qaytarishi alohida qator (kind='return') — shu mijoz, shu tovar, sotuvdan keyin */
const NOT_RETURNED = `NOT EXISTS (SELECT 1 FROM purchases r WHERE r.kind='return' AND r.customer_id=p.customer_id AND r.sold_at>=p.sold_at
  AND ((r.product_id IS NOT NULL AND r.product_id=p.product_id) OR lower(r.product_name)=lower(p.product_name)))`;
function boughtProduct(customerId, productId) {
  const p = one('SELECT name FROM products WHERE id=?', productId);
  return Boolean(one(`SELECT 1 FROM purchases p WHERE p.customer_id=? AND p.kind='sale' AND p.returned_at IS NULL AND (p.product_id=? OR lower(p.product_name)=lower(?)) AND ${NOT_RETURNED} LIMIT 1`, customerId, productId, p?.name || ''));
}

/* Mos mijozlar — qoidalar bo‘yicha. productId berilsa, faqat shu mahsulotni taklif qiladigan qoidalar (kampaniya). */
/* Tur maydoni bir nechta yozilishni saqlashi mumkin: «Фотоаппарат|фотоаппарат|Фотокамера» (BILLZ’da bir tur turlicha yozilgan) */
export const splitCats = s => String(s || '').split('|').map(x => x.trim()).filter(Boolean);
const inList = arr => arr.map(() => '?').join(',') || 'NULL';

/* Tur bo‘yicha qoida uchun taklif: shu turdagi do‘konda bor (bo‘lmasa omborda bor) va so‘nggi 180 kunda eng ko‘p sotilgan model */
export function bestInCategory(cat) {
  const cats = Array.isArray(cat) ? cat : splitCats(cat);
  const rows = all(`SELECT pr.*, (SELECT count(*) FROM purchases x WHERE x.product_id=pr.id AND x.kind='sale' AND x.sold_at>?) AS sold
    FROM products pr WHERE pr.category IN (${inList(cats)}) AND pr.is_demo=0`, now() - 180 * DAY, ...cats);
  const scored = rows.map(p => ({ p, s: priceStock(p) })).filter(x => x.s.stock_total > 0);
  scored.sort((a, b) => (b.s.stock_store > 0) - (a.s.stock_store > 0) || b.p.sold - a.p.sold || (b.s.stock_store - a.s.stock_store));
  return scored[0]?.p || null;
}
/* Mijoz shu turdan olganmi. after — qayta xarid qoidasida (qog‘oz fon → yangi fon): faqat qoida sababi bo‘lgan xariddan keyingi xaridlar */
function boughtCategory(customerId, cats, after = null) {
  return Boolean(one(`SELECT 1 FROM purchases p JOIN products pr ON pr.id=p.product_id WHERE p.customer_id=? AND p.kind='sale' AND pr.category IN (${inList(cats)})
    ${after ? 'AND p.sold_at>?' : ''} AND ${NOT_RETURNED} LIMIT 1`, customerId, ...cats, ...(after ? [after] : [])));
}

export function candidates({ productId = null, quietDays = getSettings().resale_quiet_days } = {}) {
  const forCat = productId ? one('SELECT category FROM products WHERE id=?', productId)?.category : null;
  const rules = all(`SELECT r.*, sp.name AS suggest_name, bp.name AS bought_name FROM resale_rules r JOIN products sp ON sp.id=r.suggest_product_id
    LEFT JOIN products bp ON bp.id=r.bought_product_id WHERE r.active=1`)
    .filter(r => !productId || r.suggest_product_id === productId || (forCat && splitCats(r.suggest_category).includes(forCat)));
  const excluded = { qaytargan: 0, allaqachon_olgan: 0, voz_kechgan: 0, yaqinda_aloqa: 0, qoldiq_yoq: 0, avval_taklif: 0 };
  const best = new Map(); const t = now();
  // Bir mijozga bir qoida bo‘yicha taklif — bir marta (har hafta takrorlanmasin)
  const offered = new Set(all(`SELECT customer_id c, json_extract(meta,'$.rule_id') r FROM tasks WHERE kind='resale' AND json_extract(meta,'$.rule_id') IS NOT NULL`).map(x => `${x.c}:${x.r}`));
  const catOf = new Map(all('SELECT id, category FROM products WHERE category IS NOT NULL').map(p => [p.id, p.category]));
  for (const r of rules) {
    // Tur bo‘yicha qoida: taklif — kampaniya tovari yoki bugun shu turdagi eng mos mavjud model
    const sp = productId ? one('SELECT * FROM products WHERE id=?', productId)
      : (r.suggest_category && bestInCategory(r.suggest_category)) || one('SELECT * FROM products WHERE id=?', r.suggest_product_id);
    if (!sp) continue;
    const ps = priceStock(sp);
    const bCats = splitCats(r.bought_category), sCats = splitCats(r.suggest_category);
    const refill = sCats.some(c => bCats.includes(c)); // qayta xarid (sarf materiali): o‘sha turni yana taklif qilish
    const buys = all(`SELECT p.*, c.optout_at, c.name AS cname, CASE WHEN ${NOT_RETURNED} THEN 0 ELSE 1 END AS returned_later FROM purchases p JOIN customers c ON c.id=p.customer_id
      WHERE p.kind='sale' AND p.sold_at BETWEEN ? AND ?`, t - r.max_days * DAY, t - r.min_days * DAY)
      .filter(p => (r.bought_product_id && p.product_id === r.bought_product_id) || (bCats.length && bCats.includes(catOf.get(p.product_id)))
        || (!bCats.length && likeName(p.product_name, r.bought_match || r.bought_name)));
    for (const p of buys) {
      if (p.returned_at || p.returned_later) { excluded.qaytargan++; continue; }
      if (p.optout_at) { excluded.voz_kechgan++; continue; }
      if (!productId && offered.has(`${p.customer_id}:${r.id}`)) { excluded.avval_taklif++; continue; }
      if (sCats.length ? boughtCategory(p.customer_id, sCats, refill ? p.sold_at + DAY : null) : boughtProduct(p.customer_id, r.suggest_product_id)) { excluded.allaqachon_olgan++; continue; }
      if (!productId && recentlyContacted(p.customer_id, quietDays)) { excluded.yaqinda_aloqa++; continue; }
      if (!ps.stale && ps.stock_total < 1) { excluded.qoldiq_yoq++; continue; }
      const prev = best.get(p.customer_id);
      if (!prev || p.sold_at > prev.purchase.sold_at) best.set(p.customer_id, { customer_id: p.customer_id, name: p.cname, purchase: p, rule: r, suggest: sp, stock: ps });
    }
  }
  return { list: [...best.values()], excluded };
}

/* ---------- xaridlar tarixidan qoida tavsiyasi (rahbar tasdiqlaydi) ----------
   Har mijoz uchun har tur bo‘yicha BIRINCHI xarid sanasi olinadi. «A dan keyin B» — B ning birinchi xaridi A dan 1–maxDays kun keyin
   (bitta chek yoki bitta kun — birga xarid, qayta sotuv emas). Ko‘rsatkichlar:
   - support: shunday mijozlar soni; ulush: A olganlarning necha foizi;
   - lift: ulush ÷ (B olgan mijozlar ÷ barcha mijozlar) — tasodifiydan necha barobar ko‘p (1 dan katta bo‘lishi kerak);
   - kunlar: oraliq medianasi va 25–75% chegarasi → qoidaning kun oralig‘i. */
/* P(X ≥ k), X ~ Binomial(n, p): «A olganlardan k tasi B ni ham olishi tasodif bo‘lishi ehtimoli» */
function binomTail(k, n, p) {
  if (k <= 0) return 1;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const lf = [0]; for (let i = 1; i <= n; i++) lf[i] = lf[i - 1] + Math.log(i);
  const lp = Math.log(p), lq = Math.log1p(-p);
  let sum = 0;
  for (let i = k; i <= n; i++) {
    const t = Math.exp(lf[n] - lf[i] - lf[n - i] + i * lp + (n - i) * lq);
    sum += t;
    if (t < sum * 1e-12) break;
  }
  return Math.min(1, sum);
}
const quant = (arr, q) => { if (!arr.length) return null; const a = [...arr].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(q * (a.length - 1)))]; };
const pairKey = (a, b) => `${a} → ${b}`;
export function suggestRules({ minSupport = 3, minLift = 1.5, minShare = 0.04, maxDays = 180, limit = 25, fdr = 0.1 } = {}) {
  const rows = all(`SELECT p.customer_id c, p.sold_at t, pr.category cat FROM purchases p JOIN products pr ON pr.id=p.product_id
    WHERE p.is_demo=0 AND p.kind='sale' AND p.customer_id IS NOT NULL AND pr.category IS NOT NULL AND pr.category<>'' AND ${NOT_RETURNED}`);
  const first = new Map(); // mijoz → (tur → birinchi xarid vaqti)
  for (const r of rows) {
    const m = first.get(r.c) || first.set(r.c, new Map()).get(r.c);
    if (!m.has(r.cat) || r.t < m.get(r.cat)) m.set(r.cat, r.t);
  }
  const total = first.size, buyers = new Map(), pairs = new Map();
  for (const m of first.values()) {
    for (const cat of m.keys()) buyers.set(cat, (buyers.get(cat) || 0) + 1);
    for (const [a, ta] of m) for (const [b, tb] of m) {
      if (a === b) continue;
      const d = (tb - ta) / DAY;
      if (d < 1 || d > maxDays) continue;
      const k = pairKey(a, b), x = pairs.get(k) || pairs.set(k, { a, b, n: 0, days: [] }).get(k);
      x.n++; x.days.push(d);
    }
  }
  const have = new Set(all(`SELECT bought_category a, suggest_category b FROM resale_rules WHERE bought_category IS NOT NULL AND suggest_category IS NOT NULL`).map(r => pairKey(r.a, r.b)));
  // Ko‘p juftlik tekshiriladi (tur × tur) — tasodifiy «moslik»larni ajratish uchun Benjamini–Hochberg (noto‘g‘ri topilma ≤ fdr):
  // m — tekshirilishi mumkin bo‘lgan juftliklar soni (kamida minSupport mijozi bor turlar orasida), ehtiyotkor baho
  const eligible = [...buyers.values()].filter(n => n >= minSupport).length, m = Math.max(1, eligible * (eligible - 1));
  const tested = [...pairs.values()].filter(x => x.n >= minSupport).map(x => ({ ...x, p: binomTail(x.n, buyers.get(x.a), buyers.get(x.b) / total) }))
    .sort((a, b) => a.p - b.p);
  let cut = -1;
  tested.forEach((x, i) => { if (x.p <= ((i + 1) / m) * fdr) cut = i; });
  const out = [];
  for (const x of tested.slice(0, cut + 1)) {
    const k = pairKey(x.a, x.b);
    if (have.has(k) || kvGet(`rule_rejected:${k}`)) continue;
    const share = x.n / buyers.get(x.a), lift = share / (buyers.get(x.b) / total);
    if (lift < minLift || share < minShare) continue;
    const med = quant(x.days, 0.5), p25 = quant(x.days, 0.25), p75 = quant(x.days, 0.75);
    const sp = bestInCategory(x.b);
    out.push({ bought_category: x.a, suggest_category: x.b, support: x.n, buyers: buyers.get(x.a), share: Math.round(share * 1000) / 10, lift: Math.round(lift * 10) / 10,
      median_days: Math.round(med), min_days: Math.max(3, Math.floor(p25 * 0.8)), max_days: Math.min(maxDays, Math.max(30, Math.ceil(p75 * 1.5))),
      suggest: sp ? { id: sp.id, name: sp.name } : null, p: x.p, score: x.n * Math.log(lift) });
  }
  out.sort((a, b) => b.score - a.score);
  return { total_customers: total, tested: tested.length, hypotheses: m, items: out.slice(0, limit) };
}
/* Boshlang‘ich qoidalar — foto-video do‘kon tajribasi, SUN-HIGHTECH BILLZ turlariga moslangan (bir tur turlicha yozilgan — hammasi).
   Tarixdan statistik tasdiqlanmagan: har biriga tarixdagi haqiqiy son ochiq ko‘rsatiladi, rahbar tasdiqlaydi.
   Samarasi keyin vazifa natijalaridan (sotib oldi / qiziqmadi) o‘lchanadi. */
const STARTER = [
  { a: ['Фотоаппарат', 'фотоаппарат', 'Фотокамера', 'фотоаппарата'], b: ['Объектив'], min: 14, max: 180, reason: 'Kamera olgan — qo‘shimcha obyektiv (portret yoki keng burchak) imkoniyatini kengaytiradi' },
  { a: ['Фотоаппарат', 'фотоаппарат', 'Фотокамера', 'фотоаппарата'], b: ['Аккумулятор', 'Aккумуляторы'], min: 7, max: 120, reason: 'Zaxira akkumulyator — uzoq suratga olishda quvvat tugab qolmasligi uchun' },
  { a: ['Фотоаппарат', 'фотоаппарат', 'Фотокамера', 'фотоаппарата'], b: ['Карта памяти'], min: 3, max: 60, reason: 'Tezkor xotira kartasi — 4K video va seriyali suratlar uchun' },
  { a: ['Фотоаппарат', 'фотоаппарат', 'Фотокамера', 'фотоаппарата'], b: ['Сумка для фотоаппарата', 'Рюкзак для фотоаппарата'], min: 7, max: 90, reason: 'Texnikani xavfsiz olib yurish uchun sumka yoki ryukzak' },
  { a: ['Фотоаппарат', 'фотоаппарат', 'Фотокамера', 'фотоаппарата', 'Объектив'], b: ['Защитные линзы'], min: 7, max: 120, reason: 'Himoya filtri obyektivni chizilish va changdan saqlaydi' },
  { a: ['Осветительный прибор', 'Прожекторы'], b: ['Softboks для осветительный прибор', 'Софт бокс для осветительные приборы'], min: 7, max: 120, reason: 'Softbox yorug‘likni yumshatadi — portret va predmet suratida soya yumshoq chiqadi' },
  { a: ['Осветительный прибор', 'Прожекторы'], b: ['Штатив для осветитель', 'Штатив для осветительный прибор'], min: 3, max: 90, reason: 'Yoritgichni kerakli balandlik va burchakda ushlash uchun stoyka' },
  { a: ['Накамерный вспышка', 'Студийная вспышка', 'Студеная вспышка'], b: ['Синхронизатор'], min: 7, max: 120, reason: 'Chaqnoqni kameradan uzoqda boshqarish uchun sinxronizator' },
  { a: ['Фон держатель'], b: ['Бумажный фон', 'Фото фон'], min: 3, max: 60, reason: 'Fon ushlagich olgan — qog‘oz yoki matoli fon kerak bo‘ladi' },
  { a: ['Бумажный фон'], b: ['Бумажный фон'], min: 25, max: 60, reason: 'Qog‘oz fon ishlatilgach almashtiriladi — yangi rulon (tarixda: olganlarning 23% i ~38 kunda qayta oladi)' },
  { a: ['Экшен камера', 'Action Camera'], b: ['Аксессуар для Экшен камера'], min: 3, max: 60, reason: 'Ekshen kamera uchun mahkamlagich va himoya qutisi' }
];
export function starterRules() {
  const present = new Set(all('SELECT DISTINCT category c FROM products WHERE category IS NOT NULL AND is_demo=0').map(r => r.c));
  const have = new Set(all('SELECT bought_category a, suggest_category b FROM resale_rules WHERE bought_category IS NOT NULL').map(r => pairKey(r.a, r.b)));
  const rows = all(`SELECT p.customer_id c, p.sold_at t, pr.category cat FROM purchases p JOIN products pr ON pr.id=p.product_id
    WHERE p.is_demo=0 AND p.kind='sale' AND p.customer_id IS NOT NULL AND pr.category IS NOT NULL`);
  const out = [];
  for (const s of STARTER) {
    const a = s.a.filter(c => present.has(c)), b = s.b.filter(c => present.has(c));
    const A = a.join('|'), B = b.join('|');
    if (!a.length || !b.length || have.has(pairKey(A, B)) || kvGet(`rule_rejected:${pairKey(A, B)}`)) continue;
    // Tarixdagi haqiqiy son: A olgan mijozlar va ulardan 1–max kun ichida (qayta xaridda 7+ kun) B olganlar
    const byC = new Map();
    for (const r of rows) { const e = byC.get(r.c) || byC.set(r.c, { a: [], b: [] }).get(r.c); if (a.includes(r.cat)) e.a.push(r.t); if (b.includes(r.cat)) e.b.push(r.t); }
    let buyers = 0, support = 0;
    for (const e of byC.values()) {
      if (!e.a.length) continue;
      buyers++;
      const t0 = Math.min(...e.a), gap = a.some(c => b.includes(c)) ? 7 : 1;
      if (e.b.some(t => t - t0 >= gap * DAY && t - t0 <= s.max * DAY)) support++;
    }
    const sp = bestInCategory(b);
    out.push({ bought_category: A, suggest_category: B, min_days: s.min, max_days: s.max, reason: s.reason, buyers, support,
      share: buyers ? Math.round(support / buyers * 1000) / 10 : 0, suggest: sp ? { id: sp.id, name: sp.name } : null, source: 'tajriba' });
  }
  return out;
}
export const rejectSuggestion = (a, b, who) => { kvSet(`rule_rejected:${pairKey(a, b)}`, now()); audit('staff', who, `Qoida tavsiyasi rad etildi: ${pairKey(a, b)}`); };

function pickSeller(branchName, rr) {
  const b = branchName && one('SELECT id FROM branches WHERE lower(name)=lower(?)', branchName);
  const raw = all(`SELECT id,name,tg_chat_id,shift_dow,shift_from,shift_to FROM users WHERE active=1 AND role IN ('sotuvchi','filial') ${b ? 'AND branch_id=?' : ''} ORDER BY id`, ...(b ? [b.id] : []));
  // Smenadagi sotuvchi oldin: vazifa bugun ishlamayotgan xodimga tushib qolmasin
  const duty = raw.filter(u => onDuty({ dow: u.shift_dow, from: u.shift_from, to: u.shift_to }));
  const pool = duty.length ? duty : raw;
  const any = pool.length ? pool : all(`SELECT id,name,tg_chat_id FROM users WHERE active=1 AND role='sotuvchi' ORDER BY id`);
  if (!any.length) return null;
  const key = b ? `b${b.id}` : 'all', i = (rr.get(key) || 0) % any.length; rr.set(key, i + 1);
  return any[i];
}

/* Kunlik ro‘yxat. force — sozlangan vaqtni kutmasdan (panel tugmasi). Qayta chaqirish takror vazifa yaratmaydi. */
export async function dailyResale({ force = false, who = 'Qayta sotuv agenti' } = {}) {
  const s = getSettings(), l = local();
  if (!force && (l.hm < s.resale_time || kvGet('resale_date') === l.date)) return null;
  kvSet('resale_date', l.date);
  const all_ = candidates(), excluded = all_.excluded;
  // Kunlik cheklov: sotuvchilar yuklamasi — kattaroq xarid, keyin yangiroq xarid oldin; qolganlari keyingi kunlarga (hali aloqa qilinmagan)
  const list = [...all_.list].sort((a, b) => (b.purchase.amount || 0) - (a.purchase.amount || 0) || b.purchase.sold_at - a.purchase.sold_at).slice(0, s.resale_daily_limit);
  const deferred = all_.list.length - list.length;
  // Muddat: bugun 18:00; ro‘yxat kechroq tuzilsa — ertangi 18:00 (hammasi darhol «muddati o‘tgan» bo‘lmasin)
  let due = Date.parse(`${l.date}T18:00:00+05:00`);
  if (due - now() < 3 * 3600e3) due += 864e5;
  const rr = new Map();
  let created = 0; const perSeller = new Map();
  for (const c of list) {
    const seller = pickSeller(c.purchase.branch_name, rr);
    const cb = one('SELECT * FROM cashback WHERE customer_id=?', c.customer_id);
    const meta = {
      purchase: { date: new Date(c.purchase.sold_at).toISOString().slice(0, 10), item: c.purchase.product_name, amount: c.purchase.amount, branch: c.purchase.branch_name },
      cashback: cb ? { amount: cb.amount, synced_at: cb.synced_at } : null,
      reason: c.rule.reason, rule_id: c.rule.id, suggest: { id: c.suggest.id, name: c.suggest.name, price: c.stock.price, stock: c.stock.stock_total, stale: c.stock.stale },
      // Tur bo‘yicha qoida: taklif — turdagi eng ko‘p sotilgan model; mijozning texnikasiga mosligini sotuvchi tekshiradi
      ...(c.rule.suggest_category ? { check_compat: true, category: c.rule.suggest_category } : {})
    };
    const r = run(`INSERT OR IGNORE INTO tasks(kind,customer_id,user_id,title,body,due_at,created_by,created_at,dedup_key,meta) VALUES('resale',?,?,?,?,?,?,?,?,?)`,
      c.customer_id, seller?.id ?? null, `Qayta sotuv: ${c.name || 'mijoz'} → ${c.suggest.name}`,
      c.rule.suggest_category ? `${c.rule.reason}. Moslikni tekshiring: mijoz olgan — ${c.purchase.product_name}` : c.rule.reason, due, who, now(), `resale:${c.customer_id}:${l.date}`, JSON.stringify(meta));
    if (r.changes) { created++; if (seller) perSeller.set(seller.id, [...(perSeller.get(seller.id) || []), { c, meta, seller }]); }
  }
  audit('ai', 'Qayta sotuv agenti', `Kunlik ro‘yxat: ${created} mijoz${deferred ? ` (yana ${deferred} tasi keyingi kunlarga — kunlik cheklov ${s.resale_daily_limit})` : ''}`, { data: `chiqarildi: ${Object.entries(excluded).filter(([, v]) => v).map(([k, v]) => `${k.replace('_', ' ')} ${v}`).join(', ') || '—'}`, result: 'OK' });
  for (const items of perSeller.values()) {
    const u = one('SELECT * FROM users WHERE id=?', items[0].seller.id);
    await sendStaff(u, `<b>Bugungi qayta aloqa</b> · ${items.length} mijoz\n` + items.slice(0, 10).map((x, i) =>
      `${i + 1}. ${esc(x.c.name || 'mijoz')} — ${esc(x.c.suggest.name)}\n   Sabab: ${esc(x.meta.reason)}${x.meta.cashback ? ` · keshbek ${money(x.meta.cashback.amount)}` : ''}`).join('\n'),
      [[{ text: 'Ro‘yxatni ochish', url: `${config.publicUrl}/#qayta` }]]);
  }
  return { created, excluded, total: all_.list.length, deferred };
}

/* Egasiz qolgan vazifalar (qayta sotuv, kampaniya): sotuvchi o‘chirilgan yoki ro‘yxat tuzilganda faol sotuvchi bo‘lmagan.
   Har daqiqada tekshiriladi: faol sotuvchilarga filial bo‘yicha navbat bilan taqsimlanadi — yangi sotuvchi kirishi bilan
   ro‘yxat unga ham shakllanadi, o‘chirilgan xodimning mijozlari esa yo‘qolib qolmaydi. Sotuvchi yo‘q bo‘lsa — rahbarda turadi. */
export async function rebalanceResale() {
  const rows = all(`SELECT t.id, t.meta FROM tasks t LEFT JOIN users u ON u.id=t.user_id
    WHERE t.status='open' AND t.kind IN ('resale','campaign','campaign_reply') AND (t.user_id IS NULL OR u.active IS NOT 1)
    ORDER BY t.due_at LIMIT 500`);
  if (!rows.length || !one(`SELECT 1 FROM users WHERE active=1 AND role IN ('sotuvchi','filial')`)) return 0;
  const rr = new Map(), per = new Map();
  for (const t of rows) {
    const seller = pickSeller(jparse(t.meta, {})?.purchase?.branch, rr);
    if (!seller) continue;
    run('UPDATE tasks SET user_id=? WHERE id=?', seller.id, t.id);
    per.set(seller.id, (per.get(seller.id) || 0) + 1);
  }
  const moved = [...per.values()].reduce((a, n) => a + n, 0);
  if (!moved) return 0;
  audit('ai', 'Qayta sotuv agenti', `Egasiz ${moved} ta vazifa sotuvchilarga taqsimlandi`, { result: [...per].map(([id, n]) => `${one('SELECT name FROM users WHERE id=?', id)?.name || id}: ${n}`).join(', ') });
  for (const [id, n] of per) {
    const u = one('SELECT * FROM users WHERE id=?', id);
    await sendStaff(u, `<b>Qayta sotuv</b> · sizga ${n} ta mijoz biriktirildi\nRo‘yxatda: nima olgan, nima taklif qilish, sabab, keshbek va tayyor xabar matni.`,
      [[{ text: 'Ro‘yxatni ochish', url: `${config.publicUrl}/#qayta` }]]).catch(() => {});
  }
  return moved;
}

/* ---------- yangi tovar kirimi (SOT 07) ----------
   BILLZ sinxroni katalogga yangi tovar qo‘shsa: karta tayyorlash va kampaniya qarori uchun ro‘yxat.
   Kampaniya avtomatik ochilmaydi va hech kimga xabar yuborilmaydi — rahbar tasdiqlaydi. */
export function newArrivals({ days = 14 } = {}) {
  const rows = all('SELECT * FROM products WHERE first_seen_at > ? AND is_demo=0 ORDER BY first_seen_at DESC LIMIT 200', now() - days * DAY);
  return rows.map(p => {
    const s = priceStock(p);
    const camp = one('SELECT id, status FROM campaigns WHERE product_id=? ORDER BY id DESC LIMIT 1', p.id);
    return { id: p.id, name: p.name, category: p.category, first_seen_at: p.first_seen_at, price: s.price, currency: s.currency,
      stock_store: s.stock_store, stock_warehouse: s.stock_warehouse, verified: p.status === 'verified', campaign: camp || null };
  }).filter(x => x.stock_store + x.stock_warehouse > 0);
}

export async function arrivalsJob({ force = false } = {}) {
  const s = getSettings(), l = local();
  if (!force && (l.hm < s.resale_time || kvGet('arrivals_date') === l.date)) return null;
  kvSet('arrivals_date', l.date);
  const list = newArrivals({ days: 2 });
  if (!list.length) return { arrivals: 0 };
  let created = 0;
  for (const p of list) {
    const r = run(`INSERT OR IGNORE INTO tasks(kind,title,body,due_at,created_by,created_at,dedup_key,meta) VALUES('arrival',?,?,?,?,?,?,?)`,
      `Yangi tovar: ${clip(p.name, 90)}`,
      `Karta to‘ldirilsin (Bilim bazasi) va kampaniya kerakmi — hal qiling. Qoldiq: do‘kon ${p.stock_store} / ombor ${p.stock_warehouse}${p.price ? ` · ${money(p.price)}` : ''}`,
      now() + 2 * DAY, 'Qayta sotuv agenti', now(), `arrival:${p.id}`, JSON.stringify({ product_id: p.id, category: p.category }));
    if (r.changes) created++;
  }
  if (created) {
    audit('ai', 'Qayta sotuv agenti', `Yangi kirim: ${created} ta tovar`, { data: list.slice(0, 10).map(p => p.name).join(' · '), result: 'Rahbar qarori kutilmoqda' });
    for (const u of all(`SELECT * FROM users WHERE active=1 AND role IN ('rahbar','admin')`)) {
      await sendStaff(u, `<b>Yangi kirim: ${created} ta tovar</b>\n` + list.slice(0, 10).map(p => `• ${esc(p.name)} — do‘kon ${p.stock_store}/ombor ${p.stock_warehouse}`).join('\n') +
        '\nKarta to‘ldirilsa AI moslik haqida gapira oladi; kampaniya kerak bo‘lsa — paneldan.', [[{ text: 'Yangi kirim ro‘yxati', url: `${config.publicUrl}/#qayta` }]]);
    }
  }
  return { arrivals: list.length, created };
}

/* ---------- kampaniyalar ---------- */
export function campaignSegment(campaignId) {
  const cp = one('SELECT * FROM campaigns WHERE id=?', campaignId);
  const s = getSettings();
  const { list, excluded } = candidates({ productId: cp.product_id });
  const out = { total: list.length + Object.values(excluded).reduce((a, b) => a + b, 0), excluded, bot: [], no_consent: [], task: [], freq: 0 };
  for (const c of list) {
    const cu = one('SELECT * FROM customers WHERE id=?', c.customer_id);
    const sends30 = one(`SELECT count(*) n FROM campaign_sends WHERE customer_id=? AND status='sent' AND sent_at>?`, c.customer_id, now() - 30 * DAY).n;
    if (sends30 >= s.campaign_per_customer_30d) { out.freq++; continue; }
    if (cu.bot_chat_id && cu.consent_at && !cu.optout_at) out.bot.push(c);
    else if (cu.bot_chat_id) out.no_consent.push(c);
    else out.task.push(c);
  }
  return out;
}

export function personalize(tpl, c, product) {
  const ps = priceStock(product);
  return String(tpl)
    .replaceAll('{ism}', (c.name || '').split(' ')[0] || '')
    .replaceAll('{xarid}', c.purchase.product_name)
    .replaceAll('{mahsulot}', product.name)
    .replaceAll('{narx}', ps.price != null && !ps.stale ? money(ps.price) : 'narxini sotuvchi aytadi')
    .replace(/\s+([,.!?])/g, '$1').trim() + '\n\nXabarlarni to‘xtatish: /stop';
}

export function createCampaign({ product_id, title, message, daily_limit }, who) {
  const p = one('SELECT * FROM products WHERE id=?', product_id);
  if (!p) throw new Error('product_not_found');
  const msg = String(message || '').trim() || `Salom, {ism}! Siz olgan {xarid} bilan mos {mahsulot} keldi. Narxi: {narx}. Qiziq bo‘lsa, «ha» deb yozing — sotuvchimiz batafsil aytadi.`;
  const id = run(`INSERT INTO campaigns(product_id,title,message,daily_limit,created_by,created_at,is_demo) VALUES(?,?,?,?,?,?,?)`,
    p.id, clip(title || `Yangi kirim: ${p.name}`, 120), clip(msg, 900), Number(daily_limit) || getSettings().campaign_daily_limit, who, now(), p.is_demo).lastInsertRowid;
  audit('staff', who, `Kampaniya qoralamasi: ${p.name}`, { object: `campaign:${id}` });
  return id;
}

export function setCampaignStatus(id, status, who) {
  const cp = one('SELECT * FROM campaigns WHERE id=?', id);
  if (!cp) throw new Error('not_found');
  if (!['running', 'paused', 'done'].includes(status)) throw new Error('bad_status');
  run('UPDATE campaigns SET status=?, started_at=COALESCE(started_at,?), approved_by=COALESCE(approved_by,?) WHERE id=?', status, status === 'running' ? now() : null, status === 'running' ? who : null, id);
  audit('staff', who, `Kampaniya «${cp.title}»: ${status === 'running' ? 'boshlandi' : status === 'paused' ? 'to‘xtatildi' : 'yakunlandi'}`, { object: `campaign:${id}` });
}

/* Ishchi: har daqiqada. Kalit (kampaniya+mijoz) bir marta yoziladi — qayta ishga tushirish takror yubormaydi. */
export async function campaignWorker() {
  const s = getSettings();
  if (!inWindow(now(), s.campaign_from, s.campaign_to)) return;
  for (const cp of all(`SELECT * FROM campaigns WHERE status='running'`)) {
    const product = one('SELECT * FROM products WHERE id=?', cp.product_id), ps = priceStock(product);
    if (!ps.stale && ps.stock_total < cp.min_stock) {
      run(`UPDATE campaigns SET status='paused' WHERE id=?`, cp.id);
      audit('ai', 'Qayta sotuv agenti', `Kampaniya to‘xtatildi: «${product.name}» qoldig‘i yetarli emas`, { object: `campaign:${cp.id}`, data: `qoldiq ${ps.stock_total}` });
      continue;
    }
    const today = Date.parse(`${local().date}T00:00:00+05:00`);
    let left = cp.daily_limit - one(`SELECT count(*) n FROM campaign_sends WHERE campaign_id=? AND created_at>=?`, cp.id, today).n;
    if (left <= 0) continue;
    const seg = campaignSegment(cp.id);
    for (const c of [...seg.bot, ...seg.task]) {
      if (left <= 0) break;
      const key = `c${cp.id}:u${c.customer_id}`;
      const channel = seg.bot.includes(c) ? 'bot' : 'task';
      const ins = run(`INSERT OR IGNORE INTO campaign_sends(campaign_id,customer_id,send_key,channel,status,reason,created_at) VALUES(?,?,?,?,?,?,?)`,
        cp.id, c.customer_id, key, channel, 'queued', c.rule.reason, now());
      if (!ins.changes) continue; // kalit bor — takror yuborilmaydi
      left--;
      if (channel === 'bot') {
        const cu = one('SELECT * FROM customers WHERE id=?', c.customer_id);
        if (cu.is_demo) { run(`UPDATE campaign_sends SET status='sent', sent_at=?, error='demo — Telegram’ga yuborilmadi' WHERE send_key=?`, now(), key); continue; }
        try {
          if (!telegramRunning()) throw new Error('bot ishlamayapti');
          await tg('sendMessage', { chat_id: cu.bot_chat_id, text: personalize(cp.message, c, product) });
          run(`UPDATE campaign_sends SET status='sent', sent_at=? WHERE send_key=?`, now(), key);
        } catch (e) {
          run(`UPDATE campaign_sends SET status='failed', error=? WHERE send_key=?`, String(e.message || e), key);
        }
      } else {
        run(`INSERT OR IGNORE INTO tasks(kind,customer_id,title,body,due_at,created_by,created_at,dedup_key,meta) VALUES('campaign',?,?,?,?,?,?,?,?)`,
          c.customer_id, `Kampaniya: ${c.name || 'mijoz'} → ${product.name}`, `${c.rule.reason}. Mijoz botga ulanmagan — qo‘ng‘iroq yoki o‘z kanalingizdan yozing.`,
          now() + 2 * 3600e3, 'Qayta sotuv agenti', now(), `task:${key}`, JSON.stringify({ campaign: cp.id, suggest: { name: product.name, price: ps.price } }));
        run(`UPDATE campaign_sends SET status='task', sent_at=? WHERE send_key=?`, now(), key);
      }
    }
  }
}

export function campaignStats(id) {
  const r = all(`SELECT status, count(*) n FROM campaign_sends WHERE campaign_id=? GROUP BY status`, id);
  const by = Object.fromEntries(r.map(x => [x.status, x.n]));
  const cp = one('SELECT * FROM campaigns WHERE id=?', id);
  const purchased = one(`SELECT count(DISTINCT s.customer_id) n FROM campaign_sends s JOIN purchases p ON p.customer_id=s.customer_id AND p.kind='sale' AND p.product_id=? AND p.sold_at>s.sent_at WHERE s.campaign_id=?`, cp.product_id, id).n;
  const replied = one(`SELECT count(*) n FROM campaign_sends WHERE campaign_id=? AND replied_at IS NOT NULL`, id).n;
  return { sent: by.sent || 0, failed: by.failed || 0, task: by.task || 0, queued: by.queued || 0, replied, purchased };
}

/* Mijoz botda javob yozsa — so‘nggi kampaniyaga javob sifatida belgilanadi va sotuvchiga vazifa.
   Vazifa mijoz oxirgi xarid qilgan filial sotuvchisiga biriktiriladi; telefon matnga yozilmaydi (faqat mas’ul va rahbar ko‘radi). */
const replyRR = new Map();
export function onBotReply(customer, text) {
  const s = one(`SELECT * FROM campaign_sends WHERE customer_id=? AND status='sent' AND sent_at>? ORDER BY sent_at DESC LIMIT 1`, customer.id, now() - 7 * DAY);
  if (!s) return false;
  run('UPDATE campaign_sends SET replied_at=COALESCE(replied_at,?) WHERE id=?', now(), s.id);
  const cp = one('SELECT title FROM campaigns WHERE id=?', s.campaign_id);
  const lastBranch = one(`SELECT branch_name FROM purchases WHERE customer_id=? AND kind='sale' ORDER BY sold_at DESC LIMIT 1`, customer.id)?.branch_name;
  const seller = pickSeller(lastBranch, replyRR);
  run(`INSERT OR IGNORE INTO tasks(kind,customer_id,user_id,title,body,due_at,created_by,created_at,dedup_key) VALUES('campaign_reply',?,?,?,?,?,?,?,?)`,
    customer.id, seller?.id ?? null, `Kampaniyaga javob: ${customer.name || 'mijoz'}`, `«${clip(text, 200)}» — ${cp?.title || ''}`, now(), 'Qayta sotuv agenti', now(), `reply:${s.id}`);
  if (seller) sendStaff(one('SELECT * FROM users WHERE id=?', seller.id), `<b>Kampaniyaga javob</b> · ${esc(customer.name || 'mijoz')}\n«${esc(clip(text, 200))}»`,
    [[{ text: 'Qayta sotuv', url: `${config.publicUrl}/#qayta` }]]).catch(() => {});
  audit('sys', 'SUN-HIGHTECH boti', 'Mijoz kampaniyaga javob yozdi', { object: `campaign:${s.campaign_id}` });
  return true;
}

/* ---------- jim qolgan suhbatlar (SOT 05) ----------
   1-urinish: kanal oynasi ichida, tinch vaqtdan tashqarida — AI (faqat «avto» bosqichida); aks holda sotuvchiga vazifa.
   2-urinish: N kundan keyin — faqat sotuvchi vazifasi. Mijoz javobi, rad, xarid, xodim olishi — to‘xtatadi. */
let fuBusy = false;
export async function followups() {
  if (fuBusy) return; fuBusy = true;
  try {
    const s = getSettings(), t = now();
    const rows = all(`SELECT c.*, a.channel, a.rollout FROM conversations c JOIN accounts a ON a.id=c.account_id
      WHERE c.pending_since IS NULL AND c.taken_by IS NULL AND c.lost_reason IS NULL AND c.stage BETWEEN 1 AND 3 AND c.last_client_at IS NOT NULL
        AND max(COALESCE(c.last_seller_at,0), COALESCE(c.last_ai_at,0)) > c.last_client_at AND c.followup_count < 2 LIMIT 50`);
    for (const c of rows) {
      const lastOut = Math.max(c.last_seller_at || 0, c.last_ai_at || 0), silentH = (t - lastOut) / 3600e3;
      // Oxirgi xabarni SOTUVCHI yozgan bo‘lsa — suhbatni odam olib boryapti: AI mijozga o‘zi yozmaydi
      // (aks holda sotuvchi «hozir chiqazvoraman» degandan keyin AI mijozni bezovta qiladi). Taklif matni sotuvchiga vazifa bo‘lib boradi.
      const sellerLast = (c.last_seller_at || 0) >= (c.last_ai_at || 0);
      if (c.followup_count === 0 && silentH >= s.followup_first_hours) {
        const acct = one('SELECT * FROM accounts WHERE id=?', c.account_id), e = effective(c, acct);
        const canAuto = !sellerLast && acct.rollout === 'avto' && e.mode !== 'ochiq' && channelOpen(c, acct) && !inWindow(t, s.quiet_from, s.quiet_to);
        // AI kanalda to‘xtatilgan — taklif matni ham so‘ralmaydi, faqat sotuvchiga vazifa
        const d = acct.ai_enabled === 0 ? { ok: false } : await fokusDraft({ conv: c, acct, mode: 'followup' });
        if (d.ok && d.noReply) { run('UPDATE conversations SET followup_count=2 WHERE id=?', c.id); continue; }
        run('UPDATE conversations SET followup_count=1 WHERE id=?', c.id);
        if (canAuto && d.ok && d.text) { await sendAiFollowup(c.id, d.text, 'ta’qib 1/2').catch(err => console.error('followup', err)); continue; }
        run(`INSERT OR IGNORE INTO tasks(kind,conversation_id,customer_id,user_id,title,body,due_at,created_by,created_at,dedup_key) VALUES('followup',?,?,?,?,?,?,?,?,?)`,
          c.id, c.customer_id, c.owner_user_id, `Jim qolgan mijoz: ${c.display_name || c.handle || 'mijoz'} (1/2)`,
          (sellerLast ? 'Suhbatni siz olib boryapsiz (oxirgi xabar sizdan), shuning uchun AI mijozga o‘zi yozmadi.\n' : '') +
            (d.ok && d.text ? `AI taklif qilgan xabar: «${clip(d.text, 400)}»` : 'Mijoz javob bermayapti — qisqa aniqlovchi savol bilan yozing.'),
          t, 'Muloqot agenti', t, `fu1:${c.id}:${lastOut}`);
      } else if (c.followup_count === 1 && silentH >= s.followup_second_days * 24) {
        run('UPDATE conversations SET followup_count=2 WHERE id=?', c.id);
        run(`INSERT OR IGNORE INTO tasks(kind,conversation_id,customer_id,user_id,title,body,due_at,created_by,created_at,dedup_key) VALUES('followup',?,?,?,?,?,?,?,?,?)`,
          c.id, c.customer_id, c.owner_user_id, `Jim qolgan mijoz: ${c.display_name || c.handle || 'mijoz'} (2/2)`,
          'Oxirgi urinish. Kanal oynasi yopiq bo‘lsa — mijoz ruxsat bergan boshqa kanal (telefon). Jim qolish «raqobatchiga ketdi» degani emas.', t, 'Muloqot agenti', t, `fu2:${c.id}`);
      }
    }
  } finally { fuBusy = false; }
}
