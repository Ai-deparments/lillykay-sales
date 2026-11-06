/*
  Qabul sinovlari (TZ 4-bo‘lim): Q2, Q4, Q5, Q6. Q1 — test/inbox.test.js.
  Q3 va Q7 AI kaliti va Photobuy savollar to‘plami bilan alohida o‘tkaziladi.
*/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sales-acc-'));
process.env.DB_FILE = join(dir, 't.db');
process.env.DATA_DIR = dir;
process.env.DRAFT_DEBOUNCE_MS = '999999';
process.env.TG_DISABLED = '1';

const { migrate, run, one, all } = await import('../src/db.js');
const { customerProfile } = await import('../src/services/billz.js');
const { looksBigList } = await import('../src/agents/fokus.js');

const DAY = 864e5, t = Date.now();
let pid = 0;
function product(name, price, stock) {
  return run(`INSERT INTO products(name,price,stock_json,stock_synced_at,status,updated_at) VALUES(?,?,?,?, 'verified', ?)`, name, price, JSON.stringify({ A: stock }), t, t).lastInsertRowid;
}
const customer = (name, extra = {}) => run(`INSERT INTO customers(name,phone,billz_id,verified_at,bot_chat_id,consent_at,optout_at,created_at) VALUES(?,?,?,?,?,?,?,?)`,
  name, extra.phone || null, `B-${name}`, extra.verified ? t : null, extra.bot ?? null, extra.consent ? t : null, extra.optout ? t : null, t).lastInsertRowid;
const buy = (cust, prod, name, amount, soldAt, returnedAt = null, branch = 'A') =>
  run(`INSERT INTO purchases(receipt,line,customer_id,product_id,product_name,qty,amount,branch_name,sold_at,returned_at) VALUES(?,?,?,?,?,1,?,?,?,?)`,
    `R-${++pid}`, 1, cust, prod, name, amount, branch, soldAt, returnedAt);

before(() => { migrate(); });
after(() => rmSync(dir, { recursive: true, force: true }));

/* ---------- Q2: xarid, qaytarish, keshbek BILLZ bilan teng; boshqa mijoz ma’lumoti chiqmaydi ---------- */
test('Q2: tasdiqlanmagan mijozga xarid va keshbek ko‘rsatilmaydi', () => {
  const p = product('Q2 kamera', 10_000_000, 3);
  const u = customer('Q2-tasdiqlanmagan');
  buy(u, p, 'Q2 kamera', 10_000_000, t - 10 * DAY);
  run('INSERT INTO cashback(customer_id,amount,synced_at) VALUES(?,?,?)', u, 500_000, t);
  assert.deepEqual(customerProfile(u), { verified: false });
  assert.deepEqual(customerProfile(null), { verified: false });
});

test('Q2: tasdiqlangan mijoz faqat o‘z xaridlarini ko‘radi, qaytarish belgilanadi, keshbek manba va vaqt bilan', () => {
  const p = product('Q2 obyektiv', 3_000_000, 2);
  const a = customer('Q2-A', { verified: true }), b = customer('Q2-B', { verified: true });
  buy(a, p, 'Q2 obyektiv', 3_000_000, t - 20 * DAY);
  buy(a, p, 'Q2 obyektiv', 3_000_000, t - 15 * DAY, t - 14 * DAY);
  buy(b, p, 'Q2 obyektiv', 3_000_000, t - 5 * DAY);
  run('INSERT INTO cashback(customer_id,amount,synced_at) VALUES(?,?,?)', a, 897_000, t - 3600e3);
  const pa = customerProfile(a);
  assert.equal(pa.verified, true);
  assert.equal(pa.purchases.length, 2, 'faqat A ning 2 ta xaridi');
  assert.equal(pa.purchases.filter(x => x.returned).length, 1, 'qaytarish belgilangan');
  assert.equal(pa.cashback.amount, 897_000);
  assert.ok(pa.cashback.synced_at && pa.cashback.source);
  assert.equal(pa.cashback.stale, false);
});

/* ---------- Q4: katta ro‘yxat va oddiy buyurtma — 20 misol ---------- */
const BIG = [
  'Godox SL60W — 4 ta\nsoftbox — 4 ta\nstoyka — 4 ta\nSony A7 IV — 2 ta\nSigma 24-70 — 2 ta',
  'Нужно:\nSony FX30 — 2 шт\nобъектив 18-105 — 2 шт\nмикрофон — 3 шт\nштатив — 3 шт\nкарта 128 — 6 шт',
  'SD karta 128 — 20 dona',
  'kamera 2 ta\nobyektiv 2 ta\nmikrofon 2 ta\nsvet 2 ta\ntripod 2 ta',
  'Studiya uchun: fon 3 ta, lampa 6 ta' + '\nsoftbox 6 ta\nstoyka 6 ta\nqisqich 10 ta\nkabel 10 ta',
  'Korporativ buyurtma:\nCanon R50 — 3\nRF 50mm — 3\nSD 64 — 3\nsumka — 3\nbatareya — 6',
  'DJI Mic 2 — 5 ta\nDJI Mic Mini — 5 ta',
  'Мне 12 шт аккумуляторов NP-FZ100',
  'ro‘yxat:\n1) A7 IV x2\n2) 24-70 x2\n3) 70-200 x1\n4) RS 4 x1\n5) SL60W x4',
  'Aputure 300d — 2\nsoftbox 120 — 2\nstoyka — 4\nfon — 2\nqisqich — 4'
];
const SMALL = [
  'DJI Mic 2 bormi?', 'Sony ZV-E10 ga ulasa bo‘ladimi?', 'Narxi qancha?', 'Здравствуйте, есть ли X-S20?',
  'Keshbekim qancha?', 'Ertaga kelaman, 2 ta olaman', 'A7 IV va FE 50mm narxi?', 'Sotuvchi bilan gaplashsam bo‘ladimi',
  '10 kundan keyin olaman', 'Kafolat necha oy?'
];
test('Q4: 10 ta katta ro‘yxat aniqlanadi, 10 ta oddiy xabar katta deb belgilanmaydi', () => {
  const missed = BIG.filter(x => !looksBigList(x)), false_ = SMALL.filter(x => looksBigList(x));
  assert.deepEqual(missed, [], 'aniqlanmagan katta ro‘yxatlar');
  assert.deepEqual(false_, [], 'noto‘g‘ri katta deb topilgan');
});
