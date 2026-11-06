/*
  Agentni o‘qitish (Sotuvchi agent usuli): tasdiqlangan javoblar va do‘kon ma’lumoti agent ko‘rsatmasiga tushadi,
  takror savol eski javob o‘rnini oladi, o‘chirilgani ishlatilmaydi. Mijoz tilini aniqlash.
*/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sales-bilim-'));
process.env.DB_FILE = join(dir, 't.db'); process.env.DATA_DIR = dir; process.env.TG_DISABLED = '1';
const { migrate, one, run } = await import('../src/db.js');
const B = await import('../src/services/bilim.js');
const { tilBelgisi } = await import('../src/agents/fokus.js');

before(() => migrate());
after(() => rmSync(dir, { recursive: true, force: true }));

test('tasdiqlangan javob va do‘kon ma’lumoti agent ko‘rsatmasiga tushadi', () => {
  assert.equal(B.knowledgePrompt(), '', 'bo‘sh bazada blok yo‘q');
  B.saveKnowledge({ title: 'Kafolat', body: 'Barcha tovarlarga rasmiy kafolat 12 oy.' }, 'Rahbar');
  B.saveAnswer({ question: 'Yetkazib berasizmi?', answer: 'Toshkent bo‘ylab bor, narxini sotuvchi aytadi.', author: 'Rahbar' });
  const p = B.knowledgePrompt();
  assert.match(p, /Do‘kon ma’lumoti/);
  assert.match(p, /Kafolat\n.*12 oy/);
  assert.match(p, /Tasdiqlangan javoblar/);
  assert.match(p, /Yetkazib berasizmi\?/);
  assert.match(p, /USTUN/, 'javoblar bilimdan ustunligi aytilgan');
  assert.match(p, /BILLZ/, 'narx baribir BILLZ’dan ekani aytilgan');
});

test('aynan shu savol qayta kiritilsa — eski javob o‘rnini yangi javob oladi', () => {
  const a = B.saveAnswer({ question: 'Kafolat necha oy?', answer: '6 oy', author: 'A' });
  const b = B.saveAnswer({ question: 'kafolat necha oy?', answer: '12 oy', author: 'B' });
  assert.notEqual(a, b);
  assert.equal(one('SELECT active FROM answers WHERE id=?', a).active, 0, 'eski javob o‘chdi');
  const p = B.knowledgePrompt();
  assert.match(p, /12 oy/);
  assert.ok(!/Javob: 6 oy/.test(p), 'eski javob ko‘rsatmada yo‘q');
});

test('o‘chirilgan javob agentga berilmaydi, qayta yoqilsa qaytadi', () => {
  const id = B.saveAnswer({ question: 'Bo‘lib to‘lash bormi?', answer: 'Ha, 3 oyga.', author: 'A' });
  B.setAnswerActive(id, false, 'A');
  assert.ok(!B.knowledgePrompt().includes('Bo‘lib to‘lash'));
  B.setAnswerActive(id, true, 'A');
  assert.ok(B.knowledgePrompt().includes('Bo‘lib to‘lash'));
});

test('bo‘sh savol yoki javob qabul qilinmaydi', () => {
  assert.throws(() => B.saveAnswer({ question: ' ', answer: 'x' }), /savol_javob_kerak/);
  assert.throws(() => B.saveKnowledge({ title: 'x', body: '' }), /sarlavha_matn_kerak/);
});

test('mijoz tili: kirill matnda o‘zbek va rus ajratiladi, lotinda model o‘zi', () => {
  assert.equal(tilBelgisi('Здравствуйте, сколько стоит микрофон?'), 'RUS tili');
  assert.equal(tilBelgisi('Ассалому алайкум, микрофон нархи қанча?'), 'o‘zbek tili, KIRILL yozuvi');
  assert.equal(tilBelgisi('Salom, narxi qancha?'), '');
});

test('«[Tekshiring: …]» qatori agentga berilmaydi; qoralama (active=0) umuman berilmaydi', async () => {
  const { forAgent, knowledgePrompt } = await import('../src/services/bilim.js');
  assert.equal(forAgent('Ish vaqti 09–20\n[Tekshiring: bayram kunlari?]\nYakshanba 18 gacha'), 'Ish vaqti 09–20\nYakshanba 18 gacha');
  run(`INSERT INTO knowledge(title,body,author,active,updated_at) VALUES('Qoralama bo‘lim','Maxfiy qoralama matni','Yozishmalardan (tekshirilmagan)',0,?)`, Date.now());
  run(`INSERT INTO knowledge(title,body,author,active,updated_at) VALUES('Kafolat sinov','1 yil kafolat\n[Tekshiring: talon kerakmi?]','Rahbar',1,?)`, Date.now());
  const p = knowledgePrompt();
  assert.ok(!p.includes('Maxfiy qoralama matni'));
  assert.ok(p.includes('1 yil kafolat') && !p.includes('talon kerakmi'));
});

test('narx himoyasi: javobdagi $ narx faqat katalog qaytargan narx yoki 2–3 tasining yig‘indisi', async () => {
  const { unknownPrices } = await import('../src/agents/fokus.js');
  const P = new Set([670, 125, 65]);
  assert.equal(unknownPrices('bor, narxi 670$ boladi', P), null);
  assert.equal(unknownPrices('yjbei 125$ ⏎ softbox bilan 190$ boladi', P), null, '125+65 — to‘plam narxi');
  assert.equal(unknownPrices('hammasi 860$', P), null, '670+125+65');
  assert.equal(unknownPrices('pocket 3 bor, narxi 400$', P), '400$', 'katalogda yo‘q narx — to‘xtatiladi');
  assert.equal(unknownPrices('narxi $1 750', new Set([1750])), null, '$ oldinda va bo‘shliqli son');
  assert.equal(unknownPrices('128 GB, 4K video, 2 dona', P), null, 'narx emas');
  assert.equal(unknownPrices('narxi 670$', new Set()), '670$', 'qidiruvsiz aytilgan narx ham to‘xtatiladi');
  // Model nomidagi raqam narxga qo‘shilib ketmaydi: «F4 1000$» — 1000$, 41000$ emas
  assert.equal(unknownPrices('Canon RF 24-105mm F4 1000$ — hozir yoq', new Set([1000])), null);
  assert.equal(unknownPrices('Sony A7 IV 1 780$', new Set([1780])), null, '«1 780» — ming ajratgich');
  assert.equal(unknownPrices('Canon RF 16mm 260$ ¶ Canon RF 24-70mm 1780$', new Set([260, 1780])), null);
  assert.equal(unknownPrices('narxi 12.5$', new Set([12.5])), null, 'kasr');
});

test('til: ruscha va o‘zbekcha kirill so‘z ro‘yxatida bo‘lmasa ham taniladi; qisqa xabarda oldingilariga qaraladi', async () => {
  const { tilBelgisi, clientLang } = await import('../src/agents/fokus.js');
  assert.equal(tilBelgisi('чтоб петличку внутри устанавливать и видео снимать'), 'RUS tili');
  assert.equal(tilBelgisi('аник модель кидирганим йок'), 'o‘zbek tili, KIRILL yozuvi');
  assert.equal(tilBelgisi('вариантларни корсатсангиз'), 'o‘zbek tili, KIRILL yozuvi');
  assert.equal(tilBelgisi('100 доллар'), '', '«доллар» o‘zbekcha qo‘shimcha emas');
  assert.equal(clientLang(['петличный', 'ой', 'петличка у меня есть', 'нужна вот микрофон палка', 'ой']), 'RUS tili', '«ой» dan til chiqmaydi — oldingilariga qaraladi');
  assert.equal(clientLang(['нужна вот микрофон палка', 'аник модель кидирганим йок', 'вариантларни корсатсангиз', 'танлардим']), 'o‘zbek tili, KIRILL yozuvi', 'mijoz o‘zbekchaga o‘tdi');
  assert.equal(clientLang(['[rasm]', 'Salom, narxi qancha?']), '');
});

test('aralash yozuv lotinga: «хозир sotuvchimiz yozadi»', async () => {
  const { uzLatin } = await import('../src/agents/fokus.js');
  assert.equal(uzLatin('хозир sotuvchimiz yozadi, yordam berib yuboradi'), 'xozir sotuvchimiz yozadi, yordam berib yuboradi');
});

test('qoldiq holati modelga tayyor matn bilan: bor / faqat omborda / yo‘q / noma’lum', async () => {
  const { stockLabel } = await import('../src/agents/fokus.js');
  assert.match(stockLabel({ stock_total: 3, stock_store: 3, stock_warehouse: 0, stale: false }), /^BOR — do‘konda 3 dona/);
  assert.match(stockLabel({ stock_total: 2, stock_store: 0, stock_warehouse: 2, stale: false }), /^FAQAT OMBORDA/);
  assert.match(stockLabel({ stock_total: 0, stock_store: 0, stock_warehouse: 0, stale: false }), /^YO‘Q/);
  assert.match(stockLabel({ stock_total: 5, stock_store: 5, stock_warehouse: 0, stale: true }), /^NOMA’LUM/, 'eskirgan qoldiq — raqam aytilmaydi');
  assert.match(stockLabel(null), /^NOMA’LUM/);
});
