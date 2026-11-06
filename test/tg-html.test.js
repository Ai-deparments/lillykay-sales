/*
  Telegram HTML eksporti: yuboruvchi to‘g‘ri aniqlanadi (joined, yo‘naltirilgan), sahifalar ulanadi, media belgilanadi,
  arxiv suhbati navbatga tushmaydi, eski mijoz qayta yozsa arxiv jonlanadi, qidiruv va arxiv ro‘yxati ishlaydi,
  AI o‘xshash savolga do‘kon javobini topadi (shaxsiy ma’lumotsiz).
*/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const dir = mkdtempSync(join(tmpdir(), 'sales-tgh-'));
process.env.DB_FILE = join(dir, 't.db'); process.env.DATA_DIR = dir; process.env.TG_DISABLED = '1'; process.env.DRAFT_DEBOUNCE_MS = '999999';
const { migrate, run, one, all } = await import('../src/db.js');
const { parsePage, parseChatDir, detectOwner, buildPlan, parseDate, decode } = await import('../src/services/tg-html.js');
const { applyImport } = await import('../src/services/tg-import.js');
const { ingestClient, drainInbox } = await import('../src/services/inbox.js');
const { pairsFrom, rebuildPairs, similarPairs, scrub } = await import('../src/services/uslub.js');
const { hashPassword } = await import('../src/core/auth.js');
const { handle } = await import('../src/web.js');

const msg = ({ id, at, from, joined, body }) => `
<div class="message default clearfix${joined ? ' joined' : ''}" id="message${id}">
 <div class="body">
  <div class="pull_right date details" title="${at} UTC+05:00">${at.slice(11, 16)}</div>
  ${from ? `<div class="from_name">\n${from}\n  </div>` : ''}
  ${body}
 </div>
</div>`;
const text = t => `<div class="text">\n${t}\n  </div>`;
const page = (name, msgs) => `<!DOCTYPE html><html><body><div class="page_wrap"><div class="page_header"><div class="content"><div class="text bold">\n${name}\n</div></div></div>
<div class="page_body chat_page"><div class="history">
<div class="message service" id="message-1"><div class="body details">5 June 2026</div></div>
${msgs.join('\n')}
</div></div></div></body></html>`;

const OWNER = 'Photobuy.uz';
const CHAT1 = page('Aziz Karimov', [
  msg({ id: 100, at: '05.06.2026 11:20:49', from: 'Aziz Karimov', body: text('Salom, Canon R50 bormi? Narxi qancha?') }),
  msg({ id: 101, at: '05.06.2026 11:21:10', joined: true, body: '<div class="media_wrap clearfix"><a class="photo_wrap clearfix pull_left" href="photos/p.jpg"><img class="photo" src="photos/p_thumb.jpg"></a></div>' }),
  msg({ id: 102, at: '05.06.2026 11:25:00', from: OWNER, body: `<div class="forwarded body"><div class="from_name">\nPhotobuy kanal <span class="date details" title="01.06.2026 10:00:00 UTC+05:00"> 01.06.2026</span>\n</div>${text('Canon R50 kit — yangi keldi')}</div>` }),
  msg({ id: 103, at: '05.06.2026 11:25:30', joined: true, body: text('Ha bor, &quot;Chilonzor&quot; filialida<br>Kelasizmi? Tel: +998 90 123 45 67') }),
  msg({ id: 104, at: '05.06.2026 11:40:00', from: 'Aziz Karimov', body: '<div class="media_wrap clearfix"><a class="media clearfix pull_left block_link media_voice_message" href="voice_messages/a.ogg"><div class="body"><div class="title bold">Voice message</div></div></a></div>' }),
  msg({ id: 105, at: '05.06.2026 11:41:00', from: 'Aziz Karimov', body: text('sticker yopishtirsa bo‘ladimi') })
]);
const CHAT2_P1 = page('Dilnoza Rahimova', [
  msg({ id: 10, at: '01.03.2026 09:00:00', from: 'Dilnoza Rahimova', body: text('Sony A7 IV rassrochkaga bormi?') }),
  msg({ id: 11, at: '01.03.2026 09:05:00', from: OWNER, body: text('Assalomu alaykum! Ha, muddatli to‘lov bor, 6 va 12 oy.') })
]);
const CHAT2_P2 = page('Dilnoza Rahimova', [
  msg({ id: 12, at: '01.03.2026 09:06:00', joined: true, body: text('Pasport bilan kelasiz, 20 daqiqada rasmiylashtiramiz.') }),
  msg({ id: 13, at: '01.03.2026 09:30:00', from: 'Dilnoza Rahimova', body: text('Rahmat') })
]);
const GROUP = page('Ishchilar guruhi', [
  msg({ id: 1, at: '01.02.2025 10:00:00', from: 'Ali', body: text('bugun kim navbatchi') }),
  msg({ id: 2, at: '01.02.2025 10:01:00', from: 'Vali', body: text('men') }),
  msg({ id: 3, at: '01.02.2025 10:02:00', from: OWNER, body: text('yaxshi') })
]);
const BOT = page('BotFather', [msg({ id: 1, at: '01.01.2025 10:00:00', from: OWNER, body: text('/start') })]);
const BOT2 = page('Photobuy Sales', [msg({ id: 1, at: '01.01.2025 10:00:00', from: OWNER, body: text('/start') }), msg({ id: 2, at: '01.01.2025 10:00:01', from: 'Photobuy Sales', body: text('Telefon raqamingizni ulashing') })]);
const SOLO = page('Aziz', [msg({ id: 7, at: '02.02.2025 10:00:00', from: 'Aziz', body: text('Nikon Z50 bormi') }), msg({ id: 8, at: '02.02.2025 10:02:00', from: OWNER, body: text('Bor, marhamat') })]);

const root = join(dir, 'chats');
const put = (d, f, html) => { mkdirSync(join(root, d), { recursive: true }); writeFileSync(join(root, d, f), html); };
let acct, server, base;
before(async () => {
  migrate();
  put('chat_0001', 'messages.html', CHAT1);
  put('chat_0002', 'messages.html', CHAT2_P1); put('chat_0002', 'messages2.html', CHAT2_P2);
  put('chat_0003', 'messages.html', GROUP);
  put('chat_0004', 'messages.html', BOT);
  put('chat_0005', 'messages.html', SOLO);
  put('chat_0006', 'messages.html', BOT2);
  put('chat_0007', 'messages.html', page(OWNER, [msg({ id: 1, at: '01.01.2026 10:00:00', from: OWNER, body: text('To‘lov keldi 295 000') })]));
  acct = one('SELECT * FROM accounts WHERE id=?', run(`INSERT INTO accounts(channel,ext_id,name,tg_owner_id,can_reply,enabled,mode,rollout,created_at) VALUES('tg','bc1','Photobuy.uz',5550001,1,1,'kechiksa','kuzatish',?)`, Date.now()).lastInsertRowid);
  run(`INSERT INTO users(login,name,role,pass_hash,created_at) VALUES('r','Rahbar','rahbar',?,?)`, hashPassword('parol12345'), Date.now());
  server = createServer(handle);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await drainInbox(100); server.close(); rmSync(dir, { recursive: true, force: true }); });

const chats = () => ['chat_0001', 'chat_0002', 'chat_0003', 'chat_0004', 'chat_0005', 'chat_0006', 'chat_0007'].map(d => ({ dir: d, ...parseChatDir(join(root, d)) }));

test('sana va HTML belgilari to‘g‘ri o‘qiladi', () => {
  assert.equal(parseDate('05.06.2026 11:20:49 UTC+05:00'), Date.parse('2026-06-05T06:20:49Z'));
  assert.equal(decode('a &quot;b&quot;<br>c &#39;d&#39; &amp;'), 'a "b"\nc \'d\' &');
});

test('yuboruvchi: joined oldingisiniki, yo‘naltirilgan xabar ichidagi ism — yuboruvchi emas', () => {
  const r = parsePage(CHAT1);
  assert.equal(r.name, 'Aziz Karimov');
  assert.deepEqual(r.msgs.map(m => m.from), ['Aziz Karimov', 'Aziz Karimov', OWNER, OWNER, 'Aziz Karimov', 'Aziz Karimov']);
  assert.equal(r.msgs[1].text, '[rasm]');
  assert.match(r.msgs[2].text, /^\[yo‘naltirilgan\] Canon R50 kit/);
  assert.equal(r.msgs[3].text, 'Ha bor, "Chilonzor" filialida\nKelasizmi? Tel: +998 90 123 45 67');
  assert.equal(r.msgs[4].text, '[ovozli xabar]');
  assert.equal(r.msgs[5].text, 'sticker yopishtirsa bo‘ladimi', 'matndagi «sticker» so‘zi stiker deb belgilanmaydi');
});

test('sahifalar tartib bilan ulanadi, 2-sahifa boshidagi joined — 1-sahifa oxirgi yuboruvchisiniki', () => {
  const c = parseChatDir(join(root, 'chat_0002'));
  assert.equal(c.msgs.length, 4);
  assert.deepEqual(c.msgs.map(m => m.from), ['Dilnoza Rahimova', OWNER, OWNER, 'Dilnoza Rahimova']);
});

test('ega aniqlanadi; guruh va bot chatlari olinmaydi; ega xabari — sotuvchi', () => {
  const cs = chats();
  assert.equal(detectOwner(cs).owner, OWNER);
  const { plan, skipped } = buildPlan(cs, OWNER);
  assert.deepEqual(plan.map(p => p.name).sort(), ['Aziz', 'Aziz Karimov', 'Dilnoza Rahimova']);
  assert.equal(skipped.guruh, 1); assert.equal(skipped.xizmat, 3, 'BotFather (nom), «/start» yuborilgan bot va egasining o‘z nomidagi chat');
  const az = plan.find(p => p.name === 'Aziz Karimov');
  assert.deepEqual(az.msgs.map(m => m.author), ['client', 'client', 'seller', 'seller', 'client', 'client']);
});

let convIds;
test('import: arxiv suhbat, navbatsiz, ta’qibsiz; qayta import takrorlamaydi', () => {
  const { plan } = buildPlan(chats(), OWNER);
  const items = plan.map(c => ({ chatId: `tgarx:${c.dir}`, userId: null, name: c.name, msgs: c.msgs.map(m => ({ ...m, id: `x${m.id}` })) }));
  const r = applyImport(acct, items, 'Telegram HTML eksporti');
  assert.equal(r.created, 3); assert.equal(r.added, 12);
  const again = applyImport(acct, items, 'Telegram HTML eksporti');
  assert.equal(again.added, 0); assert.equal(again.created, 0);
  const cs = all(`SELECT * FROM conversations WHERE ext_chat_id LIKE 'tgarx:%'`);
  assert.equal(cs.length, 3);
  for (const c of cs) { assert.equal(c.archived, 1); assert.equal(c.pending_since, null); assert.equal(c.followup_count, 2); assert.equal(c.window_until, null); }
  convIds = Object.fromEntries(cs.map(c => [c.display_name, c.id]));
});

test('eski mijoz qayta yozsa (ism+familiya, yagona) — arxiv shu suhbatga aylanadi; bitta so‘zli ism bog‘lanmaydi', () => {
  const c = ingestClient(acct, { extChatId: '700001', extUserId: 700001, name: 'Aziz Karimov', text: 'Yana salom', extMsgId: 1, ts: Date.now() });
  assert.equal(c.id, convIds['Aziz Karimov']);
  const row = one('SELECT * FROM conversations WHERE id=?', c.id);
  assert.equal(row.archived, 0); assert.equal(row.ext_chat_id, '700001'); assert.ok(row.pending_since);
  assert.equal(one('SELECT count(*) n FROM messages WHERE conversation_id=?', c.id).n, 7, 'eski 6 xabar + yangi 1');
  const solo = ingestClient(acct, { extChatId: '700009', extUserId: 700009, name: 'Aziz', text: 'Salom', extMsgId: 1, ts: Date.now() });
  assert.notEqual(solo.id, convIds.Aziz, 'bitta so‘zli ism — boshqa odam bo‘lishi mumkin');
  assert.equal(one('SELECT archived FROM conversations WHERE id=?', convIds.Aziz).archived, 1);
});

test('ro‘yxat: jonli alohida, arxiv alohida; qidiruv ikkalasidan topadi', async () => {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'r', password: 'parol12345' }) });
  const cookie = (r.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
  const get = async p => (await fetch(base + p, { headers: { cookie } })).json();
  const live = await get('/api/conversations');
  assert.ok(live.items.every(c => c.name !== 'Dilnoza Rahimova'), 'arxiv jonli ro‘yxatda yo‘q');
  assert.equal(live.archived_total, 2);
  const arch = await get('/api/conversations?arxiv=1');
  assert.deepEqual(arch.items.map(c => c.name).sort(), ['Aziz', 'Dilnoza Rahimova']);
  const found = await get(`/api/conversations?q=${encodeURIComponent('dilnoza')}`);
  assert.deepEqual(found.items.map(c => c.name), ['Dilnoza Rahimova'], 'katta-kichik harf farqsiz');
  const d = await get(`/api/conversations/${convIds['Dilnoza Rahimova']}`);
  assert.equal(d.conv.archived, 1); assert.equal(d.messages_total, 4); assert.equal(d.messages.length, 4);
});

test('o‘rganish: savol→javob juftlari, shaxsiy raqamlar yashiriladi, o‘xshash savol topiladi', () => {
  assert.equal(scrub('Tel: +998 90 123 45 67, karta 8600 1234 5678 9012, @aziz_k, https://t.me/x'), 'Tel: [raqam], karta [raqam], @…, [havola]');
  const pairs = pairsFrom([
    { author: 'client', text: 'Sony A7 IV rassrochkaga bormi?', at: 0 },
    { author: 'seller', text: 'Ha, muddatli to‘lov bor', at: 60e3 },
    { author: 'seller', text: 'Pasport bilan kelasiz', at: 120e3 },
    { author: 'client', text: 'Rahmat', at: 3600e3 }
  ]);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].a, 'Ha, muddatli to‘lov bor Pasport bilan kelasiz');
  const n = rebuildPairs();
  assert.equal(n, 2, "«Bor, marhamat» kabi qisqa javob namuna emas");
  const hit = similarPairs('rassrochka bormi Sony uchun?');
  assert.ok(hit.length >= 1);
  assert.match(hit[0].a, /muddatli to‘lov/);
  assert.ok(similarPairs('Canon R50 narxi').every(p => !/\+998|123 45/.test(p.a + p.q)), 'raqam namunaga o‘tmaydi');
  const own = similarPairs('rassrochka Sony', { excludeConv: convIds['Dilnoza Rahimova'] });
  assert.ok(own.every(p => !/muddatli to‘lov/.test(p.a)), 'joriy suhbatning o‘zi namunaga tushmaydi');
});

test('qidiruv xabar matni bo‘yicha ham topadi (mahsulot nomi), maxsus belgilar xavfsiz', async () => {
  const r = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: 'r', password: 'parol12345' }) });
  const cookie = (r.headers.getSetCookie?.() || []).map(c => c.split(';')[0]).join('; ');
  const get = async p => (await fetch(base + p, { headers: { cookie } })).json();
  const hit = await get(`/api/conversations?q=${encodeURIComponent('sony a7')}`);
  assert.ok(hit.items.some(c => c.name === 'Dilnoza Rahimova'));
  const pct = await get(`/api/conversations?q=${encodeURIComponent('%_')}`);
  assert.equal(pct.items.length, 0, '% va _ — oddiy belgi, hammasini qaytarmaydi');
});
