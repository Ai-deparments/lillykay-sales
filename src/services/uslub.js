import { all, run, tx, kvGet, kvSet } from '../db.js';
import { clip, local } from '../util.js';

/*
  Photobuy yozishmalaridan o‘rganish: «mijoz savoli → sotuvchi javobi» juftlari (style_pairs, FTS5).
  AI yangi savolga javob yozishdan oldin eng o‘xshash 3–4 juftni ko‘radi — do‘kon odatda qanday ohangda, qancha uzunlikda,
  qaysi yondashuv bilan javob bergan. Narx, qoldiq va shartlar bu yerdan olinmaydi (eskirgan bo‘lishi mumkin) — BILLZ va do‘kon ma’lumotidan.
  Boshqa mijozning shaxsiy ma’lumoti o‘tmasligi uchun raqamlar, @username, havola va e-pochta yashiriladi.
*/
const LABEL = /\[(rasm|video|video xabar|ovozli xabar|stiker|fayl[^\]]*|kontakt|joylashuv|so‘rovnoma|qo‘ng‘iroq|xabar|yo‘naltirilgan)\]/g;
export function scrub(t) {
  return String(t || '')
    .replace(/https?:\/\/\S+|t\.me\/\S+|www\.\S+/gi, '[havola]')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[e-pochta]')
    .replace(/@[A-Za-z0-9_]{4,}/g, '@…')
    .replace(/\+?\d[\d\s\-().]{7,}\d/g, '[raqam]')
    .replace(/\s+/g, ' ').trim();
}
const clean = t => scrub(String(t || '').replace(LABEL, ' '));
const MAX_GAP_Q = 60 * 60e3, MAX_GAP_A = 10 * 60e3;
/* Faqat salom/rahmat — namuna emas */
const GREET_ONLY = /^(va ?alaykum ?(assalom)?|assalomu? ?(alaykum|aleykum)|salom|rahmat|raxmat|спасибо|здравствуйте|добрый день|ok|ок|xo‘?p|хоп|ha|yo‘?q|marhamat)[\s!.,)]*(\s*(aka|opa|brat|uka))?[\s!.,)]*$/i;

/* Suhbat xabarlari (vaqt bo‘yicha) → juftlar. Ketma-ket mijoz xabarlari — bitta savol, keyingi 10 daqiqadagi sotuvchi xabarlari — javob */
export function pairsFrom(msgs) {
  const out = [];
  let q = [], qAt = 0, a = [], aAt = 0;
  const flush = () => {
    const qs = clean(q.join(' ')), as = clean(a.join(' \n'));
    if (qs.length >= 3 && as.length >= 20 && !GREET_ONLY.test(as)) out.push({ q: clip(qs, 600), a: clip(as, 700), at: aAt });
    q = []; a = [];
  };
  for (const m of msgs) {
    if (m.author === 'client') {
      if (a.length) flush();
      if (q.length && m.at - qAt > MAX_GAP_Q) q = [];
      q.push(m.text); qAt = m.at;
    } else if (m.author === 'seller') {
      if (!q.length) continue;
      if (!a.length && m.at - qAt > MAX_GAP_Q) { q = []; continue; }
      if (a.length && m.at - aAt > MAX_GAP_A) { flush(); continue; }
      a.push(m.text); aAt = m.at;
    }
  }
  if (a.length) flush();
  return out;
}

/* Hamma suhbatdan qayta quradi (import yoki yangi yozishmalardan keyin) */
export function rebuildPairs() {
  const convs = all(`SELECT DISTINCT conversation_id id FROM messages WHERE author='seller'`).map(r => r.id);
  let n = 0;
  tx(() => {
    run('DELETE FROM style_pairs');
    for (const id of convs) {
      const msgs = all(`SELECT author, text, created_at at FROM messages WHERE conversation_id=? AND author IN ('client','seller')
        AND COALESCE(json_extract(meta,'$.offline'),0)=0 ORDER BY created_at, id`, id);
      for (const p of pairsFrom(msgs)) { run('INSERT INTO style_pairs(q,a,conv_id,at) VALUES(?,?,?,?)', p.q, p.a, id, p.at); n++; }
    }
  });
  return n;
}

const WORD = /[\p{L}\p{N}‘’ʻʼ']{3,}/gu;
/* Eng o‘xshash juftlar. excludeConv — joriy suhbatning o‘zi namunaga tushmasin */
export function similarPairs(text, { limit = 4, excludeConv = null } = {}) {
  const words = [...new Set((String(text || '').toLowerCase().match(WORD) || []))].slice(0, 16);
  if (!words.length) return [];
  const match = words.map(w => `"${w.replace(/"/g, '""')}"`).join(' OR ');
  try {
    const rows = all(`SELECT q, a, conv_id, at, bm25(style_pairs) s FROM style_pairs WHERE style_pairs MATCH ? ORDER BY s LIMIT 40`, match);
    const yearAgo = Date.now() - 365 * 864e5, seen = new Set(), out = [];
    const ranked = rows.filter(r => r.conv_id !== excludeConv).map((r, i) => ({ ...r, rank: i + (r.at < yearAgo ? 3 : 0) + (r.a.length < 40 ? 2 : 0) })).sort((x, y) => x.rank - y.rank);
    for (const r of ranked) {
      const k = r.a.slice(0, 60);
      if (seen.has(k)) continue;
      seen.add(k); out.push({ q: r.q, a: r.a, at: r.at });
      if (out.length >= limit) break;
    }
    return out;
  } catch { return []; }
}

/* Har kecha 03:40 (Toshkent) — kunduzgi yangi yozishmalar ham o‘rganishga qo‘shiladi */
export function pairsJob() {
  const l = local();
  if (l.hm < '03:40' || kvGet('pairs_day') === l.date) return;
  kvSet('pairs_day', l.date);
  const n = rebuildPairs();
  console.log(`[uslub] ${n} ta savol→javob jufti yangilandi`);
}
