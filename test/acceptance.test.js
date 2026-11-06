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
const ch = await import('../src/agents/chaqnoq.js');
const ob = await import('../src/agents/obyektiv.js');
const { updateSettings } = await import('../src/services/settings.js');

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

before(() => { migrate(); updateSettings({ campaign_from: '00:00', campaign_to: '23:59' }, 'test'); });
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

/* ---------- Q5: kampaniya qayta ishga tushirilganda takror xabar yo‘q; istisnolar chiqariladi ---------- */
test('Q5: kampaniya — istisnolar, bog‘lanmaganlar vazifaga, qayta ishga tushirishda takror yo‘q', async () => {
  const cam = product('Q5 kamera', 9_000_000, 5), mic = product('Q5 mikrofon', 2_000_000, 10);
  run(`INSERT INTO resale_rules(bought_product_id,suggest_product_id,reason,min_days,max_days,created_at) VALUES(?,?,?,7,365,?)`, cam, mic, 'Kamera egasi, mikrofon olmagan', t);
  const ok = customer('Q5-bot', { bot: 1001, consent: true });          // → bot
  const noConsent = customer('Q5-rozilik-yoq', { bot: 1002 });           // → yuborilmaydi
  const phoneOnly = customer('Q5-telefon');                              // → sotuvchi vazifasi
  const returned = customer('Q5-qaytargan', { bot: 1003, consent: true });
  const already = customer('Q5-olgan', { bot: 1004, consent: true });
  const optout = customer('Q5-voz', { bot: 1005, consent: true, optout: true });
  for (const c of [ok, noConsent, phoneOnly, already, optout]) buy(c, cam, 'Q5 kamera', 9_000_000, t - 30 * DAY);
  buy(returned, cam, 'Q5 kamera', 9_000_000, t - 30 * DAY, t - 28 * DAY);
  buy(already, mic, 'Q5 mikrofon', 2_000_000, t - 10 * DAY);
  // demo mijoz sifatida belgilaymiz — Telegram’ga haqiqiy so‘rov ketmasin
  run('UPDATE customers SET is_demo=1 WHERE id IN (?,?,?,?,?,?)', ok, noConsent, phoneOnly, returned, already, optout);
  const id = ch.createCampaign({ product_id: mic, title: 'Q5', message: 'Salom {ism}, {mahsulot} keldi' }, 'test');
  const seg = ch.campaignSegment(id);
  assert.equal(seg.bot.length, 1, 'faqat ulangan va rozilik bergan');
  assert.equal(seg.no_consent.length, 1);
  assert.equal(seg.task.length, 1, 'telefon ≠ Telegram — sotuvchi vazifasi');
  assert.equal(seg.excluded.qaytargan, 1);
  assert.equal(seg.excluded.allaqachon_olgan, 1);
  assert.equal(seg.excluded.voz_kechgan, 1);
  ch.setCampaignStatus(id, 'running', 'test');
  await ch.campaignWorker();
  const s1 = ch.campaignStats(id);
  await ch.campaignWorker(); await ch.campaignWorker();
  const s2 = ch.campaignStats(id);
  assert.deepEqual(s2, s1, 'qayta ishga tushirish natijani o‘zgartirmaydi');
  assert.equal(s1.sent + s1.task, 2);
  assert.equal(one('SELECT count(*) n FROM campaign_sends WHERE campaign_id=?', id).n, 2);
  assert.equal(one(`SELECT count(*) n FROM tasks WHERE kind='campaign'`).n, 1);
});

test('Q5: qoldiq tugasa kampaniya to‘xtaydi', async () => {
  const a = product('Q5b kamera', 1, 1), b = product('Q5b aksessuar', 1, 0);
  run(`INSERT INTO resale_rules(bought_product_id,suggest_product_id,reason,created_at) VALUES(?,?,?,?)`, a, b, 'test', t);
  const id = ch.createCampaign({ product_id: b }, 'test');
  ch.setCampaignStatus(id, 'running', 'test');
  await ch.campaignWorker();
  assert.equal(one('SELECT status FROM campaigns WHERE id=?', id).status, 'paused');
});

/* ---------- Q6: reja, fakt, prognoz nazorat hisoblari bilan mos; qaytarish, reja nol ---------- */
test('Q6: sof tushum = sotuv − qaytarish; bajarilish foizi; reja nol — foiz yo‘q', () => {
  const period = ob.currentPeriod(), b = ob.bounds(period);
  const at = Math.min(b.start + 3600e3, t - 60e3);
  const p = product('Q6 tovar', 1_000_000, 5);
  const before = ob.facts(period, { branch: 'Q6-filial' });
  assert.equal(before.net, 0);
  buy(null, p, 'Q6 tovar', 5_000_000, at, null, 'Q6-filial');
  buy(null, p, 'Q6 tovar', 3_000_000, at, null, 'Q6-filial');
  buy(null, p, 'Q6 tovar', 2_000_000, at, Math.min(at + 3600e3, t - 30e3), 'Q6-filial'); // qaytarilgan
  const f = ob.facts(period, { branch: 'Q6-filial' });
  assert.equal(f.gross, 10_000_000);
  assert.equal(f.returns, 2_000_000);
  assert.equal(f.net, 8_000_000, 'sof = 10 − 2');
  assert.equal(f.checks, 3);
  // reja nol (belgilanmagan) — foiz ko‘rsatilmaydi
  const d0 = ob.dashboard(period, { role: 'rahbar', id: 0 }).branches.find(x => x.name === 'Q6-filial');
  assert.equal(d0.plan, null); assert.equal(d0.pct, null);
  ob.setPlan({ period, scope: 'branch', key: 'Q6-filial', revenue: 16_000_000 }, 'test');
  const d1 = ob.dashboard(period, { role: 'rahbar', id: 0 }).branches.find(x => x.name === 'Q6-filial');
  assert.equal(d1.plan, 16_000_000);
  assert.equal(d1.pct, 50, '8 / 16 = 50%');
  // prognoz = fakt + kutilma, hech qachon faktdan kam emas
  const fc = ob.forecast(period, { branch: 'Q6-filial' });
  assert.ok(fc.forecast >= fc.net);
  assert.ok(['past', 'o‘rta', 'yakunlangan'].includes(fc.confidence));
});

test('Q6: reja versiyalari saqlanadi, o‘tgan davr qulflangan', () => {
  const period = ob.currentPeriod();
  ob.setPlan({ period, revenue: 100 }, 'test'); ob.setPlan({ period, revenue: 200 }, 'test');
  const v = ob.planVersions(period);
  assert.ok(v.length >= 2 && v[0].revenue === 200 && v[0].version > v[1].version);
  assert.throws(() => ob.setPlan({ period: '2020-01', revenue: 1 }, 'test'), /period_locked/);
});

test('Q6: qoldig‘i yo‘q tovar qayta sotuv ro‘yxatiga tushmaydi', () => {
  const a = product('Q6c kamera', 1, 1), b = product('Q6c obyektiv', 1, 0);
  run(`INSERT INTO resale_rules(bought_product_id,suggest_product_id,reason,created_at) VALUES(?,?,?,?)`, a, b, 'test', t);
  const c = customer('Q6c');
  buy(c, a, 'Q6c kamera', 1, t - 30 * DAY);
  const r = ch.candidates({ productId: b });
  assert.equal(r.list.length, 0);
  assert.ok(r.excluded.qoldiq_yoq >= 1);
});
