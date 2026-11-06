import { config } from './config.js';
import { serveStatic, json, redirect, readRaw } from './core/http.js';
import { currentUser } from './core/auth.js';
import { run } from './db.js';
import { now } from './util.js';
import { api } from './api.js';
import { verifyWebhook, validSignature, handleWebhook } from './channels/instagram.js';

/*
  Veb qatlami: yo‘naltirish, kirish tekshiruvi, CSRF va Instagram veb-huki.
  server.js dan ajratilgan — sinovlar haqiqiy HTTP orqali shu qatlamni tekshiradi.
*/
const PUBLIC_API = new Set(['/api/login', '/api/logout', '/api/health', '/api/invite', '/api/invite/accept']);

/* CSRF: o‘zgartiruvchi so‘rov faqat shu saytning o‘zidan — JSON tanasi, brauzer belgisi «same-origin», Origin shu sayt */
const PUBLIC_ORIGIN = new URL(config.publicUrl).origin;
function sameOrigin(req) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return false;
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin' && site !== 'none') return false;
  const origin = req.headers.origin;
  if (!origin) return true; // brauzer emas (curl) yoki eski brauzer — cookie baribir SameSite=Lax
  const proto = String(req.headers['x-forwarded-proto'] || (config.secure ? 'https' : 'http')).split(',')[0].trim();
  return origin === PUBLIC_ORIGIN || origin === `${proto}://${req.headers.host}`;
}

export async function handle(req, res) {
  const url = new URL(req.url, 'http://local');
  const path = url.pathname;
  try {
    /* Instagram veb-huki — Meta chaqiradi (kirish talab qilinmaydi, lekin har so‘rov imzo bilan tekshiriladi) */
    if (path === '/webhook/instagram') {
      if (req.method === 'GET') { const r = verifyWebhook(url.searchParams); res.writeHead(r.code, { 'Content-Type': 'text/plain' }); return res.end(r.body); }
      if (req.method !== 'POST') return json(res, { error: 'method' }, 405);
      const raw = await readRaw(req);
      if (!validSignature(raw, req.headers['x-hub-signature-256'])) { res.writeHead(403, { 'Content-Type': 'text/plain' }); return res.end('bad signature'); }
      // Meta javobni tez kutadi (aks holda qayta yuboradi): avval tasdiq, keyin qayta ishlash
      res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('EVENT_RECEIVED');
      let body; try { body = JSON.parse(raw.toString('utf8')); } catch { return; }
      handleWebhook(body).catch(e => console.error('[instagram]', e));
      return;
    }
    if (path.startsWith('/api/')) {
      const m = api.match(req.method, path);
      if (!m) return json(res, { error: 'not_found' }, 404);
      if (req.method !== 'GET' && req.method !== 'HEAD' && !sameOrigin(req)) return json(res, { error: 'csrf' }, 403);
      const u = PUBLIC_API.has(path) ? null : currentUser(req);
      if (!PUBLIC_API.has(path) && !u) return json(res, { error: 'unauthorized' }, 401);
      // Panelda ishlayapti — «online» belgisi (boshliq agent shoshilinch topshiriqni faol sotuvchiga beradi); daqiqada bir marta yoziladi
      if (u && (!u.active_at || now() - u.active_at > 60e3)) run('UPDATE users SET active_at=? WHERE id=?', now(), u.id);
      for (const h of m.handlers) await h(req, res, u, m.params);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, { error: 'method' }, 405);
    if (path === '/' || path === '/index.html') {
      if (!currentUser(req)) return redirect(res, '/login');
      return serveStatic(res, 'index.html', req);
    }
    // Instagram’ga yuboriladigan rasm: Meta shu havoladan oladi (kirishsiz; 48 belgili tasodifiy kalit, 1 soat)
    const om = path.match(/^\/media\/o\/([a-f0-9]{48})$/);
    if (om) {
      const { outImage } = await import('./channels/instagram.js');
      const im = outImage(om[1]);
      if (!im) return json(res, { error: 'not_found' }, 404);
      res.writeHead(200, { 'Content-Type': im.mime, 'Content-Length': im.buf.length, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
      return res.end(im.buf);
    }
    if (path === '/login') return serveStatic(res, 'login.html', req);
    // Taklif havolasi: xodim o‘zi parol qo‘yadi (kirishsiz — havolaning o‘zi kalit)
    if (path === '/taklif') return serveStatic(res, 'taklif.html', req);
    // Ochiq sahifalar (Meta ilovasi talabi): maxfiylik siyosati va ma’lumotlarni o‘chirish yo‘riqnomasi — kirishsiz
    if (path === '/maxfiylik' || path === '/privacy') return serveStatic(res, 'maxfiylik.html', req);
    if (path === '/malumot-ochirish' || path === '/data-deletion') return serveStatic(res, 'malumot-ochirish.html', req);
    if (path === '/yoriqnoma') { if (!currentUser(req)) return redirect(res, '/login'); return serveStatic(res, 'yoriqnoma.html', req); }
    if (/^\/[a-z0-9_-]+\.(js|css|svg|ico|png|webmanifest)$/i.test(path) && await serveStatic(res, path.slice(1), req)) return;
    json(res, { error: 'not_found' }, 404);
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error(req.method, path, e);
    if (!res.headersSent) json(res, { error: e.code || e.message || 'server_error', ...(e.key ? { key: e.key } : {}) }, status);
  }
}
