#!/usr/bin/env node
/*
  Telegram Desktop HTML eksportini panelga yuklash (Export chat history → format «HTML»).
  Eksport papkasidagi chats/chat_NNNN/messages*.html o‘qiladi; media fayllar kerak emas.

    sudo -u sales env ENV_FILE=/opt/sales/.env node scripts/tg-html-import.js <.../chats>                  — nima yuklanishini ko‘rsatadi
    sudo -u sales env ENV_FILE=/opt/sales/.env node scripts/tg-html-import.js <.../chats> --yes            — yuklaydi
      --owner "Photobuy.uz"   akkaunt egasi nomi (odatda o‘zi topiladi)
      --skip "Ism1,Ism2"      shu nomli chatlar yuklanmaydi (shaxsiy yozishmalar)

  Jonli suhbat (Business orqali kelgan) bilan bir xil chat bo‘lsa — matn va vaqt mos kelishi bo‘yicha topiladi va eski tarix
  o‘sha suhbatga qo‘shiladi (faqat jonli yozishma boshlanishidan oldingi xabarlar). Qolganlari — «Arxiv».
*/
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { db, one, all } from '../src/db.js';
import { parseChatDir, detectOwner, buildPlan } from '../src/services/tg-html.js';
import { applyImport } from '../src/services/tg-import.js';
import { rebuildPairs } from '../src/services/uslub.js';

const args = process.argv.slice(2);
const opt = k => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
const root = args.find((a, i) => !a.startsWith('--') && !['--owner', '--skip'].includes(args[i - 1]));
if (!root || !existsSync(root)) { console.error('node scripts/tg-html-import.js <chats papkasi> [--owner "Ism"] [--skip "Ism1,Ism2"] [--yes]'); process.exit(1); }
const acct = one(`SELECT * FROM accounts WHERE channel='tg' AND enabled=1 AND is_demo=0 ORDER BY id LIMIT 1`);
if (!acct) { console.error('Telegram Business akkaunti ulanmagan.'); process.exit(1); }

const t0 = Date.now();
const chats = readdirSync(root).filter(d => /^chat_\d+$/.test(d)).sort().map(d => ({ dir: d, ...parseChatDir(join(root, d)) }));
const det = detectOwner(chats), owner = opt('--owner') || det.owner;
if (!owner) { console.error('Akkaunt egasi aniqlanmadi — --owner bilan bering.'); process.exit(1); }
const skip = new Set(String(opt('--skip') || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
const { plan, skipped } = buildPlan(chats, owner, { skipNames: skip });

/* Jonli suhbatlar bilan moslash: bir xil muallif + bir xil matn + vaqt farqi ≤ 2 daqiqa */
const norm = t => String(t || '').replace(/\s+/g, ' ').trim();
const idx = new Map();
plan.forEach((c, pi) => c.msgs.forEach(m => {
  const t = norm(m.text); if (!t || t.startsWith('[')) return;
  const k = `${m.author}|${t}`; (idx.get(k) || idx.set(k, []).get(k)).push({ pi, at: m.at });
}));
const links = new Map();
for (const lc of all(`SELECT id FROM conversations WHERE account_id=? AND archived=0 AND ext_chat_id NOT LIKE 'tgarx:%'`, acct.id)) {
  const own = all(`SELECT author, text, created_at at FROM messages WHERE conversation_id=? AND COALESCE(json_extract(meta,'$.imported'),0)=0 AND author IN ('client','seller')`, lc.id);
  const votes = new Map();
  for (const m of own) {
    const t = norm(m.text); if (!t || t.startsWith('[')) continue;
    for (const h of idx.get(`${m.author}|${t}`) || []) if (Math.abs(h.at - m.at) <= 120e3) votes.set(h.pi, (votes.get(h.pi) || 0) + (t.length >= 15 ? 2 : 1));
  }
  const best = [...votes].sort((a, b) => b[1] - a[1]);
  if (best.length && best[0][1] >= 2 && (!best[1] || best[0][1] > best[1][1]) && !links.has(best[0][0])) {
    const first = one(`SELECT min(created_at) at FROM messages WHERE conversation_id=? AND COALESCE(json_extract(meta,'$.imported'),0)=0`, lc.id).at;
    links.set(best[0][0], { convId: lc.id, before: first });
  }
}

/* 2-bosqich: matn mos kelmagan jonli suhbat (eksportdan keyin boshlangan) — ism bo‘yicha, faqat ism+familiya va eksportda yagona bo‘lsa
   (inbox.adoptArchived bilan bir xil qoida) */
const byName = new Map();
plan.forEach((c, pi) => { const n = norm(c.name); byName.set(n, byName.has(n) ? -1 : pi); });
const linkedConv = new Set([...links.values()].map(l => l.convId));
let byNameN = 0;
for (const lc of all(`SELECT id, display_name FROM conversations WHERE account_id=? AND archived=0 AND ext_chat_id NOT LIKE 'tgarx:%'`, acct.id)) {
  const n = norm(lc.display_name), pi = byName.get(n);
  if (linkedConv.has(lc.id) || pi == null || pi < 0 || links.has(pi) || n.split(' ').length < 2 || n.length < 5 || n === 'O‘chirilgan akkaunt') continue;
  const first = one(`SELECT min(created_at) at FROM messages WHERE conversation_id=? AND COALESCE(json_extract(meta,'$.imported'),0)=0`, lc.id).at;
  if (!first) continue;
  links.set(pi, { convId: lc.id, before: first }); byNameN++;
}

const items = plan.map((c, pi) => {
  const l = links.get(pi);
  const msgs = c.msgs.filter(m => !l || m.at < l.before).map(m => ({ ...m, id: `x${m.id}` }));
  return l ? { convId: l.convId, chatId: null, name: c.name, msgs } : { chatId: `tgarx:${c.dir}`, userId: null, name: c.name, msgs };
}).filter(c => c.msgs.length);
const total = items.reduce((a, c) => a + c.msgs.length, 0), sellers = items.reduce((a, c) => a + c.msgs.filter(m => m.author === 'seller').length, 0);
const first = Math.min(...items.map(c => c.msgs[0].at)), last = Math.max(...items.map(c => c.msgs.at(-1).at));
console.log(`Akkaunt: ${acct.name} · eksport egasi: ${owner === det.owner ? `${owner} (o‘zi topildi, ${det.chats} chatda)` : owner}`);
console.log(`O‘qildi: ${chats.length} chat, ${chats.reduce((a, c) => a + c.msgs.length, 0)} xabar (${Date.now() - t0} ms)`);
console.log(`Yuklanadi: ${items.length} chat, ${total} xabar (sotuvchi ${sellers}, mijoz ${total - sellers}), ${new Date(first).toISOString().slice(0, 10)} … ${new Date(last).toISOString().slice(0, 10)}`);
console.log(`Jonli suhbatga ulanadi: ${links.size} ta (${links.size - byNameN} tasi matn va vaqt bo‘yicha, ${byNameN} tasi ism bo‘yicha) — eski tarixi qo‘shiladi; arxivga: ${items.filter(c => !c.convId).length} ta`);
console.log(`O‘tkazildi: ${skipped.guruh} guruh, ${skipped.xizmat} bot/xizmat, ${skipped.nom} nom bo‘yicha, ${skipped.bosh} bo‘sh`);
if (!args.includes('--yes')) { console.log('\nYuklash uchun --yes qo‘shing.'); process.exit(0); }
const r = applyImport(acct, items, 'Telegram HTML eksporti');
const pairs = rebuildPairs();
console.log(`\nYuklandi: ${r.added} yangi xabar (${r.dup} tasi avval bor edi), ${r.created} ta arxiv suhbat. O‘rganish uchun ${pairs} ta «savol → javob» jufti tayyor.`);
db.close();
process.exit(0);
