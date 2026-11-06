/*
  Telegram eksporti importi: faqat mijoz chatlari, muallif to‘g‘ri, takrorlanmaydi,
  eski suhbat navbatga tushmaydi va ta’qib olmaydi.
*/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sales-tgi-'));
process.env.DB_FILE = join(dir, 't.db'); process.env.DATA_DIR = dir; process.env.TG_DISABLED = '1';
const { migrate, run, one, all } = await import('../src/db.js');
const { parseExport, applyImport, flatten } = await import('../src/services/tg-import.js');

const OWNER = 5550001, t0 = Math.floor(Date.UTC(2026, 7, 1) / 1000);
const EXPORT = { chats: { list: [
  { name: 'Aziz mijoz', type: 'personal_chat', id: 700001, messages: [
    { id: 1, type: 'message', date_unixtime: String(t0), from: 'Aziz', from_id: 'user700001', text: 'Salom, Canon R6 bormi?' },
    { id: 2, type: 'message', date_unixtime: String(t0 + 60), from: 'Photobuy', from_id: `user${OWNER}`, text: ['Assalomu alaykum! ', { type: 'bold', text: 'Ha, bor' }, ' — qaysi filialdan olasiz?'] },
    { id: 3, type: 'service', date_unixtime: String(t0 + 70), action: 'phone_call' },
    { id: 4, type: 'message', date_unixtime: String(t0 + 90), from: 'Aziz', from_id: 'user700001', text: '', photo: 'photos/a.jpg' }
  ] },
  { name: 'Photobuy guruhi', type: 'private_supergroup', id: 800001, messages: [{ id: 1, type: 'message', date_unixtime: String(t0), from_id: 'user1', text: 'x' }] },
  { name: 'Onam', type: 'personal_chat', id: 700002, messages: [{ id: 1, type: 'message', date_unixtime: String(t0), from_id: 'user700002', text: 'uyga kel' }] },
  { name: 'Saved Messages', type: 'saved_messages', id: 1, messages: [] }
] } };

let acct;
before(() => {
  migrate();
  acct = one('SELECT * FROM accounts WHERE id=?', run(`INSERT INTO accounts(channel,ext_id,name,tg_owner_id,can_reply,enabled,created_at) VALUES('tg','bc1','Photobuy.uz',?,1,1,?)`, OWNER, Date.now()).lastInsertRowid);
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('matn bo‘laklari birlashtiriladi', () => {
  assert.equal(flatten(['Ha, ', { type: 'bold', text: 'bor' }]), 'Ha, bor');
  assert.equal(flatten('oddiy'), 'oddiy');
});

test('faqat mijoz chatlari olinadi; shaxsiy chatni nom bo‘yicha chiqarib tashlash mumkin', () => {
  const { plan, skipped } = parseExport(EXPORT, OWNER, new Set(['onam']));
  assert.deepEqual(plan.map(c => c.name), ['Aziz mijoz']);
  assert.equal(skipped.tur, 2, 'guruh va Saved Messages o‘tkazildi');
  assert.equal(skipped.nom, 1, '«Onam» chiqarib tashlandi');
  const m = plan[0].msgs;
  assert.equal(m.length, 3, 'xizmat xabari (qo‘ng‘iroq) olinmaydi');
  assert.deepEqual(m.map(x => x.author), ['client', 'seller', 'client'], 'egasining xabari — sotuvchi');
  assert.equal(m[2].text, '[rasm]');
});

test('yuklash: takrorlanmaydi, navbatga tushmaydi, ta’qib olmaydi', () => {
  const { plan } = parseExport(EXPORT, OWNER, new Set(['onam']));
  const r1 = applyImport(acct, plan);
  assert.equal(r1.added, 3);
  const r2 = applyImport(acct, plan);
  assert.equal(r2.added, 0, 'qayta yuklash takror yozmaydi');
  assert.equal(r2.dup, 3);
  const c = one('SELECT * FROM conversations WHERE ext_chat_id=?', '700001');
  assert.equal(c.pending_since, null, 'eski xabar javob kutayotgan deb hisoblanmaydi');
  assert.equal(c.ai_due_at, null, 'AI eski suhbatga javob yozmaydi');
  assert.equal(c.followup_count, 2, 'ta’qib o‘chiq');
  assert.equal(c.stage, 0);
  assert.ok(c.last_msg_at >= t0 * 1000);
  const meta = all('SELECT meta FROM messages WHERE conversation_id=?', c.id).map(x => JSON.parse(x.meta));
  assert.ok(meta.every(x => x.imported), 'import belgisi bor');
});
