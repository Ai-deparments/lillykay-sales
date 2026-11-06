/*
  Odoo menejerini panelga taklif qilish va Telegram ulash — haqiqiy HTTP qatlamidan (src/web.js).
  Tekshiriladi: /api/users dagi Odoo ro‘yxatida telefon → login, staff_id / invite_id; taklif odoo_user_id bilan (band → 409, ochiq taklif → invite_exists);
  bir yo‘la taklif — har biriga alohida natija (telefonsiz — bad_phone, qolganlari to‘xtamaydi); taklif qabul qilinganda hisob Odoo’ga bog‘lanadi
  va Telegram havolasi (7 kun) qaytadi; bog‘lam oraliqda band bo‘lib qolsa — hisob bog‘lamsiz ochiladi; parol almashtirishda ham Telegram havolasi (ulanmaganga).
*/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const dir = mkdtempSync(join(tmpdir(), 'sales-odooinv-'));
Object.assign(process.env, { DB_FILE: join(dir, 't.db'), DATA_DIR: dir, TG_DISABLED: '1', DRAFT_DEBOUNCE_MS: '999999' });
const { migrate, run, one, all, kvSet } = await import('../src/db.js');
const { hashPassword } = await import('../src/core/auth.js');
const { handle } = await import('../src/web.js');

const t = Date.now(), DAY = 864e5;
let base, server;
const ids = {};
const user = (login, name, role) => run('INSERT INTO users(login,name,role,pass_hash,created_at) VALUES(?,?,?,?,?)', login, name, role, hashPassword('parol12345'), t).lastInsertRowid;

before(async () => {
  migrate();
  kvSet('tg_bot_username', 'sun_test_bot');   // botUsername() shu yerdan o‘qiydi (bot ishga tushmagan)
  ids.rahbar = user('r', 'Rahbar', 'rahbar');
  ids.old = user('998901111111', 'Nodir', 'sotuvchi'); run('UPDATE users SET odoo_user_id=183 WHERE id=?', ids.old);
  run(`INSERT INTO odoo_users(id,name,phone) VALUES(86,'Shahzoda','+998 90 123 45 67'),(183,'Nodir','901111111'),(21,'Nomozbek',NULL),(9,'Nurmuhammad','kmjhgf'),(31,'CEO','95-250-88-44')`);
  run(`INSERT INTO odoo_teams(id,name) VALUES(12,'Savdo')`);
  run(`INSERT INTO odoo_stages(id,name,sequence,is_won) VALUES(2,'Ўчрашув',2,0)`);
  for (const [id, uid] of [[1, 86], [2, 86], [3, 21], [4, 183]]) run('INSERT INTO odoo_leads(id,name,stage_id,team_id,user_id,active,created_at,stage_at,updated_at) VALUES(?,?,2,12,?,1,?,?,?)', id, `Lid ${id}`, uid, t, t, t);
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
/* Kirishsiz: taklif qabul qilish (xodim o‘zi parol qo‘yadi) */
async function accept(k, password = 'yangiparol1') {
  const r = await fetch(`${base}/api/invite/accept`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ k, password }) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const tokenOf = inviteId => one('SELECT token FROM invites WHERE id=?', inviteId).token;

test('ro‘yxat: telefon → login (9 raqam → 998…, harfli → yo‘q), bog‘langan menejer staff_id bilan', async () => {
  const boss = await session('r');
  const users = (await boss.get('/api/users')).body.odoo.users;
  const by = id => users.find(x => x.id === id);
  assert.equal(by(86).login, '998901234567'); assert.equal(by(86).phone, '+998 90 123 45 67');
  assert.equal(by(31).login, '998952508844', '95-250-88-44 → 998952508844');
  assert.equal(by(9).login, null, 'harfli «telefon» — login emas');
  assert.equal(by(21).login, null); assert.equal(by(21).phone, null);
  assert.equal(by(183).staff_id, ids.old); assert.equal(by(86).staff_id, null); assert.equal(by(86).invite_id, null);
  assert.equal(by(86).leads, 2);
});

test('taklif odoo_user_id bilan: band menejer — 409; ikkinchi ochiq taklif — invite_exists; ro‘yxatda invite_id chiqadi', async () => {
  const boss = await session('r');
  assert.equal((await boss.post('/api/invites', { name: 'Nodir 2', role: 'sotuvchi', phone: '998902222222', odoo_user_id: 183 })).status, 409);
  assert.equal((await boss.post('/api/invites', { name: 'X', role: 'sotuvchi', phone: '998902222222', odoo_user_id: 777 })).status, 400);
  const r = await boss.post('/api/invites', { name: 'Shahzoda', role: 'sotuvchi', phone: '+998 90 123 45 67', odoo_user_id: 86, days: 7 });
  assert.equal(r.status, 200); assert.equal(r.body.login, '998901234567'); assert.match(r.body.link, /\/taklif\?k=/);
  ids.invShahzoda = r.body.id;
  const again = await boss.post('/api/invites', { name: 'Shahzoda', role: 'sotuvchi', phone: '998903333333', odoo_user_id: 86 });
  assert.equal(again.status, 400); assert.equal(again.body.error, 'invite_exists', 'bitta menejerga ikki ochiq taklif bo‘lmaydi');
  const list = await boss.get('/api/users');
  assert.equal(list.body.odoo.users.find(x => x.id === 86).invite_id, ids.invShahzoda);
  const inv = (await boss.get('/api/invites')).body.items.find(i => i.id === ids.invShahzoda);
  assert.equal(inv.odoo_user_id, 86); assert.equal(inv.odoo_name, 'Shahzoda');
});

test('bir yo‘la taklif: telefonsiz / band / ochiq taklifli — xato kodi bilan, qolganlari yaratiladi', async () => {
  const boss = await session('r');
  const r = await boss.post('/api/invites/odoo-bulk', { ids: [21, 9, 31, 183, 86, 'abc', 31] });
  assert.equal(r.status, 200);
  const by = id => r.body.items.find(x => x.odoo_user_id === id);
  assert.equal(by(21).error, 'bad_phone', 'telefon yo‘q');
  assert.equal(by(9).error, 'bad_phone', 'telefon harfli');
  assert.equal(by(183).error, 'odoo_taken');
  assert.equal(by(86).error, 'invite_exists');
  assert.equal(by(31).error, null); assert.equal(by(31).login, '998952508844'); assert.match(by(31).link, /\/taklif\?k=/);
  assert.equal(r.body.items.length, 5, 'takror va noto‘g‘ri id tashlanadi');
  assert.equal(r.body.created, 1);
  assert.equal((await (await session('r')).post('/api/invites/odoo-bulk', { ids: [] })).body.created, 0);
});

test('qabul qilish: hisob Odoo’ga bog‘lanadi, Telegram havolasi 7 kun; bog‘lam oraliqda band bo‘lsa — bog‘lamsiz', async () => {
  const r = await accept(tokenOf(ids.invShahzoda));
  assert.equal(r.status, 200);
  assert.match(r.body.telegram, /^https:\/\/t\.me\/sun_test_bot\?start=link_[A-Za-z0-9]+$/);
  const u = one('SELECT * FROM users WHERE login=?', '998901234567');
  assert.equal(u.odoo_user_id, 86); assert.equal(u.role, 'sotuvchi'); assert.equal(u.name, 'Shahzoda');
  const code = r.body.telegram.split('link_')[1];
  const tl = one('SELECT * FROM tg_links WHERE code=?', code);
  assert.equal(tl.user_id, u.id); assert.ok(tl.expires_at > Date.now() + 6 * DAY && tl.expires_at <= Date.now() + 7 * DAY + 1000, '7 kun');
  // Oraliqda bog‘lanib qolgan: CEO (31) taklifi bor, lekin rahbar 31 ni boshqa xodimga qo‘lda bog‘lab qo‘ydi
  const boss = await session('r');
  const inv31 = one('SELECT id FROM invites WHERE odoo_user_id=31 AND used_at IS NULL');
  assert.equal((await boss.post(`/api/users/${ids.old}/odoo`, { odoo_user_id: 31 })).status, 200);
  const r2 = await accept(tokenOf(inv31.id));
  assert.equal(r2.status, 200);
  assert.equal(one('SELECT odoo_user_id FROM users WHERE login=?', '998952508844').odoo_user_id, null, 'band bo‘lgani uchun bog‘lamsiz ochildi');
  assert.equal(all('SELECT id FROM users WHERE odoo_user_id=31 AND deleted_at IS NULL').length, 1);
});

test('parol almashtirish havolasi: Telegram ulanmagan xodimga havola qaytadi, ulanganga — yo‘q', async () => {
  const boss = await session('r');
  const link = await boss.post(`/api/users/${ids.old}/reset-link`, {});
  assert.equal(link.status, 200);
  const r = await accept(link.body.link.split('k=')[1], 'boshqaparol2');
  assert.equal(r.status, 200); assert.match(r.body.telegram, /start=link_/);
  run('UPDATE users SET tg_user_id=5, tg_chat_id=5 WHERE id=?', ids.old);
  const link2 = await (await session('r')).post(`/api/users/${ids.old}/reset-link`, {});
  const r2 = await accept(link2.body.link.split('k=')[1], 'boshqaparol3');
  assert.equal(r2.status, 200); assert.equal(r2.body.telegram, null, 'allaqachon ulangan');
});
