/*
  Tahlil (rahbar sahifasi) — Odoo nusxasi va panel jadvallaridan, soxta AI bilan.
  Tekshiriladi: bugungi ko‘rsatkichlar va taqqoslash (kecha, 7 kunlik o‘rtacha); 30 kunlik qator va yutilgan kun; bosqichlar — tiqilish nuqtasi va izoh;
  manbalar konversiyasi; menejer holati qoidalari (yaxshi / ortacha / etibor / mas’ulsiz); AI hissasi panel jadvallaridan;
  AI xulosasi — kesh (1 soat), promptda mijoz telefoni/ismi yo‘q, bo‘sh javob — xato; HTTP: faqat rahbar, davr qat’iy.
*/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const dir = mkdtempSync(join(tmpdir(), 'sales-tahlil-'));
Object.assign(process.env, { DB_FILE: join(dir, 't.db'), DATA_DIR: dir, TG_DISABLED: '1', ENV_FILE: join(dir, 'yoq.env'), GEMINI_API_KEY: 'sinov-kalit', GEMINI_MODEL: 'gemini-sinov' });
const { migrate, run, kvGet } = await import('../src/db.js');
const { hashPassword } = await import('../src/core/auth.js');
const { handle } = await import('../src/web.js');
const { tahlil, todayGlance, dailySeries, stageHealth, sourcesStat, managersStat, aiContribution, xulosaStatus, xulosaRefresh, setTahlilRunner } = await import('../src/services/tahlil.js');
const { AiError } = await import('../src/ai/index.js');

const T = Date.parse('2026-11-06T08:00:00Z'), H = 3600e3, D = 864e5;   // 13:00 Toshkent — bugun = [T−13h, T)
let id = 0;
const lead = ({ stage, user = 1, team = 12, active = 1, lost = null, source = 3, created = T - 5 * D, opened = created, stageAt = created, closed = null, revenue = 0 }) =>
  run('INSERT INTO odoo_leads(id,name,stage_id,team_id,user_id,source_id,lost_reason_id,active,expected_revenue,created_at,opened_at,stage_at,closed_at,updated_at,partner,phone,city) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ++id, `Lid ${id}`, stage, team, user, source, lost, active, revenue, created, opened, stageAt, closed, stageAt, `Mijoz ${id}`, `+99890000000${id}`, 'Toshkent').lastInsertRowid;
const move = (lid, from, to, at) => run(`INSERT INTO odoo_stage_log(lead_id,from_stage,to_stage,at,source) VALUES(?,?,?,?,'sync')`, lid, from, to, at);
const note = (lid, at) => run('INSERT INTO odoo_messages(lead_id,at,author,kind,body) VALUES(?,?,?,?,?)', lid, at, 'Menejer', 'comment', 'Mijoz bilan gaplashdim, telefon +998901112233');
const user = (login, name, role) => run('INSERT INTO users(login,name,role,pass_hash,created_at) VALUES(?,?,?,?,?)', login, name, role, hashPassword('parol12345'), T).lastInsertRowid;

let base, server;
const calls = [];
let reply = () => ({ sentences: ['«Ўчрашув» bosqichida 2 ta lid qotib qolgan — bugun qo‘ng‘iroq qilish kerak.', 'Nodir yo‘qotishi 50% — e’tibor kerak.', 'Instagram konversiyasi 17%.'] });
setTahlilRunner(async ({ system, userContent, tools, handlers, finalTool }) => {
  calls.push({ system, userContent, tools, finalTool });
  await handlers[tools[0].name](reply());
  return { text: '', model: 'gemini-sinov', usage: { input: 10, output: 5, cache_read: 0 } };
});

before(async () => {
  migrate();
  user('r', 'Rahbar', 'rahbar'); user('sa', 'Sotuvchi A', 'sotuvchi');
  run(`INSERT INTO odoo_teams(id,name) VALUES(12,'Savdo'),(41,'Montaj')`);
  run(`INSERT INTO odoo_stages(id,name,sequence,is_won) VALUES(1,'Янги',1,0),(2,'Ўчрашув',2,0),(3,'Аванс тушди',3,1),(9,'HR bosqich',9,0)`);
  run(`INSERT INTO odoo_users(id,name) VALUES(1,'Shahzoda'),(2,'Nodir')`);
  run(`INSERT INTO odoo_lost_reasons(id,name) VALUES(5,'Қиммат'),(6,'Жавоб йўқ')`);
  run(`INSERT INTO odoo_sources(id,name) VALUES(3,'Instagram'),(4,'Telegram')`);
  // Bugun: 2 yangi (biri mas’ulsiz, manbasiz), Nodir kecha kelgan lidni bugun oldi
  lead({ stage: 1, created: T - 2 * H });                                                   // 1 Shahzoda, bugun
  lead({ stage: 1, created: T - 1 * H, user: null, source: null });                         // 2 mas’ulsiz
  const l3 = lead({ stage: 2, user: 2, created: T - 30 * H, opened: T - 3 * H, stageAt: T - 3 * H }); move(l3, 1, 2, T - 3 * H);   // 3 kecha kelgan, bugun olingan, 24 soatdan keyin ko‘chirilgan
  // Bugun yutilgan (tarixdan), 1 soat ichida izoh yozilgan
  const l4 = lead({ stage: 3, created: T - 5 * D, stageAt: T - 4 * H, closed: T - 4 * H, revenue: 1000 }); move(l4, 2, 3, T - 4 * H); note(l4, T - 5 * D + H);   // 4
  // Bugun yo‘qotilganlar (ikkalasi «Қиммат», Nodir), kecha yo‘qotilgan (Nodir, eski lid)
  lead({ stage: 2, user: 2, active: 0, lost: 5, created: T - 3 * D, closed: T - 5 * H });   // 5
  lead({ stage: 2, user: 2, active: 0, lost: 5, created: T - 3 * D, closed: T - 6 * H, source: 4 });   // 6
  lead({ stage: 2, created: T - 20 * H, source: 4 });                                        // 7 Shahzoda, kecha
  lead({ stage: 2, user: 2, active: 0, lost: 6, created: T - 10 * D, closed: T - 20 * H });   // 8 kecha yo‘qotilgan, kogortadan tashqari
  // Ўчрашув’da qotib qolganlar (Nodir): 9 — ikkinchi aloqa bor (o‘tish + izoh), 10 — yo‘q
  const l9 = lead({ stage: 2, user: 2, created: T - 6 * D, stageAt: T - 3 * D }); move(l9, 1, 2, T - 3 * D); note(l9, T - 2 * D);
  lead({ stage: 2, user: 2, created: T - 6 * D, stageAt: T - 49 * H, source: 4 });           // 10 (48 soat chegarasidan o‘tgan)
  lead({ stage: 1, user: null, created: T - 4 * D, source: null });                          // 11 mas’ulsiz, 4 kun jim
  lead({ stage: 2, user: 2, active: 0, lost: 6, created: T - 2 * D, closed: T - 50 * H, source: 4 });   // 12 Nodir yo‘qotgan (2 kun oldin)
  const l13 = lead({ stage: 2, created: T - 2 * D, stageAt: T - 1 * D }); note(l13, T - 2 * D + 2 * H);   // 13 Shahzoda, 2 soatda izoh
  lead({ stage: 3, created: T - 20 * D, closed: T - 15 * D, revenue: 500 });                 // 14 tarixsiz yutilgan — closed_at bo‘yicha
  lead({ stage: 9, team: 41, created: T - 1 * H });                                           // boshqa jamoa — chiqmaydi
  // Panel: Telegram/Instagram suhbatlari, AI javobi, telefon, topshiriqlar
  run(`INSERT INTO accounts(id,channel,ext_id,name,created_at) VALUES(1,'tg','a','TG',?),(2,'ig','b','IG',?),(3,'demo','c','Demo',?)`, T, T, T);
  run(`INSERT INTO conversations(id,account_id,ext_chat_id,created_at,phone) VALUES(1,1,'c1',?,'+998901234567'),(2,2,'c2',?,NULL),(3,3,'c3',?,'+998900000000'),(4,1,'c4',?,'+998901111111')`, T - 2 * H, T - D, T - H, T - 10 * D);
  run(`INSERT INTO messages(conversation_id,author,text,created_at) VALUES(1,'client','Salom',?),(1,'ai','Assalomu alaykum',?),(2,'client','Narxi?',?),(2,'seller','500',?)`, T - 2 * H, T - 2 * H + 30e3, T - D, T - D + 60e3);
  run(`INSERT INTO drafts(conversation_id,batch,status,created_at,decided_at) VALUES(1,1,'sent',?,?)`, T - 2 * H + 5e3, T - 2 * H + 30e3);
  run(`INSERT INTO assignments(conversation_id,kind,title,status,created_by,created_at) VALUES(1,'reply','Javob','done','ai',?),(2,'reply','Javob','failed','ai',?),(4,'reply','Javob','failed','ai',?)`, T - H, T - D, T - 10 * D);
  server = createServer(handle);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

test('bugun bir qarashda: sonlar, eng ko‘p sabab, kecha va 7 kunlik o‘rtacha bilan taqqoslash', () => {
  const g = todayGlance({ period: 'today', t: T });
  assert.equal(g.new, 2); assert.equal(g.taken, 2, 'bugun yaratilgan + bugun olingan');
  assert.equal(g.won, 1); assert.equal(g.won_amount, 1000); assert.equal(g.lost, 2);
  assert.deepEqual(g.lost_top_reason, { name: 'Қиммат', n: 2 });
  assert.equal(g.cmp.new.prev, 2, 'kecha: 3 va 7'); assert.equal(g.cmp.taken.prev, 1); assert.equal(g.cmp.lost.prev, 1); assert.equal(g.cmp.won.prev, 0);
  assert.equal(g.cmp.new.avg7, 1.7, '7 kunda 12 ta yangi (1–7, 9–13) / 7');
  const w = todayGlance({ period: '7', t: T });
  assert.equal(w.new, 12); assert.equal(w.won, 1); assert.equal(w.lost, 4); assert.equal(w.cmp.new.prev, 1, 'oldingi 7 kun oynasi: 8 (10 kun); 14 (20 kun) emas');
});

test('kunlik qator: 30 kun, bugun 2 kirgan / 1 yutilgan, tarixsiz yutilgan — closed_at kuni', () => {
  const s = dailySeries({ days: 30, t: T });
  assert.equal(s.length, 30);
  assert.equal(s.at(-1).date, '2026-11-06'); assert.equal(s.at(-1).in, 2); assert.equal(s.at(-1).won, 1);
  assert.equal(s.find(x => x.date === '2026-11-05').in, 2, 'kecha: 3 va 7');
  assert.equal(s.find(x => x.date === '2026-10-22').won, 1, '14-lid closed_at bo‘yicha (T−15 kun)');
  assert.equal(s.reduce((n, x) => n + x.won, 0), 2);
});

test('bosqichlar: hozir / qotib qolgan / davrda yo‘qotilgan / o‘rtacha kun; tiqilish nuqtasi va izoh', () => {
  const st = stageHealth({ period: '7', t: T });
  assert.deepEqual(st.map(s => s.name), ['Янги', 'Ўчрашув', 'Аванс тушди'], 'HR va boshqa jamoa chiqmaydi');
  const [yangi, uchr, avans] = st;
  assert.equal(yangi.now, 3); assert.equal(yangi.stuck, 1); assert.equal(yangi.lost, 0); assert.equal(yangi.is_bottleneck, false);
  assert.equal(uchr.now, 5); assert.equal(uchr.stuck, 2); assert.equal(uchr.lost, 4, '5, 6, 8, 12'); assert.equal(uchr.is_bottleneck, true);
  assert.equal(avans.now, 2); assert.equal(avans.stuck, 0, 'yutuq bosqichi qotib qolmaydi'); assert.equal(avans.is_bottleneck, false);
  assert.ok(uchr.avg_days > 0.5 && uchr.avg_days < 2, `o‘rtacha kun: ${uchr.avg_days}`);
  const page = tahlil({ period: '7', t: T });
  assert.equal(page.stages_note, 'Tiqilish nuqtasi — «Ўчрашув»: 2 ta lid 24 soatdan beri qimirlamagan, shundan 1 tasida ikkinchi aloqa yo‘q.');
});

test('manbalar: kelgan / yutilgan / konversiya, manbasizlar alohida qator', () => {
  assert.deepEqual(sourcesStat({ period: '7', t: T }).map(s => [s.id, s.name, s.in, s.won, s.conv]),
    [[3, 'Instagram', 6, 1, 17], [4, 'Telegram', 4, 0, 0], [0, 'Manba yo‘q', 2, 0, 0]]);
});

test('menejerlar: holat qoidalari — yaxshi (yo‘qotish < 20, 24 soatda aloqa ≥ 85), etibor (yo‘qotish ≥ 30), mas’ulsizlar', () => {
  const m = managersStat({ period: '7', t: T });
  const sh = m.find(x => x.name === 'Shahzoda'), nd = m.find(x => x.name === 'Nodir'), none = m.find(x => x.user_id === 0);
  assert.equal(sh.taken, 4, '1, 4, 7, 13'); assert.equal(sh.won, 1); assert.equal(sh.won_amount, 1000); assert.equal(sh.lost_pct, 0);
  assert.equal(sh.on_time_pct, 100, '4 va 13 — 24 soatda izoh; 1 va 7 hali 24 soat bo‘lmagan — hisobga kirmaydi'); assert.equal(sh.silent_leads, 0); assert.equal(sh.status, 'yaxshi');
  assert.equal(nd.taken, 6, '3, 5, 6, 9, 10, 12'); assert.equal(nd.lost_pct, 50); assert.equal(nd.on_time_pct, 0, '3 — 24 soatdan keyin ko‘chirilgan'); assert.equal(nd.silent_leads, 2); assert.equal(nd.status, 'etibor');
  assert.deepEqual(none, { user_id: 0, name: 'Mas’ul yo‘q', taken: 2, on_time_pct: null, won: 0, won_amount: 0, lost_pct: 0, silent_leads: 1, status: 'none' });
  assert.equal(m[0].name, 'Nodir', 'ko‘p olgan birinchi');
});

test('AI hissasi — panel jadvallaridan: suhbatlar, AI javobi, javob tezligi, telefonlar, topshiriqlar', () => {
  assert.deepEqual(aiContribution({ period: '7', t: T }),
    { conversations: 2, ai_replied: 1, ai_replied_pct: 50, avg_reply_sec: 30, phones: 1, phones_pct: 50, handoffs: 2, handoffs_unanswered: 1 });
});

test('AI xulosasi: kesh 1 soat, promptda faqat yig‘ma raqamlar (telefon, mijoz, lid nomi yo‘q), bo‘sh javob — xato', async () => {
  assert.deepEqual(xulosaStatus({ t: T }), { text: null, at: null, model: null, stale: true });
  const r = await xulosaRefresh({ t: T, who: 'test' });
  assert.equal(calls.length, 1);
  assert.equal(r.text.length, 3); assert.equal(r.at, T); assert.equal(r.model, 'gemini-sinov');
  const uc = calls[0].userContent;
  assert.ok(!/998\d{6,}/.test(uc) && !uc.includes('+998'), 'telefon raqami yo‘q');
  assert.ok(!uc.includes('Mijoz ') && !uc.includes('Lid ') && !uc.includes('gaplashdim'), 'mijoz nomi, lid nomi va izoh matni yo‘q');
  assert.match(uc, /Shahzoda: 4 \/ 100 \/ 1 \/ 0 \/ 0 \/ yaxshi/); assert.match(uc, /Nodir: 6 \/ 0 \/ 0 \/ 50 \/ 2 \/ etibor/);
  assert.match(uc, /Ўчрашув: 5 \/ 2 \/ 4 \/ .* — tiqilish nuqtasi/); assert.match(uc, /Instagram: 6 \/ 1 \/ 17/);
  assert.match(calls[0].system, /raqam/); assert.equal(calls[0].finalTool, 'xulosa');
  assert.ok(kvGet('tahlil:xulosa:12'), 'kv’da jamoa bo‘yicha');
  const again = await xulosaRefresh({ t: T + 30 * 60e3 });
  assert.equal(calls.length, 1, '1 soat ichida AI qayta chaqirilmaydi'); assert.deepEqual(again, r);
  assert.equal(xulosaStatus({ t: T + 30 * 60e3 }).stale, false); assert.equal(xulosaStatus({ t: T + 2 * H }).stale, true);
  const page = tahlil({ period: '7', t: T + 2 * H });
  assert.deepEqual(page.xulosa, { text: r.text, at: T, model: 'gemini-sinov', stale: true });
  reply = () => ({ sentences: [] });
  await assert.rejects(xulosaRefresh({ t: T + 2 * H }), e => e instanceof AiError && e.code === 'empty');
  assert.equal(xulosaStatus({ t: T + 2 * H }).at, T, 'xato — eski xulosa qoladi');
  // bir vaqtda ikki so‘rov — bitta chaqiruv
  let release; reply = () => ({ sentences: ['Bir', 'Ikki', 'Uch'] });
  setTahlilRunner(async ({ tools, handlers }) => { await new Promise(r => { release = r; }); calls.push({}); await handlers[tools[0].name](reply()); return { text: '', model: 'm' }; });
  const p1 = xulosaRefresh({ t: T + 3 * H }), p2 = xulosaRefresh({ t: T + 3 * H });
  await new Promise(r => setTimeout(r, 20)); release();
  const [a, b] = await Promise.all([p1, p2]);
  assert.equal(calls.length, 3); assert.deepEqual(a.text, ['Bir', 'Ikki', 'Uch']); assert.deepEqual(b.text, a.text);
  setTahlilRunner(async ({ tools, handlers }) => { await handlers[tools[0].name](reply()); return { text: '', model: 'm' }; });
});

test('sahifa javobi: davr qat’iy, jamoa, sinxron vaqti, qator yig‘indisi va oldingi 30 kun konversiyasi', () => {
  const p = tahlil({ period: 'xato', t: T });
  assert.equal(p.period, '7'); assert.deepEqual(p.team, { id: 12, name: 'Savdo' }); assert.equal(p.odoo_synced_at, null); assert.equal(p.updated_at, T);
  assert.equal(p.series.length, 30); assert.deepEqual(p.series_total, { in: 14, won: 2, conv: 14, prev_conv: null }, '30 kunda 8 va 14 ham kiradi');
  assert.ok(p.today && p.stages.length && p.sources.length && p.managers.length && p.ai && p.xulosa);
  assert.equal(tahlil({ period: '30', team: null, t: T }).today.new, 15, 'hamma jamoa, 30 kun: Montaj lidi ham');
});

async function session(login) {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password: 'parol12345' }) });
  const cookie = (r.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
  const call = async (path, opts = {}) => {
    const res = await fetch(base + path, { ...opts, headers: { cookie, ...(opts.body ? { 'content-type': 'application/json' } : {}) } });
    let body = null; try { body = await res.json(); } catch { /* bo‘sh */ }
    return { status: res.status, body };
  };
  return { get: p => call(p), post: (p, b = {}) => call(p, { method: 'POST', body: JSON.stringify(b) }) };
}

test('HTTP: faqat rahbar/admin; davr tekshiriladi; xulosa — POST, AI xatosi 502', async () => {
  const sel = await session('sa'), boss = await session('r');
  assert.equal((await sel.get('/api/tahlil')).status, 403);
  assert.equal((await sel.post('/api/tahlil/xulosa', {})).status, 403);
  const g = await boss.get('/api/tahlil?period=today&team=12');
  assert.equal(g.status, 200); assert.equal(g.body.period, 'today'); assert.equal(g.body.team.id, 12); assert.equal(typeof g.body.today.new, 'number');   // t = hozir — seed sanasi emas
  assert.equal((await boss.get('/api/tahlil?period=90')).body.period, '7', 'noma’lum davr → 7');
  const x = await boss.post('/api/tahlil/xulosa', {});
  assert.equal(x.status, 200); assert.equal(x.body.ok, true); assert.equal(x.body.text.length, 3);
  setTahlilRunner(async () => { throw new AiError('refusal', 'SAFETY'); });
  const bad = await boss.post('/api/tahlil/xulosa', { force: true });
  assert.equal(bad.status, 502); assert.equal(bad.body.error, 'refusal'); assert.match(bad.body.why, /rad etdi/);
});
