import { createServer } from 'node:http';
import { setDefaultAutoSelectFamilyAttemptTimeout } from 'node:net';
import { config } from './config.js';
import { handle } from './web.js';
import { migrate, kvGet, kvSet } from './db.js';
import { setInboxHooks, startEngine, recoverInbox, drainInbox, retryAfterOutage, closeAnsweredTasks } from './services/inbox.js';
import { fokusDraft, looksBigList } from './agents/fokus.js';
import { notify, startJobs } from './services/notify.js';
import { onSellerReply } from './services/dispatch.js';
import { refreshStatus as billzStatus } from './services/billz.js';
import { getSettings } from './services/settings.js';
import { billzTick } from './services/billz-sync.js';
import { hasDemo, seedDemo } from './services/demo.js';
import { startTelegram, stopTelegram, sendBusiness, sendBusinessFile, editBusiness, deleteBusiness, sendBusinessPhoto, sendBusinessAlbum, setBotReplyHook, tgTyping } from './channels/telegram.js';
import { startInstagram, igTokenJob, sendInstagram, sendInstagramImage, sendInstagramAudio, senderAction } from './channels/instagram.js';
import { dailyResale, rebalanceResale, campaignWorker, onBotReply, followups, arrivalsJob } from './agents/chaqnoq.js';
import { dailyInsights } from './agents/obyektiv.js';
import { pairsJob } from './services/uslub.js';
import { webImageJob } from './services/webimage.js';
import { cleanupJob } from './services/tozalash.js';

// Serverda IPv6 yo‘q, Telegram yo‘lida paketlar ba’zan yo‘qoladi: Node har manzilga 250 ms berib, OS SYN’ni qayta yuborguncha (1 s) ETIMEDOUT qaytarardi.
// 2026-10-03 o‘lchov: standartda 60 ulanishdan 3 tasi xato; 2,5 s da xato yo‘q (150 tadan 24 tasi 1 s dan uzoq ulandi).
setDefaultAutoSelectFamilyAttemptTimeout(2500);

migrate();

setInboxHooks({
  draft: fokusDraft,
  send: async (acct, conv, text, opts) => {
    if (acct.channel === 'demo') return null; // demo akkaunt tashqariga yubormaydi
    if (acct.channel === 'tg') return sendBusiness(acct, conv, text, opts);
    if (acct.channel === 'ig') return sendInstagram(acct, conv, text, opts);
    throw new Error(`${acct.channel} kanali hali ulanmagan`);
  },
  sendFile: async (acct, conv, file, caption, opts) => {
    if (acct.channel === 'demo') return null;
    if (acct.channel === 'tg') return sendBusinessFile(acct, conv, file, caption, opts);
    if (acct.channel === 'ig' && file.kind === 'photo') return sendInstagramImage(acct, conv, file, caption, opts);
    if (acct.channel === 'ig' && (file.kind === 'voice' || file.kind === 'audio')) return sendInstagramAudio(acct, conv, file, opts);
    throw new Error('Instagram’ga faqat rasm va ovoz yuboriladi');
  },
  editMsg: async (acct, conv, extId, text) => {
    if (acct.channel === 'demo') return;
    if (acct.channel === 'tg') return editBusiness(acct, conv, extId, text);
    throw new Error('Instagram yuborilgan xabarni tahrirlashga ruxsat bermaydi');
  },
  deleteMsgs: async (acct, ids) => {
    if (acct.channel === 'demo') return;
    if (acct.channel === 'tg') return deleteBusiness(acct, ids);
    throw new Error('Instagram xabarni o‘chirishga ruxsat bermaydi');
  },
  sendPhoto: async (acct, conv, buf, caption) => {
    if (acct.channel === 'demo') return null;
    if (acct.channel === 'tg') return sendBusinessPhoto(acct, conv, buf, caption);
    throw new Error(`${acct.channel} kanalida rasm yuborish hali ulanmagan`);
  },
  sendAlbum: async (acct, conv, items) => {
    if (acct.channel === 'demo') return items.map(() => null);
    if (acct.channel === 'tg') return sendBusinessAlbum(acct, conv, items);
    throw new Error(`${acct.channel} kanalida albom yuborish hali ulanmagan`);
  },
  /* «Yozmoqda» belgisi: mijoz AI javob yozayotganini ko'rib turadi */
  typing: async (acct, conv) => {
    if (acct.channel === 'demo') return;
    if (acct.channel === 'ig') return senderAction(conv.ext_chat_id, 'typing_on');
    if (acct.channel === 'tg') return tgTyping(acct, conv);
  },
  notify: (kind, payload) => notify(kind, payload).catch(e => console.error('notify', kind, e)),
  // Sotuvchi mijozga yozdi — shu suhbatdagi ochiq topshiriqlar bajarildi (boshliq agent)
  onSellerReply: (convId, info) => onSellerReply(convId, info),
  // Katta ro‘yxat AI’ga bog‘liq emas: xabar kelishi bilan tekshiriladi (≤ 60 s talab)
  onClient: (conv, text) => { if (looksBigList(text)) notify('big_order', { conv, order: { items: [], heuristic: true } }).catch(e => console.error('big', e)); }
});

const server = createServer(handle);

server.listen(config.port, config.host, () => {
  console.log(`[sales] ${config.publicUrl} (${config.host}:${config.port})`);
  getSettings(); // hisob valyutasi va boshqa sozlamalar xotiraga
  billzStatus();
  startInstagram().catch(e => console.error('[instagram]', e));
  kvSet('billz_retry_at', 0); // yangi kalit kiritilgach (sozla.sh qayta ishga tushiradi) — kutmasdan darhol urinadi
  // Demo — faqat bir marta: panelda o‘chirilsa, qayta ishga tushganda qaytib kelmaydi
  if (config.demoData && !hasDemo() && !kvGet('demo_seeded')) { seedDemo(); kvSet('demo_seeded', 1); }
  else if (hasDemo()) kvSet('demo_seeded', 1);
  startEngine();
  startJobs();
  // Qayta ishga tushgandan keyingi tiklash — bot ulangach (ogohlantirishlar xodimlarga yetib borsin)
  startTelegram().catch(e => console.error('[telegram]', e)).finally(() => {
    // Javob berilgan suhbatlarning eski vazifalari yopiladi (ilgari avtomatik yopilmasdi — ro‘yxat to‘lib, yangilari ko‘rinmay qolgan)
    try { const k = closeAnsweredTasks(); if (k) console.log(`[vazifalar] ${k} ta eskirgan vazifa yopildi — suhbatga javob berilgan`); } catch (e) { console.error('vazifalar', e); }
    const n = recoverInbox();
    if (n) console.log(`[inbox] ${n} ta javob kutayotgan suhbat uchun qoralama qayta tayyorlanadi`);
  });
  // Keshbek boti (mijozlar uchun) — alohida bot, sotuvchilar botiga ta’sir qilmaydi
  import('./channels/keshbek.js').then(m => m.startCashbackBot()).catch(e => console.error('[keshbek]', e));
  // Mijozlarning profil rasmlari (Telegram / Instagram) — panelda bosh harflar o‘rniga; fon rejimida, sekin navbat bilan
  import('./services/avatar.js').then(m => m.startAvatars()).catch(e => console.error('[avatar]', e));
  setBotReplyHook(onBotReply);
  // Chaqnoq va Obyektiv: kunlik ro‘yxat, kampaniya ishchisi, kunlik xulosa (vaqtlar sozlamada, Toshkent); BILLZ sinxron
  const tick = () => {
    billzTick().catch(e => console.error('billz', e));
    igTokenJob().catch(e => console.error('ig token', e));
    dailyResale().catch(e => console.error('resale', e));
    rebalanceResale().catch(e => console.error('resale-rebalance', e));
    arrivalsJob().catch(e => console.error('arrivals', e));
    campaignWorker().catch(e => console.error('campaign', e));
    dailyInsights().catch(e => console.error('insights', e));
    followups().catch(e => console.error('followups', e));
    try { pairsJob(); } catch (e) { console.error('uslub', e); }
    try { retryAfterOutage(); } catch (e) { console.error('retry', e); }
    webImageJob().catch(e => console.error('webimg', e));
    try { if (cleanupJob()) closeAnsweredTasks(); } catch (e) { console.error('tozalash', e); }   // tunda eski jurnal/qoralamalar o‘chadi — baza to‘lib ketmasin; javob berilgan vazifalar yopiladi
  };
  setTimeout(tick, 15000);
  setInterval(tick, 60000).unref?.();
});

/* To‘xtash (deploy, qayta ishga tushish): yangi so‘rov va yuborish qabul qilinmaydi, boshlangan yuborishlar tugashi kutiladi */
let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => {
  if (stopping) return; stopping = true;
  stopTelegram();
  server.close();
  const left = await drainInbox(10000);
  if (left) console.error(`[inbox] ${left} ta yuborish tugamay to‘xtadi — qayta ishga tushganda «noma’lum» deb belgilanadi`);
  process.exit(0);
});
