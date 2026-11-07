import { one, all, kvGet, kvSet } from '../db.js';
import { now, local, jparse } from '../util.js';
import { audit } from '../core/audit.js';
import { can } from '../core/auth.js';
import { logChange } from './settings.js';
import { defaultTeam } from './voronka.js';
import { WON_AT } from './tahlil.js';

/*
  KPI — B2B savdo bo‘limi (mijoz hujjati, Bobur, 2026-11-07): har menejer bo‘yicha reja / fakt va oylik hisob, Odoo nusxasidan aniq SQL.
  - Fiks (4 000 000) — davomat uchun; davomat HR/Telegram’dan keladi, biz hisoblamaymiz, faqat raqamni ko‘rsatamiz.
  - KPI 1 Uchrashuv (4/kun, 100/oy, ≥ 90 % → 2 000 000), KPI 2 Tijorat taklifi (4/kun, 100/oy, ≥ 80 %), KPI 3 Shartnoma (1/kun, 25/oy, ≥ 25).
  - Transport: har uchrashuv 20 000, oyiga 2 000 000 gacha.
  - Ish haftasi 6 kun (Du–Sha); oy rejasi oy uzunligidan qat’i nazar 100/100/25; «bugungi reja» = reja × o‘tgan ish kunlari (bugun bilan) ÷ oydagi ish kunlari.
  - Bo‘lim sotuv bonuslari (jamoa darajasida): haftalik pog‘onalar (Du–Ya, pog‘ona × 0.8 ≤ hajm bo‘lgan eng yuqorisi, qo‘shilmaydi),
    oylik 1.6 mlrd (≥ 80 % → 8 mln), choraklik 4.8 mlrd (≥ 80 % → 24 mln).
  Hodisa qoidasi: uchrashuv / taklif / shartnoma — lid tegishli bosqichga KIRGAN payt (odoo_stage_log.to_stage, from_stage bor, snapshot emas),
  davrda bir lid bir marta (qayta kiritish KPI’ni oshirmaydi); lidning mas’ul menejeriga (odoo_leads.user_id) yoziladi.
  Kelajakda bosqichni kim ko‘chirgani (odoo_stage_log.author) bo‘yicha ham hisoblash mumkin — hozircha mas’ul bo‘yicha.
  Sotuv hajmi: 'won' — yutuq bosqichiga o‘tgan lidlar (WON_AT, tahlil.js bilan bir xil) expected_revenue; 'contract' — shartnoma bosqichiga kirganlar.
  Bosqich topilmasa — null va KPI «sozlanmagan», xato tashlanmaydi. Sozlamalar — kv `kpi:settings` (JSON), rahbar o‘zgartiradi.
*/

const DAY = 864e5;
const KV_KEY = 'kpi:settings';
const HR_SEND_HOUR = 18;              // HR’ga kunlik hisobot — ish kuni oxirida (Toshkent), kuniga bir marta
const HR_RETRY_MS = 3600e3;           // yuborilmasa — bir soatdan keyin yana

export const DEFAULTS = {
  fixed: 4_000_000,
  meetings: { day: 4, month: 100, pct: 90, pay: 2_000_000 },
  offers: { day: 4, month: 100, pct: 80, pay: 2_000_000 },
  contracts: { day: 1, month: 25, pct: 100, pay: 2_000_000 },   // hujjat: ≥ 25 ta (takliflarning 25 %) — rejaning 100 %
  transport: { per: 20_000, max: 2_000_000 },
  work_dow: '1111110',                                          // Du–Sha
  sales: {
    week_tiers: [{ from: 400e6, bonus: 4e6 }, { from: 750e6, bonus: 7e6 }, { from: 1e9, bonus: 12e6 }, { from: 1.2e9, bonus: 15e6 },
      { from: 1.8e9, bonus: 18e6 }, { from: 2e9, bonus: 20e6 }, { from: 3e9, bonus: 25e6 }],
    week_pct: 80,
    month_plan: 1.6e9, month_pct: 80, month_bonus: 8e6,
    quarter_plan: 4.8e9, quarter_pct: 80, quarter_bonus: 24e6
  },
  stages: { meeting: null, offer: null, contract: null },      // Odoo bosqich id’lari — avtomatik topilganini almashtiradi
  sales_criterion: 'won',
  hr_webhook_url: ''
};
const KPIS = ['meetings', 'offers', 'contracts'];
const STAGE_OF = { meetings: 'meeting', offers: 'offer', contracts: 'contract' };
/* Kirill «Ў» kichik harfda «ў» — shuning uchun ikkalasi ham (nazorat.js bilan bir xil) */
const PATTERNS = { meeting: /[уў]чрашув|uchrashuv/i, offer: /тижорат|tijorat/i, contract: /шартнома|shartnoma/i };

/* ---------- Sozlamalar ---------- */
const badSetting = k => Object.assign(new Error('bad_setting'), { status: 400, code: 'bad_setting', key: k });
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const toNum = v => typeof v === 'string' && v.trim() !== '' ? Number(v) : v;

function merge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (!(k in base)) continue;
    out[k] = isObj(base[k]) && isObj(v) ? merge(base[k], v) : v;
  }
  return out;
}

/* To‘liq tekshiruv: sonlar ≥ 0, foizlar 0–100, pog‘onalar o‘sib borishi, bosqich id’lari Odoo’da bor, mezon va havola to‘g‘ri */
function validate(s) {
  const num = (v, k, hi = 1e13) => { v = toNum(v); if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > hi) throw badSetting(k); return v; };
  const pct = (v, k) => num(v, k, 100);
  const out = { fixed: num(s.fixed, 'fixed') };
  for (const k of KPIS) {
    const x = s[k]; if (!isObj(x)) throw badSetting(k);
    out[k] = { day: num(x.day, `${k}.day`), month: num(x.month, `${k}.month`), pct: pct(x.pct, `${k}.pct`), pay: num(x.pay, `${k}.pay`) };
  }
  if (!isObj(s.transport)) throw badSetting('transport');
  out.transport = { per: num(s.transport.per, 'transport.per'), max: num(s.transport.max, 'transport.max') };
  if (!/^[01]{7}$/.test(String(s.work_dow)) || !String(s.work_dow).includes('1')) throw badSetting('work_dow');
  out.work_dow = String(s.work_dow);
  const sl = s.sales; if (!isObj(sl)) throw badSetting('sales');
  if (!Array.isArray(sl.week_tiers) || !sl.week_tiers.length || sl.week_tiers.length > 20) throw badSetting('sales.week_tiers');
  const tiers = sl.week_tiers.map((x, i) => { if (!isObj(x)) throw badSetting('sales.week_tiers'); return { from: num(x.from, `sales.week_tiers.${i}.from`), bonus: num(x.bonus, `sales.week_tiers.${i}.bonus`) }; });
  for (let i = 1; i < tiers.length; i++) if (tiers[i].from <= tiers[i - 1].from) throw badSetting('sales.week_tiers');
  out.sales = { week_tiers: tiers, week_pct: pct(sl.week_pct, 'sales.week_pct'),
    month_plan: num(sl.month_plan, 'sales.month_plan'), month_pct: pct(sl.month_pct, 'sales.month_pct'), month_bonus: num(sl.month_bonus, 'sales.month_bonus'),
    quarter_plan: num(sl.quarter_plan, 'sales.quarter_plan'), quarter_pct: pct(sl.quarter_pct, 'sales.quarter_pct'), quarter_bonus: num(sl.quarter_bonus, 'sales.quarter_bonus') };
  if (!isObj(s.stages)) throw badSetting('stages');
  out.stages = {};
  for (const k of Object.keys(DEFAULTS.stages)) {
    const v = s.stages[k];
    if (v === null || v === undefined || v === '') { out.stages[k] = null; continue; }
    const id = Number(v);
    if (!Number.isInteger(id) || id <= 0 || !one('SELECT 1 FROM odoo_stages WHERE id=?', id)) throw badSetting(`stages.${k}`);
    out.stages[k] = id;
  }
  if (!['won', 'contract'].includes(s.sales_criterion)) throw badSetting('sales_criterion');
  out.sales_criterion = s.sales_criterion;
  const url = String(s.hr_webhook_url ?? '').trim();
  if (url && (url.length > 500 || !/^https?:\/\/\S+$/i.test(url))) throw badSetting('hr_webhook_url');
  out.hr_webhook_url = url;
  return out;
}

export function kpiSettings() {
  const saved = jparse(kvGet(KV_KEY), null);
  return merge(DEFAULTS, isObj(saved) ? saved : {});
}

/* Barg yo‘llari bo‘yicha farq — jurnalga «sales.month_plan: 1600000000 → 400000000» ko‘rinishida */
function flat(o, p = '', out = {}) {
  for (const [k, v] of Object.entries(o)) { const key = p ? `${p}.${k}` : k; if (isObj(v)) flat(v, key, out); else out[key] = JSON.stringify(v); }
  return out;
}
export function saveKpiSettings(patch, who) {
  const cur = kpiSettings();
  const next = validate(merge(cur, patch));
  const a = flat(cur), b = flat(next), changed = [];
  for (const k of Object.keys(b)) if (a[k] !== b[k]) changed.push(k === 'hr_webhook_url' ? 'hr_webhook_url: (yangilandi)' : `${k}: ${a[k]} → ${b[k]}`);
  if (!changed.length) return [];
  kvSet(KV_KEY, JSON.stringify(next));
  for (const c of changed) logChange(who, `KPI · ${c}`);
  audit('staff', who, 'KPI sozlamalari o‘zgartirildi', { data: changed.join('; ') });
  return changed;
}
/* Sozlamalar javobi: HR havolasi faqat rahbar/admin’ga (ichida maxfiy belgi bo‘lishi mumkin) */
const publicSettings = (s, user) => { const { hr_webhook_url, ...rest } = s; return user && can.settings(user) ? { ...rest, hr_webhook_url } : rest; };

/* ---------- Bosqichlarni topish ---------- */
const resolveTeam = team => team === undefined ? (defaultTeam()?.id ?? null) : team;
const teamSql = teamId => teamId != null ? { w: ' AND l.team_id=?', a: [teamId] } : { w: '', a: [] };

/* Jamoa lidlari haqiqatda ishlatadigan bosqichlar (hozirgi bosqich yoki tarixda kirgan) — nomlar jamoalar orasida takrorlanadi,
   shuning uchun faqat shular ichidan nom bo‘yicha; jamoa lidlari bo‘lmasa — hamma bosqichdan. Bir nechta mos kelsa — eng oldingisi (sequence). */
export function detectStages({ team, s = kpiSettings() } = {}) {
  const teamId = resolveTeam(team), { w, a } = teamSql(teamId);
  const stages = all('SELECT id, name, sequence, is_won FROM odoo_stages ORDER BY sequence, id');
  const usedIds = new Set(all(`SELECT DISTINCT l.stage_id id FROM odoo_leads l WHERE l.stage_id IS NOT NULL ${w}
    UNION SELECT DISTINCT g.to_stage id FROM odoo_stage_log g JOIN odoo_leads l ON l.id=g.lead_id WHERE g.to_stage IS NOT NULL ${w}`, ...a, ...a).map(r => r.id));
  const pool = usedIds.size ? stages.filter(x => usedIds.has(x.id)) : stages;
  const pick = x => x ? { id: x.id, name: x.name } : null;
  const out = {};
  for (const k of Object.keys(PATTERNS)) {
    const forced = s.stages?.[k] != null ? stages.find(x => x.id === s.stages[k]) : null;
    out[k] = pick(forced || pool.find(x => !x.is_won && PATTERNS[k].test(x.name)));
  }
  out.won = pick(pool.find(x => x.is_won) || stages.find(x => x.is_won));
  return out;
}

/* ---------- Kalendar (Toshkent) ---------- */
/* Toshkent kuni boshi (epoch ms) — qat’iy siljish yo‘q, util.local orqali */
function zoned(y, mo, d) {
  const target = Date.UTC(y, mo - 1, d);
  let ts = target;
  for (let i = 0; i < 2; i++) { const l = local(ts); ts -= Date.UTC(l.y, l.mo - 1, l.d, l.h, l.mi, l.s) - target; }
  return ts;
}
const ymd = utcMs => new Date(utcMs).toISOString().slice(0, 10);
const dowIdx = utcMs => (new Date(utcMs).getUTCDay() + 6) % 7;   // 0 = dushanba
const parseMonth = m => { const x = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(m || '')); return x ? { y: +x[1], mo: +x[2] } : null; };

/* Oy ish kunlari: jami va o‘tgani (bugun bilan). O‘tgan oy — hammasi, kelasi oy — 0 */
function workdays(y, mo, dow, today) {
  const n = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  let total = 0, elapsed = 0;
  for (let d = 1; d <= n; d++) {
    if (dow[dowIdx(Date.UTC(y, mo - 1, d))] !== '1') continue;
    total++;
    if (`${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` <= today) elapsed++;
  }
  return { total, elapsed };
}
/* Oyga tegadigan Du–Ya haftalari (to‘liq hafta oynasi, oy chegarasidan chiqishi mumkin) */
function weeksOf(y, mo) {
  const first = Date.UTC(y, mo - 1, 1), end = Date.UTC(y, mo, 1);
  const out = [];
  for (let d = first - dowIdx(first) * DAY; d < end; d += 7 * DAY) {
    const a = new Date(d), b = new Date(d + 7 * DAY);
    out.push({ from: ymd(d), to: ymd(d + 6 * DAY), start: zoned(a.getUTCFullYear(), a.getUTCMonth() + 1, a.getUTCDate()), stop: zoned(b.getUTCFullYear(), b.getUTCMonth() + 1, b.getUTCDate()) });
  }
  return out;
}

/* ---------- Hisob ---------- */
const pctOf = (n, d) => d ? Math.round(100 * n / d) : null;
const reached = (fact, plan, pct) => plan > 0 && fact * 100 >= plan * pct;   // butun sonlarda: 89 → yo‘q, 90 → ha

/* Davrda bosqichga kirgan lidlar soni — mas’ul menejer bo‘yicha (bir lid bir marta) */
function entries(stageId, from, to, teamId) {
  const { w, a } = teamSql(teamId);
  return new Map(all(`SELECT l.user_id, count(DISTINCT g.lead_id) n FROM odoo_stage_log g JOIN odoo_leads l ON l.id=g.lead_id
    WHERE g.to_stage=? AND g.from_stage IS NOT NULL AND g.source<>'snapshot' AND g.at>=? AND g.at<? AND l.user_id IS NOT NULL ${w} GROUP BY l.user_id`,
    stageId, from, to, ...a).map(r => [r.user_id, r.n]));
}
/* Sotuv hajmi qatorlari: lid, vaqt, summa — oynalar bo‘yicha JS’da yig‘iladi (hafta/oy/chorak bir so‘rovdan) */
function volumeRows(criterion, stages, from, to, teamId) {
  const { w, a } = teamSql(teamId);
  if (criterion === 'contract') {
    if (!stages.contract) return [];
    return all(`SELECT g.lead_id, g.at, l.expected_revenue amount FROM odoo_stage_log g JOIN odoo_leads l ON l.id=g.lead_id
      WHERE g.to_stage=? AND g.from_stage IS NOT NULL AND g.source<>'snapshot' AND g.at>=? AND g.at<? ${w}`, stages.contract.id, from, to, ...a);
  }
  return all(`SELECT id lead_id, won_at at, expected_revenue amount FROM (SELECT l.id, l.expected_revenue, ${WON_AT} won_at
    FROM odoo_leads l LEFT JOIN odoo_stages s ON s.id=l.stage_id WHERE 1=1 ${w}) l WHERE won_at>=? AND won_at<?`, ...a, from, to);
}
function volumeIn(rows, from, to) {
  const seen = new Set(); let v = 0;
  for (const r of rows) { if (r.at >= from && r.at < to && !seen.has(r.lead_id)) { seen.add(r.lead_id); v += r.amount || 0; } }
  return v;
}
/* Haftalik pog‘ona: pog‘ona × pct/100 ≤ hajm bo‘lgan eng yuqorisi; qo‘shilmaydi */
function tierOf(volume, tiers, pct) {
  let hit = null;
  for (const t of tiers) if (volume * 100 >= t.from * pct) hit = t;
  return hit ? { tier: hit.from, bonus: hit.bonus } : { tier: null, bonus: 0 };
}

function kpiBlock(stage, fact, todayFact, cfg, wd, isCurrent, todayIsWorkday) {
  const plan = cfg.month, ok = Boolean(stage) && reached(fact, plan, cfg.pct);
  return { state: stage ? 'ok' : 'sozlanmagan', fact, plan, mtd_plan: wd.total ? Math.round(plan * wd.elapsed / wd.total) : 0,
    today_fact: isCurrent ? todayFact : 0, today_plan: isCurrent && todayIsWorkday ? cfg.day : 0, pct: pctOf(fact, plan), ok, pay: ok ? cfg.pay : 0 };
}

export function kpiMonth({ month, team, t = now(), user = null } = {}) {
  const s = kpiSettings(), today = local(t), ym = parseMonth(month) || { y: today.y, mo: today.mo };
  const monthKey = `${ym.y}-${String(ym.mo).padStart(2, '0')}`, isCurrent = monthKey === today.date.slice(0, 7);
  const teamId = resolveTeam(team);
  const teamRow = teamId != null ? { id: teamId, name: one('SELECT name FROM odoo_teams WHERE id=?', teamId)?.name || `#${teamId}` } : null;
  const stages = detectStages({ team: teamId, s });
  const wd = workdays(ym.y, ym.mo, s.work_dow, today.date);
  const todayIsWorkday = s.work_dow[dowIdx(Date.UTC(today.y, today.mo - 1, today.d))] === '1';
  const from = zoned(ym.y, ym.mo, 1), to = zoned(ym.y, ym.mo + 1, 1);
  const dayFrom = zoned(today.y, today.mo, today.d), dayTo = dayFrom + DAY;

  // Hodisalar: oy va bugun, har KPI bosqichi bo‘yicha (bosqich topilmasa — bo‘sh)
  const facts = {}, todayFacts = {};
  for (const k of KPIS) {
    const st = stages[STAGE_OF[k]];
    facts[k] = st ? entries(st.id, from, to, teamId) : new Map();
    todayFacts[k] = st && isCurrent ? entries(st.id, dayFrom, dayTo, teamId) : new Map();
  }
  const { w, a } = teamSql(teamId);
  const users = all(`SELECT u.id, u.name, (SELECT x.id FROM users x WHERE x.odoo_user_id=u.id AND x.deleted_at IS NULL) staff_user_id,
      EXISTS(SELECT 1 FROM odoo_leads l WHERE l.user_id=u.id ${w}) has_leads FROM odoo_users u ORDER BY u.name`, ...a);
  const own = user && !can.seeAll(user) ? (user.odoo_user_id ?? -1) : null;   // sotuvchi/filial — faqat o‘z qatori (bog‘lanmagan bo‘lsa — hech kim)
  const managers = users
    .filter(u => own != null ? u.id === own : (u.has_leads || u.staff_user_id || KPIS.some(k => facts[k].has(u.id))))
    .map(u => {
      const row = { user_id: u.id, name: u.name, is_me: Boolean(user && u.staff_user_id === user.id), staff_user_id: u.staff_user_id ?? null };
      for (const k of KPIS) row[k] = kpiBlock(stages[STAGE_OF[k]], facts[k].get(u.id) || 0, todayFacts[k].get(u.id) || 0, s[k], wd, isCurrent, todayIsWorkday);
      row.transport = { meetings: row.meetings.fact, per: s.transport.per, pay: Math.min(row.meetings.fact * s.transport.per, s.transport.max) };
      row.kpi_pay = KPIS.reduce((n, k) => n + row[k].pay, 0);
      row.fixed = s.fixed;
      row.total = row.fixed + row.kpi_pay + row.transport.pay;
      return row;
    })
    .filter(r => own != null || r.staff_user_id || KPIS.some(k => r[k].fact > 0))
    .sort((x, y) => y.meetings.fact - x.meetings.fact || y.contracts.fact - x.contracts.fact || x.name.localeCompare(y.name));

  // Bo‘lim sotuvi: hafta / oy / chorak — bitta oynadan (chorak + oyga tegadigan haftalar)
  const q0 = Math.floor((ym.mo - 1) / 3) * 3 + 1;
  const quarter = { from: `${ym.y}-${String(q0).padStart(2, '0')}`, to: `${ym.y}-${String(q0 + 2).padStart(2, '0')}`, start: zoned(ym.y, q0, 1), stop: zoned(ym.y, q0 + 3, 1) };
  const weeks = weeksOf(ym.y, ym.mo);
  const span = [Math.min(quarter.start, weeks[0].start), Math.max(quarter.stop, weeks.at(-1).stop)];
  const rows = volumeRows(s.sales_criterion, stages, span[0], span[1], teamId);
  const mv = volumeIn(rows, from, to), qv = volumeIn(rows, quarter.start, quarter.stop);
  const sales = {
    criterion: s.sales_criterion,
    month: { volume: mv, plan: s.sales.month_plan, pct: pctOf(mv, s.sales.month_plan), ok: reached(mv, s.sales.month_plan, s.sales.month_pct), bonus: 0 },
    weeks: weeks.map(wk => { const v = volumeIn(rows, wk.start, wk.stop); return { from: wk.from, to: wk.to, volume: v, ...tierOf(v, s.sales.week_tiers, s.sales.week_pct) }; }),
    quarter: { from: quarter.from, to: quarter.to, volume: qv, plan: s.sales.quarter_plan, pct: pctOf(qv, s.sales.quarter_plan), ok: reached(qv, s.sales.quarter_plan, s.sales.quarter_pct), bonus: 0 }
  };
  sales.month.bonus = sales.month.ok ? s.sales.month_bonus : 0;
  sales.quarter.bonus = sales.quarter.ok ? s.sales.quarter_bonus : 0;

  const missing = Object.values(STAGE_OF).filter(k => !stages[k]);
  const crit = s.sales_criterion === 'contract' ? 'shartnoma bosqichiga kirgan lidlar' : 'yutuq bosqichiga o‘tgan lidlar';
  const note = `Uchrashuv, tijorat taklifi va shartnoma — lid tegishli bosqichga kirgan payt bo‘yicha (Odoo bosqich tarixi, birinchi sinxron qoldig‘i hisobga olinmaydi, davrda bir lid bir marta), lidning mas’ul menejeriga yoziladi; sotuv hajmi — ${crit}ning expected_revenue yig‘indisi.`
    + (missing.length ? ` Sozlanmagan bosqich: ${missing.join(', ')} — KPI sozlamalarida tanlang.` : '')
    + (own != null && own === -1 ? ' Hisobingiz Odoo menejeriga bog‘lanmagan — rahbar Xodimlar bo‘limida bog‘laydi.' : '');
  return { month: monthKey, today: today.date, team: teamRow, workdays: { total: wd.total, elapsed: wd.elapsed }, stages, settings: publicSettings(s, user), managers, sales, note };
}

/* ---------- HR’ga kunlik yuborish (server.js tick) ---------- */
/* Havola bo‘sh — hech narsa. Kuniga bir marta, HR_SEND_HOUR dan keyin; xato bo‘lsa bir soatdan keyin qayta. Natija jurnalda. */
export async function kpiJob({ t = now(), fetchFn = fetch } = {}) {
  const s = kpiSettings();
  if (!s.hr_webhook_url) return null;
  const l = local(t);
  if (l.h < HR_SEND_HOUR || kvGet('kpi:hr_sent_day') === l.date || t - Number(kvGet('kpi:hr_fail_at') || 0) < HR_RETRY_MS) return null;
  const payload = kpiMonth({ t });
  try {
    const r = await fetchFn(s.hr_webhook_url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    kvSet('kpi:hr_sent_day', l.date); kvSet('kpi:hr_fail_at', 0);
    audit('sys', 'KPI agenti', 'KPI hisoboti HR’ga yuborildi', { data: `${payload.month}, ${payload.managers.length} menejer`, result: `HTTP ${r.status}` });
    return { sent: true, managers: payload.managers.length };
  } catch (e) {
    kvSet('kpi:hr_fail_at', t);
    const why = String(e.message || e).slice(0, 200);
    audit('sys', 'KPI agenti', 'KPI hisobotini HR’ga yuborib bo‘lmadi', { result: why });
    return { sent: false, error: why };
  }
}
