#!/usr/bin/env node
/*
  Kartalarni AI'SIZ tayyorlash — kalit kelganda ish tez bo‘lsin.
  Nima qiladi: navbatni to‘lqinlarga bo‘ladi (A: eng ko‘p so‘raladigan 60 ta, B: keyingi 90, C: qolgani),
  va bo‘sh kartalarga BILLZ maydonlari va model nomidan dastlabki qoralama yozadi (status draft — mijozga chiqmaydi).
    node scripts/karta-tayyorla.js              — reja va namuna (hech narsa yozilmaydi)
    node scripts/karta-tayyorla.js --yes        — dastlabki qoralamalarni yozadi
    node scripts/karta-tayyorla.js --wave a     — faqat A to‘lqini
*/
import { db, run, one } from '../src/db.js';
import { now } from '../src/util.js';
import { getSettings } from '../src/services/settings.js';
import { listProducts } from '../src/services/catalog.js';
import { prefill, fromName, waveOf } from '../src/services/karta-tayyor.js';
import { audit } from '../src/core/audit.js';

getSettings();
const args = process.argv.slice(2);
const arg = (k, d = null) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const wave = String(arg('--wave', '') || '').toLowerCase();
const queue = listProducts('', { status: 'queue', limit: 100000 }).items;
const list = waveOf(queue, wave);

const sold = list.reduce((a, p) => a + (p.sold90 || 0), 0);
const jamiSold = queue.reduce((a, p) => a + (p.sold90 || 0), 0);
console.log(`Navbat: ${queue.length} ta karta (tasdiqlanmagan, qoldig‘i bor).`);
console.log(`${wave ? `«${wave.toUpperCase()}» to‘lqini` : 'Hammasi'}: ${list.length} ta · 90 kunlik savdoning ${jamiSold ? Math.round(sold / jamiSold * 100) : 0}% i shu kartalarda.`);
const bosh = list.filter(p => !(p.specs || '').trim());
const nomdan = bosh.filter(p => fromName(p.name).length);
console.log(`Bo‘sh karta: ${bosh.length} ta; ulardan ${nomdan.length} tasida model nomidan o‘qiladigan o‘lchov bor.`);
console.log('\nNamuna (birinchi 5):');
for (const p of list.slice(0, 5)) {
  const pre = prefill(p);
  const izoh = pre ? pre.specs.slice(0, 90) : (p.specs || '').trim() ? 'karta allaqachon to‘ldirilgan' : 'nomdan o‘lchov o‘qilmadi — AI to‘ldiradi';
  console.log(`  ${p.name.slice(0, 52).padEnd(54)} 90k: ${String(p.sold90).padStart(3)} · ${izoh}`);
}
if (!args.includes('--yes')) { console.log('\nYozish uchun --yes qo‘shing. AI ishlatilmaydi, pul ketmaydi.'); process.exit(0); }

let n = 0;
for (const p of list) {
  const pre = prefill(p);
  if (!pre) continue;
  run('UPDATE products SET specs=?, limits=COALESCE(NULLIF(limits,\'\'),?), updated_at=? WHERE id=? AND status<>\'verified\'', pre.specs, pre.limits, now(), p.id);
  n++;
}
audit('sys', 'Tizim', `Dastlabki karta qoralamalari: ${n} ta`, { result: 'AI kaliti kelganda tekshiriladi' });
console.log(`\n${n} ta kartaga dastlabki qoralama yozildi. Keyingi qadam (kalit kelgach):`);
console.log('  sudo -u sales env ENV_FILE=/opt/sales/.env node scripts/katalog-toldir.js --wave a --yes');
db.close();
process.exit(0);
