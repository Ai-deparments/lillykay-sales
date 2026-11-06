import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { config, ROOT } from '../config.js';

export function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
export function setCookie(res, name, value, maxAgeMs) {
  const bits = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAgeMs != null) bits.push(`Max-Age=${Math.floor(maxAgeMs / 1000)}`);
  if (config.secure) bits.push('Secure');
  res.setHeader('Set-Cookie', [].concat(res.getHeader('Set-Cookie') || [], bits.join('; ')));
}

/* Xom tana — veb-huk imzosini tekshirish uchun (JSON.parse dan oldin baytlar o‘zgarmasligi kerak) */
export function readRaw(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    const parts = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { req.destroy(); reject(Object.assign(new Error('too_large'), { status: 413 })); } parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

export function readJson(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let s = '', n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { req.destroy(); reject(Object.assign(new Error('too_large'), { status: 413 })); } s += c; });
    req.on('end', () => {
      if (!s) return resolve({});
      try { resolve(JSON.parse(s)); } catch { reject(Object.assign(new Error('bad_json'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY',
  // HTTPS orqali ishlaganda brauzer boshqa hech qachon shifrlanmagan ulanishga tushmasin
  ...(config.secure ? { 'Strict-Transport-Security': 'max-age=31536000' } : {}) };
/* Sahifa faqat o‘z serveridan kod yuklaydi: begona skript (XSS yoki qo‘shimcha) ishlamaydi.
   Shrift — Google Fonts; uslub atributlari (style="...") uchun 'unsafe-inline' kerak. */
const CSP = ["default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com", "img-src 'self' data: blob:", "media-src 'self' blob:", "connect-src 'self'",
  "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'", "object-src 'none'"].join('; ');
export function json(res, obj, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SEC });
  res.end(JSON.stringify(obj));
}
export function redirect(res, to, code = 302) { res.writeHead(code, { Location: to, ...SEC }); res.end(); }

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json; charset=utf-8' };   // o‘rnatiladigan ilova (PWA) manifesti
const PUB = join(ROOT, 'public');
/* Deploydan keyin brauzer eski app.js/app.css bilan qolmasin: HTML ichidagi havolalarga versiya qo‘shiladi.
   Versiya — shu ishga tushishdagi fayl vaqti (deployda servis qayta ishga tushadi → versiya o‘zgaradi). */
let assetV = null;
async function assetVersion() {
  if (assetV) return assetV;
  let m = 0;
  for (const f of ['app.js', 'app.css']) { try { m = Math.max(m, (await stat(join(PUB, f))).mtimeMs); } catch {} }
  assetV = Math.round(m).toString(36);
  return assetV;
}

/* Statik fayl: har safar tekshiriladi (no-cache), lekin o‘zgarmagan bo‘lsa 304 */
export async function serveStatic(res, rel, req = null) {
  const p = normalize(join(PUB, rel));
  if (!p.startsWith(PUB)) return false;
  try {
    const st = await stat(p);
    const tag = `"${st.mtimeMs.toString(36)}-${st.size.toString(36)}"`;
    const head = { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream', 'Cache-Control': extname(p) === '.html' ? 'no-store' : 'no-cache',
      ETag: tag, 'Last-Modified': new Date(st.mtimeMs).toUTCString(), ...SEC, ...(extname(p) === '.html' ? { 'Content-Security-Policy': CSP } : {}) };
    if (req && req.headers['if-none-match'] === tag) { res.writeHead(304, head); res.end(); return true; }
    let buf = await readFile(p);
    if (extname(p) === '.html') {
      const v = await assetVersion();
      buf = Buffer.from(buf.toString('utf8').replace(/"\/app\.(js|css)"/g, (_, x) => `"/app.${x}?v=${v}"`), 'utf8');
    }
    res.writeHead(200, head);
    res.end(buf);
    return true;
  } catch { return false; }
}

/* Kichik router: pattern "/api/conversations/:id/send" */
export function router() {
  const routes = [];
  const add = (method, pattern, ...handlers) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:[a-z_]+/g, m => { keys.push(m.slice(1)); return '([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, handlers });
  };
  const match = (method, path) => {
    for (const r of routes) {
      if (r.method !== method && !(r.method === 'GET' && method === 'HEAD')) continue;
      const m = path.match(r.re);
      if (m) return { handlers: r.handlers, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
    }
    return null;
  };
  return { get: (p, ...h) => add('GET', p, ...h), post: (p, ...h) => add('POST', p, ...h), match };
}

export class HttpError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
export const bad = code => new HttpError(400, code);
