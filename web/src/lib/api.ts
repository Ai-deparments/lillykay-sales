/* Tipli fetch (app.js dagi `api`, `ERR`, `fail` logikasi). Cookie (`sid`, HttpOnly) same-origin so‘rovda brauzer tomonidan yuboriladi;
   /api/* Next rewrites orqali Go backendga proksilanadi. */

/** Server xato javobi: `data` — JSON tanasi (`{ error, why, key }`) */
export class ApiError extends Error {
  data: { error?: string; why?: string; key?: string; [k: string]: unknown };
  constructor(message: string, data: ApiError['data'] = {}) { super(message); this.name = 'ApiError'; this.data = data; }
}

/**
 * `body` berilmasa — GET; berilsa — POST (JSON, `content-type: application/json` shart: backend CSRF tekshiruvi).
 * 401 → /login ga o‘tadi va `Error('unauthorized')` tashlaydi.
 * `!r.ok` va javobda `ok` maydoni bo‘lmasa — ApiError; `{ ok:false, why }` kabi javoblar tashlanmaydi (chaqiruvchi tekshiradi).
 */
export async function api<T = any>(path: string, body?: unknown): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (r.status === 401) { location.href = '/login'; throw new Error('unauthorized'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok && !('ok' in j)) throw new ApiError(j.error || `HTTP ${r.status}`, j);
  return j as T;
}

export const ERR: Record<string, string> = {
  purchase_needs_confirmation: '«Xarid tasdiqlandi» faqat chek yoki xodim tasdig‘i bilan belgilanadi.', lost_needs_evidence: 'Yo‘qotish sababi uchun dalil yozing.',
  forbidden: 'Bu amal uchun ruxsat yo‘q.', bad_user: 'Login (3–32 lotin harf/raqam) va ismni to‘ldiring.', short_password: 'Parol kamida 8 belgi bo‘lsin.',
  period_locked: 'O‘tgan davr rejasi qulflangan — o‘zgartirib bo‘lmaydi.', rule_incomplete: 'Olgan va taklif mahsulotini hamda sababni kiriting.',
  bad_setting: 'Qiymat bo‘sh yoki ruxsat etilgan oraliqdan tashqarida — hech narsa saqlanmadi', bad_current_password: 'Joriy parol noto‘g‘ri.',
  own_role: 'O‘z rolingizni o‘zgartira olmaysiz.', own_delete: 'O‘zingizni o‘chira olmaysiz.',
  bad_photo: 'Rasm yaroqsiz — JPEG yoki PNG, 4 MB gacha.', bad_ad: 'Matn yoki rasm kerak.',
  bad_link: 'Havola https:// bilan boshlansin.',
  low_balance: 'AI balansi zaxiradan past — avval Google AI Studio‘da to‘ldiring va «To‘ldirdim» ni bosing.',
  bad_phone: 'Telefon raqami to‘g‘ri emas. Masalan: +998 90 123 45 67', login_taken: 'Bu raqam bilan xodim allaqachon bor.',
  invite_exists: 'Bu raqamga havola allaqachon berilgan — «Kutayotgan takliflar» ro‘yxatiga qarang.', csrf: 'So‘rov rad etildi — sahifani yangilang.', too_many: 'Juda ko‘p urinish — 10 daqiqadan keyin qayta urinib ko‘ring.',
  bad_tg_username: 'Telegram username: 4–32 lotin harf, raqam yoki _ (masalan @hilola_photobuy).', bad_tg_id: 'Telegram ID — faqat raqam (5–15 ta).',
  tg_taken: 'Bu Telegram username yoki ID boshqa xodimga biriktirilgan.'
};

/** Foydalanuvchiga ko‘rsatiladigan xato matni (app.js dagi `fail` ichidagi matn) */
export function errorText(e: unknown): string {
  const err = e as { message?: string; data?: { error?: string; why?: string; key?: string } } | null;
  return (ERR[err?.message ?? ''] || ERR[err?.data?.error ?? ''] || err?.data?.why || err?.message || 'Xato') + (err?.data?.key ? ` (${err.data.key})` : '');
}

/** `e` — "unauthorized" bo‘lsa true (sahifa /login ga o‘tmoqda) */
export const isUnauthorized = (e: unknown): boolean => (e as Error | null)?.message === 'unauthorized';
