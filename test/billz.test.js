/*
  BILLZ ulagichi — soxta BILLZ API bilan (javob shakllari docs.billz.io OpenAPI 2026.08 bo‘yicha), haqiqiy tarmoqsiz.
  Tekshiriladi: noto‘g‘ri kalit (401) — tushunarli xato va so‘rovlar to‘xtashi; token muddati tugasa qayta kirish; 429 da kutib qayta;
  magazinlar → filiallar; tovarlar (sahifalab, narx UZS, qoldiq filial nomi bilan, qo‘lda kiritilgan karta bog‘lanishi);
  to‘liq ro‘yxatda yo‘q tovar — qoldiq 0; chala ro‘yxat qo‘llanmaydi; mijozlar va keshbek; bir raqam ikki mijozda — tasdiqlanmaydi;
  xaridlar va qaytarishlar (sof = sotuv − qaytarish), qayta sinxron dublikat bermaydi; kutilmagan qator tuzilmasi — to‘xtaydi.
*/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sales-billz-'));
Object.assign(process.env, { DB_FILE: join(dir, 't.db'), DATA_DIR: dir, TG_DISABLED: '1', BILLZ_SECRET_TOKEN: 'notogri', BILLZ_API_BASE: 'https://billz.sinov', BILLZ_GAP_MS: '0', ENV_FILE: join(dir, 'yoq.env') });

/* ---------- soxta BILLZ ---------- */
const S1 = '11111111-1111-1111-1111-111111111111', S2 = '22222222-2222-2222-2222-222222222222', S3 = '33333333-3333-3333-3333-333333333333';
const state = { key: 'togri-kalit', token: 'AT-1', expireNext: false, rate429: 0, logins: 0, calls: [], products: [], clients: [], purchases: [], countLie: 0, purchaseShape: null };
const ok = body => ({ ok: true, status: 200, json: async () => body });
const fail = (status, message, error) => ({ ok: false, status, json: async () => ({ code: status, message, error, data: null }) });
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url), path = u.pathname, q = Object.fromEntries(u.searchParams);
  state.calls.push(`${opts.method} ${path}`);
  if (path === '/v1/auth/login') {
    state.logins++;
    const b = JSON.parse(opts.body);
    if (b.secret_token !== state.key) return fail(401, 'unauthorized', 'sql: no rows in result set');
    state.token = `AT-${state.logins}`;
    return ok({ code: 200, message: 'ok', error: null, data: { access_token: state.token, refresh_token: 'RT', token_type: 'Bearer', expires_in: 1296000 } });
  }
  if (opts.headers?.authorization !== `Bearer ${state.token}`) return fail(401, 'unauthorized', 'session not found');
  if (state.expireNext) { state.expireNext = false; state.token = 'eskirgan'; return fail(401, 'token expired', 'token has been expired'); }
  if (state.rate429 > 0) { state.rate429--; return fail(429, 'too many requests', 'rate limit'); }
  const page = Number(q.page || 1), limit = Number(q.limit || 100);
  const pageOf = (arr, key, extra = 0) => ok({ count: arr.length + extra, [key]: arr.slice((page - 1) * limit, page * limit) });
  if (path === '/v1/user') return pageOf([
    { id: 'u1', first_name: 'Komiljon', last_name: 'Gafurov', phone_number: '+998900000001', password: '$2a$xesh', roles: [{ id: 'r1', name: 'Продавец' }], shops: [{ id: S1, name: 'Chilonzor' }], deleted_at: 0 },
    { id: 'u2', first_name: 'PHOTOBUY AI', last_name: 'api', phone_number: '+998900000002', password: '$2a$xesh', roles: [], shops: [{ id: S1 }] }
  ], 'users');
  if (path === '/v1/shop') return pageOf([{ id: S1, name: 'Chilonzor' }, { id: S2, name: 'Yunusobod' }, { id: S3, name: 'PHOTOBUY SKLAD' }], 'shops');
  if (path === '/v2/products') {
    const list = q.last_updated_date ? state.products.filter(p => p.updated_at > q.last_updated_date) : state.products;
    return pageOf(list, 'products', state.countLie);
  }
  if (path === '/v1/client') {
    const list = q.phone_number ? state.clients.filter(c => c.phone_numbers.some(p => p.replace('+', '') === q.phone_number.replace('+', ''))) : state.clients;
    return pageOf(list, 'clients');
  }
  if (path === '/v1/customer-purchases-table') {
    // Haqiqiy BILLZ kabi: shop_ids berilmasa — xatosiz, lekin bo‘sh (2026-09-20 da aniqlangan)
    if (!q.shop_ids) return ok({ purchases: [], count: 0 });
    const shops = q.shop_ids.split(',');
    const rows = state.purchaseShape ? [state.purchaseShape] : state.purchases.filter(r => shops.includes(r.shop_id) && r.created_at.slice(0, 10) >= q.start_date && r.created_at.slice(0, 10) <= q.end_date);
    return pageOf(rows, 'purchases');
  }
  return fail(404, 'not found', 'route');
};

const prod = (id, name, { sku, stock = [3, 2], sklad = 0, price = [9800000, 9800000], currency = 'UZS', promo = null, updated = '2026-09-01 10:00:00', brand = 'Sony', cats = [{ id: 'c1', name: 'Kameralar' }] } = {}) => ({
  id, name, sku, barcode: `BC-${id}`, brand_name: brand, categories: cats, updated_at: updated,
  shop_measurement_values: [{ shop_id: S1, shop_name: 'Chilonzor', active_measurement_value: stock[0] }, { shop_id: S2, shop_name: 'Yunusobod', active_measurement_value: stock[1] },
    ...(sklad ? [{ shop_id: S3, shop_name: 'PHOTOBUY SKLAD', active_measurement_value: sklad }] : [])],
  shop_prices: [{ shop_id: S1, retail_price: price[0], retail_currency: currency, promo_price: promo || 0, promos: promo ? [{ name: 'Kuzgi aksiya' }] : [] },
    { shop_id: S2, retail_price: price[1], retail_currency: currency, promo_price: 0, promos: [] }]
});

const { migrate, run, one, all } = await import('../src/db.js');
const { billzTick, syncPurchases, refreshClientByPhone, syncProducts } = await import('../src/services/billz-sync.js');
const { integration } = await import('../src/services/settings.js');
const { customerByPhone, priceStock, customerProfile } = await import('../src/services/billz.js');
const { facts } = await import('../src/agents/obyektiv.js');
const { config } = await import('../src/config.js');
const { resetBillzAuth } = await import('../src/services/billz-api.js');

const ymd = ts => new Date(ts + 5 * 3600e3).toISOString().slice(0, 10);
const TODAY = ymd(Date.now()), YDAY = ymd(Date.now() - 864e5);
const at = (day, hm) => `${day} ${hm}:00`;
// Bugungi qaytarish vaqti — hozirdan oldin va bugun ichida (sinov har qanday soatda ishlasin)
const RET_AT = new Date(Math.max(Date.now() - 60e3, Date.parse(`${TODAY}T00:00:00+05:00`)) + 5 * 3600e3).toISOString().slice(0, 19).replace('T', ' ');

before(() => {
  migrate();
  // Katalog agenti oldin qo‘lda kiritgan karta (tekshirilgan tavsif bilan) — BILLZ bilan nomi bo‘yicha bog‘lanishi kerak
  run(`INSERT INTO products(name,specs,status,updated_at) VALUES('Sony ZV-E10 kit 16-50mm','APS-C, 24 MP','verified',0)`);
  // Demo (sinov) ma’lumot — BILLZ birinchi marta ulanganda olib tashlanishi kerak
  run(`INSERT INTO accounts(channel,ext_id,name,can_reply,enabled,mode,rollout,is_demo,created_at) VALUES('demo','d1','Demo',1,1,'kechiksa','avto',1,0)`);
  run(`INSERT INTO customers(name,phone,billz_id,is_demo,created_at) VALUES('Demo mijoz','+998000000001','DEMO-1',1,0)`);
  run(`INSERT INTO purchases(receipt,line,customer_id,product_name,qty,amount,sold_at,is_demo) VALUES('D-1',1,1,'Demo tovar',1,5000000,?,1)`, Date.now() - 3 * 864e5);
  state.products = [
    prod('p-1', 'Sony ZV-E10 kit 16-50mm', { sku: 'ZV-E10K' }),
    prod('p-2', 'DJI Mic 2', { sku: 'MIC2', stock: [0, 4], price: [3500000, 3600000], promo: 3200000 }),
    prod('p-3', 'Import obyektiv', { sku: 'IMP', price: [700, 700], currency: 'USD', stock: [0, 0], sklad: 6 }),
    // Photobuy BILLZ’idagi haqiqiy shakl: nom — tovar turi, model — SKU’da, brendda ortiqcha bo‘shliq, toifa bo‘sh
    prod('p-g', '  Осветительный прибор', { sku: 'GODOX  TL-30', brand: ' Godox', cats: [], price: [1880, 1880], stock: [1, 0] }),
    ...Array.from({ length: 230 }, (_, i) => prod(`p-x${i}`, `Aksessuar ${i}`, { sku: `AX${i}`, stock: [1, 0], price: [50000, 50000] }))
  ];
  state.clients = [
    { id: 'c-1', external_id: 101, first_name: 'Jasur', last_name: 'T.', phone_numbers: ['+998901234567'], balance: 150000 },
    { id: 'c-2', external_id: 102, first_name: 'Aziza', last_name: '', phone_numbers: ['998935550000', '+998977770000'], balance: 0 },
    { id: 'c-3', external_id: 103, first_name: 'Er', last_name: 'A', phone_numbers: ['+998900000099'], balance: 1000 },
    { id: 'c-4', external_id: 104, first_name: 'Xotin', last_name: 'A', phone_numbers: ['+998900000099'], balance: 2000 }
  ];
  // Qator shakli — haqiqiy BILLZ javobi bo‘yicha (2026-09-20): customer_id = mijoz UUID, phone_numbers null, order_type ruscha, categories_path massiv
  const row = (created_at, shop, type, order, cust, custNo, pid, name, sku, gross, net, sold, ret) => ({ created_at, shop_id: shop === 'Chilonzor' ? S1 : S2, shop_name: shop,
    order_type: type, order_id: `o-${order}`, order_number: order, seller_name: shop === 'Chilonzor' ? 'Dilshod' : 'Aziza', seller_ids: ['s1'], customer_id: cust, customer_number: custNo,
    customer_name: cust ? 'Mijoz' : '', phone_numbers: null, product_id: pid, product_name: name, product_sku: sku, product_barcode: '', categories_path: ['Kameralar'], level_1: ['Kameralar'],
    gross_sales: gross, net_sales: net, sold_measurement_value: sold, returned_measurement_value: ret, discount_percent: 0 });
  state.purchases = [
    row(at(YDAY, '12:10'), 'Chilonzor', 'Продажа', '1001', 'c-1', '101', 'p-1', 'Sony ZV-E10 kit 16-50mm', 'ZV-E10K', 9800000, 9800000, 1, 0),
    row(at(YDAY, '12:10'), 'Chilonzor', 'Продажа', '1001', 'c-1', '101', 'p-2', 'DJI Mic 2', 'MIC2', 3500000, 3300000, 1, 0),
    // Mijozsiz savdo — BILLZ bo‘sh UUID qo‘yadi; customer_number tasodifan boshqa mijozniki bilan bir xil bo‘lsa ham bog‘lanmasin
    row(at(YDAY, '15:00'), 'Yunusobod', 'Продажа', '1002', '00000000-0000-0000-0000-000000000000', '101', 'p-x1', 'Aksessuar 1', 'AX1', 100000, 100000, 2, 0),
    row(RET_AT, 'Chilonzor', 'Возврат', '1003', 'c-1', '101', 'p-2', 'DJI Mic 2', 'MIC2', -3300000, -3300000, 0, 1),
    // Almashtirish: bitta chekda eski tovar qaytdi (−), yangisi berildi (+); sentli summa — yaxlitlanmaydi
    row(at(YDAY, '16:00'), 'Yunusobod', 'Обмен', '1004', '', '', 'p-x2', 'Aksessuar 2', 'AX2', 0, -60, 0, 1),
    row(at(YDAY, '16:00'), 'Yunusobod', 'Обмен', '1004', '', '', 'p-x3', 'Aksessuar 3', 'AX3', 70.5, 70.5, 1, 0)
  ];
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('noto‘g‘ri kalit: tushunarli xato, keyingi urinish bir soatdan keyin (BILLZ behuda so‘ralmaydi)', async () => {
  const r = await billzTick({ force: true });
  assert.equal(r.ok, false);
  assert.equal(integration('billz').state, 'error');
  assert.match(integration('billz').detail, /Kalit qabul qilinmadi \(401\).*Ключи интеграции/);
  assert.doesNotMatch(integration('billz').detail, /notogri/, 'kalit matnda yo‘q');
  const n = state.logins;
  await billzTick();
  assert.equal(state.logins, n, 'navbatdagi tik so‘rov yubormaydi');
});

test('to‘g‘ri kalit: magazinlar → filiallar, tovarlar, mijozlar, xaridlar bir sinxronda', async () => {
  config.billzToken = state.key; resetBillzAuth();
  const r = await billzTick({ force: true });
  assert.equal(r.ok, true, r.error);
  assert.equal(integration('billz').state, 'ok');
  assert.deepEqual(all('SELECT name, kind FROM branches WHERE billz_shop_id IS NOT NULL ORDER BY name').map(b => `${b.name}:${b.kind}`), ['Chilonzor:dokon', 'PHOTOBUY SKLAD:ombor', 'Yunusobod:dokon']);
  assert.equal(one('SELECT count(*) n FROM products WHERE billz_id IS NOT NULL').n, 234, 'hamma sahifa olindi (200 + 34)');
  assert.equal(one('SELECT count(*) n FROM purchases WHERE is_demo=1').n + one('SELECT count(*) n FROM accounts WHERE is_demo=1').n, 0, 'demo olib tashlandi');
});

test('tovar: narx UZS, qoldiq filial nomi bilan, aksiya; qo‘lda kiritilgan karta bog‘landi (tavsif saqlandi)', () => {
  const zv = one(`SELECT * FROM products WHERE billz_id='p-1'`);
  assert.equal(zv.specs, 'APS-C, 24 MP', 'tekshirilgan tavsif yo‘qolmadi');
  assert.equal(zv.status, 'verified');
  assert.equal(one(`SELECT count(*) n FROM products WHERE lower(name)=lower('Sony ZV-E10 kit 16-50mm')`).n, 1, 'dublikat karta yo‘q');
  const ps = priceStock(zv);
  assert.equal(ps.price, 9800000);
  assert.deepEqual(ps.stock_by_branch, { Chilonzor: 3, Yunusobod: 2 });
  assert.equal(ps.source, 'BILLZ');
  const mic = priceStock(one(`SELECT * FROM products WHERE billz_id='p-2'`));
  assert.ok(mic.price_by_branch, 'filiallarda narx farqi ko‘rsatiladi');
  assert.equal(mic.promo[0].price, 3200000);
  assert.deepEqual(mic.promo_info, { price: 3200000, name: 'Kuzgi aksiya', partial: true, branches: ['Chilonzor'] }, 'aksiya bitta do‘konda — qaysi ekani bilan');
  assert.equal(ps.promo_info, undefined, 'aksiyasiz tovarda yo‘q');
  // BILLZ valyuta belgisiga tayanilmaydi (Photobuy’da «UZS» belgili narxlar ham USD) — narx kompaniya hisob valyutasida
  assert.equal(one(`SELECT price FROM products WHERE billz_id='p-3'`).price, 700);
  assert.equal(ps.currency, 'UZS', 'standart hisob valyutasi');
});

test('mijozlar: telefonlar, keshbek; bir raqam ikki mijozda — hech kimga tasdiqlanmaydi', () => {
  const j = customerByPhone('90 123 45 67');
  assert.equal(j.billz_id, 'c-1');
  assert.equal(one('SELECT amount FROM cashback WHERE customer_id=?', j.id).amount, 150000);
  assert.equal(customerByPhone('+998977770000').billz_id, 'c-2', 'qo‘shimcha raqam bo‘yicha ham topiladi');
  assert.equal(customerByPhone('+998900000099'), null, 'bir raqam — ikki mijoz: aniq emas');
});

test('xaridlar: sotuv va qaytarish alohida; sof = sotuv − qaytarish; chek soni qaytarishsiz', () => {
  const sales = all(`SELECT * FROM purchases WHERE is_demo=0 AND kind='sale'`), rets = all(`SELECT * FROM purchases WHERE kind='return'`);
  assert.equal(sales.length, 4, '3 sotuv + almashtirishda berilgan tovar');
  assert.equal(rets.length, 2, 'qaytarish + almashtirishda qaytgan tovar');
  const j = one(`SELECT id FROM customers WHERE billz_id='c-1'`).id;
  assert.equal(sales.filter(s => s.customer_id === j).length, 2, 'mijoz raqami bo‘yicha bog‘landi');
  const ret = rets.find(r => r.receipt === 'billz:o-1003');
  assert.equal(ret.customer_id, j);
  assert.equal(rets.find(r => r.receipt === 'billz:o-1003').amount, 3300000);
  assert.ok(ret.product_id, 'tovar BILLZ product_id bo‘yicha bog‘landi');
  assert.equal(sales.find(s => s.product_name === 'Aksessuar 1').branch_id, one(`SELECT id FROM branches WHERE name='Yunusobod'`).id);
  assert.equal(sales.find(s => s.product_name === 'Aksessuar 1').customer_id, null, 'mijozsiz savdo hech kimga bog‘lanmadi');
  const period = TODAY.slice(0, 7), f = facts(period);
  if (YDAY.slice(0, 7) === period) {
    assert.equal(f.gross, 9800000 + 3300000 + 100000 + 70.5);
    assert.equal(f.returns, 3300000 + 60);
    assert.equal(f.net, 9800000 + 100000 + 10.5, 'almashtirishning sof ta’siri (+70,5 − 60) sentigacha');
    assert.equal(f.checks, 2, 'almashtirish cheki sotuv cheklariga kirmaydi');
  }
  assert.equal(f.demo, false);
  const prof = customerProfile((run(`UPDATE customers SET verified_at=1 WHERE id=?`, j), j));
  assert.ok(prof.purchases.some(p => p.kind === 'return' && p.amount === -3300000));
});

test('qayta sinxron (kecha qaytarish kiritildi) dublikat bermaydi — oyna almashtiriladi', async () => {
  const before = one('SELECT count(*) n FROM purchases WHERE is_demo=0').n;
  await syncPurchases(YDAY, YDAY);
  await syncPurchases(YDAY, YDAY);
  assert.equal(one('SELECT count(*) n FROM purchases WHERE is_demo=0').n, before);
});

test('token muddati tugasa — qayta kirib, so‘rov takrorlanadi; 429 — kutib qayta', async () => {
  const logins = state.logins;
  state.expireNext = true;
  const r1 = await syncPurchases(TODAY, TODAY);
  assert.equal(r1.returns, 1);
  assert.equal(state.logins, logins + 1);
  state.rate429 = 1;
  const r2 = await syncPurchases(TODAY, TODAY);
  assert.equal(r2.returns, 1, '429 dan keyin ham natija to‘liq');
});

test('to‘liq ro‘yxat: yo‘qolgan tovar qoldig‘i 0 (karta qoladi); chala ro‘yxat qo‘llanmaydi', async () => {
  state.products = state.products.filter(p => p.id !== 'p-2');
  await syncProducts({ full: true });
  const mic = one(`SELECT * FROM products WHERE billz_id='p-2'`);
  assert.ok(mic, 'karta o‘chirilmadi');
  assert.equal(mic.stock_json, '{}');
  state.countLie = 5; // BILLZ «count» ko‘proq dedi, lekin sahifalar kam keldi
  await assert.rejects(syncProducts({ full: true }), /chala/);
  state.countLie = 0;
  assert.equal(one(`SELECT stock_json FROM products WHERE billz_id='p-1'`).stock_json, JSON.stringify({ Chilonzor: 3, Yunusobod: 2 }));
});

test('kontakt ulashilganda: yangi mijoz BILLZ’dan shu zahoti olinadi', async () => {
  state.clients.push({ id: 'c-9', external_id: 109, first_name: 'Yangi', last_name: 'Mijoz', phone_numbers: ['+998911112233'], balance: 50000 });
  assert.equal(customerByPhone('+998911112233'), null);
  await refreshClientByPhone('91 111 22 33');
  const c = customerByPhone('+998911112233');
  assert.equal(c.billz_id, 'c-9');
  assert.equal(one('SELECT amount FROM cashback WHERE customer_id=?', c.id).amount, 50000);
});

test('xarid qatori tuzilmasi kutilganidan farq qilsa — sinxron to‘xtaydi, panelda haqiqiy maydon nomlari', async () => {
  state.purchaseShape = { foo: 1, bar: 'x' };
  const before = one('SELECT count(*) n FROM purchases').n;
  await assert.rejects(syncPurchases(YDAY, YDAY), /tuzilmasi kutilganidan farq qiladi.*bar, foo/);
  assert.equal(one('SELECT count(*) n FROM purchases').n, before, 'mavjud ma’lumot o‘chirilmadi');
  state.purchaseShape = null;
});

test('hisob valyutasi: USD tanlansa narx, keshbek va hisobot «$» bilan; noto‘g‘ri qiymat saqlanmaydi', async () => {
  const { updateSettings, getSettings } = await import('../src/services/settings.js');
  const { money } = await import('../src/util.js');
  assert.throws(() => updateSettings({ currency: 'EUR' }, 'test'), /bad_setting/);
  updateSettings({ currency: 'USD' }, 'test');
  assert.equal(getSettings().currency, 'USD');
  assert.equal(money(1880), '1 880 $');
  assert.equal(priceStock(one(`SELECT * FROM products WHERE billz_id='p-1'`)).currency, 'USD');
  updateSettings({ currency: 'UZS' }, 'test');
  assert.equal(money(9800000), '9 800 000 so‘m');
});

test('ombor: qoldiq do‘kon va ombor bo‘yicha alohida; katalog filtri (do‘konda / faqat omborda / yo‘q / filial)', async () => {
  const { listProducts } = await import('../src/services/catalog.js');
  const imp = priceStock(one(`SELECT * FROM products WHERE billz_id='p-3'`));
  assert.deepEqual([imp.stock_store, imp.stock_warehouse, imp.stock_total], [0, 6, 6]);
  assert.deepEqual(imp.warehouses, ['PHOTOBUY SKLAD']);
  const ids = r => r.items.map(p => p.id);
  const impId = one(`SELECT id FROM products WHERE billz_id='p-3'`).id, zvId = one(`SELECT id FROM products WHERE billz_id='p-1'`).id;
  assert.ok(ids(listProducts('', { stock: 'warehouse', limit: 500 })).includes(impId), 'faqat omborda');
  assert.ok(!ids(listProducts('', { stock: 'store', limit: 500 })).includes(impId), 'do‘konda yo‘q');
  assert.ok(ids(listProducts('', { stock: 'store', limit: 500 })).includes(zvId));
  assert.ok(ids(listProducts('', { branch: 'PHOTOBUY SKLAD', limit: 500 })).every(id => id === impId), 'filial filtri');
  const all_ = listProducts('', { limit: 5 });
  assert.equal(all_.items.length, 5);
  assert.ok(all_.total > 200, 'jami soni sahifadan qat’i nazar');
  assert.ok(all_.items[0].billz.stock_store > 0, 'do‘konda borlari oldin');
});

test('umumiy nomli tovar: «MODEL — tur», brend tozalangan, tur toifa sifatida; qidiruv tire/bo‘shliqqa qaramaydi', async () => {
  const { searchProducts } = await import('../src/services/catalog.js');
  const g = one(`SELECT * FROM products WHERE billz_id='p-g'`);
  assert.equal(g.name, 'GODOX TL-30 — Осветительный прибор');
  assert.equal(g.brand, 'Godox');
  assert.equal(g.category, 'Осветительный прибор');
  assert.equal(one(`SELECT name FROM products WHERE billz_id='p-1'`).name, 'Sony ZV-E10 kit 16-50mm', 'aniq nom (raqamli) o‘zgarmaydi');
  for (const q of ['tl30', 'Godox TL-30', 'godox tl 30 bormi?']) assert.equal(searchProducts(q)[0]?.id, g.id, q);
});

test('xodimlar: faqat ism, rol, magazin saqlanadi; API foydalanuvchisi, telefon va parol olinmaydi', async () => {
  const { kvGet } = await import('../src/db.js');
  const staff = JSON.parse(kvGet('billz_staff'));
  assert.deepEqual(staff, [{ billz_id: 'u1', name: 'Komiljon Gafurov', roles: ['Продавец'], shops: ['Chilonzor'] }]);
  assert.doesNotMatch(kvGet('billz_staff'), /xesh|\+998/);
});

test('tekshirish navbati: tasdiqlanmagan va omborda bor, 90 kunda ko‘p sotilgani oldin; tasdiqlanganlar soni', async () => {
  const { listProducts } = await import('../src/services/catalog.js');
  const q = listProducts('', { status: 'queue', limit: 500 });
  assert.ok(q.items.every(p => p.status !== 'verified' && p.billz.stock_total > 0), 'faqat tasdiqlanmagan va qoldig‘i bor');
  assert.ok(!q.items.some(p => p.name === 'Sony ZV-E10 kit 16-50mm'), 'tasdiqlangan karta navbatda yo‘q');
  for (let i = 1; i < q.items.length; i++) assert.ok(q.items[i - 1].sold90 >= q.items[i].sold90, 'sotuv bo‘yicha tartib');
  assert.equal(q.verified, 1);
  assert.equal(listProducts('', { status: 'verified' }).total, 1);
});
