import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join as join2 } from 'node:path';
import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync as writeFile2, readFileSync as readFile2, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { config } from '../config.js';

const require2 = createRequire(import.meta.url);

/*
  Mijoz yuborgan fayl (rasm, ovoz, video, hujjat) — panelda ko‘rish uchun.
  Telegram: file_id bo‘yicha Bot API dan olinadi. Instagram: xabarda kelgan CDN havolasi (muddati cheklangan) bo‘yicha.
  Olingan fayl data/files/ ga keshlanadi: havola eskirsa ham panelda ochiladi.
*/
const MAX = 25e6;

export async function fetchMedia(media) {
  if (!media) throw new Error('fayl yo‘q');
  const { mkdirSync, existsSync, readFileSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dir = join(config.dataDir, 'files'); mkdirSync(dir, { recursive: true });
  const key = media.uid || media.file_id || (media.url ? createHash('sha256').update(media.url).digest('hex').slice(0, 32) : null);
  if (!key) throw new Error('fayl belgisi yo‘q');
  const cache = join(dir, String(key).replace(/[^A-Za-z0-9_-]/g, ''));
  // Instagram story eslatmasi: Meta shartlariga ko‘ra media serverda saqlanmaydi — har safar havoladan olinadi
  const noCache = media.ch === 'ig' && media.story;
  if (!noCache && existsSync(cache)) return readFileSync(cache);

  let buf;
  if (media.ch === 'ig' || (!media.file_id && media.url)) {
    if (!media.url) throw new Error('havola yo‘q');
    const res = await fetch(media.url, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`fayl yuklanmadi: HTTP ${res.status} (Instagram havolasining muddati o‘tgan bo‘lishi mumkin)`);
    buf = Buffer.from(await res.arrayBuffer());
  } else {
    const { telegramFile } = await import('../channels/telegram.js');
    buf = await telegramFile(media);
  }
  if (buf.length > MAX) throw new Error('fayl juda katta');
  if (!noCache) writeFileSync(cache, buf);
  return buf;
}

/* Video (story, ulashilgan post yoki reels, mijoz videosi) — AI uchun 3 ta kadr bitta rasmda, chapdan o‘ngga: boshi, o‘rtasi, oxiri.
   2026-10-09: story va postlar ko‘pincha video — rasm sifatida o‘qilmay tashlab yuborilardi va AI «storidagi rasm ochilmayapti» derdi.
   Butun videoni Gemini’ga yuborish qimmat (har soniyasi yuzlab token, har qadamda qayta) — kadrlar bitta rasm narxida.
   ffmpeg bo‘lmasa, videoda tasvir bo‘lmasa yoki fayl buzuq bo‘lsa — null (AI matn bo‘yicha javob beradi). */
export const isVideo = b => Boolean(b?.length > 12 && b.subarray(4, 8).toString('latin1') === 'ftyp');
const sh = (cmd, args) => new Promise((ok, fail) => execFile(cmd, args, { timeout: 30000, maxBuffer: 4e6 }, (e, out) => (e ? fail(e) : ok(String(out)))));
export async function videoFrames(buf, { frames = 3 } = {}) {
  if (!isVideo(buf)) return null;
  const dir = mkdtempSync(join2(tmpdir(), 'sales-kadr-'));
  try {
    const src = join2(dir, 'v.mp4'), dst = join2(dir, 'k.jpg');
    writeFile2(src, buf);
    const info = JSON.parse(await sh('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_streams', '-show_format', '-of', 'json', src]));
    const s = info.streams?.[0];
    if (!s) return null;   // faqat ovoz (m4a) — tasvir yo‘q
    const rot = Math.abs(Number(s.side_data_list?.find(x => x.rotation != null)?.rotation ?? s.tags?.rotate ?? 0)) % 180 === 90;
    const w = rot ? s.height : s.width, h = rot ? s.width : s.height;
    const H = w > h ? 360 : 640;   // yotiq video — pastroq, tik — balandroq: umumiy rasm haddan tashqari keng bo‘lmasin
    const dur = Number(info.format?.duration) || Number(s.duration) || 0;
    const at = Array.from({ length: frames }, (_, i) => (dur * (2 * i + 1)) / (2 * frames));   // 1/6, 1/2, 5/6
    const scale = at.map((_, i) => `[${i}:v]scale=-2:${H},setsar=1[v${i}]`).join(';');
    const graph = at.length > 1 ? `${scale};${at.map((_, i) => `[v${i}]`).join('')}hstack=inputs=${at.length}[o]` : scale;
    await sh('ffmpeg', ['-v', 'error', ...at.flatMap(t => ['-ss', t.toFixed(2), '-i', src]), '-filter_complex', graph,
      '-map', at.length > 1 ? '[o]' : '[v0]', '-frames:v', '1', '-q:v', '4', '-y', dst]);
    return readFile2(dst);
  } catch (e) { console.error('[media] videodan kadr olinmadi:', String(e.message || e).slice(0, 200)); return null; }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

/* Tovar rasmi: BILLZ yoki qo‘lda qo‘yilgan havoladan olinadi va keshlanadi (mijozga shu nusxa yuboriladi) */
/* Paneldan yuklangan rasm: data/photos/ ichida saqlanadi (BILLZ havolasi bilan aralashmasin) */
export function panelPhotoDir() {
  const { mkdirSync } = require2('node:fs');
  const dir = join2(config.dataDir, 'photos'); mkdirSync(dir, { recursive: true });
  return dir;
}
export function savePanelPhoto(productId, buf) {
  const { writeFileSync, rmSync } = require2('node:fs');
  const file = `${productId}-${Date.now().toString(36)}.jpg`;
  writeFileSync(join2(panelPhotoDir(), file), buf);
  // eski nusxalar olib tashlanadi (bitta tovarda bitta rasm)
  const { readdirSync } = require2('node:fs');
  for (const f of readdirSync(panelPhotoDir())) if (f.startsWith(`${productId}-`) && f !== file) rmSync(join2(panelPhotoDir(), f), { force: true });
  return file;
}
export async function productPhoto(id) {
  const { one } = await import('../db.js');
  const p = one('SELECT id, name, image_url FROM products WHERE id=?', Number(id));
  if (!p?.image_url) return null;
  const local = String(p.image_url).match(/^(panel|web):(.+)$/);   // paneldan yuklangan yoki internetdan olingan — diskda
  if (local) {
    const { existsSync, readFileSync } = require2('node:fs');
    const f = join2(panelPhotoDir(), local[2].replace(/[^A-Za-z0-9._-]/g, ''));
    return existsSync(f) ? { buf: readFileSync(f), name: p.name } : null;
  }
  // BILLZ havolasi: kesh havolaga bog‘lanadi — rasm almashsa, eskisi qolib ketmaydi
  const tag = createHash('sha256').update(p.image_url).digest('hex').slice(0, 8);
  const buf = await fetchMedia({ url: p.image_url, uid: `product-${p.id}-${tag}`, mime: 'image/jpeg' });
  return { buf, name: p.name };
}

/* Brauzerda yozilgan ovoz (webm/mp4) → Telegram ovozli xabari formati (OGG/Opus). ffmpeg yo‘q bo‘lsa — xato (chaqiruvchi hujjat sifatida yuboradi). */
export async function toOggOpus(buf) {
  const { spawn } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-vn', '-c:a', 'libopus', '-b:a', '32k', '-f', 'ogg', 'pipe:1'], { stdio: ['pipe', 'pipe', 'ignore'] });
    const out = [];
    const t = setTimeout(() => { ff.kill('SIGKILL'); reject(new Error('ffmpeg timeout')); }, 30000);
    ff.stdout.on('data', d => out.push(d));
    ff.on('error', e => { clearTimeout(t); reject(e); });
    ff.on('close', code => { clearTimeout(t); const r = Buffer.concat(out); code === 0 && r.length ? resolve(r) : reject(new Error('ffmpeg xato')); });
    ff.stdin.on('error', () => {});
    ff.stdin.end(buf);
  });
}
