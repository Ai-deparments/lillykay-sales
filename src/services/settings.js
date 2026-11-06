import { one, run, all } from '../db.js';
import { now, jparse, setCurrency } from '../util.js';

/* Rahbar sozlaydigan qiymatlar. "Sinov qiymati" — ish boshida tasdiqlanadi (TZ). */
export const DEFAULTS = {
  T_seconds: 120,                    // kechikish chegarasi
  work_from: '09:00', work_to: '21:00',
  night_autoreply: true,             // ish vaqtidan tashqari avtojavob
  morning_handover: '09:00',
  followup_first_hours: 4,           // 1-urinish (AI) — kanal oynasi ichida
  followup_second_days: 2,           // 2-urinish — sotuvchi vazifasi
  quiet_from: '21:00', quiet_to: '09:00',
  big_positions: 5, big_qty: 10, big_categories: 3, big_amount: 0, // 0 = kiritilmagan
  big_accept_minutes: 3,             // qabul qilinmasa zaxira mas'ulga
  small_max_wait_minutes: 10,
  assign_accept_minutes: 10,         // sotuvchi topshiriqni shu vaqtda qabul qilmasa — keyingisiga
  assign_done_minutes: 120,          // qabul qilgan, lekin shu vaqtda bajarmasa — keyingisiga
  assign_urgent_minutes: 3,          // shoshilinch (mijoz hozir to‘lamoqchi) — qabul qilish muddati
  staff_active_minutes: 30,          // shu vaqt ichida faol bo‘lgan sotuvchi «online» hisoblanadi
  seller_auto_warn: true,            // o‘tkazib yuborgan sotuvchiga avtomatik ogohlantirish
  currency: 'UZS'                    // hisob valyutasi: BILLZ summalari shu valyutada (Photobuy — USD)
};
const CHOICES = { currency: ['UZS', 'USD'] };

export function getSettings() {
  const out = { ...DEFAULTS };
  for (const r of all('SELECT k,v FROM settings')) if (r.k in DEFAULTS) out[r.k] = jparse(r.v, r.v);
  setCurrency(out.currency);
  return out;
}
export const setting = k => getSettings()[k];

/* Ruxsat etilgan oraliq: bo‘sh maydon 0 bo‘lib saqlanmasin (masalan big_positions=0 — har xabar «katta buyurtma» bo‘lardi) */
const RANGE = {
  T_seconds: [15, 3600], followup_first_hours: [1, 23], followup_second_days: [1, 30],
  big_positions: [2, 100], big_qty: [2, 10000], big_categories: [1, 50], big_amount: [0, 1e12], big_accept_minutes: [1, 120],
  small_max_wait_minutes: [1, 240], assign_accept_minutes: [2, 120], assign_done_minutes: [10, 1440], assign_urgent_minutes: [1, 30], staff_active_minutes: [5, 240]
};
const badSetting = k => Object.assign(new Error('bad_setting'), { status: 400, code: 'bad_setting', key: k });

export function updateSettings(patch, who, { unchecked = false } = {}) {
  const cur = getSettings(), changed = [], vals = {};
  for (const [k, v] of Object.entries(patch || {})) {
    if (!(k in DEFAULTS)) continue;
    const type = typeof DEFAULTS[k];
    let val;
    if (type === 'number') {
      if (v === '' || v == null || typeof v === 'boolean') throw badSetting(k);
      val = Number(v);
      const [lo, hi] = unchecked ? [-Infinity, Infinity] : RANGE[k] || [0, 1e12];
      if (!Number.isFinite(val) || val < lo || val > hi) throw badSetting(k);
    } else if (type === 'boolean') {
      if (v === true || v === 'true' || v === 1 || v === '1') val = true;
      else if (v === false || v === 'false' || v === 0 || v === '0') val = false;
      else throw badSetting(k);
    } else {
      val = String(v ?? '').trim();
      if (/^\d{2}:\d{2}$/.test(String(DEFAULTS[k])) && !/^([01]\d|2[0-3]):[0-5]\d$/.test(val)) throw badSetting(k);
      if (CHOICES[k] && !CHOICES[k].includes(val)) throw badSetting(k);
    }
    vals[k] = val;
  }
  // Hammasi tekshirilgach yoziladi: bitta noto‘g‘ri qiymat bo‘lsa — hech narsa o‘zgarmaydi
  for (const [k, val] of Object.entries(vals)) {
    if (JSON.stringify(cur[k]) === JSON.stringify(val)) continue;
    run('INSERT INTO settings(k,v,updated_at,updated_by) VALUES(?,?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at, updated_by=excluded.updated_by',
      k, JSON.stringify(val), now(), who);
    changed.push(`${k}: ${cur[k]} → ${val}`);
  }
  for (const c of changed) logChange(who, c);
  getSettings(); // xotiradagi qiymatlar (hisob valyutasi) darhol yangilansin
  return changed;
}

export const logChange = (who, what) => run('INSERT INTO changes(at,who,what) VALUES(?,?,?)', now(), who, what);
export const recentChanges = (n = 50) => all('SELECT * FROM changes ORDER BY id DESC LIMIT ?', n);
export const integration = name => one('SELECT * FROM integrations WHERE name=?', name);
export const setIntegration = (name, state, detail = null) =>
  run('INSERT INTO integrations(name,state,detail,checked_at) VALUES(?,?,?,?) ON CONFLICT(name) DO UPDATE SET state=excluded.state, detail=excluded.detail, checked_at=excluded.checked_at',
    name, state, detail, now());
