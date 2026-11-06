/* Formatlash yordamchilari (app.js dagi `esc`, `num`, `money`, `cash`, `fmtT/D/DT`, `ago`, `richText` va h.k.).
   Valyuta va server soati modul darajasida saqlanadi: AppProvider ularni /api/bootstrap dan keyin o‘rnatadi. */

export const esc = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/* ---------- valyuta ---------- */
let currency: 'USD' | 'UZS' = 'UZS';
export const setCurrency = (c?: string | null): void => { currency = c === 'USD' ? 'USD' : 'UZS'; };
export const cur = (): 'USD' | 'UZS' => currency;
export const num = (n: number): string => Math.round(n).toLocaleString('ru-RU').replace(/ /g, ' ');
export const money = (n: number | null | undefined): string => n == null ? '—' : cur() === 'USD' ? `${num(n)} $` : `${num(n)} so‘m`;
/* Keshbek kichik bo‘ladi ($0.40 ham uchraydi) — 100 dan kichik va kasrli summa ikki xona bilan ko‘rsatiladi */
export const cash = (n: number | null | undefined): string => {
  if (n == null) return '—';
  const v = Math.abs(n) < 100 && n % 1 ? n.toFixed(2) : num(n);
  return cur() === 'USD' ? `${v} $` : `${v} so‘m`;
};
export const BIG = (): { div: number; label: string } => cur() === 'USD' ? { div: 1e3, label: 'ming $' } : { div: 1e6, label: 'mln so‘m' };
export const mln = (n: number | null | undefined): string => n == null ? '—' : (n / BIG().div).toLocaleString('ru-RU', { maximumFractionDigits: 1 }).replace(/ /g, ' ');
export const mlrd = (n: number | null | undefined): string => n == null ? '—' : (n / 1e9).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const usd = (n: number | null | undefined): string => n == null ? '—' : '$' + (Math.abs(n) < 10 ? n.toFixed(2) : n.toFixed(1));
/* Mayda summalar (bitta javob narxi: lite modelda ~$0.003) — 2 kasr «$0.00» ko‘rsatib qo‘yardi */
export const usdS = (n: number | null | undefined): string => n == null ? '—' : '$' + (Math.abs(n) < 0.01 ? n.toFixed(4) : Math.abs(n) < 0.1 ? n.toFixed(3) : n.toFixed(2));
export const tokens = (n: number): string => !n ? '0' : n >= 1e6 ? (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + ' mln' : n >= 1e3 ? Math.round(n / 1e3) + ' ming' : String(n);

/* ---------- sana / vaqt (Toshkent) ---------- */
export const pad = (n: number): string => String(n).padStart(2, '0');
export const TZ = 'Asia/Tashkent';
let clockOffset = 0;
/** Server soati bilan farq: `S.offset = r.now - Date.now()` */
export const setClockOffset = (serverNow: number): void => { clockOffset = serverNow - Date.now(); };
export const clockNow = (): number => Date.now() + clockOffset;
export const fmtT = (ts?: number | null): string => ts ? new Date(ts).toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '';
export const fmtD = (ts?: number | null): string => ts ? new Date(ts).toLocaleDateString('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit', ...(new Date(ts).getFullYear() !== new Date().getFullYear() ? { year: '2-digit' as const } : {}) }) : '';
export const fmtDT = (ts?: number | null): string => ts ? `${fmtD(ts)} ${fmtT(ts)}` : '';
export const sameDay = (a?: number | null, b?: number | null): boolean => fmtD(a) === fmtD(b);
export const fmtLeft = (ms: number): string => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };
/** «5 daq», «3 soat», «2 kun» — `ts` dan beri o‘tgan vaqt */
export const ago = (ts?: number | null): string => { if (!ts) return ''; const m = Math.max(0, Math.round((clockNow() - ts) / 60e3)); return m < 60 ? `${m} daq` : m < 1440 ? `${Math.round(m / 60)} soat` : `${Math.round(m / 1440)} kun`; };
/** Chatdagi kun belgisi: «Bugun», «Kecha», qolgani sana */
export const dayLabel = (ts: number): string => sameDay(ts, clockNow()) ? 'Bugun' : sameDay(ts, clockNow() - 864e5) ? 'Kecha' : fmtD(ts);

/* ---------- matn ---------- */
export const telHref = (p?: string | null): string => 'tel:' + String(p || '').replace(/[^\d+]/g, '');
export const initials = (n?: string | null): string => String(n || '?').replace(/[@·]/g, ' ').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
export const clipText = (t: string, n: number): string => t.length > n ? t.slice(0, n - 1) + '…' : t;

/* Panel ko‘rinishi uchun (mijozga ketgan matn o‘zgarmaydi): AI va sotuvchi xabarida narx ajralib tursin,
   «Tovar nomi — narx, izoh» qatorida tovar nomi qalin. Matn avval esc() qilinadi, keyin faqat raqam va belgi o‘raladi.
   Natija — xavfsiz HTML satr (dangerouslySetInnerHTML uchun). */
const PRICE_RE = /(\$\s?\d{1,3}(?:[ ,]\d{3})*(?:\.\d{1,2})?|\d{1,3}(?:[  .,]\d{3})+(?:[.,]\d{1,2})?\s?(?:\$|so(?:‘|’|ʻ|`|&#39;)?m\b|сум)|\d+(?:[.,]\d{1,2})?\s?(?:\$|so(?:‘|’|ʻ|`|&#39;)?m\b|сум))/gi;
export const richText = (t: string): string => esc(t).split('\n').map(line => {
  const p = line.replace(PRICE_RE, '<b class="price">$1</b>');
  return p === line ? line : p.replace(/^(\s*(?:[•·–-]\s*)?)([^—<\n]{2,80}?)(\s[—–-]\s)(?=.*class="price")/, '$1<b class="pname">$2</b>$3');
}).join('\n');
