/* Baza tozalash: eski jurnal/qoralama o‘chadi, mijoz xabarlari va yuborilgan javoblar qoladi; kuniga bir marta, tunda */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sales-tozalash-'));
Object.assign(process.env, { DB_FILE: join(dir, 't.db'), DATA_DIR: dir, TG_DISABLED: '1', ENV_FILE: join(dir, 'yoq.env') });

const { migrate, run, one, kvGet, kvSet } = await import('../src/db.js');
const { cleanupNow, cleanupJob } = await import('../src/services/tozalash.js');
const DAY = 86400e3, t = Date.now();

before(() => {
  migrate();
  run(`INSERT INTO accounts(id,channel,ext_id,name,can_reply,enabled,mode,rollout,is_demo,created_at) VALUES(1,'tg','b1','Photobuy',1,1,'kechiksa','avto',0,0)`);
  run(`INSERT INTO conversations(id,account_id,ext_chat_id,created_at) VALUES(1,1,'c1',?)`, t);
  run(`INSERT INTO messages(conversation_id,author,text,created_at) VALUES(1,'client','eski savol',?)`, t - 400 * DAY);
  for (const [status, age] of [['sent', 100], ['superseded', 100], ['cancelled', 40], ['failed', 31], ['failed', 2], ['ready', 100]])
    run(`INSERT INTO drafts(conversation_id,batch,status,created_at) VALUES(1,1,?,?)`, status, t - age * DAY);
  for (const [action, age] of [['Shablon javob yuborilmadi', 8], ['Shablon javob yuborilmadi', 1], ['Rahbar sozladi', 8], ['Rahbar sozladi', 91]])
    run(`INSERT INTO audit(at,kind,actor,action) VALUES(?,'sys','t',?)`, t - age * DAY, action);
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('eski qoralama va jurnal o‘chadi; sent, ready, yaqin yozuvlar va mijoz xabari qoladi', () => {
  const removed = cleanupNow(t);
  assert.deepEqual(removed, { audit: 1, 'audit-takror': 1, drafts: 3 });
  assert.equal(one(`SELECT group_concat(status) s FROM (SELECT status FROM drafts ORDER BY id)`).s, 'sent,failed,ready');
  assert.equal(one('SELECT count(*) n FROM audit').n, 2);
  assert.equal(one('SELECT count(*) n FROM messages').n, 1, 'mijoz xabari hech qachon o‘chmaydi');
});

test('javoblar hisoblagichi: qoralama o‘chirilsa ham «bitta javob» soni kamaymaydi', async () => {
  const { recordReply, usageReport } = await import('../src/services/ai-usage.js');
  kvSet('ai_model', 'm-lite');
  run(`INSERT INTO ai_usage(day,model,calls,in_tok,out_tok,cached_tok) VALUES(?,?,12,100000,1000,0)`, new Date(t + 5 * 3600e3).toISOString().slice(0, 10), 'm-lite');
  for (let i = 0; i < 12; i++) recordReply('m-lite');
  run(`INSERT INTO drafts(conversation_id,batch,status,created_at,model) VALUES(1,1,'sent',?,'m-lite')`, t);
  const r = usageReport();
  assert.equal(r.per_reply_info.drafts, 12, 'hisoblagich 12, jadvalda 1 — kattasi olinadi');
  run(`DELETE FROM drafts WHERE model='m-lite'`);
  assert.equal(usageReport().per_reply_info.drafts, 12, 'qoralama o‘chdi — son o‘zgarmadi');
});

test('kunlik ish: faqat soat 4 da va kuniga bir marta; VACUUM oyiga bir marta', () => {
  kvSet('cleanup_day', ''); kvSet('vacuum_month', '');
  const r = cleanupJob({ force: true });
  assert.equal(r.vacuumed, true);
  assert.ok(kvGet('cleanup_day'));
  assert.ok(kvGet('vacuum_month'));
  const r2 = cleanupJob({ force: true });
  assert.equal(r2.vacuumed, false, 'shu oyda VACUUM qayta qilinmaydi');
  assert.equal(cleanupJob(), null, 'tun bo‘lmasa yoki bugun bo‘lgan bo‘lsa — ishlamaydi');
});
