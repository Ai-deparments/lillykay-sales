#!/usr/bin/env node
/*
  Q3 qabul sinovi: AI javoblari sifatini o‘lchash. Mijozga hech narsa yuborilmaydi — javoblar faylga yoziladi.
  Ishga tushirish (serverda):
    sudo -u sales env ENV_FILE=/opt/sales/.env node scripts/ai-sinov.js [savollar.txt] [--limit 60]
  Savollar fayli berilmasa — katalogdagi eng ko‘p sotilgan, do‘konda bor tovarlardan avtomatik tuziladi
  (narx/qoldiq, moslik, tanlash, xizmat savollari). Natija: data/ai-sinov-<sana>.md — sotuv rahbari har javobga baho qo‘yadi.
*/
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { config, aiReady } from '../src/config.js';
import { db, all, one, run } from '../src/db.js';
import { getSettings } from '../src/services/settings.js';
import { listProducts } from '../src/services/catalog.js';
import { fokusDraft } from '../src/agents/fokus.js';
import { now } from '../src/util.js';

if (!aiReady()) { console.error('ANTHROPIC_API_KEY kiritilmagan — sinov o‘tkazib bo‘lmaydi (deploy/sozla.sh anthropic).'); process.exit(1); }
getSettings();

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const limit = Number((args.find(a => a.startsWith('--limit')) || '').split('=')[1] || args[args.indexOf('--limit') + 1] || 60);

/* Savollar: fayldan yoki katalogdan (mijozlar odatda shunday so‘raydi) */
function generate() {
  const top = listProducts('', { stock: 'store', limit: 400 }).items.sort((a, b) => b.sold90 - a.sold90);
  const pick = n => top.slice(0, n);
  const model = p => p.name.split(' — ')[0];
  const q = [];
  for (const p of pick(20)) q.push(`${model(p)} bormi? Narxi qancha?`);
  for (const p of pick(14).slice(6)) q.push(`Здравствуйте, ${model(p)} есть в наличии? Сколько стоит?`);
  for (const p of pick(10)) q.push(`${model(p)} Sony A7 IV ga mos keladimi?`);
  for (const p of pick(6)) q.push(`${model(p)} ni Canon R50 bilan ishlatsa bo‘ladimi? Nima kerak bo‘ladi?`);
  q.push(
    'Vlog uchun kamera tanlab bering, budjet 1500 dollar',
    'Studiyaga yorug‘lik kerak, 2 ta prilad va softbox. Jami qancha bo‘ladi?',
    'Интервью снимаю, нужен петличный микрофон на две персоны. Что посоветуете?',
    'Kechqurun do‘kon soat nechagacha ochiq?',
    'Yetkazib berasizmi? Qancha vaqtda?',
    'Kafolat necha oy? Buzilsa nima qilaman?',
    'Chegirma bormi? Naqd olsam arzonroq bo‘ladimi?',
    'Keshbekim qancha? Telefon raqamim +998901234567',
    'Kecha olgan obyektivimni qaytarmoqchiman, mumkinmi?',
    'Оплата частями есть?'
  );
  return q;
}

const questions = (file && existsSync(file)
  ? readFileSync(file, 'utf8').split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'))
  : generate()).slice(0, limit);

/* Sinov uchun vaqtinchalik akkaunt va suhbatlar — tashqariga hech narsa yuborilmaydi (channel='demo') */
const EXT = 'ai-sinov';
run(`INSERT OR IGNORE INTO accounts(channel,ext_id,name,can_reply,enabled,mode,rollout,is_demo,created_at) VALUES('demo',?,?,1,1,'doim','kuzatish',1,?)`, EXT, 'AI sinov (Q3)', now());
const acct = one(`SELECT * FROM accounts WHERE channel='demo' AND ext_id=?`, EXT);

const rows = [];
for (const [i, text] of questions.entries()) {
  const chat = `${EXT}-${i}`;
  run(`INSERT OR IGNORE INTO conversations(account_id,ext_chat_id,display_name,is_demo,created_at,last_msg_at,last_client_at,pending_since,window_until) VALUES(?,?,?,1,?,?,?,?,?)`,
    acct.id, chat, `Sinov ${i + 1}`, now(), now(), now(), now(), now() + 864e5);
  const conv = one('SELECT * FROM conversations WHERE account_id=? AND ext_chat_id=?', acct.id, chat);
  run(`INSERT INTO messages(conversation_id,author,text,ext_msg_id,created_at) VALUES(?,'client',?,?,?)`, conv.id, text, `${chat}-1`, now());
  const t0 = Date.now();
  let out;
  try { out = await fokusDraft({ conv: one('SELECT * FROM conversations WHERE id=?', conv.id), acct }); }
  catch (e) { out = { ok: false, reason: String(e.message || e) }; }
  const ms = Date.now() - t0;
  rows.push({ i: i + 1, q: text, ok: out.ok, answer: out.ok ? out.text : `[javob yo‘q: ${out.reason}]`, sources: out.sources || [], handoff: out.handoff || null, big: Boolean(out.bigOrder), card: out.card || {}, model: out.model, ms });
  console.log(`${i + 1}/${questions.length} · ${ms} ms · ${out.ok ? 'ok' : out.reason}`);
}

/* Hisobot: rahbar har javobga baho qo‘yadi (to‘g‘ri / qisman / noto‘g‘ri) */
const date = new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
const md = [`# AI javoblari sinovi (Q3) — ${date} (Toshkent)`, '',
  `Model: ${config.aiModel} · savol: ${rows.length} · manba ko‘rsatilgan javoblar: ${rows.filter(r => r.sources.length).length} · sotuvchiga uzatilgan: ${rows.filter(r => r.handoff).length} · o‘rtacha vaqt: ${Math.round(rows.reduce((a, r) => a + r.ms, 0) / rows.length)} ms`, '',
  'Har javobga baho qo‘ying: **to‘g‘ri** / **qisman** / **noto‘g‘ri**. Narx va qoldiq BILLZ bilan solishtiriladi; moslik — tasdiqlangan karta bilan.', '',
  '| № | Savol | AI javobi | Manba | Baho |', '|---|---|---|---|---|',
  ...rows.map(r => `| ${r.i} | ${r.q.replace(/\|/g, '\\|')} | ${String(r.answer).replace(/\n/g, ' ').replace(/\|/g, '\\|')} | ${r.sources.join('; ').replace(/\|/g, '\\|') || '—'}${r.handoff ? ' · uzatildi' : ''} |  |`),
  '', '## Batafsil', '',
  ...rows.flatMap(r => [`### ${r.i}. ${r.q}`, '', r.answer, '', `Manbalar: ${r.sources.join(' · ') || '—'}${r.handoff ? `\nSotuvchiga uzatildi: ${r.handoff}` : ''}${r.big ? '\nKatta buyurtma signali: ha' : ''}`,
    `Karta: ${JSON.stringify(r.card)}`, ''])
].join('\n');
const out = join(config.dataDir, `ai-sinov-${date.slice(0, 10)}.md`);
writeFileSync(out, md);

/* Tozalash: sinov suhbatlari bazada qolmaydi */
const convs = all('SELECT id FROM conversations WHERE account_id=?', acct.id).map(r => r.id);
for (const id of convs) { run('DELETE FROM drafts WHERE conversation_id=?', id); run('DELETE FROM messages WHERE conversation_id=?', id); run('DELETE FROM tasks WHERE conversation_id=?', id); run('DELETE FROM conversations WHERE id=?', id); }
run('DELETE FROM accounts WHERE id=?', acct.id);
db.close();
console.log(`\nHisobot: ${out}\nSavol: ${rows.length} · manbali javob: ${rows.filter(r => r.sources.length).length} · uzatilgan: ${rows.filter(r => r.handoff).length}`);
