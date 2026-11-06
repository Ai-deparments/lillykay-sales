/* Suhbat tarixini tozalash va suhbatni o‘chirish: bog‘liq yozuvlar to‘g‘ri ketadi, mijoz yana yozsa yangi suhbat ochiladi */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sales-ochirish-'));
Object.assign(process.env, { DB_FILE: join(dir, 't.db'), DATA_DIR: dir, TG_DISABLED: '1', ENV_FILE: join(dir, 'yoq.env'), DRAFT_DEBOUNCE_MS: '999999' });

const { migrate, run, one } = await import('../src/db.js');
const inbox = await import('../src/services/inbox.js');
const boss = { id: 1, name: 'Rahbar' };
let acct;

before(() => {
  migrate();
  run(`INSERT INTO users(id,login,name,role,created_at) VALUES(1,'boss','Rahbar','rahbar',0)`);
  run(`INSERT INTO accounts(id,channel,ext_id,name,can_reply,enabled,mode,rollout,is_demo,created_at) VALUES(1,'tg','b1','Photobuy',1,1,'kechiksa','avto',0,0)`);
  acct = one('SELECT * FROM accounts WHERE id=1');
});
after(async () => { await inbox.drainInbox(100); rmSync(dir, { recursive: true, force: true }); });

const client = (chat, text, i) => inbox.ingestClient(acct, { extChatId: chat, extUserId: 5, name: 'Mijoz', text, extMsgId: i, ts: Date.now() + i });
const count = (table, id) => one(`SELECT count(*) n FROM ${table} WHERE conversation_id=?`, id).n;

test('tarixni tozalash: xabar va qoralama ketadi, suhbat va karta qoladi, kutish o‘chadi', () => {
  const c = client('c1', 'narxi qancha?', 1); client('c1', 'canon r50', 2);
  run(`INSERT INTO drafts(conversation_id,batch,status,created_at) VALUES(?,?,'ready',?)`, c.id, c.pending_since, Date.now());
  run(`UPDATE conversations SET budget='500$', heat='issiq' WHERE id=?`, c.id);
  const r = inbox.clearHistory(c.id, boss);
  assert.deepEqual(r, { ok: true, messages: 2 });
  assert.equal(count('messages', c.id), 0);
  assert.equal(count('drafts', c.id), 0);
  const after_ = inbox.conversation(c.id);
  assert.equal(after_.budget, '500$', 'karta qoladi');
  assert.equal(after_.pending_since, null, 'javob kutish o‘chadi — AI yozmaydi');
  assert.equal(after_.ai_due_at, null);
  assert.ok(one(`SELECT 1 FROM audit WHERE action='Suhbat tarixi tozalandi' AND object=?`, `conv:${c.id}`));
});

test('suhbatni o‘chirish: bog‘liq topshiriq ketadi, vazifa suhbatsiz qoladi, mijoz yana yozsa yangi suhbat', () => {
  const c = client('c2', 'salom', 3);
  const asg = run(`INSERT INTO assignments(conversation_id,kind,title,status,created_by,created_at) VALUES(?,'javob','t','offered','test',?)`, c.id, Date.now()).lastInsertRowid;
  run(`INSERT INTO assignment_events(assignment_id,event,at) VALUES(?,'offered',?)`, asg, Date.now());
  const task = run(`INSERT INTO tasks(kind,conversation_id,title,created_by,created_at) VALUES('javob',?,'Mijozga javob','test',?)`, c.id, Date.now()).lastInsertRowid;
  assert.deepEqual(inbox.deleteConversation(c.id, boss), { ok: true });
  assert.equal(inbox.conversation(c.id), undefined);
  assert.equal(count('messages', c.id), 0);
  assert.equal(one('SELECT count(*) n FROM assignments WHERE id=?', asg).n, 0);
  assert.equal(one('SELECT count(*) n FROM assignment_events WHERE assignment_id=?', asg).n, 0);
  assert.equal(one('SELECT conversation_id FROM tasks WHERE id=?', task).conversation_id, null, 'vazifa tarixda qoladi');
  // SQLite oxirgi o‘chirilgan ID ni qayta berishi mumkin — muhimi: suhbat toza, eski xabar/topshiriq yo‘q
  const again = client('c2', 'yana yozdim', 4);
  assert.equal(count('messages', again.id), 1, 'faqat yangi xabar');
  assert.equal(count('assignments', again.id), 0);
  assert.ok(again.pending_since, 'yangi savol javob kutadi');
  assert.deepEqual(inbox.deleteConversation(999999, boss), { ok: false, why: 'not_found' });
});
