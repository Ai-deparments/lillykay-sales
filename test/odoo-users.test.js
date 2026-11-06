/*
  Odoo foydalanuvchisi ↔ panel xodimi bog‘lami — haqiqiy HTTP qatlamidan (src/web.js).
  Tekshiriladi: ro‘yxat Odoo foydalanuvchilari va ism bo‘yicha taxminlar bilan keladi (faqat yagona mosliklar); bog‘lash, olib tashlash;
  bo‘lmagan Odoo foydalanuvchisi — 400; bitta Odoo foydalanuvchisi ikki xodimga — 409; sotuvchiga ruxsat yo‘q (403);
  avtomatik bog‘lash faqat aniq taxminlarni oladi; Nazorat va lid kartasi aniq bog‘lamni ismdan ustun qo‘yadi; o‘chirilgan xodim bog‘lamni bo‘shatadi.
*/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const dir = mkdtempSync(join(tmpdir(), 'sales-odoousr-'));
Object.assign(process.env, { DB_FILE: join(dir, 't.db'), DATA_DIR: dir, TG_DISABLED: '1', DRAFT_DEBOUNCE_MS: '999999' });
const { migrate, run, one } = await import('../src/db.js');
const { hashPassword } = await import('../src/core/auth.js');
const { handle } = await import('../src/web.js');
const { staffForOdooUser } = await import('../src/services/nazorat.js');
const { leadDetail } = await import('../src/services/voronka.js');

const t = Date.now();
let base, server;
const ids = {};
const user = (login, name, role) => run('INSERT INTO users(login,name,role,pass_hash,created_at) VALUES(?,?,?,?,?)', login, name, role, hashPassword('parol12345'), t).lastInsertRowid;
const lead = (id, userId) => run('INSERT INTO odoo_leads(id,name,stage_id,team_id,user_id,active,created_at,stage_at,updated_at) VALUES(?,?,2,12,?,1,?,?,?)', id, `Lid ${id}`, userId, t, t, t);

before(async () => {
  migrate();
  ids.rahbar = user('r', 'Rahbar', 'rahbar');
  ids.admin = user('ad', 'Admin', 'admin');
  ids.shahzoda = user('sh', 'Shahzoda', 'sotuvchi');
  ids.nodir = user('nd', 'Nodir', 'sotuvchi');
  ids.aziz = user('az', 'Aziz', 'sotuvchi');          // Odoo’da ikkita «Aziz» — taxmin berilmaydi
  ids.sel = user('sa', 'Sotuvchi A', 'sotuvchi');
  run(`INSERT INTO odoo_users(id,name) VALUES(86,'Shahzoda'),(183,'Nodir'),(189,'Aziz'),(190,'aziz'),(9,'Nurmuhammad')`);
  run(`INSERT INTO odoo_teams(id,name) VALUES(12,'Savdo')`);
  run(`INSERT INTO odoo_stages(id,name,sequence,is_won) VALUES(2,'Ўчрашув',2,0)`);
  lead(1, 86); lead(2, 183);
  server = createServer(handle);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

async function session(login) {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password: 'parol12345' }) });
  assert.equal(r.status, 200, `${login} kira olmadi`);
  const cookie = (r.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
  const call = async (path, opts = {}) => {
    const res = await fetch(base + path, { ...opts, headers: { cookie, ...(opts.body ? { 'content-type': 'application/json' } : {}) } });
    let body = null; try { body = await res.json(); } catch { /* bo‘sh */ }
    return { status: res.status, body };
  };
  return { get: p => call(p), post: (p, b = {}) => call(p, { method: 'POST', body: JSON.stringify(b) }) };
}

test('ro‘yxat: Odoo foydalanuvchilari lid soni bilan va faqat yagona ism mosliklari taxmin sifatida', async () => {
  const boss = await session('r');
  const r = await boss.get('/api/users');
  assert.equal(r.status, 200);
  const odoo = r.body.odoo;
  assert.equal(odoo.users.find(x => x.id === 86).leads, 1);
  assert.deepEqual(odoo.suggestions, { [ids.shahzoda]: 86, [ids.nodir]: 183 }, 'Aziz — Odoo’da ikkita, Sotuvchi A — yo‘q');
  assert.equal(r.body.items.find(x => x.id === ids.shahzoda).odoo_user_id, null);
  assert.equal((await (await session('sa')).get('/api/users')).status, 403, 'sotuvchi ko‘rmaydi');
});

test('bog‘lash va olib tashlash; bo‘lmagan foydalanuvchi — 400; band foydalanuvchi — 409; sotuvchiga 403', async () => {
  const boss = await session('r'), sel = await session('sa');
  assert.equal((await sel.post(`/api/users/${ids.shahzoda}/odoo`, { odoo_user_id: 86 })).status, 403);
  const ok = await boss.post(`/api/users/${ids.shahzoda}/odoo`, { odoo_user_id: 86 });
  assert.equal(ok.status, 200); assert.equal(ok.body.odoo_name, 'Shahzoda');
  assert.equal(one('SELECT odoo_user_id FROM users WHERE id=?', ids.shahzoda).odoo_user_id, 86);
  const taken = await boss.post(`/api/users/${ids.nodir}/odoo`, { odoo_user_id: 86 });
  assert.equal(taken.status, 409); assert.equal(taken.body.error, 'odoo_taken');
  assert.equal((await boss.post(`/api/users/${ids.nodir}/odoo`, { odoo_user_id: 99999 })).status, 400);
  assert.equal((await boss.post(`/api/users/${ids.nodir}/odoo`, { odoo_user_id: 'abc' })).status, 400);
  assert.equal((await boss.post(`/api/users/${ids.nodir}/odoo`, { odoo_user_id: true })).status, 400, 'true → 1 emas');
  assert.equal((await boss.post(`/api/users/${ids.nodir}/odoo`, { odoo_user_id: 1.5 })).status, 400);
  assert.equal((await boss.post('/api/users/99999/odoo', { odoo_user_id: 183 })).status, 404);
  assert.equal((await boss.post(`/api/users/${ids.admin}/odoo`, { odoo_user_id: 183 })).status, 403, 'rahbar admin bog‘lamini o‘zgartira olmaydi');
  assert.equal((await (await session('ad')).post(`/api/users/${ids.admin}/odoo`, { odoo_user_id: null })).status, 200, 'admin o‘zinikini — mumkin');
  assert.equal((await boss.post(`/api/users/${ids.shahzoda}/odoo`, { odoo_user_id: 86 })).status, 200, 'o‘ziga qayta — xato emas');
  const off = await boss.post(`/api/users/${ids.shahzoda}/odoo`, { odoo_user_id: null });
  assert.equal(off.status, 200); assert.equal(off.body.odoo_user_id, null);
  assert.equal(one('SELECT odoo_user_id FROM users WHERE id=?', ids.shahzoda).odoo_user_id, null);
  assert.equal((await boss.get('/api/users')).body.odoo.suggestions[ids.shahzoda], 86, 'bog‘lam olingach taxmin qaytadi');
});

test('avtomatik bog‘lash — faqat aniq taxminlar; faol bo‘lmagan xodimning bog‘lami ham band; keyin taxmin qolmaydi', async () => {
  const boss = await session('r');
  // Ishdan chiqqan (active=0) «Karim» Odoo 300 ga bog‘langan — yangi faol «Karim» ga shu foydalanuvchi taklif qilinmaydi (bo‘lmasa automatch 409 bilan yiqilardi)
  run(`INSERT INTO odoo_users(id,name) VALUES(300,'Karim')`);
  ids.karimOld = user('k1', 'Karim', 'sotuvchi'); run('UPDATE users SET active=0, odoo_user_id=300 WHERE id=?', ids.karimOld);
  ids.karim = user('k2', 'Karim', 'sotuvchi');
  assert.equal((await boss.get('/api/users')).body.odoo.suggestions[ids.karim], undefined, 'band Odoo foydalanuvchisi taklif qilinmaydi');
  const r = await boss.post('/api/users/odoo-automatch', {});
  assert.equal(r.status, 200); assert.equal(r.body.bound, 2);
  assert.deepEqual(r.body.names.sort(), ['Nodir', 'Shahzoda']);
  assert.equal(one('SELECT odoo_user_id FROM users WHERE id=?', ids.aziz).odoo_user_id, null, 'ikki xil «Aziz» — bog‘lanmadi');
  const list = await boss.get('/api/users');
  assert.deepEqual(list.body.odoo.suggestions, {});
  assert.equal(list.body.items.find(x => x.id === ids.nodir).odoo_name, 'Nodir');
  assert.equal((await boss.post('/api/users/odoo-automatch', {})).body.bound, 0, 'ikkinchi marta — hech narsa');
});

test('aniq bog‘lam ismdan ustun: Nazorat va lid kartasi; o‘chirilgan xodim bog‘lamni bo‘shatadi', async () => {
  const boss = await session('r');
  // Odoo’dagi «Nurmuhammad» (9) ni paneldagi «Sotuvchi A» ga bog‘laymiz — ism boshqa bo‘lsa ham aniq bog‘lam ishlaydi
  assert.equal((await boss.post(`/api/users/${ids.sel}/odoo`, { odoo_user_id: 9 })).status, 200);
  const s = staffForOdooUser(9);
  assert.equal(s.id, ids.sel); assert.equal(s.how, 'id');
  assert.equal(staffForOdooUser(86).how, 'id', 'Shahzoda — avtomatik bog‘langan');
  // Ism bo‘yicha zaxira: bog‘lanmagan xodim uchun ishlaydi; allaqachon bog‘langan xodim boshqa Odoo foydalanuvchisiga «ism bo‘yicha» berilmaydi
  run(`INSERT INTO odoo_users(id,name) VALUES(500,'Sotuvchi A'),(501,'Rahbar')`);
  assert.equal(staffForOdooUser(500), null, 'Sotuvchi A allaqachon 9 ga bog‘langan');
  assert.equal(staffForOdooUser(501).how, 'name');
  assert.equal(staffForOdooUser(null), null);
  assert.equal(staffForOdooUser(777), null, 'bo‘lmagan Odoo foydalanuvchisi');
  // Kirill ism: katta-kichik harf va ortiqcha bo‘shliq farq qilmaydi (SQLite lower() emas, JS)
  run(`INSERT INTO odoo_users(id,name) VALUES(502,'Машхура  Бахтиёрова')`);
  ids.mash = user('mb', 'машхура бахтиёрова', 'sotuvchi');
  assert.equal(staffForOdooUser(502)?.id, ids.mash);
  // Indeks: bindOdoo’ni chetlab ikkinchi faol xodimga o‘sha Odoo foydalanuvchisini yozib bo‘lmaydi
  assert.throws(() => run('UPDATE users SET odoo_user_id=9 WHERE id=?', ids.shahzoda), /UNIQUE/);
  lead(3, 9);
  assert.deepEqual(leadDetail(3).staff, { name: 'Sotuvchi A', linked: false, how: 'id' });
  assert.equal((await boss.post(`/api/users/${ids.sel}/delete`, {})).status, 200);
  assert.equal(one('SELECT odoo_user_id FROM users WHERE id=?', ids.sel).odoo_user_id, null);
  assert.equal(staffForOdooUser(9), null);
});
