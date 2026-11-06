/*
  Telegram Business oqimi — soxta Bot API bilan uchidan-uchiga sinov (haqiqiy tarmoqsiz).
  Tekshiriladi: xodimni ulash, Business ulanish, mijoz xabari → bitta AI javobi (business_connection_id bilan),
  botning o‘z xabari qaytib kelishi, sotuvchi Telegram ilovasidan yozishi, tahrir/o‘chirish, media, takroriy update,
  ulanish o‘chirilishi, yuborish xatosi, katta ro‘yxat signali, mijoz boti (kontakt → keshbek → rozilik → /stop),
  tugmalar huquqi, Nova botini rad etish.
*/
import { test, before, after } from 'node:test';
import dc from 'node:diagnostics_channel';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sales-tg-'));
Object.assign(process.env, { DB_FILE: join(dir, 't.db'), DATA_DIR: dir, DRAFT_DEBOUNCE_MS: '50', TG_BOT_TOKEN: '111:SINOV', TG_DISABLED: '0', ENV_FILE: join(dir, 'yoq.env'), TG_RETRY_MS: '60' });

/* ---------- soxta Telegram Bot API ---------- */
const calls = [], queue = [];
let nextUpdate = 1, nextMsg = 5000, me = { id: 999, is_bot: true, username: 'photobuy_ai_bot', can_connect_to_business: true };
let failSend = null, failGetMe = 0;
const connections = {};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ok = result => ({ ok: true, status: 200, json: async () => ({ ok: true, result }) });
const err = (code, description) => ({ ok: false, status: code, json: async () => ({ ok: false, error_code: code, description }) });

globalThis.fetch = async (url, opts = {}) => {
  // Fayl yuklab olish (ovozli xabar): Telegram fayl serveri
  if (String(url).includes('/file/bot')) return { ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode('OGG-SINOV').buffer };
  const method = String(url).match(/\/bot[^/]+\/(\w+)$/)?.[1];
  const p = typeof opts.body === 'string' ? JSON.parse(opts.body) : {};
  if (method !== 'getUpdates') calls.push({ method, p });
  switch (method) {
    case 'getMe': if (failGetMe > 0) { failGetMe--; throw new Error('fetch failed'); } return ok(me);
    case 'getUpdates': {
      for (let i = 0; i < 20; i++) {
        const ups = queue.filter(u => u.update_id >= (p.offset || 0));
        if (ups.length) return ok(ups);
        await sleep(10);
      }
      return ok([]);
    }
    case 'sendMessage': {
      if (failSend && p.business_connection_id) {
        const f = failSend; failSend = null;
        if (f.timeout) throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
        if (f.net) { if (--f.times > 0) failSend = f; throw new TypeError('fetch failed', { cause: Object.assign(new Error(`connect ${f.net}`), { code: f.net }) }); }
        if (f.reset) {
          // undici xabarlari: so‘rov yaratildi; «after» — sarlavha soketga yozildi, keyin uzildi
          if (--f.times > 0) failSend = f;
          const id = opts.headers?.['x-pb-req'];
          dc.channel('undici:request:create').publish({ request: { headers: ['content-type', 'application/json', 'x-pb-req', id] } });
          if (f.reset === 'after') dc.channel('undici:client:sendHeaders').publish({ headers: `POST /sendMessage HTTP/1.1\r\nx-pb-req: ${id}\r\n` });
          throw new TypeError('fetch failed', { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) });
        }
        return err(f.code, f.description);
      }
      return ok({ message_id: ++nextMsg, date: Math.floor(Date.now() / 1000), chat: { id: p.chat_id, type: 'private' }, text: p.text });
    }
    case 'getBusinessConnection': return connections[p.business_connection_id] ? ok(connections[p.business_connection_id]) : err(400, 'Bad Request: business connection not found');
    case 'sendVideo': return ok({ message_id: ++nextMsg, video: { file_id: 'VID-1' } });
    case 'getFile': return ok({ file_path: `voice/${p.file_id}.oga` });
    case 'answerCallbackQuery': case 'editMessageReplyMarkup': return ok(true);
    default: return err(404, `Not Found: ${method}`);
  }
};
function push(update) { const u = { update_id: nextUpdate++, ...update }; queue.push(u); return u; }
const until = async (cond, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { if (cond()) return true; await sleep(20); } return false; };
const sends = (pred = () => true) => calls.filter(c => c.method === 'sendMessage' && pred(c.p));

/* ---------- ilova ---------- */
const { migrate, run, one, all } = await import('../src/db.js');
const inbox = await import('../src/services/inbox.js');
const { updateSettings, integration } = await import('../src/services/settings.js');
const tgm = await import('../src/channels/telegram.js');
const { notify } = await import('../src/services/notify.js');
const { looksBigList } = await import('../src/agents/fokus.js');

const OWNER = 5001, CLIENT = 7001, CLIENT2 = 7002, BC = 'bc-sinov-1';
const OWNER_USER = { id: OWNER, is_bot: false, first_name: 'Dilshod', username: 'dilshod_pb' };
const client = (id = CLIENT, extra = {}) => ({ id, is_bot: false, first_name: 'Jasur', username: 'jasur' + id, ...extra });
const bmsg = (from, chatId, fields) => ({ business_connection_id: BC, message_id: ++nextMsg, date: Math.floor(Date.now() / 1000), from, chat: { id: chatId, type: 'private', first_name: 'Jasur' }, ...fields });
const conv = (chat = CLIENT) => one(`SELECT c.* FROM conversations c JOIN accounts a ON a.id=c.account_id WHERE a.ext_id=? AND c.ext_chat_id=?`, BC, String(chat));
const msgs = (c, author) => all('SELECT * FROM messages WHERE conversation_id=?' + (author ? ' AND author=?' : ''), ...(author ? [c.id, author] : [c.id]));
let draftCalls = 0;

before(async () => {
  migrate();
  run(`INSERT INTO branches(id,name) VALUES(1,'Chilonzor')`);
  run(`INSERT INTO users(id,login,name,role,branch_id,created_at) VALUES(1,'rahbar','Rahbar','rahbar',NULL,0),(2,'dilshod','Dilshod','sotuvchi',1,0)`);
  run(`INSERT INTO tg_links(code,user_id,expires_at) VALUES('ABC123',2,?)`, Date.now() + 3600e3);
  run(`INSERT INTO customers(id,name,phone,billz_id,created_at) VALUES(1,'Jasur T.','+998901234567','B-1',0)`);
  run(`INSERT INTO cashback(customer_id,amount,synced_at) VALUES(1,150000,?)`, Date.now());
  updateSettings({ T_seconds: 1, work_from: '00:00', work_to: '23:59', night_autoreply: false }, 'test', { unchecked: true });
  inbox.setInboxHooks({
    draft: async ({ conv }) => { draftCalls++; await sleep(30); return { ok: true, text: `Salom! Javob #${conv.id}`, sources: ['sinov'], card: {} }; },
    send: (acct, c, text) => tgm.sendBusiness(acct, c, text),
    notify: (kind, payload) => notify(kind, payload),
    onClient: (c, text) => { if (looksBigList(text)) notify('big_order', { conv: c, order: { items: [], heuristic: true } }); }
  });
  inbox.startEngine();
});
after(() => { tgm.stopTelegram(); inbox.stopEngine(); rmSync(dir, { recursive: true, force: true }); });

test('Nova boti (@photobuy_ai_bot) tokeni bilan polling boshlanmaydi', async () => {
  await tgm.startTelegram();
  assert.equal(integration('telegram').state, 'error');
  assert.match(integration('telegram').detail, /Nova/);
  assert.equal(tgm.telegramRunning(), false);
  me = { id: 998, is_bot: true, username: 'photobuysalesbot', can_connect_to_business: true };
  // Ishga tushishda Telegram bir lahza javob bermaydi — bot taslim bo‘lmasdan qayta urinadi
  failGetMe = 2;
  await tgm.startTelegram();
  assert.equal(tgm.telegramRunning(), false);
  assert.match(integration('telegram').detail, /qayta urinadi/);
  assert.ok(await until(() => tgm.telegramRunning(), 3000), 'qayta urinishdan keyin polling boshlanishi kerak');
  assert.equal(integration('telegram').state, 'ok');
});

test('xodim /start link_KOD bilan ulanadi', async () => {
  push({ message: { message_id: 1, date: 0, from: OWNER_USER, chat: { id: OWNER, type: 'private' }, text: '/start link_ABC123' } });
  assert.ok(await until(() => one('SELECT tg_chat_id FROM users WHERE id=2').tg_chat_id === OWNER));
  assert.ok(sends(p => p.chat_id === OWNER && /Salom, Dilshod/.test(p.text)).length);
  assert.equal(one(`SELECT COUNT(*) n FROM tg_links`).n, 0, 'kod bir martalik');
});

test('Business ulanish: yangi akkaunt kuzatish rejimida, egasi va filiali bog‘lanadi', async () => {
  connections[BC] = { id: BC, user: OWNER_USER, user_chat_id: OWNER, date: 0, rights: { can_reply: true }, is_enabled: true };
  push({ business_connection: connections[BC] });
  assert.ok(await until(() => one(`SELECT id FROM accounts WHERE ext_id=?`, BC)));
  const a = one(`SELECT * FROM accounts WHERE ext_id=?`, BC);
  assert.equal(a.rollout, 'kuzatish');
  assert.equal(a.owner_user_id, 2);
  assert.equal(a.branch_id, 1);
  assert.equal(a.can_reply, 1);
});

test('kuzatish: AI qoralama yozadi, lekin mijozga hech narsa yubormaydi', async () => {
  push({ business_message: bmsg(client(CLIENT2), CLIENT2, { text: 'Canon R50 bormi?' }) });
  assert.ok(await until(() => conv(CLIENT2) && one(`SELECT status FROM drafts WHERE conversation_id=?`, conv(CLIENT2).id)?.status === 'ready'));
  await sleep(1500);
  assert.equal(sends(p => p.business_connection_id).length, 0);
});

test('avto: mijoz xabari → T dan keyin aynan bitta javob, to‘g‘ri chat va business_connection_id bilan', async () => {
  const a = one(`SELECT * FROM accounts WHERE ext_id=?`, BC);
  // Kuzatish paytidan qolgan 30 daqiqalik javobsiz savol — «avto»ga o‘tganda AI unga yozmasligi kerak (sotuvchida qoladi)
  run('UPDATE conversations SET pending_since=? WHERE id=?', Date.now() - 30 * 60e3, conv(CLIENT2).id);
  inbox.setAccount(a.id, { rollout: 'avto' }, { name: 'test' });
  assert.equal(conv(CLIENT2).ai_due_at, null, 'eski savol AI’ga berilmadi');
  const before = sends(p => p.business_connection_id).length;
  push({ business_message: bmsg(client(), CLIENT, { text: 'DJI Mic 2 bormi?' }) });
  push({ business_message: bmsg(client(), CLIENT, { text: 'Sony ZV-E10 ga ulasa bo‘ladimi?' }) });
  assert.ok(await until(() => sends(p => p.business_connection_id).length > before, 4000), 'javob yuborildi');
  await sleep(1500);
  const out = sends(p => p.business_connection_id).slice(before);
  assert.equal(out.length, 1, 'ikki xabarga bitta javob, eski suhbatga javob yo‘q');
  assert.equal(out[0].p.business_connection_id, BC);
  assert.equal(out[0].p.chat_id, CLIENT);
  const c = conv();
  assert.equal(msgs(c, 'client').length, 2);
  assert.equal(msgs(c, 'ai').length, 1);
  assert.equal(c.pending_since, null);
  assert.ok(sends(p => p.chat_id === OWNER && /AI javob berdi/.test(p.text)).length, 'sotuvchiga bildirishnoma');
});

test('botning o‘z xabari qaytib kelsa (sender_business_bot) — mijoz xabari deb yozilmaydi', async () => {
  const c = conv(), aiMsg = msgs(c, 'ai')[0];
  push({ business_message: { ...bmsg(OWNER_USER, CLIENT, { text: aiMsg.text }), message_id: Number(aiMsg.ext_msg_id), sender_business_bot: { id: 998, is_bot: true, username: 'photobuysalesbot' } } });
  await sleep(300);
  assert.equal(msgs(c, 'client').length, 2);
  assert.equal(msgs(c).length, 3);
  assert.equal(conv().pending_since, null);
});

test('sotuvchi Telegram ilovasidan yozsa — AI javobi bekor, mijozga AI yozmaydi', async () => {
  // T = 3 s: Telegram vaqti soniyagacha yaxlitlanadi, 1 soniyalik T bilan sinov tasodifiy bo‘lib qolardi
  updateSettings({ T_seconds: 3 }, 'test', { unchecked: true });
  const before = sends(p => p.business_connection_id).length;
  push({ business_message: bmsg(client(), CLIENT, { text: 'Narxi qancha?' }) });
  await sleep(500);
  push({ business_message: bmsg(OWNER_USER, CLIENT, { text: '9 800 000 so‘m, bugun olib ketsangiz bo‘ladi' }) });
  await sleep(3500);
  updateSettings({ T_seconds: 1 }, 'test', { unchecked: true });
  assert.equal(sends(p => p.business_connection_id).length, before, 'AI yubormadi');
  const c = conv();
  assert.equal(c.pending_since, null);
  assert.equal(msgs(c, 'seller').length, 1);
  assert.equal(msgs(c, 'seller')[0].user_id, 2, 'javob egasi — Dilshod');
});

test('bir xil update qayta kelsa — xabar ikki marta yozilmaydi', async () => {
  const m = bmsg(client(), CLIENT, { text: 'Rahmat' });
  push({ business_message: m });
  push({ business_message: m });
  await sleep(300);
  assert.equal(msgs(conv()).filter(x => x.text === 'Rahmat').length, 1);
});

test('tahrir va o‘chirish panel tarixida belgilanadi', async () => {
  const m = bmsg(client(), CLIENT, { text: 'Mic 2 kerak' });
  push({ business_message: m });
  await until(() => msgs(conv()).some(x => x.text === 'Mic 2 kerak'));
  push({ edited_business_message: { ...m, text: 'Mic 2 ikkita kerak', edit_date: m.date + 5 } });
  await until(() => msgs(conv()).some(x => x.text === 'Mic 2 ikkita kerak'));
  const row = msgs(conv()).find(x => x.ext_msg_id === String(m.message_id));
  assert.equal(JSON.parse(row.meta).original, 'Mic 2 kerak');
  push({ deleted_business_messages: { business_connection_id: BC, chat: { id: CLIENT, type: 'private' }, message_ids: [m.message_id] } });
  assert.ok(await until(() => JSON.parse(one('SELECT meta FROM messages WHERE id=?', row.id).meta).deleted_at));
});

test('rasm: matn «[rasm] izoh», file_id meta’da saqlanadi', async () => {
  push({ business_message: bmsg(client(), CLIENT, { caption: 'shu kamerami?', photo: [{ file_id: 'small', file_unique_id: 'u1', width: 90, height: 90 }, { file_id: 'big', file_unique_id: 'u2', width: 1280, height: 960, file_size: 120000 }] }) });
  assert.ok(await until(() => msgs(conv()).some(x => x.text === '[rasm] shu kamerami?')));
  const media = JSON.parse(msgs(conv()).find(x => x.text === '[rasm] shu kamerami?').meta).media;
  assert.deepEqual([media.kind, media.file_id, media.uid], ['photo', 'big', 'u2']);
  await until(() => conv().pending_since === null, 4000);
});

test('katta ro‘yxat — sotuvchiga darhol signal va «Qabul qilaman» tugmasi', async () => {
  push({ business_message: bmsg(client(), CLIENT, { text: 'Assalomu alaykum, studiya uchun:\nSony A7 IV — 2 ta\nSigma 24-70 — 2 ta\nGodox SL60 — 4 ta\nTripod — 4 ta\nSD karta 128GB — 10 ta' }) });
  assert.ok(await until(() => sends(p => p.chat_id === OWNER && /Katta buyurtma/.test(p.text)).length));
  const sig = sends(p => p.chat_id === OWNER && /Katta buyurtma/.test(p.text))[0];
  assert.equal(sig.p.reply_markup.inline_keyboard[0][0].callback_data, `accept:${conv().id}`);
  push({ callback_query: { id: 'cq1', from: OWNER_USER, message: { message_id: 1, chat: { id: OWNER, type: 'private' } }, data: `accept:${conv().id}` } });
  assert.ok(await until(() => conv().big_accepted_by === 2));
  await until(() => conv().pending_since === null, 4000);
});

test('begona odam tugmani bossa — ruxsat yo‘q', async () => {
  const c = conv();
  run('UPDATE conversations SET taken_by=NULL WHERE id=?', c.id);
  push({ callback_query: { id: 'cq2', from: client(8888), message: { message_id: 1, chat: { id: 8888, type: 'private' } }, data: `take:${c.id}` } });
  assert.ok(await until(() => calls.some(x => x.method === 'answerCallbackQuery' && x.p.callback_query_id === 'cq2')));
  assert.match(calls.find(x => x.p.callback_query_id === 'cq2').p.text, /ruxsat yo‘q/);
  assert.equal(conv().taken_by, null);
});

test('Telegram yuborishda xato bersa — jarayon to‘xtamaydi, qoralama «failed», sotuvchi ogohlantiriladi', async () => {
  failSend = { code: 403, description: 'Forbidden: bot was blocked by the user' };
  push({ business_message: bmsg(client(), CLIENT, { text: 'Yetkazib berish bormi?' }) });
  assert.ok(await until(() => sends(p => p.chat_id === OWNER && /javob ketmadi/.test(p.text)).length, 4000));
  const c = conv();
  assert.equal(one(`SELECT status FROM drafts WHERE conversation_id=? ORDER BY id DESC`, c.id).status, 'failed');
  assert.equal(c.ai_due_at, null);
  assert.equal(tgm.telegramRunning(), true);
  inbox.markSellerReply(c.id, { text: 'javob', userId: 2 });
});

test('panel javobi bilan bir soniyada kelgan yangi savol ham javobsiz qolmaydi (Telegram vaqti soniyagacha)', async () => {
  const before = sends(p => p.business_connection_id).length;
  const c = conv();
  // Panel javobi millisekundli vaqt bilan yozildi; mijoz xabarining Telegram vaqti shu soniyaning boshi
  inbox.markSellerReply(c.id, { text: 'Ha, bor', userId: 2, ts: Date.now() + 900 });
  push({ business_message: bmsg(client(), CLIENT, { text: 'Qachon olib ketsam bo‘ladi?' }) });
  assert.ok(await until(() => sends(p => p.business_connection_id).length > before, 4000), 'AI javob berdi');
  assert.equal(conv().ai_due_at, null);
});

test('ulanish o‘chirilsa (is_enabled=false) — AI yozmaydi, sotuvchi ogohlantiriladi', async () => {
  const before = sends(p => p.business_connection_id).length;
  push({ business_connection: { ...connections[BC], is_enabled: false } });
  await until(() => one(`SELECT enabled FROM accounts WHERE ext_id=?`, BC).enabled === 0);
  push({ business_message: bmsg(client(), CLIENT, { text: 'Hali ham bormi?' }) });
  assert.ok(await until(() => sends(p => p.chat_id === OWNER && /yozib bo‘lmayapti/.test(p.text)).length, 4000));
  assert.equal(sends(p => p.business_connection_id).length, before);
  push({ business_connection: { ...connections[BC], is_enabled: true } });
  await until(() => one(`SELECT enabled FROM accounts WHERE ext_id=?`, BC).enabled === 1);
  inbox.markSellerReply(conv().id, { text: 'javob', userId: 2 });
});

test('Telegram avtojavobi (is_from_offline) sotuvchi javobi hisoblanmaydi — mijoz AI javobini oladi', async () => {
  const C3 = 7003, before = sends(p => p.business_connection_id && p.chat_id === C3).length;
  push({ business_message: bmsg(client(C3), C3, { text: 'Kechqurun ochiqmisiz?' }) });
  push({ business_message: bmsg(OWNER_USER, C3, { text: 'Hozir javob bera olmayman, tez orada yozaman', is_from_offline: true }) });
  assert.ok(await until(() => sends(p => p.business_connection_id && p.chat_id === C3).length > before, 4000), 'AI javob berdi');
  const c = conv(C3);
  assert.equal(msgs(c, 'seller').length, 0);
  assert.equal(msgs(c, 'system').length, 1);
  assert.equal(JSON.parse(msgs(c, 'system')[0].meta).offline, true);
});

test('mijoz savolini o‘chirsa — AI o‘chirilgan savolga javob yozmaydi', async () => {
  const C4 = 7004;
  updateSettings({ T_seconds: 3 }, 'test', { unchecked: true });
  const m = bmsg(client(C4), C4, { text: 'Xato yozdim' });
  push({ business_message: m });
  assert.ok(await until(() => conv(C4)?.pending_since));
  push({ deleted_business_messages: { business_connection_id: BC, chat: { id: C4, type: 'private' }, message_ids: [m.message_id] } });
  assert.ok(await until(() => conv(C4).pending_since === null));
  await sleep(3500);
  updateSettings({ T_seconds: 1 }, 'test', { unchecked: true });
  assert.equal(sends(p => p.business_connection_id && p.chat_id === C4).length, 0);
});

test('javob kelmay qolsa (timeout) — «noma’lum», bot aks-sadosi kelgach «yuborildi» deb tasdiqlanadi', async () => {
  const C5 = 7005 + 100;
  failSend = { timeout: true };
  push({ business_message: bmsg(client(C5), C5, { text: 'Kafolat qancha?' }) });
  assert.ok(await until(() => conv(C5) && one(`SELECT status FROM drafts WHERE conversation_id=? ORDER BY id DESC`, conv(C5).id)?.status === 'unknown', 5000));
  assert.ok(await until(() => sends(p => p.chat_id === OWNER && /javob ketdimi, aniq emas/.test(p.text)).length), 'sotuvchi ogohlantirildi');
  const d = one(`SELECT * FROM drafts WHERE conversation_id=? ORDER BY id DESC`, conv(C5).id);
  // Aslida Telegram xabarni yetkazgan edi — aks-sado keladi
  push({ business_message: { ...bmsg(OWNER_USER, C5, { text: d.text }), sender_business_bot: { id: 998, is_bot: true, username: 'photobuysalesbot' } } });
  assert.ok(await until(() => one('SELECT status FROM drafts WHERE id=?', d.id).status === 'sent'));
  assert.equal(msgs(conv(C5), 'ai').length, 1);
  assert.equal(conv(C5).pending_since, null);
});

test('Telegram’ga ulanib bo‘lmasa (so‘rov yetmagan) — bir necha soniyadan keyin qayta yuboriladi; uzilish noaniq bo‘lsa — qayta yuborilmaydi', async () => {
  const C6 = 7006 + 100;
  failSend = { net: 'ECONNREFUSED', times: 2 };
  push({ business_message: bmsg(client(C6), C6, { text: 'Yetkazib berish bormi?' }) });
  assert.ok(await until(() => conv(C6) && one(`SELECT status FROM drafts WHERE conversation_id=? ORDER BY id DESC`, conv(C6).id)?.status === 'sent', 12000), 'ikki xatodan keyin yuborildi');
  assert.equal(msgs(conv(C6), 'ai').length, 1);
  assert.equal(sends(p => p.chat_id === C6).length, 3, 'ikki urinish xato, uchinchisi ketdi');
  const { tg } = await import('../src/channels/telegram.js');
  failSend = { net: 'ECONNRESET', times: 1 };
  await assert.rejects(tg('sendMessage', { business_connection_id: 'bc', chat_id: C6, text: 'x' }), e => e.uncertain === true && /ECONNRESET/.test(e.message));
  assert.equal(sends(p => p.chat_id === C6).length, 4, 'noaniq uzilishda qayta yuborilmadi');
});

test('ulanish so‘rov yozilmasdan uzilsa (TLS bosqichi) — qayta yuboriladi; sarlavha yozilgandan keyin uzilsa — «noma’lum»', async () => {
  const { tg } = await import('../src/channels/telegram.js');
  const C7 = 7999;
  failSend = { reset: 'before', times: 1 };
  const r = await tg('sendMessage', { business_connection_id: 'bc', chat_id: C7, text: 'salom' });
  assert.ok(r.message_id, 'ikkinchi urinishda ketdi');
  assert.equal(sends(p => p.chat_id === C7).length, 2);
  failSend = { reset: 'after', times: 1 };
  await assert.rejects(tg('sendMessage', { business_connection_id: 'bc', chat_id: C7, text: 'x' }), e => e.uncertain === true && /ECONNRESET/.test(e.message));
  assert.equal(sends(p => p.chat_id === C7).length, 3, 'yetgan bo‘lishi mumkin — qayta yuborilmadi');
});

test('noma’lum ulanishdan xabar — getBusinessConnection bilan akkaunt tiklanadi', async () => {
  const BC2 = 'bc-sinov-2';
  connections[BC2] = { id: BC2, user: { id: 5002, is_bot: false, first_name: 'Aziza' }, user_chat_id: 5002, date: 0, rights: { can_reply: true }, is_enabled: true };
  push({ business_message: { ...bmsg(client(7005), 7005, { text: 'Salom' }), business_connection_id: BC2 } });
  assert.ok(await until(() => one(`SELECT id FROM accounts WHERE ext_id=?`, BC2)));
  assert.equal(one(`SELECT rollout FROM accounts WHERE ext_id=?`, BC2).rollout, 'kuzatish');
});

test('mijoz boti: /start → kontakt → keshbek → rozilik → /stop', async () => {
  const C = 9101, from = client(C);
  push({ message: { message_id: 1, date: 0, from, chat: { id: C, type: 'private' }, text: '/start' } });
  assert.ok(await until(() => sends(p => p.chat_id === C && p.reply_markup?.keyboard?.[0]?.[0]?.request_contact).length));
  push({ message: { message_id: 2, date: 0, from, chat: { id: C, type: 'private' }, contact: { phone_number: '+998 90 999 99 99', first_name: 'Boshqa', user_id: 4242 } } });
  assert.ok(await until(() => sends(p => p.chat_id === C && /o‘zingizning raqamingizni/.test(p.text)).length), 'boshqa odamning kontakti qabul qilinmaydi');
  push({ message: { message_id: 3, date: 0, from, chat: { id: C, type: 'private' }, contact: { phone_number: '998901234567', first_name: 'Jasur', user_id: C } } });
  assert.ok(await until(() => sends(p => p.chat_id === C && /150 000 so‘m/.test(p.text)).length), 'keshbek ko‘rsatildi');
  assert.equal(one('SELECT bot_chat_id FROM customers WHERE id=1').bot_chat_id, C);
  assert.equal(one('SELECT consent_at FROM customers WHERE id=1').consent_at, null, 'rozilik so‘ralmaguncha yo‘q');
  push({ callback_query: { id: 'cq3', from, message: { message_id: 10, chat: { id: C, type: 'private' } }, data: 'consent:yes' } });
  assert.ok(await until(() => one('SELECT consent_at FROM customers WHERE id=1').consent_at));
  push({ message: { message_id: 4, date: 0, from, chat: { id: C, type: 'private' }, text: '/stop' } });
  assert.ok(await until(() => one('SELECT optout_at FROM customers WHERE id=1').optout_at));
  assert.equal(one('SELECT consent_at FROM customers WHERE id=1').consent_at, null);
});

test('guruhdagi xabarlar e’tiborsiz qoldiriladi', async () => {
  const n = calls.length;
  push({ message: { message_id: 1, date: 0, from: client(9200), chat: { id: -100123, type: 'supergroup' }, text: '/start' } });
  await sleep(300);
  assert.equal(calls.slice(n).filter(c => c.method === 'sendMessage').length, 0);
});

/* ---------- Instagram ulash yordamchisi (deep link ?start=meta) ---------- */
test('Instagram yordamchisi: video, 9 qadam tugmasi va savol rahbarga ketadi', async () => {
  const chat = 777001;
  push({ message: { message_id: 1, date: Math.floor(Date.now() / 1000), chat: { id: chat, type: 'private' }, from: { id: chat, first_name: 'Egasi' }, text: '/start meta' } });
  assert.ok(await until(() => sends(p => p.chat_id === chat && /Instagram’ni panelga ulash/.test(p.text || '')).length), 'menyu yuborilmadi');
  const menu = sends(p => p.chat_id === chat).pop();
  const btns = menu.p.reply_markup.inline_keyboard.flat().map(b => b.callback_data);
  assert.ok(btns.includes('meta:0') && btns.includes('meta:8') && btns.includes('meta:9') && btns.includes('meta:ask'), 'tugmalar to‘liq emas');
  assert.ok(calls.some(c => c.method === 'sendVideo'), 'qo‘llanma videosi yuborilmadi');

  // 7-qadam (webhook) matnida callback URL bo‘lishi kerak
  push({ callback_query: { id: 'cb1', from: { id: chat }, message: { message_id: 2, chat: { id: chat, type: 'private' } }, data: 'meta:6' } });
  assert.ok(await until(() => sends(p => p.chat_id === chat && /webhook\/instagram/.test(p.text || '')).length), 'webhook qadami chiqmadi');

  // savol → rahbarga vazifa va xabar
  const lead = run(`INSERT INTO users(login,name,role,tg_user_id,tg_chat_id,active,created_at) VALUES('meta.rahbar','Meta rahbar','rahbar',888001,888001,1,?)`, Date.now()).lastInsertRowid;
  push({ callback_query: { id: 'cb2', from: { id: chat }, message: { message_id: 3, chat: { id: chat, type: 'private' } }, data: 'meta:ask' } });
  assert.ok(await until(() => sends(p => p.chat_id === chat && /Savolingizni yozing/.test(p.text || '')).length), 'savol so‘ralmadi');
  push({ message: { message_id: 4, date: Math.floor(Date.now() / 1000), chat: { id: chat, type: 'private' }, from: { id: chat, first_name: 'Egasi' }, text: 'Token qayerdan olinadi?' } });
  assert.ok(await until(() => sends(p => p.chat_id === 888001 && /Instagram ulash bo‘yicha savol/.test(p.text || '')).length), 'rahbarga xabar ketmadi');
  assert.ok(await until(() => one(`SELECT id FROM tasks WHERE kind='meta_help'`)), 'vazifa yaratilmadi');
  assert.ok(sends(p => p.chat_id === chat && /yetkazildi/.test(p.text || '')).length, 'egasiga tasdiq ketmadi');
  run('DELETE FROM users WHERE id=?', lead);
});

test('Telegram ulash qo‘llanmasi: ?start=telegram → video va 2 qadam', async () => {
  const chat = 777002;
  push({ message: { message_id: 10, date: Math.floor(Date.now() / 1000), chat: { id: chat, type: 'private' }, from: { id: chat, first_name: 'Operator' }, text: '/start telegram' } });
  assert.ok(await until(() => sends(p => p.chat_id === chat && /Telegram Business’ni ulash/.test(p.text || '')).length), 'menyu chiqmadi');
  const btns = sends(p => p.chat_id === chat).pop().p.reply_markup.inline_keyboard.flat().map(b => b.callback_data);
  assert.ok(btns.includes('tgq:0') && btns.includes('tgq:1'), 'qadam tugmalari yo‘q');
  push({ callback_query: { id: 'cb9', from: { id: chat }, message: { message_id: 11, chat: { id: chat, type: 'private' } }, data: 'tgq:0' } });
  assert.ok(await until(() => sends(p => p.chat_id === chat && /Business Mode/.test(p.text || '')).length), 'BotFather qadami chiqmadi');
});

test('bot almashtirilsa xabar kursori nolga tushadi (aks holda yangi botning xabarlari kelmaydi)', async () => {
  const { startOffset } = await import('../src/channels/telegram.js');
  const { kvGet, kvSet } = await import('../src/db.js');
  kvSet('tg_offset', '130753372'); kvSet('tg_offset_bot', '111');
  assert.equal(startOffset(111), 130753372, 'o‘sha bot — kursor saqlanadi');
  assert.equal(startOffset(222), 0, 'yangi bot — kursor nolga tushadi');
  assert.equal(Number(kvGet('tg_offset')), 0);
  assert.equal(kvGet('tg_offset_bot'), '222');
  assert.equal(startOffset(222), 0, 'ikkinchi marta ham barqaror');
});

/* ---------- agentni Telegram’dan o‘qitish (/tuzat) va botlarga javob bermaslik ---------- */
test('/tuzat: rahbar Telegram’dan to‘g‘ri javob kiritadi, sotuvchi — yo‘q', async () => {
  const LEAD = 9101, SELLER = 9102;
  run(`INSERT INTO users(login,name,role,tg_user_id,tg_chat_id,active,created_at) VALUES('tz.rahbar','Tz Rahbar','rahbar',?,?,1,?)`, LEAD, LEAD, Date.now());
  run(`INSERT INTO users(login,name,role,tg_user_id,tg_chat_id,active,created_at) VALUES('tz.sotuvchi','Tz Sotuvchi','sotuvchi',?,?,1,?)`, SELLER, SELLER, Date.now());
  const say = (id, text) => push({ message: { message_id: Math.floor(Math.random() * 1e6), date: 0, from: { id, is_bot: false, first_name: 'X' }, chat: { id, type: 'private' }, text } });

  say(LEAD, '/tuzat Yetkazib berasizmi? => Toshkent bo‘ylab bor, narxini sotuvchi aytadi.');
  assert.ok(await until(() => one(`SELECT id FROM answers WHERE question='Yetkazib berasizmi?' AND active=1`)), 'javob saqlanmadi');
  assert.ok(await until(() => sends(p => p.chat_id === LEAD && /Saqlandi \(#\d+\)/.test(p.text || '')).length));
  assert.equal(one(`SELECT source FROM answers WHERE question='Yetkazib berasizmi?'`).source, 'telegram');

  say(SELLER, '/tuzat Chegirma bormi? => Ha, 50%');
  assert.ok(await until(() => sends(p => p.chat_id === SELLER && /faqat rahbar/.test(p.text || '')).length), 'sotuvchiga rad javobi');
  assert.equal(one(`SELECT count(*) n FROM answers WHERE question='Chegirma bormi?'`).n, 0, 'sotuvchi o‘rgata olmaydi');

  say(LEAD, '/tuzatishlar');
  assert.ok(await until(() => sends(p => p.chat_id === LEAD && /Tasdiqlangan javoblar/.test(p.text || '') && /Yetkazib berasizmi/.test(p.text || '')).length));
  const id = one(`SELECT id FROM answers WHERE question='Yetkazib berasizmi?'`).id;
  say(LEAD, `/ochir ${id}`);
  assert.ok(await until(() => one('SELECT active FROM answers WHERE id=?', id).active === 0), '/ochir ishlamadi');
});

test('boshqa botdan kelgan Business xabarga javob yo‘q (bot-bot aylanishi bo‘lmasin)', async () => {
  const before = one('SELECT count(*) n FROM messages').n;
  push({ business_message: { business_connection_id: BC, message_id: 88001, date: Math.floor(Date.now() / 1000),
    chat: { id: 8800, type: 'private', username: 'spam_promo_bot' }, from: { id: 8800, is_bot: true, username: 'spam_promo_bot' }, text: 'Hello! Buy now' } });
  await sleep(400);
  assert.equal(one('SELECT count(*) n FROM messages').n, before, 'bot xabari yozilmadi');
  assert.equal(one(`SELECT count(*) n FROM conversations WHERE ext_chat_id='8800'`).n, 0, 'suhbat ochilmadi');
});

test('ovozli xabar matnga aylantiriladi va AI qoralamasi matn tayyor bo‘lgach tayyorlanadi', async () => {
  const { setSttEngine } = await import('../src/services/stt.js');
  let heard = null;
  setSttEngine(async buf => { heard = Buffer.from(buf).toString(); await sleep(150); return { text: 'DJI Mic Mini 2 bormi iPhone 15 uchun', lang: 'uz', ms: 150 }; });
  const before = draftCalls;
  push({ business_message: { business_connection_id: BC, message_id: 99001, date: Math.floor(Date.now() / 1000),
    chat: { id: CLIENT2, type: 'private', first_name: 'Ovoz' }, from: { id: CLIENT2, is_bot: false, first_name: 'Ovoz' },
    voice: { file_id: 'VOICE-1', file_unique_id: 'VU1', mime_type: 'audio/ogg', duration: 4 } } });
  assert.ok(await until(() => one(`SELECT text FROM messages WHERE ext_msg_id='99001'`)?.text?.includes('DJI Mic Mini 2')), 'matnga aylanmadi');
  const m = one(`SELECT text, meta FROM messages WHERE ext_msg_id='99001'`);
  assert.match(m.text, /^\[ovozli xabar\] DJI Mic Mini 2 bormi/);
  assert.equal(JSON.parse(m.meta).transcript.lang, 'uz');
  assert.equal(heard, 'OGG-SINOV', 'Telegram faylidan olingan ovoz aylantirildi');
  assert.ok(await until(() => draftCalls > before), 'matn tayyor bo‘lgach qoralama tayyorlanishi kerak');
  setSttEngine(null);
});

test('xodim panelda username bilan qo‘shilgan — botda «Start» bosganda o‘zi ulanadi; topshiriqni tugma bilan qabul qiladi', async () => {
  run(`INSERT INTO users(id,login,name,role,tg_username,created_at) VALUES(7,'hilola','Hilola','sotuvchi','Hilola_PB',0)`);
  const H = { id: 6001, is_bot: false, first_name: 'Hilola', username: 'hilola_pb' };
  push({ message: { message_id: 501, date: 0, from: H, chat: { id: 6001, type: 'private' }, text: '/start' } });
  assert.ok(await until(() => one('SELECT tg_chat_id FROM users WHERE id=7').tg_chat_id === 6001), 'username bo‘yicha ulandi');
  assert.ok(sends(p => p.chat_id === 6001 && /Salom, Hilola/.test(p.text)).length, 'salomlashuv');
  const d = await import('../src/services/dispatch.js');
  run(`INSERT INTO conversations(account_id,ext_chat_id,display_name,created_at) VALUES((SELECT id FROM accounts WHERE ext_id=?),'tsk-1','Topshiriq mijozi',0)`, BC);
  const c = one(`SELECT * FROM conversations WHERE ext_chat_id='tsk-1'`);
  run(`INSERT INTO assignments(conversation_id,kind,title,body,status,user_id,offered_at,created_by,created_at) VALUES(?,'rasm','Rasm yuborish','Rasm yuboring','offered',7,?,'t',?)`, c.id, Date.now(), Date.now());
  const aid = one('SELECT max(id) id FROM assignments').id;
  push({ callback_query: { id: 'cq-as1', from: H, message: { message_id: 2, chat: { id: 6001, type: 'private' } }, data: `as_ok:${aid}` } });
  assert.ok(await until(() => one('SELECT status FROM assignments WHERE id=?', aid).status === 'done'), 'eski tugma — ko‘rdi, bajarildi');
  assert.ok(calls.some(x => x.method === 'answerCallbackQuery' && x.p.callback_query_id === 'cq-as1' && /Rahmat/.test(x.p.text)));
  push({ callback_query: { id: 'cq-as2', from: H, message: { message_id: 2, chat: { id: 6001, type: 'private' } }, data: `as_done:${aid}` } });
  assert.ok(await until(() => one('SELECT status FROM assignments WHERE id=?', aid).status === 'done'), 'bajarildi');
  assert.equal(d.KINDS.rasm.label, 'Rasm yuborish');
});

test('sotuvchi Photobuy akkauntiga yozsa — mijoz emas: AI javob bermaydi, «ishda»; topshiriq akkaunt nomidan, «+» — qabul, «tashladim» — bajarildi', async () => {
  run(`INSERT INTO users(id,login,name,role,tg_username,created_at) VALUES(8,'bobur','Bobur Aliyev','sotuvchi','bobur_pb',0)`);
  const B = { id: 6002, is_bot: false, first_name: 'Bobur', username: 'bobur_pb' };
  const chat = { id: 6002, type: 'private', first_name: 'Bobur', username: 'bobur_pb' };
  const before = draftCalls;
  push({ business_message: { ...bmsg(B, 6002, { text: 'Salom, ishdaman' }), chat } });
  assert.ok(await until(() => one('SELECT biz_seen_at FROM users WHERE id=8').biz_seen_at), 'ishga keldi belgisi');
  assert.equal(one('SELECT tg_user_id FROM users WHERE id=8').tg_user_id, 6002, 'username bo‘yicha Telegram ID saqlandi');
  assert.ok(await until(() => sends(p => p.business_connection_id === BC && p.chat_id === 6002 && /Salom, Bobur! Ish kuningiz boshlandi/.test(p.text)).length), 'salom — akkaunt nomidan');
  await sleep(200);
  assert.equal(conv(6002), undefined, 'mijoz suhbati ochilmadi');
  assert.equal(draftCalls, before, 'AI unga mijozdek javob yozmadi');

  const d = await import('../src/services/dispatch.js');
  run(`INSERT INTO conversations(account_id,ext_chat_id,display_name,created_at) VALUES((SELECT id FROM accounts WHERE ext_id=?),'tsk-2','Mijoz T2',0)`, BC);
  const id = await d.assign({ conv: one(`SELECT * FROM conversations WHERE ext_chat_id='tsk-2'`), kind: 'rasm', task: 'Canon R50 rasmini yuboring' });
  const a = one('SELECT * FROM assignments WHERE id=?', id);
  assert.equal(a.user_id, 8, 'bugun ishga kelgan sotuvchi oldin');
  assert.equal(a.via, 'biz');
  assert.ok(sends(p => p.business_connection_id === BC && p.chat_id === 6002 && /^Bobur, Canon R50 rasmini yuboring/.test(p.text)).length, 'rahbar nomidan, ism bilan');
  push({ business_message: { ...bmsg(B, 6002, { text: '+' }), chat } });
  assert.ok(await until(() => one('SELECT status FROM assignments WHERE id=?', id).status === 'done'), '«+» — ko‘rdi, bajarildi');
  push({ business_message: { ...bmsg(B, 6002, { text: 'rasmini tashladim' }), chat } });
  assert.ok(await until(() => one('SELECT status FROM assignments WHERE id=?', id).status === 'done'), '«tashladim» — bajarildi');
  assert.equal(conv(6002), undefined);
});
