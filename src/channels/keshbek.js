import { one, all, run, kvGet, kvSet } from '../db.js';
import { now, money, clip } from '../util.js';
import { audit } from '../core/audit.js';
import { config } from '../config.js';
import { setIntegration } from '../services/settings.js';

/*
  Keshbek boti — mijozlar uchun. Bitta vazifasi bor: odam «Start» bosadi, telefon raqamini yuboradi,
  ismi va keshbek balansi ko‘rsatiladi. Boshqa hech narsa qilmaydi.
  Maxfiylik: raqam faqat TELEGRAM TUGMASI orqali qabul qilinadi va u yuborgan odamning o‘ziniki bo‘lishi shart
  (contact.user_id === from.id). Aks holda kimdir begona raqamni yozib, o‘sha odamning keshbegini bilib olardi.
  Reklama: paneldan yuboriladi — «Start» bosganlarning hammasiga.
*/

const TOKEN = () => config.cbToken;
export const cbReady = () => Boolean(TOKEN());
let running = false, me = null, offset = Number(kvGet('cb_offset') || 0);

export async function cbApi(method, params = {}, timeoutMs = 20000) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN()}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params), signal: AbortSignal.timeout(timeoutMs)
  });
  const j = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }));
  if (!j.ok) { const e = new Error(j.description || 'telegram_error'); e.code = j.error_code; e.retry = j.parameters?.retry_after; throw e; }
  return j.result;
}

/* Raqamni solishtirish: oxirgi 9 raqam bo‘yicha (+998 bilan ham, bo‘lmasa ham topiladi) */
const tail9 = v => String(v || '').replace(/\D/g, '').slice(-9);

export function customerByPhone(phone) {
  const t = tail9(phone);
  if (t.length < 7) return null;
  return one(`SELECT * FROM customers WHERE COALESCE(is_demo,0)=0 AND (
      replace(replace(replace(COALESCE(phone,''),'+',''),' ',''),'-','') LIKE ?
      OR replace(replace(replace(COALESCE(phones,''),'+',''),' ',''),'-','') LIKE ?) LIMIT 1`, '%' + t, '%' + t + '%') || null;
}

/* Doimiy menyu. Havolalar kv da — paneldan tegmasdan o‘zgartirish mumkin:
   cb_shop_url (Instagram do‘kon), cb_contact_url (bog‘lanish uchun Telegram akkaunt). */
const SHOP = () => kvGet('cb_shop_url') || 'https://instagram.com/photobuy.uz';
const CONTACT = () => kvGet('cb_contact_url') || 'https://t.me/PHOTOBUYUZ777';

const B_CHECK = '\ud83d\udcb3 Keshbekni tekshirish';
const B_SHOP = '\ud83d\udecd Instagram do\u2018kon';
const B_CONTACT = '\u270d\ufe0f Bog\u2018lanish';
const MENU = { keyboard: [[{ text: B_CHECK }], [{ text: B_SHOP }, { text: B_CONTACT }]], resize_keyboard: true };

const send = (chatId, text, extra = {}) =>
  cbApi('sendMessage', { chat_id: chatId, text, reply_markup: MENU, ...extra }).catch(() => {});

/* Raqam so‘rash: yozib yuborish ham, tugma bilan yuborish ham mumkin */
const askPhone = chatId => cbApi('sendMessage', {
  chat_id: chatId,
  text: 'Telefon raqamingizni yozing \u2014 masalan 901234567 yoki +998 90 123 45 67.\n\nYoki pastdagi tugma bilan yuboring.',
  reply_markup: { keyboard: [[{ text: '\ud83d\udcf1 Raqamni yuborish', request_contact: true }], [{ text: B_CHECK }], [{ text: B_SHOP }, { text: B_CONTACT }]], resize_keyboard: true }
}).catch(() => {});

/* Keshbek javobi */
function balanceText(cu) {
  const cb = one('SELECT amount, synced_at FROM cashback WHERE customer_id=?', cu.id);
  const last = one(`SELECT max(sold_at) t FROM purchases WHERE customer_id=? AND kind='sale'`, cu.id)?.t;
  const name = (cu.name || '').trim();
  const lines = [name ? `${name}, salom!` : 'Salom!'];
  if (!cb || !(cb.amount > 0)) {
    lines.push('', 'Hozir keshbegingiz yo\u2018q.', 'Xaridlaringizdan keshbek yig\u2018iladi va shu yerda ko\u2018rinadi.');
  } else {
    lines.push('', `Keshbegingiz: ${money(cb.amount)}`);
    if (last) lines.push(`Oxirgi xaridingiz: ${new Date(last).toISOString().slice(0, 10)}`);
    lines.push('', 'Keshbekni keyingi xaridingizda ishlatishingiz mumkin \u2014 do\u2018konda sotuvchiga ayting.');
  }
  return lines.join('\n');
}

/* Obunachini yozib qo‘yish (reklama shu ro‘yxatga yuboriladi) */
function saveSub(m, cu, phone) {
  const chatId = m.chat.id;
  const nameTg = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ').trim() || null;
  run(`INSERT INTO cb_subs(chat_id,customer_id,name,username,phone,joined_at,last_at,checks)
       VALUES(?,?,?,?,?,?,?,?)
       ON CONFLICT(chat_id) DO UPDATE SET customer_id=COALESCE(excluded.customer_id,customer_id),
         name=COALESCE(excluded.name,name), username=excluded.username,
         phone=COALESCE(excluded.phone,phone), last_at=excluded.last_at,
         checks=checks+?, blocked_at=NULL`,
    chatId, cu?.id ?? null, cu?.name || nameTg, m.from?.username || null, phone || null, now(), now(), phone ? 1 : 0, phone ? 1 : 0);
  if (cu) run('UPDATE customers SET bot_chat_id=? WHERE id=?', chatId, cu.id);
}

async function checkPhone(m, phone) {
  const cu = customerByPhone(phone);
  saveSub(m, cu, phone);
  if (cu) return send(m.chat.id, balanceText(cu));
  return send(m.chat.id, 'Bu raqam bo\u2018yicha xarid tarixi topilmadi.\n\nDo\u2018konimizdan xarid qilganingizda raqamingizni ayting \u2014 keyin keshbegingiz shu yerda ko\u2018rinadi.');
}

async function onMessage(m) {
  const chatId = m.chat?.id;
  if (!chatId || m.chat.type !== 'private') return;
  const t = String(m.text || '').trim();

  // Tugma orqali kelgan kontakt (faqat o‘ziniki)
  if (m.contact) {
    if (String(m.contact.user_id || '') !== String(m.from?.id || ''))
      return send(chatId, 'Tugma orqali faqat o\u2018z raqamingizni yuborish mumkin. Boshqa raqamni yozib yuboring.');
    return checkPhone(m, m.contact.phone_number);
  }

  if (/^\/stop/.test(t)) {
    run('UPDATE cb_subs SET blocked_at=? WHERE chat_id=?', now(), chatId);
    return cbApi('sendMessage', { chat_id: chatId, text: 'Xabarlar to\u2018xtatildi. Qayta ulanish uchun /start bosing.', reply_markup: { remove_keyboard: true } }).catch(() => {});
  }

  if (/^\/start/.test(t) || !t) {
    saveSub(m, null, null);
    return send(chatId, 'Assalomu alaykum! Photobuy keshbek botiga xush kelibsiz.\n\n\u2022 Keshbegingizni bilish uchun \u00ab' + B_CHECK + '\u00bb\n\u2022 Do\u2018konimiz \u2014 \u00ab' + B_SHOP + '\u00bb\n\u2022 Savolingiz bo\u2018lsa \u2014 \u00ab' + B_CONTACT + '\u00bb');
  }

  if (t === B_CHECK || /keshbek|кешбек|кэшбэк/i.test(t)) return askPhone(chatId);

  if (t === B_SHOP) return cbApi('sendMessage', {
    chat_id: chatId, text: 'Photobuy Instagram do\u2018koni \u2014 yangi mahsulotlar, narxlar va aksiyalar shu yerda.',
    reply_markup: { inline_keyboard: [[{ text: 'Do\u2018konni ochish', url: SHOP() }]] }
  }).catch(() => {});

  if (t === B_CONTACT) return cbApi('sendMessage', {
    chat_id: chatId, text: 'Savolingiz bo\u2018lsa yozing \u2014 sotuvchimiz javob beradi.',
    reply_markup: { inline_keyboard: [[{ text: 'Telegramda yozish', url: CONTACT() }]] }
  }).catch(() => {});

  // Raqam yozilgan bo‘lsa — keshbek tekshiriladi
  const digits = t.replace(/\D/g, '');
  if (digits.length >= 9 && digits.length <= 15 && /^[\d\s+()\-]+$/.test(t)) return checkPhone(m, t);

  return send(chatId, 'Pastdagi menyudan tanlang yoki telefon raqamingizni yozing.');
}

async function loop() {
  while (running) {
    try {
      const ups = await cbApi('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] }, 65000);
      for (const u of ups) {
        offset = u.update_id + 1;
        kvSet('cb_offset', offset);
        if (u.message) await onMessage(u.message).catch(e => console.error('[keshbek] xabar', e.message));
      }
    } catch (e) {
      if (!running) return;
      console.error('[keshbek] polling', e.message);
      setIntegration('cashback_bot', 'error', clip(String(e.message || e), 200));
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

export async function startCashbackBot() {
  if (!cbReady()) { setIntegration('cashback_bot', 'off', 'Bot tokeni kiritilmagan'); return false; }
  if (running) return true;
  try {
    me = await cbApi('getMe');
    kvSet('cb_bot_username', me.username || '');
    running = true;
    setIntegration('cashback_bot', 'ok', `@${me.username} · ishlayapti`);
    console.log(`[keshbek] @${me.username} ishga tushdi`);
    loop();
    return true;
  } catch (e) {
    setIntegration('cashback_bot', 'error', clip(String(e.message || e), 200));
    console.error('[keshbek] ishga tushmadi:', e.message);
    return false;
  }
}
export function stopCashbackBot() { running = false; }
export const cbBotUsername = () => me?.username || kvGet('cb_bot_username') || null;
export const cbStats = () => one(`SELECT count(*) jami, sum(blocked_at IS NULL) faol,
    sum(customer_id IS NOT NULL) tanilgan, sum(joined_at > ?) bugun FROM cb_subs`, now() - 864e5);
