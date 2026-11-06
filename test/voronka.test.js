/*
  Voronka hisobi — Odoo nusxasi jadvallaridan (tarmoqsiz). Tekshiriladi: bosqich bo‘yicha faol / shu yerda yo‘qotilgan / 24 va 72 soatdan oshganlar,
  bosqichda turish vaqti, yo‘qotish sabablari (sababsiz ham), menejer va manba kesimi, qotib qolganlar ro‘yxati, davr va jamoa filtri, konversiya.
*/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sales-voronka-'));
Object.assign(process.env, { DB_FILE: join(dir, 't.db'), DATA_DIR: dir, TG_DISABLED: '1', ENV_FILE: join(dir, 'yoq.env') });
const { migrate, run } = await import('../src/db.js');
const { voronka, leadList, leadDetail } = await import('../src/services/voronka.js');

const T = Date.parse('2026-11-06T08:00:00Z'), H = 3600e3, D = 864e5;
let id = 0;
const lead = ({ stage, user = 1, team = 12, active = 1, lost = null, source = 3, created = T - 5 * D, stageAt = T - 2 * H }) =>
  run('INSERT INTO odoo_leads(id,name,stage_id,team_id,user_id,source_id,lost_reason_id,active,created_at,stage_at,updated_at,partner,phone,city) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    ++id, `Lid ${id}`, stage, team, user, source, lost, active, created, stageAt, stageAt, `Mijoz ${id}`, `+99890000000${id}`, 'Toshkent').lastInsertRowid;

before(() => {
  migrate();
  run(`INSERT INTO odoo_teams(id,name) VALUES(12,'Savdo'),(41,'Montaj')`);
  run(`INSERT INTO odoo_stages(id,name,sequence,is_won) VALUES(1,'Янги',1,0),(2,'Ўчрашув',2,0),(3,'Аванс тушди',3,1),(9,'HR bosqich',9,0)`);
  run(`INSERT INTO odoo_users(id,name) VALUES(1,'Shahzoda'),(2,'Nodir')`);
  run(`INSERT INTO odoo_lost_reasons(id,name) VALUES(5,'Қиммат')`);
  run(`INSERT INTO odoo_sources(id,name) VALUES(3,'Instagram'),(4,'Telegram')`);
  // Янги: 2 faol (biri 3 kun turibdi), Ўчрашув: 3 faol (biri 30 soat, biri 4 kun), 2 yo‘qotilgan (biri sababli), Аванс: 1 yutilgan
  lead({ stage: 1 }); lead({ stage: 1, stageAt: T - 3 * D, user: 2 });
  lead({ stage: 2 }); lead({ stage: 2, stageAt: T - 30 * H }); lead({ stage: 2, stageAt: T - 4 * D, user: 2, source: 4 });
  const l1 = lead({ stage: 2, active: 0, lost: 5 }); lead({ stage: 2, active: 0, user: 2 });
  lead({ stage: 3, source: 4 });
  // boshqa jamoa va eski lid — standart filtrga tushmaydi
  lead({ stage: 9, team: 41 }); lead({ stage: 1, created: T - 100 * D });
  run('INSERT INTO odoo_messages(id,lead_id,at,author,kind,body) VALUES(1,?,?,?,?,?)', l1, T - D, 'Shahzoda', 'comment', 'Mijoz qimmat dedi');
  run(`INSERT INTO odoo_stage_log(lead_id,from_stage,to_stage,at,source) VALUES(${l1},1,2,?,'sync')`, T - 2 * D);
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('bosqichlar: faol, shu yerda yo‘qotilgan, 24/72 soat, turish vaqti; HR bosqichi va boshqa jamoa chiqmaydi', () => {
  const v = voronka({ t: T });
  assert.equal(v.team.id, 12, 'eng ko‘p lidli jamoa standart');
  assert.deepEqual(v.stages.map(s => s.name), ['Янги', 'Ўчрашув', 'Аванс тушди']);
  const [yangi, uchr, avans] = v.stages;
  assert.equal(yangi.active, 2); assert.equal(yangi.over_24h, 1); assert.equal(yangi.over_72h, 0);
  assert.equal(uchr.active, 3); assert.equal(uchr.lost_here, 2); assert.equal(uchr.over_24h, 2); assert.equal(uchr.over_72h, 1);
  assert.equal(uchr.max_days, 4); assert.equal(uchr.reached, 1, 'tarixdan: bir lid shu bosqichga o‘tgan');
  assert.equal(avans.active, 1); assert.equal(avans.is_won, true);
  assert.deepEqual(v.totals, { total: 8, active: 6, lost: 2, won: 1, conversion: 13 });
});

test('sabablar, menejerlar, manbalar, qotib qolganlar', () => {
  const v = voronka({ t: T });
  assert.deepEqual(v.reasons.map(r => [r.name, r.n]), [['Қиммат', 1], ['Sabab ko‘rsatilmagan', 1]]);
  const sh = v.users.find(u => u.name === 'Shahzoda'), nd = v.users.find(u => u.name === 'Nodir');
  assert.equal(sh.total, 5); assert.equal(sh.lost, 1); assert.equal(sh.won, 1); assert.equal(sh.over_24h, 1);
  assert.equal(nd.total, 3); assert.equal(nd.over_24h, 2);
  assert.deepEqual(v.sources.map(s => [s.name, s.total, s.won]), [['Instagram', 6, 0], ['Telegram', 2, 1]]);
  assert.equal(v.stuck.length, 3, 'yutilgan va 24 soatdan kam turganlar chiqmaydi');
  assert.equal(v.stuck[0].days_on_stage, 4, 'eng uzoq turgan birinchi');
  assert.ok(v.stuck.every(x => x.stage !== 'Аванс тушди'));
});

test('davr va jamoa filtri: hammasi (0 kun) va «all» jamoa', () => {
  const v = voronka({ t: T, days: 0, team: null });
  assert.equal(v.totals.total, 10);
  assert.ok(v.stages.some(s => s.name === 'HR bosqich'));
  assert.equal(voronka({ t: T, days: 0 }).totals.total, 9, 'faqat jamoa filtri');
});

test('chuqur ko‘rish: bosqich / menejer / sabab / manba / yo‘qotilganlar ro‘yxati; lid kartasi — tarix, izohlar, mijoz', () => {
  const byStage = leadList({ t: T, stage: 2 });
  assert.equal(byStage.length, 5, 'Ўчрашув: 3 faol + 2 yo‘qotilgan');
  assert.deepEqual(byStage.map(x => x.status).sort(), ['active', 'active', 'active', 'lost', 'lost']);
  assert.ok(byStage.every(x => x.phone && x.partner), 'mijoz va telefon bor');
  assert.equal(leadList({ t: T, user: 2 }).length, 3);
  assert.equal(leadList({ t: T, reason: 5 }).length, 1);
  assert.equal(leadList({ t: T, reason: 0 }).length, 1, 'sababsiz yo‘qotilgan');
  assert.equal(leadList({ t: T, source: 4 }).length, 2);
  assert.equal(leadList({ t: T, lost: true }).length, 2);
  assert.equal(leadList({ t: T, days: 0, team: null }).length, 10);
  const lostLead = leadList({ t: T, reason: 5 })[0];
  const d = leadDetail(lostLead.id, { t: T });
  assert.equal(d.status, 'lost'); assert.equal(d.reason, 'Қиммат'); assert.equal(d.user, 'Shahzoda'); assert.equal(d.team, 'Savdo');
  assert.equal(d.history.length, 1); assert.equal(d.history[0].from_stage, 'Янги'); assert.equal(d.history[0].to_stage, 'Ўчрашув');
  assert.equal(d.notes.length, 1); assert.equal(d.notes[0].body, 'Mijoz qimmat dedi');
  assert.equal(leadDetail(99999), null);
});
