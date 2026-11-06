import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, config } from '../config.js';
import { one, all, run, kvGet, kvSet } from '../db.js';
import { now, esc, clip } from '../util.js';
import { audit } from '../core/audit.js';

/*
  Instagram ulash yordamchisi — bot ichida (deep link: https://t.me/<bot>?start=meta).
  Egasi «start» bosadi → qo‘llanma videosi va 6 qadam tugmalari; savol yozsa — rahbarga vazifa va Telegram xabari.
  Mijoz va xodim oqimlariga tegmaydi: faqat «meta» payload bilan ochiladi.
*/
const VIDEO = join(ROOT, 'assets', 'instagram-qollanma.mp4');
const HOOK = `${config.publicUrl}/webhook/instagram`;

export const STEPS = [
  { b: '1 · Professional akkaunt', t: `<b>1. Professional akkaunt</b>\nInstagram ilovasida: <b>Settings → Account type and tools → Switch to professional account</b> → <b>Business</b>.\n\nShaxsiy akkauntda Direct API umuman ishlamaydi.` },
  { b: '2 · Xabarlarga ruxsat', t: `<b>2. Xabarlarga ruxsat</b>\nInstagram ilovasida: <b>Settings → Messages and story replies → Message controls → Connected tools → Allow access to messages</b> — yoqing.\n\n⚠️ Bu tugma o‘chiq bo‘lsa xabarlar kelmaydi va hech qanday xato ko‘rsatilmaydi.` },
  { b: '3 · Biznesni tasdiqlash', t: `<b>3. Biznesni tasdiqlash (Business Verification)</b>\n<b>business.facebook.com</b> → Photobuy biznes portfoliosini oching → <b>Settings → Security center → Business verification</b>.\nKerak: firma guvohnomasi, yuridik nom, manzil, telefon, sayt (photobuy.uz).\n\nMeta 2–14 kunda tekshiradi. Bu bo‘lmasa, mijozlar xabari ilovaga kelmaydi.` },
  { b: '4 · Meta ilovasi', t: `<b>4. Meta ilovasini yaratish</b>\n<b>developers.facebook.com</b> → My Apps → <b>Create App</b> → turi <b>Business</b> → nom: «Photobuy Sotuv» → 3-qadamdagi biznes portfoliosiga biriktiring.\n\nIlovaga <b>Instagram</b> mahsulotini qo‘shing → <b>API setup with Instagram login</b>.` },
  { b: '5 · Ilova sozlamalari', t: `<b>5. Ilova sozlamalari</b>\n<b>App settings → Basic</b>:\n• Privacy Policy URL: <code>${config.publicUrl}/maxfiylik</code>\n• User data deletion URL: <code>${config.publicUrl}/malumot-ochirish</code>\n• App icon (1024×1024) va Category: Business\n\nUlarsiz ilova «Live» bo‘lmaydi.` },
  { b: '6 · Token va serverga kiritish', t: `<b>6. Token olish va serverga kiritish</b>\nInstagram → API setup → <b>Generate token</b> → Photobuy Instagram akkaunti bilan kiring.\nUchta qiymat kerak: <b>access token</b>, <b>Instagram user ID</b>, <b>App secret</b> (App settings → Basic → Show).\n\nServerda:\n<code>ssh -t root@81.85.51.93 'bash /opt/sales/app/deploy/sozla.sh instagram'</code>\nSkript «verify token» beradi — 7-qadamda kerak.\n⚠️ Token va secret chatga, Telegramga yoki pochtaga yozilmaydi.` },
  { b: '7 · Webhook', t: `<b>7. Webhook ulash</b>\nInstagram → <b>Configure webhooks</b>:\nCallback URL: <code>${HOOK}</code>\nVerify token: 6-qadamda chiqqan qiymat\nMaydonlar: <code>messages, messaging_postbacks, messaging_seen</code>\n\n«Verify and save» bosilganda yashil belgi chiqishi kerak.` },
  { b: '8 · Meta imtihoni', t: `<b>8. App Review (Meta imtihoni)</b>\nApp Review → Permissions → <b>instagram_business_basic</b> va <b>instagram_business_manage_messages</b> uchun <b>Advanced access</b> so‘rang.\nMeta ko‘rmoqchi: qisqa video — mijoz Instagram’da yozadi → xabar panelda chiqadi → javob Instagram’ga boradi; va qisqa izoh.\n\n3–10 kun. Video va izohni dasturchi tayyorlab beradi.` },
  { b: '9 · Live rejim', t: `<b>9. Ilovani «Live» qilish</b>\nImtihondan o‘tgach, Dashboard tepasidagi <b>App Mode</b>: Development → <b>Live</b>.\n\nMeta: webhook xabarlari faqat Live ilovaga keladi.` },
  { b: '✅ Tekshirish', t: `<b>Tekshirish</b>\nBoshqa Instagram akkauntdan Photobuy’ga DM yozing — xabar panelning «Suhbatlar» bo‘limida «Instagram» belgisi bilan chiqadi va AI Telegram’dagidek javob beradi.\n\nChiqmasa: 2-qadamdagi tugma, 9-qadam (Live) va tokenni tekshiring.\nPanel: ${config.publicUrl}` }
];

const menu = () => ({ inline_keyboard: [
  ...[[0, 1], [2, 3], [4, 5], [6, 7], [8]].map(r => r.map(i => ({ text: STEPS[i].b, callback_data: `meta:${i}` }))),
  [{ text: STEPS[9].b, callback_data: 'meta:9' }],
  [{ text: '❓ Savolim bor', callback_data: 'meta:ask' }]
] });

const K = id => `meta_help:${id}`;
export const waitingQuestion = chatId => kvGet(K(chatId)) === 'ask';

/* Video bir marta yuklanadi — keyin Telegram file_id qayta ishlatiladi */
async function sendGuideVideo(tg, chatId, file = VIDEO, key = 'meta_video_file_id', caption = 'Instagram Direct’ni Photobuy paneliga ulash — video (asosiy qadamlar). To‘liq ro‘yxat — pastdagi 9 ta tugmada.') {
  const cached = kvGet(key);
  if (cached) return tg('sendVideo', { chat_id: chatId, video: cached, caption }).catch(() => null);
  if (!existsSync(file)) return null;
  const fd = new FormData();
  fd.append('chat_id', String(chatId));
  fd.append('caption', caption);
  fd.append('supports_streaming', 'true');
  fd.append('video', new Blob([readFileSync(file)], { type: 'video/mp4' }), 'photobuy-qollanma.mp4');
  const res = await fetch(`https://api.telegram.org/bot${config.tgToken}/sendVideo`, { method: 'POST', body: fd, signal: AbortSignal.timeout(120000) }).catch(() => null);
  const j = await res?.json().catch(() => null);
  const id = j?.result?.video?.file_id;
  if (id) kvSet(key, id);
  return j?.result || null;
}

export async function metaStart(tg, chatId) {
  kvSet(K(chatId), 'menu');
  audit('sys', 'Photobuy boti', 'Instagram yordamchisi ochildi', { object: `chat:${chatId}` });
  await sendGuideVideo(tg, chatId);
  return tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', reply_markup: menu(),
    text: `<b>Instagram’ni panelga ulash</b>\nHar bir qadamni tugmadan oching — matnni nusxalab olsa bo‘ladi.\n\nIlova faqat Photobuy’ning o‘z akkaunti bilan ishlaydi, shuning uchun Meta tekshiruvi (App Review) talab qilinmaydi.` });
}

export async function metaCallback(tg, q, arg) {
  const chatId = q.message.chat.id;
  if (arg === 'ask') {
    kvSet(K(chatId), 'ask');
    await tg('sendMessage', { chat_id: chatId, text: 'Savolingizni yozing — sotuv rahbariga yetkazaman va javobini shu yerga yuboraman.' });
    return 'Yozing';
  }
  const i = Number(arg);
  if (!(i >= 0 && i < STEPS.length)) return 'Topilmadi';
  await tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', text: STEPS[i].t, reply_markup: menu(), disable_web_page_preview: true });
  return STEPS[i].b;
}

/* Savol: rahbarga vazifa + Telegram xabari. Soatiga 5 tadan ko‘p emas. */
export async function metaQuestion(tg, chatId, from, text) {
  kvSet(K(chatId), 'menu');
  const hk = `meta_ask_count:${chatId}`;
  const c = JSON.parse(kvGet(hk) || '{"n":0,"at":0}');
  const fresh = now() - c.at < 3600e3 ? c : { n: 0, at: now() };
  if (fresh.n >= 5) return tg('sendMessage', { chat_id: chatId, text: 'Savollar ko‘p bo‘lib ketdi — bir soatdan keyin yana yozing yoki to‘g‘ridan-to‘g‘ri rahbarga murojaat qiling.' });
  kvSet(hk, JSON.stringify({ n: fresh.n + 1, at: fresh.at }));

  const who = [from?.first_name, from?.last_name].filter(Boolean).join(' ') || from?.username || `chat ${chatId}`;
  const q = clip(text, 700);
  run(`INSERT INTO tasks(kind,title,body,due_at,status,created_by,created_at) VALUES('meta_help',?,?,?,'open','Photobuy boti',?)`,
    `Instagram ulash: ${clip(who, 40)} savol berdi`, `${q}\n\nJavob berish: scripts/ig-javob.js ${chatId} "matn"`, now(), now());
  audit('sys', 'Photobuy boti', `Instagram yordamchisi: savol (${who})`, { data: q, object: `chat:${chatId}` });
  const { sendStaff } = await import('./telegram.js');
  for (const u of all(`SELECT * FROM users WHERE active=1 AND role IN ('admin','rahbar') AND tg_chat_id IS NOT NULL`))
    await sendStaff(u, `<b>Instagram ulash bo‘yicha savol</b>\n${esc(who)}:\n${esc(q)}\n\nJavob: <code>scripts/ig-javob.js ${chatId} "matn"</code>`).catch(() => {});
  return tg('sendMessage', { chat_id: chatId, text: 'Savolingiz yetkazildi. Javob shu yerga keladi.' });
}

/* ---------- Telegram Business ulash qo‘llanmasi (deep link: ?start=telegram) ---------- */
const TG_VIDEO = join(ROOT, 'assets', 'telegram-qollanma.mp4');
/* Bot nomi almashsa matn ham o‘zgarsin — nom bazadan olinadi (import halqasi bo‘lmasin uchun kvGet) */
const BOT = () => '@' + (kvGet('tg_bot_username') || 'photobuysotuvchibot');
export const tgSteps = () => [
  { b: '1 · Business Mode', t: `<b>1. Botda Business rejimi</b>\nIstalgan telefondan <b>@BotFather</b> ga kiring:\n<b>/mybots → ${BOT()} → Bot Settings → Business Mode → Turn on</b>\n\nBu yoqilmasa, keyingi qadamda bot ro‘yxatda ko‘rinmaydi.` },
  { b: '2 · Akkauntga ulash', t: `<b>2. Botni akkauntga ulash</b>\nMijozlar yozadigan <b>Premium</b> akkauntda:\n<b>Sozlamalar → Telegram Business → Chat-botlar → ${BOT()}</b>\n\nRuxsat: <b>«Xabarlarga javob berish»</b> — busiz panel javob yubora olmaydi.\nChatlar: «Barcha chatlar» eng oddiy yo‘l.` },
  { b: '✅ Tekshirish', t: `<b>Tekshirish</b>\nBoshqa telefondan Photobuy akkauntiga oddiy xabar yozing — 2–3 soniyada panelning «Suhbatlar» bo‘limida chiqadi.\n\nMijoz hech qanday bot ko‘rmaydi: javob Photobuy akkauntidan ketadi.\nYangi akkaunt «Kuzatish» bosqichida boshlanadi — mijozga hech narsa yuborilmaydi.` }
];
const tgMenu = () => ({ inline_keyboard: [tgSteps().map((s, i) => ({ text: s.b, callback_data: `tgq:${i}` })), [{ text: '❓ Savolim bor', callback_data: 'meta:ask' }]] });

export async function tgGuideStart(tg, chatId) {
  kvSet(K(chatId), 'menu');
  audit('sys', 'Photobuy boti', 'Telegram ulash qo‘llanmasi ochildi', { object: `chat:${chatId}` });
  await sendGuideVideo(tg, chatId, TG_VIDEO, 'tg_video_file_id', 'Telegram Business’ni panelga ulash — 2 qadam, 2 daqiqa.');
  return tg('sendMessage', { chat_id: chatId, parse_mode: 'HTML', reply_markup: tgMenu(),
    text: `<b>Telegram Business’ni ulash</b>\nIkki qadam: botda rejimni yoqish va mijozlar yozadigan Premium akkauntga ulash.` });
}
export async function tgGuideCallback(tg, q, arg) {
  const steps = tgSteps(), i = Number(arg);
  if (!(i >= 0 && i < steps.length)) return 'Topilmadi';
  await tg('sendMessage', { chat_id: q.message.chat.id, parse_mode: 'HTML', text: steps[i].t, reply_markup: tgMenu(), disable_web_page_preview: true });
  return steps[i].b;
}
