/*
  Karta tayyorligi: model nomidan o‘lchov o‘qish, dastlabki qoralama va AI ga beriladigan fakt bloki.
  AI kaliti kerak emas — bu qism kalitsiz ishlaydi va kalit kelganda agentning ishini qisqartiradi.
*/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sales-kat-'));
process.env.DB_FILE = join(dir, 't.db');
process.env.DATA_DIR = dir;
process.env.TG_DISABLED = '1';

const { migrate, run, one } = await import('../src/db.js');
const { fromName, prefill, knownFacts, PREFIX, waveOf, needsAi } = await import('../src/services/karta-tayyor.js');
const { product, searchProducts } = await import('../src/services/catalog.js');

const t = Date.now();
const add = (name, extra = {}) => run(`INSERT INTO products(name,brand,category,sku,price,stock_json,stock_synced_at,specs,status,billz_id,updated_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?)`, name, extra.brand || null, extra.category || null, extra.sku || null, extra.price || 1000,
  JSON.stringify(extra.stock || { 'Photobuy': 3 }), t, extra.specs || null, extra.status || 'draft', `B-${name}`, t).lastInsertRowid;

before(() => migrate());
after(() => rmSync(dir, { recursive: true, force: true }));

test('model nomidan faqat bir ma’noli o‘lchovlar o‘qiladi', () => {
  assert.deepEqual(fromName('Godox SL60W'), ['quvvat 60 W']);
  assert.deepEqual(fromName('Sandisk SDXC UHS-1 128GB Extrem PRO'), ['sig‘im 128 GB', 'tezlik sinfi UHS-1']);
  const canon = fromName('Canon RF 50mm f/1.8 STM');
  assert.ok(canon.includes('fokus masofasi 50 mm') && canon.includes('diafragma f/1.8') && canon.includes('RF bayoneti'));
  assert.ok(fromName('NEEWER 90CM SOFTBOX WITH BOWENS MOUNT').includes('Bowens bayoneti'));
  assert.deepEqual(fromName('LEXAR SD 128GB V 60'), ['sig‘im 128 GB', 'video tezlik sinfi V60'], 'bo‘shliq bilan yozilgan tezlik sinfi ham o‘qiladi');
  // tanimagan nomda taxmin qilinmaydi
  assert.deepEqual(fromName('QIHE STAND'), []);
});

test('dastlabki qoralama: bo‘sh kartaga yoziladi, to‘lganiga tegilmaydi', () => {
  const id = add('Godox SL60W — Осветительный прибор', { brand: 'Godox', category: 'Osvetitel' });
  const pre = prefill(product(id));
  assert.ok(pre.specs.startsWith(PREFIX), 'tekshirilmagani ochiq yozilishi kerak');
  assert.ok(pre.specs.includes('quvvat 60 W') && pre.specs.includes('Godox'));
  assert.match(pre.limits, /tekshirilmagan/);

  // o‘zimiz yozgan dastlabki qoralama yangilanadi (qoida yaxshilanganda)
  const eski = add('Godox SL100W', { specs: `${PREFIX} eski` });
  assert.ok(prefill(product(eski)).specs.includes('quvvat 100 W'), 'dastlabki qoralama qayta hisoblanadi');
  const tola = add('Nanlite Forza 60', { specs: 'Rasmiy manbadan olingan xususiyatlar' });
  assert.equal(prefill(product(tola)), null, 'to‘ldirilgan kartaga tegilmaydi');
  const tasdiq = add('Aputure 120D', { status: 'verified' });
  assert.equal(prefill(product(tasdiq)), null, 'tasdiqlangan kartaga tegilmaydi');
});

test('AI ga beriladigan fakt bloki: nom, brend, toifa, savdo va qo‘shni modellar', () => {
  const id = add('DJI MIC MINI 2+1 MOBILE', { brand: 'DJI', category: 'Mikrofon', sku: 'DJI-MM21' });
  add('HOLLYLAND LARK M2', { brand: 'DJI', category: 'Mikrofon' });
  const f = knownFacts(product(id));
  assert.match(f, /DJI MIC MINI 2\+1 MOBILE/);
  assert.match(f, /SKU\/model: DJI-MM21/);
  assert.match(f, /Toifa \(BILLZ\): Mikrofon/);
  assert.match(f, /90 kunda/);
  assert.match(f, /to‘plam varianti 2\+1/);
  assert.match(f, /HOLLYLAND LARK M2/, 'qo‘shni model ko‘rsatiladi');
  assert.ok(!/narx.*kartaga yoziladi/i.test(f), 'narx kartaga yozilmasligi aytilgan bo‘lishi kerak');
});

test('narx kartaga tushmaydi — faqat ma’lumot uchun beriladi', () => {
  const id = add('Zhiyun Crane 4', { price: 4500000, category: 'Stabilizator' });
  assert.match(knownFacts(product(id)), /kartaga yozilmaydi/);
});

test('to‘lqinlar: A — birinchi 60, B — keyingi 90, C — qolgani', () => {
  const q = Array.from({ length: 200 }, (_, i) => ({ id: i }));
  assert.equal(waveOf(q, 'a').length, 60);
  assert.equal(waveOf(q, 'b').length, 90);
  assert.equal(waveOf(q, 'c').length, 50);
  assert.equal(waveOf(q, '').length, 200, 'to‘lqin ko‘rsatilmasa — hammasi');
  assert.equal(waveOf(q.slice(0, 20), 'a').length, 20, 'navbat qisqa bo‘lsa ham ishlaydi');
});

test('davom ettirish: AI to‘ldirgan karta qayta yuborilmaydi', () => {
  const dastlabki = { specs: `${PREFIX} quvvat 60 W`, sources: [] };
  const aiToldirgan = { specs: 'Rasmiy manbadan', sources: ['https://godox.com — rasmiy (tekshirildi 2026-09-20)'] };
  const yarim = { specs: `${PREFIX} quvvat 60 W`, sources: ['https://x — (tekshirildi 2026-09-20)'] };
  assert.equal(needsAi(dastlabki), true, 'faqat nomdan olingan qoralama — AI kerak');
  assert.equal(needsAi(aiToldirgan), false, 'to‘ldirilgan karta — takror yuborilmaydi');
  assert.equal(needsAi(yarim), true, 'dastlabki matn qolgan bo‘lsa — hali tekshirilmagan');
  assert.equal(needsAi({}), true);
});

test('qidiruv: mijoz so‘zi («svet», «chiroq», «petlichka», «obyektiv») katalog toifasini topadi; toifa nomi bo‘sh bo‘lsa — nomdagi « — toifa»dan', () => {
  const light = add('ZZTEST LIGHT ONE — Осветительный прибор', { category: 'Осветительный прибор' });
  const light2 = add('ZZTEST LIGHT TWO — Осветительный прибор');            // category yo‘q — nomdan olinadi
  const lav = add('ZZTEST LAV — Петличка микрофон', { category: 'Петличка микрофон' });
  const lens = add('ZZTEST LENS — Объектив', { category: 'Объектив' });
  const ids = q => searchProducts(q, 20).map(p => p.id);
  for (const q of ['svet', 'chiroq', 'чироқ', 'salon uchun svet']) { assert.ok(ids(q).includes(light), q); assert.ok(ids(q).includes(light2), `${q} (nomdan)`); }
  assert.ok(ids('petlichka').includes(lav));
  assert.ok(ids('obyektiv').includes(lens));
  assert.ok(!ids('obyektiv').includes(light), 'boshqa toifa chiqmaydi');
});

test('qidiruv: «arzonrog‘i bormi?» — narx chegarasi va faqat qoldig‘i borlar', () => {
  add('SONY ZV E 10 SINOV — Фотоаппарат', { category: 'Фотоаппарат', price: 670 });
  add('SONY A7 III SINOV — Фотоаппарат', { category: 'Фотоаппарат', price: 1200 });
  add('CANON M50 SINOV — Фотоаппарат', { category: 'Фотоаппарат', price: 500, stock: { Photobuy: 0 } });
  const names = (q, o) => searchProducts(q, 6, o).map(p => p.name.split(' ')[1]).sort();
  assert.deepEqual(names('SINOV фотоаппарат'), ['A7', 'M50', 'ZV']);
  assert.deepEqual(names('SINOV фотоаппарат', { maxPrice: 700 }), ['M50', 'ZV']);
  assert.deepEqual(names('SINOV фотоаппарат', { maxPrice: 700, inStock: true }), ['ZV'], 'qoldig‘i yo‘q chiqmaydi');
});

test('budjet filtri: aksiya hamma do‘konda bo‘lsa — aksiya narxi bo‘yicha; bitta do‘konda yoki ma’lumot eskirgan bo‘lsa — oddiy narx', () => {
  const a = add('AKSIYATEST R10 — Фотоаппарат', { price: 800 });
  const b = add('AKSIYATEST R20 — Фотоаппарат', { price: 800, stock: { Photobuy: 3, Photobuy2: 1 } });
  run('UPDATE products SET price_json=? WHERE id=?', JSON.stringify({ Photobuy: { price: 800, currency: 'USD', promo: 650, promo_name: 'Kuzgi' } }), a);
  run('UPDATE products SET price_json=? WHERE id=?', JSON.stringify({ Photobuy: { price: 800, currency: 'USD', promo: 650 }, Photobuy2: { price: 800, currency: 'USD' } }), b);
  const names = o => searchProducts('AKSIYATEST', 6, o).map(p => p.name.split(' ')[1]).sort();
  assert.deepEqual(names(), ['R10', 'R20']);
  assert.deepEqual(names({ maxPrice: 700 }), ['R10'], 'aksiya narxi budjetga tushdi; bitta do‘kondagi aksiya hisobga olinmaydi');
  run('UPDATE products SET stock_synced_at=? WHERE id=?', t - 30 * 864e5, a);
  assert.deepEqual(names({ maxPrice: 700 }), [], 'ma’lumot eskirgan — aksiya hisobga olinmaydi');
});
