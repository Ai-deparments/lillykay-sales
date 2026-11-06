#!/usr/bin/env node
/*
  Telegram Desktop eksportini panelga yuklash — akkauntning ESKI mijoz suhbatlari (Telegram botlarga tarixni bermaydi).
  Eksport: Telegram Desktop → chat → ⋮ → Export chat history → format «JSON».
  Faqat MIJOZ chatlarini eksport qiling — shaxsiy (oila, do‘stlar) chatlar kerak emas.

    node scripts/tg-import.js result.json                           — nima yuklanishini ko‘rsatadi
    node scripts/tg-import.js result.json --skip "Ism1,Ism2" --yes   — yuklaydi (ayrim chatlarsiz)
*/
import { readFileSync } from 'node:fs';
import { db, one } from '../src/db.js';
import { parseExport, applyImport } from '../src/services/tg-import.js';

const args = process.argv.slice(2);
const si = args.indexOf('--skip');
const skip = new Set(si >= 0 ? String(args[si + 1] || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : []);
const file = args.find((a, i) => !a.startsWith('--') && i !== si + 1);
if (!file) { console.error('node scripts/tg-import.js <result.json> [--skip "Ism1,Ism2"] [--yes]'); process.exit(1); }
const acct = one(`SELECT * FROM accounts WHERE channel='tg' AND enabled=1 ORDER BY id LIMIT 1`);
if (!acct) { console.error('Telegram Business akkaunti ulanmagan.'); process.exit(1); }

const { plan, skipped } = parseExport(JSON.parse(readFileSync(file, 'utf8')), acct.tg_owner_id, skip);
const total = plan.reduce((a, c) => a + c.msgs.length, 0);
console.log(`Akkaunt: ${acct.name}`);
console.log(`Mijoz chatlari: ${plan.length} ta, ${total} xabar (o‘tkazildi: ${skipped.tur} guruh/kanal/bot, ${skipped.nom} nom bo‘yicha, ${skipped.bosh} bo‘sh)`);
for (const c of plan.slice(0, 15)) console.log(`  ${c.name.slice(0, 32).padEnd(34)} ${String(c.msgs.length).padStart(5)} xabar · ${new Date(c.msgs[0].at).toISOString().slice(0, 10)} … ${new Date(c.msgs.at(-1).at).toISOString().slice(0, 10)}`);
if (plan.length > 15) console.log(`  … va yana ${plan.length - 15} ta`);
if (!args.includes('--yes')) { console.log('\nYuklash uchun --yes qo‘shing.'); process.exit(0); }
const r = applyImport(acct, plan);
console.log(`\nYuklandi: ${plan.length} chat, ${r.added} yangi xabar (${r.dup} tasi avval bor edi). Panelda «Suhbatlar» bo‘limida ko‘rinadi.`);
db.close();
process.exit(0);
