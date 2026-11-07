import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { config, igReady, geminiReady } from '../config.js';
import { one, run, all, kvGet, kvSet } from '../db.js';
import { now, clip, jparse } from '../util.js';
import { setIntegration, getSettings } from '../services/settings.js';
import { ingestClient, markSellerReply, confirmEcho, clientDeleted, aiOn, scheduleDraft, upsertConversation, recordAutoMessage } from '../services/inbox.js';
import { transcribe, sttReady } from '../services/stt.js';
import { audit } from '../core/audit.js';
import { runAgent as geminiAgent } from '../ai/gemini.js';

/*
  Instagram Direct (Meta). Telegram’dan farqi: Meta o‘zi bizning serverga veb-huk yuboradi (poling yo‘q).
  Kirish: POST /webhook/instagram — har so‘rov X-Hub-Signature-256 bilan tekshiriladi (ilova siri, HMAC-SHA256, xom tana).
  Chiqish: POST {IG_API_BASE}/{IG_USER_ID}/messages — mijozga javob.
  Xavfsizlik: imzosi noto‘g‘ri so‘rov qabul qilinmaydi; token va sir faqat .env da.
*/

let me = null;

/* Token: uzoq muddatli token 60 kunda tugaydi. Yangilangani bazada saqlanadi (.env ga yozib bo‘lmaydi — u root:sales 640).
   Yangilash: GET /refresh_access_token (token kamida 24 soatlik va amal qilayotgan bo‘lishi kerak). */
const token = () => kvGet('ig_token') || config.igToken;
const tokenAge = () => Number(kvGet('ig_token_at') || 0);

export async function refreshIgToken() {
  if (!igReady()) return { ok: false, why: 'sozlanmagan' };
  const res = await fetch(`${config.igApiBase}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token())}`, { signal: AbortSignal.timeout(20000) });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.access_token) {
    const why = j?.error?.message || `HTTP ${res.status}`;
    setIntegration('instagram', 'error', `Tokenni yangilab bo‘lmadi: ${why}. Muddati tugasa, sozla.sh instagram bilan yangi token kiritiladi.`);
    audit('sys', 'Instagram', 'Token yangilanmadi', { result: why });
    return { ok: false, why };
  }
  kvSet('ig_token', j.access_token); kvSet('ig_token_at', now());
  audit('sys', 'Instagram', 'Token yangilandi', { result: `${Math.round((j.expires_in || 0) / 86400)} kun` });
  return { ok: true, days: Math.round((j.expires_in || 0) / 86400) };
}

/* Har kuni tekshiriladi: token 30 kundan eski bo‘lsa yangilanadi (60 kunlik muddat tugamasidan ancha oldin) */
export async function igTokenJob() {
  if (!igReady()) return null;
  const age = tokenAge();
  if (!age) { kvSet('ig_token_at', now()); return null; }      // birinchi ko‘rish: sanani belgilab qo‘yamiz
  if (now() - age < 30 * 864e5) return null;
  return refreshIgToken();
}

/* UTF-8 bayt chegarasi (Meta: matn ≤ 1000 bayt; kirill/o‘zbek harflari 2 baytdan) */
export function clipBytes(s, max) {
  const buf = Buffer.from(s, 'utf8');
  if (buf.length <= max) return s;
  let end = max;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--;          // belgi o‘rtasidan kesilmasin
  return buf.subarray(0, end).toString('utf8');
}

/* Veb-huk obunasi: akkaunt darajasida (ilova darajasidagi obuna Meta panelida qilinadi) */
export async function igSubscribe() {
  const fields = 'messages,messaging_postbacks,messaging_seen,comments'; // aks-sado (is_echo) «messages» ichida keladi; message_echoes bu API'da yo‘q
  const res = await fetch(`${config.igApiBase}/me/subscribed_apps?subscribed_fields=${fields}`, {
    method: 'POST', headers: { authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(20000)
  });
  const j = await res.json().catch(() => null);
  return { ok: Boolean(j?.success), detail: j?.error?.message || null };
}

/* Ish boshida: profil o‘qiladi (akkaunt nomi) va veb-huk obunasi tasdiqlanadi */
export async function startInstagram() {
  if (!igStatus()) return false;
  try {
    const res = await fetch(`${config.igApiBase}/me?fields=user_id,username`, { headers: { authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(20000) });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.username) {
      setIntegration('instagram', 'error', `Token qabul qilinmadi: ${j?.error?.message || `HTTP ${res.status}`}`);
      return false;
    }
    me = j;
    const sub = await igSubscribe();
    setIntegration('instagram', 'ok', `@${j.username} · veb-huk obunasi: ${sub.ok ? 'bor' : `yo‘q (${sub.detail || 'xato'})`}`);
    account();
    backfillProfiles().catch(() => {});
    return true;
  } catch (e) {
    setIntegration('instagram', 'error', `Ulanib bo‘lmadi: ${String(e.message || e)}`);
    return false;
  }
}

export function igStatus() {
  if (!igReady()) {
    setIntegration('instagram', 'off', config.igToken ? 'O‘chirilgan (IG_DISABLED)' : 'Meta ilovasi va tokeni kiritilmagan');
    return false;
  }
  if (!config.igAppSecret || !config.igVerifyToken) {
    setIntegration('instagram', 'error', 'IG_APP_SECRET yoki IG_VERIFY_TOKEN yo‘q — veb-huk imzosini tekshirib bo‘lmaydi');
    return false;
  }
  return true;
}

/* Meta veb-hukni ulashda bir marta chaqiradi: hub.verify_token mos kelsa hub.challenge qaytariladi */
export function verifyWebhook(params) {
  const mode = params.get('hub.mode'), token = params.get('hub.verify_token'), challenge = params.get('hub.challenge');
  if (!config.igVerifyToken) return { ok: false, code: 503, body: 'verify token not set' };
  if (mode === 'subscribe' && token && config.igVerifyToken && token === config.igVerifyToken) {
    audit('sys', 'Instagram', 'Veb-huk tasdiqlandi (hub.challenge)');
    return { ok: true, code: 200, body: String(challenge ?? '') };
  }
  audit('sys', 'Instagram', 'Veb-huk tasdig‘i rad etildi', { result: 'verify_token mos emas' });
  return { ok: false, code: 403, body: 'forbidden' };
}

/* Imzo: X-Hub-Signature-256: sha256=<hex>, xom tana bo‘yicha (JSON qayta yig‘ilmaydi) */
export function validSignature(raw, header) {
  if (!config.igAppSecret || !header) return false;
  const expected = 'sha256=' + createHmac('sha256', config.igAppSecret).update(raw).digest('hex');
  const a = Buffer.from(String(header)), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function account() {
  const ext = config.igUserId;
  const cur = one(`SELECT * FROM accounts WHERE channel='ig' AND ext_id=?`, ext);
  if (cur) return cur;
  // Yangi akkaunt xavfsiz boshlanadi: «kuzatish» — AI faqat qoralama yozadi
  run(`INSERT INTO accounts(channel,ext_id,name,can_reply,enabled,mode,rollout,created_at) VALUES('ig',?,?,1,1,'kechiksa','kuzatish',?)`,
    ext, me?.username ? `@${me.username}` : `Instagram ${ext}`, now());
  audit('sys', 'Instagram', `Akkaunt ulandi: ${me?.username ? '@' + me.username : ext}`, { result: 'Kuzatish rejimi' });
  return one(`SELECT * FROM accounts WHERE channel='ig' AND ext_id=?`, ext);
}

/* Xabar matni: matn bo‘lmasa turi yoziladi (panelda ham, AI kontekstida ham tushunarli bo‘lsin) */
const KIND = { image: 'photo', media: 'photo', video: 'video', reel: 'video', ig_reel: 'video', audio: 'voice', file: 'document',
  ig_post: 'photo', share: 'photo', story: 'photo', ig_story: 'photo', story_mention: 'photo', sticker: 'photo' };
const LABEL = { image: '[rasm]', media: '[rasm]', video: '[video]', reel: '[reels]', ig_reel: '[reels]', audio: '[ovozli xabar]', file: '[fayl]',
  ig_post: '[post ulashdi]', share: '[post ulashdi]', story: '[story]', ig_story: '[story]', story_mention: '[storysida eslatdi]',
  sticker: '[stiker]', ephemeral: '[yo‘qoluvchi media]' };
function describe(m) {
  if (m.text) return m.text;
  const a = (m.attachments || [])[0];
  // Ulashilgan post/reels izohi bo‘lsa — AI va sotuvchi nima haqidaligini bilsin
  const title = String(a?.payload?.title || '').trim();
  if (a?.type && LABEL[a.type]) return title ? `${LABEL[a.type]} «${clip(title, 300)}»` : LABEL[a.type];
  if (m.is_unsupported) return '[qo‘llab-quvvatlanmaydigan xabar]';
  return '[xabar]';
}
function mediaMeta(m) {
  const a = (m.attachments || [])[0];
  const url = a?.payload?.url;               // «ephemeral» da havola bo‘lmaydi (Meta)
  if (!url) return null;
  const kind = KIND[a.type] || 'document';
  const mime = { photo: 'image/jpeg', video: 'video/mp4', voice: 'audio/mp4', document: 'application/octet-stream' }[kind];
  // story_mention: Meta shartlariga ko‘ra media serverda saqlanmaydi — faqat havola bo‘yicha ko‘rsatiladi
  return { ch: 'ig', kind, url, mime, ...(a.type === 'story_mention' || a.type === 'story' || a.type === 'ig_story' ? { story: true } : {}) };
}
/* Storyga javob: Meta story rasmining havolasini beradi (reply_to.story.url) — AI qaysi story ekanini ko‘rsin (saqlanmaydi, har safar havoladan) */
function storyMeta(m) {
  const url = m.reply_to?.story?.url;
  return url ? { ch: 'ig', kind: 'photo', url, mime: 'image/jpeg', story: true } : null;
}

/* Do‘konning o‘z post/reelslari (caption + muqova rasmi, Instagram API /me/media): mijoz ulashganda AI nima haqida ekanini bilsin.
   Boshqa akkauntlarning reelsiga kirish yo‘q (Instagram loginsiz ochmaydi, oEmbed alohida ruxsat talab qiladi) — ular «[reels]» bo‘lib qoladi.
   Ro‘yxat 10 daqiqa keshlanadi (oxirgi ~300 post). */
let ownMedia = { at: 0, map: new Map() };
export const shortcode = url => String(url || '').match(/instagram\.com\/(?:[\w.]+\/)?(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/)?.[1] || null;
export async function ownMediaIndex() {
  if (Date.now() - ownMedia.at < 10 * 60e3) return ownMedia.map;
  const map = new Map();
  try {
    let url = `${config.igApiBase}/me/media?fields=permalink,caption,media_type,thumbnail_url,media_url&limit=100`;
    for (let page = 0; url && page < 3; page++) {
      const r = await fetch(url, { headers: { authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(15000) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !Array.isArray(j?.data)) break;
      for (const m of j.data) {
        const c = shortcode(m.permalink);
        if (c) map.set(c, { caption: String(m.caption || ''), thumb: m.thumbnail_url || (m.media_type !== 'VIDEO' ? m.media_url : null) || null, type: m.media_type || null });
      }
      url = j.paging?.next || null;
    }
    ownMedia = { at: Date.now(), map };
  } catch (e) { console.error('[instagram] o‘z postlar ro‘yxati olinmadi:', String(e.message || e).slice(0, 120)); ownMedia = { at: Date.now() - 9 * 60e3, map: ownMedia.map }; }
  return ownMedia.map;
}
/* Ulashilgan havola bizning postimiz bo‘lsa — matnga izohi, metaga muqova rasmi qo‘shiladi */
async function enrichShare(text, media, m) {
  const code = media?.url && !media.story ? shortcode(media.url) : null;
  if (!code) return text;
  const own = (await ownMediaIndex()).get(code);
  if (!own) return text;
  media.own = true;
  if (own.thumb) media.thumb = own.thumb;
  const label = LABEL[(m.attachments || [])[0]?.type] || '[post ulashdi]';
  const cap = own.caption.replace(/\s+/g, ' ').trim();
  return !m.text && !String(text).includes('«') && cap ? `${label} «${clip(cap, 300)}»` : text;
}

/* Meta Business Suite’ning o‘z avtojavobi («Assalomu alaykum @user, xabaringiz uchun tashakkur… qo‘ng‘iroq qiling yoki
   telegramdan yozing. Menejer: +998…») mijozning HAR birinchi xabaridan ~4 s keyin aks-sado (is_echo) bo‘lib keladi.
   2026-11-07 gacha u sotuvchi javobi deb olinardi: kutish o‘chirilib, AI qoralamasi bekor bo‘lardi — mijoz faqat
   «qo‘ng‘iroq qiling» matnini olardi (415 ta suhbatdan 10 tasida telefon). Endi u tizim xabari sifatida yoziladi,
   AI o‘z javobini baribir beradi. Avtojavobga ergashgan matnsiz aks-sado (tugma/karta) ham shunga kiradi.
   O‘chirish — Business Suite → Inbox → Automations; bu filtr unga qadar va undan keyin ham xavfsiz. */
const META_AUTO_RE = /xabaringiz\s+uchun\s+(tashakkur|rahmat|raxmat)/i;
const META_AUTO_FOLLOW_MS = 15000;
function isMetaAutoReply(convId, m, ts) {
  if (m.text) return META_AUTO_RE.test(m.text);
  const last = one(`SELECT created_at, json_extract(meta,'$.tag') tag FROM messages WHERE conversation_id=? ORDER BY created_at DESC, id DESC LIMIT 1`, convId);
  return Boolean(last && last.tag === 'Meta avtojavobi' && ts - last.created_at <= META_AUTO_FOLLOW_MS);
}

/* Bitta hodisa: mijoz xabari, bizning javobimiz aks-sadosi (is_echo), o‘chirilgan xabar */
async function onMessaging(ev, acct) {
  // Tahrirlangan xabar (message_edit) — panel tarixi ham yangilanadi, avvalgi matn saqlanadi
  if (ev.message_edit?.mid) {
    const c = one('SELECT id FROM conversations WHERE account_id=? AND ext_chat_id=?', acct.id, String(ev.sender?.id || ''));
    const row = c && one('SELECT id, text, meta FROM messages WHERE conversation_id=? AND ext_msg_id=?', c.id, String(ev.message_edit.mid));
    if (row) {
      const meta = { ...(row.meta ? JSON.parse(row.meta) : {}), edited_at: now() };
      meta.original ??= row.text;
      run('UPDATE messages SET text=?, meta=? WHERE id=?', String(ev.message_edit.text || row.text), JSON.stringify(meta), row.id);
    }
    return;
  }
  const m = ev.message;
  if (!m) return;                                   // read/delivery/reaction hodisalari — e’tiborsiz
  const ts = ev.timestamp || now();
  const peer = m.is_echo ? ev.recipient?.id : ev.sender?.id;
  if (!peer) return;
  const chat = String(peer);

  if (m.is_echo) {
    // Sotuvchi Instagram ilovasidan javob yozdi yoki bizning javobimiz qaytdi
    const c = one('SELECT id FROM conversations WHERE account_id=? AND ext_chat_id=?', acct.id, chat);
    if (!c) return;
    if (m.text && confirmEcho(c.id, m.text, m.mid)) return;             // bizning «noma’lum» javobimiz tasdiqlandi
    if (one('SELECT 1 FROM messages WHERE conversation_id=? AND ext_msg_id=?', c.id, String(m.mid))) return; // allaqachon yozilgan
    if (isMetaAutoReply(c.id, m, ts)) {
      recordAutoMessage(c.id, { text: describe(m), extMsgId: m.mid, ts, via: 'instagram', tag: 'Meta avtojavobi' });
      return;
    }
    markSellerReply(c.id, { text: describe(m), userId: acct.owner_user_id, extMsgId: m.mid, ts, via: 'instagram' });
    return;
  }

  /* Mijoz xabarini o‘chirdi: biz ham butunlay o‘chiramiz.
     2026-10-21 da egasi so‘radi: ilgari xabar «mijoz o‘chirdi» belgisi bilan panelda
     turaverardi — mijoz o‘chirgan narsa bizda qolishi to‘g‘ri emas. Endi yozuv
     bazadan ham olib tashlanadi; kutilayotgan savol qolmasa AI javob yozmaydi. */
  if (m.is_deleted) {
    const c = one('SELECT id FROM conversations WHERE account_id=? AND ext_chat_id=?', acct.id, chat);
    const row = c && one('SELECT id FROM messages WHERE conversation_id=? AND ext_msg_id=?', c.id, String(m.mid));
    if (row) run('DELETE FROM messages WHERE id=?', row.id);
    if (c) clientDeleted(c.id);
    return;
  }

  const media = mediaMeta(m) || storyMeta(m);
  let text = describe(m);
  if (m.reply_to?.story) text = m.text ? `[storyga javob] ${m.text}` : ((m.attachments || []).length ? text : '[storyga javob]');
  text = await enrichShare(text, media, m).catch(() => text);
  const conv = ingestClient(acct, {
    extChatId: chat, extUserId: chat, handle: null, name: null,
    text, extMsgId: m.mid, ts,
    meta: media ? { media, ...(m.reply_to?.story ? { story_reply: true } : {}) } : (m.reply_to?.story ? { story_reply: true } : null)
  });
  // Ovoz bo‘lsa — matnga aylantiriladi; shunda agent javob yoza oladi (ilgari IG ovozlari matnsiz qolardi)
  if (conv && media && (media.kind === 'voice' || media.kind === 'audio') && aiOn(acct)) igTranscribeLater(conv.id, m.mid, media).catch(() => {});
  // «Ko‘rildi» xabar kelganda qo‘yilmaydi — faqat javob haqiqatda yuborilganda (sendInstagram). Aks holda AI o‘chirilsa
  // yoki qoralama bekor bo‘lsa, mijoz «ko‘rildi»ni ko‘rib javobsiz qolardi; sotuvchiga esa xabar o‘qilmagan bo‘lib turadi.
  await fillProfile(acct.id, chat).catch(() => {});
}

/* Mijoz profili (User Profile API): ism va @username — faqat bizga yozgan mijozniki o‘qiladi */
export async function igProfile(igsid) {
  const res = await fetch(`${config.igApiBase}/${encodeURIComponent(igsid)}?fields=name,username`, {
    headers: { authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(10000)
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j) return null;
  return { name: j.name || null, handle: j.username ? '@' + j.username : null };
}

/* Mijozning profil rasmi — panel ro‘yxatida bosh harflar o‘rniga (services/avatar.js saqlaydi: Instagram havolasi bir necha kunda
   eskiradi). Rasm yo‘q — null; Instagram xatosi — throw (status va Instagram xato kodi bilan: limit xatosi vaqtinchalik). */
export async function igProfilePic(igsid) {
  if (!token()) return null;
  const res = await fetch(`${config.igApiBase}/${encodeURIComponent(igsid)}?fields=profile_pic`, {
    headers: { authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(10000)
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(`Instagram profili: HTTP ${res.status} ${String(j?.error?.message || '').slice(0, 80)}`), { status: res.status, igCode: j?.error?.code });
  if (!j?.profile_pic) return null;
  const img = await fetch(j.profile_pic, { signal: AbortSignal.timeout(20000) });
  if (!img.ok) throw Object.assign(new Error(`profil rasmi yuklanmadi: HTTP ${img.status}`), { status: img.status });
  return Buffer.from(await img.arrayBuffer());
}

/* Ismsiz suhbatga profil yoziladi; xato bo‘lsa jim — mijozning keyingi xabarida qayta uriniladi */
async function fillProfile(accountId, chat) {
  const c = one('SELECT id FROM conversations WHERE account_id=? AND ext_chat_id=? AND handle IS NULL AND display_name IS NULL', accountId, chat);
  if (!c) return;
  const p = await igProfile(chat);
  if (p && (p.name || p.handle)) run('UPDATE conversations SET handle=COALESCE(handle,?), display_name=COALESCE(display_name,?) WHERE id=?', p.handle, p.name || p.handle, c.id);
}

/* Ish boshida: ismsiz qolgan Instagram suhbatlari to‘ldiriladi */
async function backfillProfiles() {
  const rows = all(`SELECT c.account_id, c.ext_chat_id FROM conversations c JOIN accounts a ON a.id=c.account_id
                    WHERE a.channel='ig' AND c.is_demo=0 AND c.handle IS NULL AND c.display_name IS NULL LIMIT 50`);
  for (const r of rows) await fillProfile(r.account_id, r.ext_chat_id).catch(() => {});
}

/* typing_on / mark_seen — alohida so‘rov sifatida yuboriladi (Meta talabi: message bilan birga bo‘lmaydi) */
export async function senderAction(igsid, action) {
  if (!igReady()) return false;
  const res = await fetch(`${config.igApiBase}/${config.igUserId}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token()}` },
    body: JSON.stringify({ recipient: { id: String(igsid) }, sender_action: action }), signal: AbortSignal.timeout(10000)
  });
  return res.ok;
}



/* Ovozli xabar — matnga. Telegram'da bu ishlaydi, Instagram'da umuman yo‘q edi: shuning uchun IG ovozlariga
   agent javob bera olmasdi. Matn tayyor bo‘lguncha qoralama kutib turadi (STT_WAIT), keyin darhol tayyorlanadi. */
/* Transkripsiya uchun qo'shimcha kutish. 150 s edi — o'lchovda Gemini 2–7 soniyada aylantiradi, shuning uchun
   mijoz behuda 2,5 daqiqa kutardi. Endi 30 s shift va asosiysi: aylantirish tugashi bilan hisob o'z joyiga qaytariladi. */
const IG_STT_WAIT = 30000;
async function igTranscribeLater(convId, extMsgId, media) {
  if (!sttReady()) return;
  scheduleDraft(convId, IG_STT_WAIT);
  run('UPDATE conversations SET ai_due_at=MAX(ai_due_at, ?) WHERE id=? AND ai_due_at IS NOT NULL', now() + IG_STT_WAIT, convId);
  try {
    const { fetchMedia } = await import('../services/media.js');
    const buf = await fetchMedia(media);
    const r = await transcribe(buf, media.mime || 'audio/mp4');
    const msg = one('SELECT id, meta FROM messages WHERE conversation_id=? AND ext_msg_id=?', convId, String(extMsgId));
    if (msg && r.text) {
      run('UPDATE messages SET text=?, meta=? WHERE id=?', `[ovozli xabar] ${r.text}`,
        JSON.stringify({ ...(jparse(msg.meta, {}) || {}), transcript: { text: r.text, lang: r.lang || null, ms: r.ms || null, via: r.via || null } }), msg.id);
      audit('sys', 'Nutq', 'Ovozli xabar matnga aylantirildi', { object: `conv:${convId}`, result: `Instagram · ${r.via === 'gemini' ? 'Gemini' : 'Whisper'} · ${Math.round((r.ms || 0) / 1000)} s` });
    } else if (r.skipped) audit('sys', 'Nutq', 'Ovozli xabar aylantirilmadi', { object: `conv:${convId}`, result: `Instagram · ${r.skipped}` });
  } catch (e) {
    audit('sys', 'Nutq', 'Ovozli xabarni aylantirishda xato', { object: `conv:${convId}`, result: `Instagram · ${String(e.message || e).slice(0, 180)}` });
  } finally {
    // Matn tayyor — kutishni o'z joyiga qaytaramiz: endi qo'shimcha vaqt kerak emas (aks holda hisob
    // IG_STT_WAIT gacha cho'zilib turardi va mijoz javobni ortiqcha kutardi).
    const T = getSettings().T_seconds * 1000;
    run(`UPDATE conversations SET ai_due_at=MAX(?, MIN(ai_due_at, pending_since + ?))
           WHERE id=? AND ai_due_at IS NOT NULL AND pending_since IS NOT NULL`, now() + 5000, T, convId);
    scheduleDraft(convId, 0);
  }
}

/* ---------- Instagram izohlari ----------
   Mijoz post ostida «narxi qancha», «+», «qoldiring» deb yozadi. Javob ochiq izohga emas, SHAXSIYGA ketadi:
   Meta buni qo‘llab-quvvatlaydi (private reply — recipient.comment_id), lekin bitta izohga FAQAT BITTA marta va 7 kun ichida.
   Shuning uchun har izoh kv da belgilanadi. Shaxsiy xabar ketgach suhbat odatdagidek ochiladi va agent o‘z ishini qiladi. */
/* Emoji (teri rangi, birlashtiruvchi, variant belgisi bilan). \p{Emoji_Component} ISHLATILMAYDI — u 0–9 raqamlarni ham yutadi:
   «ZV E 10» → «ZV E» bo‘lib qolardi (2026-10-08) */
const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}\u{20E3}]/gu;
/* Faqat maqtov yoki rahmat — javob kerak emas (savol belgisi yoki raqam bo‘lsa javob beriladi) */
const PRAISE = new Set(['zor', 'zo‘r', 'ajoyib', 'super', 'klass', 'class', 'top', 'rahmat', 'raxmat', 'barakalla',
  'molodec', 'xop', 'yaxshi', 'go‘zal', 'gozal', 'молодец', 'супер', 'класс', 'спасибо', 'отлично', 'красиво', 'ok', 'okay']);
const praiseOnly = t => {
  const bare = t.replace(/@[\w.]+/g, ' ').replace(EMOJI, ' ');
  if (/[?\d]/.test(bare)) return false;                       // savol yoki raqam bor — javob beriladi
  const words = bare.toLowerCase().replace(/[^\p{L}\s‘']/gu, ' ').split(/\s+/).filter(Boolean);
  return words.length > 0 && words.length <= 3 && words.every(w => PRAISE.has(w));
};
/* Reklama «izohga 7 yozing» deydi — bitta raqam ham javobga arziydi (ilgari bir belgili izoh e’tiborsiz qolardi,
   faqat «+» o‘tardi va butun kampaniya javobsiz ketardi). Kod: faqat raqam va/yoki «+», 12 belgigacha. */
const CODE = /^[+\d\s]{1,12}$/;
/* Kampaniya kodi: raqam/«+» — har doim; qolgani (qisqa so‘z, harf, emoji) sozlamadan: IG_COMMENT_CODES */
const isCampaignCode = s => CODE.test(s) || config.igCommentCodes.includes(String(s).toLowerCase());
const EMOJI_ONLY = /^[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}\u{20E3}\s\u2000-\u3300]*$/u;

/* Post sarlavhasidan mahsulot nomi: birinchi qator, tiredan oldingi qismi; emoji olib tashlanadi */
async function mediaTitle(mediaId) {
  if (!mediaId) return null;
  try {
    const r = await fetch(`${config.igApiBase}/${mediaId}?fields=caption`, {
      headers: { authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(10000)
    });
    const j = await r.json().catch(() => null);
    const line = String(j?.caption || '').split('\n')[0].split('—')[0].split(' - ')[0];
    const name = line.replace(EMOJI, '').trim();
    return name.length > 3 ? clip(name, 70) : null;
  } catch { return null; }
}

/* Izohga javob matni: post sarlavhasidagi tovar katalogda (BILLZ) topilsa — darhol narxi va bor-yo‘qligi bilan
   (ilgari «narxni shu yerda aytamiz» deb qo‘yardi — mijoz yana kutardi). Ruscha izohga — ruscha. */
export async function commentReply(text, title) {
  const ru = /[а-яё]/i.test(text) && !/[ўқғҳ]/i.test(text);
  let found = null;
  if (title) { try { const { searchProducts } = await import('../services/catalog.js'); found = searchProducts(title, 1, { inStock: true })[0] || null; } catch {} }
  const b = found?.billz;
  if (b && b.price != null && !b.stale && b.stock_total > 0) {
    const usd = b.currency === 'USD', fmt = n => `${n}${usd ? '$' : ' so‘m'}`, price = fmt(b.price);
    const name = String(found.name).split(' — ')[0].trim();
    const note = usd ? (ru ? ' (оплата принимается в национальной валюте)' : ' (savdo milliy valyutada qabul qilinadi)') : '';
    // BILLZ aksiyasi hamma do‘konda bo‘lsa — aksiya narxi, odatiy narx bilan. Faqat ayrim do‘konda bo‘lsa — oddiy narx (tafsilotni suhbatda AI aytadi)
    const a = b.promo_info && !b.promo_info.partial ? b.promo_info : null;
    if (a) return ru ? `Здравствуйте! ${name} сейчас по акции: ${fmt(a.price)}${note}, обычная цена ${price}. Есть в наличии, если есть вопросы, пишите здесь.`
      : `Assalomu alaykum! ${name} hozir aksiyada: ${fmt(a.price)}${note}, odatiy narxi ${price}. Do‘konda bor, savol bo‘lsa shu yerga yozing.`;
    return ru ? `Здравствуйте! ${name} — ${price}${note}, есть в наличии. Если есть вопросы, пишите здесь.`
      : `Assalomu alaykum! ${name} narxi ${price}${note}, do‘konda bor. Savol bo‘lsa shu yerga yozing.`;
  }
  const tpl = ru ? `Здравствуйте! Увидели ваш комментарий${title ? ` про ${title}` : ''} — ответим здесь, напишите, какой вариант нужен.`
    : `Assalomu alaykum! Izohingizni ko‘rdik${title ? `, ${title} bo‘yicha` : ''} — shu yerda javob beramiz, qanday variant kerakligini yozing.`;
  return (await geminiComment(text, title, ru, isCampaignCode(text.replace(/@[\w.]+/g, '').trim()))) || tpl;
}

/* Katalogda tovar topilmagan izoh — javobni Gemini yozadi (matnli suhbat Claude’da qolaveradi):
   shablon hamma izohga bir xil javob berardi, mijoz nima so‘raganiga tegmasdi. Narx va qoldiq bu yerda
   yo‘q — shuning uchun raqam aytish qat’iy taqiqlanadi, tafsilot shaxsiy suhbatda aniqlanadi.
   Gemini kaliti yo‘q yoki xato bersa — eski shablon ishlaydi (javobsiz qolmaydi). O‘chirish: AI_COMMENTS=off */
const IZOH_SYS = `Siz SUN-HIGHTECH (quyosh panellari, inverter, akkumulyator; 2009 yildan, O‘zbekiston) Instagram sahifasining javob yozuvchisisiz.
Mijoz post ostiga izoh qoldirdi. Siz unga SHAXSIY xabar matnini yozasiz — u ochiq izohga emas, Direct’ga boradi.

Qoidalar:
- 1–2 gap, iliq va sodda. Salomlashing.
- Mijoz nima so‘raganiga aniq tegib o‘ting — umumiy javob yozmang.
- HECH QANDAY raqam aytmang: narx, qoldiq, muddat, quvvat, kafolat — bularni bilmaysiz.
- Va’da bermang. Suhbatni davom ettirishga chaqiring (masalan: obyekt qayerda, quvvati qancha kerak).
- Emoji ishlatmang, hashtag yozmang, imzo qo‘ymang.
- Faqat javob matnini qaytaring, boshqa hech narsa.`;
async function geminiComment(text, title, ru, isCode = false) {
  if (config.aiComments === 'off' || !geminiReady()) return null;
  try {
    const { knowledgePrompt } = await import('../services/bilim.js');
    const kb = knowledgePrompt();
    const r = await geminiAgent({
      system: IZOH_SYS + (kb ? `

Kompaniya haqida ma’lum faktlar:
${kb}` : ''),
      userContent: `${title ? `Post: ${title}\n` : ''}Izoh: ${text}\n`
        + (isCode ? '\nBu izoh — reklamadagi kod (masalan «7» yoki «+»): mijoz savol bermadi, shunchaki qiziqqanini bildirdi.'
          + ' Shuning uchun post mavzusidan kelib chiqib o‘zingiz boshlang va unga nima kerakligini so‘rang.' : '')
        + `\nJavobni ${ru ? 'rus' : 'o‘zbek'} tilida yozing.`,
      maxTokens: 1200, maxTurns: 0   /* 300 kam edi: 3.6-flash o'ylash tokenlarini ham shu hisobdan yeydi (max_tokens xatosi) */
    });
    const out = clip(String(r?.text || '').replace(/\s+/g, ' ').trim(), 400);
    return out || null;
  } catch (e) { console.error('[instagram] izoh javobi Gemini’da yozilmadi:', String(e.message || e).slice(0, 120)); return null; }
}
/* Shaxsiy javob ketgach suhbat panelda ochiladi: izoh — mijoz xabari, javobimiz — AI xabari. Mijoz DM’da davom ettirsa,
   agentda kontekst bo‘ladi (qaysi post, nima so‘ragan). Kutish qo‘yilmaydi — Meta qoidasi: izohga faqat bitta shaxsiy javob. */
function recordCommentThread(acct, { igsid, cid, fromName, text, title, reply }) {
  if (!igsid) return;
  try {
    const ts = now();
    const c = upsertConversation(acct, { extChatId: String(igsid), extUserId: String(igsid), handle: fromName ? '@' + fromName : null, name: null, ts });
    run('INSERT OR IGNORE INTO messages(conversation_id,author,text,ext_msg_id,meta,created_at) VALUES(?,?,?,?,?,?)',
      c.id, 'client', `[izoh${title ? ` · ${title}` : ''}] ${text}`, `igc-${cid}`, JSON.stringify({ via: 'instagram', comment: true }), ts);
    run('INSERT OR IGNORE INTO messages(conversation_id,author,text,ext_msg_id,meta,created_at) VALUES(?,?,?,?,?,?)',
      c.id, 'ai', reply, `igc-${cid}-r`, JSON.stringify({ tag: 'izohga shaxsiy javob' }), ts + 1);
    run('UPDATE conversations SET last_msg_at=?, last_client_at=?, last_ai_at=?, archived=0 WHERE id=?', ts + 1, ts, ts + 1, c.id);
  } catch (e) { console.error('[instagram] izoh suhbati yozilmadi:', String(e.message || e).slice(0, 120)); }
}

/* Shaxsiy javob: izoh ostidan DM ochiladi */
async function privateReply(commentId, text) {
  const r = await fetch(`${config.igApiBase}/${config.igUserId}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token()}` },
    body: JSON.stringify({ recipient: { comment_id: String(commentId) }, message: { text } }),
    signal: AbortSignal.timeout(20000)
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error?.message || `Meta ${r.status}`);
  return j;
}

/* Izoh ostiga ochiq qisqa javob — mijoz Direct’ni ochishi uchun: «@user direktingizga javob berdik».
   Shaxsiy xabar ketgandan keyin yoziladi: boshqalar ham savol berilsa javob borligini ko‘rsin. */
async function publicReply(commentId, text) {
  const r = await fetch(`${config.igApiBase}/${commentId}/replies`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token()}` },
    body: JSON.stringify({ message: text }),
    signal: AbortSignal.timeout(20000)
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j?.error?.message || `Meta ${r.status}`);
  return j;
}

async function onComment(v, acct) {
  const cid = String(v?.id || ''), text = String(v?.text || '').trim();
  const fromId = String(v?.from?.id || ''), fromName = String(v?.from?.username || '').trim();
  if (!cid || !text) return;
  if (fromId && fromId === String(config.igUserId)) return;                       // o‘z izohimiz
  if (me?.username && fromName.toLowerCase() === String(me.username).toLowerCase()) return;
  if (kvGet(`ig_comment:${cid}`)) return;                                         // bir izohga bir marta (Meta qoidasi)
  kvSet(`ig_comment:${cid}`, now());
  const bare = text.replace(/@[\w.]+/g, '').trim();
  // «+», «++» yoki reklamadagi kod («izohga 7 yozing») — mijoz qiziqdi: javobsiz qolmasin. Qolgan bir belgili izohlar e’tiborsiz.
  if (!isCampaignCode(bare) && (EMOJI_ONLY.test(text) || bare.length < 2)) return;
  if (!isCampaignCode(bare) && praiseOnly(text)) return;                                                   // faqat maqtov yoki rahmat
  if (kvGet('ig_comments_off')) return;                                           // favqulodda to‘xtatish

  if (!aiOn(acct)) {                       // AI to‘xtatilgan — javob yozilmaydi, lekin izoh yo‘qolmasin
    audit('sys', 'Instagram', 'Izoh keldi (AI o‘chiq — javob yozilmadi)', { data: clip(text, 200), result: fromName ? '@' + fromName : '' });
    return;
  }
  const title = await mediaTitle(v?.media?.id);
  const msg = await commentReply(text, title);
  try {
    const sent = await privateReply(cid, msg);
    audit('ai', 'Instagram', 'Izohga shaxsiy javob yuborildi', { data: clip(text, 200), result: `${fromName ? '@' + fromName + ' · ' : ''}${clip(msg, 90)}` });
    recordCommentThread(acct, { igsid: sent?.recipient_id, cid, fromName, text, title, reply: msg });
    // Ochiq javob — shaxsiy xabar ketgandagina. Yiqilsa suhbat baribir ochilgan bo‘ladi, shuning uchun jim o‘tiladi.
    try { await publicReply(cid, fromName ? `@${fromName} direktingizga javob berdik ✅` : 'Direktingizga javob berdik ✅'); }
    catch (e2) { audit('sys', 'Instagram', 'Izohga ochiq javob yozilmadi', { result: String(e2.message || e2) }); }
  } catch (e) {
    audit('sys', 'Instagram', 'Izohga shaxsiy javob yuborilmadi', { data: clip(text, 200), result: String(e.message || e) });
  }
}

/* Meta bir so‘rovda bir nechta hodisa yuboradi; bittasi xato bersa qolganlari to‘xtamaydi */
export async function handleWebhook(body) {
  if (!igReady()) return { handled: 0 };
  const acct = account();
  let handled = 0;
  for (const entry of body?.entry || []) {
    for (const ev of entry.messaging || []) {
      try { await onMessaging(ev, acct); handled++; }
      catch (e) { console.error('[instagram] event', e); audit('sys', 'Instagram', 'Xabarni qayta ishlab bo‘lmadi', { result: String(e.message || e) }); }
    }
    for (const ch of entry.changes || []) {
      try { ch.field === 'comments' ? await onComment(ch.value, acct) : await onMessaging(ch.value, acct); handled++; }
      catch (e) { console.error('[instagram] change', e); audit('sys', 'Instagram', 'Hodisani qayta ishlab bo‘lmadi', { result: String(e.message || e) }); }
    }
  }
  return { handled };
}

/* Javob yuborish. Xato bo‘lsa: tarmoq uzilsa — «noma’lum» (aks-sado kelsa tasdiqlanadi), aks holda aniq xato. */
/* Rasm yuborish: Instagram faylni emas, OCHIQ havolani qabul qiladi. Rasm xotirada 1 soat saqlanib, tasodifiy kalitli havola beriladi
   (GET /media/o/<kalit> — web.js). Yozuv (izoh) alohida xabar bo‘lib ketadi: Instagram bir xabarda rasm + matn bermaydi. */
const outImages = new Map();
export function outImage(key) {
  const t = Date.now();
  for (const [k, v] of outImages) if (v.exp < t) outImages.delete(k);
  const v = outImages.get(key);
  return v && v.exp >= t ? v : null;
}
export async function sendInstagramImage(acct, conv, { buf, mime }, caption = '', opts = {}) {
  if (!/^image\/(jpeg|png|gif)$/.test(mime)) throw new Error('Instagram faqat JPEG, PNG yoki GIF rasm qabul qiladi');
  if (!/^https:\/\//.test(config.publicUrl) || /localhost|127\.0\.0\.1/.test(config.publicUrl)) throw new Error('Instagram’ga rasm yuborish uchun ochiq https PUBLIC_URL kerak (serverda ishlaydi)');
  const key = randomBytes(24).toString('hex');
  outImages.set(key, { buf, mime, exp: Date.now() + 3600e3 });
  const res = await fetch(`${config.igApiBase}/${config.igUserId}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token()}` },
    body: JSON.stringify({ recipient: { id: String(conv.ext_chat_id) }, message: { attachment: { type: 'image', payload: { url: `${config.publicUrl}/media/o/${key}` } } },
      ...(opts.replyTo ? { reply_to: { mid: String(opts.replyTo) } } : {}) }),
    signal: AbortSignal.timeout(30000)
  }).catch(e => { throw Object.assign(new Error(e.name === 'TimeoutError' ? 'Instagram javob bermadi (30 s)' : 'Instagram bilan aloqa yo‘q'), { uncertain: true }); });
  const j = await res.json().catch(() => null);
  if (!res.ok) { const err = j?.error || {}; const e = new Error(`Instagram: ${err.message || `HTTP ${res.status}`}`); e.code = err.code; e.uncertain = res.status >= 500; throw e; }
  const mid = j?.message_id || null;
  if (caption) await sendInstagram(acct, conv, caption).catch(() => {});
  return mid;
}

/* Ovozli xabar: rasm bilan bir xil yo'l — fayl xotirada turadi, Meta ochiq havoladan o'zi yuklab oladi.
   Instagram MP3 ni oladi (OGG/Opus emas — Telegram uchun u yerda alohida tayyorlanadi). */
export async function sendInstagramAudio(acct, conv, { buf, mime }, opts = {}) {
  if (!/^https:\/\//.test(config.publicUrl) || /localhost|127\.0\.0\.1/.test(config.publicUrl)) throw new Error('Instagram’ga ovoz yuborish uchun ochiq https PUBLIC_URL kerak');
  const key = randomBytes(24).toString('hex');
  outImages.set(key, { buf, mime: mime || 'audio/mpeg', exp: Date.now() + 3600e3 });
  const res = await fetch(`${config.igApiBase}/${config.igUserId}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token()}` },
    body: JSON.stringify({ recipient: { id: String(conv.ext_chat_id) }, message: { attachment: { type: 'audio', payload: { url: `${config.publicUrl}/media/o/${key}` } } },
      ...(opts.replyTo ? { reply_to: { mid: String(opts.replyTo) } } : {}) }),
    signal: AbortSignal.timeout(30000)
  }).catch(e => { throw Object.assign(new Error(e.name === 'TimeoutError' ? 'Instagram javob bermadi (30 s)' : 'Instagram bilan aloqa yo‘q'), { uncertain: true }); });
  const j = await res.json().catch(() => null);
  if (!res.ok) { const err = j?.error || {}; const e = new Error(`Instagram: ${err.message || `HTTP ${res.status}`}`); e.code = err.code; throw e; }
  return j?.message_id || null;
}

export async function sendInstagram(acct, conv, text, opts = {}) {
  const url = `${config.igApiBase}/${config.igUserId}/messages`;
  // Mijoz «ko‘rildi»ni javob bilan birga ko‘radi (AI ham, paneldan sotuvchi ham shu yerdan yuboradi)
  senderAction(conv.ext_chat_id, 'mark_seen').catch(() => {});
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token()}` },
      body: JSON.stringify({ recipient: { id: String(conv.ext_chat_id) }, message: { text: clipBytes(String(text), 1000) }, ...(opts.replyTo ? { reply_to: { mid: String(opts.replyTo) } } : {}) }),
      signal: AbortSignal.timeout(20000)
    });
  } catch (e) {
    throw Object.assign(new Error(e.name === 'TimeoutError' ? 'Instagram javob bermadi (20 s)' : 'Instagram bilan aloqa yo‘q'), { uncertain: true });
  }
  const j = await res.json().catch(() => null);
  if (!res.ok) {
    const err = j?.error || {};
    const e = new Error(`Instagram: ${err.message || `HTTP ${res.status}`}${err.code ? ` (${err.code}${err.error_subcode ? '/' + err.error_subcode : ''})` : ''}`);
    e.code = err.code; e.subcode = err.error_subcode; e.uncertain = res.status >= 500;
    throw e;
  }
  return j?.message_id || null;
}

export const igRunning = () => igReady() && Boolean(config.igAppSecret);
