/*
  KPI (B2B savdo bo‘limi) — Odoo nusxasidan reja/fakt va oylik hisob.
  Tekshiriladi: bosqichlarni jamoa bo‘yicha topish (boshqa jamoada bir xil nomlar bor); oy fakti — bosqichga kirish, snapshot va from_stage NULL hisoblanmaydi,
  bir lid bir marta; 6 kunlik hafta bilan «bugungi reja»; to‘lov chegaralari (89 → 0, 90 → 2 mln); transport chegarasi; haftalik pog‘onalar (80 % qoidasi,
  qo‘shilmaydi); oylik/choraklik bonus; sotuvchi faqat o‘z qatorini ko‘radi; sozlamalar tekshiruvi; HR’ga yuborish ishi.
*/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const dir = mkdtempSync(join(tmpdir(), 'sales-kpi-'));
Object.assign(process.env, { DB_FILE: join(dir, 't.db'), DATA_DIR: dir, TG_DISABLED: '1', ENV_FILE: join(dir, 'yoq.env') });
const { migrate, run, one, kvGet, db } = await import('../src/db.js');
const { hashPassword } = await import('../src/core/auth.js');
const { handle } = await import('../src/web.js');
const { kpiMonth, kpiSettings, saveKpiSettings, detectStages, kpiJob, DEFAULTS } = await import('../src/services/kpi.js');

const T = Date.parse('2026-11-07T08:00:00Z'), H = 3600e3, D = 864e5;   // shanba, 13:00 Toshkent; noyabr 2026: 1-sana yakshanba
const D2 = Date.parse('2026-11-02T05:00:00Z');                           // dushanba, 10:00 Toshkent
let id = 0;
const lead = ({ stage, user, team = 12, revenue = 0, created = T - 10 * D }) =>
  run('INSERT INTO odoo_leads(id,name,stage_id,team_id,user_id,active,expected_revenue,created_at,stage_at,updated_at) VALUES(?,?,?,?,?,1,?,?,?,?)',
    ++id, `Lid ${id}`, stage, team, user, revenue, created, created, created).lastInsertRowid;
const move = (lid, from, to, at, source = 'sync') => run('INSERT INTO odoo_stage_log(lead_id,from_stage,to_stage,at,source) VALUES(?,?,?,?,?)', lid, from, to, at, source);
/* Yangi lid + bosqichga kirish hodisasi; from: null — tarix boshi (hisoblanmaydi) */
const enter = (user, stage, at, o = {}) => { const l = lead({ stage, user, team: o.team, revenue: o.revenue }); move(l, o.from === undefined ? 1 : o.from, stage, at, o.source); return l; };
const many = (user, stage, n, o) => { for (let i = 0; i < n; i++) enter(user, stage, D2 + (i % 5) * D + i * 1000, o); };   // 2–6 noyabr
const staff = (login, name, role, odoo = null) => run('INSERT INTO users(login,name,role,pass_hash,created_at,odoo_user_id) VALUES(?,?,?,?,?,?)', login, name, role, hashPassword('parol12345'), T, odoo).lastInsertRowid;

let base, server;
before(async () => {
  migrate();
  run(`INSERT INTO odoo_teams(id,name) VALUES(12,'Savdo Sun High Tech'),(41,'Montaj')`);
  run(`INSERT INTO odoo_stages(id,name,sequence,is_won) VALUES(1,'Янги',1,0),(108,'Ўчрашув',2,0),(29,'Тижорат таклиф тайёрлаш',3,0),(24,'Шартнома берилди',4,0),(7,'Аванс тушди',5,1),
    (208,'Учрашув',12,0),(229,'Тижорат таклиф',13,0),(224,'Шартнома',14,0),(207,'Аванс',15,1)`);
  run(`INSERT INTO odoo_users(id,name) VALUES(1,'Shahzoda'),(2,'Nodir'),(3,'Bo‘sh'),(4,'Montajchi'),(5,'Ko‘p'),(6,'Lidli')`);
  staff('r', 'Rahbar', 'rahbar'); staff('sa', 'Sotuvchi A', 'sotuvchi', 1); staff('sb', 'Sotuvchi B', 'sotuvchi'); staff('sc', 'Sotuvchi C', 'sotuvchi', 3);
  // Shahzoda: 86 + 1 (ikki marta kirgan — bir marta) + 3 bugun = 90 uchrashuv; 80 taklif; 25 shartnoma (har biri 10 mln)
  many(1, 108, 86);
  const twice = enter(1, 108, D2 + H); move(twice, 108, 1, D2 + 2 * H); move(twice, 1, 108, D2 + 3 * H);
  for (let i = 0; i < 3; i++) enter(1, 108, T - (i + 1) * H);
  many(1, 29, 80); many(1, 24, 25, { revenue: 10e6 });
  // Nodir: 89 uchrashuv + hisoblanmaydiganlar: snapshot, tarix boshi (from NULL), oktabr; 79 taklif; 24 shartnoma
  many(2, 108, 89);
  enter(2, 108, D2 + H, { from: null, source: 'snapshot' });
  enter(2, 108, D2 + H, { from: null });
  enter(2, 108, Date.parse('2026-10-30T06:00:00Z'));
  many(2, 29, 79); many(2, 24, 24);
  // Ko‘p: 120 uchrashuv — transport chegarasi
  many(5, 108, 120);
  // Montaj jamoasi — o‘z bosqichlari (topish faqat jamoa ishlatgan bosqichlar ichidan), Savdo’ga kirmaydi
  many(4, 208, 5, { team: 41 }); enter(4, 229, D2 + H, { team: 41 }); enter(4, 224, D2 + H, { team: 41 });
  // Lidi bor, hodisasi yo‘q: Bo‘sh (panelga bog‘langan — ko‘rinadi), Lidli (bog‘lanmagan — ko‘rinmaydi)
  lead({ stage: 1, user: 3 }); lead({ stage: 1, user: 6 });
  // Sotuv: noyabr 330 mln (3-noyabr), oktabr 1 mlrd (30-oktabr), sentabr 2 mlrd (chorakdan tashqari), Montaj 500 mln (kirmaydi)
  enter(1, 7, Date.parse('2026-11-03T06:00:00Z'), { from: 24, revenue: 330e6 });
  enter(2, 7, Date.parse('2026-10-30T06:00:00Z'), { from: 24, revenue: 1e9 });
  enter(2, 7, Date.parse('2026-09-15T06:00:00Z'), { from: 24, revenue: 2e9 });
  enter(4, 207, Date.parse('2026-11-04T06:00:00Z'), { from: 224, revenue: 500e6, team: 41 });
  server = createServer(handle);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); db.close(); rmSync(dir, { recursive: true, force: true }); });   // Windows’da ochiq baza o‘chmaydi — avval yopiladi

test('bosqichlar jamoa bo‘yicha topiladi — boshqa jamoadagi bir xil nomlar emas; sozlama ustun', () => {
  const s = detectStages({});
  assert.deepEqual(s, { meeting: { id: 108, name: 'Ўчрашув' }, offer: { id: 29, name: 'Тижорат таклиф тайёрлаш' }, contract: { id: 24, name: 'Шартнома берилди' }, won: { id: 7, name: 'Аванс тушди' } });
  assert.deepEqual(detectStages({ team: 41 }), { meeting: { id: 208, name: 'Учрашув' }, offer: { id: 229, name: 'Тижорат таклиф' }, contract: { id: 224, name: 'Шартнома' }, won: { id: 207, name: 'Аванс' } });
  saveKpiSettings({ stages: { meeting: 208 } }, 'test');
  assert.equal(detectStages({}).meeting.id, 208);
  saveKpiSettings({ stages: { meeting: null } }, 'test');
  assert.equal(detectStages({}).meeting.id, 108);
});

test('oy: ish kunlari (6 kunlik hafta), bugungi reja, faktlar — snapshot/tarix boshi/oktabr/qayta kirish hisoblanmaydi, to‘lov chegaralari, transport', () => {
  const p = kpiMonth({ t: T });
  assert.equal(p.month, '2026-11'); assert.equal(p.today, '2026-11-07'); assert.deepEqual(p.team, { id: 12, name: 'Savdo Sun High Tech' });
  assert.deepEqual(p.workdays, { total: 25, elapsed: 6 }, '5 yakshanba; 2–7 noyabr');
  assert.deepEqual(p.managers.map(m => m.name), ['Ko‘p', 'Shahzoda', 'Nodir', 'Bo‘sh'], 'Montajchi va bog‘lanmagan hodisasiz Lidli yo‘q');
  const sh = p.managers.find(m => m.name === 'Shahzoda'), nd = p.managers.find(m => m.name === 'Nodir'), kp = p.managers.find(m => m.name === 'Ko‘p'), bo = p.managers.find(m => m.name === 'Bo‘sh');
  assert.deepEqual(sh.meetings, { state: 'ok', fact: 90, plan: 100, mtd_plan: 24, today_fact: 3, today_plan: 4, pct: 90, ok: true, pay: 2e6 });
  assert.deepEqual(sh.offers, { state: 'ok', fact: 80, plan: 100, mtd_plan: 24, today_fact: 0, today_plan: 4, pct: 80, ok: true, pay: 2e6 });
  assert.deepEqual(sh.contracts, { state: 'ok', fact: 25, plan: 25, mtd_plan: 6, today_fact: 0, today_plan: 1, pct: 100, ok: true, pay: 2e6 });
  assert.deepEqual(sh.transport, { meetings: 90, per: 20000, pay: 1.8e6 });
  assert.equal(sh.kpi_pay, 6e6); assert.equal(sh.fixed, 4e6); assert.equal(sh.total, 11.8e6);
  assert.equal(sh.staff_user_id, 2); assert.equal(sh.is_me, false);
  assert.equal(nd.meetings.fact, 89); assert.equal(nd.meetings.pct, 89); assert.equal(nd.meetings.ok, false); assert.equal(nd.meetings.pay, 0);
  assert.equal(nd.offers.fact, 79); assert.equal(nd.offers.pay, 0); assert.equal(nd.contracts.fact, 24); assert.equal(nd.contracts.pay, 0);
  assert.equal(nd.kpi_pay, 0); assert.equal(nd.transport.pay, 1.78e6); assert.equal(nd.total, 5.78e6); assert.equal(nd.staff_user_id, null);
  assert.equal(kp.meetings.fact, 120); assert.equal(kp.meetings.pay, 2e6); assert.equal(kp.transport.pay, 2e6, 'chegara 2 mln'); assert.equal(kp.total, 8e6);
  assert.equal(bo.meetings.fact, 0); assert.equal(bo.total, 4e6, 'faqat fiks'); assert.equal(bo.staff_user_id, 4);
  assert.match(p.note, /bosqichga kirgan/); assert.equal('hr_webhook_url' in p.settings, false, 'foydalanuvchisiz — havola yo‘q');
});

test('o‘tgan oy: hamma ish kuni o‘tgan, bugungi reja 0; oktabrdagi uchrashuv shu oyda', () => {
  const p = kpiMonth({ month: '2026-10', t: T });
  assert.deepEqual(p.workdays, { total: 27, elapsed: 27 });
  const nd = p.managers.find(m => m.name === 'Nodir');
  assert.equal(nd.meetings.fact, 1); assert.equal(nd.meetings.mtd_plan, 100); assert.equal(nd.meetings.today_plan, 0); assert.equal(nd.meetings.today_fact, 0);
  assert.equal(kpiMonth({ month: 'xato', t: T }).month, '2026-11', 'noto‘g‘ri oy → joriy');
});

test('bo‘lim sotuvi: haftalik pog‘onalar (80 %, qo‘shilmaydi), oylik va choraklik bonus, mezon — yutuq yoki shartnoma', () => {
  let p = kpiMonth({ t: T });
  assert.equal(p.sales.criterion, 'won');
  assert.deepEqual(p.sales.month, { volume: 330e6, plan: 1.6e9, pct: 21, ok: false, bonus: 0 });
  assert.equal(p.sales.weeks.length, 6);
  assert.deepEqual(p.sales.weeks[0], { from: '2026-10-26', to: '2026-11-01', volume: 1e9, tier: 1.2e9, bonus: 15e6 }, '1 mlrd ≥ 1.2 mlrd × 0.8 — eng yuqori pog‘ona, 4+7+12 emas');
  assert.deepEqual(p.sales.weeks[1], { from: '2026-11-02', to: '2026-11-08', volume: 330e6, tier: 400e6, bonus: 4e6 });
  assert.deepEqual(p.sales.weeks[2], { from: '2026-11-09', to: '2026-11-15', volume: 0, tier: null, bonus: 0 });
  assert.deepEqual(p.sales.quarter, { from: '2026-10', to: '2026-12', volume: 1.33e9, plan: 4.8e9, pct: 28, ok: false, bonus: 0 }, 'sentabr va Montaj kirmaydi');
  saveKpiSettings({ sales: { month_plan: 400e6, quarter_plan: 1.6e9 } }, 'test');
  p = kpiMonth({ t: T });
  assert.deepEqual(p.sales.month, { volume: 330e6, plan: 400e6, pct: 83, ok: true, bonus: 8e6 }, '330 ≥ 320');
  assert.equal(p.sales.quarter.ok, true); assert.equal(p.sales.quarter.bonus, 24e6, '1.33 ≥ 1.28');
  saveKpiSettings({ sales_criterion: 'contract' }, 'test');
  p = kpiMonth({ t: T });
  assert.equal(p.sales.criterion, 'contract'); assert.equal(p.sales.month.volume, 250e6, '25 shartnoma × 10 mln'); assert.match(p.note, /shartnoma bosqichiga kirgan/);
  saveKpiSettings({ sales_criterion: 'won', sales: { month_plan: DEFAULTS.sales.month_plan, quarter_plan: DEFAULTS.sales.quarter_plan } }, 'test');
});

test('bosqich topilmasa — null va «sozlanmagan», xato yo‘q', () => {
  run(`UPDATE odoo_stages SET name='Taklif' WHERE id=29`);
  const p = kpiMonth({ t: T });
  assert.equal(p.stages.offer, null);
  const sh = p.managers.find(m => m.name === 'Shahzoda');
  assert.equal(sh.offers.state, 'sozlanmagan'); assert.equal(sh.offers.fact, 0); assert.equal(sh.offers.pay, 0); assert.equal(sh.kpi_pay, 4e6);
  assert.match(p.note, /Sozlanmagan bosqich: offer/);
  run(`UPDATE odoo_stages SET name='Тижорат таклиф тайёрлаш' WHERE id=29`);
});

test('sozlamalar: standart qiymatlar, tekshiruv (son ≥ 0, foiz 0–100, pog‘onalar o‘sib borishi, bosqich, mezon, havola), jurnal', () => {
  assert.deepEqual(kpiSettings(), DEFAULTS);
  const bad = (patch, key) => assert.throws(() => saveKpiSettings(patch, 'test'), e => e.code === 'bad_setting' && e.key === key, key);
  bad({ fixed: -1 }, 'fixed'); bad({ meetings: { pct: 150 } }, 'meetings.pct'); bad({ offers: { day: 'x' } }, 'offers.day');
  bad({ sales: { week_tiers: [{ from: 750e6, bonus: 7e6 }, { from: 400e6, bonus: 4e6 }] } }, 'sales.week_tiers');
  bad({ sales: { week_tiers: [] } }, 'sales.week_tiers'); bad({ sales: { month_pct: 101 } }, 'sales.month_pct');
  bad({ stages: { meeting: 999 } }, 'stages.meeting'); bad({ sales_criterion: 'invoice' }, 'sales_criterion');
  bad({ hr_webhook_url: 'ftp://x' }, 'hr_webhook_url'); bad({ work_dow: '0000000' }, 'work_dow');
  assert.deepEqual(kpiSettings(), DEFAULTS, 'xato bo‘lsa hech narsa o‘zgarmaydi');
  const ch = saveKpiSettings({ fixed: '4500000', meetings: { pct: 85 }, nomalum: 1 }, 'Rahbar');
  assert.deepEqual(ch, ['fixed: 4000000 → 4500000', 'meetings.pct: 90 → 85']);
  assert.equal(kpiSettings().fixed, 4500000); assert.equal(kpiSettings().meetings.pct, 85); assert.equal(kpiSettings().meetings.pay, 2e6, 'qisman yangilash');
  assert.ok(one(`SELECT 1 FROM changes WHERE who='Rahbar' AND what='KPI · fixed: 4000000 → 4500000'`));
  assert.ok(one(`SELECT 1 FROM audit WHERE actor='Rahbar' AND action='KPI sozlamalari o‘zgartirildi'`));
  assert.deepEqual(saveKpiSettings({ fixed: 4500000 }, 'Rahbar'), [], 'o‘zgarish yo‘q');
  saveKpiSettings({ fixed: 4e6, meetings: { pct: 90 } }, 'test');
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

test('HTTP: sotuvchi faqat o‘z qatori (bog‘lanmagan — bo‘sh), rahbar — hammasi va havola; sozlamalar faqat rahbar, noto‘g‘ri qiymat 400', async () => {
  const sa = await session('sa'), sb = await session('sb'), boss = await session('r');
  const mine = await sa.get('/api/kpi?month=2026-11');
  assert.equal(mine.status, 200); assert.equal(mine.body.managers.length, 1);
  assert.equal(mine.body.managers[0].name, 'Shahzoda'); assert.equal(mine.body.managers[0].is_me, true); assert.equal(mine.body.managers[0].meetings.fact, 90);
  assert.equal('hr_webhook_url' in mine.body.settings, false);
  const none = await sb.get('/api/kpi?month=2026-11');
  assert.equal(none.status, 200); assert.deepEqual(none.body.managers, []); assert.match(none.body.note, /bog‘lanmagan/);
  const all = await boss.get('/api/kpi?month=2026-11&team=12');
  assert.equal(all.body.managers.length, 4); assert.ok('hr_webhook_url' in all.body.settings);
  assert.equal((await boss.get('/api/kpi?month=2026-11&team=41')).body.managers[0].name, 'Montajchi');
  assert.equal((await sa.get('/api/kpi/settings')).status, 403); assert.equal((await sa.post('/api/kpi/settings', { fixed: 1 })).status, 403);
  const st = await boss.get('/api/kpi/settings');
  assert.equal(st.status, 200); assert.equal(st.body.settings.fixed, 4e6); assert.equal(st.body.detected.meeting.id, 108); assert.equal(st.body.stages.length, 9);
  const b = await boss.post('/api/kpi/settings', { contracts: { pct: 120 } });
  assert.equal(b.status, 400); assert.equal(b.body.error, 'bad_setting'); assert.equal(b.body.key, 'contracts.pct');
  const ok = await boss.post('/api/kpi/settings', { transport: { per: 25000 } });
  assert.equal(ok.status, 200); assert.deepEqual(ok.body.changed, ['transport.per: 20000 → 25000']); assert.equal(ok.body.settings.transport.per, 25000);
  saveKpiSettings({ transport: { per: 20000 } }, 'test');
});

test('HR’ga yuborish: havola bo‘sh — yo‘q; 18:00 dan oldin — yo‘q; kuniga bir marta; xato — jurnal va bir soat kutish', async () => {
  const calls = [];
  const fetchFn = async (url, o) => { calls.push({ url, body: JSON.parse(o.body) }); return { ok: true, status: 200 }; };
  assert.equal(await kpiJob({ t: T + 6 * H, fetchFn }), null, 'havola yo‘q');
  saveKpiSettings({ hr_webhook_url: 'https://hr.example/kpi' }, 'test');
  assert.equal(await kpiJob({ t: T, fetchFn }), null, '13:00 — hali erta');
  const r = await kpiJob({ t: T + 6 * H, fetchFn });
  assert.deepEqual(r, { sent: true, managers: 4 });
  assert.equal(calls.length, 1); assert.equal(calls[0].url, 'https://hr.example/kpi'); assert.equal(calls[0].body.month, '2026-11'); assert.equal('hr_webhook_url' in calls[0].body.settings, false);
  assert.equal(await kpiJob({ t: T + 7 * H, fetchFn }), null, 'bugun yuborilgan'); assert.equal(calls.length, 1);
  assert.ok(one(`SELECT 1 FROM audit WHERE kind='sys' AND action='KPI hisoboti HR’ga yuborildi'`));
  const fail = await kpiJob({ t: T + 30 * H, fetchFn: async () => { throw new Error('ECONNREFUSED'); } });
  assert.deepEqual(fail, { sent: false, error: 'ECONNREFUSED' });
  assert.equal(kvGet('kpi:hr_sent_day'), '2026-11-07'); assert.ok(one(`SELECT 1 FROM audit WHERE result='ECONNREFUSED'`));
  assert.equal(await kpiJob({ t: T + 30 * H + 10 * 60e3, fetchFn }), null, 'xatodan keyin bir soat kutadi');
  assert.deepEqual(await kpiJob({ t: T + 31 * H + 60e3, fetchFn }), { sent: true, managers: 4 });
  assert.equal(kvGet('kpi:hr_sent_day'), '2026-11-08');
  saveKpiSettings({ hr_webhook_url: '' }, 'test');
});
