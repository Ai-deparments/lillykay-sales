import { one, all, kvGet, kvSet } from '../db.js';
import { now, local, clip, inWindow } from '../util.js';
import { aiReady } from '../config.js';
import { runAgent, AiError } from '../ai/index.js';
import { audit } from '../core/audit.js';
import { getSettings } from './settings.js';
import { defaultTeam } from './voronka.js';

/*
  Tahlil — rahbar sahifasi (boshqaruv tahlili). Hammasi Odoo nusxasi (odoo_*) va panel jadvallaridan, aniq SQL hisob; Odoo’ga so‘rov yo‘q.
  Davr: 'today' — Toshkent kuni boshidan hozirgacha; '7' / '30' — oxirgi N×24 soat (voronka bilan bir xil: t − N kun).
  Taqqoslash: 'today' → kecha (butun kun); '7'/'30' → oldingi teng oyna; avg7 — oxirgi 7 kunlik kunlik o‘rtacha.
  Voqea vaqtlari: yangi — created_at; olingan — opened_at (Odoo date_open — mas’ul tayinlangan vaqt; bo‘lmasa created_at);
  yutilgan — bosqich tarixida yutuq bosqichiga o‘tgan vaqt (odoo_stage_log), tarix bo‘lmasa closed_at / stage_at; yo‘qotilgan — closed_at (bo‘lmasa updated_at).
  Menejer va manba kesimi — kogorta bo‘yicha (davrda olingan / yaratilgan lidlar hozir qanday holatda), voronka kabi.
  AI xulosasi (3–5 jumla) — faqat yig‘ma raqamlar va menejer ismlari ketadi, mijoz ma’lumoti (telefon, ism, mijoz nomi) hech qachon yuborilmaydi.
  Natija kv’da 1 soat saqlanadi; bir vaqtda bitta chaqiruv. Fon ishi (tahlilJob) faqat avval so‘ralgan xulosalarni ish vaqtida yangilab turadi.
*/

const DAY = 864e5, HOUR = 3600e3;
export const PERIODS = ['today', '7', '30'];
const FRESH_MS = 60 * 60e3;
const STUCK_H = 24, SILENT_H = 48, TOUCH_H = 24;

const days1 = ms => Math.round(ms / DAY * 10) / 10;
const pct = (n, d) => d ? Math.round(100 * n / d) : null;
const resolveTeam = team => team === undefined ? (defaultTeam()?.id ?? null) : team;
/* Toshkent kuni boshi (config.tz) — mahalliy soat/daqiqa/soniya ayiriladi, qat’iy siljish yo‘q */
const dayStart = ts => { const l = local(ts); return ts - (l.h * HOUR + l.mi * 60e3 + l.s * 1e3) - (ts % 1000); };
const dateOf = ts => local(ts).date;

/* Davr oynasi: [from, to) va taqqoslash oynasi */
function windowOf(period, t) {
  if (period === 'today') { const from = dayStart(t); return { from, to: t, prev: { from: from - DAY, to: from } }; }
  const n = Number(period) || 7, from = t - n * DAY;
  return { from, to: t, prev: { from: from - n * DAY, to: from } };
}
/* Jamoa filtri qismi (l — odoo_leads taxallusi) */
const teamSql = teamId => teamId != null ? { w: ' AND l.team_id=?', a: [teamId] } : { w: '', a: [] };
/* Lid qachon yutilgan: tarixda yutuq bosqichiga birinchi o‘tish; tarix bo‘lmasa — hozir yutuq bosqichida bo‘lsa closed_at yoki stage_at */
/* Yutilgan sana — bitta ta’rif butun panel uchun (yordamchi.js ham shuni ishlatadi): `l` = odoo_leads, `s` = odoo_stages (JOIN kerak) */
export const WON_AT = `COALESCE((SELECT min(g.at) FROM odoo_stage_log g JOIN odoo_stages ws ON ws.id=g.to_stage AND ws.is_won=1 WHERE g.lead_id=l.id),
  CASE WHEN s.is_won=1 THEN COALESCE(l.closed_at, l.stage_at) END)`;
const LOST_AT = 'COALESCE(l.closed_at, l.updated_at)';
/* Lid 24 soat ichida «tegilganmi»: haqiqiy bosqich o‘tishi (from_stage bor — snapshot emas) yoki menejer izohi */
const TOUCHED = `(EXISTS(SELECT 1 FROM odoo_stage_log g WHERE g.lead_id=l.id AND g.from_stage IS NOT NULL AND g.at<=l.created_at+${TOUCH_H * HOUR})
  OR EXISTS(SELECT 1 FROM odoo_messages m WHERE m.lead_id=l.id AND m.kind='comment' AND m.at<=l.created_at+${TOUCH_H * HOUR}))`;

/* ---------- Bugun bir qarashda ---------- */
function glance({ from, to }, teamId) {
  const { w, a } = teamSql(teamId);
  const r = one(`SELECT
      (SELECT count(*) FROM odoo_leads l WHERE l.created_at>=? AND l.created_at<? ${w}) new,
      (SELECT count(*) FROM odoo_leads l WHERE l.user_id IS NOT NULL AND COALESCE(l.opened_at,l.created_at)>=? AND COALESCE(l.opened_at,l.created_at)<? ${w}) taken,
      (SELECT count(*) FROM odoo_leads l WHERE l.active=0 AND ${LOST_AT}>=? AND ${LOST_AT}<? ${w}) lost`,
    from, to, ...a, from, to, ...a, from, to, ...a);
  const won = one(`SELECT count(*) n, COALESCE(sum(l.expected_revenue),0) amount FROM (
      SELECT l.id, l.expected_revenue, ${WON_AT} won_at FROM odoo_leads l LEFT JOIN odoo_stages s ON s.id=l.stage_id WHERE 1=1 ${w}) l
    WHERE l.won_at>=? AND l.won_at<?`, ...a, from, to);
  return { new: r.new, taken: r.taken, won: won.n, won_amount: won.amount, lost: r.lost };
}

export function todayGlance({ period = '7', team, t = now() } = {}) {
  const teamId = resolveTeam(team), win = windowOf(period, t), { w, a } = teamSql(teamId);
  const cur = glance(win, teamId), prev = glance(win.prev, teamId), last7 = glance({ from: t - 7 * DAY, to: t }, teamId);
  const top = one(`SELECT COALESCE(r.name, 'Sabab ko‘rsatilmagan') name, count(*) n FROM odoo_leads l LEFT JOIN odoo_lost_reasons r ON r.id=l.lost_reason_id
    WHERE l.active=0 AND ${LOST_AT}>=? AND ${LOST_AT}<? ${w} GROUP BY l.lost_reason_id ORDER BY n DESC, l.lost_reason_id LIMIT 1`, win.from, win.to, ...a);
  const cmp = Object.fromEntries(['new', 'taken', 'won', 'won_amount', 'lost'].map(k => [k, { prev: prev[k], avg7: Math.round(last7[k] / 7 * 10) / 10 }]));
  return { ...cur, lost_top_reason: top ? { name: top.name, n: top.n } : null, cmp };
}

/* ---------- Kunlik qator: kirgan va yutilgan ---------- */
function seriesBetween(start, end, teamId) {
  const { w, a } = teamSql(teamId);
  const buckets = new Map();
  for (let d = start; d < end; d += DAY) buckets.set(dateOf(d), { date: dateOf(d), in: 0, won: 0 });
  for (const r of all(`SELECT l.created_at at FROM odoo_leads l WHERE l.created_at>=? AND l.created_at<? ${w}`, start, end, ...a)) { const b = buckets.get(dateOf(r.at)); if (b) b.in++; }
  for (const r of all(`SELECT won_at at FROM (SELECT ${WON_AT} won_at FROM odoo_leads l LEFT JOIN odoo_stages s ON s.id=l.stage_id WHERE 1=1 ${w}) WHERE won_at>=? AND won_at<?`, ...a, start, end)) {
    const b = buckets.get(dateOf(r.at)); if (b) b.won++;
  }
  return [...buckets.values()];
}
export function dailySeries({ days = 30, team, t = now() } = {}) {
  const teamId = resolveTeam(team), start = dayStart(t) - (days - 1) * DAY;
  return seriesBetween(start, dayStart(t) + DAY, teamId);
}

/* ---------- Bosqichlar salomatligi ---------- */
export function stageHealth({ period = '7', team, t = now() } = {}) {
  const teamId = resolveTeam(team), win = windowOf(period, t), { w, a } = teamSql(teamId);
  const rows = all(`SELECT s.id, s.name, s.is_won,
      (SELECT count(*) FROM odoo_leads l WHERE l.stage_id=s.id AND l.active=1 ${w}) now,
      (SELECT count(*) FROM odoo_leads l WHERE l.stage_id=s.id AND l.active=1 AND l.stage_at<? ${w}) stuck,
      (SELECT count(*) FROM odoo_leads l WHERE l.stage_id=s.id AND l.active=0 AND ${LOST_AT}>=? AND ${LOST_AT}<? ${w}) lost,
      (SELECT avg(?-l.stage_at) FROM odoo_leads l WHERE l.stage_id=s.id AND l.active=1 ${w}) avg_ms
    FROM odoo_stages s ORDER BY s.sequence, s.id`, ...a, t - STUCK_H * HOUR, ...a, win.from, win.to, ...a, t, ...a)
    .filter(s => s.now || s.lost)
    .map(s => ({ id: s.id, name: s.name, now: s.now, stuck: s.is_won ? 0 : s.stuck, lost: s.lost, avg_days: s.avg_ms != null ? days1(s.avg_ms) : null, is_bottleneck: false }));
  // Tiqilish nuqtasi — qotib qolganlar ulushi eng katta (yutuq bosqichi hisobga olinmaydi); teng bo‘lsa — birinchisi
  const top = rows.reduce((m, s) => (s.stuck > (m?.stuck || 0) ? s : m), null);
  if (top) top.is_bottleneck = true;
  return rows;
}

/* Qotib qolgan lidlar ichida ikkinchi aloqasi yo‘qlari: butun tarixda haqiqiy bosqich o‘tishi + menejer izohi 2 tadan kam */
function stuckNoSecondTouch(stageId, teamId, t) {
  const { w, a } = teamSql(teamId);
  return one(`SELECT count(*) n FROM odoo_leads l WHERE l.stage_id=? AND l.active=1 AND l.stage_at<? ${w}
    AND (SELECT count(*) FROM odoo_stage_log g WHERE g.lead_id=l.id AND g.from_stage IS NOT NULL) + (SELECT count(*) FROM odoo_messages m WHERE m.lead_id=l.id AND m.kind='comment') < 2`,
    stageId, t - STUCK_H * HOUR, ...a).n;
}
function stagesNote(stages, teamId, t) {
  const b = stages.find(s => s.is_bottleneck);
  if (!b) return 'Qotib qolgan lid yo‘q — bosqichlarda tiqilish ko‘rinmayapti.';
  const n = stuckNoSecondTouch(b.id, teamId, t);
  return `Tiqilish nuqtasi — «${b.name}»: ${b.stuck} ta lid ${STUCK_H} soatdan beri qimirlamagan, shundan ${n} tasida ikkinchi aloqa yo‘q.`;
}

/* ---------- Manbalar: davrda kelgan lidlar va ulardan yutilganlar ---------- */
export function sourcesStat({ period = '7', team, t = now() } = {}) {
  const teamId = resolveTeam(team), win = windowOf(period, t), { w, a } = teamSql(teamId);
  return all(`SELECT COALESCE(l.source_id, 0) id, COALESCE(src.name, 'Manba yo‘q') name, count(*) "in", sum(l.active=1 AND s.is_won=1) won
    FROM odoo_leads l LEFT JOIN odoo_sources src ON src.id=l.source_id LEFT JOIN odoo_stages s ON s.id=l.stage_id
    WHERE l.created_at>=? AND l.created_at<? ${w} GROUP BY l.source_id ORDER BY "in" DESC, id`, win.from, win.to, ...a)
    .map(r => ({ id: r.id, name: r.name, in: r.in, won: r.won || 0, conv: pct(r.won || 0, r.in) }));
}

/* ---------- Menejerlar: davrda olingan lidlar kogortasi + hozir jim turgan lidlar ---------- */
const statusOf = m => (m.silent_leads >= 5 || m.lost_pct >= 30) ? 'etibor' : (m.lost_pct < 20 && m.on_time_pct != null && m.on_time_pct >= 85) ? 'yaxshi' : 'ortacha';
export function managersStat({ period = '7', team, t = now() } = {}) {
  const teamId = resolveTeam(team), win = windowOf(period, t), { w, a } = teamSql(teamId);
  const cohort = all(`SELECT l.user_id, count(*) taken, sum(l.active=0) lost, sum(l.active=1 AND s.is_won=1) won,
      sum(CASE WHEN l.active=1 AND s.is_won=1 THEN l.expected_revenue ELSE 0 END) won_amount,
      sum(${TOUCHED}) on_time, sum(${TOUCHED} OR l.created_at<?) decided
    FROM odoo_leads l LEFT JOIN odoo_stages s ON s.id=l.stage_id
    WHERE l.user_id IS NOT NULL AND COALESCE(l.opened_at,l.created_at)>=? AND COALESCE(l.opened_at,l.created_at)<? ${w} GROUP BY l.user_id`,
    t - TOUCH_H * HOUR, win.from, win.to, ...a);
  const silent = all(`SELECT l.user_id, count(*) n FROM odoo_leads l LEFT JOIN odoo_stages s ON s.id=l.stage_id
    WHERE l.active=1 AND COALESCE(s.is_won,0)=0 AND l.stage_at<? ${w} GROUP BY l.user_id`, t - SILENT_H * HOUR, ...a);
  const names = new Map(all('SELECT id, name FROM odoo_users').map(u => [u.id, u.name]));
  const silentOf = new Map(silent.map(r => [r.user_id, r.n]));
  const ids = [...new Set([...cohort.map(r => r.user_id), ...silent.map(r => r.user_id)])].filter(id => id != null);
  const byUser = new Map(cohort.map(r => [r.user_id, r]));
  const rows = ids.map(id => {
    const c = byUser.get(id) || { taken: 0, lost: 0, won: 0, won_amount: 0, on_time: 0, decided: 0 };
    const m = { user_id: id, name: names.get(id) || `Odoo #${id}`, taken: c.taken, on_time_pct: pct(c.on_time || 0, c.decided || 0), won: c.won || 0, won_amount: c.won_amount || 0,
      lost_pct: c.taken ? Math.round(100 * (c.lost || 0) / c.taken) : 0, silent_leads: silentOf.get(id) || 0 };
    return { ...m, status: statusOf(m) };
  }).sort((x, y) => y.taken - x.taken || y.silent_leads - x.silent_leads || x.name.localeCompare(y.name));
  // Mas’ulsiz lidlar: davrda yaratilgan va hozir jim turganlar
  const none = one(`SELECT (SELECT count(*) FROM odoo_leads l WHERE l.user_id IS NULL AND l.created_at>=? AND l.created_at<? ${w}) taken,
    (SELECT count(*) FROM odoo_leads l LEFT JOIN odoo_stages s ON s.id=l.stage_id WHERE l.user_id IS NULL AND l.active=1 AND COALESCE(s.is_won,0)=0 AND l.stage_at<? ${w}) silent`,
    win.from, win.to, ...a, t - SILENT_H * HOUR, ...a);
  if (none.taken || none.silent) rows.push({ user_id: 0, name: 'Mas’ul yo‘q', taken: none.taken, on_time_pct: null, won: 0, won_amount: 0, lost_pct: 0, silent_leads: none.silent, status: 'none' });
  return rows;
}

/* ---------- AI hissasi — panel jadvallaridan (Instagram / Telegram suhbatlari) ---------- */
export function aiContribution({ period = '7', t = now() } = {}) {
  const { from, to } = windowOf(period, t);
  const CONV = `conversations c JOIN accounts a ON a.id=c.account_id WHERE a.channel IN ('ig','tg') AND c.created_at>=? AND c.created_at<?`;
  const r = one(`SELECT
      (SELECT count(*) FROM ${CONV}) conversations,
      (SELECT count(*) FROM ${CONV} AND EXISTS(SELECT 1 FROM messages m WHERE m.conversation_id=c.id AND m.author='ai')) ai_replied,
      (SELECT count(*) FROM ${CONV} AND c.phone IS NOT NULL) phones,
      (SELECT count(*) FROM assignments x WHERE x.created_at>=? AND x.created_at<?) handoffs,
      (SELECT count(*) FROM assignments x WHERE x.created_at>=? AND x.created_at<? AND x.status IN ('failed','escalated')) handoffs_unanswered`,
    from, to, from, to, from, to, from, to, from, to);
  // Javob tezligi: yuborilgan qoralama → AI xabari vaqti minus undan oldingi oxirgi mijoz xabari
  const reply = one(`SELECT avg(ai_at - client_at) ms FROM (
      SELECT ai_at, (SELECT max(m.created_at) FROM messages m WHERE m.conversation_id=d.conversation_id AND m.author='client' AND m.created_at<=ai_at) client_at
      FROM (SELECT d.conversation_id, COALESCE((SELECT min(m.created_at) FROM messages m WHERE m.conversation_id=d.conversation_id AND m.author='ai' AND m.created_at>=d.created_at), d.decided_at) ai_at
            FROM drafts d JOIN conversations c ON c.id=d.conversation_id JOIN accounts a ON a.id=c.account_id
            WHERE d.status='sent' AND a.channel IN ('ig','tg') AND d.decided_at>=? AND d.decided_at<?) d)
    WHERE client_at IS NOT NULL AND ai_at>=client_at`, from, to);
  return { conversations: r.conversations, ai_replied: r.ai_replied, ai_replied_pct: pct(r.ai_replied, r.conversations), avg_reply_sec: reply?.ms != null ? Math.round(reply.ms / 1000) : null,
    phones: r.phones, phones_pct: pct(r.phones, r.conversations), handoffs: r.handoffs, handoffs_unanswered: r.handoffs_unanswered };
}

/* ---------- AI xulosasi: 3–5 jumla, faqat berilgan raqamlar ---------- */
const SYSTEM = `Siz sotuv bo‘limi rahbarining tahlilchisisiz. Sizga bo‘limning yig‘ma ko‘rsatkichlari beriladi (lidlar, bosqichlar, manbalar, menejerlar, AI agent).
Vazifa: 3–5 ta qisqa xulosa jumlasi yozing — rahbar bir qarashda nima bo‘layotganini va nima qilish kerakligini tushunsin.
Qoidalar:
- Faqat berilgan raqamlarga tayaning; raqamlarda yo‘q narsani aytmang, taxmin qilmang.
- Har jumla bitta aniq raqamni (son yoki foiz) o‘z ichiga olsin va qaysi ko‘rsatkich ekani aniq bo‘lsin.
- Eng muhim o‘zgarish yoki muammo birinchi: tiqilgan bosqich, e’tibor talab qiladigan menejer, yo‘qotish sababi, manba konversiyasi, AI hissasi.
- Maslahat faqat «nima qilish» darajasida va faqat raqamdan to‘g‘ridan-to‘g‘ri kelib chiqsa (masalan: «… bosqichidagi 7 ta lidga bugun qo‘ng‘iroq qilish kerak»); umumiy nasihat yozmang.
- Har jumla bir gap, 160 belgigacha. O‘zbek tilida, lotin alifbosida. Mijoz ismi yoki telefoni bo‘lmaydi — ular berilmagan.
- Natijani faqat xulosa vositasi orqali bering, oddiy matn yozmang.`;
const TOOL = {
  name: 'xulosa', description: 'Rahbar uchun yakuniy xulosa jumlalari',
  input_schema: { type: 'object', additionalProperties: false, required: ['sentences'],
    properties: { sentences: { type: 'array', minItems: 3, maxItems: 5, items: { type: 'string' }, description: '3–5 ta jumla, har biri raqam bilan' } } }
};

let runner = opts => runAgent(opts);
export function setTahlilRunner(fn) { runner = fn; }
const key = teamId => `tahlil:xulosa:${teamId ?? 'all'}`;
function readCache(k) { try { const v = kvGet(k); return v ? JSON.parse(v) : null; } catch { return null; } }
const oneLine = (s, n) => clip(String(s ?? '').replace(/\s+/g, ' ').trim(), n);

export function xulosaStatus({ team, t = now() } = {}) {
  const c = readCache(key(resolveTeam(team)));
  if (!c) return { text: null, at: null, model: null, stale: true };
  return { text: c.text, at: c.at, model: c.model, stale: t - c.at >= FRESH_MS };
}

/* AI’ga ketadigan matn: faqat yig‘ma raqamlar va menejer ismlari — lid nomi, mijoz, telefon yo‘q */
function xulosaInput({ teamId, t }) {
  const period = '7', team = teamId;
  const g = todayGlance({ period, team, t }), st = stageHealth({ period, team, t }), src = sourcesStat({ period, team, t }), mg = managersStat({ period, team, t }), ai = aiContribution({ period, t });
  const line = (k, v) => `${k}: ${v}`;
  const n = v => v == null ? '—' : v;
  return [
    `Davr: oxirgi 7 kun. Jamoa: ${teamId != null ? (one('SELECT name FROM odoo_teams WHERE id=?', teamId)?.name || teamId) : 'hammasi'}.`,
    `Lidlar: yangi ${g.new} (oldingi 7 kun: ${g.cmp.new.prev}), olingan ${g.taken} (oldingi: ${g.cmp.taken.prev}), yutilgan ${g.won} / summa ${g.won_amount} (oldingi: ${g.cmp.won.prev}), yo‘qotilgan ${g.lost} (oldingi: ${g.cmp.lost.prev}).` +
      (g.lost_top_reason ? ` Eng ko‘p yo‘qotish sababi: «${oneLine(g.lost_top_reason.name, 60)}» — ${g.lost_top_reason.n} ta.` : ''),
    'Bosqichlar (hozir faol / 24 soatdan beri qimirlamagan / davrda shu yerda yo‘qotilgan / o‘rtacha kun):',
    ...st.map(s => `  - ${oneLine(s.name, 60)}: ${s.now} / ${s.stuck} / ${s.lost} / ${n(s.avg_days)}${s.is_bottleneck ? ' — tiqilish nuqtasi' : ''}`),
    'Manbalar (kelgan / yutilgan / konversiya %):',
    ...src.map(s => `  - ${oneLine(s.name, 60)}: ${s.in} / ${s.won} / ${n(s.conv)}`),
    'Menejerlar (olingan / 24 soatda aloqa % / yutilgan / yo‘qotish % / 48 soat jim lidlar / holat):',
    ...mg.map(m => `  - ${oneLine(m.name, 60)}: ${m.taken} / ${n(m.on_time_pct)} / ${m.won} / ${m.lost_pct} / ${m.silent_leads} / ${m.status}`),
    line('AI agent (Instagram/Telegram suhbatlari)', `suhbatlar ${ai.conversations}, AI javob bergan ${ai.ai_replied} (${n(ai.ai_replied_pct)}%), o‘rtacha javob ${n(ai.avg_reply_sec)} s, telefon olingan ${ai.phones} (${n(ai.phones_pct)}%), sotuvchiga topshirilgan ${ai.handoffs}, javobsiz qolgan ${ai.handoffs_unanswered}`)
  ].join('\n');
}

const inFlight = new Map();   // k → promise: bir vaqtda bitta AI chaqiruvi
/* Xulosani yangilash (rahbar bosadi yoki fon ishi). 1 soat ichida saqlangani qaytadi (force bo‘lmasa) */
export async function xulosaRefresh({ team, t = now(), who = 'sys', force = false } = {}) {
  const teamId = resolveTeam(team), k = key(teamId), c = readCache(k);
  if (c && !force && t - c.at < FRESH_MS) return { text: c.text, at: c.at, model: c.model };
  if (inFlight.has(k)) { await inFlight.get(k); const r = readCache(k); return r ? { text: r.text, at: r.at, model: r.model } : { text: null, at: null, model: null }; }
  const job = generate({ teamId, t, who, k });
  inFlight.set(k, job.catch(() => null));
  try { return await job; } finally { inFlight.delete(k); }
}
async function generate({ teamId, t, who, k }) {
  const userContent = xulosaInput({ teamId, t });
  let out = null;
  const r = await runner({ system: SYSTEM, userContent, tools: [TOOL], finalTool: TOOL.name, handlers: { xulosa: a => { out = a; return { ok: true }; } }, maxTurns: 2, maxTokens: 1500 });
  const text = (Array.isArray(out?.sentences) ? out.sentences : []).map(s => oneLine(s, 240)).filter(Boolean).slice(0, 5);
  if (!text.length) throw new AiError('empty', 'xulosa vositasi chaqirilmadi yoki bo‘sh');
  const model = r?.model || null;
  kvSet(k, JSON.stringify({ at: t, model, text }));
  audit(who === 'sys' ? 'sys' : 'staff', who === 'sys' ? 'Tahlil agenti' : who, 'Tahlil — AI xulosasi', { data: `jamoa ${teamId ?? 'hammasi'}, 7 kun`, result: `${text.length} jumla · ${model || 'model'}` });
  return { text, at: t, model };
}

/* Fon ishi (server.js tick, har daqiqa chaqiriladi): avval so‘ralgan (kv’da bor) va eskirgan xulosalar ish vaqtida qayta hisoblanadi.
   Hech qachon so‘ralmagan jamoa uchun AI chaqirilmaydi — har chaqiruv pul. */
export async function tahlilJob({ t = now(), s = getSettings() } = {}) {
  if (!aiReady() || !inWindow(t, s.work_from, s.work_to)) return null;
  const stale = all(`SELECT k FROM kv WHERE k LIKE 'tahlil:xulosa:%'`).map(r => r.k).filter(k => { const c = readCache(k); return !c || t - c.at >= FRESH_MS; });
  let done = 0;
  for (const k of stale) {
    const id = k.slice('tahlil:xulosa:'.length), team = id === 'all' ? null : Number(id);
    try { await xulosaRefresh({ team, t, who: 'sys' }); done++; } catch (e) { console.error('[tahlil] xulosa', e.code || e.message); }
  }
  return { stale: stale.length, refreshed: done };
}

/* ---------- Sahifa uchun to‘liq javob ---------- */
export function tahlil({ period = '7', team, t = now() } = {}) {
  if (!PERIODS.includes(period)) period = '7';
  const teamId = resolveTeam(team);
  const teamRow = teamId != null ? { id: teamId, name: one('SELECT name FROM odoo_teams WHERE id=?', teamId)?.name || `#${teamId}` } : null;
  const series60 = seriesBetween(dayStart(t) - 59 * DAY, dayStart(t) + DAY, teamId);
  const prev30 = series60.slice(0, 30), series = series60.slice(30);
  const sum = (arr, k) => arr.reduce((n, x) => n + x[k], 0);
  const sIn = sum(series, 'in'), sWon = sum(series, 'won');
  const stages = stageHealth({ period, team: teamId, t });
  return {
    period, team: teamRow, updated_at: t, odoo_synced_at: Number(kvGet('odoo_sync_at') || 0) || null,
    today: todayGlance({ period, team: teamId, t }),
    series, series_total: { in: sIn, won: sWon, conv: pct(sWon, sIn), prev_conv: pct(sum(prev30, 'won'), sum(prev30, 'in')) },
    stages, stages_note: stagesNote(stages, teamId, t),
    sources: sourcesStat({ period, team: teamId, t }),
    managers: managersStat({ period, team: teamId, t }),
    ai: aiContribution({ period, t }),
    xulosa: xulosaStatus({ team: teamId, t })
  };
}
