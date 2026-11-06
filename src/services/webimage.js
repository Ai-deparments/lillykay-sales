import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { one, run, kvGet, kvSet } from '../db.js';
import { config, geminiReady } from '../config.js';
import { geminiPost } from '../ai/gemini.js';
import { savePanelPhoto } from './media.js';
import { audit } from '../core/audit.js';
import { now } from '../util.js';

/*
  Tovar rasmi internetdan: BILLZ’da ham, panelda ham rasm bo‘lmasa — ishlab chiqaruvchining RASMIY saytidan.
  1) Gemini Google qidiruvi bilan tovarning rasmiy sahifasini topadi (havola qidiruv natijasidan, modelning o‘zi to‘qiganidan emas)
  2) Sahifadan mahsulot rasmi olinadi: JSON-LD Product.image, keyin og:image
  3) Faqat brend domenidagi sahifa qabul qilinadi (dji.com, godox.com…) — begona do‘kon rasmi olinmaydi (mualliflik huquqi va xato rasm xavfi)
  4) Rasm kamida 500 px, JPEG’ga o‘giriladi (1600 px gacha)
  5) Gemini rasmga qarab tasdiqlaydi: «bu aynan shu mahsulotmi?» — yo‘q desa olinmaydi
*/
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';
const DAILY_MAX = Number(process.env.WEBIMG_DAILY || 60);

const brandOf = p => String(p.brand || p.name || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').trim().split(/\s+/)[0] || '';
/* Model kodi: nomdagi harf+raqam bo‘laklari («TT88», «SL60», «Mic Mini 2» → tt88, sl60, mini2). Sahifada shu kod bo‘lmasa —
   bu boshqa model (masalan TT88 o‘rniga T111) va rasm olinmaydi. */
const squash = t => String(t || '').toLowerCase().replace(/[^a-z0-9]/g, '');
export function modelTokens(name) {
  const head = String(name || '').split(/[—–]/)[0].toLowerCase();
  const single = (head.match(/[a-z]+[-\s]?\d+[a-z]*|\d+[a-z]{1,3}/g) || []).map(squash).filter(t => t.length >= 3 && /\d/.test(t));
  // Qisqa kod («M2», «X3») oldingi so‘z bilan: «lark m2» → larkm2 — yolg‘iz «m2» juda ko‘p sahifada uchraydi
  const pairs = [...head.matchAll(/([a-z]{3,})[\s-]+([a-z]?\d+[a-z]?)(?![a-z0-9])/g)].map(m => squash(m[1] + m[2])).filter(t => t.length >= 4);
  // Avlod raqami boshqa joyda yozilishi mumkin: BILLZ «SL60BI II» ↔ sayt «SL60IIBi»
  const gen = [...head.matchAll(/\b([a-z]+\d+)([a-z]*)[\s-]+(ii|iii|iv)\b/g)].flatMap(m => [m[1] + m[3] + m[2], m[1] + m[2] + m[3]]).map(squash);
  return [...new Set([...single, ...pairs, ...gen])];
}
export function pageMatchesModel(page, html, name) {
  const toks = modelTokens(name);
  if (!toks.length) return false;
  const title = (html.match(/<title[^>]*>([^<]{0,300})/i) || [])[1] || '';
  const og = (html.match(/property=["']og:title["'][^>]+content=["']([^"']{0,300})/i) || [])[1] || '';
  const ld = [...html.matchAll(/"name"\s*:\s*"([^"]{0,200})"/g)].slice(0, 5).map(m => m[1]).join(' ');
  const hay = squash(`${decodeURIComponent(page)} ${title} ${og} ${ld}`);
  return toks.some(t => hay.includes(t));
}
/* Sahifa brendning o‘z domenidami: dji → store.dji.com, godox → godox.com, amaran → amarancreators.com */
export function brandHost(url, brand) {
  try { const h = new URL(url).hostname.toLowerCase(); return brand.length >= 3 && h.includes(brand); } catch { return false; }
}

/* HTML’dan mahsulot rasmi: avval JSON-LD (Product.image), keyin og:image / twitter:image */
export function pageImages(html, base) {
  const out = [];
  const abs = u => { try { return new URL(String(u).trim(), base).href; } catch { return null; } };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let j; try { j = JSON.parse(m[1].trim()); } catch { continue; }
    const nodes = (Array.isArray(j) ? j : [j]).flatMap(x => x?.['@graph'] || [x]);
    for (const n of nodes) {
      const t = [].concat(n?.['@type'] || []).join(' ');
      if (!/Product/i.test(t)) continue;
      for (const im of [].concat(n.image || [])) { const u = typeof im === 'string' ? im : im?.url || im?.contentUrl; if (u) out.push(abs(u)); }
    }
  }
  for (const re of [/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)/gi, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image/gi,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)/gi])
    for (const m of html.matchAll(re)) out.push(abs(m[1]));
  // Ayrim saytlar (masalan godox.com) rasmni faqat oddiy <img> da beradi — sahifa tartibida (asosiy galereya odatda birinchi).
  // Logo, ikonka, banner va SVG/GIF olinmaydi; to‘g‘riligini keyin o‘lcham va AI tekshiradi.
  const SKIP = /logo|icon|sprite|favicon|avatar|banner|flag|qrcode|qr[-_]|wechat|weixin|footer|header|placeholder|loading|\.svg|\.gif/i;
  for (const m of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const src = (tag.match(/\b(?:data-src|data-original|data-lazy-src|src)=["']([^"']+)["']/i) || [])[1] || (tag.match(/\bsrcset=["']([^\s"',]+)/i) || [])[1];
    if (!src || /^data:/i.test(src) || SKIP.test(src) || SKIP.test(tag.match(/\balt=["']([^"']*)/i)?.[1] || '')) continue;
    if (!/\.(jpe?g|png|webp)(\?|$)/i.test(src)) continue;
    out.push(abs(src));
  }
  return [...new Set(out.filter(u => u && /^https:\/\//.test(u)))];
}

/* Rasm havolasining asl (katta) nusxasi: saytlar og:image’ga kichik nusxa qo‘yadi.
   DJI: «…@374*374.png» → «….png»; Shopify: «…_600x600.jpg» → «….jpg»; «?width=400» → olib tashlanadi. Avval asli, keyin berilgani. */
export function bigVariants(u) {
  const out = [];
  const noSize = u.replace(/@\d+\*\d+(?=\.[a-z]{3,4}(\?|$))/i, '').replace(/_\d{2,4}x\d{0,4}(?=\.[a-z]{3,4}(\?|$))/i, '');
  if (noSize !== u) out.push(noSize);
  try { const x = new URL(u); let ch = false; for (const k of ['width', 'height', 'w', 'h', 'size']) if (x.searchParams.has(k)) { x.searchParams.delete(k); ch = true; } if (ch) out.push(x.href); } catch {}
  out.push(u);
  return [...new Set(out)];
}

/* Rasm o‘lchami (JPEG/PNG/WebP sarlavhasidan) */
export function imageSize(b) {
  if (b[0] === 0x89 && b[1] === 0x50) return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), t: 'png' };
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i < b.length - 9) {
      if (b[i] !== 0xff) { i++; continue; }
      const mk = b[i + 1], len = b.readUInt16BE(i + 2);
      if (mk >= 0xc0 && mk <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(mk)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7), t: 'jpeg' };
      i += 2 + len;
    }
    return null;
  }
  if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const f = b.toString('ascii', 12, 16);
    if (f === 'VP8X') return { w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3), t: 'webp' };
    if (f === 'VP8 ') return { w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff, t: 'webp' };
    if (f === 'VP8L') { const v = b.readUInt32LE(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1, t: 'webp' }; }
  }
  return null;
}

async function get(url, { timeoutMs = 15000, max = 10e6, accept } = {}) {
  const res = await fetch(url, { headers: { 'user-agent': UA, ...(accept ? { accept } : {}) }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > max) throw new Error('juda katta');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > max) throw new Error('juda katta');
  return { buf, type: res.headers.get('content-type') || '', url: res.url };
}

/* Qidiruv natijasidagi havola (Google yo‘naltirish havolasi bo‘lishi mumkin) → haqiqiy manzil */
async function realUrl(u) {
  if (!/grounding-api-redirect|vertexaisearch/.test(u)) return u;
  try { const r = await fetch(u, { redirect: 'manual', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(8000) }); return r.headers.get('location') || u; } catch { return u; }
}

function toJpeg(buf) {
  return new Promise((resolve, reject) => {
    const dir = mkdtempSync(join(tmpdir(), 'wimg-')), inp = join(dir, 'in'), out = join(dir, 'out.jpg');
    writeFileSync(inp, buf);
    // Shaffof fon (PNG/WebP) oq fonga qo‘yiladi — aks holda JPEG’da qora bo‘lib qoladi
    const vf = "[0]format=rgba,scale='min(1600,iw)':-2,split[a][b];[a]drawbox=c=white:t=fill[bg];[bg][b]overlay=format=auto";
    const p = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', inp, '-filter_complex', vf, '-frames:v', '1', '-q:v', '3', out], { stdio: 'ignore' });
    const t = setTimeout(() => p.kill('SIGKILL'), 30000);
    p.on('error', e => { clearTimeout(t); rmSync(dir, { recursive: true, force: true }); reject(e); });
    p.on('close', code => {
      clearTimeout(t);
      try { if (code !== 0 || !existsSync(out)) throw new Error('ffmpeg ' + code); resolve(readFileSync(out)); }
      catch (e) { reject(e); } finally { rmSync(dir, { recursive: true, force: true }); }
    });
  });
}

async function sameProduct(buf, name) {
  const r = await geminiPost({
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') } },
      { text: `Bu — do‘konda «${name}» tovarini ko‘rsatish uchun rasm. Rasmda shu mahsulot (yoki uning to‘plami, qutisi bilan) ko‘rsatilganmi? Boshqa model, faqat banner, logotip yoki odamning surati bo‘lsa — YOQ. Faqat HA yoki YOQ deb javob ber.` }] }],
    generationConfig: { maxOutputTokens: 300, thinkingConfig: { thinkingLevel: 'minimal' } }
  }, { timeoutMs: 40000, retries: 2 });
  const t = (r.candidates?.[0]?.content?.parts || []).filter(p => p.text && !p.thought).map(p => p.text).join('').trim();
  return /^\s*HA\b/i.test(t);
}

/* Asosiy: tovar uchun rasm topib saqlaydi. Qaytaradi { ok, source } yoki { ok:false, why }.
   Bir tovar uchun bir vaqtda bitta qidiruv: oldindan boshlangan qidiruv bo‘lsa, keyingi chaqiruv o‘sha natijani kutadi. */
const inflight = new Map();
export function findProductImage(productId) {
  const p = one('SELECT id, name, brand, image_url FROM products WHERE id=?', Number(productId));
  if (!p) return Promise.resolve({ ok: false, why: 'tovar topilmadi' });
  if (p.image_url) return Promise.resolve({ ok: true, already: true });
  if (!geminiReady()) return Promise.resolve({ ok: false, why: 'AI kaliti yo‘q' });
  if (inflight.has(p.id)) return inflight.get(p.id);
  const day = new Date().toISOString().slice(0, 10), used = Number(kvGet(`webimg:${day}`) || 0);
  if (used >= DAILY_MAX) return Promise.resolve({ ok: false, why: 'kunlik chegara' });
  kvSet(`webimg:${day}`, used + 1);
  const job = searchImage(p).finally(() => inflight.delete(p.id));
  inflight.set(p.id, job);
  return job;
}

async function searchImage(p) {
  try {
    const brand = brandOf(p);
    if (!modelTokens(p.name).length) return { ok: false, why: 'nomda model kodi yo‘q — internetdan xato rasm olish xavfi' };
    // 1) rasmiy sahifa — Google qidiruvi orqali (birinchi urinish umumiy, ikkinchisi — faqat brend saytida)
    const model = (String(p.name).split(/[—–]/)[0] || p.name).trim();
    const asks = [`Mahsulot: «${model}»${p.brand ? ` (brend: ${p.brand})` : ''}. Shu mahsulotning ishlab chiqaruvchi RASMIY saytidagi mahsulot sahifasini top. Faqat bitta havola yoz.`,
      `«${model}» — ${brand} rasmiy saytidagi (site:${brand}.com) aynan shu model sahifasining havolasi. Faqat havola yoz.`];
    const tried = new Set();
    for (const ask of asks) {
      const r = await geminiPost({ contents: [{ role: 'user', parts: [{ text: ask }] }], tools: [{ googleSearch: {} }],
        generationConfig: { maxOutputTokens: 1024, thinkingConfig: { thinkingLevel: 'minimal' } } }, { timeoutMs: 40000, retries: 2 });
      const cand = r.candidates?.[0] || {};
      const text = (cand.content?.parts || []).map(x => x.text || '').join(' ');
      const urls = [];
      for (const u of (cand.groundingMetadata?.groundingChunks || []).map(c => c.web?.uri).filter(Boolean)) urls.push(await realUrl(u));
      for (const m of text.matchAll(/https?:\/\/[^\s)"'<>]+/g)) urls.push(m[0].replace(/[.,]+$/, ''));   // matndagi havola — faqat brend domeni bo‘lsa
      const pages = [...new Set(urls)].filter(u => brandHost(u, brand) && !tried.has(u)).slice(0, 4);
      const got = await fromPages(pages, p, tried);
      if (got) return got;
    }
    return { ok: false, why: `rasmiy saytda mos rasm topilmadi (${brand || 'brend noma’lum'})` };
  } catch (e) {
    return { ok: false, why: String(e.code || e.message || e) };
  }
}

/* 2) sahifalardan rasm: model kodi mos sahifa → mahsulot rasmi (asl nusxa) → JPEG → AI tasdig‘i → saqlash */
async function fromPages(pages, p, tried) {
    for (const page of pages) {
      tried.add(page);
      let html;
      try { html = (await get(page, { max: 4e6, accept: 'text/html' })).buf.toString('utf8'); } catch { continue; }
      if (!pageMatchesModel(page, html, p.name)) continue;   // boshqa model sahifasi
      // Nomzodlar parallel yuklanadi (asl katta nusxasi bilan); ≥500 px lari kvadratga yaqinlik bo‘yicha saralanadi —
      // mahsulot surati odatda kvadrat, reklama slaydi esa keng (16:9). AI ko‘pi bilan 5 tasini tekshiradi.
      const loaded = await Promise.all(pageImages(html, page).slice(0, 12).map(async img0 => {
        for (const img of bigVariants(img0)) {
          try { const x = await get(img, { max: 12e6, accept: 'image/*' }); const z = /^image\//.test(x.type) && imageSize(x.buf);
            if (z && Math.min(z.w, z.h) >= 500) return { raw: x, sz: z }; } catch {}
        }
        return null;
      }));
      const ranked = loaded.map((x, i) => x && { ...x, i, sq: Math.abs(Math.log(x.sz.w / x.sz.h)) }).filter(Boolean)
        .sort((a, b) => (a.sq > 0.35) - (b.sq > 0.35) || a.i - b.i).slice(0, 5);
      for (const { raw, sz } of ranked) {
        let jpg;
        try { jpg = await toJpeg(raw.buf); } catch { if (sz.t === 'jpeg' && raw.buf.length < 3e6) jpg = raw.buf; else continue; }
        // 3) AI tasdig‘i: aynan shu mahsulot
        if (!(await sameProduct(jpg, p.name).catch(() => false))) continue;
        const file = savePanelPhoto(p.id, jpg);
        run('UPDATE products SET image_url=?, image_source=?, updated_at=? WHERE id=? AND (image_url IS NULL OR image_url=\'\')', `web:${file}`, page, now(), p.id);
        audit('ai', 'Katalog agenti', `Tovar rasmi internetdan olindi: ${p.name}`, { object: `product:${p.id}`, data: page, result: `${sz.w}×${sz.h}` });
        return { ok: true, source: page };
      }
    }
  return null;
}

/* Navbat: mijoz so‘ragan, lekin rasmi yo‘q tovarlar — fonda birma-bir (soatiga ko‘pi bilan 6 ta) */
const queue = new Set();
export const queueProductImage = id => { if (queue.size < 200) queue.add(Number(id)); };
let lastRun = 0;
export async function webImageJob() {
  if (!queue.size || !geminiReady() || now() - lastRun < 10 * 60e3) return;
  lastRun = now();
  const ids = [...queue].slice(0, 1);
  for (const id of ids) { queue.delete(id); await findProductImage(id).catch(() => {}); }
}
