import { config, aiReady } from './config.js';
import { aiInfo } from './ai/index.js';
import { one, all, run, tx, kvGet } from './db.js';
import { now, code6, token, jparse, clip } from './util.js';
import { router, readJson, json, HttpError, bad } from './core/http.js';
import { login, logout, currentUser, need, can, convScopeSql, publicUser, hashPassword, checkPassword, normLogin } from './core/auth.js';
import { audit, recentAudit } from './core/audit.js';
import { getSettings, updateSettings, recentChanges, logChange } from './services/settings.js';
import * as inbox from './services/inbox.js';
import { customerProfile, billzMode, resetBranchKinds } from './services/billz.js';
import { listProducts, product, saveProduct, verifyProduct, cardForAgent } from './services/catalog.js';
import { avatarUrl, readAvatar } from './services/avatar.js';
import { hasDemo, simulateClient } from './services/demo.js';
import { botUsername, telegramRunning } from './channels/telegram.js';
import { fetchMedia } from './services/media.js';
import { odooLive, odooStatus, syncOdoo } from './services/odoo.js';

export const api = router();
const R = api;

/* ---------- auth ---------- */
R.post('/api/login', async (req, res) => {
  const b = await readJson(req);
  const u = login(req, res, b.login, b.password);
  audit('staff', u.name, 'Panelga kirdi');
  json(res, { ok: true, user: publicUser(u) });
});
R.post('/api/logout', async (req, res) => { logout(req, res); json(res, { ok: true }); });
R.get('/api/health', (req, res) => json(res, { ok: true, t: now() }));

/* Qolgan hammasi — kirgan foydalanuvchi uchun (server.js tekshiradi) */
R.get('/api/bootstrap', (req, res, u) => json(res, {
  me: publicUser(u), now: now(), settings: getSettings(), stages: inbox.STAGES,
  accounts: all('SELECT id,channel,name,mode,rollout,ai_enabled,can_reply,enabled,is_demo,branch_id,owner_user_id FROM accounts ORDER BY is_demo, id'),
  branches: all('SELECT * FROM branches WHERE active=1 ORDER BY name'),
  users: all('SELECT id,name,role,branch_id FROM users WHERE active=1 ORDER BY name'),
  integrations: integrations(), demo: hasDemo(), bot: botUsername()
}));

function integrations() {
  const rows = Object.fromEntries(all('SELECT * FROM integrations').map(r => [r.name, r]));
  return {
    telegram: rows.telegram || { state: 'off', detail: 'Bot tokeni kiritilmagan' },
    billz: rows.billz || { state: billzMode(), detail: '' },
    ai: aiReady() ? { state: 'ok', detail: aiInfo() } : { state: 'off', detail: 'AI kaliti kiritilmagan (Gemini yoki Anthropic: deploy/sozla.sh) — AI qoralama yozmaydi' },
    instagram: rows.instagram || { state: 'off', detail: 'Meta ilovasi va ruxsati kutilmoqda' },
    odoo: rows.odoo || { state: odooLive() ? 'wait' : 'off', detail: odooLive() ? 'Birinchi sinxron kutilmoqda' : 'ODOO_URL va ODOO_API_KEY kiritilmagan' },
    backup: backupState()
  };
}

/* ---------- Odoo CRM (faqat o‘qish): holat va qo‘lda sinxron ---------- */
R.get('/api/odoo/status', (req, res, u) => { need(u, 'settings'); json(res, odooStatus()); });
R.post('/api/odoo/sync', async (req, res, u) => {
  need(u, 'settings');
  audit('staff', u.name, 'Odoo sinxronini qo‘lda boshladi');
  json(res, { ok: true, ...(await syncOdoo({ force: true, who: u.name })) });
});

/* Zaxira nusxa: har kuni Toshkent vaqti 02:30 da (systemd sales-backup.timer). 36 soat kechiksa — rahbarga Telegram xabari. */
function backupState() {
  const at = Number(kvGet('backup_at') || 0), info = kvGet('backup_info') || '';
  if (!at) return { state: 'off', detail: 'Hali zaxira nusxa olinmagan' };
  const hours = Math.round((now() - at) / 36e5);
  const when = new Date(at + 5 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
  return { state: hours > 36 ? 'error' : 'ok', detail: `Oxirgisi: ${when}${hours > 36 ? ` (${hours} soat oldin — tekshirish kerak)` : ''} · ${info}` };
}

/* ---------- suhbatlar ---------- */
function convRow(c) {
  const s = getSettings();
  const d = one('SELECT id,status,reason FROM drafts WHERE conversation_id=? ORDER BY id DESC LIMIT 1', c.id);
  const last = one(`SELECT author,text,created_at,user_id,meta FROM messages WHERE conversation_id=? ORDER BY created_at DESC, id DESC LIMIT 1`, c.id);
  const waitMin = c.pending_since ? Math.floor((now() - c.pending_since) / 60e3) : 0;
  return {
    id: c.id, name: c.display_name || c.handle || `Suhbat #${c.id}`, handle: c.handle, channel: c.channel, account: c.account_name, is_demo: c.is_demo,
    avatar: avatarUrl(c),
    branch: c.branch_name, owner: c.owner_name, taken_by: c.taken_name, heat: c.heat, stage: c.stage, big_order: c.big_order, big_accepted: Boolean(c.big_accepted_by),
    last_text: last ? clip(last.text.split('\n')[0], 120) : '', last_author: last?.author, last_user_id: last?.user_id ?? null, last_via: jparse(last?.meta, {})?.via ?? null, last_at: c.last_msg_at,
    pending_since: c.pending_since, ai_due_at: c.ai_due_at, wait_min: waitMin, overdue: Boolean(c.pending_since && !c.ai_due_at && waitMin >= s.small_max_wait_minutes),
    draft: d ? { status: d.status, reason: d.reason } : null, mode: c.mode, rollout: c.rollout, remind_at: c.remind_at
  };
}
const CONV_SQL = `SELECT c.*, a.channel, a.name AS account_name, a.rollout, b.name AS branch_name, o.name AS owner_name, t.name AS taken_name
  FROM conversations c JOIN accounts a ON a.id=c.account_id LEFT JOIN branches b ON b.id=c.branch_id
  LEFT JOIN users o ON o.id=c.owner_user_id LEFT JOIN users t ON t.id=c.taken_by`;

/* Ro‘yxat: jonli suhbatlar (navbat birinchi). ?arxiv=1 — eksportdan yuklangan eski yozishmalar (so‘nggisi birinchi, ?before= bilan davomi).
   ?q= — ism, @username yoki telefon bo‘yicha qidiruv (jonli + arxiv). SQLite LIKE kirill harflarida katta-kichikni farqlaydi — shuning uchun JS’da. */
const fold = t => String(t || '').toLowerCase().replace(/[‘’ʻʼ'`]/g, '');
R.get('/api/conversations', (req, res, u) => {
  const sc = convScopeSql(u), q = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const archivedTotal = one(`SELECT count(*) n FROM conversations c WHERE c.archived=1 AND ${sc.where}`, ...sc.args).n;
  if (q.q && String(q.q).trim().length >= 2) {
    const raw = String(q.q).trim(), needle = fold(raw), digits = raw.replace(/\D/g, '');
    const scoped = all(`SELECT c.id, c.display_name, c.handle, c.phone FROM conversations c WHERE ${sc.where} ORDER BY c.archived, c.last_msg_at DESC`, ...sc.args);
    const byName = scoped.filter(c => fold(c.display_name).includes(needle) || fold(c.handle).includes(needle) || (digits.length >= 4 && String(c.phone || '').includes(digits))).map(c => c.id);
    // xabar matni bo‘yicha (masalan, mahsulot nomi): LIKE lotin harflarida katta-kichikni farqlamaydi
    const allowed = new Set(scoped.map(c => c.id));
    const byText = all(`SELECT conversation_id id, max(created_at) at FROM messages WHERE text LIKE ? ESCAPE '\\' GROUP BY conversation_id ORDER BY at DESC LIMIT 300`,
      `%${raw.replace(/[\\%_]/g, m => '\\' + m)}%`).map(r => r.id).filter(id => allowed.has(id));
    const ids = [...new Set([...byName, ...byText])].slice(0, 100), order = new Map(ids.map((id, i) => [id, i]));
    const rows = ids.length ? all(`${CONV_SQL} WHERE c.id IN (${ids.map(() => '?').join(',')})`, ...ids).sort((a, b) => order.get(a.id) - order.get(b.id)) : [];
    return json(res, { now: now(), items: rows.map(convRow), archived_total: archivedTotal, search: true });
  }
  if (q.arxiv === '1') {
    const before = Number(q.before) || Number.MAX_SAFE_INTEGER;
    const rows = all(`${CONV_SQL} WHERE c.archived=1 AND c.last_msg_at<? AND ${sc.where} ORDER BY c.last_msg_at DESC LIMIT 200`, before, ...sc.args);
    return json(res, { now: now(), items: rows.map(convRow), archived_total: archivedTotal, more: rows.length === 200 });
  }
  const rows = all(`${CONV_SQL} WHERE c.archived=0 AND ${sc.where} ORDER BY
      CASE WHEN c.pending_since IS NOT NULL THEN 0 ELSE 1 END, c.big_order DESC, c.pending_since ASC, c.last_msg_at DESC LIMIT 300`, ...sc.args);
  json(res, { now: now(), items: rows.map(convRow), archived_total: archivedTotal });
});

function convFor(u, id) {
  const sc = convScopeSql(u);
  const c = one(`${CONV_SQL} WHERE c.id=? AND ${sc.where}`, Number(id), ...sc.args);
  if (!c) throw new HttpError(404, 'not_found');
  return c;
}

/* ---------- Mijozlar doskasi (Trello uslubida): jonli suhbatlar bosqich bo‘yicha ustunlarda ----------
   Ko‘rinadi: oxirgi 30 kunda yozishgan, yoki bosqichi o‘tgan, telefon bergan, qiziqqan mijozlar. Rol doirasi saqlanadi. */
R.get('/api/board', (req, res, u) => {
  const sc = convScopeSql(u), t = now();
  const rows = all(`SELECT c.id, c.display_name, c.handle, c.phone, c.stage, c.heat, c.heat_why, c.asked, c.budget, c.next_step, c.lost_reason,
      c.last_msg_at, c.last_client_at, c.last_seller_at, c.last_ai_at, c.pending_since, c.advice, c.advice_at, o.name owner_name, a.channel,
      cu.phone billz_phone, cu.verified_at
    FROM conversations c JOIN accounts a ON a.id=c.account_id LEFT JOIN users o ON o.id=c.owner_user_id LEFT JOIN customers cu ON cu.id=c.customer_id
    WHERE c.archived=0 AND a.is_demo=0 AND ${sc.where}
      AND (c.stage>0 OR c.phone IS NOT NULL OR c.heat IN ('iliq','issiq') OR c.last_msg_at > ?)
    ORDER BY c.last_msg_at DESC LIMIT 400`, ...sc.args, t - 30 * 864e5);
  const items = rows.map(c => ({
    id: c.id, name: c.display_name || c.handle || `Suhbat #${c.id}`, handle: c.handle, channel: c.channel,
    phone: c.phone || (c.verified_at ? c.billz_phone : null), stage: c.stage, lost: c.lost_reason, heat: c.heat, heat_why: c.heat_why,
    asked: c.asked, budget: c.budget, next_step: c.next_step, owner: c.owner_name, last_at: c.last_msg_at, waiting: Boolean(c.pending_since),
    advice: c.advice, advice_at: c.advice_at
  }));
  // Bugun e’tibor: telefon bergan, qiziqqan, hali sotilmagan va 2 soatdan beri bizdan xabar bo‘lmagan mijozlar
  const focus = rows.filter(c => c.phone && !c.lost_reason && c.stage >= 1 && c.stage <= 4 && ['iliq', 'issiq'].includes(c.heat)
      && t - Math.max(c.last_seller_at || 0, c.last_ai_at || 0) > 2 * 3600e3)
    .sort((a, b) => (b.heat === 'issiq') - (a.heat === 'issiq') || b.stage - a.stage).slice(0, 6).map(c => c.id);
  json(res, { now: t, stages: inbox.STAGES, items, focus });
});

/* Sotuvchiga AI maslahati: mijoz nima istaydi, keyingi eng yaxshi qadam, nima taklif qilish. Mijozga hech narsa yuborilmaydi */
R.post('/api/conversations/:id/advice', async (req, res, u, p) => {
  const c = convFor(u, p.id);
  if (c.advice_at && now() - c.advice_at < 10 * 60e3) return json(res, { ok: true, advice: c.advice, cached: true });
  const { sellerAdvice } = await import('./agents/fokus.js');
  const r = await sellerAdvice(c, inbox.account(c.account_id));
  if (!r.ok) return json(res, r, 409);
  run('UPDATE conversations SET advice=?, advice_at=? WHERE id=?', r.text, now(), c.id);
  audit('ai', 'Muloqot agenti', `Sotuvchiga maslahat (${u.name} so‘radi): ${c.display_name || 'mijoz'}`, { object: `conv:${c.id}` });
  json(res, { ok: true, advice: r.text });
});

/* Xabarlar: oxirgi MSG_PAGE ta; ?older=N — oldingi sahifalar ham (eski arxiv chatlarda minglab xabar bo‘ladi) */
const MSG_PAGE = 300;
R.get('/api/conversations/:id', (req, res, u, p) => {
  const q = Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const c = convFor(u, p.id), a = inbox.account(c.account_id), e = inbox.effective(c, a);
  const total = one('SELECT count(*) n FROM messages WHERE conversation_id=?', c.id).n;
  const take = Math.min(total, MSG_PAGE * (1 + Math.max(0, Math.min(50, Number(q.older) || 0))));
  const messages = all(`SELECT * FROM (SELECT m.id,m.author,m.text,m.created_at,m.meta,m.ext_msg_id,u.name AS user_name FROM messages m LEFT JOIN users u ON u.id=m.user_id
                        WHERE m.conversation_id=? ORDER BY m.created_at DESC, m.id DESC LIMIT ?) ORDER BY created_at, id`, c.id, take);
  const drafts = all(`SELECT * FROM drafts WHERE conversation_id=? ORDER BY id DESC LIMIT 12`, c.id).map(d => ({
    id: d.id, batch: d.batch, status: d.status, text: d.text, reason: d.reason, created_at: d.created_at, decided_at: d.decided_at,
    decided_by: d.decided_by, sources: jparse(d.sources, []), rating: d.rating, meta_tag: null,
    photos: (jparse(d.photo_ids, null) || (d.photo_product_id ? [d.photo_product_id] : [])).map(id => ({ id, name: one('SELECT name FROM products WHERE id=?', id)?.name || 'tovar' }))
  }));
  const tasks = all(`SELECT * FROM tasks WHERE conversation_id=? AND status='open' ORDER BY id DESC`, c.id);
  json(res, {
    now: now(), conv: { ...convRow(c), ...pick(c, ['asked', 'budget', 'purpose', 'lang', 'next_step', 'note', 'source', 'source_note', 'heat_why', 'heat_by', 'lost_reason', 'lost_evidence',
      'created_at', 'customer_id', 'big_order_json', 'window_until', 'owner_user_id', 'branch_id', 'remind_note', 'archived']) },
    account: { id: a.id, name: a.name, channel: a.channel, mode: a.mode, rollout: a.rollout, can_reply: a.can_reply, is_demo: a.is_demo },
    effective: { ...e, T: getSettings().T_seconds, channel_open: inbox.channelOpen(c, a) },
    messages: messages.map(m => ({ ...m, meta: jparse(m.meta, null) })), messages_total: total, drafts, tasks,
    customer: customerProfile(c.customer_id)
  });
});
const pick = (o, ks) => Object.fromEntries(ks.map(k => [k, o[k]]));

/* Mijoz yuborgan fayl (rasm, ovoz, hujjat) — faqat suhbatni ko‘ra oladigan xodimga */
const INLINE = /^(image\/(jpeg|png|webp|gif)|audio\/(ogg|mpeg|mp4)|video\/(mp4|webm))$/;
R.get('/api/files/:id', async (req, res, u, p) => {
  const m = one('SELECT * FROM messages WHERE id=?', Number(p.id));
  if (!m) throw new HttpError(404, 'not_found');
  convFor(u, m.conversation_id);
  const media = jparse(m.meta, {})?.media;
  if (!media) throw new HttpError(404, 'no_media');
  const buf = await fetchMedia(media).catch(e => { throw Object.assign(new HttpError(502, String(e.message || e))); });
  const mime = String(media.mime || 'application/octet-stream').toLowerCase();
  const inline = INLINE.test(mime);
  const name = String(media.name || `${media.kind}-${m.id}`).replace(/[^\w.\- ]/g, '_');
  res.writeHead(200, { 'Content-Type': inline ? mime : 'application/octet-stream', 'Content-Length': buf.length,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name}"`, 'Cache-Control': 'private, max-age=86400',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
  res.end(buf);
});
/* Mijozning profil rasmi — faqat shu suhbatni ko‘ra oladigan xodimga (ro‘yxat va karta uchun) */
R.get('/api/conversations/:id/avatar', (req, res, u, p) => {
  const c = convFor(u, p.id), a = readAvatar(c.id);
  if (!a) throw new HttpError(404, 'no_avatar');
  res.writeHead(200, { 'Content-Type': a.mime, 'Content-Length': a.buf.length, 'Cache-Control': 'private, max-age=604800',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
  res.end(a.buf);
});
R.post('/api/conversations/:id/send', async (req, res, u, p) => {
  const c = convFor(u, p.id), b = await readJson(req);
  const r = await inbox.sellerSend(c.id, u, b.text, b.reply_to);
  json(res, r, r.ok ? 200 : 409);
});
/* Fayl yuborish (rasm, video, ovoz, hujjat): brauzer base64 JSON beradi. Ovoz — ffmpeg bo‘lsa OGG/Opus ga o‘giriladi (Telegram ovozli xabari). */
const FILE_MAX = 15e6;
const kindOf = (mime, asVoice) => asVoice ? 'voice' : /^image\/(jpeg|png|webp)$/.test(mime) ? 'photo' : /^video\//.test(mime) ? 'video' : /^audio\/(mpeg|mp4|x-m4a)$/.test(mime) ? 'audio' : 'document';
R.post('/api/conversations/:id/file', async (req, res, u, p) => {
  const c = convFor(u, p.id), b = await readJson(req, 22e6);
  let buf = Buffer.from(String(b.data || '').replace(/^data:[^,]+,/, ''), 'base64');
  if (buf.length < 1 || buf.length > FILE_MAX) return json(res, { ok: false, why: 'Fayl bo‘sh yoki juda katta (15 MB gacha)' }, 400);
  let mime = String(b.type || 'application/octet-stream').split(';')[0].toLowerCase(), name = String(b.name || 'fayl').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
  let kind = kindOf(mime, b.voice === true);
  if (kind === 'voice') {
    const { toOggOpus } = await import('./services/media.js');
    const ogg = await toOggOpus(buf).catch(() => null);
    if (ogg) { buf = ogg; mime = 'audio/ogg'; name = 'ovoz.ogg'; } else { kind = 'document'; name = name.replace(/\.\w+$/, '') + '.webm'; }
  }
  const r = await inbox.sellerSendFile(c.id, u, { buf, name, mime, kind }, b.caption, b.reply_to);
  json(res, r, r.ok ? 200 : 409);
});
R.post('/api/messages/:id/edit', async (req, res, u, p) => {
  const m = one('SELECT conversation_id FROM messages WHERE id=?', Number(p.id));
  if (!m) throw new HttpError(404, 'not_found');
  convFor(u, m.conversation_id);
  const b = await readJson(req), r = await inbox.editSellerMessage(p.id, u, b.text);
  json(res, r, r.ok ? 200 : 409);
});
R.post('/api/messages/:id/delete', async (req, res, u, p) => {
  const m = one('SELECT conversation_id FROM messages WHERE id=?', Number(p.id));
  if (!m) throw new HttpError(404, 'not_found');
  convFor(u, m.conversation_id);
  const r = await inbox.deleteMessage(p.id, u);
  json(res, r, r.ok ? 200 : 409);
});
/* Tovar rasmini paneldan yuklash: BILLZ’da rasm bo‘lmasa xodim o‘zi qo‘yadi (telefondan ham).
   Rasm brauzerda kichraytirilib, JSON ichida base64 holida keladi — alohida fayl yuklash qatlami kerak emas. */
const IMG_MAGIC = [[0xff, 0xd8, 0xff], [0x89, 0x50, 0x4e, 0x47]];   // JPEG, PNG
R.post('/api/products/:id/photo', async (req, res, u, p) => {
  need(u, 'catalogEdit');
  const b = await readJson(req, 6e6);
  const prod = one('SELECT id, name FROM products WHERE id=?', Number(p.id));
  if (!prod) throw new HttpError(404, 'not_found');
  const buf = Buffer.from(String(b.data || '').replace(/^data:[^,]+,/, ''), 'base64');
  if (buf.length < 500 || buf.length > 4e6) return json(res, { ok: false, why: 'Rasm bo‘sh yoki juda katta (4 MB gacha)' }, 400);
  if (!IMG_MAGIC.some(m => m.every((x, i) => buf[i] === x))) return json(res, { ok: false, why: 'Faqat JPEG yoki PNG rasm' }, 400);
  const { savePanelPhoto } = await import('./services/media.js');
  const file = savePanelPhoto(prod.id, buf);
  run(`UPDATE products SET image_url=?, updated_at=? WHERE id=?`, `panel:${file}`, now(), prod.id);
  audit('staff', u.name, `Tovar rasmi yuklandi: ${prod.name}`, { object: `product:${prod.id}`, result: `${Math.round(buf.length / 1024)} KB` });
  json(res, { ok: true });
});
/* Internetdan (ishlab chiqaruvchi rasmiy saytidan) rasm topish — xodim tugmasi */
R.post('/api/products/:id/photo/web', async (req, res, u, p) => {
  need(u, 'catalogEdit');
  const { findProductImage } = await import('./services/webimage.js');
  const r = await findProductImage(Number(p.id));
  json(res, r, r.ok ? 200 : 409);
});
/* Noto‘g‘ri rasmni olib tashlash (BILLZ rasmi keyingi sinxronda qaytadi) */
R.post('/api/products/:id/photo/remove', async (req, res, u, p) => {
  need(u, 'catalogEdit');
  const prod = one('SELECT id, name FROM products WHERE id=?', Number(p.id));
  if (!prod) throw new HttpError(404, 'not_found');
  run('UPDATE products SET image_url=NULL, image_source=NULL, updated_at=? WHERE id=?', now(), prod.id);
  audit('staff', u.name, `Tovar rasmi olib tashlandi: ${prod.name}`, { object: `product:${prod.id}` });
  json(res, { ok: true });
});
/* Tovar rasmi: panelda ko‘rish (keshdan) va mijozga yuborish */
R.get('/api/products/:id/photo', async (req, res, u, p) => {
  const { productPhoto } = await import('./services/media.js');
  const ph = await productPhoto(Number(p.id)).catch(() => null);
  if (!ph) throw new HttpError(404, 'no_photo');
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': ph.buf.length, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
  res.end(ph.buf);
});
R.post('/api/conversations/:id/photo', async (req, res, u, p) => {
  const c = convFor(u, p.id), b = await readJson(req);
  const { productPhoto } = await import('./services/media.js');
  const ph = await productPhoto(Number(b.product_id)).catch(e => { throw new HttpError(502, String(e.message || e)); });
  if (!ph) return json(res, { ok: false, why: 'Bu tovarda rasm yo‘q — kartaga rasm qo‘shing' }, 409);
  const r = await inbox.sellerSendPhoto(c.id, u, ph);
  json(res, r, r.ok ? 200 : 409);
});
R.post('/api/conversations/:id/take', (req, res, u, p) => { inbox.takeOver(convFor(u, p.id).id, u); json(res, { ok: true }); });
R.post('/api/conversations/:id/release', (req, res, u, p) => { inbox.release(convFor(u, p.id).id, u); json(res, { ok: true }); });
R.post('/api/conversations/:id/mode', async (req, res, u, p) => { const c = convFor(u, p.id), b = await readJson(req); inbox.setConvMode(c.id, b.mode, u); json(res, { ok: true }); });
R.post('/api/conversations/:id/typing', async (req, res, u, p) => { const c = convFor(u, p.id), b = await readJson(req); inbox.setTyping(c.id, Boolean(b.typing)); json(res, { ok: true }); });
/* Tarixni tozalash / suhbatni o‘chirish — faqat rahbar/admin; Telegram’da mijoz tomonida ham o‘chadi (Instagram ruxsat bermaydi) */
R.post('/api/conversations/:id/clear', async (req, res, u, p) => { need(u, 'settings'); json(res, await inbox.clearHistoryEverywhere(convFor(u, p.id).id, u)); });
R.post('/api/conversations/:id/delete', async (req, res, u, p) => { need(u, 'settings'); json(res, await inbox.deleteConversationEverywhere(convFor(u, p.id).id, u)); });

R.post('/api/conversations/:id/card', async (req, res, u, p) => {
  const c = convFor(u, p.id), b = await readJson(req);
  const f = {};
  for (const k of ['asked', 'budget', 'purpose', 'next_step', 'note', 'source', 'source_note']) if (k in b) f[k] = clip(b[k], 500);
  if ('heat' in b) { if (!['sovuq', 'iliq', 'issiq'].includes(b.heat)) throw bad('bad_heat'); f.heat = b.heat; f.heat_by = 'staff'; if (b.heat_why) f.heat_why = clip(b.heat_why, 300); }
  if ('stage' in b) {
    const st = Number(b.stage);
    if (!(st >= 0 && st <= 5)) throw bad('bad_stage');
    if (st === 5 && !b.confirm_purchase) throw bad('purchase_needs_confirmation'); // «Xarid tasdiqlandi» — chek yoki xodim tasdig‘i
    f.stage = st;
  }
  if ('lost' in b) { // yo‘qotish sababi faqat dalil bilan
    if (b.lost && !String(b.lost_evidence || '').trim()) throw bad('lost_needs_evidence');
    f.lost_reason = b.lost || null; f.lost_evidence = b.lost ? clip(b.lost_evidence, 500) : null;
  }
  if ('owner_user_id' in b && (can.seeAll(u) || u.role === 'filial')) f.owner_user_id = b.owner_user_id || null;
  const keys = Object.keys(f);
  if (keys.length) run(`UPDATE conversations SET ${keys.map(k => k + '=?').join(',')} WHERE id=?`, ...keys.map(k => f[k]), c.id);
  if (keys.length) audit('staff', u.name, `Suhbat kartasi yangilandi: ${keys.join(', ')}`, { object: `conv:${c.id}` });
  json(res, { ok: true });
});

R.post('/api/drafts/:id/approve', async (req, res, u, p) => {
  const d = one('SELECT conversation_id FROM drafts WHERE id=?', Number(p.id)); if (!d) throw new HttpError(404, 'not_found');
  convFor(u, d.conversation_id);
  const r = await inbox.approveDraft(d.conversation_id, p.id, u);
  json(res, r, r.ok ? 200 : 409);
});
R.post('/api/drafts/:id/cancel', (req, res, u, p) => {
  const d = one('SELECT * FROM drafts WHERE id=?', Number(p.id)); if (!d) throw new HttpError(404, 'not_found');
  convFor(u, d.conversation_id);
  const r = run(`UPDATE drafts SET status='cancelled', reason=?, decided_at=?, decided_by=? WHERE id=? AND status IN ('preparing','ready')`, `${u.name} bekor qildi`, now(), `user:${u.id}`, d.id);
  // Eskirgan tugma bosilsa (qoralama allaqachon almashgan) — joriy qoralamaning taymeriga tegilmaydi
  if (r.changes) run('UPDATE conversations SET ai_due_at=NULL WHERE id=?', d.conversation_id);
  audit('staff', u.name, 'AI qoralamasini bekor qildi', { object: `conv:${d.conversation_id}` });
  json(res, { ok: true });
});
R.post('/api/drafts/:id/rate', async (req, res, u, p) => {
  const d = one('SELECT conversation_id FROM drafts WHERE id=?', Number(p.id)); if (!d) throw new HttpError(404, 'not_found');
  convFor(u, d.conversation_id);
  const b = await readJson(req);
  json(res, { ok: inbox.rateDraft(Number(p.id), u, b.rating) });
});
/* Vazifani kim yopa oladi: rahbar — hammasini; boshqalar — o‘ziga biriktirilganini yoki o‘z ko‘radigan suhbatidagi / navbatdagi (egasiz) vazifani */
function taskFor(u, id) {
  const t = one('SELECT * FROM tasks WHERE id=?', id); if (!t) throw new HttpError(404, 'not_found');
  if (can.seeAll(u) || t.user_id === u.id) return t;
  if (t.user_id == null && t.conversation_id) { convFor(u, t.conversation_id); return t; }
  if (t.user_id == null && !t.conversation_id) return t;
  throw new HttpError(403, 'forbidden');
}
R.post('/api/tasks/:id/done', async (req, res, u, p) => {
  const t = taskFor(u, Number(p.id));
  const b = await readJson(req);
  const r = run(`UPDATE tasks SET status='done', result=?, done_at=?, user_id=COALESCE(user_id,?) WHERE id=? AND status='open'`, clip(b.result || 'bajarildi', 300), now(), u.id, t.id);
  if (!r.changes) return json(res, { ok: false, why: 'Vazifa allaqachon yopilgan' }, 409);
  audit('staff', u.name, 'Vazifa yopildi', { object: `task:${p.id}`, result: b.result || 'bajarildi' });
  json(res, { ok: true });
});

/* ---------- akkauntlar va sozlamalar ---------- */
R.post('/api/accounts/:id', async (req, res, u, p) => {
  need(u, 'settings');
  const b = await readJson(req);
  inbox.setAccount(Number(p.id), { mode: b.mode, rollout: b.rollout, ai_enabled: b.ai_enabled, branch_id: b.branch_id, owner_user_id: b.owner_user_id }, u);
  json(res, { ok: true });
});
/* AI agent sahifasi: har kanal bo‘yicha bugungi ish (Toshkent kuni) */
R.get('/api/agent', (req, res, u) => {
  need(u, 'settings');
  const day0 = new Date(new Date(now() + 5 * 3600e3).toISOString().slice(0, 10) + 'T00:00:00+05:00').getTime();
  const accounts = all('SELECT id,channel,name,mode,rollout,ai_enabled,can_reply,enabled,is_demo FROM accounts ORDER BY is_demo, id').map(a => ({
    ...a,
    today: one(`SELECT
        (SELECT count(*) FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.account_id=? AND m.author='client' AND m.created_at>=?) client,
        (SELECT count(*) FROM drafts d JOIN conversations c ON c.id=d.conversation_id WHERE c.account_id=? AND d.status='sent' AND d.created_at>=?) sent,
        (SELECT count(*) FROM drafts d JOIN conversations c ON c.id=d.conversation_id WHERE c.account_id=? AND d.status='failed' AND d.created_at>=?) failed,
        (SELECT count(*) FROM conversations c WHERE c.account_id=? AND c.pending_since IS NOT NULL AND c.archived=0) waiting`,
      a.id, day0, a.id, day0, a.id, day0, a.id)
  }));
  json(res, { accounts, ai: integrations().ai, settings: getSettings() });
});
/* «AI agent» bo‘limidagi jonli xarita uchun: so‘nggi so‘rovdan beri nima bo‘ldi. Hammasi haqiqiy hisoblagichlardan:
   xabarlar (kanal va yo‘nalish bo‘yicha, `since` — oxirgi ko‘rilgan xabar id), AI so‘rovlari soni (ai_usage), BILLZ sinxron vaqti (kv).
   Birinchi chaqiruvda (since yo‘q) faqat boshlang‘ich nuqta qaytadi — eski xabarlar animatsiya qilinmaydi. */
R.get('/api/agent/pulse', (req, res, u) => {
  need(u, 'settings');
  const since = Number(new URL(req.url, 'http://x').searchParams.get('since')) || 0;
  const cursor = one('SELECT coalesce(max(id),0) m FROM messages').m;
  const cnt = (ch, who) => since ? one(`SELECT count(*) n FROM messages m JOIN conversations c ON c.id=m.conversation_id JOIN accounts a ON a.id=c.account_id
    WHERE m.id>? AND m.id<=? AND a.channel=? AND m.author IN (${who})`, since, cursor, ch).n : 0;
  const ints = integrations();
  json(res, {
    cursor, now: now(), demo: hasDemo(),
    delta: { tg: { in: cnt('tg', "'client'"), out: cnt('tg', "'seller','ai'") }, ig: { in: cnt('ig', "'client'"), out: cnt('ig', "'seller','ai'") } },
    ai_calls: one('SELECT coalesce(sum(calls),0) n FROM ai_usage').n,
    billz_at: Math.max(...['billz_hourly_at', 'billz_products_at', 'billz_clients_at'].map(k => Number(kvGet(k) || 0))),
    state: { tg: ints.telegram.state, ig: ints.instagram.state, billz: ints.billz.state, ai: ints.ai.state },
    ai_detail: ints.ai.detail || ''
  });
});
/* Sozlamalar qiymati hammaga ko‘rinadi (ish vaqti, chegaralar — sotuvchi ham bilishi kerak),
   o‘zgarishlar tarixi esa faqat jurnalni ko‘ra oladiganlarga */
R.get('/api/settings', (req, res, u) => json(res, { settings: getSettings(), changes: can.audit(u) ? recentChanges(60) : [] }));
R.post('/api/settings', async (req, res, u) => { need(u, 'settings'); const ch = updateSettings(await readJson(req), u.name); json(res, { ok: true, changed: ch }); });

/* ---------- audit ---------- */
R.get('/api/audit', (req, res, u) => { need(u, 'audit'); json(res, { items: recentAudit(new URL(req.url, 'http://x').searchParams.get('kind')) }); });

/* ---------- katalog ---------- */
R.get('/api/products', (req, res, u) => {
  const q = new URL(req.url, 'http://x').searchParams;
  json(res, listProducts(q.get('q') || '', { stock: q.get('stock') || 'all', branch: q.get('branch') || '', status: q.get('status') || 'all', limit: Math.min(200, Number(q.get('limit')) || 100), offset: Math.max(0, Number(q.get('offset')) || 0) }));
});
R.get('/api/products/:id', (req, res, u, p) => { const x = product(Number(p.id)); if (!x) throw new HttpError(404, 'not_found'); json(res, { item: cardForAgent(x) }); });
R.post('/api/products', async (req, res, u) => { need(u, 'catalogEdit'); const id = saveProduct(await readJson(req), u.name); json(res, { ok: true, id }); });
R.post('/api/products/:id/research', async (req, res, u, p) => { need(u, 'catalogEdit'); const { researchProduct } = await import('./agents/katalog.js'); json(res, await researchProduct(Number(p.id), u.name)); });
/* Sotuvchining ichki savoli — Katalog agenti javobi (mijozga ketmaydi) */
R.post('/api/catalog/ask', async (req, res, u) => {
  const b = await readJson(req);
  const { askCatalog } = await import('./agents/katalog.js');
  json(res, await askCatalog(b.q, u.name));
});
R.post('/api/products/:id/verify', async (req, res, u, p) => { need(u, 'catalogEdit'); const b = await readJson(req); verifyProduct(Number(p.id), u.name, b.on !== false); json(res, { ok: true }); });

/* ---------- agentni o‘qitish (Sotuvchi agent usuli) ----------
   Tasdiqlangan javoblar agent bilimidan ustun; do‘kon ma’lumoti — kafolat, yetkazish, to‘lov, keshbek va h.k.
   Hamma xodim ko‘radi (sotuvchi ham bilsin), o‘zgartirish — rahbar, admin, filial rahbari. */
R.get('/api/answers', (req, res, u) => json(res, { items: all(`SELECT * FROM answers ORDER BY active DESC, id DESC LIMIT 1000`) }));
R.post('/api/answers', async (req, res, u) => {
  need(u, 'catalogEdit');
  const b = await readJson(req);
  const { saveAnswer } = await import('./services/bilim.js');
  json(res, { ok: true, id: saveAnswer({ id: b.id, question: b.question, answer: b.answer, author: u.name, source: b.source === 'draft' ? 'draft' : 'panel' }, u.name) });
});
R.post('/api/answers/:id/active', async (req, res, u, p) => {
  need(u, 'catalogEdit');
  const b = await readJson(req);
  const { setAnswerActive } = await import('./services/bilim.js');
  if (!setAnswerActive(Number(p.id), b.on !== false, u.name)) throw new HttpError(404, 'not_found');
  json(res, { ok: true });
});
/* AI kaliti paneldan (faqat admin/rahbar). Kalit javobda ham, jurnalda ham ko‘rsatilmaydi */
R.post('/api/ai-key', async (req, res, u) => {
  need(u, 'settings');
  const b = await readJson(req);
  const { saveGeminiKey } = await import('./services/ai-keys.js');
  const r = await saveGeminiKey(b.key, u.name);
  if (r.ok) r.redraft = inbox.redraftPending();
  json(res, r);
});
R.get('/api/knowledge', (req, res, u) => json(res, { items: all(`SELECT * FROM knowledge ORDER BY active DESC, id`) }));
R.post('/api/knowledge', async (req, res, u) => {
  need(u, 'catalogEdit');
  const b = await readJson(req);
  const { saveKnowledge } = await import('./services/bilim.js');
  json(res, { ok: true, id: saveKnowledge({ id: b.id, title: b.title, body: b.body, active: b.active }, u.name) });
});

/* ---------- xodimlar va filiallar ---------- */
R.get('/api/users', (req, res, u) => {
  need(u, 'users');
  json(res, { bot: botUsername(), items: all(`SELECT id,login,name,role,branch_id,phone,active,backup_user_id,shift_dow,shift_from,shift_to,tg_username,tg_user_id,
    (tg_chat_id IS NOT NULL) AS tg_linked, (pass_hash IS NOT NULL) AS has_pass FROM users WHERE deleted_at IS NULL ORDER BY active DESC, name`) });
});
/* Telegram: username (harf, raqam, _ — 4–32) va ID (raqam). Xodim botga «Start» bosganda shular bo‘yicha o‘zi ulanadi. */
const tgName = v => { const s = String(v || '').trim().replace(/^@/, '').replace(/^https?:\/\/t\.me\//i, ''); return /^[A-Za-z0-9_]{4,32}$/.test(s) ? s : null; };
const tgId = v => { const s = String(v ?? '').trim(); return /^\d{5,15}$/.test(s) ? Number(s) : null; };
async function saveTelegram(id, b) {
  const name = tgName(b.tg_username), uid = tgId(b.tg_user_id);
  if (String(b.tg_username || '').trim() && !name) throw bad('bad_tg_username');
  if (String(b.tg_user_id ?? '').trim() && !uid) throw bad('bad_tg_id');
  if (name && one('SELECT 1 FROM users WHERE lower(tg_username)=lower(?) AND id<>?', name, id)) throw bad('tg_taken');
  if (uid && one('SELECT 1 FROM users WHERE tg_user_id=? AND id<>?', uid, id)) throw bad('tg_taken');
  const cur = one('SELECT tg_user_id, tg_chat_id FROM users WHERE id=?', id);
  run('UPDATE users SET tg_username=? WHERE id=?', name, id);
  if (uid && uid !== cur.tg_user_id) {
    run('UPDATE users SET tg_user_id=?, tg_chat_id=NULL WHERE id=?', uid, id);
    // Xodim botni avval ochgan bo‘lsa — darhol ulanadi (shaxsiy chat ID = Telegram ID); bo‘lmasa «Start» bosganda
    const { sendStaffChecked } = await import('./channels/telegram.js');
    const u = one('SELECT * FROM users WHERE id=?', id);
    if (await sendStaffChecked({ ...u, tg_chat_id: uid }, `Salom, ${u.name}! Siz Photobuy sotuv tizimiga ulandingiz. Topshiriqlar shu chatga keladi — «Qabul qildim» ni tez bosing.`))
      run('UPDATE users SET tg_chat_id=? WHERE id=?', uid, id);
  }
}
/* Smena: dow — 7 belgi (Du…Ya), vaqt — HH:MM; noto‘g‘ri qiymat saqlanmaydi (cheklovsiz deb olinadi) */
const dowVal = v => /^[01]{7}$/.test(String(v || '')) && String(v) !== '1111111' ? String(v) : null;
const hm = v => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '')) ? String(v) : null;
R.post('/api/users', async (req, res, u) => {
  need(u, 'users');
  const b = await readJson(req);
  const role = b.role;
  if (!['admin', 'rahbar', 'filial', 'sotuvchi'].includes(role)) throw bad('bad_role');
  if (role === 'admin' && u.role !== 'admin') throw new HttpError(403, 'forbidden');
  const loginName = String(b.login || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,32}$/.test(loginName) || !String(b.name || '').trim()) throw bad('bad_user');
  let password = null;
  if (b.id) {
    const target = one('SELECT id, role FROM users WHERE id=?', Number(b.id));
    if (!target) throw new HttpError(404, 'not_found');
    // Admin akkauntini faqat admin o‘zgartiradi; boshqa rahbarning parolini faqat admin yangilaydi
    if (target.role === 'admin' && u.role !== 'admin') throw new HttpError(403, 'forbidden');
    if (b.reset_password && target.role === 'rahbar' && target.id !== u.id && u.role !== 'admin') throw new HttpError(403, 'forbidden');
    if (target.id === u.id && role !== u.role) throw bad('own_role');
    run('UPDATE users SET name=?, role=?, branch_id=?, phone=?, active=?, backup_user_id=?, shift_dow=?, shift_from=?, shift_to=? WHERE id=?',
      clip(b.name, 80), role, b.branch_id || null, b.phone || null, b.active === false ? 0 : 1, b.backup_user_id || null, dowVal(b.shift_dow), hm(b.shift_from), hm(b.shift_to), b.id);
    if (b.reset_password) { password = token(9); run('UPDATE users SET pass_hash=? WHERE id=?', hashPassword(password), b.id); run('DELETE FROM sessions WHERE user_id=?', b.id); }
    await saveTelegram(Number(b.id), b);
    audit('staff', u.name, `Xodim yangilandi: ${b.name}${b.reset_password ? ' (parol yangilandi)' : ''}`);
  } else {
    if (one('SELECT 1 FROM users WHERE login=?', loginName)) throw bad('login_taken');
    if (tgName(b.tg_username) && one('SELECT 1 FROM users WHERE lower(tg_username)=lower(?)', tgName(b.tg_username))) throw bad('tg_taken');
    if (tgId(b.tg_user_id) && one('SELECT 1 FROM users WHERE tg_user_id=?', tgId(b.tg_user_id))) throw bad('tg_taken');
    password = token(9);
    const id = Number(run('INSERT INTO users(login,name,role,branch_id,phone,pass_hash,backup_user_id,shift_dow,shift_from,shift_to,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      loginName, clip(b.name, 80), role, b.branch_id || null, b.phone || null, hashPassword(password), b.backup_user_id || null, dowVal(b.shift_dow), hm(b.shift_from), hm(b.shift_to), now()).lastInsertRowid);
    await saveTelegram(id, b);
    audit('staff', u.name, `Yangi xodim: ${b.name} (${role})`);
  }
  json(res, { ok: true, password }); // bir martalik: faqat shu javobda ko‘rsatiladi
});
/* Parolni o‘zgartirish havolasi: rahbar havola beradi, xodim yangi parolni O‘ZI qo‘yadi.
   Parol hech kimning qo‘lidan va yozishmadan o‘tmaydi. Eski havola bo‘lsa — bekor bo‘ladi. */
R.post('/api/users/:id/reset-link', (req, res, u, p) => {
  need(u, 'users');
  const t = one('SELECT id,name,login,role FROM users WHERE id=? AND deleted_at IS NULL', Number(p.id));
  if (!t) throw new HttpError(404, 'not_found');
  if (t.role === 'admin' && u.role !== 'admin') throw new HttpError(403, 'forbidden');
  if (t.role === 'rahbar' && t.id !== u.id && u.role !== 'admin') throw new HttpError(403, 'forbidden');
  run(`DELETE FROM invites WHERE user_id=? AND kind='reset' AND used_at IS NULL`, t.id);
  const tok = token(32);
  run(`INSERT INTO invites(token,login,name,role,kind,user_id,created_by,created_at,expires_at) VALUES(?,?,?,?,'reset',?,?,?,?)`,
    tok, t.login, t.name, t.role, t.id, u.name, now(), now() + 3 * 864e5);
  audit('staff', u.name, `Parol o‘zgartirish havolasi berildi: ${t.name}`, { object: `user:${t.id}`, result: '3 kun amal qiladi' });
  json(res, { ok: true, link: `${config.publicUrl}/taklif?k=${tok}`, name: t.name, login: t.login });
});

/* Bir bosishda parol berish (Xodimlar ro‘yxatidan). Qoidalar yuqoridagidek: admin parolini faqat admin, boshqa rahbarnikini faqat admin.
   Parol bir marta qaytariladi, eski seanslar yopiladi. */
R.post('/api/users/:id/password', async (req, res, u, p) => {
  need(u, 'users');
  const target = one('SELECT id, name, login, role FROM users WHERE id=?', Number(p.id));
  if (!target) throw new HttpError(404, 'not_found');
  if ((target.role === 'admin' || (target.role === 'rahbar' && target.id !== u.id)) && u.role !== 'admin') throw new HttpError(403, 'forbidden');
  const password = token(9);
  run('UPDATE users SET pass_hash=?, active=1 WHERE id=?', hashPassword(password), target.id);
  run('DELETE FROM sessions WHERE user_id=?', target.id);
  audit('staff', u.name, `Xodimga parol berildi: ${target.name}`);
  json(res, { ok: true, login: target.login, name: target.name, password });
});
/* BILLZ’dagi xodimlar (va 90 kunda sotuv qilgan sotuvchilar) — panelda hali yo‘qlari. Ism BILLZ’dagidek: tahlil avtomatik bog‘lanadi. */
const TR = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h' };
const latin = s => String(s || '').toLowerCase().split('').map(c => TR[c] ?? c).join('').replace(/[‘’'`ʻʼ]/g, '').replace(/[^a-z0-9]/g, '');
function suggestLogin(name) {
  const [a = '', b = ''] = String(name).trim().split(/\s+/);
  const base = (latin(a) + (b ? '.' + latin(b).slice(0, 1) : '')).slice(0, 28) || 'xodim';
  let login = base.length >= 3 ? base : base + 'xx', i = 1;
  while (one('SELECT 1 FROM users WHERE login=?', login)) login = `${base}${++i}`;
  return login;
}
/* Xodimni ro‘yxatdan o‘chirish. Tarix o‘chmaydi: eski yozishmalar, topshiriqlar va hisobotlarda xodim ko‘rinaveradi —
   shuning uchun statistika buzilmaydi. O‘chirilgan xodim: ro‘yxatda yo‘q, panelga kira olmaydi, Telegram ulanishi uziladi,
   topshiriq olmaydi (active=0). Login bo‘shaydi — o‘sha odam qayta qo‘shilsa, eski login yana ishlatiladi.
   O‘zini hech kim o‘chira olmaydi; rahbar va admin akkauntini faqat admin o‘chiradi. */
R.post('/api/users/:id/delete', (req, res, u, p) => {
  need(u, 'users');
  const target = one('SELECT id,name,login,role FROM users WHERE id=? AND deleted_at IS NULL', Number(p.id));
  if (!target) throw new HttpError(404, 'not_found');
  if (target.id === u.id) throw bad('own_delete');
  if (['admin', 'rahbar'].includes(target.role) && u.role !== 'admin') throw new HttpError(403, 'forbidden');
  tx(() => {
    run(`UPDATE users SET deleted_at=?, active=0, pass_hash=NULL, login=login||'#'||id,
         tg_username=NULL, tg_user_id=NULL, tg_chat_id=NULL, backup_user_id=NULL WHERE id=?`, now(), target.id);
    run('DELETE FROM sessions WHERE user_id=?', target.id);
    run('UPDATE users SET backup_user_id=NULL WHERE backup_user_id=?', target.id);  // zaxira mas’ul bo‘lganlar bo‘shaydi
  });
  audit('staff', u.name, `Xodim o‘chirildi: ${target.name} (${target.login})`, { result: 'Tarix saqlandi' });
  json(res, { ok: true });
});
/* AI sarfi va balans: qancha token ketdi, qancha pul bo‘ldi, to‘ldirilgan balansdan qancha qoldi */
R.get('/api/ai-usage', async (req, res, u) => {
  need(u, 'settings');
  const m = await import('./services/ai-usage.js');
  json(res, { ...m.usageReport(), model: config.geminiModel, topup_url: 'https://aistudio.google.com/apikey' });
});
/* Rahbar balansni to‘ldirgach shu yerga summani kiritadi — panel shundan ayirib boradi */
R.post('/api/ai-usage/limits', async (req, res, u) => {
  need(u, 'settings');
  const b = await readJson(req);
  const m = await import('./services/ai-usage.js');
  const L = m.setLimits(b.day, b.month, u.name);
  audit('staff', u.name, `AI chegarasi: kuniga $${L.day || '—'}, oyiga $${L.month || '—'}`);
  json(res, { ok: true, limits: L });
});
R.post('/api/ai-usage/topup', async (req, res, u) => {
  need(u, 'settings');
  const b = await readJson(req);
  const m = await import('./services/ai-usage.js');
  const v = m.setTopup(b.usd, u.name);
  audit('staff', u.name, `AI balansi to‘ldirildi: $${v}`);
  json(res, { ok: true, usd: v });
});

/* ---------- Keshbek boti va reklama ---------- */
R.get('/api/bot', async (req, res, u) => {
  need(u, 'reklama');
  const k = await import('./channels/keshbek.js');
  const { adBusy, describeFilter } = await import('./services/reklama.js');
  const i = one(`SELECT state, detail FROM integrations WHERE name='cashback_bot'`);
  json(res, {
    state: i?.state || 'off', detail: i?.detail || null, username: k.cbBotUsername(),
    stats: k.cbStats(), busy: adBusy(),
    history: all(`SELECT id,text,photo,link_url,created_by,created_at,total,sent,failed,blocked,done_at,filter
      FROM broadcasts ORDER BY id DESC LIMIT 20`).map(r => { let f = null; try { f = r.filter ? JSON.parse(r.filter) : null; } catch {} return { ...r, filter: f, who: describeFilter(f) }; })
  });
});

/* Filtrga mos obunachilar soni — yuborishdan oldin panel ko‘rsatadi («N ta odamga») */
R.get('/api/bot/segment', async (req, res, u) => {
  need(u, 'reklama');
  const q = new URL(req.url, 'http://x').searchParams;
  const { audience, parseFilter, describeFilter } = await import('./services/reklama.js');
  const f = parseFilter({ cb_min: q.get('cb_min'), cb_max: q.get('cb_max'), known: q.get('known') });
  const a = audience(f);
  json(res, { total: a.length, filter: f, who: describeFilter(f), cashback_sum: a.reduce((s, r) => s + (r.cashback || 0), 0) });
});

/* Reklama: botga Start bosganlarga (filtr bo‘lsa — mos keladiganlarga). Yuborish fonda ketadi, natija shu jadvalda. */
R.post('/api/bot/reklama', async (req, res, u) => {
  need(u, 'reklama');
  const b = await readJson(req, 6e6);
  const text = clip(String(b.text || '').trim(), 900);
  let photo = null;
  if (b.photo) {
    const buf = Buffer.from(String(b.photo).replace(/^data:[^,]+,/, ''), 'base64');
    if (buf.length < 500 || buf.length > 4e6) throw bad('bad_photo');
    if (!IMG_MAGIC.some(m => m.every((x, i) => buf[i] === x))) throw bad('bad_photo');
    const { saveAdPhoto } = await import('./services/reklama.js');
    photo = saveAdPhoto(buf);
  }
  if (!text && !photo) throw bad('bad_ad');
  const url = String(b.link_url || '').trim();
  if (url && !/^https?:\/\//i.test(url)) throw bad('bad_link');
  const { runBroadcast, parseFilter } = await import('./services/reklama.js');
  const filter = parseFilter(b.filter);
  const id = Number(run(`INSERT INTO broadcasts(text,photo,link_url,link_text,created_by,created_at,filter) VALUES(?,?,?,?,?,?,?)`,
    text || null, photo, url || null, clip(String(b.link_text || '').trim(), 30) || null, u.name, now(), JSON.stringify(filter)).lastInsertRowid);
  const r = await runBroadcast(id);
  if (!r.ok) throw new HttpError(409, r.why);
  json(res, { ok: true, id, total: r.total });
});

/* ---------- Taklif havolasi ----------
   Rahbar havola yaratadi → xodim havolani ochadi → o‘zi parol qo‘yadi → o‘ziga berilgan rolda darhol kiradi.
   Parol hech qachon rahbarda ham, yozishmada ham ko‘rinmaydi. Havola bir martalik va muddatli. */
const inviteByToken = k => {
  const t = String(k || '');
  if (!/^[A-Za-z0-9_-]{16,80}$/.test(t)) return null;
  return one('SELECT * FROM invites WHERE token=? AND used_at IS NULL AND expires_at>?', t, now()) || null;
};

R.get('/api/invites', (req, res, u) => {
  need(u, 'users');
  json(res, { base: config.publicUrl, items: all(`SELECT i.id, i.token, i.login, i.name, i.role, i.phone, i.kind, i.created_by, i.created_at, i.expires_at, b.name AS branch_name
    FROM invites i LEFT JOIN branches b ON b.id=i.branch_id WHERE i.used_at IS NULL AND i.expires_at>? ORDER BY i.id DESC LIMIT 50`, now()) });
});

R.post('/api/invites', async (req, res, u) => {
  need(u, 'users');
  const b = await readJson(req);
  const role = b.role;
  if (!['admin', 'rahbar', 'filial', 'sotuvchi'].includes(role)) throw bad('bad_role');
  if (['admin', 'rahbar'].includes(role) && u.role !== 'admin') throw new HttpError(403, 'forbidden');
  // Login — xodimning telefon raqami: eslab qolish oson va u baribir raqamini biladi
  const loginName = normLogin(b.phone);
  if (!/^\d{9,15}$/.test(loginName)) throw bad('bad_phone');
  if (!String(b.name || '').trim()) throw bad('bad_user');
  if (one('SELECT 1 FROM users WHERE login=? AND deleted_at IS NULL', loginName)) throw bad('login_taken');
  if (one('SELECT 1 FROM invites WHERE login=? AND used_at IS NULL AND expires_at>?', loginName, now())) throw bad('invite_exists');
  const days = Math.min(30, Math.max(1, Number(b.days) || 7));
  const tok = token(32);
  const id = Number(run(`INSERT INTO invites(token,login,name,role,branch_id,phone,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)`,
    tok, loginName, clip(b.name, 80), role, b.branch_id || null, clip(b.phone || '', 40) || null, u.name, now(), now() + days * 864e5).lastInsertRowid);
  audit('staff', u.name, `Taklif havolasi yaratildi: ${clip(b.name, 80)} (${role})`, { result: `${days} kun amal qiladi` });
  json(res, { ok: true, id, link: `${config.publicUrl}/taklif?k=${tok}` });
});

R.post('/api/invites/:id/revoke', (req, res, u, p) => {
  need(u, 'users');
  const i = one('SELECT * FROM invites WHERE id=? AND used_at IS NULL', Number(p.id));
  if (!i) throw new HttpError(404, 'not_found');
  run('DELETE FROM invites WHERE id=?', i.id);
  audit('staff', u.name, `Taklif havolasi bekor qilindi: ${i.name}`);
  json(res, { ok: true });
});

/* Kirishsiz: havolani ochgan xodim ko‘radigan ma’lumot (parol yo‘q, faqat kim uchun ekani) */
R.get('/api/invite', (req, res) => {
  const i = inviteByToken(new URL(req.url, 'http://x').searchParams.get('k'));
  if (!i) throw new HttpError(404, 'invite_bad');
  json(res, { name: i.name, login: i.login, role: i.role, phone: i.phone, reset: i.kind === 'reset',
    branch: i.branch_id ? one('SELECT name FROM branches WHERE id=?', i.branch_id)?.name || null : null });
});

/* Kirishsiz: xodim o‘z parolini qo‘yadi — hisob shu yerda ochiladi va seans beriladi */
R.post('/api/invite/accept', async (req, res) => {
  const b = await readJson(req);
  const i = inviteByToken(b.k);
  if (!i) throw new HttpError(404, 'invite_bad');
  const pw = String(b.password || '');
  if (pw.length < 8) throw bad('weak_password');
  if (one('SELECT 1 FROM users WHERE login=? AND deleted_at IS NULL', i.login)) throw bad('login_taken');
  const phone = clip(String(b.phone || i.phone || '').trim(), 40) || null;

  // Parolni almashtirish: hisob allaqachon bor — yangi parol qo‘yiladi va eski seanslar yopiladi
  if (i.kind === 'reset') {
    const t = one('SELECT * FROM users WHERE id=? AND deleted_at IS NULL', i.user_id);
    if (!t) throw new HttpError(404, 'invite_bad');
    tx(() => {
      if (!run('UPDATE invites SET used_at=? WHERE id=? AND used_at IS NULL', now(), i.id).changes) throw new HttpError(404, 'invite_bad');
      run('UPDATE users SET pass_hash=?, phone=COALESCE(?,phone), active=1 WHERE id=?', hashPassword(pw), phone, t.id);
      run('DELETE FROM sessions WHERE user_id=?', t.id);   // eski qurilmalardagi kirishlar yopiladi
    });
    audit('staff', t.name, 'Xodim havola orqali parolini o‘zgartirdi', { object: `user:${t.id}`, result: `Havolani bergan: ${i.created_by}` });
    login(req, res, t.login, pw);
    return json(res, { ok: true });
  }

  const uid = tx(() => {
    // Avval havola yopiladi: ikki marta bosilsa yoki ikki qurilmadan ochilsa — ikkinchi hisob ochilmaydi
    if (!run('UPDATE invites SET used_at=? WHERE id=? AND used_at IS NULL', now(), i.id).changes) throw new HttpError(404, 'invite_bad');
    const id = Number(run(`INSERT INTO users(login,name,role,branch_id,phone,pass_hash,created_at) VALUES(?,?,?,?,?,?,?)`,
      i.login, i.name, i.role, i.branch_id || null, phone, hashPassword(pw), now()).lastInsertRowid);
    run('UPDATE invites SET user_id=? WHERE id=?', id, i.id);
    return id;
  });
  audit('staff', i.name, `Xodim havola orqali hisobini faollashtirdi (${i.role})`, { object: `user:${uid}`, result: `Taklifni bergan: ${i.created_by}` });
  login(req, res, i.login, pw);   // seans ochiladi — xodim darhol panelga kiradi
  json(res, { ok: true });
});

R.get('/api/users/billz', (req, res, u) => {
  need(u, 'users');
  // Katta-kichik harf JS’da solishtiriladi: SQLite lower() kirillni kichraytirmaydi («Салохиддин Шомахмудов»)
  const key = n => String(n || '').trim().toLowerCase();
  const have = new Set(all('SELECT name FROM users').map(r => key(r.name)));
  const since = now() - 90 * 864e5;
  const rows = all(`SELECT seller_name n, branch_name b, count(DISTINCT receipt) c FROM purchases WHERE is_demo=0 AND kind='sale' AND seller_name IS NOT NULL AND sold_at>? GROUP BY seller_name, branch_name`, since);
  const sales = new Map();
  for (const r of rows) {
    const k = key(r.n), cur = sales.get(k) || { name: r.n.trim(), checks: 0, top: null, topC: 0 };
    cur.checks += r.c; if (r.c > cur.topC && r.b) { cur.top = r.b; cur.topC = r.c; }
    sales.set(k, cur);
  }
  const staff = jparse(kvGet('billz_staff'), []) || [];
  const names = new Map(staff.map(s => [key(s.name), s]));
  for (const [k, v] of sales) if (!names.has(k)) names.set(k, { name: v.name, roles: [], shops: [] });
  const items = [...names.values()].filter(s => !have.has(key(s.name))).map(s => {
    const sl = sales.get(key(s.name));
    const shop = sl?.top || s.shops.find(n => one(`SELECT 1 FROM branches WHERE name=? AND kind='dokon'`, n)) || null;
    return { name: s.name, roles: s.roles, shops: s.shops, checks_90d: sl?.checks || 0, branch: shop,
      branch_id: shop ? one('SELECT id FROM branches WHERE name=?', shop)?.id ?? null : null, login: suggestLogin(s.name) };
  }).sort((a, b) => b.checks_90d - a.checks_90d);
  json(res, { items });
});
R.post('/api/users/:id/tglink', (req, res, u, p) => {
  const target = Number(p.id);
  if (target !== u.id) need(u, 'users');
  const code = token(12).replace(/[^A-Za-z0-9]/g, '').slice(0, 14);
  run('INSERT INTO tg_links(code,user_id,expires_at) VALUES(?,?,?)', code, target, now() + 3600e3);
  const bot = botUsername();
  json(res, { ok: true, code, link: bot ? `https://t.me/${bot}?start=link_${code}` : null, bot, running: telegramRunning() });
});
R.post('/api/me/password', async (req, res, u) => {
  const b = await readJson(req);
  if (!checkPassword(String(b.current || ''), one('SELECT pass_hash FROM users WHERE id=?', u.id).pass_hash)) throw new HttpError(403, 'bad_current_password');
  if (String(b.password || '').length < 8) throw bad('short_password');
  run('UPDATE users SET pass_hash=? WHERE id=?', hashPassword(String(b.password)), u.id);
  audit('staff', u.name, 'Parolini o‘zgartirdi');
  json(res, { ok: true });
});
R.post('/api/branches', async (req, res, u) => {
  need(u, 'users');
  const b = await readJson(req);
  if (!String(b.name || '').trim()) throw bad('name_required');
  const kind = b.kind === 'ombor' ? 'ombor' : 'dokon';
  if (b.id) run('UPDATE branches SET name=?, active=?, work_days=?, note=?, kind=?, work_dow=?, open_from=?, open_to=? WHERE id=?',
    clip(b.name, 60), b.active === false ? 0 : 1, b.work_days || null, b.note || null, kind, dowVal(b.work_dow), hm(b.open_from), hm(b.open_to), b.id);
  else run('INSERT INTO branches(name,work_days,note,kind,work_dow,open_from,open_to) VALUES(?,?,?,?,?,?,?)',
    clip(b.name, 60), b.work_days || null, b.note || null, kind, dowVal(b.work_dow), hm(b.open_from), hm(b.open_to));
  resetBranchKinds();
  logChange(u.name, `Filial: ${b.name}${b.id ? ' (yangilandi)' : ' (qo‘shildi)'}`);
  json(res, { ok: true });
});

/* ---------- BILLZ: qo‘lda sinxron (rahbar/admin) ---------- */
R.post('/api/billz/sync', async (req, res, u) => {
  need(u, 'settings');
  const { billzTick, billzBusy } = await import('./services/billz-sync.js');
  if (billzBusy()) return json(res, { ok: false, busy: true });
  audit('staff', u.name, 'BILLZ sinxronini qo‘lda boshladi');
  // Fonda: to‘liq sinxron bir necha daqiqa olishi mumkin — natija «Integratsiyalar» qatorida va jurnalda
  billzTick({ force: true }).catch(e => console.error('billz', e));
  json(res, { ok: true, started: true });
});

/* ---------- demo ---------- */
R.post('/api/demo/client', async (req, res, u) => {
  need(u, 'settings');
  const b = await readJson(req);
  if (!String(b.text || '').trim()) throw bad('empty');
  const c = simulateClient({ conversationId: b.conversation_id ? Number(b.conversation_id) : null, name: clip(b.name || '', 60), text: clip(b.text, 2000) });
  json(res, { ok: true, id: c.id });
});

/* Keshbekli mijozlar (BILLZ): balans, jami xaridi va oxirgi xaridi. Qidiruv va filtrlar bilan — «Keshbek» bo‘limi.
   Filtrlar: q — ism yoki telefon; min — eng kam balans; phone=1 — faqat telefoni borlar;
   period: yangi (90 kun ichida xarid qilgan) | uxlagan (1 yildan beri xarid yo‘q); sort: keshbek | xarid | oxirgi. */
R.get('/api/cashback', (req, res, u) => {
  // Faqat o‘qish — sotuvchi ham ko‘radi: mijoz «keshbekim qancha?» deb so‘raganda yoki qayta sotuvda. Bot va reklama — rahbarda
  const sp = new URL(req.url, 'http://x').searchParams;
  const q = String(sp.get('q') || '').trim().toLowerCase(), like = `%${q}%`;
  const min = Math.max(0, Number(sp.get('min')) || 0);
  const onlyPhone = sp.get('phone') === '1';
  const period = ['yangi', 'uxlagan'].includes(sp.get('period')) ? sp.get('period') : 'all';
  const sort = { xarid: 'spent DESC', oxirgi: 'last_buy DESC' }[sp.get('sort')] || 'cb.amount DESC';
  const t = now(), w = [], a = [];
  if (q) { w.push("(lower(COALESCE(c.name,'')) LIKE ? OR COALESCE(c.phone,'') LIKE ?)"); a.push(like, like); }
  if (min) { w.push('cb.amount>=?'); a.push(min); }
  if (onlyPhone) w.push("COALESCE(c.phone,'')<>''");
  const lastBuy = `(SELECT max(p.sold_at) FROM purchases p WHERE p.customer_id=c.id AND p.kind='sale')`;
  if (period === 'yangi') { w.push(`${lastBuy}>?`); a.push(t - 90 * 864e5); }
  if (period === 'uxlagan') { w.push(`COALESCE(${lastBuy},0)<?`); a.push(t - 365 * 864e5); }
  const where = `WHERE cb.amount>0 AND COALESCE(c.is_demo,0)=0${w.length ? ' AND ' + w.join(' AND ') : ''}`;
  const items = all(`SELECT c.id, c.name, c.phone, cb.amount, cb.synced_at, ${lastBuy} last_buy,
      (SELECT COALESCE(sum(p.amount),0) FROM purchases p WHERE p.customer_id=c.id AND p.kind='sale') spent,
      (SELECT v.id FROM conversations v WHERE v.customer_id=c.id ORDER BY v.last_msg_at DESC LIMIT 1) conv_id
    FROM cashback cb JOIN customers c ON c.id=cb.customer_id ${where} ORDER BY ${sort} LIMIT 200`, ...a);
  const sum = one(`SELECT count(*) n, COALESCE(sum(cb.amount),0) total FROM cashback cb JOIN customers c ON c.id=cb.customer_id ${where}`, ...a);
  const bor = one(`SELECT count(*) n FROM cashback cb JOIN customers c ON c.id=cb.customer_id WHERE cb.amount>0 AND COALESCE(c.is_demo,0)=0`);
  json(res, { items, n: sum.n, total: sum.total, hammasi: bor.n, synced_at: one('SELECT max(synced_at) t FROM cashback').t });
});
/* ---------- CSV eksport (Excel: UTF-8 BOM, «;» ajratgich) — rahbar ---------- */
/* Formula in’ektsiyasi: mijoz ismi «=», «+», «-», «@» bilan boshlansa Excel uni formula deb bajarmasin */
const csvCell = v => {
  let x = v == null ? '' : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(x)) x = "'" + x;
  return /[";\n\r]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x;
};
const dt = ts => ts ? new Date(ts + 5 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : '';
function sendCsv(res, name, header, rows) {
  const body = '\ufeff' + [header, ...rows].map(r => r.map(csvCell).join(';')).join('\r\n');
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}
R.get('/api/export/:name', (req, res, u, p) => {
  need(u, 'seeAll');   // eksport — faqat rahbar va admin (jurnalni ko‘rish hammaga ochiq, lekin yuklab olish emas)
  const q = new URL(req.url, 'http://x').searchParams;
  audit('staff', u.name, `Eksport: ${p.name}`);
  if (p.name === 'suhbatlar.csv') {
    const rows = all(`${CONV_SQL} ORDER BY c.last_msg_at DESC LIMIT 5000`);
    return sendCsv(res, 'suhbatlar.csv', ['ID', 'Mijoz', 'Akkaunt', 'Kanal', 'Filial', 'Mas’ul', 'Bosqich', 'Qiziqish', 'So‘ralgan', 'Budjet', 'Keyingi qadam', 'Yo‘qotish sababi', 'Birinchi murojaat', 'Oxirgi xabar', 'Javob kutmoqda (daq)'],
      rows.map(c => [c.id, c.display_name || c.handle, c.account_name, c.channel, c.branch_name, c.owner_name, inbox.STAGES[c.stage], c.heat, c.asked, c.budget, c.next_step, c.lost_reason,
        dt(c.created_at), dt(c.last_msg_at), c.pending_since ? Math.floor((now() - c.pending_since) / 60e3) : '']));
  }
  if (p.name === 'audit.csv') {
    const rows = all('SELECT * FROM audit ORDER BY id DESC LIMIT 20000');
    return sendCsv(res, 'audit.csv', ['Vaqt', 'Turi', 'Bajaruvchi', 'Amal', 'Obyekt', 'Ma’lumot', 'Natija'], rows.map(a => [dt(a.at), a.kind, a.actor, a.action, a.object, a.data_used, a.result]));
  }
  throw new HttpError(404, 'not_found');
});
