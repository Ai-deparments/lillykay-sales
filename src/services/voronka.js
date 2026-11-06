import { one, all } from '../db.js';
import { now } from '../util.js';

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

  const reasons = all(`SELECT COALESCE(r.name, 'Sabab ko‘rsatilmagan') name, count(*) n FROM odoo_leads l LEFT JOIN odoo_lost_reasons r ON r.id=l.lost_reason_id
    WHERE l.active=0 AND ${w} GROUP BY l.lost_reason_id ORDER BY n DESC`, ...a);
  const users = all(`SELECT COALESCE(u.name, 'Mas’ul yo‘q') name, l.user_id id, count(*) total, sum(l.active=1) active, sum(l.active=0) lost,
      sum(l.active=1 AND s.is_won=1) won, sum(l.active=1 AND COALESCE(s.is_won,0)=0 AND l.stage_at<?) over_24h
    FROM odoo_leads l LEFT JOIN odoo_users u ON u.id=l.user_id LEFT JOIN odoo_stages s ON s.id=l.stage_id
    WHERE ${w} GROUP BY l.user_id ORDER BY total DESC`, t - 24 * HOUR, ...a);
  const sources = all(`SELECT COALESCE(src.name, 'Manba yo‘q') name, count(*) total, sum(l.active=0) lost, sum(l.active=1 AND s.is_won=1) won
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
    stages, reasons, users, sources, stuck };
}
