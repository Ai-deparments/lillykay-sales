import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const dir = mkdtempSync(join(tmpdir(), 'sales-budget-'));
Object.assign(process.env, { DB_FILE: join(dir, 't.db'), DATA_DIR: dir, TG_DISABLED: '1' });

const { migrate, kvSet, run, one } = await import('../src/db.js');
migrate();
const { local } = await import('../src/util.js');
const m = await import('../src/services/ai-usage.js');

const spend = usd => run(`INSERT INTO ai_usage(day,model,calls,in_tok,out_tok,cached_tok) VALUES(?,?,1,0,?,0)
  ON CONFLICT(day,model) DO UPDATE SET out_tok=out_tok+excluded.out_tok`, local().date, 't', Math.round(usd / 3.75 * 1e6));

test('kunlik chegara standart holatda yo‘q', () => {
  assert.equal(m.limits().day, 0);
  spend(10);
  assert.equal(m.budgetStop(), null);
});

test('balansda $5 qolganda AI to‘xtaydi (zaxira yoqilgan bo‘lsa), to‘ldirilganda qayta ishlaydi; kiritishdan oldingi sarf ayirilmaydi', () => {
  // Standart: taxminiy balans bo‘yicha o‘chirish yo‘q — rahbar haqiqiy balansni Google AI Studio’da ko‘radi (2026-10-09)
  assert.equal(m.reserve(), 0);
  m.setTopup(1, 'test'); spend(5); m.setLimits(null, null);
  assert.equal(m.budgetStop(), null, 'zaxira o‘chiq — taxminiy balans tugasa ham AI ishlaydi');
  kvSet('ai_reserve_usd', 5);
  m.setTopup(14, 'test');              // kiritilgan summa — shu paytdagi balans: bugun oldinroq sarflangan $10 ayirilmaydi
  assert.equal(m.budgetStop(), null);
  spend(10);                           // kiritishdan keyin $10 → $4 qoldi
  m.setLimits(null, null);             // 60 soniyalik keshni yangilash
  assert.equal(m.budgetStop()?.why, 'balance');
  m.setTopup(50, 'test');
  assert.equal(m.budgetStop(), null);
  kvSet('ai_reserve_usd', 0); m.setTopup(11, 'test');
  assert.equal(m.budgetStop(), null);  // zaxira 0 — o‘chiq
});

test('narx: 3.1-flash-lite — Google Standard tarifi; ovoz, qidiruv natijasi va kesh saqlash hisobga kiradi', () => {
  const p = m.priceFor('gemini-3.1-flash-lite');
  assert.deepEqual([p.in, p.out, p.cached, p.audio, p.storage], [0.25, 1.5, 0.025, 0.5, 1]);
  // keshsiz matn 600k ($0.15) + ovoz 100k ($0.05) + keshdan 400k ($0.01) + chiqish 200k ($0.30) + 10k token·soat saqlash ($0.01)
  const usd = m.costOf({ in_tok: 1_100_000, cached_tok: 400_000, audio_tok: 100_000, out_tok: 200_000, cache_th: 10_000 }, p);
  assert.ok(Math.abs(usd - 0.52) < 1e-9, String(usd));
  m.recordUsage('gemini-3.1-flash-lite', { promptTokenCount: 1000, toolUsePromptTokenCount: 500, cachedContentTokenCount: 200,
    candidatesTokenCount: 10, thoughtsTokenCount: 90, promptTokensDetails: [{ modality: 'TEXT', tokenCount: 700 }, { modality: 'AUDIO', tokenCount: 300 }] });
  m.recordCacheStorage('gemini-3.1-flash-lite', 12000, 3600);
  const r = one(`SELECT * FROM ai_usage WHERE day=? AND model='gemini-3.1-flash-lite'`, local().date);
  assert.deepEqual([r.calls, r.in_tok, r.out_tok, r.cached_tok, r.audio_tok, r.cache_th], [1, 1500, 100, 200, 300, 12000], 'kesh saqlash so‘rovlar soniga qo‘shilmaydi');
  // bazada qolgan eski Batch narxi ($0.125) ma’lum modelga endi ta’sir qilmaydi
  kvSet('ai_price_in', 0.125); kvSet('ai_model', 'gemini-3.1-flash-lite');
  assert.equal(m.price().in, 0.25);
});

test('panel: nechta mijozga nechta javob — AI xabarlari (odamlar) va javob hisoblagichi', () => {
  const a = Number(run(`INSERT INTO accounts(channel,ext_id,name,can_reply,enabled,mode,rollout,created_at) VALUES('tg','b1','t',1,1,'kechiksa','avto',?)`, Date.now()).lastInsertRowid);
  const conv = ext => Number(run(`INSERT INTO conversations(account_id,ext_chat_id,created_at,last_msg_at) VALUES(?,?,?,?)`, a, ext, Date.now(), Date.now()).lastInsertRowid);
  const c1 = conv('1'), c2 = conv('2');
  for (const c of [c1, c1, c2]) run(`INSERT INTO messages(conversation_id,author,text,created_at) VALUES(?,?,?,?)`, c, 'ai', 'javob', Date.now());
  for (let i = 0; i < 3; i++) m.recordReply('gemini-3.1-flash-lite');
  const r = m.usageReport();
  assert.equal(r.today.people, 2, 'bir mijozga 2 ta xabar — bitta odam');
  assert.equal(r.today.replies, 3);
  assert.equal(r.days.find(d => d.day === local().date).people, 2);
  assert.ok(r.month.people >= 2 && r.month.replies >= 3);
});
