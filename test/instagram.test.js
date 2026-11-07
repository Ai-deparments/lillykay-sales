/*
  Instagram Direct ulagichi — soxta Meta API va veb-huk bilan (haqiqiy tarmoqsiz).
  Tekshiriladi: veb-huk tasdig‘i (hub.challenge), imzo (X-Hub-Signature-256) — noto‘g‘ri imzo rad etiladi;
  mijoz xabari → suhbat va 24 soatlik oyna; takroriy hodisa dublikat bermaydi; sotuvchi Instagram ilovasidan yozsa AI to‘xtaydi;
  rasm — panelda ochiladi (havola keshlanadi); javob yuborish manzili va tanasi; xatolar (oyna yopiq, server xatosi).
*/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sales-ig-'));
Object.assign(process.env, {
  DB_FILE: join(dir, 't.db'), DATA_DIR: dir, TG_DISABLED: '1', ENV_FILE: join(dir, 'yoq.env'), DRAFT_DEBOUNCE_MS: '50',
  IG_TOKEN: 'IGQ-sinov-token', IG_USER_ID: '17841400000000000', IG_APP_SECRET: 'sir-app', IG_VERIFY_TOKEN: 'verify-123', IG_API_BASE: 'https://ig.sinov/v23.0'
});

const calls = [];
let sendFail = null, mediaBytes = Buffer.from('JPEGDATA');
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  calls.push({ url: u, opts });
  if (u.startsWith('https://cdn.ig.sinov/')) return { ok: true, status: 200, arrayBuffer: async () => mediaBytes.buffer.slice(mediaBytes.byteOffset, mediaBytes.byteOffset + mediaBytes.length) };
  if (u.endsWith('/messages')) {
    const b = JSON.parse(opts.body);
    if (b.sender_action) return { ok: true, status: 200, json: async () => ({ recipient_id: b.recipient.id }) };
    if (sendFail) { const f = sendFail; sendFail = null; return { ok: false, status: f.status, json: async () => ({ error: { message: f.message, code: f.code, error_subcode: f.subcode } }) }; }
    // Izohga shaxsiy javob (recipient.comment_id) — Meta IGSID qaytaradi
    return { ok: true, status: 200, json: async () => ({ recipient_id: b.recipient.id || (b.recipient.comment_id ? '7766554433' : undefined), message_id: 'mid.out.' + calls.length }) };
  }
  if (u.includes('/refresh_access_token')) return { ok: true, status: 200, json: async () => ({ access_token: 'IGQ-yangi-token', token_type: 'bearer', expires_in: 5184000 }) };
  if (u.includes('/me/subscribed_apps')) return { ok: true, status: 200, json: async () => ({ success: true }) };
  if (u.includes('/5544332211?fields=name,username')) return { ok: true, status: 200, json: async () => ({ name: 'Ali Valiyev', username: 'ali_v', id: '5544332211' }) };
  if (u.includes('/me?fields=')) return { ok: true, status: 200, json: async () => ({ user_id: IGID, username: 'photobuy' }) };
  // Do‘konning o‘z postlari (ulashilgan reels/post tanish uchun)
  if (u.includes('/me/media?')) return { ok: true, status: 200, json: async () => ({ data: [
    { id: 'own1', permalink: 'https://www.instagram.com/reel/OWNREEL1/', media_type: 'VIDEO', caption: 'Godox C01 — Reels va intervyu uchun ixcham simsiz petlichka 🎙\nNarxi so‘rang', thumbnail_url: 'https://cdn.ig.sinov/own1-cover.jpg' },
    { id: 'own2', permalink: 'https://www.instagram.com/p/OWNPOST2/', media_type: 'IMAGE', caption: 'Sony ZV-E10 kit', media_url: 'https://cdn.ig.sinov/own2.jpg' }
  ] }) };
  if (u.includes('/media.sinov.1?fields=caption')) return { ok: true, status: 200, json: async () => ({ caption: 'SONY ZV E 10 SINOV — vlog kamerasi\nNarxi so‘rang' }) };
  if (u.endsWith('/replies')) return { ok: true, status: 200, json: async () => ({ id: 'reply-1' }) };
  return { ok: false, status: 404, json: async () => ({ error: { message: 'not found' } }) };
};

const { migrate, run, one, all } = await import('../src/db.js');
const inbox = await import('../src/services/inbox.js');
const { updateSettings } = await import('../src/services/settings.js');
const ig = await import('../src/channels/instagram.js');
const { fetchMedia } = await import('../src/services/media.js');

const IGID = process.env.IG_USER_ID, CLIENT = '9988776655';
const sign = raw => 'sha256=' + createHmac('sha256', 'sir-app').update(raw).digest('hex');
const event = (msg, { sender = CLIENT, recipient = IGID, ts = Date.now() } = {}) =>
  ({ object: 'instagram', entry: [{ id: IGID, time: ts, messaging: [{ sender: { id: sender }, recipient: { id: recipient }, timestamp: ts, message: msg }] }] });
const conv = (chat = CLIENT) => one(`SELECT c.* FROM conversations c JOIN accounts a ON a.id=c.account_id WHERE a.channel='ig' AND c.ext_chat_id=?`, chat);
const msgs = (c, author) => all('SELECT * FROM messages WHERE conversation_id=?' + (author ? ' AND author=?' : ''), ...(author ? [c.id, author] : [c.id]));
const body = c => { try { return JSON.parse(c.opts.body); } catch { return {}; } };
const sends = () => calls.filter(c => c.url.endsWith('/messages') && body(c).message);
const actions = a => calls.filter(c => c.url.endsWith('/messages') && body(c).sender_action === a);
const sleep = ms => new Promise(r => setTimeout(r, ms));

before(() => {
  migrate();
  run(`INSERT INTO users(id,login,name,role,created_at) VALUES(1,'sinov','Sinov sotuvchi','sotuvchi',0)`);
  updateSettings({ T_seconds: 1, work_from: '00:00', work_to: '23:59', night_autoreply: false }, 'test', { unchecked: true });
  inbox.setInboxHooks({
    draft: async ({ conv }) => ({ ok: true, text: `Salom! Javob #${conv.id}`, sources: ['sinov'], card: {} }),
    send: (acct, c, text) => ig.sendInstagram(acct, c, text),
    notify: () => {}
  });
  inbox.startEngine();
});
after(() => { inbox.stopEngine(); rmSync(dir, { recursive: true, force: true }); });

test('veb-huk tasdig‘i: to‘g‘ri verify_token — challenge qaytadi, noto‘g‘risi rad etiladi', () => {
  const ok = ig.verifyWebhook(new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-123', 'hub.challenge': '424242' }));
  assert.deepEqual([ok.ok, ok.code, ok.body], [true, 200, '424242']);
  const bad = ig.verifyWebhook(new URLSearchParams({ 'hub.mode': 'subscribe', 'hub.verify_token': 'boshqa', 'hub.challenge': '1' }));
  assert.deepEqual([bad.ok, bad.code], [false, 403]);
});

test('imzo: faqat to‘g‘ri X-Hub-Signature-256 qabul qilinadi', () => {
  const raw = Buffer.from(JSON.stringify(event({ mid: 'm0', text: 'salom' })));
  assert.equal(ig.validSignature(raw, sign(raw)), true);
  assert.equal(ig.validSignature(raw, sign(Buffer.from('boshqa'))), false, 'boshqa tana imzosi');
  assert.equal(ig.validSignature(raw, 'sha256=' + 'a'.repeat(64)), false);
  assert.equal(ig.validSignature(raw, null), false);
  assert.equal(ig.validSignature(Buffer.concat([raw, Buffer.from(' ')]), sign(raw)), false, 'tana o‘zgarsa — rad');
});

test('mijoz xabari: akkaunt «kuzatish» rejimida ochiladi, 24 soatlik oyna qo‘yiladi', async () => {
  await ig.handleWebhook(event({ mid: 'm1', text: 'Assalomu alaykum, Sony A7 IV bormi?' }));
  const a = one(`SELECT * FROM accounts WHERE channel='ig'`);
  assert.equal(a.rollout, 'kuzatish');
  assert.equal(a.ext_id, IGID);
  const c = conv();
  assert.equal(msgs(c, 'client').length, 1);
  assert.ok(c.window_until > Date.now() + 23 * 3600e3);
  assert.ok(c.pending_since);
});

test('bir xil hodisa qayta kelsa (Meta takroran yuborsa) — xabar ikki marta yozilmaydi', async () => {
  await ig.handleWebhook(event({ mid: 'm1', text: 'Assalomu alaykum, Sony A7 IV bormi?' }));
  assert.equal(msgs(conv(), 'client').length, 1);
});

test('avto: T tugagach javob Meta’ga to‘g‘ri manzil va tana bilan yuboriladi', async () => {
  run(`UPDATE accounts SET rollout='avto' WHERE channel='ig'`);
  const before = sends().length;
  await ig.handleWebhook(event({ mid: 'm2', text: 'Narxi qancha?' }));
  for (let i = 0; i < 100 && sends().length === before; i++) await sleep(50);
  const s = sends().at(-1);
  assert.equal(s.url, `https://ig.sinov/v23.0/${IGID}/messages`);
  assert.equal(s.opts.headers.authorization, 'Bearer IGQ-sinov-token');
  const body = JSON.parse(s.opts.body);
  assert.equal(body.recipient.id, CLIENT);
  assert.ok(body.message.text.startsWith('Salom!'));
  await sleep(100);
  assert.equal(msgs(conv(), 'ai').length, 1);
  assert.equal(conv().pending_since, null);
});

test('sotuvchi Instagram ilovasidan yozsa (is_echo) — AI javobi bekor bo‘ladi', async () => {
  const before = sends().length;
  await ig.handleWebhook(event({ mid: 'm3', text: 'Yetkazib berasizmi?' }));
  await sleep(120);
  await ig.handleWebhook(event({ mid: 'm4', text: 'Ha, bugun yetkazamiz', is_echo: true }, { sender: IGID, recipient: CLIENT }));
  await sleep(1600);
  assert.equal(sends().length, before, 'AI yubormadi');
  const c = conv();
  assert.equal(c.pending_since, null);
  assert.equal(msgs(c, 'seller').length, 1);
});

test('Meta Business Suite avtojavobi (is_echo) — sotuvchi javobi EMAS: AI kutishi saqlanadi va javob baribir ketadi', async () => {
  const before = sends().length, sellers = msgs(conv(), 'seller').length;
  await ig.handleWebhook(event({ mid: 'm4a', text: 'Quyosh stansiya narxi qancha?' }));
  await sleep(120);
  const auto = 'Assalomu alaykum ali_v  , xabaringiz uchun tashakkur.\nQuyosh stansiya bo‘yicha savollaringizga javob olish uchun bizga qo\'ng\'iroq qiling yoki telegramdan yozing.\n\nMenejer: +998 55-506-78-88';
  await ig.handleWebhook(event({ mid: 'm4b', text: auto, is_echo: true }, { sender: IGID, recipient: CLIENT }));
  // Avtojavobga ergashgan matnsiz aks-sado (tugma/karta) — ham avtojavob
  await ig.handleWebhook(event({ mid: 'm4c', attachments: [{ type: 'template', payload: {} }], is_echo: true }, { sender: IGID, recipient: CLIENT }));
  let c = conv();
  assert.ok(c.pending_since, 'kutish o‘chmadi');
  assert.equal(msgs(c, 'seller').length, sellers, 'sotuvchi javobi deb yozilmadi');
  const sys = msgs(c, 'system').filter(m => JSON.parse(m.meta).tag === 'Meta avtojavobi');
  assert.equal(sys.length, 2);
  assert.equal(JSON.parse(sys[0].meta).via, 'instagram');
  for (let i = 0; i < 100 && sends().length === before; i++) await sleep(50);
  assert.equal(sends().length, before + 1, 'AI javobi baribir yuborildi');
  await sleep(100);
  c = conv();
  assert.equal(c.pending_since, null);
});

test('sotuvchining haqiqiy javobi avtojavob ortidan 15 s dan keyin kelsa — baribir sotuvchi javobi', async () => {
  await ig.handleWebhook(event({ mid: 'm4d', text: 'Yana bir savol' }));
  await sleep(120);
  const t = Date.now();
  await ig.handleWebhook(event({ mid: 'm4e', text: 'Assalomu alaykum ali_v, xabaringiz uchun tashakkur. Menejer: +998 55', is_echo: true }, { sender: IGID, recipient: CLIENT, ts: t }));
  await ig.handleWebhook(event({ mid: 'm4f', attachments: [{ type: 'image', payload: { url: 'https://cdn.ig.sinov/seller.jpg' } }], is_echo: true }, { sender: IGID, recipient: CLIENT, ts: t + 20000 }));
  const c = conv();
  assert.equal(c.pending_since, null, 'sotuvchi rasm yubordi — AI to‘xtadi');
  assert.ok(msgs(c, 'seller').some(m => m.ext_msg_id === 'm4f'));
});

test('rasm: matn «[rasm]», havola meta’da; fayl yuklab olinadi va keshlanadi', async () => {
  const url = 'https://cdn.ig.sinov/photo1.jpg?sig=abc';
  await ig.handleWebhook(event({ mid: 'm5', attachments: [{ type: 'image', payload: { url } }] }));
  const m = msgs(conv()).find(x => x.ext_msg_id === 'm5');
  assert.equal(m.text, '[rasm]');
  const media = JSON.parse(m.meta).media;
  assert.deepEqual([media.ch, media.kind, media.url], ['ig', 'photo', url]);
  const buf = await fetchMedia(media);
  assert.equal(buf.toString(), 'JPEGDATA');
  const n = calls.filter(c => c.url.startsWith('https://cdn.ig.sinov/')).length;
  await fetchMedia(media);
  assert.equal(calls.filter(c => c.url.startsWith('https://cdn.ig.sinov/')).length, n, 'ikkinchi marta keshdan');
  await sleep(1500);
  run('UPDATE conversations SET pending_since=NULL, ai_due_at=NULL WHERE id=?', conv().id);
});

test('xatolar: oyna yopiq (Meta 10/2534022) aniq xato, server xatosi — «noma’lum»', async () => {
  const c = conv(), a = one(`SELECT * FROM accounts WHERE channel='ig'`);
  sendFail = { status: 400, code: 10, subcode: 2534022, message: 'This message is sent outside of allowed window' };
  await assert.rejects(ig.sendInstagram(a, c, 'salom'), e => {
    assert.match(e.message, /allowed window \(10\/2534022\)/);
    assert.ok(!e.uncertain, 'aniq xato — qayta yuborilmaydi');
    return true;
  });
  sendFail = { status: 500, code: 1, message: 'Unknown' };
  await assert.rejects(ig.sendInstagram(a, c, 'salom'), e => e.uncertain === true);
});

test('storyga javob va storyda eslatish belgilanadi', async () => {
  await ig.handleWebhook(event({ mid: 'm6', text: 'Shu narsa bormi?', reply_to: { story: { id: 's1', url: 'https://cdn.ig.sinov/story.jpg' } } }));
  const m = msgs(conv()).find(x => x.ext_msg_id === 'm6');
  assert.equal(JSON.parse(m.meta).story_reply, true);
  // Story rasmi AI’ga ko‘rsatiladi: matnda belgi, metada havola (saqlanmaydi — story)
  assert.equal(m.text, '[storyga javob] Shu narsa bormi?');
  assert.deepEqual(JSON.parse(m.meta).media, { ch: 'ig', kind: 'photo', url: 'https://cdn.ig.sinov/story.jpg', mime: 'image/jpeg', story: true });
  await ig.handleWebhook(event({ mid: 'm7', attachments: [{ type: 'story_mention', payload: { url: 'https://cdn.ig.sinov/sm.jpg' } }] }));
  const sm = msgs(conv()).find(x => x.ext_msg_id === 'm7');
  assert.equal(sm.text, '[storysida eslatdi]');
  assert.equal(JSON.parse(sm.meta).media.story, true);
});

test('«ko‘rildi» faqat javob yuborilganda qo‘yiladi — xabar kelganda emas (javobsiz qolsa mijoz «ko‘rildi»ni ko‘rmaydi)', async () => {
  const before = actions('mark_seen').length;
  await ig.handleWebhook(event({ mid: 'm8', text: 'shu yerdamisiz?' }));
  await sleep(50);
  assert.equal(actions('mark_seen').length, before, 'xabar kelganda «ko‘rildi» yuborilmaydi');
  await ig.sendInstagram(one(`SELECT * FROM accounts WHERE channel='ig'`), conv(), 'Ha, shu yerdamiz!');
  await sleep(50);
  assert.equal(actions('mark_seen').length, before + 1, 'javob bilan birga «ko‘rildi»');
  const a = actions('mark_seen').at(-1);
  assert.equal(body(a).recipient.id, CLIENT);
  assert.equal(body(a).message, undefined, 'sender_action alohida yuboriladi');
  run('UPDATE conversations SET pending_since=NULL, ai_due_at=NULL WHERE id=?', conv().id);
});

test('matn 1000 BAYT bo‘yicha kesiladi va belgi o‘rtasidan bo‘linmaydi', async () => {
  const long = 'ў'.repeat(900);                       // har biri 2 bayt
  const clipped = ig.clipBytes(long, 1000);
  assert.ok(Buffer.byteLength(clipped, 'utf8') <= 1000);
  assert.equal(clipped, 'ў'.repeat(500));
  assert.equal(ig.clipBytes('qisqa', 1000), 'qisqa');
});

test('token 60 kunda tugaydi: 30 kundan keyin avtomatik yangilanadi va bazaga yoziladi', async () => {
  const { kvGet, kvSet } = await import('../src/db.js');
  kvSet('ig_token_at', Date.now() - 31 * 864e5);
  const r = await ig.igTokenJob();
  assert.equal(r.ok, true);
  assert.equal(kvGet('ig_token'), 'IGQ-yangi-token');
  assert.ok(Date.now() - Number(kvGet('ig_token_at')) < 5000);
  const c = conv(), a = one(`SELECT * FROM accounts WHERE channel='ig'`);
  await ig.sendInstagram(a, c, 'yangi token bilan');
  assert.equal(sends().at(-1).opts.headers.authorization, 'Bearer IGQ-yangi-token', 'yangi token ishlatiladi');
  assert.equal(await ig.igTokenJob(), null, 'yaqinda yangilangan — qayta so‘ralmaydi');
});

test('ish boshida: profil o‘qiladi va veb-huk obunasi qilinadi', async () => {
  const ok = await ig.startInstagram();
  assert.equal(ok, true);
  assert.ok(calls.some(c => c.url.includes('/me/subscribed_apps') && c.url.includes('messaging_seen') && !c.url.includes('message_echoes')), 'faqat ruxsat etilgan maydonlar');
  const { integration } = await import('../src/services/settings.js');
  assert.equal(integration('instagram').state, 'ok');
  assert.match(integration('instagram').detail, /@photobuy/);
});

test('o‘chirilgan xabar: tarixda belgilanadi va AI unga javob yozmaydi', async () => {
  const before = sends().length;
  await ig.handleWebhook(event({ mid: 'm9', text: 'xato yozdim' }));
  assert.ok(conv().pending_since);
  await ig.handleWebhook(event({ mid: 'm9', is_deleted: true }));
  assert.equal(conv().pending_since, null);
  const m = msgs(conv()).find(x => x.ext_msg_id === 'm9');
  assert.ok(JSON.parse(m.meta).deleted_at);
  await sleep(1500);
  assert.equal(sends().length, before, 'javob yuborilmadi');
});

test('tahrirlangan xabar: yangi matn, avvalgisi saqlanadi', async () => {
  await ig.handleWebhook(event({ mid: 'm10', text: 'Sony A7 III bormi?' }));
  await ig.handleWebhook({ object: 'instagram', entry: [{ id: IGID, time: Date.now(), messaging: [{ sender: { id: CLIENT }, recipient: { id: IGID }, timestamp: Date.now(), message_edit: { mid: 'm10', text: 'Sony A7 IV bormi?', num_edit: 1 } }] }] });
  const m = msgs(conv()).find(x => x.ext_msg_id === 'm10');
  assert.equal(m.text, 'Sony A7 IV bormi?');
  assert.equal(JSON.parse(m.meta).original, 'Sony A7 III bormi?');
  run('UPDATE conversations SET pending_since=NULL, ai_due_at=NULL WHERE id=?', conv().id);
});

test('post ulashish: «share» o‘rniga «ig_post» (Meta 27.04.2026 dan) — ikkalasi ham tushuniladi', async () => {
  await ig.handleWebhook(event({ mid: 'm11', attachments: [{ type: 'ig_post', payload: { url: 'https://cdn.ig.sinov/post.jpg', id: 'p1' } }] }));
  assert.equal(msgs(conv()).find(x => x.ext_msg_id === 'm11').text, '[post ulashdi]');
  await ig.handleWebhook(event({ mid: 'm12', attachments: [{ type: 'ephemeral' }] }));
  const e = msgs(conv()).find(x => x.ext_msg_id === 'm12');
  assert.equal(e.text, '[yo‘qoluvchi media]');
  assert.equal(e.meta, null, 'havolasi yo‘q — media saqlanmaydi');
  run('UPDATE conversations SET pending_since=NULL, ai_due_at=NULL WHERE id=?', conv().id);
});

test('mijoz ismi va @username profildan olinadi; profil o‘qilmasa suhbat ismsiz qoladi', async () => {
  await ig.handleWebhook(event({ mid: 'p1', text: 'salom' }, { sender: '5544332211', recipient: IGID }));
  const c = conv('5544332211');
  assert.equal(c.display_name, 'Ali Valiyev');
  assert.equal(c.handle, '@ali_v');
  assert.equal(conv().display_name, null, 'profil 404 — ism yo‘q, xato ham chiqmaydi');
});

test('ulashilgan post: izohi matnda, rasmi AI’ga ilova qilinadi (Instagram ham); reels — AI’ga rasm sifatida bermaydi', async () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('JFIF-sinov-rasm-baytlari')]);
  mediaBytes = jpeg;
  await ig.handleWebhook(event({ mid: 'm20', attachments: [{ type: 'ig_post', payload: { url: 'https://cdn.ig.sinov/post-zv.jpg', title: 'Sony ZV-E10 bilan vlog — yangi kolleksiya' } }] }));
  const m = msgs(conv()).find(x => x.ext_msg_id === 'm20');
  assert.equal(m.text, '[post ulashdi] «Sony ZV-E10 bilan vlog — yangi kolleksiya»');
  const { recentImages } = await import('../src/agents/fokus.js');
  const imgs = await recentImages(conv(), one(`SELECT * FROM accounts WHERE channel='ig'`));
  assert.ok(imgs.some(i => i.mime === 'image/jpeg' && Buffer.from(i.data, 'base64').equals(jpeg)), 'post rasmi AI’ga boradi');
  await ig.handleWebhook(event({ mid: 'm21', attachments: [{ type: 'ig_reel', payload: { url: 'https://cdn.ig.sinov/reel.mp4' } }] }));
  assert.equal(msgs(conv()).find(x => x.ext_msg_id === 'm21').text, '[reels]');
  const imgs2 = await recentImages(conv(), one(`SELECT * FROM accounts WHERE channel='ig'`));
  assert.equal(imgs2.length, imgs.length, 'reels (video) rasm sifatida berilmaydi');
  mediaBytes = Buffer.from('JPEGDATA');
  run('UPDATE conversations SET pending_since=NULL, ai_due_at=NULL WHERE id=?', conv().id);
});

test('bizning reels/post ulashilsa — izohi matnga, muqova rasmi AI’ga; boshqa akkaunt reelsi — «[reels]» bo‘lib qoladi', async () => {
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('COVER-sinov')]);
  mediaBytes = jpeg;
  await ig.handleWebhook(event({ mid: 'm30', attachments: [{ type: 'ig_reel', payload: { url: 'https://www.instagram.com/reel/OWNREEL1/' } }] }));
  const m = msgs(conv()).find(x => x.ext_msg_id === 'm30');
  assert.equal(m.text, '[reels] «Godox C01 — Reels va intervyu uchun ixcham simsiz petlichka 🎙 Narxi so‘rang»');
  const media = JSON.parse(m.meta).media;
  assert.equal(media.own, true); assert.equal(media.thumb, 'https://cdn.ig.sinov/own1-cover.jpg');
  const { recentImages } = await import('../src/agents/fokus.js');
  const imgs = await recentImages(conv(), one(`SELECT * FROM accounts WHERE channel='ig'`));
  assert.ok(imgs.some(i => Buffer.from(i.data, 'base64').equals(jpeg)), 'reels muqovasi AI’ga boradi');
  await ig.handleWebhook(event({ mid: 'm31', attachments: [{ type: 'ig_reel', payload: { url: 'https://www.instagram.com/reel/BOSHQA999/' } }] }));
  const o = msgs(conv()).find(x => x.ext_msg_id === 'm31');
  assert.equal(o.text, '[reels]');
  assert.equal(JSON.parse(o.meta).media.thumb, undefined);
  await ig.handleWebhook(event({ mid: 'm32', attachments: [{ type: 'ig_post', payload: { url: 'https://www.instagram.com/p/OWNPOST2/', title: 'Sony ZV-E10 kit' } }] }));
  assert.equal(JSON.parse(msgs(conv()).find(x => x.ext_msg_id === 'm32').meta).media.thumb, 'https://cdn.ig.sinov/own2.jpg', 'rasmli post — media_url muqova');
  mediaBytes = Buffer.from('JPEGDATA');
  run('UPDATE conversations SET pending_since=NULL, ai_due_at=NULL WHERE id=?', conv().id);
});

test('izoh: katalogda narxi bo‘lsa shaxsiy javobda narx; suhbat panelda ochiladi (izoh + javob), kutish qo‘yilmaydi', async () => {
  run(`INSERT INTO products(name,category,price,stock_json,stock_synced_at,status,billz_id,updated_at) VALUES('SONY ZV E 10 SINOV — Фотоаппарат','Фотоаппарат',670,?,?, 'draft','B-zv-sinov',?)`, JSON.stringify({ Photobuy: 2 }), Date.now(), Date.now());
  const n0 = sends().length;
  await ig.handleWebhook({ object: 'instagram', entry: [{ id: IGID, time: Date.now(), changes: [{ field: 'comments', value: { id: 'c-100', text: 'narxi qancha?', from: { id: '5566', username: 'izohchi' }, media: { id: 'media.sinov.1' } } }] }] });
  const priv = sends().slice(n0).find(c => body(c).recipient.comment_id === 'c-100');
  assert.ok(priv, 'shaxsiy javob ketdi');
  assert.match(body(priv).message.text, /SONY ZV E 10 SINOV narxi 670(\$| so‘m), do‘konda bor/);   // valyuta — sozlamadan (sinovda so‘m)
  const c = conv('7766554433');
  assert.ok(c, 'suhbat ochildi');
  const ms = msgs(c);
  assert.equal(ms[0].text, '[izoh · SONY ZV E 10 SINOV] narxi qancha?');
  assert.equal(ms[1].author, 'ai');
  assert.equal(c.pending_since, null, 'AI qayta yozmaydi — izohga bitta javob');
  assert.equal(c.handle, '@izohchi');
  // Ruscha izoh — ruscha javob; bir izohga ikkinchi marta yozilmaydi
  await ig.handleWebhook({ object: 'instagram', entry: [{ id: IGID, time: Date.now(), changes: [{ field: 'comments', value: { id: 'c-101', text: 'сколько стоит?', from: { id: '5567', username: 'ru_user' }, media: { id: 'media.sinov.1' } } }] }] });
  assert.match(body(sends().at(-1)).message.text, /Здравствуйте! SONY ZV E 10 SINOV — 670(\$| so‘m), есть в наличии/);   // ochiq javob /replies ga ketadi, sends() da yo‘q
  const n1 = sends().length;
  await ig.handleWebhook({ object: 'instagram', entry: [{ id: IGID, time: Date.now(), changes: [{ field: 'comments', value: { id: 'c-100', text: 'narxi qancha?', from: { id: '5566', username: 'izohchi' }, media: { id: 'media.sinov.1' } } }] }] });
  assert.equal(sends().length, n1, 'takroriy izoh — javob yo‘q');
});

test('izohga javob: BILLZ aksiyasi hamma do‘konda — aksiya narxi odatiy narx bilan; faqat bitta do‘konda — oddiy narx', async () => {
  const ins = (name, prices, stock) => run(`INSERT INTO products(name,category,price,price_json,stock_json,stock_synced_at,status,billz_id,updated_at) VALUES(?,?,?,?,?,?,'draft',?,?)`,
    name, 'Свет', 300, JSON.stringify(prices), JSON.stringify(stock), Date.now(), 'B-' + name, Date.now());
  ins('NANLITE AKSIYA SINOV — Свет', { Photobuy: { price: 300, currency: 'USD', promo: 250, promo_name: 'Kuzgi' } }, { Photobuy: 2 });
  ins('GODOX YARIMAKSIYA SINOV — Свет', { Photobuy: { price: 300, currency: 'USD', promo: 250 }, Photobuy2: { price: 300, currency: 'USD' } }, { Photobuy: 2, Photobuy2: 1 });
  assert.match(await ig.commentReply('narxi qancha?', 'NANLITE AKSIYA SINOV'), /NANLITE AKSIYA SINOV hozir aksiyada: 250(\$| so‘m).*odatiy narxi 300(\$| so‘m)\. Do‘konda bor/);
  assert.match(await ig.commentReply('сколько стоит?', 'NANLITE AKSIYA SINOV'), /сейчас по акции: 250(\$| so‘m).*обычная цена 300/);
  assert.match(await ig.commentReply('narxi qancha?', 'GODOX YARIMAKSIYA SINOV'), /GODOX YARIMAKSIYA SINOV narxi 300(\$| so‘m), do‘konda bor/, 'aksiya faqat bitta do‘konda — oddiy narx');
});
