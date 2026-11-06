import { one, all, run } from '../db.js';
import { now, jparse, clip } from '../util.js';
import { priceStock } from './billz.js';
import { audit } from '../core/audit.js';

/* Bilim bazasi (SOT 04). Karta «verified» bo‘lmaguncha agent undagi moslikka tayanib va’da bermaydi. */

const norm = s => String(s || '').toLowerCase().replace(/[‘’'`ʻʼ]/g, '').replace(/[^a-zа-яё0-9.+/ -]/gi, ' ').replace(/\s+/g, ' ').trim();

/* Qidiruv: tire va bo‘shliqqa qaramaydi («tl30» → «TL-30», «sl 60» → «SL60W»); nom va SKU (model) muhimroq.
   maxPrice / inStock — «arzonrog‘i bormi?» kabi savolga bitta qidiruvda javob (narxi noma’lumlar chiqmaydi). */
const compact = s => s.replace(/[\s\-/.]/g, '');
/* Mijoz so‘zi → katalog toifasi. Tovar nomlari «… — Осветительный прибор» kabi ruscha toifa bilan, mijoz esa «svet», «chiroq», «petlichka»
   deb yozadi: ilgari «svet», «obyektiv», «stabilizator» bo‘yicha hech narsa topilmasdi, «kamera» — mikrofon chiqarardi (2026-10-08).
   So‘z norm() dan keyin tekshiriladi (o‘zbekcha ў қ ғ ҳ olib tashlangan: «чироқ» → «чиро»). */
const CAT_SYN = [
  [/^(svet|свет|chiro|чиро|yorug|ёру|lampa|лампа|light|освещ|projektor|прожект|led$)/, ['Осветительный прибор', 'Прожекторы']],
  [/^(softbo|софтбо)/, ['Softboks для осветительный прибор']],
  [/^(stoyka|стойк)/, ['Штатив для осветитель']],
  [/^(shtativ|штатив|tripod|trenog|треног)/, ['Штатив для камера', 'Штатив для смартфона', 'Штатив для осветитель']],
  [/^(selfi|селфи|monopod|монопод)/, ['SELFI PALKA']],
  [/^(petlich|петлич|mikrofon|mikrafon|микрофон|микрафон|lav$|mic$)/, ['Петличка микрофон', 'Микрофон']],
  [/^(obyektiv|obektiv|объектив|обектив|linza|линза|lens$)/, ['Объектив']],
  [/^(filtr|фильтр|filter)/, ['Защитные линзы']],
  [/^(kamera|камера|fotoapparat|фотоаппарат|apparat|аппарат|camera)/, ['Фотоаппарат']],
  [/^(ekshn|экшн|экшен|action|gopro)/, ['Экшен камера']],
  [/^(stabiliz|стабилиз|gimbal|гимбал)/, ['Стабилизатор для фотоаппарата', 'Стабилизатор для телефона']],
  [/^(fon$|фон$|background)/, ['Фото фон', 'Бумажный фон']],
  [/^(sumka|сумка|ryukzak|рюкзак|bag$)/, ['Сумка для фотоаппарата', 'Рюкзак для фотоаппарата']],
  [/^(akkumul|аккумул|batare|батаре)/, ['Аккумулятор']],
  [/^(fleshka|флешка|xotira|sd$)/, ['Карта памяти']],
  [/^(monitor|монитор)/, ['Монитор']],
  [/^(vspishk|вспышк|flash)/, ['Накамерный вспышка', 'Студеная вспышка']],
  [/^(zaryad|заряд|charger)/, ['Зарядное устройство', 'Зарядка']],
  [/^(rig$|риг$|kletka|клетка|cage)/, ['Риг для фотоаппарата', 'Риг для смартфона']],
  [/^(otrajatel|отражат|reflektor|reflector)/, ['Отражатель']]
];
const catOf = p => norm(p.category || (String(p.name).includes(' — ') ? String(p.name).split(' — ').pop() : ''));
/* 90 kunlik sotuv — teng moslikda ommabopi oldin («variant ko‘rsating» deganda tasodifiy emas, ko‘p olinadiganlari). 10 daqiqa keshlanadi */
let soldCache = { at: 0, map: new Map() };
const sold90 = () => {
  if (Date.now() - soldCache.at > 10 * 60e3) soldCache = { at: Date.now(), map: new Map(all(`SELECT product_id, count(*) n FROM purchases
    WHERE kind='sale' AND product_id IS NOT NULL AND sold_at>? GROUP BY product_id`, now() - 90 * 864e5).map(r => [r.product_id, r.n])) };
  return soldCache.map;
};

// Mijoz hozir to‘laydigan narx: BILLZ aksiyasi hamma do‘konda bo‘lsa va ma’lumot eskirmagan bo‘lsa — aksiya narxi
const nowPrice = b => (b.promo_info && !b.promo_info.partial && !b.stale ? b.promo_info.price : b.price);

export function searchProducts(q, limit = 6, { maxPrice = null, inStock = false } = {}) {
  const words = norm(q).split(' ').filter(w => w.length > 1);
  if (!words.length) return [];
  const rows = all('SELECT * FROM products');
  const whole = compact(norm(q));
  const cats = words.map(w => (CAT_SYN.find(([re]) => re.test(w)) || [null, []])[1].map(norm)).filter(c => c.length);
  const sold = sold90();
  const scored = rows.map(p => {
    const hay = norm([p.name, p.brand, p.category, p.sku, p.barcode, p.specs, p.compat].join(' '));
    const name = norm([p.name, p.sku].join(' ')), cname = compact(name), chay = compact(hay);
    let score = 0;
    for (const w of words) { const cw = compact(w); if (name.includes(w) || (cw.length > 2 && cname.includes(cw))) score += 3; else if (hay.includes(w) || (cw.length > 2 && chay.includes(cw))) score += 1; }
    if (whole.length > 3 && cname.includes(whole)) score += 4; // butun so‘rov model kodiga mos («sl60w»)
    const pc = catOf(p);
    for (const c of cats) if (c.includes(pc) && pc) score += 5;   // mijoz so‘zi shu toifaga ishora qiladi
    return { p, score };
  }).filter(x => x.score > 0).map(x => ({ ...x, c: cardForAgent(x.p) }))
    // Budjet: aksiya hamma do‘konda bo‘lsa — aksiya narxi bo‘yicha (aksiyadagi tovar budjetga tushsa, takliflardan chiqib qolmasin)
    .filter(x => (!inStock || x.c.billz.stock_total > 0) && (maxPrice == null || (nowPrice(x.c.billz) != null && nowPrice(x.c.billz) <= maxPrice)))
    // Teng moslikda: do‘konda bori oldin, keyin omborda bori (mijozga avval olish mumkin bo‘lgani), keyin ko‘p sotilgani
    .sort((a, b) => b.score - a.score || (b.c.billz.stock_store > 0) - (a.c.billz.stock_store > 0) || (b.c.billz.stock_total > 0) - (a.c.billz.stock_total > 0)
      || (sold.get(b.p.id) || 0) - (sold.get(a.p.id) || 0))
    .slice(0, limit);
  return scored.map(x => x.c);
}

export function cardForAgent(p) {
  return {
    id: p.id, name: p.name, brand: p.brand, category: p.category,
    status: p.status, has_photo: Boolean(p.image_url), photo_from: !p.image_url ? null : String(p.image_url).startsWith('web:') ? (() => { try { return new URL(p.image_source).hostname.replace(/^www\./, ''); } catch { return 'internet'; } })() : String(p.image_url).startsWith('panel:') ? 'panel' : 'BILLZ', verified_at: p.verified_at ? new Date(p.verified_at).toISOString().slice(0, 10) : null,
    specs: p.specs || null, kit: p.kit || null, compat: p.compat || null, limits: p.limits || null,
    sources: jparse(p.sources, []),
    billz: priceStock(p)
  };
}

export const product = id => one('SELECT * FROM products WHERE id=?', id);
/* Katalog ro‘yxati: qidiruv + qoldiq filtri (hammasi / do‘konda bor / faqat omborda / yo‘q) + filial. Qoldig‘i borlar oldin. */
export function listProducts(q = '', { stock = 'all', branch = '', status = 'all', limit = 100, offset = 0 } = {}) {
  let rows = q ? searchProducts(q, 1000) : all('SELECT * FROM products').map(cardForAgent);
  // 90 kunlik sotuv — tekshirish navbati tartibi (ko‘p so‘raladigan tovar kartasi birinchi tasdiqlansin)
  const sold = new Map(all(`SELECT product_id, count(*) n FROM purchases WHERE kind='sale' AND product_id IS NOT NULL AND sold_at>? GROUP BY product_id`, now() - 90 * 864e5).map(r => [r.product_id, r.n]));
  rows = rows.map(p => ({ ...p, sold90: sold.get(p.id) || 0 }));
  const st = { all: () => true, verified: p => p.status === 'verified', draft: p => p.status !== 'verified', queue: p => p.status !== 'verified' && p.billz.stock_total > 0 }[status] || (() => true);
  rows = rows.filter(st);
  const inBranch = p => !branch || (Number(p.billz.stock_by_branch?.[branch]) || 0) > 0;
  const f = {
    all: () => true,
    store: p => p.billz.stock_store > 0,
    warehouse: p => p.billz.stock_warehouse > 0 && p.billz.stock_store <= 0,
    none: p => p.billz.stock_total <= 0
  }[stock] || (() => true);
  rows = rows.filter(p => f(p) && inBranch(p));
  if (status === 'queue') rows.sort((a, b) => b.sold90 - a.sold90 || (b.billz.stock_store > 0) - (a.billz.stock_store > 0) || a.name.localeCompare(b.name));
  else if (!q) rows.sort((a, b) => (b.billz.stock_store > 0) - (a.billz.stock_store > 0) || (b.billz.stock_total > 0) - (a.billz.stock_total > 0) || a.name.localeCompare(b.name));
  const verified = one(`SELECT count(*) n FROM products WHERE status='verified' AND is_demo=0`).n;
  return { total: rows.length, verified, items: rows.slice(offset, offset + limit) };
}

export function saveProduct(data, who) {
  const f = {
    name: clip(data.name, 200), brand: clip(data.brand || '', 80), category: clip(data.category || '', 80), sku: data.sku || null,
    specs: clip(data.specs || '', 4000), kit: clip(data.kit || '', 2000), compat: clip(data.compat || '', 3000), limits: clip(data.limits || '', 2000),
    sources: JSON.stringify(Array.isArray(data.sources) ? data.sources.slice(0, 12) : [])
  };
  if (!f.name) throw new Error('name_required');
  if (data.id) {
    const cur = product(data.id);
    if (!cur) throw new Error('not_found');
    // Mazmun o‘zgarsa tasdiq qaytadan kerak
    const changed = ['specs', 'kit', 'compat', 'limits'].some(k => (cur[k] || '') !== f[k]);
    run(`UPDATE products SET name=?, brand=?, category=?, sku=?, specs=?, kit=?, compat=?, limits=?, sources=?, updated_at=?,
         status=CASE WHEN ? THEN 'draft' ELSE status END, verified_at=CASE WHEN ? THEN NULL ELSE verified_at END WHERE id=?`,
      f.name, f.brand, f.category, f.sku, f.specs, f.kit, f.compat, f.limits, f.sources, now(), changed ? 1 : 0, changed ? 1 : 0, data.id);
    audit('staff', who, `Katalog kartasi tahrirlandi: ${f.name}${changed ? ' (tasdiq qaytadan kerak)' : ''}`, { object: `product:${data.id}` });
    return data.id;
  }
  const id = run(`INSERT INTO products(name,brand,category,sku,specs,kit,compat,limits,sources,price,stock_json,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
    f.name, f.brand, f.category, f.sku, f.specs, f.kit, f.compat, f.limits, f.sources, null, '{}', now()).lastInsertRowid;
  audit('staff', who, `Katalogga yangi karta: ${f.name}`, { object: `product:${id}` });
  return id;
}

export function verifyProduct(id, who, on = true) {
  run(`UPDATE products SET status=?, verified_at=?, verified_by=? WHERE id=?`, on ? 'verified' : 'draft', on ? now() : null, on ? who : null, id);
  audit('staff', who, on ? 'Katalog kartasi tasdiqlandi' : 'Karta tasdig‘i olib tashlandi', { object: `product:${id}` });
}
