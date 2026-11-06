#!/usr/bin/env node
/*
  Katalog agenti bilan kartalarni to‘ldirish (navbat: tasdiqlanmagan, qoldig‘i bor, ko‘p sotilgan).
  Kartalar QORALAMA holatida saqlanadi — tasdiqlashni odam qiladi (panel → Bilim bazasi → Tasdiqlash).
  Har karta uchun AI internetdan qidiradi: bu pullik, shuning uchun --yes shart.

    node scripts/katalog-toldir.js --wave a --yes          # eng ko‘p so‘raladigan 60 ta
    node scripts/katalog-toldir.js --limit 20 --jobs 4 --yes
    node scripts/katalog-toldir.js --wave a                # faqat reja va baho (hech narsa yuborilmaydi)

  To‘xtab qolsa yana ishga tushiring: AI to‘ldirgan kartalar (manbasi bor) qayta yuborilmaydi.
*/
import { aiReady, config } from '../src/config.js';
import { db } from '../src/db.js';
import { getSettings } from '../src/services/settings.js';
import { listProducts, saveProduct, product } from '../src/services/catalog.js';
import { researchProduct } from '../src/agents/katalog.js';
import { needsAi, waveOf, WAVES } from '../src/services/karta-tayyor.js';

getSettings();
const args = process.argv.slice(2);
const arg = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const wave = String(arg('--wave', '') || '').toLowerCase();
const jobs = Math.min(6, Math.max(1, Number(arg('--jobs', 3))));
const limit = Number(arg('--limit', 0)) || 0;

const queue = listProducts('', { status: 'queue', limit: 100000 }).items;
/* Davom ettirish: AI allaqachon to‘ldirgan karta qayta yuborilmaydi */
let list = waveOf(queue, wave).filter(needsAi);
if (limit) list = list.slice(0, limit);

const SEC_PER_CARD = 45; // tajriba: qidiruv + fetch bilan ~30–60 s
console.log(`Navbat: ${queue.length} ta · ${wave ? `«${wave.toUpperCase()}» to‘lqini` : 'hammasi'} · to‘ldiriladi: ${list.length} ta`);
console.log(`Bir vaqtda ${jobs} ta karta · taxminiy vaqt ~${Math.ceil(list.length * SEC_PER_CARD / jobs / 60)} daqiqa · model ${config.aiModel} (har karta uchun internet qidiruvi — pullik)`);
if (!aiReady()) { console.error('\nANTHROPIC_API_KEY kiritilmagan (deploy/sozla.sh anthropic). Kalitsiz faqat reja ko‘rsatiladi.'); process.exit(list.length ? 2 : 0); }
if (!args.includes('--yes')) {
  list.slice(0, 10).forEach((p, i) => console.log(`  ${i + 1}. ${p.name.slice(0, 60)} · 90 kunda ${p.sold90} ta`));
  if (list.length > 10) console.log(`  … va yana ${list.length - 10} ta`);
  console.log('\nRozilik uchun --yes qo‘shing.');
  process.exit(0);
}

let ok = 0, fail = 0, i = 0;
const fails = [];
const t0 = Date.now();
async function worker() {
  while (i < list.length) {
    const p = list[i++], n = i, s = Date.now();
    let r;
    try { r = await researchProduct(p.id, 'Katalog agenti'); }
    catch (e) { r = { ok: false, why: String(e.message || e) }; }
    if (r.ok) {
      const cur = product(p.id);
      saveProduct({ id: p.id, name: cur.name, brand: cur.brand, category: cur.category, sku: cur.sku, ...r.card }, 'Katalog agenti (to‘plamli)');
      ok++;
    } else { fail++; fails.push(`${p.name.slice(0, 40)} — ${r.why}`); }
    console.log(`${String(n).padStart(3)}/${list.length} · ${Math.round((Date.now() - s) / 1000)} s · ${p.name.slice(0, 46).padEnd(48)} ${r.ok ? 'qoralama saqlandi' : 'XATO: ' + r.why.slice(0, 60)}`);
    // Ketma-ket 5 ta xato — to‘xtaymiz (kalit, limit yoki tarmoq muammosi)
    if (fails.length >= 5 && ok === 0) { i = list.length; console.error('\n5 ta ketma-ket xato — to‘xtatildi.'); }
  }
}
await Promise.all(Array.from({ length: jobs }, worker));
console.log(`\nTayyor: ${ok} ta qoralama, ${fail} ta bo‘lmadi · ${Math.round((Date.now() - t0) / 60000)} daqiqa.`);
if (fails.length) console.log('Bo‘lmaganlari:\n  ' + fails.slice(0, 10).join('\n  '));
console.log('Endi panelda: Bilim bazasi → «Tekshirish navbati» → kartani ochib «Tasdiqlash».');
db.close();
process.exit(0);
