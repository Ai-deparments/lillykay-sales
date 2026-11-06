/*
  Shablon qoida (tezjavob): oddiy xabarga AI chaqirilmaydi. Tekshiriladi: stiker, minnatdorchilik/tasdiq variantlari
  (xato yozilgan, apostrofli, bir nechta so‘z), savol/raqam/mahsulot bo‘lsa — AI ishlaydi.
*/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sales-tezjavob-'));
Object.assign(process.env, { DB_FILE: join(dir, 't.db'), DATA_DIR: dir, TG_DISABLED: '1', ENV_FILE: join(dir, 'yoq.env'), DRAFT_DEBOUNCE_MS: '999999' });

const { migrate, run, one } = await import('../src/db.js');
const { ingestClient, drainInbox } = await import('../src/services/inbox.js');
const { quickAnswer } = await import('../src/services/tezjavob.js');

let acct, n = 0;
before(() => {
  migrate();
  run(`INSERT INTO accounts(id,channel,ext_id,name,can_reply,enabled,mode,rollout,is_demo,created_at) VALUES(1,'tg','b1','Photobuy',1,1,'kechiksa','avto',0,0)`);
  acct = one('SELECT * FROM accounts WHERE id=1');
});
after(async () => { await drainInbox(100); rmSync(dir, { recursive: true, force: true }); });

/* Yangi suhbat, bitta (yoki bir nechta) mijoz xabari — qoida javobi */
const ask = (...texts) => {
  const id = ++n;
  let conv;
  texts.forEach((text, i) => { conv = ingestClient(acct, { extChatId: 'c' + id, extUserId: id, name: 'M', text, extMsgId: id * 10 + i, ts: Date.now() + i }); });
  return quickAnswer(conv, conv.pending_since);
};

test('stiker yolg‘iz kelsa — javob kerak emas', () => {
  assert.deepEqual(ask('[stiker 👋]'), { silent: true, why: 'emoji' });
  assert.deepEqual(ask('[stiker 😀]', '🤝'), { silent: true, why: 'emoji' });
});

test('minnatdorchilik/tasdiq variantlari — xato yozilgan, apostrofli, bir nechta so‘z', () => {
  for (const t of ['Xop akajon', 'rahmat opajon', 'Raxmat', 'rahamt', 'Rahmad', 'Xo’p raxamt', 'axa hop tushunarli rahamt', 'Hop raxmat aka', 'aha', 'Ага ладно',
    'Bo’ladi', 'kutaman', 'Raxmat 🤝', 'Ilohim Sizlarga ham rahmat🤩', 'Хоп', 'аха'])
    assert.deepEqual(ask(t), { silent: true, why: 'rahmat/ok' }, t);
});

test('raqam emoji deb o‘chirilmaydi: «xop 2 ta olaman» — AI ishlaydi (ilgari \\p{Emoji_Component} raqamlarni yutardi)', () => {
  assert.equal(ask('xop 2 ta'), null);
  assert.equal(ask('ok 5'), null);
  assert.deepEqual(ask('xop 👍🏽'), { silent: true, why: 'rahmat/ok' }, 'teri rangli emoji baribir tozalanadi');
});

test('savol, raqam, mahsulot yoki media bo‘lsa — AI ishlaydi', () => {
  for (const t of ['Rahmat, nech pul?', 'xop 2 ta olaman', 'Хоп, расмларини ташаб беролисизми', 'canon r50 bormi', '[rasm] shunaqa', 'Raxmat | Uzumda qidirsam boladimi',
    'rahmat kelmadiku', '+', '???'])
    assert.equal(ask(t), null, t);
  assert.equal(ask('Raxmat', '[rasm]'), null, 'rahmat + rasm — AI ko‘rsin');
});

test('salom — shablon javob; suhbat ketayotgan bo‘lsa AI', () => {
  const r = ask('Assalomu alaykum');
  assert.equal(r.why, 'salom');
  assert.match(r.text, /^Va aleykum assalom/, 'salomga alik olinadi');
  assert.doesNotMatch(r.text, /yordam|texnika qidiryapsiz/, 'robot savoli yo‘q');
});
