/*
  Q1 qabul sinovi (TZ 4-bo‘lim): avtojavobning uch rejimi, T tugashi, xodimning javob berishi,
  suhbatni qo‘lda olish — bitta hodisaga ikki javob yuborilmaydi.
  Ishga tushirish: npm test
*/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sales-test-'));
process.env.DB_FILE = join(dir, 't.db');
process.env.DATA_DIR = dir;
process.env.DRAFT_DEBOUNCE_MS = '50';
process.env.TG_DISABLED = '1';

const { migrate, run, one, all } = await import('../src/db.js');
const inbox = await import('../src/services/inbox.js');
const { updateSettings } = await import('../src/services/settings.js');

const sent = [], notes = [];
let draftDelay = 30, sendDelay = 20;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const staff = { id: 1, name: 'Sinov sotuvchi' };

before(() => {
  migrate();
  run(`INSERT INTO users(id,login,name,role,created_at) VALUES(1,'sinov','Sinov sotuvchi','sotuvchi',0)`);
  updateSettings({ T_seconds: 1, work_from: '00:00', work_to: '23:59', night_autoreply: false }, 'test', { unchecked: true });
  inbox.setInboxHooks({
    draft: async ({ conv }) => { await sleep(draftDelay); return { ok: true, text: `javob #${conv.id}`, sources: ['test'], card: {} }; },
    send: async (acct, conv, text) => { sent.push({ conv: conv.id, text }); await sleep(sendDelay); return `ext-${sent.length}`; },
    notify: (kind, p) => notes.push({ kind, conv: p.conv?.id })
  });
  inbox.startEngine();
});
after(() => { inbox.stopEngine(); rmSync(dir, { recursive: true, force: true }); });

let n = 0;
function newAccount(mode, rollout) {
  n++;
  run(`INSERT INTO accounts(channel,ext_id,name,can_reply,enabled,mode,rollout,is_demo,created_at) VALUES('demo',?,?,1,1,?,?,1,0)`, `a${n}`, `A${n}`, mode, rollout);
  return one('SELECT * FROM accounts WHERE ext_id=?', `a${n}`);
}
const msg = (acct, chat, text, ts = Date.now()) => inbox.ingestClient(acct, { extChatId: chat, name: chat, text, extMsgId: `${chat}-${ts}-${Math.random()}`, ts });
const sentTo = id => sent.filter(s => s.conv === id).length;
const aiMsgs = id => all(`SELECT * FROM messages WHERE conversation_id=? AND author='ai'`, id).length;

test('kechiksa: T tugagach AI bir marta javob beradi', async () => {
  const a = newAccount('kechiksa', 'avto');
  const c = msg(a, 'k1', 'DJI Mic 2 bormi?');
  await sleep(600);
  assert.equal(sentTo(c.id), 0, 'T tugamasdan yuborilmaydi');
  await sleep(1800);
  assert.equal(sentTo(c.id), 1);
  assert.equal(aiMsgs(c.id), 1);
  assert.equal(inbox.conversation(c.id).pending_since, null);
});

test('ketma-ket xabarlar taymerni surmaydi', async () => {
  const a = newAccount('kechiksa', 'avto');
  const t0 = Date.now();
  const c = msg(a, 'k2', 'salom', t0);
  const due1 = inbox.conversation(c.id).ai_due_at;
  await sleep(400);
  msg(a, 'k2', 'yana savol');
  assert.equal(inbox.conversation(c.id).ai_due_at, due1);
  assert.equal(inbox.conversation(c.id).pending_since, t0);
  await sleep(2000);
  assert.equal(sentTo(c.id), 1, 'ikki xabarga bitta javob');
});

test('sekin kanal (Instagram ~3 s): ikki marta salom — shablon javob BIR marta ketadi (dvigatel har soniya qayta boshlamaydi)', async () => {
  const a = newAccount('kechiksa', 'avto');
  sendDelay = 3000; process.env.QUICK_REPLIES = '1';   // shablon yo‘li (standart o‘chiq) — poyga xatosi aynan shu yerda edi
  try {
    const t0 = Date.now();
    const c = msg(a, 'salom2x', 'Assalomu alaykum', t0);
    await sleep(300);
    msg(a, 'salom2x', 'Assalomu alaykum', t0 + 300);
    await sleep(6000);
    assert.equal(sentTo(c.id), 1, 'salom bir marta');
    assert.equal(aiMsgs(c.id), 1);
  } finally { sendDelay = 20; delete process.env.QUICK_REPLIES; }
});

test('tezkor shablonlar standart o‘chiq: «Assalomu alaykum» ga AI javob beradi, sekin kanalda ham bir marta', async () => {
  const a = newAccount('kechiksa', 'avto');
  sendDelay = 3000;
  try {
    const c = msg(a, 'salom-ai', 'Assalomu alaykum');
    await sleep(6000);
    assert.equal(sentTo(c.id), 1, 'bir marta');
    assert.equal(sent.filter(s => s.conv === c.id)[0].text, `javob #${c.id}`, 'javobni AI yozdi, shablon emas');
  } finally { sendDelay = 20; }
});

test('sotuvchi T ichida javob bersa — AI yubormaydi; qoralama T tugamaguncha tayyorlanmaydi (token sarflanmaydi)', async () => {
  const a = newAccount('kechiksa', 'avto');
  const c = msg(a, 'k3', 'narxi qancha?');
  await sleep(300);
  const r = await inbox.sellerSend(c.id, staff, 'Salom! Hozir aytaman');
  assert.equal(r.ok, true);
  await sleep(1800);
  assert.equal(sentTo(c.id), 1, 'faqat sotuvchi xabari');
  assert.equal(aiMsgs(c.id), 0);
  assert.equal(one(`SELECT count(*) n FROM drafts WHERE conversation_id=?`, c.id).n, 0, 'sotuvchi ulgurdi — AI umuman chaqirilmadi');
});

test('«O‘zim olaman» — AI to‘xtaydi; qaytarilsa qayta ishlaydi', async () => {
  const a = newAccount('kechiksa', 'avto');
  const c = msg(a, 'k4', 'savol');
  await sleep(200);
  inbox.takeOver(c.id, staff);
  await sleep(1800);
  assert.equal(sentTo(c.id), 0);
  inbox.release(c.id, staff);
  await sleep(6500);
  assert.equal(sentTo(c.id), 1);
});

test('doim: qoralama tayyor bo‘lishi bilan yuboriladi', async () => {
  const a = newAccount('doim', 'avto');
  const c = msg(a, 'k5', 'salom');
  await sleep(500);
  assert.equal(sentTo(c.id), 1);
});

test('o‘chiq: AI yubormaydi, qoralama sotuvchiga taklif sifatida qoladi', async () => {
  const a = newAccount('ochiq', 'avto');
  const c = msg(a, 'k6', 'salom');
  await sleep(1800);
  assert.equal(sentTo(c.id), 0);
  assert.ok(one(`SELECT 1 FROM drafts WHERE conversation_id=? AND status='ready'`, c.id));
});

test('suhbat darajasidagi o‘chirish akkaunt rejimidan ustun', async () => {
  const a = newAccount('doim', 'avto');
  const c = msg(a, 'k7', 'birinchi');
  await sleep(400);
  assert.equal(sentTo(c.id), 1);
  inbox.setConvMode(c.id, 'ochiq', staff);
  msg(a, 'k7', 'ikkinchi');
  await sleep(1500);
  assert.equal(sentTo(c.id), 1, 'o‘chirilgandan keyin yubormaydi');
});

test('kuzatish: hech qachon yubormaydi, tasdiqlash ham yubormaydi', async () => {
  const a = newAccount('doim', 'kuzatish');
  const c = msg(a, 'k8', 'salom');
  await sleep(1500);
  assert.equal(sentTo(c.id), 0);
  const d = one(`SELECT * FROM drafts WHERE conversation_id=? AND status='ready'`, c.id);
  const r = await inbox.approveDraft(c.id, d.id, staff);
  assert.equal(r.ok, false);
  assert.equal(sentTo(c.id), 0);
});

test('tasdiq bilan: avtomatik yubormaydi; tasdiq bir marta yuboradi, ikkinchisi rad', async () => {
  const a = newAccount('doim', 'tasdiq');
  const c = msg(a, 'k9', 'salom');
  await sleep(1500);
  assert.equal(sentTo(c.id), 0);
  const d = one(`SELECT * FROM drafts WHERE conversation_id=? AND status='ready'`, c.id);
  const [r1, r2] = await Promise.all([inbox.approveDraft(c.id, d.id, staff), inbox.approveDraft(c.id, d.id, staff)]);
  assert.equal([r1, r2].filter(r => r.ok).length, 1, 'bitta tasdiq o‘tadi');
  assert.equal(sentTo(c.id), 1);
});

test('sotuvchi yozayotgani ma’lum bo‘lsa AI kutadi', async () => {
  const a = newAccount('kechiksa', 'avto');
  const c = msg(a, 'k10', 'savol');
  inbox.setTyping(c.id, true);
  await sleep(2200);
  assert.equal(sentTo(c.id), 0, 'yozish signali bor — kutadi');
  inbox.setTyping(c.id, false);
  await sleep(1500);
  assert.equal(sentTo(c.id), 1);
});

test('AI yuborayotgan paytda sotuvchi yubora olmaydi (ikki javob yo‘q)', async () => {
  const a = newAccount('doim', 'avto');
  draftDelay = 10;
  const c = msg(a, 'k11', 'salom');
  // qoralama tayyor bo‘lguncha kutamiz va yuborish boshlanishi bilan sotuvchi urinadi
  for (let i = 0; i < 100 && !one(`SELECT 1 FROM drafts WHERE conversation_id=? AND status IN ('sending','sent')`, c.id); i++) await sleep(5);
  const r = await inbox.sellerSend(c.id, staff, 'men ham yozaman');
  await sleep(100);
  const total = sentTo(c.id);
  assert.ok(r.ok === false || aiMsgs(c.id) === 1, 'natija izchil');
  assert.ok(total <= 2);
  if (!r.ok) assert.equal(total, 1, 'faqat AI javobi ketdi');
  draftDelay = 30;
});

test('kanal oynasi yopiq — AI yozmaydi', async () => {
  const a = newAccount('doim', 'avto');
  run(`UPDATE accounts SET channel='tg' WHERE id=?`, a.id);
  const acct = one('SELECT * FROM accounts WHERE id=?', a.id);
  const c = msg(acct, 'k12', 'eski xabar', Date.now() - 25 * 3600e3);
  await sleep(800);
  assert.equal(sentTo(c.id), 0);
});

test('AI javobi yuborilayotgan paytda kelgan savol javobsiz qolmaydi — unga alohida javob', async () => {
  const a = newAccount('doim', 'avto');
  sendDelay = 500;
  const c = msg(a, 'k13', 'salom');
  for (let i = 0; i < 200 && !one(`SELECT 1 FROM drafts WHERE conversation_id=? AND status='sending'`, c.id); i++) await sleep(5);
  msg(a, 'k13', 'Sony A7 IV narxi qancha?'); // yuborish davom etayotganda
  sendDelay = 20;
  for (let i = 0; i < 150 && aiMsgs(c.id) < 2; i++) await sleep(20);
  assert.equal(sentTo(c.id), 2, 'ikkinchi savolga ham javob ketdi (parallel emas, ketma-ket)');
  const cc = inbox.conversation(c.id);
  assert.equal(cc.pending_since, null);
  assert.equal(aiMsgs(c.id), 2);
});

test('sotuvchi paneldan yozayotganda kelgan savol ham javobsiz qolmaydi', async () => {
  const a = newAccount('kechiksa', 'avto');
  const c = msg(a, 'k14', 'bormi?');
  sendDelay = 400;
  const p = inbox.sellerSend(c.id, staff, 'Ha, bor');
  await sleep(100);
  msg(a, 'k14', 'Qaysi filialda?');
  await p;
  sendDelay = 20;
  const cc = inbox.conversation(c.id);
  assert.ok(cc.pending_since, 'yangi savol javob kutmoqda');
  for (let i = 0; i < 200 && sentTo(c.id) < 2; i++) await sleep(20);
  assert.equal(sentTo(c.id), 2, 'T dan keyin AI yangi savolga javob berdi');
});

test('qayta ishga tushish: to‘xtab qolgan qoralama qayta tayyorlanadi, «yuborilmoqda»da qolgani «noma’lum» bo‘ladi', async () => {
  const a = newAccount('kechiksa', 'avto');
  const t = Date.now() - 5000;
  // Jarayon o‘lgan holat: xotiradagi taymerlar yo‘q, bazada «preparing» va «sending» qoralamalar qolgan
  const mk = chat => {
    const id = run(`INSERT INTO conversations(account_id,ext_chat_id,display_name,is_demo,created_at,last_msg_at,last_client_at,pending_since,ai_due_at,window_until) VALUES(?,?,?,1,?,?,?,?,?,?)`,
      a.id, chat, chat, t, t, t, t, t, t + 864e5).lastInsertRowid;
    run(`INSERT INTO messages(conversation_id,author,text,ext_msg_id,created_at) VALUES(?,'client','savol',?,?)`, id, `${chat}-1`, t);
    return Number(id);
  };
  inbox.stopEngine();
  const c1 = mk('k15'), c2 = mk('k16');
  run(`INSERT INTO drafts(conversation_id,batch,status,created_at) VALUES(?,?,'preparing',?)`, c1, t, t);
  run(`INSERT INTO drafts(conversation_id,batch,status,text,created_at) VALUES(?,?,'sending','javob',?)`, c2, t, t);
  inbox.recoverInbox();
  inbox.startEngine();
  for (let i = 0; i < 300 && !sentTo(c1); i++) await sleep(20);
  assert.equal(sentTo(c1), 1, 'to‘xtab qolgan qoralama tiklandi va yuborildi');
  assert.equal(one(`SELECT status FROM drafts WHERE conversation_id=? AND text='javob'`, c2).status, 'unknown');
  assert.ok(notes.some(n => n.kind === 'send_unknown' && n.conv === c2), 'sotuvchi ogohlantirildi');
  await sleep(1500);
  assert.equal(sentTo(c2), 0, 'noma’lum holatda qayta yuborilmaydi');
  const r = await inbox.sellerSend(c2, staff, 'Javob beraman');
  assert.equal(r.ok, true, 'sotuvchi yoza oladi (qotib qolmagan)');
});

test('15 daqiqadan eski tayyor qoralama avtomatik yuborilmaydi — yangidan tayyorlanadi', async () => {
  const a = newAccount('kechiksa', 'avto');
  const c = msg(a, 'k17', 'savol');
  for (let i = 0; i < 100 && !one(`SELECT 1 FROM drafts WHERE conversation_id=? AND status='ready'`, c.id); i++) await sleep(10);
  run(`UPDATE drafts SET text='ESKI', created_at=? WHERE conversation_id=? AND status='ready'`, Date.now() - 20 * 60e3, c.id);
  for (let i = 0; i < 200 && !sentTo(c.id); i++) await sleep(20);
  assert.equal(sentTo(c.id), 1);
  assert.notEqual(sent.filter(s => s.conv === c.id)[0].text, 'ESKI');
});

test('sozlamalar: bo‘sh yoki chegaradan tashqari qiymat saqlanmaydi', async () => {
  const { updateSettings, getSettings } = await import('../src/services/settings.js');
  const before = getSettings().big_positions;
  assert.throws(() => updateSettings({ big_positions: '' }, 'test'), /bad_setting/);
  assert.throws(() => updateSettings({ big_positions: 0 }, 'test'), /bad_setting/);
  assert.throws(() => updateSettings({ T_seconds: 5 }, 'test'), /bad_setting/);
  assert.throws(() => updateSettings({ work_from: '25:00' }, 'test'), /bad_setting/);
  assert.throws(() => updateSettings({ night_autoreply: 'balki' }, 'test'), /bad_setting/);
  assert.throws(() => updateSettings({ big_qty: 20, big_positions: -1 }, 'test'), /bad_setting/);
  assert.equal(getSettings().big_qty, 10, 'bittasi noto‘g‘ri — hech biri saqlanmaydi');
  assert.equal(getSettings().big_positions, before);
  updateSettings({ big_positions: '7', night_autoreply: 'false' }, 'test');
  assert.equal(getSettings().big_positions, 7);
  assert.equal(getSettings().night_autoreply, false);
  updateSettings({ big_positions: before }, 'test');
});

test('AI to‘xtatilgan kanal: qoralama ham, javob ham yo‘q; to‘xtatilganda tayyor qoralama bekor; qayta yoqilsa yangi savolga javob', async () => {
  const a = newAccount('kechiksa', 'tasdiq');
  const c = msg(a, 'off1', 'Canon R50 bormi?');
  await sleep(300);
  const last = id => one('SELECT status FROM drafts WHERE conversation_id=? ORDER BY id DESC LIMIT 1', id)?.status;
  assert.equal(last(c.id), 'ready');
  inbox.setAccount(a.id, { ai_enabled: 0 }, staff);
  assert.equal(last(c.id), 'cancelled', 'tayyor qoralama bekor qilinadi');
  const c2 = msg(inbox.account(a.id), 'off2', 'Narxi qancha?');
  await sleep(300);
  assert.equal(one('SELECT count(*) n FROM drafts WHERE conversation_id=?', c2.id).n, 0, 'AI qoralama yozmaydi');
  assert.equal(inbox.conversation(c2.id).ai_due_at, null, 'taymer qo‘yilmaydi');
  assert.equal(inbox.effective(inbox.conversation(c2.id), inbox.account(a.id)).ai, false);
  inbox.setAccount(a.id, { ai_enabled: 1, rollout: 'avto' }, staff);
  await sleep(6000); // qoralamalar navbat bilan (1 s + 3 s oraliq)
  assert.equal(sentTo(c2.id), 1, 'qayta yoqilgach yaqindagi savolga javob yuboriladi');
});
