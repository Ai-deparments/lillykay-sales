import dc from 'node:diagnostics_channel';
import { randomUUID } from 'node:crypto';
import { config, tgReady } from '../config.js';
import { one, run, all, tx, kvGet, kvSet } from '../db.js';
import { now, esc, money, jparse, local } from '../util.js';
import { setIntegration } from '../services/settings.js';
import { ingestClient, markSellerReply, takeOver, recordAutoMessage, confirmEcho, clientDeleted, scheduleDraft, adoptArchived, aiOn } from '../services/inbox.js';
import { customerByPhone, normPhone } from '../services/billz.js';
import { refreshClientByPhone } from '../services/billz-sync.js';
import { audit } from '../core/audit.js';
import { metaStart, metaCallback, metaQuestion, waitingQuestion, tgGuideStart, tgGuideCallback } from './meta-yordam.js';
import { activeAnswers, saveAnswer, setAnswerActive } from '../services/bilim.js';
import { transcribe, sttReady } from '../services/stt.js';

/*
  Telegram Bot API — faqat SOTUV uchun ochilgan alohida bot (BotFather).
  MUHIM: @photobuy_ai_bot (Nova) tokeni bu yerda ishlatilmaydi. getMe shu nomni qaytarsa — polling boshlanmaydi.

  Bitta bot uch vazifada:
   1) Telegram Business ulanishi — sotuvchi akkaunti orqali mijozlarga javob (business_connection / business_message)
   2) Xodimlar uchun bildirishnomalar (/start link_KOD bilan ulanadi)
   3) Mijoz boti — keshbek va yangi tovar xabarlari uchun rozilik (Chaqnoq)
*/

let me = null, running = false, offset = 0;
let botReplyHook = null;
export const setBotReplyHook = fn => { botReplyHook = fn; };
const API = m => `https://api.telegram.org/bot${config.tgToken}/${m}`;

/* So‘rov Telegram’ga yetmagani aniq bo‘lsa — 2 va 4 s dan keyin qayta; aks holda «noma’lum» (ikki marta yubormaslik uchun qayta urinilmaydi).
   Aniq yetmagan: (1) ulanishning o‘zi bo‘lmagan xato kodi (DNS, rad etildi, ulanib bo‘lmadi);
   (2) fetch so‘rovi yaratilgan, lekin sarlavhasi soketga yozilmagan — undici «sendHeaders» xabarini bermagan (x-pb-req belgisi bo‘yicha).
   Prodda (2026-10-03) Telegram’ga yangi ulanishlarning ~4% i TLS o‘rnatilguncha uziladi (ECONNRESET) — so‘rov yetmagan, (2) bilan qayta yuboriladi. */
const NOT_SENT = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'UND_ERR_CONNECT_TIMEOUT', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH']);
const created = new Set(), wrote = new Set();
const tagOf = h => /x-pb-req[,:]\s?([\w-]+)/i.exec(String(h))?.[1];
dc.subscribe('undici:request:create', ({ request }) => { const id = tagOf(request.headers); if (id) created.add(id); });
dc.subscribe('undici:client:sendHeaders', ({ headers }) => { const id = tagOf(headers); if (id) wrote.add(id); });
async function tgFetch(method, init, ms) {
  for (let i = 0; ; i++) {
    const id = randomUUID();
    try { return await fetch(API(method), { ...init, headers: { ...init.headers, 'x-pb-req': id }, signal: AbortSignal.timeout(ms) }); }
    catch (e) {
      const code = e.cause?.code || e.code || '';
      const notSent = NOT_SENT.has(code) || (created.has(id) && !wrote.has(id));
      if (notSent && i < 2) { await new Promise(r => setTimeout(r, 2000 * (i + 1))); continue; }
      throw Object.assign(new Error(e.name === 'TimeoutError' ? `Telegram javob bermadi (${Math.round(ms / 1000)} s)` : `Telegram bilan aloqa yo‘q${code ? ` (${code})` : ''}`), { uncertain: !notSent });
    } finally { created.delete(id); wrote.delete(id); }
  }
}

export async function tg(method, params = {}) {
  const res = await tgFetch(method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) }, method === 'getUpdates' ? 65000 : 20000);
  const j = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
  if (!j.ok) { const e = new Error(j.description || 'telegram_error'); e.code = j.error_code; e.uncertain = res.status >= 500 && !j.error_code; throw e; }
  return j.result;
}
export const botUsername = () => me?.username || kvGet('tg_bot_username');

/* Ishga tushishda Telegram bir lahza javob bermasa — bot butunlay o‘chib qolmasin: qayta urinish (15 s → 5 daq).
   2026-09-26: qayta yonishda getMe tarmoq xatosi bergan va polling boshlanmagan — mijoz xabarlari kelmay qolgan. */
let retryTimer = null;
const RETRY_MS = Number(process.env.TG_RETRY_MS) || 15000;
export async function startTelegram(attempt = 0) {
  clearTimeout(retryTimer); retryTimer = null;
  if (!tgReady()) { setIntegration('telegram', 'off', config.tgToken ? 'O‘chirilgan (TG_DISABLED)' : 'Bot tokeni kiritilmagan'); return; }
  try { me = await tg('getMe'); }
  catch (e) {
    if (e.code === 401) { setIntegration('telegram', 'error', 'Token noto‘g‘ri yoki bekor qilingan'); return; } // qayta urinish befoyda
    const wait = Math.min(300000, RETRY_MS * 2 ** Math.min(attempt, 5));
    setIntegration('telegram', 'error', `getMe: ${e.message} — ${Math.round(wait / 1000)} s dan keyin qayta urinadi`);
    console.error(`[telegram] getMe xatosi (${e.message}), ${Math.round(wait / 1000)} s dan keyin qayta urinish`);
    retryTimer = setTimeout(() => startTelegram(attempt + 1).catch(err => console.error('[telegram] start', err)), wait);
    retryTimer.unref?.();
    return;
  }
  if (config.tgForbiddenUsernames.includes(String(me.username).toLowerCase())) {
    setIntegration('telegram', 'error', `@${me.username} — Nova agentining boti. Sotuv uchun @BotFather’da alohida bot oching.`);
    console.error(`[telegram] @${me.username} taqiqlangan (Nova). Polling boshlanmadi.`);
    me = null; return;
  }
  kvSet('tg_bot_username', me.username);
  setIntegration('telegram', 'ok', `@${me.username} · Business: ${me.can_connect_to_business ? 'yoqilgan' : 'BotFather’da Business Mode yoqilmagan'}`);
  running = true;
  offset = startOffset(me.id);
  loop();
}
export const stopTelegram = () => { running = false; clearTimeout(retryTimer); retryTimer = null; };

/* Bot almashsa (yangi token) eski kursor yaramaydi: yangi botning update_id lari kichikdan boshlanadi va
   eski, katta offset bilan Telegram ularni umuman qaytarmaydi — xabarlar «yo‘qolgandek» bo‘ladi. */
export function startOffset(botId) {
  const prev = kvGet('tg_offset_bot');
  if (prev !== String(botId)) {
    kvSet('tg_offset_bot', String(botId));
    kvSet('tg_offset', 0);
    if (prev) audit('sys', 'Telegram', 'Bot almashdi — xabar kursori nolga tushirildi', { result: `${prev} → ${botId}` });
    return 0;
  }
  return Number(kvGet('tg_offset', 0));
}

async function loop() {
  while (running) {
    try {
      const ups = await tg('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query', 'business_connection', 'business_message', 'edited_business_message', 'deleted_business_messages'] });
      for (const u of ups) {
        // Vaqtinchalik xato (masalan getBusinessConnection javob bermadi) — mijoz xabari yo‘qolmasin: 3 marta urinish, keyin keyingisiga.
        // Faqat Business update’lari (takror qayta ishlash xavfsiz: ext_msg_id bo‘yicha dublikat yozilmaydi); bot javoblari takrorlanmaydi.
        const tries = u.business_message || u.edited_business_message || u.deleted_business_messages || u.business_connection ? 3 : 1;
        for (let attempt = 1; ; attempt++) {
          try { await handle(u); break; }
          catch (e) {
            if (attempt >= tries || !running) { console.error('[telegram] update', u.update_id, e); audit('sys', 'Telegram', 'Xabarni qayta ishlab bo‘lmadi', { result: String(e.message || e) }); break; }
            await new Promise(r => setTimeout(r, 1500 * attempt));
          }
        }
        offset = u.update_id + 1; kvSet('tg_offset', offset);
      }
    } catch (e) {
      if (e.code === 409) setIntegration('telegram', 'error', '409 Conflict — shu token boshqa joyda ham ishlayapti. Tokenni faqat shu tizimda ishlating.');
      else if (e.code === 401) { setIntegration('telegram', 'error', 'Token noto‘g‘ri yoki bekor qilingan'); running = false; break; }
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

/* ---------- Business ---------- */
function upsertAccount(bc) {
  const canReply = Boolean(bc.rights ? bc.rights.can_reply : bc.can_reply);
  const name = [bc.user.first_name, bc.user.last_name].filter(Boolean).join(' ') + (bc.user.username ? ` (@${bc.user.username})` : '');
  const owner = one('SELECT id, branch_id FROM users WHERE tg_user_id=?', bc.user.id);
  const cur = one(`SELECT * FROM accounts WHERE channel='tg' AND ext_id=?`, bc.id);
  if (cur) {
    run('UPDATE accounts SET name=?, tg_owner_id=?, can_reply=?, enabled=?, owner_user_id=COALESCE(owner_user_id,?), branch_id=COALESCE(branch_id,?) WHERE id=?',
      name, bc.user.id, canReply ? 1 : 0, bc.is_enabled ? 1 : 0, owner?.id ?? null, owner?.branch_id ?? null, cur.id);
    return one('SELECT * FROM accounts WHERE id=?', cur.id);
  }
  // Yangi akkaunt xavfsiz boshlanadi: «kuzatish» — AI faqat qoralama yozadi, mijozga yubormaydi
  run(`INSERT INTO accounts(channel,ext_id,name,tg_owner_id,owner_user_id,branch_id,can_reply,enabled,mode,rollout,created_at) VALUES('tg',?,?,?,?,?,?,?,'kechiksa','kuzatish',?)`,
    bc.id, name, bc.user.id, owner?.id ?? null, owner?.branch_id ?? null, canReply ? 1 : 0, bc.is_enabled ? 1 : 0, now());
  audit('sys', 'Telegram', `Business akkaunt ulandi: ${name}`, { result: canReply ? 'Javob huquqi bor · kuzatish rejimi' : 'Javob huquqi YO‘Q — Telegram sozlamasida bering' });
  // Holat qatori eskirib qolmasin (Business Mode ishga tushgandan keyin yoqilgan bo‘lishi mumkin)
  setIntegration('telegram', 'ok', `@${me?.username || kvGet('tg_bot_username')} · Business: ulangan (${one(`SELECT count(*) n FROM accounts WHERE channel='tg' AND enabled=1`).n + 1} akkaunt)`);
  return one(`SELECT * FROM accounts WHERE channel='tg' AND ext_id=?`, bc.id);
}
async function accountFor(bcId) {
  const a = one(`SELECT * FROM accounts WHERE channel='tg' AND ext_id=?`, bcId);
  if (a) return a;
  return upsertAccount(await tg('getBusinessConnection', { business_connection_id: bcId }));
}

function describe(m) {
  if (m.text) return m.text;
  const cap = m.caption ? ' ' + m.caption : '';
  if (m.photo) return '[rasm]' + cap;
  if (m.video) return '[video]' + cap;
  if (m.voice) return '[ovozli xabar]';
  if (m.video_note) return '[video xabar]';
  if (m.document) return `[fayl: ${m.document.file_name || 'hujjat'}]` + cap;
  if (m.sticker) return `[stiker ${m.sticker.emoji || ''}]`;
  if (m.contact) return `[kontakt: ${m.contact.phone_number}]`;
  if (m.location) return '[joylashuv]';
  return '[xabar]';
}

/* Rasm, fayl, ovoz — panelda ko‘rish uchun file_id saqlanadi (fayl so‘ralganda yuklanadi, Bot API chegarasi 20 MB) */
function mediaMeta(m) {
  if (m.photo?.length) { const p = m.photo[m.photo.length - 1]; return { kind: 'photo', file_id: p.file_id, uid: p.file_unique_id, mime: 'image/jpeg', size: p.file_size }; }
  const d = m.document || m.voice || m.audio || m.video || m.video_note;
  if (!d) return null;
  const kind = m.document ? 'document' : m.voice ? 'voice' : m.audio ? 'audio' : m.video ? 'video' : 'video_note';
  return { kind, file_id: d.file_id, uid: d.file_unique_id, mime: d.mime_type || (kind === 'voice' ? 'audio/ogg' : kind.startsWith('video') ? 'video/mp4' : 'application/octet-stream'), size: d.file_size, name: d.file_name || null };
}

async function onBusinessMessage(m) {
  const acct = await accountFor(m.business_connection_id);
  const chatId = String(m.chat.id), ts = (m.date || Math.floor(now() / 1000)) * 1000;
  const convOf = () => one('SELECT id FROM conversations WHERE account_id=? AND ext_chat_id=?', acct.id, chatId);
  if (m.sender_business_bot) {
    // Bot o‘zi yuborgan xabarning aks-sadosi. Yozuv odatda allaqachon bor; yuborish holati «noma’lum» bo‘lgan bo‘lsa — shu bilan tasdiqlanadi
    const c = convOf();
    if (c && m.text) confirmEcho(c.id, m.text, m.message_id);
    return;
  }
  // Suhbatdosh xodimlar ro‘yxatida (Telegram ID yoki username) — bu mijoz emas: AI javob bermaydi, boshliq agent bilan ishlaydi
  const staff = staffForChat(m.chat);
  if (staff) return onStaffBusiness(acct, staff, m, ts);
  if (m.from && m.from.id === acct.tg_owner_id) {
    let c = convOf() || adoptArchived(acct, { extChatId: chatId, extUserId: chatId, handle: m.chat.username ? '@' + m.chat.username : null,
      name: [m.chat.first_name, m.chat.last_name].filter(Boolean).join(' ') });
    if (!c) {
      run(`INSERT INTO conversations(account_id,ext_chat_id,ext_user_id,handle,display_name,branch_id,owner_user_id,created_at,last_msg_at) VALUES(?,?,?,?,?,?,?,?,?)`,
        acct.id, chatId, chatId, m.chat.username ? '@' + m.chat.username : null, [m.chat.first_name, m.chat.last_name].filter(Boolean).join(' ') || null,
        acct.branch_id, acct.owner_user_id, ts, ts);
      c = convOf();
    }
    // Telegram Business «Uzoqdaman»/«Salomlashuv» xabari yoki rejalashtirilgan xabar — odam javobi emas: mijoz javob kutishda qoladi
    if (m.is_from_offline) return recordAutoMessage(c.id, { text: describe(m), extMsgId: m.message_id, ts });
    // Sotuvchi o‘z Telegram ilovasidan yozdi → AI kutayotgan javobi bekor
    markSellerReply(c.id, { text: describe(m), userId: acct.owner_user_id, extMsgId: m.message_id, ts, via: 'telegram' });
    return;
  }
  // Boshqa botlarga hech qachon javob yo‘q: ikki bot bir-biriga cheksiz yozishib qolmasin (Sotuvchi agent saboqi)
  if (m.from?.is_bot || /bot$/i.test(m.from?.username || '') || /bot$/i.test(m.chat?.username || '')) {
    audit('sys', 'Telegram', 'Botdan kelgan xabar e’tiborsiz qoldirildi', { result: m.from?.username || String(m.from?.id || '') });
    return;
  }
  const c = ingestClient(acct, {
    extChatId: chatId, extUserId: m.from?.id, handle: m.from?.username ? '@' + m.from.username : null,
    name: [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ') || null,
    text: describe(m), extMsgId: m.message_id, ts, meta: (m.contact || mediaMeta(m) || m.reply_to_message) ? { ...(m.contact ? { contact: m.contact } : {}), ...(mediaMeta(m) ? { media: mediaMeta(m) } : {}), ...(m.reply_to_message ? { reply_ext: String(m.reply_to_message.message_id) } : {}) } : null
  });
  // Mijoz o‘z kontaktini ulashsa — telefon orqali BILLZ bilan bog‘lash (boshqa odamning kontakti emas!)
  if (m.contact && m.contact.user_id && m.contact.user_id === m.from?.id) await linkCustomer(c.id, m.contact.phone_number, 'Telegram kontakt ulashildi (Business chat)');
  // Ovozli xabar → matn (fonda): AI qoralamasi matn tayyor bo‘lguncha kutadi.
  // AI shu kanalda to‘xtatilgan bo‘lsa — o‘girilmaydi ham: «to‘xtatilgan kanalda AI xarajati yo‘q» degani shu.
  const media = mediaMeta(m);
  if (media && ['voice', 'audio', 'video_note'].includes(media.kind) && aiOn(acct)) transcribeLater(c.id, m.message_id, media).catch(e => console.error('[stt]', e.message));
}

/* Xodim: shaxsiy chat ID = Telegram ID (doimiy); username — faqat ID hali ma’lum bo‘lmasa (birinchi yozganda ID saqlanadi) */
export function staffForChat(chat) {
  if (!chat || chat.type !== 'private') return null;
  const byId = one('SELECT * FROM users WHERE active=1 AND tg_user_id=?', chat.id);
  if (byId) return byId;
  const uname = String(chat.username || '').toLowerCase();
  return uname ? one('SELECT * FROM users WHERE active=1 AND tg_user_id IS NULL AND lower(tg_username)=?', uname) : null;
}

/* Xodim Photobuy akkaunti bilan yozishmasi: ish boshida yozadi (24 soatlik oyna ochiladi, «ishda»), «+» — qabul, «bajarildi» — tayyor.
   Akkaunt egasining (rahbar) shu chatdagi o‘z xabarlari — mijoz suhbati emas, e’tiborsiz. */
async function onStaffBusiness(acct, staff, m, ts) {
  if (m.from?.id === acct.tg_owner_id) return;
  const firstToday = !staff.biz_seen_at || local(staff.biz_seen_at).date !== local(ts).date;
  tx(() => {
    if (!staff.tg_user_id && !one('SELECT 1 FROM users WHERE tg_user_id=? AND id<>?', m.chat.id, staff.id)) run('UPDATE users SET tg_user_id=? WHERE id=?', m.chat.id, staff.id);
    run('UPDATE users SET biz_conn=?, biz_seen_at=?, active_at=? WHERE id=?', acct.ext_id, ts, ts, staff.id);
    // Ro‘yxatga qo‘shilishidan oldin mijoz sifatida yozilgan suhbati bo‘lsa — navbatdan chiqadi (AI unga javob yozmaydi)
    const c = one('SELECT id FROM conversations WHERE account_id=? AND ext_chat_id=? AND archived=0', acct.id, String(m.chat.id));
    if (c) {
      run(`UPDATE drafts SET status='cancelled', reason='Suhbatdosh — xodim', decided_at=? WHERE conversation_id=? AND status IN ('preparing','ready')`, now(), c.id);
      run('UPDATE conversations SET archived=1, pending_since=NULL, ai_due_at=NULL WHERE id=?', c.id);
    }
  });
  if (firstToday) audit('staff', staff.name, 'Ishga keldi — Photobuy akkauntiga yozdi', { data: acct.name });
  const d = await import('../services/dispatch.js');
  await d.onStaffMessage(one('SELECT * FROM users WHERE id=?', staff.id), { text: m.text || m.caption || '', replyTo: m.reply_to_message?.message_id ?? null, firstToday, via: 'biz' });
}

/* Xodimga Photobuy akkaunti nomidan (Business): rahbar yozgandek. Qaytaradi: xabar id yoki null (oyna yopiq / xato).
   Tugmalar qo‘llab-quvvatlanmasa — tugmasiz qayta yuboriladi (javob «+» / «bajarildi» bilan ham ishlaydi). */
export async function sendStaffBusiness(user, text, buttons = null) {
  if (!running || !user?.tg_user_id) return null;
  const acct = (user.biz_conn && one(`SELECT * FROM accounts WHERE channel='tg' AND ext_id=? AND enabled=1 AND can_reply=1`, user.biz_conn))
    || one(`SELECT * FROM accounts WHERE channel='tg' AND enabled=1 AND can_reply=1 AND is_demo=0 ORDER BY id LIMIT 1`);
  if (!acct) return null;
  const base = { business_connection_id: acct.ext_id, chat_id: Number(user.tg_user_id), text: String(text).slice(0, 4096), parse_mode: 'HTML', disable_web_page_preview: true };
  try { return (await tg('sendMessage', { ...base, ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}) })).message_id; }
  catch (e) {
    if (!buttons) { console.error('[telegram] staff biz', e.message); return null; }
    try { return (await tg('sendMessage', base)).message_id; } catch (e2) { console.error('[telegram] staff biz', e2.message); return null; }
  }
}

/* Ovozni matnga aylantirib, xabar matnini «[ovozli xabar] …» ga almashtiradi va shundan keyin qoralama tayyorlanadi.
   Aylantirib bo‘lmasa ham qoralama baribir tayyorlanadi (AI mijozdan yozib yuborishni so‘raydi yoki sotuvchiga uzatadi). */
const STT_WAIT = 150000;
export async function transcribeLater(convId, extMsgId, media) {
  if (!sttReady()) return;
  scheduleDraft(convId, STT_WAIT);   // 2,5 soniyadagi qoralama o‘rniga — matn tayyor bo‘lguncha kutadi
  run('UPDATE conversations SET ai_due_at=MAX(ai_due_at, ?) WHERE id=? AND ai_due_at IS NOT NULL', now() + STT_WAIT, convId);
  try {
    const buf = await telegramFile(media);
    const r = await transcribe(buf, media.mime);
    const msg = one('SELECT id, meta FROM messages WHERE conversation_id=? AND ext_msg_id=?', convId, String(extMsgId));
    if (msg && r.text) {
      const label = media.kind === 'video_note' ? '[video xabar]' : '[ovozli xabar]';
      run('UPDATE messages SET text=?, meta=? WHERE id=?', `${label} ${r.text}`,
        JSON.stringify({ ...(jparse(msg.meta, {}) || {}), transcript: { text: r.text, lang: r.lang || null, ms: r.ms || null, via: r.via || null } }), msg.id);
      audit('sys', 'Nutq', 'Ovozli xabar matnga aylantirildi', { object: `conv:${convId}`, result: `${r.via === 'gemini' ? 'Gemini' : 'Whisper'} · ${Math.round((r.ms || 0) / 1000)} s${r.sec != null ? ` · ${r.sec} s ovoz` : ''}${r.lang ? ' · ' + r.lang : ''}` });
    } else if (r.skipped) audit('sys', 'Nutq', 'Ovozli xabar aylantirilmadi', { object: `conv:${convId}`, result: r.skipped });
  } catch (e) {
    audit('sys', 'Nutq', 'Ovozli xabarni aylantirishda xato', { object: `conv:${convId}`, result: String(e.message || e).slice(0, 200) });
  } finally {
    scheduleDraft(convId, 0);        // matn bilan (yoki matnsiz) qoralama endi tayyorlanadi
  }
}

export async function linkCustomer(convId, phone, how) {
  await refreshClientByPhone(phone); // BILLZ ulangan bo‘lsa — shu raqam bo‘yicha yangi ma’lumot (keshbek, yangi mijoz)
  const cust = customerByPhone(phone);
  if (!cust) { audit('sys', 'BILLZ', 'Kontakt ulashildi, lekin BILLZ’da mijoz topilmadi', { object: `conv:${convId}`, data: normPhone(phone) }); return false; }
  tx(() => {
    run('UPDATE customers SET verified_at=COALESCE(verified_at,?), verified_how=COALESCE(verified_how,?) WHERE id=?', now(), how, cust.id);
    run('UPDATE conversations SET customer_id=? WHERE id=?', cust.id, convId);
  });
  audit('sys', 'BILLZ', `Mijoz tasdiqlandi: BILLZ #${cust.billz_id}`, { object: `conv:${convId}`, data: how });
  return true;
}

/* ---------- xodim va mijoz boti ---------- */
async function onMessage(m) {
  if (m.chat.type !== 'private') return;
  const text = (m.text || '').trim();
  const link = text.match(/^\/start\s+link_([A-Za-z0-9]+)$/);
  if (link) {
    const row = one('SELECT * FROM tg_links WHERE code=? AND expires_at>?', link[1], now());
    if (!row) return tg('sendMessage', { chat_id: m.chat.id, text: 'Havola eskirgan yoki noto‘g‘ri. Paneldan yangisini oling.' });
    tx(() => {
      run('UPDATE users SET tg_user_id=NULL, tg_chat_id=NULL WHERE tg_user_id=?', m.from.id);
      run('UPDATE users SET tg_user_id=?, tg_chat_id=? WHERE id=?', m.from.id, m.chat.id, row.user_id);
      run('DELETE FROM tg_links WHERE code=?', link[1]);
      const u = one('SELECT id, branch_id FROM users WHERE id=?', row.user_id);
      run('UPDATE accounts SET owner_user_id=COALESCE(owner_user_id,?), branch_id=COALESCE(branch_id,?) WHERE channel=\'tg\' AND tg_owner_id=?', u.id, u.branch_id, m.from.id);
    });
    const u = one('SELECT name FROM users WHERE id=?', row.user_id);
    audit('staff', u.name, 'Telegram bildirishnomalari ulandi');
    return tg('sendMessage', { chat_id: m.chat.id, parse_mode: 'HTML', text: `Salom, ${esc(u.name)}! Bildirishnomalar shu chatga keladi: Nazorat eslatmalari (24 soat ichida bog‘lanilmagan lidlar), AI javoblari, katta buyurtmalar.` });
  }
  // Instagram ulash yordamchisi: https://t.me/<bot>?start=meta
  if (/^\/start\s+meta$/.test(text)) return metaStart(tg, m.chat.id);
  if (/^\/start\s+telegram$/.test(text)) return tgGuideStart(tg, m.chat.id);
  if (text && !text.startsWith('/') && waitingQuestion(m.chat.id)) return metaQuestion(tg, m.chat.id, m.from, text);

  let staff = one('SELECT * FROM users WHERE tg_user_id=? AND active=1', m.from.id);
  // Xodim panelda Telegram ID yoki username bilan qo‘shilgan — botga birinchi yozganda (odatda «Start») o‘zi ulanadi
  if (!staff?.tg_chat_id) {
    const uname = String(m.from.username || '').toLowerCase();
    const cand = staff || (uname && one('SELECT * FROM users WHERE active=1 AND tg_user_id IS NULL AND lower(tg_username)=?', uname));
    if (cand) {
      tx(() => {
        run('UPDATE users SET tg_user_id=NULL, tg_chat_id=NULL WHERE tg_user_id=? AND id<>?', m.from.id, cand.id);
        run('UPDATE users SET tg_user_id=?, tg_chat_id=? WHERE id=?', m.from.id, m.chat.id, cand.id);
      });
      audit('staff', cand.name, 'Telegram bot ulandi (ID/username bo‘yicha)');
      return tg('sendMessage', { chat_id: m.chat.id, parse_mode: 'HTML', text: `Salom, ${esc(cand.name)}! Siz Photobuy sotuv tizimiga ulandingiz.\nTopshiriqlar shu chatga keladi: mijozga rasm yuborish, to‘lovni tasdiqlash, buyurtma. Har topshiriqda «Qabul qildim» ni tez bosing — kechiksa, topshiriq boshqa sotuvchiga o‘tadi.` });
    }
  }
  if (staff) run('UPDATE users SET active_at=? WHERE id=?', now(), staff.id);
  // Agentni o‘qitish (Sotuvchi agent usuli): rahbar, admin va filial rahbari Telegram’dan to‘g‘ri javob kiritadi
  if (staff && /^\/(tuzat|tuzatishlar|ochir)\b/.test(text)) return teachCommand(m, staff, text);
  // Xodim botga oddiy matn yozdi — rahbar (boshliq agent) bilan yozishma: «ok», «bo‘ldi», «vaqtim yo‘q, boshqasiga ayting», savol
  if (staff && text && !text.startsWith('/')) {
    const d = await import('../services/dispatch.js');
    return d.onStaffMessage(staff, { text, via: 'bot', replyTo: m.reply_to_message?.message_id ?? null });
  }
  if (staff) return tg('sendMessage', { chat_id: m.chat.id, text: 'Ishlar shu chatga keladi — «ok» deb javob bering, qilib bo‘lgach «bo‘ldi». Suhbatlar panelda: ' + config.publicUrl + '\nAgentni o‘qitish: /tuzat Savol => To‘g‘ri javob · /tuzatishlar' });

  // Mijoz boti (Chaqnoq): kontakt → BILLZ → keshbek va rozilik
  if (m.contact) {
    if (m.contact.user_id !== m.from.id) return tg('sendMessage', { chat_id: m.chat.id, text: 'Iltimos, o‘zingizning raqamingizni «Raqamni ulashish» tugmasi orqali yuboring.' });
    await refreshClientByPhone(m.contact.phone_number);
    const cust = customerByPhone(m.contact.phone_number);
    if (!cust) return tg('sendMessage', { chat_id: m.chat.id, reply_markup: { remove_keyboard: true }, text: 'Bu raqam bo‘yicha xarid topilmadi. Do‘konda xarid qilganingizda kassirga shu raqamni ayting.' });
    tx(() => {
      run('UPDATE customers SET bot_chat_id=NULL WHERE bot_chat_id=?', m.chat.id);
      run('UPDATE customers SET bot_chat_id=?, verified_at=COALESCE(verified_at,?), verified_how=COALESCE(verified_how,?) WHERE id=?', m.chat.id, now(), 'Photobuy boti: kontakt ulashildi', cust.id);
    });
    const cb = one('SELECT * FROM cashback WHERE customer_id=?', cust.id);
    audit('sys', 'Photobuy boti', `Mijoz botga ulandi: BILLZ #${cust.billz_id}`);
    await tg('sendMessage', { chat_id: m.chat.id, reply_markup: { remove_keyboard: true }, parse_mode: 'HTML',
      text: cb ? `Hisobingizda <b>${money(cb.amount)}</b> keshbek bor (BILLZ, ${new Date(cb.synced_at).toISOString().slice(0, 10)} holati).` : 'Hisobingiz topildi. Keshbek ma’lumoti hozircha yo‘q.' });
    return tg('sendMessage', { chat_id: m.chat.id, text: 'Sizga mos yangi tovarlar kelganda shu yerga xabar yuboraylikmi? Istalgan payt /stop bilan to‘xtatasiz.',
      reply_markup: { inline_keyboard: [[{ text: 'Ha, yuboring', callback_data: 'consent:yes' }, { text: 'Kerak emas', callback_data: 'consent:no' }]] } });
  }
  if (text === '/stop') {
    run('UPDATE customers SET optout_at=?, consent_at=NULL WHERE bot_chat_id=?', now(), m.chat.id);
    audit('sys', 'Photobuy boti', 'Mijoz xabarlardan voz kechdi (/stop)');
    return tg('sendMessage', { chat_id: m.chat.id, text: 'Xabarlar to‘xtatildi. Qayta yoqish uchun /start.' });
  }
  if (text.startsWith('/start') || text === '/keshbek') {
    return tg('sendMessage', { chat_id: m.chat.id, text: 'Assalomu alaykum! Bu Photobuy boti. Keshbekingizni ko‘rish uchun telefon raqamingizni ulashing.',
      reply_markup: { keyboard: [[{ text: 'Raqamni ulashish', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true } });
  }
  const cust = one('SELECT * FROM customers WHERE bot_chat_id=?', m.chat.id);
  if (cust && text && botReplyHook?.(cust, text)) return tg('sendMessage', { chat_id: m.chat.id, text: 'Rahmat! Sotuvchimiz tez orada siz bilan bog‘lanadi.' });
  return tg('sendMessage', { chat_id: m.chat.id, text: 'Savolingiz bo‘lsa, Photobuy sotuvchilariga yozing. Keshbek uchun: /keshbek' });
}

/* /tuzat Savol => Javob · /tuzatishlar · /ochir N — faqat rahbar, admin, filial rahbari */
async function teachCommand(m, staff, text) {
  const reply = t => tg('sendMessage', { chat_id: m.chat.id, text: t.slice(0, 4000), disable_web_page_preview: true });
  if (!['admin', 'rahbar', 'filial'].includes(staff.role)) return reply('Agentni o‘qitish faqat rahbar va filial rahbari uchun.');
  if (/^\/tuzatishlar/.test(text)) {
    const rows = activeAnswers().slice(0, 20);
    return reply(rows.length ? 'Tasdiqlangan javoblar (oxirgi 20):\n\n' + rows.map(r => `#${r.id} • ${r.question.slice(0, 90)}\n→ ${r.answer.slice(0, 160)}`).join('\n\n') + '\n\nO‘chirish: /ochir <raqam>'
      : 'Hozircha tasdiqlangan javob yo‘q. Qo‘shish: /tuzat Mijoz savoli => To‘g‘ri javob');
  }
  if (/^\/ochir/.test(text)) {
    const id = Number((text.match(/\d+/) || [])[0]);
    return reply(id && setAnswerActive(id, false, staff.name) ? `#${id} o‘chirildi. Agent endi bu javobni ishlatmaydi.` : 'Raqam topilmadi. Ro‘yxat: /tuzatishlar');
  }
  const body = text.replace(/^\/tuzat(@\w+)?\s*/, '').trim();
  const [q, a] = body.includes('=>') ? body.split('=>').map(x => x.trim()) : ['', ''];
  if (!q || !a) return reply('Qanday ishlatiladi:\n/tuzat Mijoz savoli => To‘g‘ri javob\n\nMasalan:\n/tuzat Yetkazib berasizmi? => Toshkent bo‘ylab bor, narxi va vaqtini sotuvchi aytadi.\n\nRo‘yxat: /tuzatishlar · O‘chirish: /ochir 3');
  const id = saveAnswer({ question: q, answer: a, author: staff.name, source: 'telegram' }, staff.name);
  return reply(`Saqlandi (#${id}). Agent endi shu savolga shu mazmunda javob beradi:\n\nSavol: ${q.slice(0, 200)}\nJavob: ${a.slice(0, 400)}\n\nRo‘yxat: /tuzatishlar`);
}

async function onCallback(q) {
  const [kind, arg] = String(q.data || '').split(':');
  const staff = one('SELECT * FROM users WHERE tg_user_id=? AND active=1', q.from.id);
  if (staff) run('UPDATE users SET active_at=? WHERE id=?', now(), staff.id);
  let answer = '';
  if (kind === 'take' && staff) { takeOver(Number(arg), staff); answer = 'Suhbat sizda. AI to‘xtadi.'; }
  else if ((kind === 'as_ok' || kind === 'as_done') && staff) {
    const d = await import('../services/dispatch.js');
    answer = kind === 'as_ok' ? d.acceptAssignment(arg, staff) : d.doneAssignment(arg, staff);
  }
  else if (kind === 'accept' && staff) {
    const r = run('UPDATE conversations SET big_accepted_by=?, owner_user_id=? WHERE id=? AND big_accepted_by IS NULL', staff.id, staff.id, Number(arg));
    answer = r.changes ? 'Qabul qilindi.' : 'Allaqachon qabul qilingan.';
    if (r.changes) audit('staff', staff.name, 'Katta buyurtmani qabul qildi', { object: `conv:${arg}` });
  } else if (kind === 'consent') {
    if (arg === 'yes') run('UPDATE customers SET consent_at=?, optout_at=NULL WHERE bot_chat_id=?', now(), q.message.chat.id);
    else run('UPDATE customers SET consent_at=NULL WHERE bot_chat_id=?', q.message.chat.id);
    audit('sys', 'Photobuy boti', arg === 'yes' ? 'Mijoz yangi tovar xabarlariga rozilik berdi' : 'Mijoz rozilik bermadi');
    answer = arg === 'yes' ? 'Rahmat! Mos tovar kelganda yozamiz.' : 'Tushunarli, yozmaymiz.';
    await tg('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
  } else if (kind === 'meta') { answer = await metaCallback(tg, q, arg); }
  else if (kind === 'tgq') { answer = await tgGuideCallback(tg, q, arg); }
  else answer = 'Bu amal uchun ruxsat yo‘q.';
  return tg('answerCallbackQuery', { callback_query_id: q.id, text: answer });
}

/* Mijoz xabarini tahrirlasa yoki o‘chirsa — panel tarixi ham yangilanadi (birinchi matn meta’da saqlanadi) */
function convByChat(bcId, chatId) {
  const a = one(`SELECT id FROM accounts WHERE channel='tg' AND ext_id=?`, bcId);
  return a && one('SELECT id FROM conversations WHERE account_id=? AND ext_chat_id=?', a.id, String(chatId));
}
function onEdited(m) {
  const c = convByChat(m.business_connection_id, m.chat.id); if (!c) return;
  const row = one('SELECT id, text, meta FROM messages WHERE conversation_id=? AND ext_msg_id=?', c.id, String(m.message_id)); if (!row) return;
  const meta = { ...(row.meta ? JSON.parse(row.meta) : {}), edited_at: now() };
  meta.original ??= row.text;
  run('UPDATE messages SET text=?, meta=? WHERE id=?', describe(m), JSON.stringify(meta), row.id);
}
function onDeleted(d) {
  const c = convByChat(d.business_connection_id, d.chat.id); if (!c) return;
  for (const id of d.message_ids || []) {
    const row = one('SELECT id, meta FROM messages WHERE conversation_id=? AND ext_msg_id=?', c.id, String(id)); if (!row) continue;
    run('UPDATE messages SET meta=? WHERE id=?', JSON.stringify({ ...(row.meta ? JSON.parse(row.meta) : {}), deleted_at: now() }), row.id);
  }
  clientDeleted(c.id); // kutilayotgan savollarning hammasi o‘chirilgan bo‘lsa — AI javob yozmaydi
}

/* Faylni Telegram’dan olish (panel so‘raganda). Keshlanadi: data/files/<uid> */
export async function telegramFile(media) {
  const { mkdirSync, existsSync, readFileSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dir = join(config.dataDir, 'files'); mkdirSync(dir, { recursive: true });
  const cache = join(dir, String(media.uid || media.file_id).replace(/[^A-Za-z0-9_-]/g, ''));
  if (existsSync(cache)) return readFileSync(cache);
  if (!running) throw new Error('bot ishlamayapti');
  if (media.size && media.size > 20e6) throw new Error('fayl 20 MB dan katta — Telegram’da oching');
  const f = await tg('getFile', { file_id: media.file_id });
  const res = await fetch(`https://api.telegram.org/file/bot${config.tgToken}/${f.file_path}`, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`fayl yuklanmadi: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(cache, buf);
  return buf;
}

/* Mijozning profil rasmi — panel ro‘yxatida bosh harflar o‘rniga (services/avatar.js saqlaydi). Eng kichik o‘lcham (~160 px) yetarli.
   Rasm yo‘q yoki mijoz faqat kontaktlariga ko‘rsatadi — null; Telegram xatosi — throw (e.code = Telegram xato kodi). */
export async function tgUserPhoto(userId) {
  if (!config.tgToken) return null;
  const r = await tg('getUserProfilePhotos', { user_id: Number(userId), limit: 1 });
  const sizes = r?.photos?.[0];
  if (!sizes?.length) return null;
  const pick = sizes.find(s => (s.width || 0) >= 150) || sizes[sizes.length - 1];
  const f = await tg('getFile', { file_id: pick.file_id });
  const res = await fetch(`https://api.telegram.org/file/bot${config.tgToken}/${f.file_path}`, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw Object.assign(new Error(`profil rasmi yuklanmadi: HTTP ${res.status}`), { status: res.status });
  return Buffer.from(await res.arrayBuffer());
}

async function handle(u) {
  if (u.business_connection) { upsertAccount(u.business_connection); return; }
  if (u.business_message) return onBusinessMessage(u.business_message);
  if (u.edited_business_message) return onEdited(u.edited_business_message);
  if (u.deleted_business_messages) return onDeleted(u.deleted_business_messages);
  if (u.callback_query) return onCallback(u.callback_query);
  if (u.message) return onMessage(u.message);
}

/* ---------- yuborish ---------- */
export async function sendBusiness(acct, conv, text, opts = {}) {
  const r = await tg('sendMessage', { business_connection_id: acct.ext_id, chat_id: Number(conv.ext_chat_id), text: String(text).slice(0, 4096),
    ...(opts.replyTo ? { reply_parameters: { message_id: Number(opts.replyTo), allow_sending_without_reply: true } } : {}) });
  return r.message_id;
}
/* Panel orqali yuborilgan fayl: rasm / video / ovoz / audio / hujjat — turiga qarab tegishli Telegram usuli */
const FILE_METHOD = { photo: ['sendPhoto', 'photo'], video: ['sendVideo', 'video'], voice: ['sendVoice', 'voice'], audio: ['sendAudio', 'audio'], document: ['sendDocument', 'document'] };
export async function sendBusinessFile(acct, conv, { buf, name, mime, kind }, caption = '', opts = {}) {
  const [method, field] = FILE_METHOD[kind] || FILE_METHOD.document;
  const fd = new FormData();
  fd.append('business_connection_id', acct.ext_id);
  fd.append('chat_id', String(conv.ext_chat_id));
  if (caption && kind !== 'voice') fd.append('caption', String(caption).slice(0, 1024));
  if (opts.replyTo) fd.append('reply_parameters', JSON.stringify({ message_id: Number(opts.replyTo), allow_sending_without_reply: true }));
  fd.append(field, new Blob([buf], { type: mime || 'application/octet-stream' }), name || 'fayl');
  const res = await tgFetch(method, { method: 'POST', body: fd }, 120000);
  const j = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
  if (!j.ok) { const e = new Error(j.description || 'telegram_error'); e.code = j.error_code; throw e; }
  return j.result.message_id;
}
/* «Yozmoqda…» belgisi (Business suhbatida ham): Telegram uni ~5 s ushlaydi, shuning uchun takrorlab turiladi */
export async function tgTyping(acct, conv) {
  await tg('sendChatAction', { business_connection_id: acct.ext_id, chat_id: Number(conv.ext_chat_id), action: 'typing' });
}

/* Yuborilgan xabarni tahrirlash va (mijoz tomonida ham) o‘chirish — Business huquqlari bo‘lsa */
export async function editBusiness(acct, conv, extId, text) {
  await tg('editMessageText', { business_connection_id: acct.ext_id, chat_id: Number(conv.ext_chat_id), message_id: Number(extId), text: String(text).slice(0, 4096) });
}
export async function deleteBusiness(acct, ids) {
  const list = ids.map(Number).filter(Number.isFinite);
  for (let i = 0; i < list.length; i += 100) await tg('deleteBusinessMessages', { business_connection_id: acct.ext_id, message_ids: list.slice(i, i + 100) });
}
/* Tovar rasmi mijozga: fayl serverdan yuboriladi (tashqi havolaga tayanilmaydi), izoh bilan */
export async function sendBusinessPhoto(acct, conv, buf, caption = '') {
  const fd = new FormData();
  fd.append('business_connection_id', acct.ext_id);
  fd.append('chat_id', String(conv.ext_chat_id));
  if (caption) fd.append('caption', String(caption).slice(0, 1024));
  fd.append('photo', new Blob([buf], { type: 'image/jpeg' }), 'tovar.jpg');
  const res = await tgFetch('sendPhoto', { method: 'POST', body: fd }, 60000);
  const j = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
  if (!j.ok) { const e = new Error(j.description || 'telegram_error'); e.code = j.error_code; throw e; }
  return j.result.message_id;
}

/* Albom: 2–10 rasm bitta guruh bo‘lib (mijoz «rasmlarini ko‘rsating» deganda variantlar). Qaytaradi: xabar id lari */
export async function sendBusinessAlbum(acct, conv, items) {
  const fd = new FormData();
  fd.append('business_connection_id', acct.ext_id);
  fd.append('chat_id', String(conv.ext_chat_id));
  fd.append('media', JSON.stringify(items.map((it, i) => ({ type: 'photo', media: `attach://p${i}`, ...(it.caption ? { caption: String(it.caption).slice(0, 1024) } : {}) }))));
  items.forEach((it, i) => fd.append(`p${i}`, new Blob([it.buf], { type: 'image/jpeg' }), `tovar${i + 1}.jpg`));
  const res = await tgFetch('sendMediaGroup', { method: 'POST', body: fd }, 90000);
  const j = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
  if (!j.ok) { const e = new Error(j.description || 'telegram_error'); e.code = j.error_code; throw e; }
  return j.result.map(m => m.message_id);
}

export async function sendStaff(user, text, buttons = null) {
  if (!running || !user?.tg_chat_id) return false;
  await tg('sendMessage', { chat_id: user.tg_chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}) })
    .catch(e => console.error('[telegram] staff', e.message));
  return true;
}
/* Xuddi sendStaff, lekin natija bilan: xabar yetdimi (xodim botni bloklagan yoki «Start» bosmagan bo‘lsa — false) */
export async function sendStaffChecked(user, text, buttons = null) {
  if (!running || !user?.tg_chat_id) return false;
  try {
    await tg('sendMessage', { chat_id: user.tg_chat_id, text, parse_mode: 'HTML', disable_web_page_preview: true, ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}) });
    return true;
  } catch (e) { console.error('[telegram] staff', e.message); return false; }
}
export const telegramRunning = () => running;
export const consentedCustomers = () => all('SELECT * FROM customers WHERE bot_chat_id IS NOT NULL AND consent_at IS NOT NULL AND optout_at IS NULL');
