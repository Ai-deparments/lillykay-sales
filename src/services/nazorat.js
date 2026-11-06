import { config } from '../config.js';
import { one, all, run, kvGet, kvSet } from '../db.js';
import { now, esc, clip, inWindow } from '../util.js';
import { getSettings } from './settings.js';
import { audit } from '../core/audit.js';
import { sendStaff } from '../channels/telegram.js';

/*
  Nazorat 24 soat — mijoz talabi (2026-11-06): uchrashuvga o‘tkazilgan lid bilan menejer 24 soat ichida bog‘lanishi kerak,
  bo‘lmasa menejerga ham, rahbarga ham xabar ketsin; 1 / 2 / 3 kun qimirlamagan lidlar ko‘rinib tursin.
  «Harakat» — Odoo’dagi oxirgi iz: bosqichga kirish (stage_at), bosqich o‘tishi (odoo_stage_log) yoki izoh/xat (odoo_messages).
  Nazorat bosqichlari — sozlamada (Odoo bosqich id’lari); bo‘sh bo‘lsa nomidan topiladi (Ўчрашув / Тижорат таклиф).
  Xabar: menejerga (Odoo foydalanuvchisi ↔ panel xodimi: users.odoo_user_id yoki ism bo‘yicha) nazorat_hours dan keyin,
  rahbarlarga — nazorat_escalate_hours dan keyin yoki menejer panelga ulanmagan bo‘lsa. Har lid + daraja uchun bir marta (nazorat_alerts).
  Faqat ish vaqtida (work_from–work_to); tunda to‘plangani ertalab ketadi.
*/

const HOUR = 3600e3;
export const LEVELS = [24, 48, 72];
/* Kirill «Ў» (U+040E) kichik harfga «ў» bo‘ladi, «у» emas — shuning uchun ikkalasi ham */
const AUTO_STAGE = /[уў]чрашув|uchrashuv|тижорат|tijorat|taklif|таклиф|\bkp\b/i;

export function controlStages(s = getSettings()) {
  const ids = String(s.nazorat_stages || '').split(',').map(x => Number(x.trim())).filter(Boolean);
  const stages = all('SELECT id, name, sequence, is_won FROM odoo_stages ORDER BY sequence, id');
  const chosen = ids.length ? stages.filter(x => ids.includes(x.id)) : stages.filter(x => !x.is_won && AUTO_STAGE.test(x.name));
  return { stages, chosen, auto: !ids.length };
}

/* Panel xodimi ↔ Odoo foydalanuvchisi: avval aniq bog‘lam (odoo_user_id), bo‘lmasa ism bir xil bo‘lsa */
export function staffForOdooUser(odooUserId) {
  if (!odooUserId) return null;
  const byId = one('SELECT * FROM users WHERE active=1 AND odoo_user_id=?', odooUserId);
  if (byId) return byId;
  const ou = one('SELECT name FROM odoo_users WHERE id=?', odooUserId);
  return ou ? one('SELECT * FROM users WHERE active=1 AND lower(trim(name))=lower(trim(?))', ou.name) || null : null;
}
const levelOf = h => LEVELS.filter(l => h >= l).pop() || 0;
const teamList = () => all(`SELECT t.id, t.name, (SELECT count(*) FROM odoo_leads l WHERE l.team_id=t.id) leads FROM odoo_teams t ORDER BY leads DESC, t.id`);

/* Nazorat ro‘yxati: nazorat bosqichidagi faol lidlar, oxirgi harakatdan beri nazorat_hours dan ko‘p o‘tgan */
export function nazoratList({ t = now(), team = undefined, s = getSettings() } = {}) {
  const { chosen, stages, auto } = controlStages(s);
  const base = { stages, chosen, auto, hours: s.nazorat_hours, escalate: s.nazorat_escalate_hours, notify: Boolean(s.nazorat_notify), as_of: t, teams: teamList() };
  const stageIds = chosen.map(x => x.id);
  const teamId = team === undefined ? (one(`SELECT t.id FROM odoo_teams t ORDER BY (SELECT count(*) FROM odoo_leads l WHERE l.team_id=t.id) DESC, t.id LIMIT 1`)?.id ?? null) : team;
  if (!stageIds.length) return { ...base, team: teamId, totals: { over_24: 0, over_48: 0, over_72: 0, no_user: 0, notified: 0 }, by_user: [], items: [] };
  const q = stageIds.map(() => '?').join(',');
  const rows = all(`SELECT l.id, l.name, l.stage_id, s.name stage, l.user_id, u.name user, l.stage_at, l.created_at,
      (SELECT max(m.at) FROM odoo_messages m WHERE m.lead_id=l.id) last_msg_at,
      (SELECT max(g.at) FROM odoo_stage_log g WHERE g.lead_id=l.id) last_move_at,
      (SELECT m.body FROM odoo_messages m WHERE m.lead_id=l.id ORDER BY m.at DESC LIMIT 1) last_note
    FROM odoo_leads l JOIN odoo_stages s ON s.id=l.stage_id LEFT JOIN odoo_users u ON u.id=l.user_id
    WHERE l.active=1 AND l.stage_id IN (${q}) ${teamId != null ? 'AND l.team_id=?' : ''}`, ...stageIds, ...(teamId != null ? [teamId] : []));
  const alerts = new Set(all('SELECT lead_id, level FROM nazorat_alerts').map(a => `${a.lead_id}:${a.level}`));
  const staffCache = new Map();
  const staffOf = uid => { if (!staffCache.has(uid)) staffCache.set(uid, staffForOdooUser(uid)); return staffCache.get(uid); };
  const items = rows.map(r => {
    const last = Math.max(r.stage_at || 0, r.last_msg_at || 0, r.last_move_at || 0) || r.created_at || t;
    const hours = Math.floor((t - last) / HOUR);
    const staff = staffOf(r.user_id);
    return { id: r.id, name: r.name, stage: r.stage, stage_id: r.stage_id, user: r.user, user_id: r.user_id, last_at: last, hours, level: levelOf(hours),
      days: Math.round(hours / 24 * 10) / 10, last_note: r.last_note ? String(r.last_note).slice(0, 160) : null,
      alerted: LEVELS.filter(l => alerts.has(`${r.id}:${l}`)), staff: staff?.name || null, staff_linked: Boolean(staff?.tg_chat_id) };
  }).filter(x => x.hours >= s.nazorat_hours).sort((a, b) => b.hours - a.hours);
  const byUser = new Map();
  for (const x of items) {
    const k = x.user || 'Mas’ul yo‘q';
    const u = byUser.get(k) || { name: k, user_id: x.user_id, staff: x.staff, linked: x.staff_linked, n: 0, over_48: 0, over_72: 0, max_hours: 0 };
    u.n++; if (x.hours >= 48) u.over_48++; if (x.hours >= 72) u.over_72++; u.max_hours = Math.max(u.max_hours, x.hours);
    byUser.set(k, u);
  }
  return {
    ...base, team: teamId,
    totals: { over_24: items.length, over_48: items.filter(x => x.hours >= 48).length, over_72: items.filter(x => x.hours >= 72).length,
      no_user: items.filter(x => !x.user_id).length, notified: items.filter(x => x.alerted.length).length },
    by_user: [...byUser.values()].sort((a, b) => b.n - a.n), items
  };
}

/* ---------- xabarlar: har qabul qiluvchiga bir xabar (bitta lid — batafsil, ko‘p bo‘lsa — ro‘yxat) ---------- */
let sender = (user, text, buttons) => sendStaff(user, text, buttons);
export function setNazoratSender(fn) { sender = fn; }
const leaders = () => all(`SELECT * FROM users WHERE active=1 AND role IN ('rahbar','admin') AND tg_chat_id IS NOT NULL`);
const panelBtn = () => [[{ text: 'Nazorat ro‘yxati', url: `${config.publicUrl}/#nazorat` }]];
const hoursText = h => h >= 48 ? `${Math.floor(h / 24)} kun` : `${h} soat`;
const DIGEST_MAX = 8;

function line(x, { toLeader }) {
  return `• <b>${esc(x.name)}</b> — ${esc(x.stage)}, ${hoursText(x.hours)}${toLeader ? ` · ${esc(x.user || 'mas’ul yo‘q')}${x.user && !x.staff_linked ? ' (ulanmagan)' : ''}` : ''}` +
    (x.last_note ? `\n  izoh: «${esc(clip(x.last_note, 90))}»` : '');
}
function digest(items, { toLeader }) {
  const head = toLeader ? `<b>Nazoratsiz qolgan lidlar — ${items.length} ta</b>` : `<b>Sizning lidlaringiz harakatsiz — ${items.length} ta</b>`;
  const body = items.slice(0, DIGEST_MAX).map(x => line(x, { toLeader })).join('\n') + (items.length > DIGEST_MAX ? `\n… va yana ${items.length - DIGEST_MAX} ta` : '');
  const tail = toLeader ? (items.some(x => x.user && !x.staff_linked) ? '\n\n«ulanmagan» — menejer panelga ulanmagan, xabar unga yetmadi.' : '')
    : '\n\nIltimos, mijoz bilan bog‘laning va Odoo’da izoh qoldiring.';
  return `${head}\n${body}${tail}`;
}

/* Fon ishi (har soat, ish vaqtida). Yozuv faqat yetkazilgan xabar uchun — keyin ulansa, xabar baribir ketadi. */
export async function nazoratJob({ t = now(), force = false } = {}) {
  const s = getSettings();
  if (!s.nazorat_notify && !force) return null;
  const last = Number(kvGet('nazorat_at') || 0);
  if (!force && t - last < HOUR) return null;
  if (!force && !inWindow(t, s.work_from, s.work_to)) return null;
  kvSet('nazorat_at', t);
  const list = nazoratList({ t, team: null, s });
  // Qabul qiluvchi → { user, toLeader, items: [{ x, levels }] }
  const box = new Map();
  const put = (u, toLeader, x, level) => {
    const k = `${u.id}:${toLeader ? 'L' : 'M'}`;
    const b = box.get(k) || { user: u, toLeader, items: new Map() };
    const it = b.items.get(x.id) || { x, levels: [] };
    it.levels.push(level); b.items.set(x.id, it); box.set(k, b);
  };
  const lead = leaders();
  for (const x of list.items) {
    const staff = staffForOdooUser(x.user_id);
    for (const level of LEVELS) {
      if (x.hours < level || x.alerted.includes(level)) continue;
      if (level >= s.nazorat_hours && staff?.tg_chat_id) put(staff, false, x, level);
      if (level >= s.nazorat_escalate_hours || !staff?.tg_chat_id) for (const u of lead) { if (staff && u.id === staff.id) continue; put(u, true, x, level); }
    }
  }
  let sent = 0;
  const delivered = new Map(); // `${lead}:${level}` → to_user_id
  for (const b of box.values()) {
    const items = [...b.items.values()].map(v => v.x).sort((p, q) => q.hours - p.hours);
    const ok = await sender(b.user, digest(items, { toLeader: b.toLeader }), panelBtn());
    if (!ok) continue;
    sent++;
    for (const v of b.items.values()) for (const level of v.levels) if (!delivered.has(`${v.x.id}:${level}`)) delivered.set(`${v.x.id}:${level}`, b.user.id);
  }
  for (const [k, to] of delivered) { const [leadId, level] = k.split(':').map(Number); run('INSERT OR IGNORE INTO nazorat_alerts(lead_id,level,sent_at,to_user_id,delivered) VALUES(?,?,?,?,1)', leadId, level, t, to); }
  if (sent) audit('sys', 'Nazorat agenti', 'Nazoratsiz lidlar haqida xabar', { data: `${list.items.length} lid`, result: `${sent} xabar, ${delivered.size} lid-daraja` });
  return { leads: list.items.length, sent, marked: delivered.size };
}
