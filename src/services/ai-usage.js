import { run, one, all, kvGet, kvSet } from '../db.js';
import { now, local } from '../util.js';
import { setIntegration } from './settings.js';
import { audit } from '../core/audit.js';

/*
  AI sarfini hisoblash. Google AI Studio qolgan balansni API orqali bermaydi, shuning uchun:
  — har so‘rovdan keyin sarflangan tokenlar yoziladi (javobdagi usageMetadata),
  — narx bo‘yicha pul hisoblanadi,
  — rahbar «qancha to‘ldirdim» deb kiritadi, qolgani shundan ayiriladi.
  Narx — Google’ning Standard tarifi ($/1M token, ai.google.dev/gemini-api/docs/pricing, 2026-10-09 tekshirildi):
  3.1-flash-lite: kirish 0.25 (ovoz 0.50), chiqish 1.50 (fikrlash bilan), keshdan 0.025, kesh saqlash 1.00 / soat.
  2026-10-09 gacha bu yerda Batch/Flex tarifi (aynan yarmi) turgan va kesh saqlash umuman hisoblanmagan — panel sarfni kam ko‘rsatgan.
  Ma’lum modellar narxi KNOWN dan olinadi (kv ga bog‘liq emas); noma’lum model — kv dagi ai_price_* (qo‘lda kiritiladi).
  Google qidiruvi: oyiga 5 000 so‘rov bepul (barcha Gemini 3.x uchun umumiy), keyin $14 / 1 000 — mahsulot rasmi qidiruvi kuniga
  60 tadan oshmaydi, shuning uchun bepul doirada; alohida hisoblanmaydi.
*/
const KNOWN = [
  [/3\.1-flash-lite/, { in: 0.25, out: 1.50, cached: 0.025, audio: 0.50, storage: 1.00 }],
  [/3\.5-flash-lite/, { in: 0.30, out: 2.50, cached: 0.03, audio: 0.30, storage: 1.00 }],
  [/2\.5-flash-lite|flash-lite-latest/, { in: 0.10, out: 0.40, cached: 0.01, audio: 0.30, storage: 1.00 }],
  // 3.x Flash: 2026-yil oxirigacha shu narx, 2027-01-01 dan Google ikki baravar oshiradi (narx sahifasida yozilgan)
  [/flash/, { in: 0.75, out: 3.75, cached: 0.075, audio: 0.75, storage: 0.50 }]
];
const kvPrice = () => {
  const inp = Number(kvGet('ai_price_in') ?? 0.75);
  return { in: inp, out: Number(kvGet('ai_price_out') ?? 3.75), cached: Number(kvGet('ai_price_cached') ?? 0.075),
    audio: Number(kvGet('ai_price_audio') ?? inp), storage: Number(kvGet('ai_price_storage') ?? 1.00) };
};
/* Qator qaysi modelda sarflangan bo‘lsa — o‘sha model narxi; noma’lum model — kv dagi narx */
export function priceFor(model) {
  return (model && KNOWN.find(([re]) => re.test(model))?.[1]) || kvPrice();
}
/* Hozirgi model narxi (panel sarlavhasi, bitta javob) */
export const price = () => priceFor(kvGet('ai_model'));

/* Pul: keshsiz matn + ovoz (alohida narx) + keshdan o‘qilgan + chiqish (fikrlash bilan) + kesh saqlash (token·soat) */
export const costOf = (r, p = price()) => {
  const cached = r.cached_tok || 0, audio = r.audio_tok || 0;
  const text = Math.max(0, (r.in_tok || 0) - cached - audio);
  return (text * p.in + audio * (p.audio ?? p.in) + cached * p.cached + (r.out_tok || 0) * p.out + (r.cache_th || 0) * (p.storage ?? 0)) / 1e6;
};
/* ai_usage qatorlari (model bilan) — har biri o‘z narxida */
const costRows = rows => rows.reduce((a, r) => a + costOf(r, priceFor(r.model)), 0);

/* Har muvaffaqiyatli javobdan keyin chaqiriladi. Xato bo‘lsa jim o‘tiladi — hisob suhbatni to‘xtatmasin. */
export function recordUsage(model, u) {
  try {
    if (!u) return;
    // Google qidiruvi / sahifa o‘qish natijasi modelga kirish sifatida beriladi (toolUsePromptTokenCount) — kirish tokeni deb hisoblanadi
    const inTok = Number(u.promptTokenCount || 0) + Number(u.toolUsePromptTokenCount || 0);
    const outTok = Number(u.candidatesTokenCount || 0) + Number(u.thoughtsTokenCount || 0);
    const cached = Number(u.cachedContentTokenCount || 0);
    // Ovoz (ovozli xabar, matnga aylantirish) — matndan qimmat, alohida yoziladi
    const audio = (u.promptTokensDetails || []).filter(d => d?.modality === 'AUDIO').reduce((a, d) => a + Number(d.tokenCount || 0), 0);
    if (!inTok && !outTok) return;
    run(`INSERT INTO ai_usage(day,model,calls,in_tok,out_tok,cached_tok,audio_tok) VALUES(?,?,1,?,?,?,?)
         ON CONFLICT(day,model) DO UPDATE SET calls=calls+1, in_tok=in_tok+excluded.in_tok,
           out_tok=out_tok+excluded.out_tok, cached_tok=cached_tok+excluded.cached_tok, audio_tok=audio_tok+excluded.audio_tok`,
      local().date, String(model || '?'), inTok, outTok, cached, audio);
    if (Number(kvGet('ai_credits_out_at')) > 0) creditsOk();   // har javobda bekorga yozmaslik uchun raqam bilan
    const left = lowBalance();
    if (left != null) stopForLowBalance(left);   // zaxiraga yetdi — agent o‘chadi
  } catch { /* hisob yuritish suhbatdan muhimroq emas */ }
}

/* Kesh saqlash puli: Google ko‘rsatma keshini TTL davomida saqlagani uchun soatiga oladi ($1.00 / 1M token·soat, 3.1-flash-lite).
   Kesh yaratilganda yoziladi: tokenlar × TTL soati (calls oshmaydi). 2026-10-09 gacha umuman hisoblanmagan. */
export function recordCacheStorage(model, tokens, ttlSec) {
  try {
    const th = Math.max(0, Number(tokens) || 0) * Math.max(0, Number(ttlSec) || 0) / 3600;
    if (!th) return;
    run(`INSERT INTO ai_usage(day,model,calls,in_tok,out_tok,cached_tok,cache_th) VALUES(?,?,0,0,0,0,?)
         ON CONFLICT(day,model) DO UPDATE SET cache_th=cache_th+excluded.cache_th`, local().date, String(model || '?'), th);
  } catch { /* hisob yuritish suhbatdan muhimroq emas */ }
}

/* Zaxiradan oshib ketmaslik uchun AI AGENT HAQIQATAN o‘chiriladi.
   Faqat so‘rovni to‘xtatish yetarli emas edi: agent «yoqilgan» holida qolsa, Instagram’ga «ko‘rildi» belgisi
   qo‘yilaveradi va mijoz javobsiz qoladi. Shuning uchun akkauntlar o‘chiriladi; to‘ldirilmaguncha yoqilmaydi. */
export function lowBalance() {
  const R = reserve(), left = balanceLeft();
  return R > 0 && left != null && left <= R ? left : null;
}

export function stopForLowBalance(left) {
  try {
    if (Number(kvGet('ai_low_stopped_at')) > 0) return;      // allaqachon to‘xtatilgan (kv matn saqlaydi: '0' ham truthy)
    const on = all('SELECT id, name FROM accounts WHERE ai_enabled=1');
    kvSet('ai_low_stopped_at', now());
    setIntegration('ai', 'error', `Balans $${left.toFixed(2)} — AI to‘xtatildi, to‘ldirib qayta yoqing`);
    if (!on.length) return;
    run('UPDATE accounts SET ai_enabled=0 WHERE ai_enabled=1');
    audit('sys', 'AI balansi', `Balans $${left.toFixed(2)} ga tushdi — AI agent to‘xtatildi`,
      { result: on.map(r => r.name).join(', ') + ' · to‘ldirilmaguncha yoqilmaydi' });
  } catch {}
}

/* Balans tugadi (HTTP 402) — panelda qizil holat va «to‘ldirish» tugmasi chiqadi */
export function creditsOut(detail) {
  try {
    kvSet('ai_credits_out_at', now());
    kvSet('ai_credits_out_msg', String(detail || '').slice(0, 300));
    setIntegration('ai', 'error', 'Balans tugadi — Google AI Studio’da to‘ldirish kerak');
  } catch {}
}
export function creditsOk() {
  try { kvSet('ai_credits_out_at', 0); kvSet('ai_credits_out_msg', ''); setIntegration('ai', 'ok', 'Ishlayapti'); } catch {}
}

const sum = rows => rows.reduce((a, r) => ({
  calls: a.calls + (r.calls || 0), in_tok: a.in_tok + (r.in_tok || 0),
  out_tok: a.out_tok + (r.out_tok || 0), cached_tok: a.cached_tok + (r.cached_tok || 0),
  audio_tok: a.audio_tok + (r.audio_tok || 0), cache_th: a.cache_th + (r.cache_th || 0)
}), { calls: 0, in_tok: 0, out_tok: 0, cached_tok: 0, audio_tok: 0, cache_th: 0 });

const ROWS = 'SELECT day, model, calls, in_tok, out_tok, cached_tok, audio_tok, cache_th FROM ai_usage';

/* To‘ldirilgandan beri sarf. Kiritilgan kunning o‘sha paytgacha bo‘lgan sarfi (ai_topup_base) ayirilmaydi: kiritilgan summa —
   ayni o‘sha daqiqadagi balans (2026-10-09 gacha shu kunning ertalabki sarfi ham balansdan yana bir marta ayirilardi). */
function spentSince(topupAt) {
  const rows = all(`${ROWS} WHERE day >= ?`, new Date(topupAt + 5 * 3600e3).toISOString().slice(0, 10));
  let base = [];
  try { base = JSON.parse(kvGet('ai_topup_base') || '[]'); } catch {}
  return Math.max(0, costRows(rows) - costRows(Array.isArray(base) ? base : []));
}
/* AI yozgan javoblar soni — kv hisoblagich (kun · model). Qoralamalar jadvalidan farqli, suhbat o‘chirilganda yoki
   eski qoralamalar tozalanganda kamaymaydi — «bitta javob» narxi sun’iy oshib ketmasin (2026-10-08: suhbat o‘chirilgach $0.0010 → $0.0012). */
export function recordReply(model, day = local().date) {
  try {
    const k = `ai_replies:${day}:${String(model || '?')}`;
    kvSet(k, Number(kvGet(k) || 0) + 1);
  } catch {}
}
const repliesCounted = (dayLike, model) =>
  one(`SELECT COALESCE(sum(CAST(v AS INTEGER)), 0) n FROM kv WHERE k LIKE ?`, `ai_replies:${dayLike}:${model || '%'}`)?.n || 0;

/* Bitta javob narxi — faqat HOZIRGI model(lar) bo‘yicha: asosiy (ai_model) va aralash rejimdagi kuchli (ai_model_strong) modeldagi sarf /
   ular yozgan javoblar (bugun 10 tadan ko‘p bo‘lsa — bugungi, aks holda oylik). Model almashganda eski model aralashmaydi. */
function perReply(day, month) {
  const cur = [kvGet('ai_model'), kvGet('ai_model_strong')].filter(Boolean);
  const where = cur.length ? `AND model IN (${cur.map(() => '?').join(',')})` : 'AND model IS NOT NULL', arg = cur;
  // Hisoblagich bilan qoralamalar sonining kattasi: hisoblagich kiritilgunga qadar bo‘lgan kunlar uchun ham to‘g‘ri
  const counted = d => cur.length ? cur.reduce((a, m) => a + repliesCounted(d, m), 0) : repliesCounted(d, null);
  const n = d => Math.max(counted(d), one(`SELECT count(*) n FROM drafts WHERE date(created_at/1000,'unixepoch','+5 hours') LIKE ? ${where}`, d, ...arg)?.n || 0);
  const usd = d => costRows(all(`${ROWS} WHERE day LIKE ? ${where}`, d, ...arg));
  const t = n(day);
  if (t >= 10) return { usd: usd(day) / t, drafts: t, span: 'bugun' };
  const m = n(month + '%');
  return m ? { usd: usd(month + '%') / m, drafts: m, span: 'shu oy' } : null;
}

export function usageReport() {
  const p = price(), day = local().date, month = day.slice(0, 7);
  const rows = all(`${ROWS} WHERE day >= date(?, '-13 days') ORDER BY day DESC`, day);
  const byDay = new Map();
  for (const r of rows) {
    const d = byDay.get(r.day) || { day: r.day, calls: 0, in_tok: 0, out_tok: 0, cached_tok: 0, usd: 0 };
    byDay.set(r.day, { ...d, ...sum([d, r]), usd: d.usd + costOf(r, priceFor(r.model)) });
  }
  const days = [...byDay.values()];
  /* Nechta mijozga javob berildi (AI yozgan xabarlar bo‘yicha — suhbatlar soni) va nechta javob (hisoblagich; u bo‘lmagan
     eski kunlarda — yuborilgan qoralamalar). Panel «75 mijozga 220 ta javob» deb ko‘rsatadi (rahbar so‘rovi, 2026-10-09). */
  const dayStart = d => Date.parse(`${d}T00:00:00+05:00`);
  const ppl = new Map(all(`SELECT date(created_at/1000,'unixepoch','+5 hours') d, count(DISTINCT conversation_id) n FROM messages
    WHERE author='ai' AND created_at >= ? GROUP BY d`, dayStart(day) - 13 * 864e5).map(r => [r.d, r.n]));
  const repliesOn = d => repliesCounted(d, null)
    || one(`SELECT count(*) n FROM drafts WHERE status='sent' AND date(created_at/1000,'unixepoch','+5 hours')=?`, d)?.n || 0;
  for (const d of days) Object.assign(d, { people: ppl.get(d.day) || 0, replies: repliesOn(d.day) });
  const today = days.find(d => d.day === day) || { ...sum([]), usd: 0, people: ppl.get(day) || 0, replies: repliesOn(day) };
  const monRows = all(`${ROWS} WHERE day LIKE ?`, month + '%');
  const mon = { ...sum(monRows), usd: costRows(monRows) };
  const monthFrom = dayStart(`${month}-01`);
  mon.people = one(`SELECT count(DISTINCT conversation_id) n FROM messages WHERE author='ai' AND created_at >= ?`, monthFrom)?.n || 0;
  mon.replies = all(`SELECT DISTINCT date(created_at/1000,'unixepoch','+5 hours') d FROM messages WHERE author='ai' AND created_at >= ?`, monthFrom)
    .reduce((a, r) => a + repliesOn(r.d), 0);
  const topupUsd = Number(kvGet('ai_topup_usd') || 0), topupAt = Number(kvGet('ai_topup_at') || 0);
  const spent = topupAt ? spentSince(topupAt) : 0;
  const per = perReply(day, month);
  return {
    price: p, model: kvGet('ai_model') || null,
    today, month: mon, days,
    topup: topupAt ? { usd: topupUsd, at: topupAt, spent, left: topupUsd - spent } : null,
    per_reply: per?.usd ?? null, per_reply_info: per,
    limits: limits(), reserve: reserve(), stop: budgetStop(), low: lowBalance(),
    low_stopped_at: Number(kvGet('ai_low_stopped_at') || 0) || null,
    credits_out_at: Number(kvGet('ai_credits_out_at') || 0) || null,
    credits_out_msg: kvGet('ai_credits_out_msg') || null
  };
}

/* Kunlik va oylik chegara. Oshsa — AI chaqirilmaydi (so‘rov yuborilmaydi), suhbat sotuvchiga qoladi.
   Kunlik chegara yarim tunda (Toshkent) o‘zi tiklanadi. 0 — chegara yo‘q (standart: kunlik chegara yo‘q). */
export const limits = () => ({ day: Number(kvGet('ai_day_limit') ?? 0), month: Number(kvGet('ai_month_limit') ?? 0) });
/* Balansda shuncha dollar qolganda AI to‘xtaydi (0 — o‘chiq) */
/* 2026-10-09: rahbar balansni faqat Google AI Studio’da ko‘radi (paneldagi taxminiy balans va «To‘ldirdim» yashirildi) — shuning
   uchun taxminiy balans bo‘yicha avtomatik o‘chirish standart O‘CHIQ: aks holda yangilanmay qolgan hisob AI ni bekorga to‘xtatardi.
   Google balansi haqiqatan tugasa — Google 402 qaytaradi, panel «Balans tugadi» deydi. Zaxirani qayta yoqish: kv ai_reserve_usd. */
export const reserve = () => Math.max(0, Number(kvGet('ai_reserve_usd') ?? 0));

/* To‘ldirilgan balansdan qolgani (taxminiy: sarf token narxidan hisoblanadi). To‘ldirish kiritilmagan bo‘lsa — null */
function balanceLeft() {
  const topupUsd = Number(kvGet('ai_topup_usd') || 0), topupAt = Number(kvGet('ai_topup_at') || 0);
  if (!topupAt) return null;
  return topupUsd - spentSince(topupAt);
}
export function setLimits(day, month, who) {
  if (day != null) kvSet('ai_day_limit', Math.max(0, Number(day) || 0));
  if (month != null) kvSet('ai_month_limit', Math.max(0, Number(month) || 0));
  cache.at = 0;
  return limits();
}

/* Har so‘rovda bazaga qaramaslik uchun 60 soniya keshlanadi */
const cache = { at: 0, val: null };
export function budgetStop() {
  try {
    if (Date.now() - cache.at < 60000) return cache.val;
    const L = limits(), day = local().date;
    let val = null;
    if (L.day > 0) {
      const spent = costRows(all(`${ROWS} WHERE day=?`, day));
      if (spent >= L.day) val = { why: 'day', spent, limit: L.day };
    }
    if (!val && L.month > 0) {
      const spent = costRows(all(`${ROWS} WHERE day LIKE ?`, day.slice(0, 7) + '%'));
      if (spent >= L.month) val = { why: 'month', spent, limit: L.month };
    }
    // Balans zaxirasi: to‘ldirilgan summadan $5 (ai_reserve_usd) qolganda AI to‘xtaydi — hisob nolga tushmasin
    const R = reserve(), left = balanceLeft();
    if (!val && R > 0 && left != null && left <= R) val = { why: 'balance', spent: left, limit: R };
    cache.at = Date.now(); cache.val = val;
    return val;
  } catch { return null; }
}

export function setTopup(usd, who) {
  const v = Math.max(0, Number(usd) || 0);
  kvSet('ai_topup_usd', v); kvSet('ai_topup_at', now());
  kvSet('ai_topup_base', JSON.stringify(all(`${ROWS} WHERE day = ?`, local().date)));   // shu paytgacha bugungi sarf — ayirilmaydi
  kvSet('ai_low_stopped_at', 0);   // balans tiklandi — AI ni qayta yoqish mumkin
  cache.at = 0;
  if (v > 0) creditsOk();
  return v;
}
