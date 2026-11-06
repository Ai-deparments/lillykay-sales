#!/usr/bin/env node
/*
  Zaxiradan tiklash mashqi: nusxa haqiqatan ishlaydimi — ishlab turgan bazaga tegmasdan tekshiriladi.
    node scripts/tiklash-sinov.js [zaxira fayli]   (ko‘rsatilmasa — eng so‘nggisi)
  Tekshiriladi: butunlik, sxema versiyasi (migratsiya kerak bo‘lsa — o‘tadimi), asosiy jadvallar,
  xodim parollari va BILLZ bog‘lanishi joyidami. Nusxa vaqtinchalik papkaga ochiladi, keyin o‘chiriladi.
*/
import { copyFileSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dataDir = process.env.DATA_DIR || '/opt/sales/data';
const dir = join(dataDir, 'backups');
const arg = process.argv[2];
const file = arg || (() => {
  const fs = readdirSync(dir).filter(f => /^sales-.*\.db$/.test(f)).sort();
  if (!fs.length) { console.error('zaxira topilmadi:', dir); process.exit(1); }
  return join(dir, fs[fs.length - 1]);
})();

const work = mkdtempSync(join(tmpdir(), 'tiklash-'));
const copy = join(work, 'app.db');
copyFileSync(file, copy);
console.log(`Zaxira: ${file} · ${(statSync(file).size / 1048576).toFixed(1)} MB`);

const fail = [];
const check = (name, ok, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); if (!ok) fail.push(name); };

{ // 1) fayl butunmi
  const db = new DatabaseSync(copy, { readOnly: true });
  check('butunlik (integrity_check)', db.prepare('PRAGMA integrity_check').get().integrity_check === 'ok');
  const v = db.prepare('PRAGMA user_version').get().user_version;
  console.log(`  sxema versiyasi: ${v}`);
  db.close();
}

// 2) joriy kod shu nusxa bilan ishlay oladimi (kerak bo‘lsa migratsiya o‘tadi)
process.env.DB_FILE = copy;
process.env.DATA_DIR = work;
process.env.TG_DISABLED = '1';
const { migrate, one } = await import('../src/db.js');
let migrated = true;
try { migrate(); } catch (e) { migrated = false; console.error('  migratsiya xatosi:', e.message); }
check('joriy kod uchun migratsiya', migrated);

// 3) ma’lumot joyidami
const n = t => one(`SELECT count(*) c FROM ${t}`).c;
const rows = { xodimlar: n('users'), filiallar: n('branches'), tovarlar: n('products'), mijozlar: n('customers'), xaridlar: n('purchases'), suhbatlar: n('conversations'), xabarlar: n('messages') };
console.log('  ' + Object.entries(rows).map(([k, v]) => `${k}: ${v}`).join(' · '));
check('xodimlar va filiallar bor', rows.xodimlar > 0 && rows.filiallar > 0);
check('parollar saqlangan', one(`SELECT count(*) c FROM users WHERE pass_hash LIKE 's1$%'`).c > 0, `${one(`SELECT count(*) c FROM users WHERE pass_hash LIKE 's1$%'`).c} ta xodim kira oladi`);
if (rows.tovarlar) {
  const billz = one(`SELECT count(*) c FROM products WHERE billz_id IS NOT NULL`).c;
  check('BILLZ tovarlari bog‘langan', billz > 0, `${billz} ta`);
  const price = one(`SELECT count(*) c FROM products WHERE price>0`).c;
  check('narxlar joyida', price > 0, `${price} ta tovarda narx bor`);
}
if (rows.xaridlar) {
  const sum = one(`SELECT round(sum(CASE WHEN kind='return' THEN -amount ELSE amount END),2) s, min(sold_at) a, max(sold_at) b FROM purchases`);
  check('xaridlar summasi o‘qiladi', sum.s != null,
    `${sum.s} · ${new Date(sum.a).toISOString().slice(0, 10)} … ${new Date(sum.b).toISOString().slice(0, 10)}`);
}
rmSync(work, { recursive: true, force: true });
console.log(fail.length ? `\nXATO: ${fail.length} ta tekshiruv o‘tmadi (${fail.join(', ')})` : '\nTiklash mashqi: zaxiradan to‘liq ishlaydigan baza chiqadi.');
process.exit(fail.length ? 1 : 0);
