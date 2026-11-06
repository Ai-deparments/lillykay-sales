/*
  Nazorat 24 soat — Odoo nusxasi jadvallaridan, soxta Telegram yuboruvchi bilan.
  Tekshiriladi: nazorat bosqichlari nomidan topiladi; oxirgi harakat = bosqich / o‘tish / izoh ichida eng yangisi; ro‘yxat va darajalar (24/48/72);
  menejerga 24 soatdan keyin (ism bo‘yicha bog‘lam), rahbarga 48 dan keyin yoki menejer ulanmagan bo‘lsa; bir lid + daraja — bir marta;
  ish vaqtidan tashqarida yuborilmaydi; sozlamadagi bosqichlar ustun.
*/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sales-nazorat-'));
Object.assign(process.env, { DB_FILE: join(dir, 't.db'), DATA_DIR: dir, TG_DISABLED: '1', ENV_FILE: join(dir, 'yoq.env') });
const { migrate, run, one, all, kvSet } = await import('../src/db.js');
const { nazoratList, nazoratJob, setNazoratSender, controlStages } = await import('../src/services/nazorat.js');
const { updateSettings } = await import('../src/services/settings.js');

const T = Date.parse('2026-11-06T07:00:00Z'); // 12:00 Toshkent — ish vaqti
const H = 3600e3;
const sent = [];
setNazoratSender(async (user, text) => { sent.push({ to: user.login, text }); return true; });
let id = 0;
const lead = ({ stage, user = 10, stageAt, msgAt = null, team = 12 }) => {
  const lid = ++id;
  run('INSERT INTO odoo_leads(id,name,stage_id,team_id,user_id,active,created_at,stage_at,updated_at) VALUES(?,?,?,?,?,1,?,?,?)', lid, `Lid ${lid}`, stage, team, user, stageAt - 5 * H, stageAt, stageAt);
  if (msgAt) run('INSERT INTO odoo_messages(id,lead_id,at,author,kind,body) VALUES(?,?,?,?,?,?)', 100 + lid, lid, msgAt, 'x', 'comment', 'Mijoz bilan gaplashdim');
  return lid;
};

before(() => {
  migrate();
  run(`INSERT INTO odoo_teams(id,name) VALUES(12,'Savdo')`);
  run(`INSERT INTO odoo_stages(id,name,sequence,is_won) VALUES(1,'Янги',1,0),(2,'Ўчрашув',2,0),(3,'Тижорат таклиф тайёрлаш',3,0),(4,'Аванс тушди',4,1)`);
  run(`INSERT INTO odoo_users(id,name) VALUES(10,'Shahzoda'),(11,'Nodir'),(12,'Aziz')`);
  // panel xodimlari: Shahzoda ism bo‘yicha va Telegram ulangan; Nodir — ulanmagan; rahbar — ulangan
  run(`INSERT INTO users(id,login,name,role,tg_chat_id,created_at) VALUES(1,'shahzoda','Shahzoda','sotuvchi',5001,0),(2,'nodir','Nodir','sotuvchi',NULL,0),(3,'rahbar','Rahbar','rahbar',5003,0)`);
  updateSettings({ work_from: '09:00', work_to: '21:00' }, 'test');
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('nazorat bosqichlari nomidan: Ўчрашув va Тижорат таклиф, yutilgan bosqich emas', () => {
  const { chosen, auto } = controlStages();
  assert.equal(auto, true);
  assert.deepEqual(chosen.map(s => s.id), [2, 3]);
});

test('ro‘yxat: oxirgi harakat izoh bo‘lsa — undan sanaladi; 24 soatdan kam — chiqmaydi; darajalar', () => {
  lead({ stage: 2, stageAt: T - 30 * H });                              // 1: 30 soat — 24 darajasi
  lead({ stage: 2, stageAt: T - 60 * H, msgAt: T - 10 * H });           // 2: izoh 10 soat oldin — chiqmaydi
  lead({ stage: 3, user: 11, stageAt: T - 50 * H });                    // 3: 50 soat — 48, Nodir (ulanmagan)
  lead({ stage: 2, user: 12, stageAt: T - 80 * H });                    // 4: 80 soat — 72, Aziz (panelda yo‘q)
  lead({ stage: 1, stageAt: T - 100 * H });                             // 5: nazorat bosqichi emas
  lead({ stage: 4, stageAt: T - 100 * H });                             // 6: yutilgan
  const oldLead = lead({ stage: 2, stageAt: T - 70 * 24 * H });         // 7: 70 kun — eskirgan, ro‘yxatga kirmaydi
  const v = nazoratList({ t: T });
  assert.deepEqual(v.items.map(x => [x.id, x.hours, x.level]), [[4, 80, 72], [3, 50, 48], [1, 30, 24]]);
  assert.deepEqual(v.totals, { over_24: 3, over_48: 2, over_72: 1, no_user: 0, notified: 0, old: 1 });
  assert.ok(!v.items.some(x => x.id === oldLead), 'eskirgan lid ro‘yxatda yo‘q');
  assert.equal(v.items.find(x => x.id === 1).staff, 'Shahzoda');
  assert.equal(v.items.find(x => x.id === 1).staff_linked, true);
  assert.equal(v.items.find(x => x.id === 3).staff_linked, false);
  assert.equal(v.by_user.find(u => u.name === 'Nodir').linked, false);
});

test('xabarlar: har qabul qiluvchiga bitta xabar; menejerga 24 dan keyin, rahbarga 48 dan keyin yoki menejer ulanmagan bo‘lsa; takror yo‘q', async () => {
  const r = await nazoratJob({ t: T, force: true });
  assert.equal(r.leads, 3);
  assert.equal(r.sent, 2, 'Shahzoda uchun bitta, rahbar uchun bitta xabar');
  const sh = sent.filter(m => m.to === 'shahzoda'), rh = sent.filter(m => m.to === 'rahbar');
  assert.equal(sh.length, 1); assert.match(sh[0].text, /Lid 1/); assert.doesNotMatch(sh[0].text, /Lid 3|Lid 4/);
  assert.equal(rh.length, 1);
  assert.doesNotMatch(rh[0].text, /Lid 1/, '24 soatda rahbarga hali yo‘q');
  assert.match(rh[0].text, /Lid 3/); assert.match(rh[0].text, /Lid 4/); assert.match(rh[0].text, /ulanmagan/);
  assert.match(rh[0].text, /2 ta/);
  const marked = all('SELECT lead_id, level FROM nazorat_alerts ORDER BY lead_id, level').map(a => `${a.lead_id}:${a.level}`);
  assert.deepEqual(marked, ['1:24', '3:24', '3:48', '4:24', '4:48', '4:72']);
  const n = sent.length;
  await nazoratJob({ t: T + 10 * 60e3, force: true });
  assert.equal(sent.length, n, 'hech narsa takrorlanmadi');
  assert.equal(nazoratList({ t: T }).totals.notified, 3);
  // 1-lid 48 soatga yetdi — endi rahbarga ham, menejerga 48 darajasi ham
  await nazoratJob({ t: T + 19 * H, force: true });
  assert.equal(sent.filter(m => m.to === 'rahbar' && /Lid 1/.test(m.text)).length, 1);
  assert.equal(sent.filter(m => m.to === 'shahzoda').length, 2);
});

test('yetkazilmagan xabar yozilmaydi — keyin ulansa yana uriniladi', async () => {
  setNazoratSender(async () => false);
  lead({ stage: 2, stageAt: T - 30 * H });              // 7
  const before = all('SELECT count(*) n FROM nazorat_alerts')[0].n;
  const r = await nazoratJob({ t: T, force: true });
  assert.equal(r.sent, 0); assert.equal(r.marked, 0);
  assert.equal(all('SELECT count(*) n FROM nazorat_alerts')[0].n, before);
  setNazoratSender(async (user, text) => { sent.push({ to: user.login, text }); return true; });
  const r2 = await nazoratJob({ t: T, force: true });
  assert.ok(r2.marked >= 1, 'endi yozildi');
});

test('ish vaqtidan tashqarida va o‘chirilganda yuborilmaydi; bir soatda bir marta', async () => {
  const night = Date.parse('2026-11-06T20:00:00Z'); // 01:00 Toshkent
  lead({ stage: 2, stageAt: night - 40 * H });
  const n = sent.length;
  kvSet('nazorat_at', 0);
  assert.equal(await nazoratJob({ t: night }), null);
  assert.equal(sent.length, n);
  updateSettings({ nazorat_notify: false }, 'test');
  assert.equal(await nazoratJob({ t: T + 30 * H }), null);
  updateSettings({ nazorat_notify: true }, 'test');
  kvSet('nazorat_at', T + 30 * H - 10 * 60e3);
  assert.equal(await nazoratJob({ t: T + 30 * H }), null, 'soat o‘tmadi');
});

test('sozlamadagi bosqichlar ustun; soatlar o‘zgartiriladi', () => {
  updateSettings({ nazorat_stages: '1', nazorat_hours: 48 }, 'test');
  const v = nazoratList({ t: T });
  assert.deepEqual(v.chosen.map(s => s.id), [1]);
  assert.equal(v.auto, false);
  assert.deepEqual(v.items.map(x => x.id), [5], 'Янги bosqichidagi 100 soatlik lid');
  assert.equal(one(`SELECT v FROM settings WHERE k='nazorat_hours'`).v, '48');
});
