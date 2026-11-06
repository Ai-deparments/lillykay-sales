import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { one, run } from '../db.js';
import { parseCookies, setCookie, HttpError } from './http.js';
import { token, now } from '../util.js';

const SESSION_MS = 14 * 24 * 3600e3;

export function hashPassword(pw) {
  const salt = randomBytes(16);
  return `s1$${salt.toString('base64')}$${scryptSync(pw, salt, 32).toString('base64')}`;
}
export function checkPassword(pw, stored) {
  if (!stored) return false;
  const [v, s, h] = stored.split('$');
  if (v !== 's1') return false;
  const a = scryptSync(pw, Buffer.from(s, 'base64'), 32), b = Buffer.from(h, 'base64');
  return a.length === b.length && timingSafeEqual(a, b);
}

/* Login urinishlari: bir login + IP uchun 10 daqiqada 8 ta. IP — nginx uzatgan X-Real-IP (faqat so‘rov 127.0.0.1 dan kelganda ishoniladi) */
const tries = new Map();
function throttled(key) {
  const t = now(), arr = (tries.get(key) || []).filter(x => t - x < 600e3);
  tries.set(key, arr);
  if (tries.size > 5000) for (const [k, v] of tries) if (!v.length || t - v[v.length - 1] > 600e3) tries.delete(k);
  return arr.length >= 8;
}
export function clientIp(req) {
  const peer = req.socket.remoteAddress || '';
  const local = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
  return (local && String(req.headers['x-real-ip'] || '').trim()) || peer;
}

/* Login — telefon raqami: foydalanuvchi «+998 90 123 45 67», «901234567» yoki «998901234567» deb yozishi mumkin,
   hammasi bir xil loginga keltiriladi. Harf bo‘lsa — eski matnli login, tegilmaydi. */
export const normLogin = v => {
  const s = String(v || '').trim();
  if (/[A-Za-z]/.test(s)) return s.toLowerCase();
  const d = s.replace(/\D/g, '');
  return d.length === 9 ? '998' + d : d;
};

export function login(req, res, loginName, pw) {
  const name = normLogin(loginName);
  const key = `${name}|${clientIp(req)}`;
  if (throttled(key)) throw new HttpError(429, 'too_many');
  const u = one('SELECT * FROM users WHERE login=? AND active=1', name);
  if (!u || !checkPassword(String(pw || ''), u.pass_hash)) { tries.get(key).push(now()); throw new HttpError(401, 'bad_login'); }
  const sid = token(32);
  run('INSERT INTO sessions(id,user_id,created_at,expires_at) VALUES(?,?,?,?)', sid, u.id, now(), now() + SESSION_MS);
  setCookie(res, 'sid', sid, SESSION_MS);
  return u;
}
export function logout(req, res) {
  const sid = parseCookies(req).sid;
  if (sid) run('DELETE FROM sessions WHERE id=?', sid);
  setCookie(res, 'sid', '', 0);
}
export function currentUser(req) {
  const sid = parseCookies(req).sid;
  if (!sid) return null;
  const u = one(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=? AND s.expires_at>? AND u.active=1`, sid, now());
  return u || null;
}

/* Rollar: admin — hamma narsa; rahbar — butun sotuv; filial — o‘z filiali; sotuvchi — o‘z suhbatlari */
export const can = {
  settings: u => ['admin', 'rahbar'].includes(u.role),
  users: u => ['admin', 'rahbar'].includes(u.role),
  audit: () => true,   // jurnal hammaga ochiq: sotuvchi ham kim nima qilganini ko‘radi (faqat o‘qish)
  catalogEdit: u => ['admin', 'rahbar', 'filial'].includes(u.role),
  seeAll: u => ['admin', 'rahbar'].includes(u.role),
  reklama: () => true   // bot orqali reklama: sotuvchi ham yuboradi (2026-10-08, rahbar so‘rovi); kim yuborgani jurnalda qoladi
};
export function need(u, perm) { if (!can[perm](u)) throw new HttpError(403, 'forbidden'); }

/* Suhbatni ko‘ra oladimi: rahbar/admin — hammasi, filial — o‘z filiali, sotuvchi — o‘ziga biriktirilgan yoki biriktirilmagan (navbat) */
export function convScopeSql(u) {
  if (can.seeAll(u)) return { where: '1=1', args: [] };
  if (u.role === 'filial') return { where: '(c.branch_id=? OR c.branch_id IS NULL)', args: [u.branch_id] };
  return { where: '(c.owner_user_id=? OR c.owner_user_id IS NULL OR c.taken_by=?)', args: [u.id, u.id] };
}
export const publicUser = u => u && ({ id: u.id, login: u.login, name: u.name, role: u.role, branch_id: u.branch_id, tg_linked: Boolean(u.tg_chat_id) });
