/*
  Mijozning profil rasmi: Telegram (getUserProfilePhotos) va Instagram (profile_pic) dan olinadi, serverda saqlanadi,
  panelga versiyali havola bilan beriladi. Rasm yo‘q — bosh harflar; xato — eskisi qoladi; navbat Instagram limitini asraydi.
*/
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sales-avatar-'));
Object.assign(process.env, { DB_FILE: join(dir, 't.db'), DATA_DIR: dir, TG_DISABLED: '1', TG_BOT_TOKEN: '123:sinov', IG_TOKEN: 'IGsinov', IG_USER_ID: '1789' });
const { migrate, run, one } = await import('../src/db.js');
migrate();
const A = await import('../src/services/avatar.js');
after(() => rmSync(dir, { recursive: true, force: true }));

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)]);
const acct = (ch, ext) => Number(run(`INSERT INTO accounts(channel,ext_id,name,can_reply,enabled,mode,rollout,created_at) VALUES(?,?,?,1,1,'kechiksa','kuzatish',?)`,
  ch, ext, ch, Date.now()).lastInsertRowid);
const conv = (a, ext, at = Date.now()) => Number(run(`INSERT INTO conversations(account_id,ext_chat_id,ext_user_id,display_name,created_at,last_msg_at) VALUES(?,?,?,?,?,?)`,
  a, ext, ext, 'Mijoz', at, at).lastInsertRowid);
const row = id => one('SELECT * FROM conversations WHERE id=?', id);

test('rasm bor — saqlanadi va versiyali havola; tarmoq xatosi — eskisi qoladi; rasm olib tashlangan — bosh harflar', async () => {
  const c = conv(acct('tg', 'bc1'), '5551');
  assert.equal(await A.refreshAvatar(c, { tg: async () => JPEG }), true);
  const r = row(c);
  assert.ok(r.avatar_v && existsSync(A.avatarFile(c)));
  assert.equal(A.avatarUrl(r), `/api/conversations/${c}/avatar?v=${r.avatar_v}`);
  assert.equal(A.readAvatar(c).mime, 'image/jpeg');
  assert.equal(await A.refreshAvatar(c, { tg: async () => { throw new Error('ECONNRESET'); } }), null);
  assert.ok(existsSync(A.avatarFile(c)) && row(c).avatar_v, 'vaqtinchalik xato — rasm o‘chmaydi');
  assert.ok(row(c).avatar_at < Date.now() - 6 * 864e5, '1 soatdan keyin yana uriniladi');
  assert.equal(await A.refreshAvatar(c, { tg: async () => null }), false);
  assert.ok(!existsSync(A.avatarFile(c)));
  assert.equal(A.avatarUrl(row(c)), null);
  assert.equal(await A.refreshAvatar(c, { tg: async () => Buffer.from('<html>xato</html>'.repeat(20)) }), false, 'rasm bo‘lmagan javob saqlanmaydi');
});

test('navbat: avval yangi xabarlilar, Instagram 3 tadan, eksport arxivi so‘ralmaydi, yangilanganlar 7 kun so‘ralmaydi', async () => {
  const tgA = acct('tg', 'bc2'), igA = acct('ig', 'ig2'), asked = [];
  const f = { tg: async id => { asked.push('tg' + id); return JPEG; }, ig: async id => { asked.push('ig' + id); return null; } };
  for (let i = 0; i < 5; i++) conv(igA, String(9000 + i), Date.now() - i * 1000);
  const arx = conv(tgA, 'tgarx:abc');
  await A.avatarTick({ tg: 12, ig: 3, fetchers: f, pause: 0 });
  assert.deepEqual(asked.filter(x => x.startsWith('ig')), ['ig9000', 'ig9001', 'ig9002']);
  assert.ok(!asked.some(x => x.includes('tgarx')) && row(arx).avatar_at, 'arxiv — so‘ralmaydi, belgilanadi');
  asked.length = 0;
  await A.avatarTick({ tg: 12, ig: 3, fetchers: f, pause: 0 });
  assert.deepEqual(asked, ['ig9003', 'ig9004']);
  // Instagram «juda ko‘p so‘rov» (kod 4) — vaqtinchalik: 1 soatdan keyin; mijoz topilmadi (400) — 7 kundan keyin
  const r1 = conv(igA, '9100'), r2 = conv(igA, '9101');
  await A.refreshAvatar(r1, { ig: async () => { throw Object.assign(new Error('limit'), { status: 400, igCode: 4 }); } });
  await A.refreshAvatar(r2, { ig: async () => { throw Object.assign(new Error('yo‘q'), { status: 400, igCode: 100 }); } });
  assert.ok(row(r1).avatar_at < Date.now() - 6 * 864e5 && row(r2).avatar_at > Date.now() - 60e3);
  // «User consent is required» (HTTP 500, jonli sinovda uchragan) — har soat qayta so‘ralmaydi
  const r3 = conv(igA, '9102');
  await A.refreshAvatar(r3, { ig: async () => { throw Object.assign(new Error('Instagram profili: HTTP 500 User consent is required to access user profile'), { status: 500 }); } });
  assert.ok(row(r3).avatar_at > Date.now() - 60e3);
});

test('kanal so‘rovlari: Telegram — 160 px rasm, Instagram — profile_pic havolasidan', async () => {
  const real = globalThis.fetch, seen = [];
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    seen.push(u.replace(/bot[^/]+/, 'bot*'));
    if (u.endsWith('/getUserProfilePhotos')) {
      assert.deepEqual(JSON.parse(opts.body), { user_id: 5551, limit: 1 });
      return new Response(JSON.stringify({ ok: true, result: { total_count: 1, photos: [[{ file_id: 'F160', file_unique_id: 'a', width: 160, height: 160 },
        { file_id: 'F640', file_unique_id: 'b', width: 640, height: 640 }]] } }));
    }
    if (u.endsWith('/getFile')) { assert.equal(JSON.parse(opts.body).file_id, 'F160'); return new Response(JSON.stringify({ ok: true, result: { file_path: 'photos/f.jpg' } })); }
    if (u.includes('/file/bot')) return new Response(JPEG);
    if (u.includes('/42?fields=profile_pic')) { assert.equal(opts.headers.authorization, 'Bearer IGsinov'); return new Response(JSON.stringify({ profile_pic: 'https://cdn.sinov/p.jpg', id: '42' })); }
    if (u.includes('/43?fields=profile_pic')) return new Response(JSON.stringify({ id: '43' }));
    if (u === 'https://cdn.sinov/p.jpg') return new Response(JPEG);
    throw new Error('kutilmagan so‘rov: ' + u);
  };
  try {
    const { tgUserPhoto } = await import('../src/channels/telegram.js');
    const { igProfilePic } = await import('../src/channels/instagram.js');
    assert.equal((await tgUserPhoto('5551')).length, JPEG.length);
    assert.equal((await igProfilePic('42')).length, JPEG.length);
    assert.equal(await igProfilePic('43'), null, 'rasmsiz profil');
    assert.ok(seen.some(u => u.endsWith('/file/bot*/photos/f.jpg')));
  } finally { globalThis.fetch = real; }
});
