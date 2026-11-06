#!/usr/bin/env node
/*
  Xodim yaratish yoki parolni o‘rnatish (serverda, konsoldan).
    node scripts/user.js <login> <rol> "<Ism>"      — parol yashirin so‘raladi
  Rol: admin | rahbar | filial | sotuvchi
*/
import { createInterface } from 'node:readline';
import { migrate, one, run } from '../src/db.js';
import { hashPassword } from '../src/core/auth.js';

const [login, role, ...nameParts] = process.argv.slice(2);
const name = nameParts.join(' ').trim();
if (!login || !['admin', 'rahbar', 'filial', 'sotuvchi'].includes(role) || !name) {
  console.error('Foydalanish: node scripts/user.js <login> <admin|rahbar|filial|sotuvchi> "<Ism>"');
  process.exit(1);
}

function askHidden(q) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (s.includes(q)) rl.output.write(s); };
    rl.question(q, a => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}

migrate();
const pw = await askHidden('Parol (kamida 8 belgi): ');
if (pw.length < 8) { console.error('Parol juda qisqa.'); process.exit(1); }
const again = await askHidden('Parolni takrorlang: ');
if (again !== pw) { console.error('Parollar mos emas.'); process.exit(1); }

const l = login.toLowerCase();
const cur = one('SELECT id FROM users WHERE login=?', l);
if (cur) {
  run('UPDATE users SET pass_hash=?, role=?, name=?, active=1 WHERE id=?', hashPassword(pw), role, name, cur.id);
  run('DELETE FROM sessions WHERE user_id=?', cur.id);
  console.log(`Yangilandi: ${l} (${role})`);
} else {
  run('INSERT INTO users(login,name,role,pass_hash,created_at) VALUES(?,?,?,?,?)', l, name, role, hashPassword(pw), Date.now());
  console.log(`Yaratildi: ${l} (${role})`);
}
