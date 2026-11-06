import { one, all, run, tx } from '../db.js';
import { now } from '../util.js';
import { ingestClient, markSellerReply } from './inbox.js';
import { audit } from '../core/audit.js';

/*
  Demo ma’lumot — faqat sinov uchun. Hammasi is_demo=1, panelda «demo» deb ko‘rinadi va bitta tugma bilan o‘chiriladi.
  Demo akkaunt tashqi kanalga hech narsa yubormaydi — taymer va AI oqimini xavfsiz sinash uchun.
  Soxta xodim yoki filial yaratilmaydi.
*/

const P = [
  ['DJI Mic 2 (2 TX + 1 RX)', 'DJI', 'Audio', 4390000, { Chilonzor: 3, Yunusobod: 1 },
    'Simsiz mikrofon tizimi: 2 ta uzatgich, 1 ta qabul qilgich, zaryad qutisi. Uzatgichda 32-bit float ichki yozuv. Masofa 250 m gacha (ochiq joyda).',
    'Zaryad qutisi, 3.5 mm TRS kabel, USB-C va Lightning adapterlari, magnitlar, shamoldan himoya.',
    'Kameraga: qabul qilgich 3.5 mm TRS chiqishi orqali kameraning mikrofon kirishiga (Sony ZV-E10, Sony A7 IV — mos). Smartfonga: USB-C yoki Lightning adapter orqali.',
    'Kamerada 3.5 mm mikrofon kirishi bo‘lishi kerak.', 'verified'],
  ['DJI Mic Mini (2 TX + 1 RX)', 'DJI', 'Audio', 2490000, { Chilonzor: 12, Yunusobod: 8 },
    'Juda yengil simsiz mikrofon tizimi: 2 ta uzatgich, 1 ta qabul qilgich.', 'Zaryad qutisi, adapterlar.', 'Kameraga 3.5 mm orqali; smartfonga adapter orqali.', null, 'draft'],
  ['Sony A7 IV (korpus)', 'Sony', 'Kamera', 29900000, { Chilonzor: 2, Yunusobod: 1 },
    'Full-frame, 33 MP, Sony E ulanish. 4K 60p video. Ikki slot: CFexpress Type A / SD va SD.', 'Korpus, akkumulyator, zaryadlovchi, tasma.',
    'Obyektiv: Sony E (FE) ulanishli. Mikrofon: 3.5 mm kirish bor. Xotira: SD UHS-II yoki CFexpress Type A.', 'Obyektiv to‘plamda yo‘q.', 'verified'],
  ['Sony ZV-E10 kit 16-50mm', 'Sony', 'Kamera', 9800000, { Chilonzor: 4, Yunusobod: 2 },
    'APS-C, 24.2 MP, Sony E ulanish, vlog uchun burilma ekran.', 'Korpus, 16-50mm obyektiv, akkumulyator.', 'Mikrofon: 3.5 mm kirish bor. Obyektiv: Sony E.', 'Vizir yo‘q.', 'verified'],
  ['Sony FE 50mm f/1.8', 'Sony', 'Obyektiv', 3100000, { Chilonzor: 4, Yunusobod: 0 },
    'Full-frame portret obyektivi, f/1.8, yengil (≈186 g).', 'Obyektiv, qopqoqlar.', 'Sony E ulanishli kameralar (A7 seriyasi, ZV-E10 va boshqalar).', null, 'verified'],
  ['Canon EOS R50 kit 18-45mm', 'Canon', 'Kamera', 10900000, { Chilonzor: 3, Yunusobod: 1 },
    'APS-C, 24.2 MP, Canon RF ulanish, 4K video.', 'Korpus, RF-S 18-45mm obyektiv, akkumulyator.', 'Obyektiv: Canon RF / RF-S.', null, 'verified'],
  ['Canon RF 50mm f/1.8 STM', 'Canon', 'Obyektiv', 2650000, { Chilonzor: 3, Yunusobod: 2 },
    'Yengil portret obyektivi, f/1.8.', 'Obyektiv, qopqoqlar.', 'Canon RF ulanishli kameralar (R50 da ≈80 mm ekvivalent).', null, 'verified'],
  ['Fujifilm X-S20 + XC 15-45mm', 'Fujifilm', 'Kamera', 16900000, { Chilonzor: 0, Yunusobod: 2 },
    'APS-C, 26.1 MP, Fujifilm X ulanish. Rejim g‘ildiragida alohida Vlog rejimi.', 'Korpus, XC 15-45mm obyektiv, akkumulyator.', 'Obyektiv: Fujifilm X.', null, 'draft'],
  ['Godox SL60W', 'Godox', 'Yoritish', 1690000, { Chilonzor: 4, Yunusobod: 2 },
    'LED yoritgich, 60 W, kunduzgi rang (≈5600K).', 'Yoritgich, reflektor, pult, quvvat bloki.', 'Softbox va aksessuarlar: Bowens ulanish.', 'Stoyka to‘plamda yo‘q.', 'verified'],
  ['Godox softbox 80 sm (Bowens)', 'Godox', 'Yoritish', 650000, { Chilonzor: 9, Yunusobod: 3 },
    'Oktabox, 80 sm, Bowens ulanish.', 'Softbox, ichki va tashqi diffuzor, sumka.', 'Bowens ulanishli yoritgichlar (masalan, Godox SL60W).', null, 'verified'],
  ['DJI Osmo Pocket 3', 'DJI', 'Kamera', 7200000, { Chilonzor: 3, Yunusobod: 1 },
    '1 dyuymli sensor, 4K/120 fps, 3 o‘qli stabilizator, 2 dyuymli aylanadigan ekran.', 'Kamera, himoya qopqog‘i, USB-C kabel, tasma.', 'Mikrofon: DJI Mic 2 uzatgichi bilan to‘g‘ridan-to‘g‘ri ulanadi.', null, 'verified'],
  ['DJI Osmo Pocket 3 Creator Combo', 'DJI', 'Kamera', 9450000, { Chilonzor: 2, Yunusobod: 0 },
    'Osmo Pocket 3 kengaytirilgan to‘plami.', 'Kamera, DJI Mic 2 uzatgichi, batareyali tutqich, keng burchakli linza, mini shtativ, sumka.', 'Standart Pocket 3 aksessuarlari bilan mos.', null, 'verified'],
  ['SanDisk Extreme PRO SDXC 128 GB', 'SanDisk', 'Xotira', 590000, { Chilonzor: 10, Yunusobod: 4 },
    'SDXC UHS-I, V30, U3.', 'Karta.', 'SD slotli kameralar (Sony A7 IV, ZV-E10, Canon R50, Fujifilm X-S20).', 'UHS-I — UHS-II slotda ham ishlaydi, lekin UHS-II tezligida emas.', 'verified'],
  ['Sigma 24-70mm F2.8 DG DN II Art (Sony E)', 'Sigma', 'Obyektiv', 14900000, { Chilonzor: 1, Yunusobod: 0 },
    'Full-frame standart zum, f/2.8.', 'Obyektiv, blenda, qopqoqlar.', 'Sony E ulanish (shu versiya).', 'L-mount versiyasi alohida.', 'draft'],
  ['DJI RS 4', 'DJI', 'Stabilizator', 7900000, { Chilonzor: 0, Yunusobod: 0 },
    'Kamera uchun 3 o‘qli stabilizator (gimbal).', 'Gimbal, tutqich-shtativ, kabellar.', null, 'Hozir omborda yo‘q.', 'draft']
];

export function hasDemo() { return Boolean(one('SELECT 1 FROM accounts WHERE is_demo=1')); }

export function seedDemo() {
  if (hasDemo()) return false;
  const t = now(), synced = t - 25 * 60e3;
  const acctId = tx(() => {
    for (const [name, brand, cat, price, stock, specs, kit, compat, limits, status] of P)
      run(`INSERT OR IGNORE INTO products(name,brand,category,price,stock_json,stock_synced_at,specs,kit,compat,limits,sources,status,verified_at,verified_by,is_demo,updated_at)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`, name, brand, cat, price, JSON.stringify(stock), synced, specs, kit, compat, limits,
        JSON.stringify(['Demo: ishlab chiqaruvchi sahifasi asosida qisqa tavsif']), status, status === 'verified' ? t : null, status === 'verified' ? 'demo' : null, t);
    const cust = (name, phone, billz) => run(`INSERT INTO customers(name,phone,billz_id,is_demo,created_at) VALUES(?,?,?,1,?)`, name, phone, billz, t).lastInsertRowid;
    const otabek = cust('Otabek R.', '+998000000001', 'DEMO-10482');
    const malika = cust('Malika Yo.', '+998000000002', 'DEMO-10511');
    cust('Dilnoza A.', '+998000000003', 'DEMO-10620');
    const pid = n => one('SELECT id FROM products WHERE name=?', n)?.id ?? null;
    const buy = (rc, line, cid, n, amount, daysAgo, returnedDaysAgo = null) =>
      run(`INSERT INTO purchases(receipt,line,customer_id,product_id,product_name,qty,amount,sold_at,returned_at,is_demo) VALUES(?,?,?,?,?,1,?,?,?,1)`,
        rc, line, cid, pid(n), n, amount, t - daysAgo * 864e5, returnedDaysAgo == null ? null : t - returnedDaysAgo * 864e5);
    buy('DEMO-A-58213', 1, otabek, 'Sony A7 IV (korpus)', 29900000, 60);
    buy('DEMO-A-58213', 2, otabek, 'SanDisk Extreme PRO SDXC 128 GB', 590000, 60);
    buy('DEMO-A-40117', 1, otabek, 'Sony ZV-E10 kit 16-50mm', 9800000, 228, 226);
    buy('DEMO-B-61002', 1, malika, 'Canon EOS R50 kit 18-45mm', 10900000, 97);
    run('INSERT INTO cashback(customer_id,amount,synced_at) VALUES(?,?,?)', otabek, 897000, synced);
    run('INSERT INTO cashback(customer_id,amount,synced_at) VALUES(?,?,?)', malika, 327000, synced);
    return run(`INSERT INTO accounts(channel,ext_id,name,can_reply,enabled,mode,rollout,is_demo,created_at) VALUES('demo','demo','Demo akkaunt (sinov)',1,1,'kechiksa','avto',1,?)`, t).lastInsertRowid;
  });
  const acct = one('SELECT * FROM accounts WHERE id=?', acctId);

  // Otabek — tasdiqlangan mijoz (keshbek so‘raydi)
  const o = ingestClient(acct, { extChatId: 'demo-otabek', name: 'Otabek R.', handle: '@otabek_demo', text: 'Salom, keshbekim qancha qoldi?', extMsgId: 'd1', ts: t - 40 * 60e3 });
  run(`UPDATE conversations SET customer_id=(SELECT id FROM customers WHERE billz_id='DEMO-10482') WHERE id=?`, o.id);
  run(`UPDATE customers SET verified_at=?, verified_how='Demo: Telegram kontakt ulashildi' WHERE billz_id='DEMO-10482'`, t);

  // Rustam — katta ro‘yxat
  const r = ingestClient(acct, { extChatId: 'demo-rustam', name: 'Rustam · Kadr studiyasi', handle: '@kadr_demo', extMsgId: 'd2', ts: t - 25 * 60e3,
    text: 'Salom. Studiya ochyapmiz, shu ro‘yxat bo‘yicha narx va bor-yo‘qligini aytib bering:\nGodox SL60W — 4 ta\nsoftbox 80 sm — 4 ta\nstoyka — 4 ta\nSony A7 IV — 2 ta\nSigma 24-70 2.8 — 2 ta\nDJI RS 4 — 1 ta\nxotira kartasi 128 — 6 ta\nfon qog‘oz — oq, qora' });
  markSellerReply(r.id, { text: 'Rustam aka, rahmat. Hisob-kitobni 20 daqiqada yuboraman.', extMsgId: 'd3', ts: t - 20 * 60e3, via: 'panel' });

  // Jasur — hozirgina yozdi: taymer va AI qoralamasi shu yerda ko‘rinadi
  ingestClient(acct, { extChatId: 'demo-jasur', name: 'Jasur T.', handle: '@jasur_demo', text: 'Assalomu alaykum. DJI Mic 2 bormi?', extMsgId: 'd4', ts: t - 20e3 });
  ingestClient(acct, { extChatId: 'demo-jasur', name: 'Jasur T.', handle: '@jasur_demo', text: 'Sony ZV-E10 ga ulasa bo‘ladimi, vlog uchun', extMsgId: 'd5', ts: t - 12e3 });
  seedHistory(t);
  audit('sys', 'Tizim', 'Demo ma’lumot yuklandi (sinov akkaunti, katalog namunasi, 70 kunlik savdo, 3 suhbat)');
  return true;
}

/* 70 kunlik demo savdo tarixi (Obyektiv va Chaqnoq uchun) — barqaror psevdo-tasodifiy */
function seedHistory(t) {
  let seed = 20260919;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const prods = all('SELECT id,name,price,category FROM products WHERE is_demo=1 AND price IS NOT NULL');
  const weights = prods.map(p => p.category === 'Xotira' || p.category === 'Yoritish' ? 4 : p.category === 'Audio' ? 3 : p.price > 15e6 ? 1 : 2);
  const wpick = () => { let x = rnd() * weights.reduce((a, b) => a + b, 0); for (let i = 0; i < prods.length; i++) { x -= weights[i]; if (x <= 0) return prods[i]; } return prods[0]; };
  const branches = [['Chilonzor (demo)', ['Dilshod (demo)', 'Aziza (demo)', 'Sherzod (demo)']], ['Yunusobod (demo)', ['Kamron (demo)', 'Lola (demo)', 'Timur (demo)']]];
  tx(() => {
    const custIds = [];
    for (let i = 0; i < 60; i++)
      custIds.push(run(`INSERT INTO customers(name,phone,billz_id,is_demo,created_at) VALUES(?,?,?,1,?)`, `Demo mijoz ${i + 1}`, `+99800001${String(i).padStart(4, '0')}`, `DEMO-2${String(i).padStart(4, '0')}`, t).lastInsertRowid);
    let rc = 0;
    for (let d = 70; d >= 0; d--) {
      const dayStart = Date.parse(new Date(t - d * 864e5).toISOString().slice(0, 10) + 'T05:00:00Z');
      const wd = new Date(dayStart).getUTCDay();
      const n = Math.round((wd === 6 ? 9 : wd === 0 ? 4 : 6) * (0.7 + rnd() * 0.6));
      for (let k = 0; k < n; k++) {
        const ts = dayStart + Math.floor(rnd() * 10 * 3600e3);
        if (ts > t) continue;
        const [bn, sellers] = rnd() < 0.62 ? branches[0] : branches[1];
        const receipt = `DEMO-H-${++rc}`, cust = rnd() < 0.55 ? pick(custIds) : null;
        const lines = 1 + (rnd() < 0.3 ? 1 : 0);
        for (let li = 1; li <= lines; li++) {
          const p = wpick(), returned = rnd() < 0.03 ? ts + 2 * 864e5 : null;
          run(`INSERT INTO purchases(receipt,line,customer_id,product_id,product_name,qty,amount,branch_name,seller_name,category,sold_at,returned_at,is_demo) VALUES(?,?,?,?,?,1,?,?,?,?,?,?,1)`,
            receipt, li, cust, p.id, p.name, p.price, bn, pick(sellers), p.category, ts, returned && returned < t ? returned : null);
        }
      }
    }
    for (const id of custIds) if (rnd() < 0.5) run('INSERT OR IGNORE INTO cashback(customer_id,amount,synced_at) VALUES(?,?,?)', id, Math.round(rnd() * 900) * 1000, t - 25 * 60e3);
    // Botga ulangan va rozilik bergan demo mijozlar (kampaniya sinovi uchun; demo chat ID — manfiy, Telegram’ga yuborilmaydi)
    custIds.slice(0, 12).forEach((id, i) => run('UPDATE customers SET bot_chat_id=?, consent_at=?, verified_at=?, verified_how=? WHERE id=?', -(900000 + i), t, t, 'Demo: botda kontakt ulashildi', id));
    const P = n => one('SELECT id FROM products WHERE name=? AND is_demo=1', n)?.id;
    const rule = (b, sgs, why, min = 7) => P(b) && P(sgs) && run(`INSERT INTO resale_rules(bought_product_id,suggest_product_id,reason,min_days,max_days,is_demo,created_at) VALUES(?,?,?,?,365,1,?)`, P(b), P(sgs), why, min, t);
    rule('Sony A7 IV (korpus)', 'Sony FE 50mm f/1.8', 'Faqat korpus olgan — obyektiv xaridi yo‘q');
    rule('Sony ZV-E10 kit 16-50mm', 'DJI Mic Mini (2 TX + 1 RX)', 'ZV-E10 egasi, mikrofon olmagan — 3.5 mm kirish orqali mos');
    rule('Godox SL60W', 'Godox softbox 80 sm (Bowens)', 'Yoritgich olgan, softbox olmagan (Bowens ulanish)');
    rule('Canon EOS R50 kit 18-45mm', 'Canon RF 50mm f/1.8 STM', 'R50 egasi — portret obyektiv (RF ulanish)');
    rule('Fujifilm X-S20 + XC 15-45mm', 'SanDisk Extreme PRO SDXC 128 GB', 'Video uchun sig‘imli karta (SD slot)', 3);
    rule('DJI Osmo Pocket 3', 'DJI Mic Mini (2 TX + 1 RX)', 'Pocket 3 egasi — tashqi mikrofon', 10);
  });
  // Demo reja: joriy oy uchun tarixiy o‘rtacha × 1.05 (rahbar o‘zgartiradi)
  const per = new Date(t + 5 * 3600e3).toISOString().slice(0, 7);
  const hist = one(`SELECT sum(amount) s FROM purchases WHERE is_demo=1 AND sold_at<? AND sold_at>=?`, t - 20 * 864e5, t - 50 * 864e5).s || 0;
  const monthPlan = Math.round(hist * 0.9 / 1e6) * 1e6; // ~30 kunlik tarix × 0.9
  if (monthPlan) {
    run(`INSERT OR IGNORE INTO plans(period,scope,scope_key,revenue,version,status,basis,created_by,created_at) VALUES(?,'company','*',?,1,'approved','Demo reja',?,?)`, per, monthPlan, 'demo', t);
    run(`INSERT OR IGNORE INTO plans(period,scope,scope_key,revenue,version,status,basis,created_by,created_at) VALUES(?,'branch','Chilonzor (demo)',?,1,'approved','Demo reja',?,?)`, per, Math.round(monthPlan * 0.62 / 1e6) * 1e6, 'demo', t);
    run(`INSERT OR IGNORE INTO plans(period,scope,scope_key,revenue,version,status,basis,created_by,created_at) VALUES(?,'branch','Yunusobod (demo)',?,1,'approved','Demo reja',?,?)`, per, Math.round(monthPlan * 0.38 / 1e6) * 1e6, 'demo', t);
  }
  const mic = one(`SELECT id FROM products WHERE name='DJI Mic Mini (2 TX + 1 RX)' AND is_demo=1`);
  if (mic) run(`INSERT INTO campaigns(product_id,title,message,daily_limit,created_by,created_at,is_demo) VALUES(?,?,?,?,?,?,1)`, mic.id, 'Yangi kirim: DJI Mic Mini',
    'Salom, {ism}! Siz olgan {xarid} bilan mos {mahsulot} keldi — qabul qilgich kameraning 3.5 mm kirishiga ulanadi. Narxi: {narx}. Qiziq bo‘lsa, «ha» deb yozing — sotuvchimiz batafsil aytadi.', 60, 'demo', t);
}

/* Demo akkauntga mijoz sifatida xabar (sinov: taymer, «O‘zim olaman», AI javobi) */
export function simulateClient({ conversationId, name, text }) {
  const acct = one('SELECT * FROM accounts WHERE is_demo=1');
  if (!acct) throw new Error('demo_off');
  let ext = `demo-${now()}`, disp = name || 'Sinov mijozi';
  if (conversationId) { const c = one('SELECT * FROM conversations WHERE id=? AND account_id=?', conversationId, acct.id); if (!c) throw new Error('not_demo'); ext = c.ext_chat_id; disp = c.display_name; }
  return ingestClient(acct, { extChatId: ext, name: disp, text, extMsgId: `sim-${now()}-${Math.random().toString(36).slice(2, 7)}` });
}

export function removeDemo(who) {
  tx(() => {
    const convs = all('SELECT c.id FROM conversations c JOIN accounts a ON a.id=c.account_id WHERE a.is_demo=1').map(r => r.id);
    for (const id of convs) {
      run('DELETE FROM drafts WHERE conversation_id=?', id);
      run('DELETE FROM messages WHERE conversation_id=?', id);
      run('DELETE FROM tasks WHERE conversation_id=?', id);
      run('DELETE FROM conversations WHERE id=?', id);
    }
    run('DELETE FROM accounts WHERE is_demo=1');
    run('DELETE FROM campaign_sends WHERE campaign_id IN (SELECT id FROM campaigns WHERE is_demo=1)');
    run('DELETE FROM campaigns WHERE is_demo=1');
    run('DELETE FROM resale_rules WHERE is_demo=1');
    run(`DELETE FROM plans WHERE created_by='demo'`);
    run('DELETE FROM tasks WHERE customer_id IN (SELECT id FROM customers WHERE is_demo=1)');
    run('DELETE FROM purchases WHERE is_demo=1');
    run('DELETE FROM cashback WHERE customer_id IN (SELECT id FROM customers WHERE is_demo=1)');
    run('UPDATE conversations SET customer_id=NULL WHERE customer_id IN (SELECT id FROM customers WHERE is_demo=1)');
    run('DELETE FROM customers WHERE is_demo=1');
    run('DELETE FROM products WHERE is_demo=1');
    run('DELETE FROM insights'); // demo savdosidan chiqqan xulosalar (har kuni haqiqiy ma’lumotdan qayta tuziladi)
  });
  audit('staff', who, 'Demo ma’lumot o‘chirildi');
}
