import { config } from '../config.js';
import { one, all, run, tx, kvGet, kvSet } from '../db.js';
import { now } from '../util.js';
import { setIntegration } from './settings.js';
import { audit } from '../core/audit.js';

/*
  Odoo CRM → tizim sinxroni (faqat O‘QISH). Ikki yo‘l:
  - JSON-2 (Odoo 19): POST /json/2/<model>/<method>, «Authorization: bearer <API kalit>», X-Odoo-Database — ODOO_LOGIN bo‘sh bo‘lsa (mijozning Odoo’si).
  - JSON-RPC /jsonrpc: login + API kalit parol o‘rnida — ODOO_LOGIN berilgan bo‘lsa (sandbox).
  Manba: crm.lead (faol va yo‘qotilganlar), crm.stage, crm.team, res.users, crm.lost.reason, utm.source,
  bosqich o‘zgarish tarixi (mail.tracking.value → stage_id) va menejer izohlari (mail.message, comment/email).
  Hajm: ODOO_TEAMS (jamoa id’lari) — faqat shu jamoalar lidlari; ODOO_SINCE_DAYS — birinchi sinxronda tarix va izohlar shuncha kundan.
  Har 5 daqiqada o‘zgarganlari (write_date / date bo‘yicha); birinchi marta — hammasi. Odoo’ga hech narsa yozilmaydi.
  Vaqt: Odoo UTC «YYYY-MM-DD HH:MM:SS» → epoch ms.
*/

const SYNC_EVERY = 5 * 60e3, PAGE = 500, CHUNK = 400, EPOCH = '1970-01-01 00:00:00', DAY = 864e5;

export class OdooError extends Error {
  constructor(message, code = 'odoo') { super(message); this.code = code; }
}

export const odooLive = () => Boolean(config.odooUrl && config.odooKey);
export const odooMode = () => (config.odooLogin ? 'jsonrpc' : 'json2');
const utc = s => s ? Date.parse(String(s).replace(' ', 'T') + 'Z') : null;
const stamp = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const m2o = v => (Array.isArray(v) ? v[0] : v) || null;
const m2oName = v => (Array.isArray(v) ? String(v[1]).slice(0, 120) : null);
const txt = (v, n) => (v ? String(v).slice(0, n) : null);
const plain = html => String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/\n{3,}/g, '\n\n').trim();
const READ_ONLY = /^(search_read|search_count|read|fields_get)$/;
const chunks = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };

/* ---------- JSON-RPC (login + kalit) ---------- */
let rpcId = 0, uidCache = null;
export const resetOdooAuth = () => { uidCache = null; };
async function rpc(service, method, args) {
  const r = await fetch(`${config.odooUrl}/jsonrpc`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'sun-hightech-sotuv-dashboard' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'call', id: ++rpcId, params: { service, method, args } }),
    signal: AbortSignal.timeout(config.odooTimeoutMs)
  });
  if (!r.ok) throw new OdooError(`Odoo HTTP ${r.status}`, 'http');
  const j = await r.json();
  if (j.error) {
    const msg = j.error.data?.message || j.error.message || 'Odoo xatosi';
    throw new OdooError(String(msg).slice(0, 300), /access denied|accessdenied|session expired/i.test(String(msg)) ? 'auth' : 'rpc');
  }
  return j.result;
}
async function uid() {
  if (uidCache) return uidCache;
  const u = await rpc('common', 'authenticate', [config.odooDb, config.odooLogin, config.odooKey, {}]);
  if (!u) throw new OdooError('Odoo kirish rad etildi: login yoki API kalit noto‘g‘ri', 'auth');
  uidCache = u;
  return u;
}
async function viaJsonRpc(model, method, args, kw) {
  const exec = async () => rpc('object', 'execute_kw', [config.odooDb, await uid(), config.odooKey, model, method, args, kw]);
  try { return await exec(); }
  catch (e) { if (e.code === 'auth' && uidCache) { uidCache = null; return exec(); } throw e; }
}

/* ---------- JSON-2 (bearer kalit) — Odoo 19 ---------- */
async function viaJson2(model, method, args, kw) {
  const body = method === 'search_read' ? { domain: args[0] || [], ...kw }
    : method === 'search_count' ? { domain: args[0] || [] }
    : method === 'read' ? { ids: args[0], ...kw }
    : { ...kw };
  const r = await fetch(`${config.odooUrl}/json/2/${model}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `bearer ${config.odooKey}`, ...(config.odooDb ? { 'X-Odoo-Database': config.odooDb } : {}), 'User-Agent': 'sun-hightech-sotuv-dashboard' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(config.odooTimeoutMs)
  });
  const t = await r.text();
  if (!r.ok) {
    let msg = t.slice(0, 300); try { const j = JSON.parse(t); msg = j.message || j.name || msg; } catch { /* matn qoladi */ }
    if (r.status === 401 || r.status === 403) throw new OdooError(`Odoo kirish rad etildi: ${msg}`.slice(0, 300), 'auth');
    throw new OdooError(`${model}.${method} HTTP ${r.status}: ${msg}`.slice(0, 300), /not allowed|access/i.test(msg) ? 'access' : 'http');
  }
  return JSON.parse(t);
}

/* Model usuli — faqat o‘qish usullari o‘tadi */
export async function odoo(model, method, args = [], kw = {}) {
  if (!READ_ONLY.test(method)) throw new OdooError(`yozuv usuli taqiqlangan: ${method}`, 'readonly');
  return odooMode() === 'json2' ? viaJson2(model, method, args, kw) : viaJsonRpc(model, method, args, kw);
}
/* Hammasini sahifalab olish — bitta katta javob xotirani yemasin */
async function allRows(model, domain, fields, order = 'id') {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await odoo(model, 'search_read', [domain], { fields, limit: PAGE, offset, order });
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}
const teamDomain = () => (config.odooTeams.length ? [['team_id', 'in', config.odooTeams]] : []);
const sinceStamp = () => stamp(now() - config.odooSinceDays * DAY);

/* ---------- ma’lumotnomalar ---------- */
async function syncRefs() {
  const teams = await allRows('crm.team', [], ['name']);
  const stages = await allRows('crm.stage', [], ['name', 'sequence', 'is_won'], 'sequence, id');
  const users = await allRows('res.users', [['share', '=', false]], ['name']);
  const lost = await allRows('crm.lost.reason', [], ['name']);
  const sources = await allRows('utm.source', [], ['name']);
  tx(() => {
    for (const t of teams) run('INSERT INTO odoo_teams(id,name) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name', t.id, t.name);
    for (const s of stages) run('INSERT INTO odoo_stages(id,name,sequence,is_won) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, sequence=excluded.sequence, is_won=excluded.is_won',
      s.id, s.name, s.sequence, s.is_won ? 1 : 0);
    for (const u of users) run('INSERT INTO odoo_users(id,name) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name', u.id, u.name);
    for (const r of lost) run('INSERT INTO odoo_lost_reasons(id,name) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name', r.id, r.name);
    for (const r of sources) run('INSERT INTO odoo_sources(id,name) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name', r.id, r.name);
  });
  return { teams: teams.length, stages: stages.length, users: users.length };
}

/* ---------- lidlar (faol + yo‘qotilgan), write_date bo‘yicha o‘sib boruvchi ---------- */
const LEAD_FIELDS = ['name', 'stage_id', 'team_id', 'user_id', 'source_id', 'lost_reason_id', 'active', 'probability', 'expected_revenue', 'tag_ids',
  'partner_name', 'contact_name', 'phone', 'email_from', 'city', 'create_date', 'date_open', 'date_last_stage_update', 'date_closed', 'write_date'];
async function syncLeads() {
  const wm = kvGet('odoo_wm_leads') || EPOCH;
  const first = wm === EPOCH;
  const rows = await allRows('crm.lead', [['active', 'in', [true, false]], ['write_date', '>', wm], ...teamDomain()], LEAD_FIELDS, 'write_date, id');
  let max = wm;
  tx(() => {
    for (const l of rows) {
      // O‘z tariximiz: Odoo tracking yopiq bo‘lsa ham bosqich o‘tishlari ko‘rinsin. Birinchi sinxronda — hozirgi bosqichga kirish vaqti (date_last_stage_update).
      const prev = one('SELECT stage_id FROM odoo_leads WHERE id=?', l.id);
      const stage = m2o(l.stage_id), at = utc(l.date_last_stage_update) || utc(l.write_date) || now();
      if (!prev) run('INSERT INTO odoo_stage_log(lead_id,from_stage,to_stage,at,author,source) VALUES(?,?,?,?,?,?)', l.id, null, stage, first ? at : (utc(l.create_date) || at), m2oName(l.user_id), first ? 'snapshot' : 'sync');
      else if (prev.stage_id !== stage) run('INSERT INTO odoo_stage_log(lead_id,from_stage,to_stage,at,author,source) VALUES(?,?,?,?,?,?)', l.id, prev.stage_id, stage, at, m2oName(l.user_id), 'sync');
      run(`INSERT INTO odoo_leads(id,name,stage_id,team_id,user_id,source_id,lost_reason_id,active,probability,expected_revenue,tags,partner,contact,phone,email,city,created_at,opened_at,stage_at,closed_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, stage_id=excluded.stage_id, team_id=excluded.team_id, user_id=excluded.user_id,
        source_id=excluded.source_id, lost_reason_id=excluded.lost_reason_id, active=excluded.active, probability=excluded.probability, expected_revenue=excluded.expected_revenue,
        tags=excluded.tags, partner=excluded.partner, contact=excluded.contact, phone=excluded.phone, email=excluded.email, city=excluded.city,
        created_at=excluded.created_at, opened_at=excluded.opened_at, stage_at=excluded.stage_at, closed_at=excluded.closed_at, updated_at=excluded.updated_at`,
        l.id, String(l.name || '').slice(0, 200), m2o(l.stage_id), m2o(l.team_id), m2o(l.user_id), m2o(l.source_id), m2o(l.lost_reason_id), l.active ? 1 : 0,
        Number(l.probability) || 0, Math.round(Number(l.expected_revenue) || 0), JSON.stringify(l.tag_ids || []),
        txt(l.partner_name, 120), txt(l.contact_name, 120), txt(l.phone, 40), txt(l.email_from, 120), txt(l.city, 80),
        utc(l.create_date), utc(l.date_open), utc(l.date_last_stage_update), utc(l.date_closed), utc(l.write_date));
      if (l.write_date > max) max = l.write_date;
    }
  });
  if (rows.length) kvSet('odoo_wm_leads', max);
  return rows.length;
}
const knownLeadIds = () => all('SELECT id FROM odoo_leads').map(r => r.id);

/* ---------- bosqich tarixi (Odoo tracking): kim, qachon, qaysi bosqichdan qaysiga.
   Birinchi marta — faqat bizdagi lidlar bo‘yicha (res_id bo‘laklab), ODOO_SINCE_DAYS ichida; keyin — create_date bo‘yicha.
   mail.tracking.value oddiy foydalanuvchiga yopiq bo‘lishi mumkin — ruxsat bo‘lmasa jimgina o‘tkaziladi (o‘z tariximiz syncLeads’da). ---------- */
const TV_FIELDS = ['mail_message_id', 'old_value_integer', 'new_value_integer', 'create_date'];
const TV_BASE = [['field_id.name', '=', 'stage_id'], ['field_id.model', '=', 'crm.lead']];
async function syncStageLog() {
  if (kvGet('odoo_tracking_denied')) return 0;
  const wm = kvGet('odoo_wm_stagelog');
  let tv = [];
  try {
    if (!wm) {
      for (const ids of chunks(knownLeadIds(), CHUNK)) tv.push(...await allRows('mail.tracking.value', [...TV_BASE, ['mail_message_id.res_id', 'in', ids], ['create_date', '>', sinceStamp()]], TV_FIELDS, 'create_date, id'));
    } else tv = await allRows('mail.tracking.value', [...TV_BASE, ['create_date', '>', wm]], TV_FIELDS, 'create_date, id');
  } catch (e) {
    if (!/not allowed|access denied|AccessError|access/i.test(String(e.message))) throw e;
    kvSet('odoo_tracking_denied', 1);
    audit('sys', 'Odoo sinxron', 'Bosqich tarixi (mail.tracking.value) yopiq — o‘z tariximiz yuritiladi', { result: 'Administrator huquqli API foydalanuvchi bo‘lsa to‘liq tarix olinadi' });
    return 0;
  }
  let max = wm || sinceStamp();
  if (!tv.length) { kvSet('odoo_wm_stagelog', max); return 0; }
  const msgIds = [...new Set(tv.map(x => m2o(x.mail_message_id)).filter(Boolean))];
  const msgs = new Map();
  for (const ids of chunks(msgIds, PAGE)) for (const m of await odoo('mail.message', 'read', [ids], { fields: ['res_id', 'model', 'date', 'author_id'] })) msgs.set(m.id, m);
  const known = new Set(knownLeadIds());
  tx(() => {
    for (const x of tv) {
      const m = msgs.get(m2o(x.mail_message_id));
      if (x.create_date > max) max = x.create_date;
      if (!m || m.model !== 'crm.lead' || !known.has(m.res_id)) continue;
      run('INSERT INTO odoo_stage_log(odoo_id,lead_id,from_stage,to_stage,at,author,source) VALUES(?,?,?,?,?,?,?) ON CONFLICT(odoo_id) DO UPDATE SET lead_id=excluded.lead_id, from_stage=excluded.from_stage, to_stage=excluded.to_stage, at=excluded.at, author=excluded.author',
        x.id, m.res_id, x.old_value_integer || null, x.new_value_integer || null, utc(m.date || x.create_date), m2oName(m.author_id), 'odoo');
      // Odoo tarixi kelgach — o‘sha o‘tish uchun bizning «sync» yozuvimiz ortiqcha
      run(`DELETE FROM odoo_stage_log WHERE source IN ('sync','snapshot') AND lead_id=? AND to_stage IS ? AND odoo_id IS NULL`, m.res_id, x.new_value_integer || null);
    }
  });
  kvSet('odoo_wm_stagelog', max);
  return tv.length;
}

/* ---------- izohlar va xatlar (uchrashuvdan keyin menejer nima yozgan). Birinchi marta — bizdagi lidlar bo‘yicha, ODOO_SINCE_DAYS ichida. ---------- */
const MSG_FIELDS = ['res_id', 'date', 'author_id', 'body', 'message_type'];
async function syncMessages() {
  const wm = kvGet('odoo_wm_messages');
  let rows = [];
  if (!wm) {
    for (const ids of chunks(knownLeadIds(), CHUNK)) rows.push(...await allRows('mail.message', [['model', '=', 'crm.lead'], ['res_id', 'in', ids], ['message_type', 'in', ['comment', 'email']], ['date', '>', sinceStamp()]], MSG_FIELDS, 'date, id'));
  } else rows = await allRows('mail.message', [['model', '=', 'crm.lead'], ['message_type', 'in', ['comment', 'email']], ['date', '>', wm]], MSG_FIELDS, 'date, id');
  let max = wm || sinceStamp();
  const known = new Set(knownLeadIds());
  tx(() => {
    for (const m of rows) {
      if (m.date > max) max = m.date;
      const body = plain(m.body).slice(0, 2000);
      if (!body || !known.has(m.res_id)) continue;
      run('INSERT INTO odoo_messages(id,lead_id,at,author,kind,body) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body, author=excluded.author',
        m.id, m.res_id, utc(m.date), m2oName(m.author_id), m.message_type, body);
    }
  });
  kvSet('odoo_wm_messages', max);
  return rows.length;
}

/* ---------- sinxron: har 5 daqiqada yoki qo‘lda ---------- */
let busy = false;
export async function syncOdoo({ force = false, who = 'tizim' } = {}) {
  if (!odooLive()) { setIntegration('odoo', 'off', 'ODOO_URL va ODOO_API_KEY kiritilmagan'); return null; }
  if (busy) return null;
  const last = Number(kvGet('odoo_sync_at') || 0);
  if (!force && now() - last < SYNC_EVERY) return null;
  busy = true;
  const t0 = now();
  try {
    const first = !kvGet('odoo_wm_leads');
    const refs = await syncRefs();
    const leads = await syncLeads(), log = await syncStageLog(), msgs = await syncMessages();
    kvSet('odoo_sync_at', now());
    const total = one('SELECT count(*) n FROM odoo_leads').n;
    setIntegration('odoo', 'ok', `${total} lid · ${refs.stages} bosqich · ${refs.users} foydalanuvchi · ${odooMode()} · oxirgi sinxron ${stamp(now() + 5 * 3600e3).slice(0, 16)}`);
    audit('sys', 'Odoo sinxron', first ? 'Birinchi sinxron' : 'Sinxron', { data: `${leads} lid, ${log} bosqich o‘tishi, ${msgs} izoh · ${Math.round((now() - t0) / 1000)} s`, result: 'OK' });
    return { leads, log, msgs, total, first };
  } catch (e) {
    setIntegration('odoo', 'error', String(e.message || e).slice(0, 300));
    audit('sys', 'Odoo sinxron', 'Sinxron xatosi', { result: String(e.message || e).slice(0, 300) });
    if (who !== 'tizim') throw e;
    return null;
  } finally { busy = false; }
}
export const odooTick = () => syncOdoo().catch(e => console.error('odoo', e));

export function odooStatus() {
  const int = one('SELECT * FROM integrations WHERE name=?', 'odoo');
  return {
    live: odooLive(), mode: odooMode(), host: config.odooUrl ? new URL(config.odooUrl).host : null, db: config.odooDb || null, teams_filter: config.odooTeams,
    state: int?.state || 'off', detail: int?.detail || '', synced_at: Number(kvGet('odoo_sync_at') || 0) || null,
    leads: one('SELECT count(*) n FROM odoo_leads').n, stages: one('SELECT count(*) n FROM odoo_stages').n,
    teams: all('SELECT t.id, t.name, (SELECT count(*) FROM odoo_leads l WHERE l.team_id=t.id) leads FROM odoo_teams t ORDER BY leads DESC')
  };
}
