#!/usr/bin/env node
/*
  Import qilingan (paroli hech kimga berilmagan) xodimlarning tasodifiy parolini olib tashlaydi:
  shundan keyin ular panelda «parol berilmagan» deb ko‘rinadi va rahbar kimga parol berish kerakligini biladi.
    node scripts/parol-holati.js         — ko‘rsatadi
    node scripts/parol-holati.js --yes   — tozalaydi
  Paneldan parol olgan yoki o‘zi almashtirgan xodimga tegilmaydi.
*/
import { all, run } from '../src/db.js';
import { audit } from '../src/core/audit.js';

const imported = new Set(all(`SELECT action FROM audit WHERE actor='Tizim (BILLZ import)' AND action LIKE 'Xodim qo‘shildi:%'`)
  .map(r => (r.action.match(/\(([a-z0-9._-]+)\)\s*$/) || [])[1]).filter(Boolean));
const issued = new Set(all(`SELECT action FROM audit WHERE action LIKE '%parol yangilandi%' OR action LIKE 'Parolini o‘zgartirdi%' OR action LIKE 'Sinov hisobi:%'`)
  .flatMap(r => [...r.action.matchAll(/([a-z0-9._-]{3,32})/g)].map(m => m[1])));

const rows = all(`SELECT id,login,name FROM users WHERE pass_hash IS NOT NULL`)
  .filter(u => imported.has(u.login) && !issued.has(u.login));

if (!rows.length) { console.log('Tozalash kerak bo‘lgan xodim yo‘q.'); process.exit(0); }
console.log('Parol hech kimga berilmagan (tasodifiy parol o‘chiriladi):');
for (const u of rows) console.log(`  ${u.name.padEnd(28)} ${u.login}`);
if (!process.argv.includes('--yes')) { console.log(`\n${rows.length} ta. Tozalash uchun --yes qo‘shing.`); process.exit(0); }
for (const u of rows) {
  run('UPDATE users SET pass_hash=NULL WHERE id=?', u.id);
  run('DELETE FROM sessions WHERE user_id=?', u.id);
}
audit('sys', 'Tizim', `Parol berilmagan xodimlar belgilandi: ${rows.length} ta`, { result: rows.map(u => u.login).join(', ') });
console.log(`\n${rows.length} ta xodim endi «parol berilmagan» holatida. Rahbar: Xodimlar → Tahrirlash → «yangi parol yaratish».`);
process.exit(0);
