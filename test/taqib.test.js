/*
  Ta’qib (SOT 05) xavfsizligi: suhbatni sotuvchi olib borayotgan bo‘lsa (oxirgi xabar undan), AI mijozga O‘ZI yozmaydi —
  taklif matni sotuvchiga vazifa bo‘lib boradi. Oxirgi xabar AI’niki bo‘lsa — avto bosqichda o‘zi yuboradi.
  Sabab: prodda sotuvchi «hozir chiqazvoraman» deb yozgandan keyin AI mijozga «hozir dostavkaga beraman» deb yozib yuborgan (2026-09-30).
*/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sales-taqib-'));
Object.assign(process.env, { DB_FILE: join(dir, 't.db'), DATA_DIR: dir, TG_DISABLED: '1', ENV_FILE: join(dir, 'yoq.env'), AI_MOCK: '1', DRAFT_DEBOUNCE_MS: '999999' });

const { migrate, run, one, all } = await import('../src/db.js');
const { followups } = await import('../src/services/taqib.js');
const inbox = await import('../src/services/inbox.js');
const { updateSettings } = await import('../src/services/settings.js');

const T = Date.now(), H = 3600e3;
const sent = [];
let acct;
const conv = (name, { sellerAt, aiAt }) => run(`INSERT INTO conversations(account_id,ext_chat_id,display_name,stage,followup_count,window_until,
    last_client_at,last_seller_at,last_ai_at,last_msg_at,created_at) VALUES(?,?,?,2,0,?,?,?,?,?,?)`,
  acct.id, `c-${name}`, name, T + 20 * H, T - 30 * H, sellerAt, aiAt, T - 20 * H, T - 40 * H).lastInsertRowid;

before(() => {
  migrate();
  // Kunning istalgan soatida sinov o‘tsin: tinch vaqt oynasi yopiq (quiet_from == quiet_to)
  updateSettings({ followup_first_hours: 4, quiet_from: '00:00', quiet_to: '00:00' }, 'sinov');
  acct = one('SELECT * FROM accounts WHERE id=?', run(`INSERT INTO accounts(channel,ext_id,name,can_reply,enabled,mode,rollout,created_at)
    VALUES('tg','bc1','Photobuy.uz',1,1,'kechiksa','avto',?)`, T).lastInsertRowid);
  run(`INSERT INTO users(id,login,name,role,created_at) VALUES(1,'s1','Sotuvchi','sotuvchi',?)`, T);
  inbox.setInboxHooks({ send: async (a, c, text) => { sent.push({ conv: c.id, text }); return 'ext-1'; }, notify: () => {} });
});
after(async () => { await inbox.drainInbox(100); rmSync(dir, { recursive: true, force: true }); });

test('sotuvchi oxirgi yozgan suhbatda AI mijozga yozmaydi — sotuvchiga vazifa qoladi', async () => {
  const id = conv('Sotuvchi ishlayapti', { sellerAt: T - 20 * H, aiAt: T - 25 * H });
  await followups();
  assert.equal(sent.filter(x => x.conv === id).length, 0, 'mijozga AI xabari ketmasligi kerak');
  const task = one(`SELECT * FROM tasks WHERE conversation_id=? AND kind='followup'`, id);
  assert.ok(task, 'sotuvchiga vazifa yaratiladi');
  assert.match(task.body, /Suhbatni siz olib boryapsiz/);
  assert.equal(one('SELECT followup_count n FROM conversations WHERE id=?', id).n, 1, 'ta’qib hisoblandi — takrorlanmaydi');
});

test('oxirgi xabar AI’niki bo‘lsa — avto bosqichda ta’qibni o‘zi yuboradi', async () => {
  const id = conv('AI yozgan', { sellerAt: T - 30 * H, aiAt: T - 20 * H });
  await followups();
  const mine = sent.filter(x => x.conv === id);
  assert.equal(mine.length, 1, 'bitta ta’qib xabari');
  assert.equal(one(`SELECT count(*) n FROM messages WHERE conversation_id=? AND author='ai'`, id).n, 1);
  assert.equal(all(`SELECT 1 FROM tasks WHERE conversation_id=? AND kind='followup'`, id).length, 0, 'yuborilgan bo‘lsa vazifa kerak emas');
});

test('mijoz javob kutayotgan bo‘lsa yoki xodim olgan bo‘lsa — ta’qib umuman yo‘q', async () => {
  const pend = conv('Javob kutmoqda', { sellerAt: T - 20 * H, aiAt: T - 25 * H });
  run('UPDATE conversations SET pending_since=? WHERE id=?', T - 2 * H, pend);
  const taken = conv('Xodim oldi', { sellerAt: T - 30 * H, aiAt: T - 20 * H });
  run('UPDATE conversations SET taken_by=1 WHERE id=?', taken);
  await followups();
  for (const id of [pend, taken]) {
    assert.equal(sent.filter(x => x.conv === id).length, 0);
    assert.equal(all(`SELECT 1 FROM tasks WHERE conversation_id=? AND kind='followup'`, id).length, 0);
  }
});

/* AI vaqtincha ishlamaganda (Gemini limiti) suhbat tashlab ketilmaydi: AI tiklanishi bilan qayta navbatga tushadi */
test('AI uzilishidan keyin javobsiz suhbat qayta navbatga qo‘yiladi, eskisi esa sotuvchida qoladi', async () => {
  const { kvSet, kvGet } = await import('../src/db.js');
  const mk = (name, pendingAgo, reason, failAgo) => {
    const id = run(`INSERT INTO conversations(account_id,ext_chat_id,display_name,pending_since,last_client_at,last_msg_at,created_at)
      VALUES(?,?,?,?,?,?,?)`, acct.id, `r-${name}`, name, T - pendingAgo, T - pendingAgo, T - pendingAgo, T - pendingAgo).lastInsertRowid;
    run(`INSERT INTO drafts(conversation_id,batch,status,reason,created_at,decided_at) VALUES(?,?,'failed',?,?,?)`, id, T - pendingAgo, reason, T - failAgo, T - failAgo);
    return id;
  };
  const yangi = mk('Yangi limitda yiqilgan', 2 * H, 'Gemini kunlik limiti tugadi — Google AI Studio’da billing ulang', 1.5 * H);
  const eski = mk('Besh kunlik', 120 * H, 'Gemini kunlik limiti tugadi', 100 * H);
  const boshqa = mk('Haqiqiy xato', 2 * H, 'AI so‘rovni rad etdi', 1.5 * H);
  kvSet('ai_ok_at', T - 60e3);   // AI endigina yana ishladi
  const n = inbox.retryAfterOutage();
  assert.equal(n, 1, 'faqat yaqinda limit tufayli yiqilgani');
  assert.equal(one('SELECT count(*) n FROM conversations WHERE id IN (?,?) AND ai_due_at IS NOT NULL', eski, boshqa).n, 0);
  assert.ok(yangi && boshqa && Number(kvGet('ai_ok_at')) > 0);
});

/* AI javobiga tovar rasmi biriktirilsa — rasm javob matni bilan birga ketadi (sotuvchi javob bersa, rasm ham ketmaydi) */
test('tovar rasmi javob matni bilan birga yuboriladi', async () => {
  const photos = [];
  inbox.setInboxHooks({
    draft: async () => ({ ok: true, text: 'Mana shu model, narxi 670 $.', photo: 1, card: {}, sources: [] }),
    send: async (a, c, text) => { sent.push({ conv: c.id, text }); return 'm1'; },
    sendPhoto: async (a, c, buf, caption) => { photos.push({ conv: c.id, bytes: buf.length, caption }); return 'p1'; },
    notify: () => {}
  });
  const { savePanelPhoto } = await import('../src/services/media.js');
  const file = savePanelPhoto(1, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]));   // paneldan yuklangan rasm
  run(`INSERT INTO products(id,name,price,image_url,stock_json,updated_at) VALUES(1,'CANON R50',670,?,'{}',?)`, `panel:${file}`, T);
  const id = run(`INSERT INTO conversations(account_id,ext_chat_id,display_name,pending_since,window_until,last_client_at,last_msg_at,created_at)
    VALUES(?,?,?,?,?,?,?,?)`, acct.id, 'rasm-1', 'Rasm so‘ragan', T - 60e3, T + 20 * H, T - 60e3, T - 60e3, T - 60e3).lastInsertRowid;
  run(`INSERT INTO messages(conversation_id,author,text,ext_msg_id,created_at) VALUES(?,'client','Rasmini tashlang','r1',?)`, id, T - 60e3);

  inbox.scheduleDraft(id, 0);
  await new Promise(r => setTimeout(r, 400));
  const d = one(`SELECT * FROM drafts WHERE conversation_id=? ORDER BY id DESC LIMIT 1`, id);
  assert.equal(d.photo_product_id, 1, 'rasm qoralamaga yozildi');
  assert.equal(d.status, 'ready');

  run('UPDATE conversations SET ai_due_at=? WHERE id=?', Date.now() - 1000, id);
  await inbox.attemptAutoSend(id);
  assert.equal(photos.length, 1, 'rasm yuborildi');
  assert.equal(photos[0].caption, 'Mana shu model, narxi 670 $.', 'matn rasm izohi bo‘lib ketdi');
  assert.equal(sent.filter(x => x.conv === id).length, 0, 'alohida matn xabari yuborilmaydi');
  const m = one(`SELECT meta FROM messages WHERE conversation_id=? AND author='ai'`, id);
  assert.match(m.meta, /"kind":"photo"/, 'panelda ham rasm ko‘rinadi');
});

/* Sotuvchilar kabi: bo‘sh qator bilan ajratilgan javob bir nechta qisqa xabar bo‘lib ketadi (≤ 3), panelda ham alohida */
test('AI javobi bir nechta qisqa xabar bo‘lib yuboriladi', async () => {
  const { splitReply } = inbox;
  assert.deepEqual(splitReply('Assalomu aleykum\n\nbor, narxi 670$ boladi\n\nqaysi kameraga?'), ['Assalomu aleykum', 'bor, narxi 670$ boladi', 'qaysi kameraga?']);
  assert.deepEqual(splitReply('bitta xabar'), ['bitta xabar']);
  assert.equal(splitReply('a\n\nb\n\nc\n\nd\n\ne').length, 3, 'ko‘pi bilan 3 ta');
  process.env.REPLY_PART_PAUSE_MS = '0';
  const got = [];
  inbox.setInboxHooks({
    draft: async () => ({ ok: true, text: 'Assalomu aleykum\n\nbor, narxi 670$ boladi\n\nqaysi kameraga kerak edi?', card: {}, sources: [] }),
    send: async (a, c, text) => { got.push(text); return `m${got.length}`; },
    notify: () => {}
  });
  const id = run(`INSERT INTO conversations(account_id,ext_chat_id,display_name,pending_since,window_until,last_client_at,last_msg_at,created_at)
    VALUES(?,?,?,?,?,?,?,?)`, acct.id, 'bolak-1', 'Qisqa xabar', T - 60e3, T + 20 * H, T - 60e3, T - 60e3, T - 60e3).lastInsertRowid;
  run(`INSERT INTO messages(conversation_id,author,text,ext_msg_id,created_at) VALUES(?,'client','canon r50 bormi','b1',?)`, id, T - 60e3);
  inbox.scheduleDraft(id, 0);
  await new Promise(r => setTimeout(r, 300));
  run('UPDATE conversations SET ai_due_at=? WHERE id=?', Date.now() - 1000, id);
  await inbox.attemptAutoSend(id);
  await new Promise(r => setTimeout(r, 50));
  assert.deepEqual(got, ['Assalomu aleykum', 'bor, narxi 670$ boladi', 'qaysi kameraga kerak edi?']);
  const msgs = all(`SELECT text FROM messages WHERE conversation_id=? AND author='ai' ORDER BY created_at, id`, id).map(m => m.text);
  assert.deepEqual(msgs, got, 'panelda ham 3 ta alohida xabar');
});

/* Mijoz «rasmlarini ko‘rsating» desa: 2–3 variant albom bo‘lib (har rasm ostida tovar nomi), keyin javob matni */
test('bir nechta tovar rasmi albom bo‘lib, keyin matn yuboriladi', async () => {
  const albums = [], texts = [];
  const { savePanelPhoto } = await import('../src/services/media.js');
  for (const [id, nm] of [[11, 'GODOX SL60 — Свет'], [12, 'NEEWER 660 — Свет']]) {
    const f = savePanelPhoto(id, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, id)]));
    run(`INSERT INTO products(id,name,price,image_url,stock_json,updated_at) VALUES(?,?,100,?,'{}',?)`, id, nm, `panel:${f}`, T);
  }
  process.env.REPLY_PART_PAUSE_MS = '0';
  inbox.setInboxHooks({
    draft: async () => ({ ok: true, text: 'mana ikkita variant\n\nqaysi biri yoqdi?', photos: [11, 12], card: {}, sources: [] }),
    send: async (a, c, text) => { texts.push(text); return `t${texts.length}`; },
    sendAlbum: async (a, c, items) => { albums.push(items.map(i => i.caption)); return items.map((_, k) => `al${k}`); },
    sendPhoto: async () => { throw new Error('bitta rasm emas, albom kutilgan'); },
    notify: () => {}
  });
  const id = run(`INSERT INTO conversations(account_id,ext_chat_id,display_name,pending_since,window_until,last_client_at,last_msg_at,created_at)
    VALUES(?,?,?,?,?,?,?,?)`, acct.id, 'albom-1', 'Albom', T - 60e3, T + 20 * H, T - 60e3, T - 60e3, T - 60e3).lastInsertRowid;
  run(`INSERT INTO messages(conversation_id,author,text,ext_msg_id,created_at) VALUES(?,'client','chiroqlar rasmini ko‘rsating','a1',?)`, id, T - 60e3);
  inbox.scheduleDraft(id, 0);
  await new Promise(r => setTimeout(r, 300));
  assert.equal(one(`SELECT photo_ids p FROM drafts WHERE conversation_id=? ORDER BY id DESC`, id).p, '[11,12]');
  run('UPDATE conversations SET ai_due_at=? WHERE id=?', Date.now() - 1000, id);
  await inbox.attemptAutoSend(id);
  assert.deepEqual(albums, [['GODOX SL60 — Свет', 'NEEWER 660 — Свет']], 'albom: har rasm ostida tovar nomi');
  assert.deepEqual(texts, ['mana ikkita variant', 'qaysi biri yoqdi?'], 'keyin matn qismlari');
  const msgs = all(`SELECT text, meta FROM messages WHERE conversation_id=? AND author='ai' ORDER BY created_at, id`, id);
  assert.equal(msgs.length, 4);
  assert.equal(msgs.filter(m => /"kind":"photo"/.test(m.meta)).length, 2, 'panelda 2 ta rasm');
});
