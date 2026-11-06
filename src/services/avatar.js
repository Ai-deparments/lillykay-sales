import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { all, one, run } from '../db.js';
import { now } from '../util.js';

/*
  Mijozning profil rasmi — panel ro‘yxatida va suhbat kartasida bosh harflar o‘rniga (rahbar so‘rovi, 2026-10-09).
  Telegram: Bot API getUserProfilePhotos (Business ulanishi orqali yozgan mijoz), eng kichik o‘lcham (~160 px).
  Instagram: User Profile API profile_pic — havola bir necha kunda eskiradi, shuning uchun rasm serverga yuklab olinadi.
  Rasm data/avatars/<suhbat id> faylida, 7 kunda bir yangilanadi. Rasm yo‘q yoki mijoz yashirgan — bosh harflar qoladi.
  Instagram so‘rovlari xabar yuborish bilan bir limitda — har aylanishda ko‘pi bilan 3 ta (soatiga ~60), Telegram — 12 ta.
*/
const STALE = 7 * 864e5, RETRY = 3600e3, MAX = 2e6;
const RATE_LIMIT = new Set([4, 17, 32, 613]);   // Instagram/Facebook «juda ko‘p so‘rov» kodlari — vaqtinchalik
const dir = () => join(config.dataDir, 'avatars');
export const avatarFile = id => join(dir(), String(Number(id)));
const kind = b => !b || b.length < 100 ? null
  : b[0] === 0xff && b[1] === 0xd8 ? 'image/jpeg'
  : b[0] === 0x89 && b[1] === 0x50 ? 'image/png'
  : b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' ? 'image/webp' : null;

/* Panel uchun havola: versiya bilan (rasm yangilansa brauzer keshi eskisini ko‘rsatmaydi). Rasm yo‘q — null */
export const avatarUrl = c => (c?.avatar_v ? `/api/conversations/${c.id}/avatar?v=${c.avatar_v}` : null);

/* Fayl va turi; yo‘q yoki buzuq bo‘lsa — null */
export function readAvatar(id) {
  const f = avatarFile(id);
  if (!existsSync(f)) return null;
  const buf = readFileSync(f), mime = kind(buf);
  return mime ? { buf, mime } : null;
}
export function dropAvatar(id) { try { rmSync(avatarFile(id), { force: true }); } catch { /* yo‘q bo‘lsa — mayli */ } }

const defaultFetchers = {
  tg: async id => (await import('../channels/telegram.js')).tgUserPhoto(id),
  ig: async id => (await import('../channels/instagram.js')).igProfilePic(id)
};

/* Bitta suhbat. Rasm bor — saqlanadi; rasm yo‘q — o‘chiriladi (bosh harflar); tarmoq yoki limit xatosi — eskisi qoladi,
   1 soatdan keyin yana; doimiy xato (mijoz topilmadi, ruxsat yo‘q) — 7 kundan keyin. Qaytaradi: true / false / null (xato) */
export async function refreshAvatar(convId, fetchers = defaultFetchers) {
  const c = one(`SELECT c.id, c.ext_user_id, c.ext_chat_id, a.channel FROM conversations c JOIN accounts a ON a.id=c.account_id WHERE c.id=?`, convId);
  if (!c || !fetchers[c.channel]) return null;
  const uid = String(c.ext_user_id || c.ext_chat_id || '');
  if (!/^\d+$/.test(uid)) { run('UPDATE conversations SET avatar_at=? WHERE id=?', now(), c.id); return null; }   // eksport arxivi (tgarx:…)
  let buf;
  try { buf = await fetchers[c.channel](uid); }
  catch (e) {
    // Doimiy: mijoz topilmadi (400) yoki Instagram «User consent is required» (mijoz profilini ko‘rishga ruxsat bermagan, HTTP 500)
    const permanent = ((e?.status === 400 || e?.code === 400) && !RATE_LIMIT.has(Number(e?.igCode))) || /consent/i.test(String(e?.message || ''));
    run('UPDATE conversations SET avatar_at=? WHERE id=?', permanent ? now() : now() - STALE + RETRY, c.id);
    return null;
  }
  const t = now();
  if (buf && buf.length <= MAX && kind(buf)) {
    mkdirSync(dir(), { recursive: true });
    writeFileSync(avatarFile(c.id), buf);
    run('UPDATE conversations SET avatar_at=?, avatar_v=? WHERE id=?', t, t, c.id);
    return true;
  }
  dropAvatar(c.id);
  run('UPDATE conversations SET avatar_at=?, avatar_v=NULL WHERE id=?', t, c.id);
  return false;
}

/* Navbat: oxirgi 30 kunda yozgan, rasmi hali so‘ralmagan yoki 7 kundan eski suhbatlar — avval eng yangi xabarlilari */
let busy = false;
export async function avatarTick({ tg = 12, ig = 3, fetchers = defaultFetchers, pause = 300 } = {}) {
  if (busy) return 0;
  busy = true;
  try {
    const pick = (ch, n) => all(`SELECT c.id FROM conversations c JOIN accounts a ON a.id=c.account_id
        WHERE a.channel=? AND c.is_demo=0 AND c.archived=0 AND c.last_msg_at > ? AND (c.avatar_at IS NULL OR c.avatar_at < ?)
        ORDER BY c.last_msg_at DESC LIMIT ?`, ch, now() - 30 * 864e5, now() - STALE, n).map(r => r.id);
    const ids = [...pick('tg', tg), ...pick('ig', ig)];
    for (const id of ids) {
      await refreshAvatar(id, fetchers);
      if (pause) await new Promise(r => setTimeout(r, pause));
    }
    return ids.length;
  } finally { busy = false; }
}

/* Server ishga tushganda: 30 soniyadan keyin birinchi aylanish, keyin har 3 daqiqada */
export function startAvatars() {
  const tick = () => avatarTick().catch(e => console.error('[avatar]', String(e?.message || e).slice(0, 120)));
  setTimeout(tick, 30000).unref?.();
  setInterval(tick, 3 * 60e3).unref?.();
}
