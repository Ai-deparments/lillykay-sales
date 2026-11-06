/*
  Rollar va ko‘rish doirasi: admin/rahbar — hammasi, filial rahbari — o‘z filiali, sotuvchi — o‘z ishi.
  Sinov haqiqiy HTTP qatlamidan o‘tadi (src/web.js): kirish, cookie, CSRF va har bir yo‘l shu yerda tekshiriladi.
*/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const dir = mkdtempSync(join(tmpdir(), 'sales-rol-'));
process.env.DB_FILE = join(dir, 't.db');
process.env.DATA_DIR = dir;
process.env.TG_DISABLED = '1';
process.env.DRAFT_DEBOUNCE_MS = '999999';

const { migrate, run, one } = await import('../src/db.js');
const { hashPassword } = await import('../src/core/auth.js');
const { handle } = await import('../src/web.js');

const t = Date.now(), DAY = 864e5;
/* Joriy oy ichidagi xavfsiz vaqt: oyning 1-kunida ham «bu oy» hisobiga tushadi (Toshkent +5) */
const inThisMonth = ts => {
  const l = new Date(Date.now() + 5 * 3600e3);
  const first = Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), 1) - 5 * 3600e3;
  return Math.max(ts, first + 7 * 3600e3);
};

let base, server;
const ids = {};

function user(login, name, role, branch_id) {
  return run('INSERT INTO users(login,name,role,branch_id,pass_hash,created_at) VALUES(?,?,?,?,?,?)',
    login, name, role, branch_id, hashPassword('parol12345'), t).lastInsertRowid;
}
function conv(account, branch_id, owner_user_id, name) {
  return run(`INSERT INTO conversations(account_id,ext_chat_id,display_name,branch_id,owner_user_id,last_msg_at,created_at) VALUES(?,?,?,?,?,?,?)`,
    account, `x${name}`, name, branch_id, owner_user_id, t, t).lastInsertRowid;
}
const buy = (branch, seller, amount, at) => run(`INSERT INTO purchases(receipt,line,product_name,qty,amount,branch_name,seller_name,sold_at,kind) VALUES(?,1,'Kamera',1,?,?,?,?,'sale')`,
  `R${Math.random().toString(36).slice(2, 9)}`, amount, branch, seller, at);

before(async () => {
  migrate();
  ids.bA = run(`INSERT INTO branches(name) VALUES('A filial')`).lastInsertRowid;
  ids.bB = run(`INSERT INTO branches(name) VALUES('B filial')`).lastInsertRowid;
  ids.rahbar = user('r', 'Rahbar', 'rahbar', null);
  ids.filA = user('fa', 'Filial A', 'filial', ids.bA);
  ids.selA = user('sa', 'Sotuvchi A', 'sotuvchi', ids.bA);
  ids.selB = user('sb', 'Sotuvchi B', 'sotuvchi', ids.bB);
  ids.acc = run(`INSERT INTO accounts(channel,ext_id,name,created_at) VALUES('demo','acc','Akkaunt',?)`, t).lastInsertRowid;
  ids.convA = conv(ids.acc, ids.bA, ids.selA, 'A mijozi');
  ids.convB = conv(ids.acc, ids.bB, ids.selB, 'B mijozi');
  ids.convFree = conv(ids.acc, null, null, 'Navbatdagi');
  // vazifalar: A sotuvchisiniki, B sotuvchisiniki va egasiz
  run(`INSERT INTO tasks(kind,conversation_id,user_id,title,due_at,created_by,created_at) VALUES('followup',?,?,'A vazifa',?,'test',?)`, ids.convA, ids.selA, t, t);
  run(`INSERT INTO tasks(kind,conversation_id,user_id,title,due_at,created_by,created_at) VALUES('followup',?,?,'B vazifa',?,'test',?)`, ids.convB, ids.selB, t, t);
  ids.cust = run(`INSERT INTO customers(name,phone,created_at) VALUES('Mijoz','+998901112233',?)`, t).lastInsertRowid;

  server = createServer(handle);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

/* Bitta xodimning seansi: cookie saqlanadi */
async function session(login) {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password: 'parol12345' }) });
  assert.equal(r.status, 200, `${login} kira olmadi`);
  const cookie = (r.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
  assert.ok(cookie.startsWith('sid='), 'seans cookie berilmadi');
  const call = async (path, opts = {}) => {
    const res = await fetch(base + path, { ...opts, headers: { cookie, ...(opts.body ? { 'content-type': 'application/json' } : {}), ...(opts.headers || {}) } });
    let body = null; try { body = await res.json(); } catch {}
    return { status: res.status, body };
  };
  return { get: p => call(p), post: (p, b = {}) => call(p, { method: 'POST', body: JSON.stringify(b) }) };
}

test('kirish: noto‘g‘ri parol rad etiladi, to‘g‘risi seans ochadi', async () => {
  const bad = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'sa', password: 'xato' }) });
  assert.equal(bad.status, 401);
  const noSession = await fetch(`${base}/api/bootstrap`);
  assert.equal(noSession.status, 401, 'seanssiz ma’lumot berilmaydi');
  const s = await session('sa');
  assert.equal((await s.get('/api/bootstrap')).body.me.role, 'sotuvchi');
});

test('CSRF: JSON bo‘lmagan yoki begona saytdan kelgan o‘zgartirish rad etiladi', async () => {
  const s = await session('r');
  const r1 = await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(r1.status, 403);
  const r2 = await s.post('/api/settings', {});
  assert.equal(r2.status, 200, 'o‘z saytidan — ruxsat');
  const r3 = await fetch(`${base}/api/settings`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://boshqa-sayt.example', 'sec-fetch-site': 'cross-site' }, body: '{}' });
  assert.equal(r3.status, 403);
});

test('ruxsatlar: sozlama, xodimlar va eksport faqat rahbarga; jurnal va keshbek — hamma xodimga (faqat o‘qish)', async () => {
  const lead = await session('r'), fil = await session('fa'), sel = await session('sa');
  const leadOnly = ['/api/users', '/api/users/billz'];
  for (const p of leadOnly) {
    assert.equal((await lead.get(p)).status, 200, `rahbar: ${p}`);
    assert.equal((await fil.get(p)).status, 403, `filial: ${p}`);
    assert.equal((await sel.get(p)).status, 403, `sotuvchi: ${p}`);
  }
  for (const p of ['/api/audit', '/api/cashback']) {
    for (const [who, s] of [['rahbar', lead], ['filial', fil], ['sotuvchi', sel]]) assert.equal((await s.get(p)).status, 200, `${who}: ${p}`);
  }
  for (const p of ['/api/export/audit.csv', '/api/export/suhbatlar.csv']) {
    assert.equal((await fil.get(p)).status, 403, `filial eksport: ${p}`);
    assert.equal((await sel.get(p)).status, 403, `sotuvchi eksport: ${p}`);
  }
  for (const p of ['/api/settings', '/api/billz/sync']) {
    assert.equal((await fil.post(p)).status, 403, `filial yozuv: ${p}`);
    assert.equal((await sel.post(p)).status, 403, `sotuvchi yozuv: ${p}`);
  }
  // katalog: filial rahbari tahrirlaydi, sotuvchi — yo‘q
  assert.equal((await sel.post('/api/products', { name: 'Yangi' })).status, 403);
});

test('sozlama tarixi faqat jurnalni ko‘ra oladiganga', async () => {
  const lead = await session('r'), sel = await session('sa');
  assert.ok(Array.isArray((await lead.get('/api/settings')).body.changes));
  assert.deepEqual((await sel.get('/api/settings')).body.changes, [], 'sotuvchiga o‘zgarishlar tarixi berilmaydi');
  assert.ok((await sel.get('/api/settings')).body.settings.T_seconds > 0, 'qiymatlarning o‘zi ko‘rinadi');
});

test('suhbatlar: filial o‘z filialini, sotuvchi o‘zinikini va navbatdagini ko‘radi', async () => {
  const lead = await session('r'), fil = await session('fa'), sel = await session('sa');
  const names = r => r.body.items.map(x => x.name).sort();
  assert.deepEqual(names(await lead.get('/api/conversations')), ['A mijozi', 'B mijozi', 'Navbatdagi']);
  assert.deepEqual(names(await fil.get('/api/conversations')), ['A mijozi', 'Navbatdagi']);
  assert.deepEqual(names(await sel.get('/api/conversations')), ['A mijozi', 'Navbatdagi']);
  // begona suhbat: ro‘yxatda ham yo‘q, to‘g‘ridan-to‘g‘ri ham ochilmaydi
  assert.equal((await fil.get(`/api/conversations/${ids.convB}`)).status, 404);
  assert.equal((await sel.get(`/api/conversations/${ids.convB}`)).status, 404);
  assert.equal((await sel.post(`/api/conversations/${ids.convB}/send`, { text: 'salom' })).status, 404);
  assert.equal((await sel.post(`/api/conversations/${ids.convB}/take`)).status, 404);
  assert.equal((await lead.get(`/api/conversations/${ids.convB}`)).status, 200);
});

test('vazifalar: begona vazifa yopilmaydi, o‘ziniki yopiladi', async () => {
  const sel = await session('sa');
  const bTask = one(`SELECT id FROM tasks WHERE title='B vazifa'`).id;
  assert.equal((await sel.post(`/api/tasks/${bTask}/done`, { result: 'ok' })).status, 403);
  const aTask = one(`SELECT id FROM tasks WHERE title='A vazifa'`).id;
  assert.equal((await sel.post(`/api/tasks/${aTask}/done`, { result: 'ok' })).status, 200);
  assert.equal(one('SELECT status FROM tasks WHERE id=?', aTask).status, 'done');
});

test('statik fayl: o‘zgarmagan bo‘lsa 304, o‘zgarsa yangisi keladi (deploydan keyin eski app.js qolmaydi)', async () => {
  const r1 = await fetch(`${base}/app.js`);
  assert.equal(r1.status, 200);
  const tag = r1.headers.get('etag');
  assert.ok(tag, 'ETag berilmadi');
  assert.equal(r1.headers.get('cache-control'), 'no-cache');
  const r2 = await fetch(`${base}/app.js`, { headers: { 'if-none-match': tag } });
  assert.equal(r2.status, 304, 'o‘zgarmagan fayl uchun 304');
  const r3 = await fetch(`${base}/app.js`, { headers: { 'if-none-match': '"boshqa"' } });
  assert.equal(r3.status, 200, 'ETag boshqa bo‘lsa — to‘liq fayl');
  const idx = await fetch(`${base}/login`);
  assert.equal(idx.headers.get('cache-control'), 'no-store', 'HTML keshlanmaydi');
  const html = await idx.text();
  const m = html.match(/\/app\.css\?v=([a-z0-9]+)/);
  assert.ok(m, 'HTML da app.css versiyali havola bo‘lishi kerak');
  assert.equal((await fetch(`${base}/app.css?v=${m[1]}`)).status, 200, 'versiyali havola ochiladi');
});

test('CSV eksport: paneldagi har bir havola ishlaydi', async () => {
  const lg = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'r', password: 'parol12345' }) });
  const cookie = (lg.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
  const period = new Date(t + 5 * 3600e3).toISOString().slice(0, 7);
  for (const name of ['suhbatlar.csv', 'audit.csv']) {
    const r = await fetch(`${base}/api/export/${name}?period=${period}`, { headers: { cookie } });
    assert.equal(r.status, 200, `${name} ochilmadi`);
    assert.match(r.headers.get('content-type') || '', /text\/csv/, `${name}: content-type`);
    const buf = Buffer.from(await r.arrayBuffer());
    assert.deepEqual([...buf.subarray(0, 3)], [0xEF, 0xBB, 0xBF], `${name}: Excel uchun BOM bo‘lishi kerak`);
    assert.ok(buf.toString('utf8').split('\r\n')[0].includes(';'), `${name}: sarlavha qatori yo‘q`);
  }
  assert.equal((await fetch(`${base}/api/export/yoq.csv`, { headers: { cookie } })).status, 404);
});

test('xavfsizlik sarlavhalari: sahifa faqat o‘z kodini yuklaydi', async () => {
  const r = await fetch(`${base}/login`);
  const csp = r.headers.get('content-security-policy');
  assert.ok(csp && csp.includes("script-src 'self'"), 'CSP yo‘q');
  assert.ok(csp.includes("frame-ancestors 'none'"), 'sahifa iframe ichiga qo‘yilmasin');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  // HTML dan boshqasiga CSP shart emas, lekin asosiy sarlavhalar bo‘lsin
  const js = await fetch(`${base}/app.js`);
  assert.equal(js.headers.get('x-content-type-options'), 'nosniff');
  // CSP script-src 'self': sahifa ichidagi skript va onclick ishlamaydi — ular alohida faylda bo‘lishi shart
  const lg = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'r', password: 'parol12345' }) });
  const cookie = (lg.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
  for (const [page, ck] of [['/login', ''], ['/yoriqnoma', cookie], ['/', cookie]]) {
    const html = await (await fetch(base + page, { headers: ck ? { cookie: ck } : {} })).text();
    assert.ok(!/<script(?![^>]*\ssrc=)/.test(html), `${page}: sahifa ichida skript qolmasin`);
    assert.ok(!html.includes('onclick='), `${page}: onclick qolmasin`);
  }
  assert.equal((await fetch(`${base}/login.js`)).status, 200, 'login.js ochilishi kerak');
});

test('paroli berilmagan xodim: kira olmaydi va ro‘yxatda belgilanadi', async () => {
  run('INSERT INTO users(login,name,role,branch_id,created_at) VALUES(?,?,?,?,?)', 'parolsiz', 'Parolsiz xodim', 'sotuvchi', ids.bA, t);
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'parolsiz', password: '' }) });
  assert.equal(r.status, 401, 'parolsiz hisobga kirib bo‘lmaydi');
  const lead = await session('r');
  const row = (await lead.get('/api/users')).body.items.find(x => x.login === 'parolsiz');
  assert.equal(row.has_pass, 0, 'ro‘yxatda «parol berilmagan» ko‘rinadi');
  assert.equal((await lead.get('/api/users')).body.items.find(x => x.login === 'r').has_pass, 1);
});

test('parol: o‘zinikini almashtiradi, joriy parolsiz — yo‘q', async () => {
  const sel = await session('sb');
  assert.equal((await sel.post('/api/me/password', { current: 'xato', password: 'yangiparol1' })).status, 403);
  assert.equal((await sel.post('/api/me/password', { current: 'parol12345', password: 'qisqa' })).status, 400);
  assert.equal((await sel.post('/api/me/password', { current: 'parol12345', password: 'yangiparol1' })).status, 200);
  // boshqa xodimga Telegram ulash havolasi — faqat rahbarga
  assert.equal((await sel.post(`/api/users/${ids.selA}/tglink`)).status, 403);
  assert.equal((await sel.post(`/api/users/${ids.selB}/tglink`)).status, 200);
});

test('tovar rasmini paneldan yuklash: rahbar yuklaydi, sotuvchi — yo‘q; faqat haqiqiy rasm qabul qilinadi', async () => {
  const pid = run(`INSERT INTO products(name,price,stock_json,stock_synced_at,status,updated_at) VALUES('Rasm yuklanadigan',100,'{"A":1}',?,'draft',?)`, t, t).lastInsertRowid;
  const lead = await session('r'), sel = await session('sa');
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(800, 7)]).toString('base64');
  assert.equal((await sel.post(`/api/products/${pid}/photo`, { data: jpeg })).status, 403, 'sotuvchi rasm yuklay olmaydi');
  const bad = await lead.post(`/api/products/${pid}/photo`, { data: Buffer.from('bu rasm emas, oddiy matn'.repeat(40)).toString('base64') });
  assert.equal(bad.status, 400); assert.match(bad.body.why, /JPEG|PNG/);
  const ok = await lead.post(`/api/products/${pid}/photo`, { data: jpeg });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.match(one('SELECT image_url u FROM products WHERE id=?', pid).u, /^panel:/);
  const img = await fetch(`${base}/api/products/${pid}/photo`, { headers: { cookie: (await (async () => { const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'r', password: 'parol12345' }) }); return (r.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; '); })()) } });
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('content-type'), 'image/jpeg');
  const { cardForAgent } = await import('../src/services/catalog.js');
  assert.equal(cardForAgent(one('SELECT * FROM products WHERE id=?', pid)).has_photo, true, 'AI uchun has_photo = true');
});

test('tovar rasmi: rasmsiz tovar yuborilmaydi, begona suhbatga ruxsat yo‘q', async () => {
  const pid = run(`INSERT INTO products(name,price,stock_json,stock_synced_at,status,updated_at) VALUES('Rasmsiz kamera',100,'{"A":2}',?,'draft',?)`, t, t).lastInsertRowid;
  const sel = await session('sa'), lead = await session('r');
  // rasmsiz tovar — tushunarli javob, 409
  const r1 = await sel.post(`/api/conversations/${ids.convA}/photo`, { product_id: pid });
  assert.equal(r1.status, 409);
  assert.match(r1.body.why, /rasm yo‘q/);
  // begona suhbat — ko‘rinmaydi
  assert.equal((await sel.post(`/api/conversations/${ids.convB}/photo`, { product_id: pid })).status, 404);
  // rasmi yo‘q tovarning rasm yo‘li — 404
  assert.equal((await lead.get(`/api/products/${pid}/photo`)).status, 404);
});

test('agentni o‘qitish: hamma ko‘radi, faqat rahbar/filial o‘zgartiradi', async () => {
  const lead = await session('r'), fil = await session('fa'), sel = await session('sa');
  assert.equal((await sel.post('/api/answers', { question: 'Q', answer: 'A' })).status, 403, 'sotuvchi javob qo‘sha olmaydi');
  assert.equal((await sel.post('/api/knowledge', { title: 'T', body: 'B' })).status, 403);
  const r = await fil.post('/api/answers', { question: 'Yetkazasizmi?', answer: 'Ha, Toshkent bo‘ylab.' });
  assert.equal(r.status, 200, 'filial rahbari qo‘sha oladi');
  const list = (await sel.get('/api/answers')).body.items;
  assert.ok(list.some(x => x.question === 'Yetkazasizmi?'), 'sotuvchi ro‘yxatni ko‘radi');
  assert.equal((await lead.post(`/api/answers/${r.body.id}/active`, { on: false })).status, 200);
  assert.equal((await lead.post('/api/answers', { question: '', answer: 'x' })).status, 400, 'bo‘sh savol — 400');
  assert.equal((await lead.post('/api/knowledge', { title: 'Kafolat', body: '12 oy' })).status, 200);
});

test('mijozlar doskasi: rol doirasi, telefon va AI tavsiyasi kartada; maslahat mijozga yuborilmaydi', async () => {
  run(`UPDATE conversations SET stage=2, phone='+998901234567', heat='issiq', next_step='Ertaga qo‘ng‘iroq qiling', asked='Canon R50' WHERE id=?`, ids.convA);
  run(`UPDATE conversations SET stage=3, heat='iliq' WHERE id=?`, ids.convB);
  const lead = await session('r'), selA = await session('sa');
  const L = (await lead.get('/api/board')).body;
  assert.ok(Array.isArray(L.stages) && L.stages.length === 6);
  const a = L.items.find(c => c.id === ids.convA);
  assert.equal(a.phone, '+998901234567'); assert.equal(a.stage, 2); assert.equal(a.next_step, 'Ertaga qo‘ng‘iroq qiling');
  assert.ok(L.items.some(c => c.id === ids.convB), 'rahbar hammasini ko‘radi');
  const S = (await selA.get('/api/board')).body;
  assert.ok(S.items.some(c => c.id === ids.convA), 'o‘z mijozi');
  assert.ok(!S.items.some(c => c.id === ids.convB), 'boshqa sotuvchining mijozi doskada ko‘rinmaydi');
  // maslahat: AI kaliti yo‘q — tushunarli rad, hech narsa yuborilmaydi, saqlangan maslahat 10 daqiqa ichida qayta ishlatiladi
  const before = one(`SELECT count(*) n FROM messages WHERE conversation_id=?`, ids.convA).n;
  const r1 = await selA.post(`/api/conversations/${ids.convA}/advice`, {});
  assert.equal(r1.status, 409); assert.match(r1.body.why, /AI kaliti/);
  run(`UPDATE conversations SET advice='• Mijoz Canon R50 istaydi', advice_at=? WHERE id=?`, Date.now(), ids.convA);
  const r2 = await selA.post(`/api/conversations/${ids.convA}/advice`, {});
  assert.equal(r2.status, 200); assert.equal(r2.body.cached, true); assert.match(r2.body.advice, /Canon R50/);
  assert.equal(one(`SELECT count(*) n FROM messages WHERE conversation_id=?`, ids.convA).n, before, 'mijozga xabar ketmadi');
  assert.equal((await selA.post(`/api/conversations/${ids.convB}/advice`, {})).status, 404, 'begona suhbatga maslahat yo‘q');
});

test('parol berish: bir bosishda, rahbar admin parolini o‘zgartira olmaydi, sotuvchi umuman yo‘q', async () => {
  const lead = await session('r'), selA = await session('sa');
  const id = run(`INSERT INTO users(login,name,role,created_at) VALUES('yangi.s','Yangi Sotuvchi','sotuvchi',?)`, Date.now()).lastInsertRowid;
  assert.equal((await selA.post(`/api/users/${id}/password`, {})).status, 403, 'sotuvchi parol bera olmaydi');
  const r = await lead.post(`/api/users/${id}/password`, {});
  assert.equal(r.status, 200); assert.equal(r.body.login, 'yangi.s'); assert.ok(r.body.password?.length >= 8);
  const login = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'yangi.s', password: r.body.password }) });
  assert.equal(login.status, 200, 'yangi parol bilan kira oladi');
  const adminId = run(`INSERT INTO users(login,name,role,created_at) VALUES('boshliq','Boshliq','admin',?)`, Date.now()).lastInsertRowid;
  assert.equal((await lead.post(`/api/users/${adminId}/password`, {})).status, 403, 'rahbar admin parolini o‘zgartira olmaydi');
});

test('maxfiylik siyosati va ma’lumotlarni o‘chirish sahifalari kirishsiz ochiladi (Meta talabi)', async () => {
  for (const p of ['/maxfiylik', '/privacy', '/malumot-ochirish', '/data-deletion']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
    assert.match(await r.text(), /Photobuy/);
  }
});
