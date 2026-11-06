import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { one, all, run } from '../db.js';
import { now, clip } from '../util.js';
import { audit } from '../core/audit.js';
import { config } from '../config.js';
import { cbApi, cbReady } from '../channels/keshbek.js';

/*
  Reklama: keshbek botiga «Start» bosganlarning hammasiga yuboriladi.
  Telegram cheklovi ~30 xabar/sekund — biz sekundiga 20 ta yuboramiz va 429 kelsa kutamiz.
  Rasm faqat BIR MARTA yuklanadi: birinchi yuborishdan qaytgan file_id qolganlarga ishlatiladi.
  Bloklagan odam 403 beradi — u belgilanadi va keyingi reklamalar unga yuborilmaydi.
*/

export const adDir = () => { const d = join(config.dataDir, 'reklama'); mkdirSync(d, { recursive: true }); return d; };
export const saveAdPhoto = buf => { const f = `ad-${Date.now().toString(36)}.jpg`; writeFileSync(join(adDir(), f), buf); return f; };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PER_SEC = 20;

async function sendOne(chatId, b, fileId) {
  const markup = b.link_url ? { inline_keyboard: [[{ text: b.link_text || 'Batafsil', url: b.link_url }]] } : undefined;
  if (!b.photo) {
    await cbApi('sendMessage', { chat_id: chatId, text: b.text, reply_markup: markup, disable_web_page_preview: false });
    return null;
  }
  if (fileId) {
    await cbApi('sendPhoto', { chat_id: chatId, photo: fileId, caption: b.text || undefined, reply_markup: markup });
    return fileId;
  }
  // Birinchi yuborish: rasm fayl sifatida yuklanadi, javobdagi file_id qolganlariga ishlatiladi
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  if (b.text) fd.append('caption', b.text);
  if (markup) fd.append('reply_markup', JSON.stringify(markup));
  fd.append('photo', new Blob([readFileSync(join(adDir(), b.photo))], { type: 'image/jpeg' }), 'reklama.jpg');
  const res = await fetch(`https://api.telegram.org/bot${config.cbToken}/sendPhoto`, { method: 'POST', body: fd, signal: AbortSignal.timeout(60000) });
  const j = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
  if (!j.ok) { const e = new Error(j.description || 'telegram_error'); e.code = j.error_code; e.retry = j.parameters?.retry_after; throw e; }
  const ph = j.result?.photo || [];
  return ph.length ? ph[ph.length - 1].file_id : null;
}

let busy = false;
export const adBusy = () => busy;

/*
  Kimga yuboriladi — filtr (paneldan): keshbek summasi dan/gacha (so‘m, BILLZ balansi), faqat raqami bazada topilganlar.
  Bo‘sh filtr — botga Start bosgan hammaga (bloklaganlardan tashqari). Keshbek bo‘yicha filtr faqat tanilgan mijozda
  ma’noli: tanilmaganning balansi noma’lum, shuning uchun summa ko‘rsatilsa ular chiqib ketadi.
*/
export function parseFilter(raw) {
  const f = raw && typeof raw === 'object' ? raw : {};
  const num = v => { const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(/[^\d.-]/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n) : null; };
  const out = { cb_min: num(f.cb_min), cb_max: num(f.cb_max), known: f.known === true || f.known === 'true' || f.known === 1 };
  if (out.cb_min != null && out.cb_max != null && out.cb_max < out.cb_min) [out.cb_min, out.cb_max] = [out.cb_max, out.cb_min];
  return out;
}
const som = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const describeFilter = f => {
  const p = parseFilter(f), s = [];
  if (p.cb_min != null) s.push(`keshbek ${som(p.cb_min)} so‘mdan`);
  if (p.cb_max != null) s.push(`${som(p.cb_max)} so‘mgacha`);
  if (p.known) s.push('faqat tanilgan mijozlar');
  return s.length ? s.join(' · ') : 'hamma obunachi';
};
export function audience(filter) {
  const f = parseFilter(filter), where = ['s.blocked_at IS NULL'], args = [];
  if (f.cb_min != null) { where.push('c.amount >= ?'); args.push(f.cb_min); }
  if (f.cb_max != null) { where.push('COALESCE(c.amount, 0) <= ?'); args.push(f.cb_max); }
  if (f.known || f.cb_min != null) where.push('s.customer_id IS NOT NULL');
  return all(`SELECT s.chat_id, s.customer_id, COALESCE(c.amount, 0) AS cashback FROM cb_subs s
    LEFT JOIN cashback c ON c.customer_id=s.customer_id WHERE ${where.join(' AND ')} ORDER BY s.chat_id`, ...args);
}

export async function runBroadcast(id) {
  if (busy) return { ok: false, why: 'Avvalgi reklama hali yuborilmoqda' };
  const b = one('SELECT * FROM broadcasts WHERE id=? AND started_at IS NULL', Number(id));
  if (!b) return { ok: false, why: 'Reklama topilmadi yoki allaqachon yuborilgan' };
  if (!cbReady()) return { ok: false, why: 'Bot tokeni kiritilmagan' };

  let filter = null; try { filter = b.filter ? JSON.parse(b.filter) : null; } catch {}
  const subs = audience(filter);
  if (!subs.length) return { ok: false, why: 'Filtrga mos obunachi yo‘q' };
  busy = true;
  run('UPDATE broadcasts SET started_at=?, total=? WHERE id=?', now(), subs.length, b.id);
  audit('staff', b.created_by, 'Reklama yuborish boshlandi', { object: `broadcast:${b.id}`, result: `${subs.length} ta obunachi · ${describeFilter(filter)}` });

  let sent = 0, failed = 0, blocked = 0, fileId = null;
  (async () => {
    try {
      for (let i = 0; i < subs.length; i++) {
        const chatId = subs[i].chat_id;
        try {
          const fid = await sendOne(chatId, b, fileId);
          if (fid && !fileId) fileId = fid;
          sent++;
        } catch (e) {
          if (e.retry) {                                    // 429 — Telegram kutishni so‘radi
            await sleep((e.retry + 1) * 1000);
            try { await sendOne(chatId, b, fileId); sent++; } catch { failed++; }
          } else if (e.code === 403) {                      // odam botni bloklagan
            run('UPDATE cb_subs SET blocked_at=? WHERE chat_id=?', now(), chatId);
            blocked++;
          } else failed++;
        }
        if (i % 20 === 19) {
          run('UPDATE broadcasts SET sent=?, failed=?, blocked=? WHERE id=?', sent, failed, blocked, b.id);
          await sleep(1000);                                 // sekundiga ~20 ta
        }
      }
    } finally {
      run('UPDATE broadcasts SET sent=?, failed=?, blocked=?, done_at=? WHERE id=?', sent, failed, blocked, now(), b.id);
      audit('staff', b.created_by, 'Reklama yuborildi', { object: `broadcast:${b.id}`,
        result: `${sent} yetdi · ${blocked} bloklagan · ${failed} xato` });
      busy = false;
    }
  })();

  return { ok: true, total: subs.length };
}
