import { randomBytes } from 'node:crypto';
import { config } from './config.js';

export const now = () => Date.now();
export const token = (n = 24) => randomBytes(n).toString('base64url');
export const code6 = () => String(100000 + (randomBytes(4).readUInt32BE() % 900000));

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* Biznes vaqti (Toshkent). Server soati UTC — o‘zgartirilmaydi, shu yerda hisoblanadi. */
const fmtParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: config.tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
});
export function local(ts = Date.now()) {
  const p = Object.fromEntries(fmtParts.formatToParts(new Date(ts)).map(x => [x.type, x.value]));
  const hour = p.hour === '24' ? '00' : p.hour;
  return { y: +p.year, mo: +p.month, d: +p.day, h: +hour, mi: +p.minute, s: +p.second,
    date: `${p.year}-${p.month}-${p.day}`, hm: `${hour}:${p.minute}`, hms: `${hour}:${p.minute}:${p.second}` };
}
export const minutesOfDay = hm => { const [h, m] = String(hm).split(':').map(Number); return h * 60 + (m || 0); };
/* "09:00"–"21:00" oralig‘idami (tun yarmidan o‘tuvchi oraliq ham ishlaydi) */
export function inWindow(ts, from, to) {
  const l = local(ts), cur = l.h * 60 + l.mi, a = minutesOfDay(from), b = minutesOfDay(to);
  return a <= b ? cur >= a && cur < b : cur >= a || cur < b;
}

/* Hisob valyutasi — Sozlamalar → «Hisob valyutasi» (Photobuy BILLZ’da USD’da ishlaydi). settings.getSettings() yangilab turadi. */
let CUR = 'UZS';
export const setCurrency = c => { CUR = c === 'USD' ? 'USD' : 'UZS'; };
export const currency = () => CUR;
const num = n => Math.round(n).toLocaleString('ru-RU').replace(/\u00a0/g, ' ');
export const money = (n, cur = CUR) => n == null ? '—' : cur === 'USD' ? `${num(n)} $` : `${num(n)} so‘m`;
export const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
export const jparse = (s, d = null) => { try { return s == null ? d : JSON.parse(s); } catch { return d; } };

/* Smena va ish kunlari. dow — 7 belgi (Du…Ya), masalan '1111110'. Vaqt — 'HH:MM' (Toshkent).
   Bo‘sh qoldirilsa: har kuni, butun kun (ya’ni cheklov yo‘q). */
export const DOW = ['Du', 'Se', 'Cho', 'Pa', 'Ju', 'Sha', 'Ya'];
export function onDuty({ dow, from, to }, ts = Date.now()) {
  if (dow && /^[01]{7}$/.test(dow)) {
    const l = local(ts);
    const idx = (new Date(Date.UTC(l.y, l.mo - 1, l.d)).getUTCDay() + 6) % 7; // 0 = dushanba
    if (dow[idx] !== '1') return false;
  }
  if (from && to) return inWindow(ts, from, to);
  return true;
}
/* Davrdagi ish kunlari soni (filialni solishtirishda: yopiq kunlar hisobga olinmaydi) */
export function workDays(dow, start, end) {
  if (!dow || !/^[01]{7}$/.test(dow)) dow = '1111111';
  let n = 0;
  for (let t = start; t < end; t += 864e5) {
    const l = local(t + 6 * 3600e3);
    const idx = (new Date(Date.UTC(l.y, l.mo - 1, l.d)).getUTCDay() + 6) % 7;
    if (dow[idx] === '1') n++;
  }
  return n;
}
