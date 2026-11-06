import { one, run, tx } from '../db.js';
import { clip } from '../util.js';
import { audit } from '../core/audit.js';

/*
  Telegram Desktop eksporti (JSON) → panel suhbatlari. Telegram botlarga eski tarixni bermaydi,
  shuning uchun akkaunt egasi mijoz chatlarini eksport qiladi va shu yerdan yuklanadi.
  Eski xabarlar navbatga qo‘yilmaydi, AI javob yozmaydi, ta’qib ketmaydi. Sotuvchining eski javoblari —
  AI uchun uslub namunasi (fokus.styleExamples).
*/
export function flatten(t) {
  if (typeof t === 'string') return t;
  if (Array.isArray(t)) return t.map(x => typeof x === 'string' ? x : x?.text || '').join('');
  return '';
}
function describeMedia(m) {
  if (m.photo) return '[rasm]';
  if (m.media_type === 'voice_message') return '[ovozli xabar]';
  if (m.media_type === 'video_message') return '[video xabar]';
  if (m.media_type === 'video_file' || m.media_type === 'animation') return '[video]';
  if (m.media_type === 'sticker') return `[stiker ${m.sticker_emoji || ''}]`.trim();
  if (m.file) return `[fayl: ${m.file_name || 'hujjat'}]`;
  if (m.contact_information) return '[kontakt]';
  if (m.location_information) return '[joylashuv]';
  return '';
}

/* Faqat shaxsiy (mijoz) chatlar: guruh, kanal, bot va «Saved messages» olinmaydi */
export function parseExport(data, ownerId, skipNames = new Set()) {
  const chats = data.chats?.list || (data.messages ? [data] : []);
  const owner = `user${ownerId}`, plan = [], skipped = { tur: 0, nom: 0, bosh: 0 };
  for (const ch of chats) {
    if (ch.type !== 'personal_chat') { skipped.tur++; continue; }
    if (skipNames.has(String(ch.name || '').toLowerCase())) { skipped.nom++; continue; }
    const msgs = (ch.messages || []).filter(m => m.type === 'message').map(m => ({
      id: String(m.id), at: Number(m.date_unixtime) * 1000 || Date.parse(m.date),
      author: m.from_id === owner ? 'seller' : 'client',
      text: clip((flatten(m.text) || describeMedia(m) || '[xabar]').trim(), 4000)
    })).filter(m => m.at);
    if (!msgs.length) { skipped.bosh++; continue; }
    plan.push({ chatId: String(ch.id), name: clip(ch.name || `Chat ${ch.id}`, 120), msgs });
  }
  return { plan, skipped };
}

/* plan: [{ chatId, name, msgs, convId?, userId?, note? }]. convId — mavjud (jonli) suhbatga eski tarixni qo‘shish.
   Yangi yaratilgan suhbat — arxiv (archived=1): navbatda turmaydi, ta’qib va ko‘rsatkichlarga kirmaydi, mijoz qayta yozsa jonlanadi. */
export function applyImport(acct, plan, label = 'Telegram eksporti') {
  let added = 0, dup = 0, created = 0;
  for (const c of plan) tx(() => {
    let conv = c.convId ? { id: c.convId } : one('SELECT id FROM conversations WHERE account_id=? AND ext_chat_id=?', acct.id, c.chatId);
    // Eski suhbat: navbatga qo‘yilmaydi (pending_since NULL), ta’qib o‘chiq (followup_count=2), bosqich 0
    if (!conv) {
      conv = { id: run(`INSERT INTO conversations(account_id,ext_chat_id,ext_user_id,display_name,source,source_note,followup_count,archived,created_at)
        VALUES(?,?,?,?, 'mavjud mijoz', ?, 2, 1, ?)`, acct.id, c.chatId, c.userId === undefined ? c.chatId : c.userId, c.name, c.note || 'Telegram eksportidan', c.msgs[0].at).lastInsertRowid };
      created++;
    }
    for (const m of c.msgs) {
      const r = run(`INSERT OR IGNORE INTO messages(conversation_id,author,text,ext_msg_id,meta,created_at) VALUES(?,?,?,?,?,?)`,
        conv.id, m.author, m.text, m.id, JSON.stringify({ imported: true }), m.at);
      r.changes ? added++ : dup++;
    }
    const l = one(`SELECT max(created_at) at, max(CASE WHEN author='client' THEN created_at END) cl, max(CASE WHEN author='seller' THEN created_at END) sl FROM messages WHERE conversation_id=?`, conv.id);
    run('UPDATE conversations SET last_msg_at=MAX(COALESCE(last_msg_at,0),?), last_client_at=MAX(COALESCE(last_client_at,0),?), last_seller_at=MAX(COALESCE(last_seller_at,0),?) WHERE id=?',
      l.at, l.cl || 0, l.sl || 0, conv.id);
  });
  audit('sys', 'Tizim', `${label} yuklandi: ${plan.length} chat, ${added} xabar`, { result: `${created} ta yangi arxiv suhbat; ${dup} ta xabar allaqachon bor edi` });
  return { added, dup, created };
}
