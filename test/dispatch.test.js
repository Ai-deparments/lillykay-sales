/*
  Boshliq agent (dispatch): AI sotuvchilarga rahbar nomidan, navbat bilan ish beradi.
  Rahbar qoidalari (2026-10-03): tugma yo‘q, mijoz — havola; ko‘rdi (biror javob yoki mijozga yozdi) = bajarildi;
  2 soatda javob bo‘lmasa — ogohlantirishsiz keyingisiga; tez-tez ko‘rmasa — kuniga bir marta «iltimos, e’tiborli bo‘ling».
  Tekshiriladi: navbat, ko‘rmasa keyingisiga, hamma ko‘rmasa — rahbarga, ulangan sotuvchi yo‘q — rahbarga, tunda — navbatda,
  rad etish, boshliq AI, reyting, profil, poyga (bir ish — bir xabar).
*/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sales-dispatch-'));
Object.assign(process.env, { DB_FILE: join(dir, 't.db'), DATA_DIR: dir, TG_DISABLED: '1', ENV_FILE: join(dir, 'yoq.env'), DRAFT_DEBOUNCE_MS: '50' });

const { migrate, run, one, all, kvSet } = await import('../src/db.js');
const inbox = await import('../src/services/inbox.js');
const d = await import('../src/services/dispatch.js');
const { updateSettings } = await import('../src/services/settings.js');

const sent = [];
let deliver = () => true;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const STD = async (u, text, o = {}) => { const ok = deliver(u); sent.push({ to: u.id, text, opts: o, ok }); return ok; };

before(() => {
  migrate();
  updateSettings({ work_from: '00:00', work_to: '23:59', assign_done_minutes: 120, assign_urgent_minutes: 3, seller_auto_warn: true }, 'test', { unchecked: true });
  d.setDispatchSender(STD);
  d.setBossAgent(async () => { throw new Error('AI yo‘q'); });
  inbox.setInboxHooks({ draft: async () => ({ ok: true, text: 'x', sources: [], card: {} }), send: async () => 'ext', notify: () => {}, onSellerReply: d.onSellerReply });
  run(`INSERT INTO users(id,login,name,role,tg_user_id,tg_chat_id,created_at) VALUES(1,'hilola','Hilola','sotuvchi',101,101,0),(2,'aziz','Aziz','sotuvchi',102,102,0),
    (3,'boss','Rahbar','rahbar',103,103,0),(4,'yangi','Yangi','sotuvchi',NULL,NULL,0)`);
  run(`INSERT INTO accounts(id,channel,ext_id,name,can_reply,enabled,mode,rollout,is_demo,created_at) VALUES(1,'tg','b1','Photobuy',1,1,'kechiksa','avto',0,0),(2,'ig','ig1','@photobuy.uz',1,1,'kechiksa','avto',0,0)`);
});
after(() => { inbox.stopEngine?.(); rmSync(dir, { recursive: true, force: true }); });

let n = 0;
function conv(handle = null, account = 1) {
  n++;
  run(`INSERT INTO conversations(account_id,ext_chat_id,display_name,handle,created_at) VALUES(?,?,?,?,0)`, account, `c${n}`, `Mijoz ${n}`, handle);
  return one('SELECT * FROM conversations WHERE ext_chat_id=?', `c${n}`);
}
const A = id => one('SELECT * FROM assignments WHERE id=?', id);
const U = id => one('SELECT * FROM users WHERE id=?', id);
const events = id => all('SELECT user_id, event FROM assignment_events WHERE assignment_id=? ORDER BY id', id).map(e => `${e.user_id ?? '-'}:${e.event}`);
const age = (id, col, min) => run(`UPDATE assignments SET ${col}=? WHERE id=?`, Date.now() - min * 60e3, id);
const toUser = (uid, re) => sent.filter(m => m.to === uid && re.test(m.text));

test('ish navbatdagi sotuvchiga: rahbar ovozida, tugmasiz, mijoz — havola', async () => {
  const c = conv('@ali_v');
  const id = await d.assign({ conv: c, kind: 'rasm', task: 'Sony A7 IV rasmini mijozga yuboring' });
  const a = A(id);
  assert.equal(a.status, 'offered');
  assert.equal(a.user_id, 1, 'birinchi navbat — Hilola');
  const m = sent.at(-1);
  assert.equal(m.text, 'Hilola, Sony A7 IV rasmini mijozga yuboring\nTelegramdagi @ali_v');
  assert.equal(m.opts.buttons, undefined, 'tugma yo‘q');
  assert.equal(await d.assign({ conv: c, kind: 'rasm', task: 'yangilangan vazifa' }), id, 'bir suhbatda bir turdagi ochiq ish — bitta');
  assert.equal(A(id).body, 'yangilangan vazifa');
});

test('Instagram mijozi — Instagram chatiga havola (Telegram @ emas)', async () => {
  const c = conv('@asal_makeup', 2);
  await d.assign({ conv: c, kind: 'javob', task: 'Instagramdagi @asal_makeup Godox lampa narxini so‘rayapti, javob bering' });
  run('UPDATE conversations SET pending_since=? WHERE id=?', Date.now(), c.id);
  const id = await d.assign({ conv: inbox.conversation(c.id), kind: 'rasm', task: 'Instagramdagi @asal_makeup Godox SL60 rasmini so‘rayapti, tashlab yuboring' });
  const m = sent.filter(x => /Godox SL60/.test(x.text)).at(-1);
  assert.ok(id);
  assert.match(m.text, /Instagramdagi <a href="https:\/\/ig\.me\/m\/asal_makeup">@asal_makeup<\/a> Godox SL60 rasmini so‘rayapti/);
  assert.doesNotMatch(m.text.replace(/<a [^>]+>@asal_makeup<\/a>/g, ''), /@asal_makeup/, 'oddiy @ qolmagan');
});

test('navbat: galma-gal — ikkalasida bittadan ish, eng uzoq kutgan oladi', async () => {
  const id = await d.assign({ conv: conv(), kind: 'boshqa', task: 'Mijoz bilan bog‘laning' });
  assert.equal(A(id).user_id, 1, 'oldingisini Aziz olgan edi — endi Hilola');
});

test('2 soatda javob bo‘lmasa — ogohlantirishsiz keyingisiga; hamma ko‘rmasa — rahbarga', async () => {
  const id = await d.assign({ conv: conv(), kind: 'buyurtma', task: 'Buyurtmani rasmiylashtiring' });
  const first = A(id).user_id, second = first === 1 ? 2 : 1, before = sent.length;
  age(id, 'offered_at', 119);
  await d.dispatchJob();
  assert.equal(A(id).user_id, first, '2 soat to‘lmagan — hali unda');
  age(id, 'offered_at', 121);
  await d.dispatchJob();
  assert.equal(A(id).user_id, second);
  assert.equal(A(id).status, 'offered');
  assert.equal(sent.slice(before).filter(m => m.to === first).length, 0, 'ko‘rmagan sotuvchiga hech qanday xabar yo‘q');
  assert.ok(one(`SELECT 1 FROM staff_notes WHERE user_id=? AND kind='otkazdi' AND assignment_id=?`, first, id), 'profilida izoh');
  assert.match(toUser(second, /Tezroq iltimos/).at(-1)?.text || '', /Buyurtmani rasmiylashtiring/);
  age(id, 'offered_at', 121);
  await d.dispatchJob();
  assert.equal(A(id).status, 'escalated');
  assert.ok(toUser(3, /Hech kim olmadi/).length, 'rahbar xabar oldi');
  assert.deepEqual(events(id), [`${first}:offered`, `${first}:missed`, `${second}:offered`, `${second}:missed`, '-:escalated']);
});

test('ko‘rdi = qabul qildi va bajardi; to‘lovda suhbat sotuvchiga o‘tadi', async () => {
  const c = conv();
  const id = await d.assign({ conv: c, kind: 'tolov', task: 'To‘lovni tasdiqlang' });
  const u = A(id).user_id;
  assert.equal(d.acceptAssignment(id, U(u)), 'Rahmat');
  assert.equal(A(id).status, 'done');
  assert.equal(inbox.conversation(c.id).taken_by, u, 'to‘lov — suhbat sotuvchiga o‘tadi (AI aralashmaydi)');
  assert.match(d.acceptAssignment(id, U(u === 1 ? 2 : 1)), /boshqa xodim/);
  assert.deepEqual(events(id), [`${u}:offered`, `${u}:accepted`, `${u}:done`]);
});

test('sotuvchi mijozga Telegram’dan yozdi — ish bajarildi (ish egasiga yoziladi), vazifa yopiladi', async () => {
  const c = conv();
  const id = await d.assign({ conv: c, kind: 'rasm', task: 'Rasm yuboring' });
  const u = A(id).user_id;
  run(`INSERT INTO tasks(kind,conversation_id,title,status,created_by,created_at) VALUES('handoff',?,'Sotuvchiga uzatildi','open','t',0)`, c.id);
  inbox.markSellerReply(c.id, { text: '[rasm]', userId: null, extMsgId: 'e1', via: 'telegram' });
  assert.equal(A(id).status, 'done');
  assert.equal(A(id).done_how, 'javob');
  assert.ok(events(id).includes(`${u}:done`));
  assert.equal(one(`SELECT status FROM tasks WHERE conversation_id=?`, c.id).status, 'done');
});

test('vazifalar javobdan keyin o‘zi yopiladi: AI javobi — faqat AI xatolari, sotuvchi javobi — uzatilgan ish ham; katta buyurtma qoladi', () => {
  const c = conv();
  const add = (kind, at = 0) => run(`INSERT INTO tasks(kind,conversation_id,title,status,created_by,created_at) VALUES(?,?,'t','open','t',?)`, kind, c.id, at).lastInsertRowid;
  const st = id => one('SELECT status FROM tasks WHERE id=?', id).status;
  const h = add('handoff'), f = add('draft_failed'), s = add('send_failed'), b = add('big_order'), later = add('handoff', Date.now() + 60e3);
  assert.equal(inbox.closeTasksOnReply(c.id, 'ai'), 2);
  assert.deepEqual([st(h), st(f), st(s), st(b)], ['open', 'done', 'done', 'open'], 'AI javobi uzatilgan ishni (rasm, to‘lov) yopmaydi');
  inbox.closeTasksOnReply(c.id, 'seller');
  assert.equal(st(h), 'done');
  assert.equal(st(b), 'open', 'katta buyurtma — qo‘lda yopiladi');
  assert.equal(st(later), 'open', 'javobdan keyin yaratilgan vazifa yopilmaydi');
});

test('eski to‘planib qolgan vazifalar: sotuvchi javob bergan — yopiladi; faqat AI javob bergan bo‘lsa uzatilgan ish qoladi', () => {
  const t0 = Date.now() - 864e5;
  const seller = conv(), aiOnly = conv(), silent = conv();
  run('UPDATE conversations SET last_seller_at=? WHERE id=?', t0 + 1000, seller.id);
  run('UPDATE conversations SET last_ai_at=? WHERE id=?', t0 + 1000, aiOnly.id);
  const add = (c, kind) => run(`INSERT INTO tasks(kind,conversation_id,title,status,created_by,created_at) VALUES(?,?,'t','open','t',?)`, kind, c.id, t0).lastInsertRowid;
  const st = id => one('SELECT status FROM tasks WHERE id=?', id).status;
  const ids = { sh: add(seller, 'handoff'), sm: add(seller, 'morning'), ah: add(aiOnly, 'handoff'), af: add(aiOnly, 'send_failed'), xh: add(silent, 'handoff') };
  inbox.closeAnsweredTasks();
  assert.deepEqual(Object.fromEntries(Object.entries(ids).map(([k, id]) => [k, st(id)])), { sh: 'done', sm: 'done', ah: 'open', af: 'done', xh: 'open' });
});

test('eski xabardagi «Bajarildi» tugmasi; boshqa sotuvchi bosa olmaydi', async () => {
  const id = await d.assign({ conv: conv(), kind: 'boshqa', task: 'Bog‘laning' });
  const u = A(id).user_id;
  assert.match(d.doneAssignment(id, U(u === 1 ? 2 : 1)), /boshqa sotuvchiga o‘tgan/);
  assert.match(d.doneAssignment(id, U(u)), /Bajarildi/);
  assert.equal(A(id).status, 'done');
});

test('bot yetkaza olmasa (Start bosilmagan) — keyingi sotuvchi', async () => {
  deliver = u => u.id !== 1;
  const id = await d.assign({ conv: conv(), kind: 'boshqa', task: 'Javob bering' });
  assert.equal(A(id).user_id, 2);
  deliver = () => true;
});

test('hech kim smenada emas (tun) — navbatda; smena boshlansa — taklif qilinadi', async () => {
  run(`UPDATE users SET shift_from='03:00', shift_to='03:01' WHERE id IN (1,2)`);
  const id = await d.assign({ conv: conv(), kind: 'rasm', task: 'Rasm' });
  assert.equal(A(id).status, 'queued');
  run(`UPDATE users SET shift_from=NULL, shift_to=NULL WHERE id IN (1,2)`);
  await d.dispatchJob();
  assert.equal(A(id).status, 'offered');
});

test('Telegram’ga ulangan sotuvchi yo‘q — darhol rahbarga', async () => {
  run(`UPDATE users SET tg_chat_id=NULL WHERE id IN (1,2)`);
  const id = await d.assign({ conv: conv(), kind: 'tolov', task: 'Chek' });
  assert.equal(A(id).status, 'escalated');
  assert.match(toUser(3, /Hech kim olmadi/).at(-1).text, /Start/);
  run(`UPDATE users SET tg_chat_id=tg_user_id WHERE id IN (1,2)`);
});

test('AI uzatishi (handoff) — boshliq agent ishi bo‘ladi', async () => {
  const { notify } = await import('../src/services/notify.js');
  const c = conv();
  run('UPDATE conversations SET pending_since=? WHERE id=?', Date.now(), c.id);
  await notify('handoff', { conv: inbox.conversation(c.id), kind: 'rasm', task: 'Canon R50 rasmini yuboring', reason: 'rasm topilmadi' });
  const a = one(`SELECT * FROM assignments WHERE conversation_id=?`, c.id);
  assert.equal(a.kind, 'rasm');
  assert.equal(a.body, 'Canon R50 rasmini yuboring');
  assert.ok(['offered', 'queued', 'escalated'].includes(a.status));
  await sleep(10);
});

test('shoshilinch: hozir online sotuvchiga, qisqa muddat bilan (3 daq)', async () => {
  run('UPDATE users SET active_at=? WHERE id=2', Date.now() - 60e3);
  run('UPDATE users SET active_at=? WHERE id=1', Date.now() - 5 * 3600e3);
  const id = await d.assign({ conv: conv(), kind: 'buyurtma', task: 'Mijoz hozir to‘lamoqchi — to‘lov ma’lumotini yuboring', urgent: true });
  assert.equal(A(id).urgent, 1);
  assert.equal(A(id).user_id, 2, 'online sotuvchi — Aziz');
  assert.match(sent.at(-1).text, /^Aziz, tezda: /);
  age(id, 'offered_at', 4);
  await d.dispatchJob();
  assert.ok(events(id).includes('2:missed'), '3 daqiqada javob bo‘lmadi');
  assert.equal(A(id).user_id, 1);
});

test('bugun Photobuy akkauntiga yozgan sotuvchi — navbatda oldin; «+» — ko‘rdi (bajarildi)', async () => {
  const opts = [];
  d.setDispatchSender(async (u, text, o = {}) => { opts.push({ to: u.id, text }); sent.push({ to: u.id, text, opts: o }); return { via: u.biz_seen_at ? 'biz' : 'bot', msgId: 77 }; });
  run(`INSERT INTO users(id,login,name,role,biz_seen_at,created_at) VALUES(5,'kamola','Kamola Saidova','sotuvchi',?,0)`, Date.now() - 60e3);
  const id = await d.assign({ conv: conv('@mijoz5'), kind: 'rasm', task: 'Sony ZV-E10 rasmini yuboring' });
  assert.equal(A(id).user_id, 5, 'ishga kelgan (akkauntga yozgan) sotuvchi');
  assert.equal(A(id).via, 'biz');
  assert.equal(A(id).msg_id, 77);
  assert.equal(opts.find(o => o.to === 5).text, 'Kamola, Sony ZV-E10 rasmini yuboring\nTelegramdagi @mijoz5');
  await d.onStaffMessage(U(5), { text: '+' });
  assert.equal(A(id).status, 'done', 'ko‘rdi — bajarildi');
  // Business oynasi 24 soatdan eski — bot ham yo‘q: ish olmaydi
  run('UPDATE users SET biz_seen_at=? WHERE id=5', Date.now() - 25 * 3600e3);
  const id2 = await d.assign({ conv: conv(), kind: 'rasm', task: 'Rasm' });
  assert.notEqual(A(id2).user_id, 5);
  d.setDispatchSender(STD);
});

test('bir ish bir vaqtda ikki marta taklif qilinmaydi (yangi ish va fon ishi bir paytda)', async () => {
  d.setDispatchSender(async (u, text) => { await sleep(120); sent.push({ to: u.id, text }); return true; });
  const pending = d.assign({ conv: conv(), kind: 'rasm', task: 'Poyga sinovi' });
  await sleep(20);
  await d.dispatchJob();                       // shu payt ish hali «queued» — ikkinchi marta yuborilmasin
  const id = await pending;
  assert.equal(events(id).filter(e => e.endsWith(':offered')).length, 1);
  assert.equal(sent.filter(m => /Poyga sinovi/.test(m.text)).length, 1);
  d.setDispatchSender(STD);
});

test('rahbar Telegram’ga ulanmagan — «hech kim olmadi» ish 30 daqiqadan keyin sotuvchilarga qayta taklif qilinadi', async () => {
  run('UPDATE users SET tg_chat_id=NULL WHERE id=3');
  const c = conv(), t = Date.now();
  const id = Number(run(`INSERT INTO assignments(conversation_id,kind,title,body,status,tried,attempts,created_by,created_at) VALUES(?,'rasm','Rasm yuborish','Qayta taklif sinovi','escalated','[1,2]',2,'t',?)`, c.id, t - 40 * 60e3).lastInsertRowid);
  run(`INSERT INTO assignment_events(assignment_id,event,at) VALUES(?,'escalated',?)`, id, t - 31 * 60e3);
  await d.dispatchJob();
  assert.equal(A(id).status, 'offered', 'yana sotuvchiga');
  assert.match(sent.at(-1).text, /Qayta taklif sinovi/);
  run('UPDATE users SET tg_chat_id=103 WHERE id=3');
});

test('«javob bering» ishi — mijoz endi javob kutmasa, taklif qilinmaydi', async () => {
  const c = conv();
  const id = await d.assign({ conv: c, kind: 'javob', task: 'Mijoz javob kutmoqda' });
  assert.equal(A(id).status, 'cancelled');
  const c2 = conv();
  run('UPDATE conversations SET pending_since=? WHERE id=?', Date.now(), c2.id);
  const id2 = await d.assign({ conv: inbox.conversation(c2.id), kind: 'javob', task: 'Mijoz javob kutmoqda' });
  assert.equal(A(id2).status, 'offered');
});

test('sotuvchi «vaqtim yo‘q» desa — darhol boshqasiga; rad etish qayd etiladi (profil izohi, reyting, yozishma)', async () => {
  const id = await d.assign({ conv: conv('@rad_sinov'), kind: 'rasm', task: 'Nikon Z50 rasmini yuboring' });
  const first = A(id).user_id;
  await d.onStaffMessage(U(first), { text: 'vaqtim yo‘q, boshqasiga ayting', via: 'bot' });
  assert.notEqual(A(id).user_id, first, 'boshqa sotuvchiga o‘tdi');
  assert.ok(events(id).includes(`${first}:declined`));
  assert.match(one(`SELECT text FROM staff_notes WHERE user_id=? AND kind='rad' ORDER BY id DESC`, first).text, /vaqtim yo‘q/);
  assert.match(sent.filter(m => m.to === first).at(-1).text, /boshqa(siga| sotuvchiga) beraman/);
  const msgs = all('SELECT dir FROM staff_messages WHERE user_id=? ORDER BY id DESC LIMIT 2', first);
  assert.deepEqual(msgs.map(m => m.dir).sort(), ['in', 'out'], 'yozishma jurnalda');
});

test('boshliq AI: savolga javob beradi, ko‘rganini belgilaydi, profilga izoh yozadi', async () => {
  const id = await d.assign({ conv: conv('@ai_sinov'), kind: 'rasm', task: 'Fujifilm X-T5 rasmini yuboring' });
  const u = U(A(id).user_id);
  const { bossReply } = await import('../src/agents/boshliq.js');
  let seen = null;
  d.setBossAgent(args => bossReply(args, async ({ userContent, handlers }) => {
    seen = userContent;
    const info = await handlers.customer_info({ task_id: id });
    await handlers.task_seen({ task_id: id });
    await handlers.add_note({ text: 'Mijoz kimligini so‘radi, 10 daqiqada qilishini aytdi' });
    return { text: `Mijoz ${info.username}, rahmat` };
  }));
  await d.onStaffMessage(u, { text: 'qaysi mijoz edi? 10 daqiqada qilaman', via: 'biz' });
  assert.match(seen, /Fujifilm X-T5 rasmini yuboring/, 'AI ochiq ishni ko‘rdi');
  assert.match(seen, /qaysi mijoz edi\? 10 daqiqada qilaman/);
  assert.equal(A(id).status, 'done');
  assert.ok(one(`SELECT 1 FROM staff_notes WHERE user_id=? AND kind='ai'`, u.id), 'AI izohi profilda');
  assert.match(sent.filter(m => m.to === u.id).at(-1).text, /@ai_sinov, rahmat/);
  d.setBossAgent(async () => { throw new Error('AI yo‘q'); });
});

test('AI ishlamasa ham: istalgan javob — ko‘rdi (bajarildi); «5 daqiqada qilaman» — rad emas', async () => {
  const id = await d.assign({ conv: conv(), kind: 'boshqa', task: 'Mijoz bilan bog‘laning' });
  const u = U(A(id).user_id);
  await d.onStaffMessage(u, { text: 'hozir bandroqman, 5 daqiqada qilaman', via: 'bot' });
  assert.equal(A(id).status, 'done');
  assert.ok(!events(id).some(e => e.endsWith(':declined')));
});

test('tez-tez ko‘rmasa — kuniga bir marta «iltimos, e’tiborli bo‘ling»; har ko‘rmaslikka xabar yo‘q', async () => {
  kvSet('attn_warn:1', 0);
  const warnCount = () => toUser(1, /e’tiborli bo‘ling/).length;
  const start = warnCount();
  for (let i = 0; i < 4; i++) {
    const id = await d.assign({ conv: conv(), kind: 'rasm', task: `E’tibor sinovi ${i}` });
    run(`UPDATE assignments SET user_id=1, status='offered', tried='[1]' WHERE id=?`, id);
    age(id, 'offered_at', 121);
    await d.dispatchJob();
  }
  assert.equal(warnCount() - start, 1, 'bitta ogohlantirish');
  assert.ok(one(`SELECT 1 FROM staff_notes WHERE user_id=1 AND kind='ogohlantirish'`), 'profilida qayd');
});
