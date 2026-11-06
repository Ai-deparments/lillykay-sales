#!/usr/bin/env node
/* SQLite zaxira nusxa: VACUUM INTO (ishlab turgan baza bilan xavfsiz). Oxirgi 14 kun saqlanadi. */
import { mkdirSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../src/config.js';
import { db, kvSet } from '../src/db.js';

const dir = join(config.dataDir, 'backups');
mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
const file = join(dir, `sales-${stamp}.db`);
db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
// Nusxa haqiqatan ochiladimi va butunmi — tiklash paytida bilib qolmaslik uchun shu yerda tekshiriladi
const chk = new DatabaseSync(file, { readOnly: true });
const ok = chk.prepare('PRAGMA integrity_check').get().integrity_check;
const rows = chk.prepare('SELECT (SELECT count(*) FROM purchases) x, (SELECT count(*) FROM products) p, (SELECT count(*) FROM messages) m').get();
chk.close();
if (ok !== 'ok') { console.error(`zaxira BUZUQ: ${file} — ${ok}`); process.exit(1); }
const keep = readdirSync(dir).filter(f => /^sales-.*\.db$/.test(f)).sort().reverse();
for (const f of keep.slice(14)) unlinkSync(join(dir, f));
kvSet('backup_at', Date.now());
kvSet('backup_info', `${(statSync(file).size / 1048576).toFixed(1)} MB · ${rows.p} tovar, ${rows.x} xarid qatori, ${rows.m} xabar`);
console.log(`zaxira: ${file} · ${ok} · ${rows.p} tovar, ${rows.x} xarid qatori, ${rows.m} xabar (jami ${Math.min(keep.length, 14)} ta)`);
