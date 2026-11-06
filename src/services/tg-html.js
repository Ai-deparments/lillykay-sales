import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
  Telegram Desktop HTML eksportini o‘qish (JSON o‘rniga HTML tanlangan bo‘lsa).
  Har chat — chats/chat_NNNN/messages.html, messages2.html … (sahifada ~1000 xabar).
  HTML’da foydalanuvchi ID yo‘q: yuboruvchi — «from_name» (ism), «joined» xabar — oldingi yuboruvchiniki.
  Yo‘naltirilgan (forwarded) xabar ichidagi from_name yuboruvchi emas — asl muallif.
*/
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export function decode(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (m, e) => {
      if (ENT[e.toLowerCase()] != null) return ENT[e.toLowerCase()];
      if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
      return m;
    })
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/* «05.06.2026 11:20:49 UTC+05:00» → epoch ms */
export function parseDate(t) {
  const m = String(t || '').match(/^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})(?: UTC([+-]\d{2}):?(\d{2}))?/);
  if (!m) return null;
  const [, d, mo, y, h, mi, s, oh = '+05', om = '00'] = m;
  return Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${s}${oh}:${om}`);
}

/* Media turi faqat media_wrap qismidan aniqlanadi (xabar matnidagi so‘zlar chalg‘itmasin) */
function mediaLabel(block) {
  const mw = block.indexOf('class="media_wrap');
  if (mw < 0) return '';
  let b = block.slice(mw);
  const ti = b.indexOf('<div class="text">');
  if (ti >= 0) b = b.slice(0, ti);
  if (/media_voice_message|voice_message/.test(b)) return '[ovozli xabar]';
  if (/media_video_message|round_video/.test(b)) return '[video xabar]';
  if (/sticker/.test(b)) return '[stiker]';
  if (/video_file_wrap|media_video/.test(b)) return '[video]';
  if (/photo_wrap|media_photo/.test(b)) return '[rasm]';
  if (/media_contact/.test(b)) return '[kontakt]';
  if (/media_location|media_venue|media_live_location/.test(b)) return '[joylashuv]';
  if (/media_poll/.test(b)) return '[so‘rovnoma]';
  if (/media_call/.test(b)) return '[qo‘ng‘iroq]';
  if (/media_file|media_audio_file/.test(b)) {
    const n = b.match(/<div class="title bold">([^<]{1,80})<\/div>/);
    return n ? `[fayl: ${decode(n[1])}]` : '[fayl]';
  }
  return '';
}

/* Bitta sahifa → xabarlar. prevFrom — oldingi sahifadan qolgan yuboruvchi («joined» uchun) */
export function parsePage(html, prevFrom = null) {
  const name = decode((html.match(/<div class="page_header">[\s\S]*?<div class="text bold">([\s\S]*?)<\/div>/) || [])[1] || '');
  const parts = html.split(/(?=<div class="message (?:default|service)[^"]*" id="message-?\d+">)/);
  const msgs = [];
  let from = prevFrom;
  for (const b of parts) {
    const head = b.match(/^<div class="message (default|service)([^"]*)" id="message(-?\d+)">/);
    if (!head || head[1] === 'service') continue;
    const joined = /\bjoined\b/.test(head[2]);
    const fwdAt = b.indexOf('class="forwarded body"');
    const own = b.slice(0, fwdAt >= 0 ? fwdAt : b.length);
    const fm = own.match(/<div class="from_name">([\s\S]*?)<\/div>/);
    if (fm) from = decode(fm[1].replace(/<span[\s\S]*$/, ''));
    if (!from) continue;
    const at = parseDate((b.match(/class="pull_right date details" title="([^"]+)"/) || [])[1]);
    if (!at) continue;
    const tm = b.match(/<div class="text">([\s\S]*?)<\/div>/);
    const text = tm ? decode(tm[1]) : '';
    const label = mediaLabel(b);
    const body = [fwdAt >= 0 ? '[yo‘naltirilgan]' : '', label, text].filter(Boolean).join(' ').trim() || '[xabar]';
    msgs.push({ id: head[3], at, from, text: body.slice(0, 4000) });
  }
  return { name, msgs, lastFrom: from };
}

/* Chat papkasi → { name, msgs } (sahifalar tartib bilan: messages.html, messages2.html, …) */
export function parseChatDir(dir) {
  const pages = readdirSync(dir).filter(f => /^messages\d*\.html$/.test(f))
    .sort((a, b) => (Number(a.match(/\d+/)?.[0] || 1)) - (Number(b.match(/\d+/)?.[0] || 1)));
  let name = '', msgs = [], from = null;
  for (const p of pages) {
    const r = parsePage(readFileSync(join(dir, p), 'utf8'), from);
    if (!name) name = r.name;
    msgs = msgs.concat(r.msgs); from = r.lastFrom;
  }
  return { name, msgs };
}

/* Akkaunt egasi: eng ko‘p chatda uchraydigan yuboruvchi (u har bir chatda bor) */
export function detectOwner(chats) {
  const inChats = new Map();
  for (const c of chats) for (const f of new Set(c.msgs.map(m => m.from))) inChats.set(f, (inChats.get(f) || 0) + 1);
  const top = [...inChats].sort((a, b) => b[1] - a[1]);
  return { owner: top[0]?.[0] || null, chats: top[0]?.[1] || 0, next: top[1] || null };
}

const SKIP_NAME = /^(saved messages|избранное|telegram|replies|botfather|spambot)$|bot$/i;
/* O‘chirilgan akkaunt — haqiqiy mijoz bo‘lgan, yozishmasi o‘rganish uchun foydali; arxivda shu nom bilan turadi */
const BOT_CMD = /^\/[a-z_]+(@\w+)?(\s|$)/i;
const DELETED = /^(deleted account|удалённый аккаунт|удаленный аккаунт)$/i;
/* Import rejasi: faqat shaxsiy (ikki kishilik) chatlar; egasining xabari — sotuvchi, qolgani — mijoz */
export function buildPlan(chats, owner, { before = Infinity, skipNames = new Set() } = {}) {
  const plan = [], skipped = { guruh: 0, xizmat: 0, nom: 0, bosh: 0 };
  for (const c of chats) {
    // Egasining o‘z nomidagi chat (ikkinchi akkaunt, «saqlangan» yozuvlar) — mijoz emas
    if (SKIP_NAME.test(c.name.trim()) || c.name.trim() === owner) { skipped.xizmat++; continue; }
    if (skipNames.has(c.name.trim().toLowerCase())) { skipped.nom++; continue; }
    // Ega «/start» kabi buyruq yuborgan chat — bot (nomi «bot» bilan tugamasa ham)
    if (c.msgs.some(m => m.from === owner && BOT_CMD.test(m.text))) { skipped.xizmat++; continue; }
    const others = new Set(c.msgs.filter(m => m.from !== owner).map(m => m.from));
    if (others.size > 1) { skipped.guruh++; continue; }
    const msgs = c.msgs.filter(m => m.at < before).map(m => ({ id: m.id, at: m.at, author: m.from === owner ? 'seller' : 'client', text: m.text }));
    if (!msgs.length) { skipped.bosh++; continue; }
    plan.push({ dir: c.dir, name: DELETED.test(c.name.trim()) ? 'O‘chirilgan akkaunt' : c.name.trim() || c.dir, msgs });
  }
  return { plan, skipped };
}
