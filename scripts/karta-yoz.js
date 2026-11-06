#!/usr/bin/env node
/*
  Tayyor karta qoralamalarini bazaga yozish (JSON fayldan). Kartalar QORALAMA bo‘lib qoladi — rahbar tasdiqlaydi.
    node scripts/karta-yoz.js scripts/kartalar/2026-09-26-1.json          — nima yozilishini ko‘rsatadi
    node scripts/karta-yoz.js scripts/kartalar/2026-09-26-1.json --yes    — yozadi
  Nom, brend, toifa va SKU BILLZ’dagidek qoladi; manbalarga tekshirilgan sana qo‘shiladi.
*/
import { readFileSync } from 'node:fs';
import { db } from '../src/db.js';
import { local } from '../src/util.js';
import { product, saveProduct } from '../src/services/catalog.js';

const [file] = process.argv.slice(2).filter(a => !a.startsWith('--'));
if (!file) { console.error('node scripts/karta-yoz.js <fayl.json> [--yes]'); process.exit(1); }
const cards = JSON.parse(readFileSync(file, 'utf8'));
const date = local().date;
let n = 0;
for (const c of cards) {
  const p = product(c.id);
  if (!p) { console.log(`  [${c.id}] topilmadi — o‘tkazib yuborildi`); continue; }
  if (p.status === 'verified') { console.log(`  [${c.id}] ${p.name.slice(0, 50)} — allaqachon tasdiqlangan, tegilmaydi`); continue; }
  console.log(`  [${c.id}] ${p.name.slice(0, 60)} · manba: ${(c.sources || []).length} ta`);
  if (!process.argv.includes('--yes')) continue;
  saveProduct({ id: p.id, name: p.name, brand: p.brand, category: p.category, sku: p.sku,
    specs: c.specs, kit: c.kit, compat: c.compat, limits: c.limits,
    sources: (c.sources || []).map(s => `${s} (tekshirildi ${date})`) }, 'Automind (karta qoralamasi)');
  n++;
}
console.log(process.argv.includes('--yes') ? `\n${n} ta karta qoralamasi yozildi — panelda «Tekshirish navbati»dan tasdiqlanadi.` : `\nYozish uchun --yes qo‘shing.`);
db.close();
process.exit(0);
