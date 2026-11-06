#!/usr/bin/env node
/*
  Instagram yordamchisidagi savolga javob yuborish (bot orqali):
    node scripts/ig-javob.js <chat_id> "javob matni"
  Vazifa yopiladi va javob jurnalga yoziladi.
*/
import { db, run, one } from '../src/db.js';
import { now, clip } from '../src/util.js';
import { audit } from '../src/core/audit.js';
import { tg } from '../src/channels/telegram.js';

const [chatId, ...rest] = process.argv.slice(2);
const text = rest.join(' ').trim();
if (!chatId || !text) { console.error('node scripts/ig-javob.js <chat_id> "javob matni"'); process.exit(1); }
try {
  await tg('sendMessage', { chat_id: Number(chatId), parse_mode: 'HTML', text, disable_web_page_preview: true });
  const t = one(`SELECT id FROM tasks WHERE kind='meta_help' AND status='open' AND body LIKE ? ORDER BY id DESC LIMIT 1`, `%${chatId}%`);
  if (t) run(`UPDATE tasks SET status='done', result=?, done_at=? WHERE id=?`, clip(text, 200), now(), t.id);
  audit('staff', 'Automind', 'Instagram yordamchisiga javob yuborildi', { object: `chat:${chatId}`, result: clip(text, 200) });
  console.log('Yuborildi.');
} catch (e) { console.error('Xato:', e.message); process.exit(1); }
db.close();
process.exit(0);
