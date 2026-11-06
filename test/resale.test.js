/*
  Qayta sotuv qoidalari — xaridlar tarixidan tavsiya va tur bo‘yicha qoida.
  Tekshiriladi: «A dan keyin B» faqat keyingi kunlarda sanaladi (bitta chek — birga xarid); tasodifiy juftlik (lift < 1,5) chiqmaydi;
  tur bo‘yicha qoidada taklif — do‘konda bor va eng ko‘p sotilgan model; B turini olgan mijozga taklif qilinmaydi; rad etilgan tavsiya yashiriladi.
*/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sales-resale-'));
Object.assign(process.env, { DB_FILE: join(dir, 't.db'), DATA_DIR: dir, TG_DISABLED: '1', ENV_FILE: join(dir, 'yoq.env') });

const { migrate, run, one, all } = await import('../src/db.js');
const { suggestRules, candidates, rejectSuggestion, bestInCategory, starterRules, dailyResale } = await import('../src/agents/chaqnoq.js');
const { updateSettings } = await import('../src/services/settings.js');

const DAY = 864e5, T = Date.now();
/* Joriy oy ichidagi xavfsiz vaqt: oyning 1-kunida ham «bu oy» hisobiga tushadi (Toshkent +5) */
const inThisMonth = ts => {
  const l = new Date(Date.now() + 5 * 3600e3);
  const first = Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), 1) - 5 * 3600e3;
  return Math.max(ts, first + 7 * 3600e3);
};

let rec = 0;
const buy = (cust, prod, daysAgo) => run(`INSERT INTO purchases(receipt,line,customer_id,product_id,product_name,qty,amount,branch_name,sold_at,kind,is_demo) VALUES(?,1,?,?,?,1,100,'Do‘kon',?,'sale',0)`,
  `r${++rec}`, cust, prod, one('SELECT name FROM products WHERE id=?', prod).name, T - daysAgo * DAY);

before(() => {
  migrate();
  run(`INSERT INTO branches(id,name,kind) VALUES(1,'Do‘kon','dokon'),(2,'Ombor','ombor')`);
  const P = (id, name, cat, stock) => run(`INSERT INTO products(id,name,category,price,stock_json,stock_synced_at,billz_id,updated_at) VALUES(?,?,?,100,?,?,?,0)`, id, name, cat, JSON.stringify(stock), T, `b${id}`);
  P(1, 'CANON R50 — фотоаппарат', 'фотоаппарат', { 'Do‘kon': 1 });
  P(2, 'SIGMA 30MM — Объектив', 'Объектив', { 'Do‘kon': 2 });            // do‘konda bor, ko‘p sotilgan
  P(3, 'SIGMA 56MM — Объектив', 'Объектив', { 'Ombor': 5 });             // faqat omborda
  P(4, 'CANON 50MM — Объектив', 'Объектив', {});                         // qoldiq yo‘q
  P(5, 'K&F — Сумка для фотоаппарата', 'Сумка для фотоаппарата', { 'Do‘kon': 3 });
  for (let c = 1; c <= 100; c++) run(`INSERT INTO customers(id,name,phone,billz_id,created_at) VALUES(?,?,?,?,0)`, c, `Mijoz ${c}`, `+99890000${String(c).padStart(4, '0')}`, `c${c}`);
  // 1–10: kamera oldi (60 kun oldin); 1–6 keyin obyektiv (10–40 kun o‘tib); 7–8 obyektivni shu kuni (bitta xarid — sanalmaydi)
  for (let c = 1; c <= 10; c++) buy(c, 1, 60);
  for (let c = 1; c <= 6; c++) buy(c, c % 2 ? 2 : 3, 60 - (10 + c * 5));
  buy(7, 2, 60); buy(8, 2, 60);
  // 11–100: faqat sumka; ulardan 11–12 obyektiv ham (bazaviy daraja past bo‘lsin)
  for (let c = 11; c <= 100; c++) buy(c, 5, 90);
  buy(11, 2, 30); buy(12, 2, 20);
  // Sumka → kamera: tasodifiy darajada (2 ta) — lift past, tavsiya qilinmasligi kerak
  buy(13, 1, 50); buy(14, 1, 45);
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('tarixdan: «фотоаппарат → Объектив» topiladi, bitta kundagi xarid sanalmaydi; tasodifiy juftlik chiqmaydi', () => {
  const r = suggestRules();
  assert.ok(r.hypotheses >= 6, 'ko‘p juftlik tuzatmasi');
  const x = r.items.find(i => i.bought_category === 'фотоаппарат' && i.suggest_category === 'Объектив');
  assert.ok(x, JSON.stringify(r.items));
  assert.equal(x.support, 6, 'shu kuni olganlar (7, 8) qayta sotuv emas');
  assert.equal(x.buyers, 12, 'kamera olganlar: 1–10 va 13–14');
  assert.ok(x.lift >= 1.5);
  assert.ok(x.p < 0.01, `tasodif ehtimoli past: ${x.p}`);
  assert.ok(x.min_days >= 3 && x.max_days >= x.min_days);
  assert.equal(x.suggest.id, 2, 'bugun taklif: do‘konda bor model');
  assert.ok(!r.items.some(i => i.bought_category === 'Сумка для фотоаппарата' && i.suggest_category === 'фотоаппарат'), 'tasodifiy juftlik tavsiya qilinmaydi');
});

test('tur bo‘yicha qoida: taklif — do‘kondagi eng mos model; turdan tovar olgan mijoz chiqariladi', () => {
  assert.equal(bestInCategory('Объектив').id, 2);
  run(`INSERT INTO resale_rules(bought_category,suggest_category,suggest_product_id,reason,min_days,max_days,created_at) VALUES('фотоаппарат','Объектив',4,'Kamera oldi — obyektiv yo‘q',7,120,0)`);
  const { list, excluded } = candidates();
  const ids = list.map(c => c.customer_id).sort((a, b) => a - b);
  assert.deepEqual(ids, [9, 10, 13, 14], 'obyektiv olmaganlar');
  assert.ok(list.every(c => c.suggest.id === 2), 'namuna (qoldiqsiz 4) emas, bugun mavjud model');
  assert.equal(excluded.allaqachon_olgan, 8, '1–8 allaqachon obyektiv olgan');
});

test('rad etilgan tavsiya yana chiqmaydi; qo‘shilgan qoida tavsiyalarda takrorlanmaydi', () => {
  assert.ok(!suggestRules().items.some(i => i.bought_category === 'фотоаппарат' && i.suggest_category === 'Объектив'), 'qoida sifatida bor');
  const before = suggestRules().items.length;
  const any = suggestRules().items[0];
  if (any) { rejectSuggestion(any.bought_category, any.suggest_category, 'test'); assert.equal(suggestRules().items.length, before - 1); }
});

test('qayta xarid qoidasi (qog‘oz fon → fon): qayta olgan chiqariladi, olmagan taklif oladi; turlicha yozilish birga', () => {
  run(`DELETE FROM resale_rules`);
  run(`INSERT INTO products(id,name,category,price,stock_json,stock_synced_at,billz_id,updated_at) VALUES(10,'SAVAGE 2.7M — Бумажный фон','Бумажный фон',50,?,?,'b10',0)`, JSON.stringify({ 'Do‘kon': 4 }), T);
  run(`INSERT INTO products(id,name,category,price,stock_json,stock_synced_at,billz_id,updated_at) VALUES(11,'SONY A7 IV — Фотоаппарат','Фотоаппарат',2500,?,?,'b11',0)`, JSON.stringify({ 'Do‘kon': 1 }), T);
  buy(50, 10, 40); buy(51, 10, 40); buy(51, 10, 5);   // 51 — allaqachon yangisini olgan
  buy(52, 11, 30);                                    // «Фотоаппарат» (katta harf) — «фотоаппарат» bilan bir tur
  run(`INSERT INTO resale_rules(bought_category,suggest_category,suggest_product_id,reason,min_days,max_days,created_at) VALUES('Бумажный фон','Бумажный фон',10,'Yangi rulon',25,60,0)`);
  run(`INSERT INTO resale_rules(bought_category,suggest_category,suggest_product_id,reason,min_days,max_days,created_at) VALUES('фотоаппарат|Фотоаппарат','Объектив',2,'Obyektiv',7,120,0)`);
  const { list } = candidates();
  const ids = new Set(list.map(c => c.customer_id));
  assert.ok(ids.has(50), 'fonni qayta olmagan — taklif');
  assert.ok(!ids.has(51), 'yangisini olgan — chiqarildi');
  assert.ok(ids.has(52), 'katta harfli «Фотоаппарат» ham qoidaga tushdi');
  assert.equal(list.find(c => c.customer_id === 50).suggest.id, 10);
});

test('boshlang‘ich qoidalar: faqat bazada bor turlar, tarixdagi son bilan; qo‘shilgani qayta taklif qilinmaydi', () => {
  run(`DELETE FROM resale_rules`);
  const st = starterRules();
  const cam = st.find(x => x.suggest_category === 'Объектив');
  assert.ok(cam, JSON.stringify(st.map(x => x.bought_category + ' → ' + x.suggest_category)));
  assert.equal(cam.bought_category, 'Фотоаппарат|фотоаппарат', 'faqat bazada bor yozilishlar');
  assert.ok(cam.buyers >= 13 && cam.support >= 6);
  assert.ok(st.every(x => !/Softboks|Синхронизатор/.test(x.suggest_category)), 'bazada yo‘q tur taklif qilinmaydi');
  run(`INSERT INTO resale_rules(bought_category,suggest_category,suggest_product_id,reason,min_days,max_days,created_at) VALUES(?,?,2,'x',7,120,0)`, cam.bought_category, cam.suggest_category);
  assert.ok(!starterRules().some(x => x.bought_category === cam.bought_category && x.suggest_category === 'Объектив'));
});

test('kunlik cheklov: ortiqchasi keyingi kunga; bir mijozga bir qoida bo‘yicha taklif — bir marta', async () => {
  run(`DELETE FROM resale_rules`); run(`DELETE FROM tasks`);
  run(`INSERT INTO resale_rules(id,bought_category,suggest_category,suggest_product_id,reason,min_days,max_days,created_at) VALUES(77,'фотоаппарат|Фотоаппарат','Объектив',2,'Obyektiv',7,120,0)`);
  updateSettings({ resale_daily_limit: 2 }, 'test');
  const r1 = await dailyResale({ force: true });
  assert.equal(r1.created, 2);
  assert.equal(r1.deferred, r1.total - 2);
  const r2 = await dailyResale({ force: true });
  assert.equal(r2.created, Math.min(2, r1.total - 2), 'keyingi mijozlar');
  const offeredTwice = one(`SELECT count(*) n FROM (SELECT customer_id FROM tasks WHERE kind='resale' GROUP BY customer_id, json_extract(meta,'$.rule_id') HAVING count(*) > 1)`).n;
  assert.equal(offeredTwice, 0, 'hech kimga bir qoida ikki marta taklif qilinmadi');
  assert.ok(candidates().excluded.avval_taklif >= 4, 'avval taklif qilinganlar chiqariladi');
  updateSettings({ resale_daily_limit: 30 }, 'test');
});

test('mahsulot kesimi: toifa bo‘yicha yig‘ma (bir toifa — bitta qator), qaytarish ayiriladi', async () => {
  const { topProducts } = await import('../src/agents/obyektiv.js');
  const per = new Date(T + 5 * 3600e3).toISOString().slice(0, 7);
  const catRow = topProducts(per, { by: 'category', limit: 50 }).find(c => c.name === 'Объектив');
  const before = { net: catRow?.net || 0, returned: catRow?.returned || 0 };
  const beforeSigma = topProducts(per, { limit: 50 }).find(p => p.name === 'SIGMA 30MM — Объектив')?.net || 0;
  run(`INSERT INTO purchases(receipt,line,customer_id,product_id,product_name,qty,amount,branch_name,sold_at,kind,is_demo) VALUES('tp1',1,1,2,'SIGMA 30MM — Объектив',1,300,'Do‘kon',?,'sale',0)`, inThisMonth(T - 2 * DAY));
  run(`INSERT INTO purchases(receipt,line,customer_id,product_id,product_name,qty,amount,branch_name,sold_at,kind,is_demo) VALUES('tp2',1,1,3,'SIGMA 56MM — Объектив',2,500,'Do‘kon',?,'sale',0)`, inThisMonth(T - 2 * DAY));
  run(`INSERT INTO purchases(receipt,line,customer_id,product_id,product_name,qty,amount,branch_name,sold_at,returned_at,kind,is_demo) VALUES('tp3',1,1,3,'SIGMA 56MM — Объектив',1,250,'Do‘kon',?,?,'return',0)`, inThisMonth(T - DAY), inThisMonth(T - DAY));
  const cats = topProducts(per, { by: 'category', limit: 50 });
  const lens = cats.filter(c => c.name === 'Объектив');
  assert.equal(lens.length, 1, 'bir toifa — bitta qator');
  // Boshqa sinovlarning xaridlari ham shu oyga tushishi mumkin — shuning uchun farq tekshiriladi
  assert.equal(lens[0].net - before.net, 300 + 500 - 250, 'qaytarish ayirildi');
  assert.equal(lens[0].returned - before.returned, 1);
  const prods = topProducts(per, { limit: 50 });
  const sigma = prods.find(p => p.name === 'SIGMA 30MM — Объектив');
  assert.ok(sigma && sigma.net - beforeSigma === 300, 'tovar kesimi: 300 qo‘shildi');
});

test('smena: vazifa bugun ishlayotgan sotuvchiga tushadi, ishlamayotganiga emas', async () => {
  const { onDuty, workDays } = await import('../src/util.js');
  const { local } = await import('../src/util.js');
  // Bugungi hafta kuni (Du=0)
  const l = local(T), idx = (new Date(Date.UTC(l.y, l.mo - 1, l.d)).getUTCDay() + 6) % 7;
  const today = Array.from({ length: 7 }, (_, i) => i === idx ? '1' : '0').join('');
  const other = Array.from({ length: 7 }, (_, i) => i === idx ? '0' : '1').join('');
  assert.equal(onDuty({ dow: today }, T), true);
  assert.equal(onDuty({ dow: other }, T), false);
  assert.equal(onDuty({ dow: today, from: '00:00', to: '23:59' }, T), true);
  assert.equal(onDuty({}, T), true, 'smena belgilanmagan — cheklov yo‘q');
  assert.equal(workDays(other, Date.parse('2026-09-01T00:00:00+05:00'), Date.parse('2026-09-08T00:00:00+05:00')), 6, 'haftada bitta dam');

  run(`DELETE FROM users`); run(`DELETE FROM tasks`); run(`DELETE FROM resale_rules`);
  run(`INSERT INTO users(id,login,name,role,branch_id,shift_dow,created_at) VALUES(1,'smenada','Smenada','sotuvchi',1,?,0)`, today);
  run(`INSERT INTO users(id,login,name,role,branch_id,shift_dow,created_at) VALUES(2,'damda','Dam olyapti','sotuvchi',1,?,0)`, other);
  run(`INSERT INTO resale_rules(id,bought_category,suggest_category,suggest_product_id,reason,min_days,max_days,created_at) VALUES(88,'фотоаппарат|Фотоаппарат','Объектив',2,'Obyektiv',7,120,0)`);
  const r = await dailyResale({ force: true });
  assert.ok(r.created > 0);
  const owners = [...new Set(all(`SELECT user_id FROM tasks WHERE kind='resale'`).map(t => t.user_id))];
  assert.deepEqual(owners, [1], 'hammasi smenadagi sotuvchiga');
});

test('xulosa takrorlanmaydi: bir xil ko‘rsatkich har kuni qayta qo‘shilmaydi, yangilanadi', async () => {
  const { dailyInsights } = await import('../src/agents/obyektiv.js');
  const before = one(`SELECT count(*) n FROM insights`).n;
  await dailyInsights({ force: true });
  const after1 = one(`SELECT count(*) n FROM insights`).n;
  await dailyInsights({ force: true });
  await dailyInsights({ force: true });
  assert.equal(one(`SELECT count(*) n FROM insights`).n, after1, 'qayta ishga tushirilganda yangi nusxa paydo bo‘lmaydi');
  assert.ok(after1 >= before);
});
