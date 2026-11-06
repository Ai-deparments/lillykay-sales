import { db, run, one, kvGet, kvSet } from '../db.js';
import { local } from '../util.js';
import { audit } from '../core/audit.js';

/*
  Baza o‘z-o‘zidan tozalanadi — kuniga bir marta, tunda (04:xx Toshkent, birinchi tick). Nima o‘chadi:
  — audit: 90 kundan eski; takrorlanadigan tizim yozuvlari (kanal yuborilmadi, shablon qoida) 7 kundan eski
    (2026-10-08: Instagram tokeni o‘lganda bir kunda 117 000 shunday yozuv to‘planib, baza 62 MB bo‘lgan);
  — drafts: superseded/cancelled/failed 30 kundan eski. «sent» qoladi — sotuvchi bahosi va uslub tahlili uchun;
  — assignment_events, staff_messages: 180 kundan eski.
  Mijoz xabarlari, suhbatlar, mijozlar, xaridlar — HECH QACHON o‘chirilmaydi.
  Oyiga bir marta VACUUM — o‘chirilgan joy diskka qaytadi (bir necha soniya, tunda).
*/
const DAY = 86400e3;
const RULES = [
  ['audit', `DELETE FROM audit WHERE at < ?`, 90],
  ['audit-takror', `DELETE FROM audit WHERE at < ? AND action IN ('Shablon javob yuborilmadi', 'Javob kerak emas (shablon qoida)', 'Shablon javob yuborildi (AI ishlatilmadi)')`, 7],
  ['drafts', `DELETE FROM drafts WHERE created_at < ? AND status IN ('superseded', 'cancelled', 'failed')`, 30],
  ['assignment_events', `DELETE FROM assignment_events WHERE at < ?`, 180],
  ['staff_messages', `DELETE FROM staff_messages WHERE created_at < ?`, 180]
];

export function cleanupNow(ts = Date.now()) {
  const removed = {};
  for (const [name, sql, days] of RULES) {
    const r = run(sql, ts - days * DAY);
    if (r.changes) removed[name] = r.changes;
  }
  return removed;
}

/* Har daqiqalik tick’dan chaqiriladi; faqat tunda va kuniga bir marta ishlaydi */
export function cleanupJob({ force = false } = {}) {
  const d = local();
  if (!force && (d.h !== 4 || kvGet('cleanup_day') === d.date)) return null;
  kvSet('cleanup_day', d.date);
  const removed = cleanupNow();
  const total = Object.values(removed).reduce((a, b) => a + b, 0);
  let vacuumed = false;
  const month = d.date.slice(0, 7);
  if (kvGet('vacuum_month') !== month) {
    try { db.exec('VACUUM'); kvSet('vacuum_month', month); vacuumed = true; } catch (e) { console.error('[tozalash] VACUUM:', e.message); }
  }
  if (total || vacuumed) {
    const size = one(`SELECT page_count * page_size AS b FROM pragma_page_count(), pragma_page_size()`)?.b;
    audit('sys', 'Tozalash', `Baza tozalandi: ${total} qator${vacuumed ? ' · VACUUM' : ''}`,
      { result: Object.entries(removed).map(([k, v]) => `${k} ${v}`).join(', ') + (size ? ` · ${(size / 1048576).toFixed(1)} MB` : '') });
  }
  return { removed, vacuumed };
}
