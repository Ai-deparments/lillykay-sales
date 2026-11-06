/* Reklama auditoriyasi: keshbek summasi va «tanilgan mijoz» filtri; bloklaganlar chiqmaydi; filtr matni tarix uchun */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sales-reklama-'));
Object.assign(process.env, { DB_FILE: join(dir, 't.db'), DATA_DIR: dir, TG_DISABLED: '1', ENV_FILE: join(dir, 'yoq.env') });

const { migrate, run } = await import('../src/db.js');
migrate();   // reklama.js keshbek botini import qiladi — u yuklanishda kv ni o‘qiydi, jadval tayyor bo‘lsin
const { audience, parseFilter, describeFilter } = await import('../src/services/reklama.js');

before(() => {
  const t = Date.now();
  // mijozlar: 1 — keshbek 120 000, 2 — 30 000, 3 — 0 (balans yo‘q); obunachilar: 3 ta tanilgan, 1 ta noma’lum, 1 ta bloklagan (katta keshbek)
  for (const [id, amount] of [[1, 120000], [2, 30000], [3, 0], [4, 900000]]) {
    run(`INSERT INTO customers(id,name,created_at) VALUES(?,?,?)`, id, 'M' + id, t);
    if (amount) run(`INSERT INTO cashback(customer_id,amount,synced_at) VALUES(?,?,?)`, id, amount, t);
  }
  for (const [chat, cust, blocked] of [[11, 1, null], [12, 2, null], [13, 3, null], [14, null, null], [15, 4, t]])
    run(`INSERT INTO cb_subs(chat_id,customer_id,name,joined_at,last_at,checks,blocked_at) VALUES(?,?,?,?,?,0,?)`, chat, cust, 'S' + chat, t, t, blocked);
});
after(() => rmSync(dir, { recursive: true, force: true }));

const ids = f => audience(f).map(r => r.chat_id);

test('filtrsiz — bloklaganlardan tashqari hamma', () => {
  assert.deepEqual(ids(null), [11, 12, 13, 14]);
  assert.equal(describeFilter(null), 'hamma obunachi');
});

test('keshbek summasi bo‘yicha: dan / gacha; summa ko‘rsatilsa noma’lum obunachi chiqib ketadi', () => {
  assert.deepEqual(ids({ cb_min: 50000 }), [11], '50 000 dan: faqat 120 000');
  assert.deepEqual(ids({ cb_min: '20 000' }), [11, 12], 'bo‘shliqli raqam ham o‘qiladi');
  assert.deepEqual(ids({ cb_max: 50000 }), [12, 13, 14], 'gacha: 0 balans va noma’lum (0 deb) qoladi');
  assert.deepEqual(ids({ cb_min: 100000, cb_max: 20000 }), [12], 'dan > gacha — o‘rni almashadi: 20 000…100 000 oralig‘ida faqat 30 000');
  assert.equal(describeFilter({ cb_min: 50000, cb_max: 200000 }), 'keshbek 50 000 so‘mdan · 200 000 so‘mgacha');
});

test('faqat tanilgan mijozlar; bloklagan katta keshbekli ham chiqmaydi', () => {
  assert.deepEqual(ids({ known: true }), [11, 12, 13]);
  assert.deepEqual(ids({ known: 'true', cb_min: 1 }), [11, 12]);
  assert.deepEqual(parseFilter({ cb_min: 'abc', cb_max: -5, known: 'yo‘q' }), { cb_min: null, cb_max: null, known: false });
});
