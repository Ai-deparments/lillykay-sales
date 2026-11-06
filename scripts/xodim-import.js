#!/usr/bin/env node
/*
  BILLZ’dagi xodimlarni panelga qo‘shish. Parol chiqarilmaydi va hech qayerga yozilmaydi:
  har bir xodimga parolni rahbar paneldan yaratadi (Xodimlar → Tahrirlash → «yangi parol yaratish»), u bir marta ko‘rinadi.
    node scripts/xodim-import.js            — kim qo‘shilishini ko‘rsatadi
    node scripts/xodim-import.js --yes      — qo‘shadi (rol: sotuvchi, filial: eng ko‘p sotgan magazin)
*/
import { all, one, run } from '../src/db.js';
import { now } from '../src/util.js';
import { audit } from '../src/core/audit.js';

const TR = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'yo',ж:'j',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'x',ц:'ts',ч:'ch',ш:'sh',щ:'sh',ъ:'',ы:'i',ь:'',э:'e',ю:'yu',я:'ya',ў:'o',қ:'q',ғ:'g',ҳ:'h' };
const latin = s => String(s||'').toLowerCase().split('').map(c => TR[c] ?? c).join('').replace(/[‘’'`ʻʼ]/g,'').replace(/[^a-z0-9]/g,'');
function suggestLogin(name) {
  const [a='', b=''] = String(name).trim().split(/\s+/);
  const base = (latin(a) + (b ? '.' + latin(b).slice(0,1) : '')).slice(0,28) || 'xodim';
  let login = base.length >= 3 ? base : base + 'xx', i = 1;
  while (one('SELECT 1 FROM users WHERE login=?', login)) login = `${base}${++i}`;
  return login;
}
const key = n => String(n||'').trim().toLowerCase();
const have = new Set(all('SELECT name FROM users').map(r => key(r.name)));
const since = now() - 90 * 864e5;
const rows = all(`SELECT seller_name n, branch_name b, count(DISTINCT receipt) c FROM purchases WHERE is_demo=0 AND kind='sale' AND seller_name IS NOT NULL AND sold_at>? GROUP BY seller_name, branch_name`, since);
const sales = new Map();
for (const r of rows) { const k = key(r.n), cur = sales.get(k) || { name: r.n.trim(), checks: 0, top: null, topC: 0 }; cur.checks += r.c; if (r.c > cur.topC && r.b) { cur.top = r.b; cur.topC = r.c; } sales.set(k, cur); }
const staff = JSON.parse(one('SELECT v FROM kv WHERE k=?', 'billz_staff')?.v || '[]');
const names = new Map(staff.map(s => [key(s.name), s]));
for (const [k, v] of sales) if (!names.has(k)) names.set(k, { name: v.name, shops: [] });
const list = [...names.values()].filter(s => !have.has(key(s.name))).map(s => {
  const sl = sales.get(key(s.name));
  const shop = sl?.top || (s.shops || []).find(n => one(`SELECT 1 FROM branches WHERE name=? AND kind='dokon'`, n)) || null;
  return { name: s.name, checks: sl?.checks || 0, branch: shop, branch_id: shop ? one('SELECT id FROM branches WHERE name=?', shop)?.id ?? null : null, login: suggestLogin(s.name) };
}).sort((a, b) => b.checks - a.checks);

if (!list.length) { console.log('Qo‘shiladigan xodim yo‘q (hammasi panelda bor).'); process.exit(0); }
console.log('Ism'.padEnd(26), 'Login'.padEnd(16), 'Filial'.padEnd(20), '90 kunlik chek');
for (const x of list) console.log(x.name.padEnd(26), x.login.padEnd(16), String(x.branch || '—').padEnd(20), x.checks);
if (!process.argv.includes('--yes')) { console.log(`\n${list.length} ta xodim. Qo‘shish uchun --yes qo‘shing. Parol chiqarilmaydi — uni rahbar paneldan yaratadi.`); process.exit(0); }
for (const x of list) {
  // Parol qo‘yilmaydi (pass_hash NULL) — xodim kira olmaydi va panelda «parol berilmagan» deb ko‘rinadi
  run('INSERT INTO users(login,name,role,branch_id,active,created_at) VALUES(?,?,?,?,1,?)', x.login, x.name, 'sotuvchi', x.branch_id, now());
  audit('staff', 'Tizim (BILLZ import)', `Xodim qo‘shildi: ${x.name} (${x.login})`, { result: 'Parol paneldan yaratiladi' });
}
console.log(`\n${list.length} ta xodim qo‘shildi. Endi panel → «Xodimlar va filiallar» → har biriga «Tahrirlash» → «yangi parol yaratish»: parol bir marta ko‘rinadi, xodimga bering.`);
process.exit(0);
