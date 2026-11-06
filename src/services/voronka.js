import { one, all } from '../db.js';
import { now } from '../util.js';
import { staffForOdooUser } from './nazorat.js';

/*
  Voronka — Odoo nusxasi (services/odoo.js) bo‘yicha sotuv voronkasi tahlili. Mijozning uchta savoli (doska, 2026-11-06):
  lid qayerda tushib qolyapti · nimaga · kim tomonidan. Hammasi SQL, o‘qish; Odoo’ga so‘rov yo‘q.
  - «Qayerda»: har bosqichda hozir nechta faol lid, nechtasi shu bosqichda yo‘qotilgan (Odoo yo‘qotilgan lidning bosqichini saqlaydi),
    bosqichda o‘rtacha va eng uzoq turish, 24/72 soatdan oshganlar.
  - «Nimaga»: yo‘qotish sabablari (crm.lost.reason) va sababsiz yo‘qotilganlar; oxirgi izoh.
  - «Kim»: menejer kesimida faol / yo‘qotilgan / yutilgan / qotib qolgan.
  Davr — lid yaratilgan sana (created_at) bo‘yicha; «hozir bosqichda» — faol lidlar holati.
*/

const DAY = 864e5, HOUR = 3600e3;
const days = ms => Math.round(ms / DAY * 10) / 10;

export function defaultTeam() {
  return one(`SELECT t.id, t.name, (SELECT count(*) FROM odoo_leads l WHERE l.team_id=t.id) n FROM odoo_teams t ORDER BY n DESC, t.id LIMIT 1`) || null;
}

export function voronka({ team, days: period = 30, t = now() } = {}) {
  const teams = all(`SELECT t.id, t.name, (SELECT count(*) FROM odoo_leads l WHERE l.team_id=t.id) leads FROM odoo_teams t ORDER BY leads DESC, t.id`);
  const teamId = team === undefined ? (defaultTeam()?.id ?? null) : team;
  const from = period ? t - period * DAY : 0;
  // Davr va jamoa filtri — hamma so‘rovlarda bir xil
  const w = `l.created_at>=? ${teamId != null ? 'AND l.team_id=?' : ''}`, a = teamId != null ? [from, teamId] : [from];
  const synced = one('SELECT count(*) n FROM odoo_leads').n;

  const totals = one(`SELECT count(*) total, sum(l.active=1) active, sum(l.active=0) lost,
      sum(l.active=1 AND s.is_won=1) won
    FROM odoo_leads l LEFT JOIN odoo_stages s ON s.id=l.stage_id WHERE ${w}`, ...a);
  const stages = all(`SELECT s.id, s.name, s.sequence, s.is_won,
      (SELECT count(*) FROM odoo_leads l WHERE l.stage_id=s.id AND l.active=1 AND ${w}) active,
      (SELECT count(*) FROM odoo_leads l WHERE l.stage_id=s.id AND l.active=0 AND ${w}) lost_here,
      (SELECT count(*) FROM odoo_leads l WHERE l.stage_id=s.id AND l.active=1 AND l.stage_at<? AND ${w}) over_24h,
      (SELECT count(*) FROM odoo_leads l WHERE l.stage_id=s.id AND l.active=1 AND l.stage_at<? AND ${w}) over_72h,
      (SELECT avg(?-l.stage_at) FROM odoo_leads l WHERE l.stage_id=s.id AND l.active=1 AND ${w}) avg_ms,
      (SELECT max(?-l.stage_at) FROM odoo_leads l WHERE l.stage_id=s.id AND l.active=1 AND ${w}) max_ms,
      (SELECT count(DISTINCT g.lead_id) FROM odoo_stage_log g JOIN odoo_leads l ON l.id=g.lead_id WHERE g.to_stage=s.id AND ${w}) reached
    FROM odoo_stages s ORDER BY s.sequence, s.id`, ...a, ...a, t - 24 * HOUR, ...a, t - 72 * HOUR, ...a, t, ...a, t, ...a, ...a)
    .filter(s => s.active || s.lost_here || s.reached)
    .map(s => ({ id: s.id, name: s.name, is_won: Boolean(s.is_won), active: s.active, lost_here: s.lost_here, reached: s.reached,
      over_24h: s.over_24h, over_72h: s.over_72h, avg_days: s.avg_ms != null ? days(s.avg_ms) : null, max_days: s.max_ms != null ? days(s.max_ms) : null }));

  const reasons = all(`SELECT COALESCE(r.name, 'Sabab ko‘rsatilmagan') name, l.lost_reason_id id, count(*) n FROM odoo_leads l LEFT JOIN odoo_lost_reasons r ON r.id=l.lost_reason_id
    WHERE l.active=0 AND ${w} GROUP BY l.lost_reason_id ORDER BY n DESC`, ...a);
  const users = all(`SELECT COALESCE(u.name, 'Mas’ul yo‘q') name, l.user_id id, count(*) total, sum(l.active=1) active, sum(l.active=0) lost,
      sum(l.active=1 AND s.is_won=1) won, sum(l.active=1 AND COALESCE(s.is_won,0)=0 AND l.stage_at<?) over_24h
    FROM odoo_leads l LEFT JOIN odoo_users u ON u.id=l.user_id LEFT JOIN odoo_stages s ON s.id=l.stage_id
    WHERE ${w} GROUP BY l.user_id ORDER BY total DESC`, t - 24 * HOUR, ...a);
  const sources = all(`SELECT COALESCE(src.name, 'Manba yo‘q') name, l.source_id id, count(*) total, sum(l.active=0) lost, sum(l.active=1 AND s.is_won=1) won
    FROM odoo_leads l LEFT JOIN odoo_sources src ON src.id=l.source_id LEFT JOIN odoo_stages s ON s.id=l.stage_id
    WHERE ${w} GROUP BY l.source_id ORDER BY total DESC`, ...a);
  // Qotib qolganlar: faol, yutilmagan, bosqichda 24 soatdan ko‘p; eng uzoq turganlar oldin. Oxirgi izoh — nima bo‘lganini tushunish uchun.
  const stuck = all(`SELECT l.id, l.name, s.name stage, u.name user, l.stage_at, l.created_at,
      (SELECT m.body FROM odoo_messages m WHERE m.lead_id=l.id ORDER BY m.at DESC LIMIT 1) last_note,
      (SELECT m.at FROM odoo_messages m WHERE m.lead_id=l.id ORDER BY m.at DESC LIMIT 1) last_note_at
    FROM odoo_leads l LEFT JOIN odoo_stages s ON s.id=l.stage_id LEFT JOIN odoo_users u ON u.id=l.user_id
    WHERE l.active=1 AND COALESCE(s.is_won,0)=0 AND l.stage_at<? AND ${w} ORDER BY l.stage_at LIMIT 40`, t - 24 * HOUR, ...a)
    .map(x => ({ ...x, days_on_stage: days(t - x.stage_at), age_days: days(t - x.created_at), last_note: x.last_note ? String(x.last_note).slice(0, 160) : null }));

  const conv = totals.total ? Math.round(100 * (totals.won || 0) / totals.total) : null;
  return { synced, teams, team: teams.find(x => x.id === teamId) || null, period_days: period, from, as_of: t,
    totals: { total: totals.total || 0, active: totals.active || 0, lost: totals.lost || 0, won: totals.won || 0, conversion: conv },
    stages, reasons: reasons.map(r => ({ ...r, id: r.id ?? 0 })), users: users.map(u => ({ ...u, id: u.id ?? 0 })), sources: sources.map(s => ({ ...s, id: s.id ?? 0 })), stuck };
}

/* ---------- Chuqur ko‘rish: bosqich / menejer / sabab / manba bo‘yicha lidlar ro‘yxati, to‘liq ma’lumot bilan.
   0 — «yo‘q» (mas’ulsiz, sababsiz, manbasiz); null — filtr qo‘yilmagan. ---------- */
export function leadList({ team, days: period = 30, stage = null, user = null, reason = null, source = null, lost = null, t = now(), limit = 300 } = {}) {
  const teamId = team === undefined ? (defaultTeam()?.id ?? null) : team;
  const from = period ? t - period * DAY : 0;
  const w = ['l.created_at>=?'], a = [from];
  if (teamId != null) { w.push('l.team_id=?'); a.push(teamId); }
  if (stage != null) { w.push('l.stage_id=?'); a.push(stage); }
  if (user != null) { if (user === 0) w.push('l.user_id IS NULL'); else { w.push('l.user_id=?'); a.push(user); } }
  if (reason != null) { if (reason === 0) w.push('l.active=0 AND l.lost_reason_id IS NULL'); else { w.push('l.lost_reason_id=?'); a.push(reason); } }
  if (source != null) { if (source === 0) w.push('l.source_id IS NULL'); else { w.push('l.source_id=?'); a.push(source); } }
  if (lost === true) w.push('l.active=0'); else if (lost === false) w.push('l.active=1');
  const rows = all(`SELECT l.id, l.name, l.partner, l.contact, l.phone, l.email, l.city, l.active, l.probability, l.expected_revenue, l.created_at, l.stage_at, l.closed_at,
      s.name stage, s.is_won, u.name user, r.name reason, src.name source,
      (SELECT m.body FROM odoo_messages m WHERE m.lead_id=l.id ORDER BY m.at DESC LIMIT 1) last_note,
      (SELECT m.at FROM odoo_messages m WHERE m.lead_id=l.id ORDER BY m.at DESC LIMIT 1) last_note_at,
      (SELECT count(*) FROM odoo_messages m WHERE m.lead_id=l.id) notes
    FROM odoo_leads l LEFT JOIN odoo_stages s ON s.id=l.stage_id LEFT JOIN odoo_users u ON u.id=l.user_id
    LEFT JOIN odoo_lost_reasons r ON r.id=l.lost_reason_id LEFT JOIN odoo_sources src ON src.id=l.source_id
    WHERE ${w.join(' AND ')} ORDER BY l.active DESC, l.stage_at LIMIT ?`, ...a, limit);
  return rows.map(x => ({ ...x, is_won: Boolean(x.is_won), days_on_stage: x.active && !x.is_won ? days(t - x.stage_at) : null, age_days: days(t - x.created_at),
    status: !x.active ? 'lost' : x.is_won ? 'won' : 'active', last_note: x.last_note ? String(x.last_note).slice(0, 200) : null }));
}

/* Lid kartasi: hamma maydon, bosqich tarixi (nomlar bilan), barcha izohlar, paneldagi mas’ul */
export function leadDetail(id, { t = now() } = {}) {
  const l = one(`SELECT l.*, s.name stage, s.is_won, t.name team, u.name user, r.name reason, src.name source
    FROM odoo_leads l LEFT JOIN odoo_stages s ON s.id=l.stage_id LEFT JOIN odoo_teams t ON t.id=l.team_id LEFT JOIN odoo_users u ON u.id=l.user_id
    LEFT JOIN odoo_lost_reasons r ON r.id=l.lost_reason_id LEFT JOIN odoo_sources src ON src.id=l.source_id WHERE l.id=?`, id);
  if (!l) return null;
  const history = all(`SELECT g.at, g.author, g.source, fs.name from_stage, ts.name to_stage FROM odoo_stage_log g
    LEFT JOIN odoo_stages fs ON fs.id=g.from_stage LEFT JOIN odoo_stages ts ON ts.id=g.to_stage WHERE g.lead_id=? ORDER BY g.at, g.id`, id);
  const notes = all('SELECT id, at, author, kind, body FROM odoo_messages WHERE lead_id=? ORDER BY at DESC', id);
  const staff = staffForOdooUser(l.user_id);
  let tags = []; try { tags = JSON.parse(l.tags || '[]'); } catch { tags = []; }
  return { ...l, is_won: Boolean(l.is_won), tags,
    status: !l.active ? 'lost' : l.is_won ? 'won' : 'active', days_on_stage: l.active && !l.is_won ? days(t - l.stage_at) : null, age_days: days(t - l.created_at),
    staff: staff ? { name: staff.name, linked: Boolean(staff.tg_chat_id), how: staff.how } : null, history, notes };
}
