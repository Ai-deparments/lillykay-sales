/*
  Odoo ulagichi — soxta JSON-RPC bilan, haqiqiy tarmoqsiz.
  Tekshiriladi: faqat o‘qish usullari o‘tadi; noto‘g‘ri kalit — tushunarli xato va «error» holati; birinchi sinxron hammasini oladi
  (lidlar, bosqichlar, foydalanuvchilar, bosqich tarixi, izohlar); keyingi sinxron faqat write_date bo‘yicha yangilarini so‘raydi;
  yo‘qotilgan (active=false) lid ham saqlanadi; HTML izoh matnga aylanadi; 5 daqiqa o‘tmasa sinxron qayta ishlamaydi.
*/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sales-odoo-'));
Object.assign(process.env, { DB_FILE: join(dir, 't.db'), DATA_DIR: dir, TG_DISABLED: '1', ENV_FILE: join(dir, 'yoq.env'),
  ODOO_URL: 'https://odoo.sinov/', ODOO_DB: 'sinov-db', ODOO_LOGIN: 'dashboard', ODOO_API_KEY: 'togri-kalit' });

/* ---------- soxta Odoo ---------- */
const state = { key: 'togri-kalit', calls: [], leads: [], tracking: [], messages: [] };
const lead = (id, { stage = 1, user = 10, active = true, write = '2026-11-01 08:00:00', lost = false } = {}) => ({
  id, name: `Lid ${id}`, stage_id: [stage, `Bosqich ${stage}`], team_id: [12, 'Savdo'], user_id: [user, `User ${user}`], source_id: [3, 'Instagram'],
  lost_reason_id: lost ? [2, 'Qimmat'] : false, active, probability: active ? 20 : 0, expected_revenue: 40000000, tag_ids: [1],
  create_date: '2026-10-20 06:00:00', date_open: '2026-10-20 06:00:00', date_last_stage_update: write, date_closed: false, write_date: write
});
const applyDomain = (rows, domain) => rows.filter(r => domain.every(([f, op, v]) => {
  if (f === 'field_id.name') return r.field === v;
  if (f === 'field_id.model') return r.model === v;
  const x = Array.isArray(r[f]) ? r[f][0] : r[f];
  if (op === '=') return x === v;
  if (op === '>') return String(r[f]) > v;
  if (op === 'in') return v.includes(x);
  return true;
}));
globalThis.fetch = async (url, opts = {}) => {
  const b = JSON.parse(opts.body); const { service, method, args } = b.params;
  state.calls.push(`${service}.${method}${service === 'object' ? ':' + args[3] + '.' + args[4] : ''}`);
  const reply = result => ({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: b.id, result }) });
  const fail = message => ({ ok: true, status: 200, json: async () => ({ jsonrpc: '2.0', id: b.id, error: { code: 200, message: 'Odoo Server Error', data: { message } } }) });
  if (service === 'common' && method === 'authenticate') return reply(args[2] === state.key ? 7 : false);
  if (service === 'common' && method === 'version') return reply({ server_version: '19.0' });
  const [, uid, key, model, m, a, kw = {}] = args;
  if (key !== state.key || uid !== 7) return fail('Access Denied');
  const domain = a[0] || [];
  const page = rows => rows.slice(kw.offset || 0, (kw.offset || 0) + (kw.limit || rows.length));
  if (model === 'crm.team') return reply([{ id: 12, name: 'Savdo Sun High Tech' }, { id: 41, name: 'Ish Montajnik' }]);
  if (model === 'crm.stage') return reply([{ id: 1, name: 'Янги', sequence: 1, is_won: false }, { id: 2, name: 'Ўчрашув', sequence: 2, is_won: false }, { id: 3, name: 'Аванс тушди', sequence: 3, is_won: true }]);
  if (model === 'res.users') return reply([{ id: 10, name: 'Shahzoda' }, { id: 11, name: 'Nodir' }]);
  if (model === 'crm.lost.reason') return reply([{ id: 2, name: 'Qimmat' }]);
  if (model === 'utm.source') return reply([{ id: 3, name: 'Instagram' }]);
  if (model === 'crm.lead' && m === 'search_read') return reply(page(applyDomain(state.leads, domain)));
  if (model === 'mail.tracking.value' && m === 'search_read') return reply(page(applyDomain(state.tracking, domain)));
  if (model === 'mail.message' && m === 'read') return reply(state.messages.filter(x => a[0].includes(x.id)));
  if (model === 'mail.message' && m === 'search_read') return reply(page(applyDomain(state.messages, domain)));
  return fail(`unknown ${model}.${m}`);
};

const { migrate, one, all, kvGet, kvSet } = await import('../src/db.js');
const { syncOdoo, odoo, resetOdooAuth, odooStatus } = await import('../src/services/odoo.js');
const { integration } = await import('../src/services/settings.js');
const { config } = await import('../src/config.js');

before(() => {
  migrate();
  state.leads = [lead(100), lead(101, { stage: 2, user: 11, write: '2026-11-02 09:00:00' }), lead(102, { active: false, lost: true, write: '2026-11-02 10:00:00' })];
  state.messages = [
    { id: 500, model: 'crm.lead', res_id: 101, date: '2026-11-02 09:00:00', author_id: [11, 'Nodir'], message_type: 'notification', body: '' },
    { id: 501, model: 'crm.lead', res_id: 101, date: '2026-11-02 09:30:00', author_id: [11, 'Nodir'], message_type: 'comment', body: '<p>Учрашув бўлди,<br>том 120 м&sup2;</p>' },
    { id: 502, model: 'crm.lead', res_id: 100, date: '2026-11-02 11:00:00', author_id: [10, 'Shahzoda'], message_type: 'comment', body: '<p></p>' }
  ];
  state.tracking = [{ id: 900, field: 'stage_id', model: 'crm.lead', mail_message_id: [500, 'Lid 101'], old_value_integer: 1, new_value_integer: 2, create_date: '2026-11-02 09:00:00' }];
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('faqat o‘qish: yozuv usuli chaqirilmaydi', async () => {
  await assert.rejects(() => odoo('crm.lead', 'write', [[1], {}]), /taqiqlangan/);
  await assert.rejects(() => odoo('crm.lead', 'create', [{}]), /taqiqlangan/);
  assert.ok(!state.calls.some(c => /write|create/.test(c)), 'tarmoqqa chiqmadi');
});

test('noto‘g‘ri kalit: tushunarli xato, integratsiya «error», jadvalga hech narsa yozilmaydi', async () => {
  config.odooKey = 'xato'; resetOdooAuth();
  await assert.rejects(() => syncOdoo({ force: true, who: 'test' }), /kirish rad etildi/);
  assert.equal(integration('odoo').state, 'error');
  assert.equal(one('SELECT count(*) n FROM odoo_leads').n, 0);
  config.odooKey = 'togri-kalit'; resetOdooAuth();
});

test('birinchi sinxron: ma’lumotnomalar, faol va yo‘qotilgan lidlar, bosqich tarixi, izohlar (HTML → matn, bo‘sh izoh tashlanadi)', async () => {
  const r = await syncOdoo({ force: true, who: 'test' });
  assert.equal(r.first, true);
  assert.deepEqual(all('SELECT name FROM odoo_stages ORDER BY sequence').map(s => s.name), ['Янги', 'Ўчрашув', 'Аванс тушди']);
  assert.equal(one('SELECT is_won FROM odoo_stages WHERE id=3').is_won, 1);
  assert.equal(one('SELECT count(*) n FROM odoo_users').n, 2);
  assert.equal(one('SELECT count(*) n FROM odoo_leads').n, 3, 'yo‘qotilgan lid ham saqlanadi');
  const lost = one('SELECT * FROM odoo_leads WHERE id=102');
  assert.equal(lost.active, 0); assert.equal(lost.lost_reason_id, 2);
  assert.equal(one('SELECT created_at FROM odoo_leads WHERE id=100').created_at, Date.parse('2026-10-20T06:00:00Z'), 'UTC → epoch ms');
  const log = all('SELECT * FROM odoo_stage_log');
  assert.equal(log.length, 1); assert.equal(log[0].lead_id, 101); assert.equal(log[0].from_stage, 1); assert.equal(log[0].to_stage, 2); assert.equal(log[0].author, 'Nodir');
  const msgs = all('SELECT * FROM odoo_messages ORDER BY id');
  assert.equal(msgs.length, 1, 'bo‘sh HTML izoh saqlanmaydi');
  assert.equal(msgs[0].body, 'Учрашув бўлди,\nтом 120 м&sup2;');
  assert.equal(integration('odoo').state, 'ok');
  assert.match(integration('odoo').detail, /3 lid/);
  assert.equal(odooStatus().leads, 3);
});

test('keyingi sinxron: faqat write_date dan keyingi lidlar so‘raladi; 5 daqiqa o‘tmasa — ishlamaydi', async () => {
  const before = state.calls.length;
  assert.equal(await syncOdoo(), null, 'hali vaqt bo‘lmadi');
  assert.equal(state.calls.length, before, 'tarmoqqa chiqmadi');
  state.leads.push(lead(103, { write: '2026-11-03 07:00:00' }));
  state.leads[0] = lead(100, { stage: 2, write: '2026-11-03 08:00:00' });
  kvSet('odoo_sync_at', 0);
  const r = await syncOdoo();
  assert.equal(r.leads, 2, 'faqat yangilangan ikkitasi');
  assert.equal(one('SELECT stage_id FROM odoo_leads WHERE id=100').stage_id, 2);
  assert.equal(one('SELECT count(*) n FROM odoo_leads').n, 4);
  assert.equal(kvGet('odoo_wm_leads'), '2026-11-03 08:00:00');
});
