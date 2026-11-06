import { all, one } from '../db.js';
import { money, now } from '../util.js';
import { cardForAgent } from './catalog.js';

/*
  Karta qoralamasini AI'siz tayyorlash (SOT 04 ga tayyorgarlik).
  Maqsad: AI kaliti kelguncha kartada bor ma'lumot turishi, kalit kelganda esa agent noldan qidirmasligi —
  BILLZ maydonlari va model nomidan olingan faktlar unga beriladi, u faqat tekshiradi va to'ldiradi.
  Bu yerdagi hech narsa «tasdiqlangan» hisoblanmaydi: status draft bo'lib qoladi, mijozga chiqmaydi.
*/

/* Model nomidagi aniq o‘lchovlar. Faqat bir ma'noli naqshlar — taxmin qilinmaydi. */
const RULES = [
  [/(\d+(?:[.,]\d+)?)\s*[Ww](?:att)?\b/, (m) => `quvvat ${m[1].replace(',', '.')} W`],
  [/(\d+(?:-\d+)?)\s*mm\b/i, (m) => `fokus masofasi ${m[1]} mm`],
  [/\bf\/?(\d+(?:[.,]\d+)?)\b/i, (m) => `diafragma f/${m[1].replace(',', '.')}`],
  [/(\d+(?:[.,]\d+)?)\s*(?:cm|см)\b/i, (m) => `o‘lcham ${m[1].replace(',', '.')} cm`],
  [/(\d+)\s*(?:GB|ГБ)\b/i, (m) => `sig‘im ${m[1]} GB`],
  [/(\d+)\s*(?:TB|ТБ)\b/i, (m) => `sig‘im ${m[1]} TB`],
  [/\b(UHS-?I{1,2}|UHS-?[12])\b/i, (m) => `tezlik sinfi ${m[1].toUpperCase()}`],
  [/\bV\s?(30|60|90)\b/, (m) => `video tezlik sinfi V${m[1]}`],
  [/\b(\d{4})\s*K\b/, (m) => `rang harorati ${m[1]} K`],
  [/\b(\d+(?:[.,]\d+)?)\s*(?:kg|кг)\b/i, (m) => `og‘irlik/ko‘tarish ${m[1].replace(',', '.')} kg`],
  [/\b(\d+(?:[.,]\d+)?)\s*(?:m|м)\b(?!m)/i, (m) => `balandlik/uzunlik ${m[1].replace(',', '.')} m`],
  [/\bBowens\b/i, () => 'Bowens bayoneti'],
  [/\b(E-?mount|RF|EF-S|EF|F-mount|MFT|Z-mount)\b/, (m) => `${m[1]} bayoneti`],
  [/\b(NP-?[A-Z]*\d+|LP-?E\d+|EN-EL\d+)\b/i, (m) => `akkumulyator ${m[1].toUpperCase()}`],
  [/\b(USB-?C|Type-?C)\b/i, () => 'USB-C ulanish'],
  [/\b3[.,]5\s*mm\b/, () => '3.5 mm ulanish'],
  [/\b(Bluetooth|2[.,]4\s*G(?:Hz)?)\b/i, (m) => `simsiz ulanish (${m[1]})`],
  [/\b(\d)\s*\+\s*(\d)\b/, (m) => `to‘plam varianti ${m[1]}+${m[2]}`]
];

export function fromName(name = '') {
  const out = [];
  for (const [re, fn] of RULES) {
    const m = String(name).match(re);
    if (m) { const v = fn(m); if (!out.includes(v)) out.push(v); }
  }
  return out;
}

/* AI ga beriladigan «bizda bor fakt» bloki: qidiruvni qisqartiradi va noto‘g‘ri modelni chalkashtirmaydi */
export function knownFacts(p) {
  // cardForAgent SKU ni qaytarmaydi — bazadan olamiz (agent aynan shu modelni qidirishi uchun kerak)
  const c = p.billz ? p : cardForAgent(p);
  const sku = p.sku ?? one('SELECT sku FROM products WHERE id=?', c.id)?.sku ?? null;
  const sold = one(`SELECT count(*) n FROM purchases WHERE product_id=? AND kind='sale' AND sold_at>?`, c.id, now() - 90 * 864e5)?.n || 0;
  const bits = [`Nomi: ${c.name}`];
  if (sku) bits.push(`SKU/model: ${sku}`);
  if (c.brand) bits.push(`Brend: ${c.brand}`);
  if (c.category) bits.push(`Toifa (BILLZ): ${c.category}`);
  if (c.billz?.price) bits.push(`Do‘kon narxi: ${money(c.billz.price)} (kartaga yozilmaydi)`);
  bits.push(`So‘nggi 90 kunda ${sold} marta sotilgan`);
  const auto = fromName(c.name);
  if (auto.length) bits.push(`Nomdan o‘qilgan (tasdiqlash kerak): ${auto.join(', ')}`);
  const sib = all(`SELECT name FROM products WHERE id<>? AND category=? AND (brand=? OR ?='') ORDER BY name LIMIT 5`, c.id, c.category || '', c.brand || '', c.brand || '')
    .map(r => r.name).filter(n => n !== c.name);
  if (sib.length) bits.push(`Shu toifadagi qo‘shni modellar: ${sib.join('; ')}`);
  return bits.join('\n');
}

/* Kalitsiz dastlabki qoralama: nomdan o‘qilgani + BILLZ maydonlari. Faqat bo‘sh kartaga yoziladi. */
export const PREFIX = 'Dastlabki (BILLZ va model nomidan, tekshirilmagan):';
export function prefill(p) {
  const c = p.billz ? p : cardForAgent(p);
  const cur = (c.specs || '').trim();
  if (c.status === 'verified' || (cur && !cur.startsWith(PREFIX))) return null; // odam yoki AI yozgan kartaga tegilmaydi
  const auto = fromName(c.name);
  if (!auto.length) return null; // faqat brend/toifa bo‘lsa — yozishdan ma’no yo‘q, ular panelda allaqachon bor
  const head = [c.brand, c.category].filter(Boolean).join(' · ');
  const specs = `${PREFIX} ${[head, ...auto].filter(Boolean).join('; ')}`.trim();
  return {
    specs,
    limits: 'Karta AI yoki xodim tomonidan tekshirilmagan — mijozga aytishdan oldin tasdiqlash kerak.',
    sources: []
  };
}

/* To‘lqinlar: A — eng ko‘p so‘raladigan 60 ta (qabul sinovi uchun kerakli minimum), B — keyingi 90, C — qolgani */
export const WAVES = { a: [0, 60], b: [60, 150], c: [150, Infinity] };
export function waveOf(queue, wave) {
  const [from, to] = WAVES[String(wave || '').toLowerCase()] || [0, Infinity];
  return queue.slice(from, to === Infinity ? undefined : to);
}
/* AI hali ko‘rmagan karta: manbasi yo‘q yoki faqat dastlabki (nomdan olingan) qoralama turibdi */
export function needsAi(p) {
  const src = [].concat(p.sources || []).join(' ');
  return !src.includes('tekshirildi') || String(p.specs || '').startsWith(PREFIX);
}
