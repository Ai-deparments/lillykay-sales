/*
  Rollarni sinash uchun vaqtinchalik hisoblar. Parol shu yerda bir marta chiqadi.
    node scripts/sinov-hisob.js          — yaratadi (yoki parolini yangilaydi)
    node scripts/sinov-hisob.js --ochir  — hisoblarni butunlay o‘chiradi
*/
import { one, run } from '../src/db.js';
import { now } from '../src/util.js';
import { hashPassword } from '../src/core/auth.js';
import { audit } from '../src/core/audit.js';
import { randomBytes } from 'node:crypto';

const pw = () => { const A = 'abcdefghijkmnpqrstuvwxyz23456789'; return [...randomBytes(12)].map(b => A[b % A.length]).join(''); };
const branch = one(`SELECT id, name FROM branches WHERE kind='dokon' ORDER BY id LIMIT 1`);
const list = [
  { login: 'sinov.rahbar', name: 'Sinov — sotuv rahbari', role: 'rahbar', branch_id: null },
  { login: 'sinov.filial', name: 'Sinov — filial rahbari', role: 'filial', branch_id: branch?.id ?? null },
  { login: 'sinov.sotuvchi', name: 'Sinov — sotuvchi', role: 'sotuvchi', branch_id: branch?.id ?? null }
];
/* O‘chirish: seanslar, vazifalar bog‘lanishi va hisobning o‘zi. Haqiqiy xodimga tegilmaydi — faqat sinov.* loginlari. */
if (process.argv.includes('--ochir')) {
  let n = 0;
  for (const u of list) {
    const cur = one('SELECT id, name FROM users WHERE login=?', u.login);
    if (!cur) { console.log(`${u.login.padEnd(15)} — yo‘q`); continue; }
    run('DELETE FROM sessions WHERE user_id=?', cur.id);
    run('UPDATE tasks SET user_id=NULL WHERE user_id=?', cur.id);
    run('UPDATE conversations SET owner_user_id=NULL WHERE owner_user_id=?', cur.id);
    run('UPDATE conversations SET taken_by=NULL WHERE taken_by=?', cur.id);
    run('UPDATE users SET backup_user_id=NULL WHERE backup_user_id=?', cur.id);
    run('DELETE FROM tg_links WHERE user_id=?', cur.id);
    run('UPDATE accounts SET owner_user_id=NULL WHERE owner_user_id=?', cur.id);
    run('UPDATE messages SET user_id=NULL WHERE user_id=?', cur.id);
    run('DELETE FROM insights WHERE user_id=?', cur.id);
    run('DELETE FROM users WHERE id=?', cur.id);
    audit('staff', 'Behruz Tojimurodov', `Sinov hisobi o‘chirildi: ${u.login}`, { result: 'Rollar tekshiruvi yakunlandi' });
    console.log(`${u.login.padEnd(15)} — o‘chirildi`); n++;
  }
  console.log(`\nJami ${n} ta sinov hisobi o‘chirildi.`);
  process.exit(0);
}

for (const u of list) {
  const p = pw();
  const cur = one('SELECT id FROM users WHERE login=?', u.login);
  if (cur) { run('UPDATE users SET name=?, role=?, branch_id=?, pass_hash=?, active=1 WHERE id=?', u.name, u.role, u.branch_id, hashPassword(p), cur.id); run('DELETE FROM sessions WHERE user_id=?', cur.id); }
  else run('INSERT INTO users(login,name,role,branch_id,pass_hash,active,created_at) VALUES(?,?,?,?,?,1,?)', u.login, u.name, u.role, u.branch_id, hashPassword(p), now());
  audit('staff', 'Behruz Tojimurodov', `Sinov hisobi: ${u.login} (${u.role})`, { result: 'Sinovdan keyin o‘chiriladi' });
  console.log(`${u.role.padEnd(9)} | login: ${u.login.padEnd(15)} | parol: ${p} | ${u.name}${u.branch_id ? ' · ' + branch.name : ''}`);
}
process.exit(0);
