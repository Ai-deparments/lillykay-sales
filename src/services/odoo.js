import { config } from '../config.js';
import { one, all, run, tx, kvGet, kvSet } from '../db.js';
import { now } from '../util.js';
import { setIntegration } from './settings.js';
import { audit } from '../core/audit.js';

/*
  Odoo CRM → tizim sinxroni (faqat O‘QISH). Mijozning Odoo 19 (JSON-RPC /jsonrpc, login + API kalit).
  Manba: crm.lead (faol va yo‘qotilganlar), crm.stage, crm.team, res.users, crm.lost.reason, utm.source,
  bosqich o‘zgarish tarixi (mail.tracking.value → stage_id) va menejer izohlari (mail.message, comment/email).
  Har 5 daqiqada o‘zgarganlari (write_date bo‘yicha); birinchi marta — hammasi. Odoo’ga hech narsa yozilmaydi.
  Vaqt: Odoo UTC «YYYY-MM-DD HH:MM:SS» → epoch ms.
*/

const SYNC_EVERY = 5 * 60e3, PAGE = 500, EPOCH = '1970-01-01 00:00:00';

export class OdooError extends Error {
  constructor(message, code = 'odoo') { super(message); this.code = code; }
}

export const odooLive = () => Boolean(config.odooUrl && config.odooKey);
const utc = s => s ? Date.parse(String(s).replace(' ', 'T') + 'Z') : null;
const stamp = ms => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const m2o = v => (Array.isArray(v) ? v[0] : v) || null;
const m2oName = v => (Array.isArray(v) ? String(v[1]).slice(0, 120) : null);
const plain = html => String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/\n{3,}/g, '\n\n').trim();

/* ---------- JSON-RPC ---------- */
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
/* Model usuli — faqat o‘qish usullari o‘tadi */
export async function odoo(model, method, args = [], kw = {}) {
  if (!/^(search_read|search_count|read|fields_get)$/.test(method)) throw new OdooError(`yozuv usuli taqiqlangan: ${method}`, 'readonly');
  const exec = async () => rpc('object', 'execute_kw', [config.odooDb, await uid(), config.odooKey, model, method, args, kw]);
  try { return await exec(); }
  catch (e) { if (e.code === 'auth' && uidCache) { uidCache = null; return exec(); } throw e; }
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
  'create_date', 'date_open', 'date_last_stage_update', 'date_closed', 'write_date'];
async function syncLeads() {
  const wm = kvGet('odoo_wm_leads') || EPOCH;
  const rows = await allRows('crm.lead', [['active', 'in', [true, false]], ['write_date', '>', wm]], LEAD_FIELDS, 'write_date, id');
  let max = wm;
  tx(() => {
    for (const l of rows) {
      run(`INSERT INTO odoo_leads(id,name,stage_id,team_id,user_id,source_id,lost_reason_id,active,probability,expected_revenue,tags,created_at,opened_at,stage_at,closed_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, stage_id=excluded.stage_id, team_id=excluded.team_id, user_id=excluded.user_id,
        source_id=excluded.source_id, lost_reason_id=excluded.lost_reason_id, active=excluded.active, probability=excluded.probability, expected_revenue=excluded.expected_revenue,
        tags=excluded.tags, created_at=excluded.created_at, opened_at=excluded.opened_at, stage_at=excluded.stage_at, closed_at=excluded.closed_at, updated_at=excluded.updated_at`,
        l.id, String(l.name || '').slice(0, 200), m2o(l.stage_id), m2o(l.team_id), m2o(l.user_id), m2o(l.source_id), m2o(l.lost_reason_id), l.active ? 1 : 0,
        Number(l.probability) || 0, Math.round(Number(l.expected_revenue) || 0), JSON.stringify(l.tag_ids || []),
        utc(l.create_date), utc(l.date_open), utc(l.date_last_stage_update), utc(l.date_closed), utc(l.write_date));
      if (l.write_date > max) max = l.write_date;
    }
  });
  if (rows.length) kvSet('odoo_wm_leads', max);
  return rows.length;
}

/* ---------- bosqich tarixi: kim, qachon, qaysi bosqichdan qaysiga ---------- */
async function syncStageLog() {
  const wm = kvGet('odoo_wm_stagelog') || EPOCH;
  const tv = await allRows('mail.tracking.value', [['field_id.name', '=', 'stage_id'], ['field_id.model', '=', 'crm.lead'], ['create_date', '>', wm]],
    ['mail_message_id', 'old_value_integer', 'new_value_integer', 'create_date'], 'create_date, id');
  if (!tv.length) return 0;
  const msgIds = [...new Set(tv.map(x => m2o(x.mail_message_id)).filter(Boolean))];
  const msgs = new Map();
  for (let i = 0; i < msgIds.length; i += PAGE) {
    for (const m of await odoo('mail.message', 'read', [msgIds.slice(i, i + PAGE)], { fields: ['res_id', 'model', 'date', 'author_id'] })) msgs.set(m.id, m);
  }
  let max = wm;
  tx(() => {
    for (const x of tv) {
      const m = msgs.get(m2o(x.mail_message_id));
      if (!m || m.model !== 'crm.lead') continue;
      run('INSERT INTO odoo_stage_log(id,lead_id,from_stage,to_stage,at,author) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET lead_id=excluded.lead_id, from_stage=excluded.from_stage, to_stage=excluded.to_stage, at=excluded.at, author=excluded.author',
        x.id, m.res_id, x.old_value_integer || null, x.new_value_integer || null, utc(m.date || x.create_date), m2oName(m.author_id));
      if (x.create_date > max) max = x.create_date;
    }
  });
  kvSet('odoo_wm_stagelog', max);
  return tv.length;
}

/* ---------- izohlar va xatlar (uchrashuvdan keyin menejer nima yozgan) ---------- */
async function syncMessages() {
  const wm = kvGet('odoo_wm_messages') || EPOCH;
  const rows = await allRows('mail.message', [['model', '=', 'crm.lead'], ['message_type', 'in', ['comment', 'email']], ['date', '>', wm]],
    ['res_id', 'date', 'author_id', 'body', 'message_type'], 'date, id');
  let max = wm;
  tx(() => {
    for (const m of rows) {
      const body = plain(m.body).slice(0, 2000);
      if (m.date > max) max = m.date;
      if (!body) continue;
      run('INSERT INTO odoo_messages(id,lead_id,at,author,kind,body) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body, author=excluded.author',
        m.id, m.res_id, utc(m.date), m2oName(m.author_id), m.message_type, body);
    }
  });
  if (rows.length) kvSet('odoo_wm_messages', max);
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
    setIntegration('odoo', 'ok', `${total} lid · ${refs.stages} bosqich · ${refs.users} foydalanuvchi · oxirgi sinxron ${stamp(now() + 5 * 3600e3).slice(0, 16)}`);
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
    live: odooLive(), host: config.odooUrl ? new URL(config.odooUrl).host : null, db: config.odooDb || null,
    state: int?.state || 'off', detail: int?.detail || '', synced_at: Number(kvGet('odoo_sync_at') || 0) || null,
    leads: one('SELECT count(*) n FROM odoo_leads').n, stages: one('SELECT count(*) n FROM odoo_stages').n,
    teams: all('SELECT t.id, t.name, (SELECT count(*) FROM odoo_leads l WHERE l.team_id=t.id) leads FROM odoo_teams t ORDER BY leads DESC')
  };
}
