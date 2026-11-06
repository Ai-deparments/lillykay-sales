import { one, all, run } from '../db.js';
import { now, clip, inWindow } from '../util.js';
import { getSettings } from './settings.js';
import { effective, channelOpen, sendAiFollowup } from './inbox.js';
import { fokusDraft } from '../agents/fokus.js';

/* ---------- jim qolgan suhbatlar (SOT 05) ----------
   1-urinish: kanal oynasi ichida, tinch vaqtdan tashqarida — AI (faqat «avto» bosqichida); aks holda sotuvchiga vazifa.
   2-urinish: N kundan keyin — faqat sotuvchi vazifasi. Mijoz javobi, rad, xarid, xodim olishi — to‘xtatadi. */
let fuBusy = false;
export async function followups() {
  if (fuBusy) return; fuBusy = true;
  try {
    const s = getSettings(), t = now();
    const rows = all(`SELECT c.*, a.channel, a.rollout FROM conversations c JOIN accounts a ON a.id=c.account_id
      WHERE c.pending_since IS NULL AND c.taken_by IS NULL AND c.lost_reason IS NULL AND c.stage BETWEEN 1 AND 3 AND c.last_client_at IS NOT NULL
        AND max(COALESCE(c.last_seller_at,0), COALESCE(c.last_ai_at,0)) > c.last_client_at AND c.followup_count < 2 LIMIT 50`);
    for (const c of rows) {
      const lastOut = Math.max(c.last_seller_at || 0, c.last_ai_at || 0), silentH = (t - lastOut) / 3600e3;
      // Oxirgi xabarni SOTUVCHI yozgan bo‘lsa — suhbatni odam olib boryapti: AI mijozga o‘zi yozmaydi
      // (aks holda sotuvchi «hozir chiqazvoraman» degandan keyin AI mijozni bezovta qiladi). Taklif matni sotuvchiga vazifa bo‘lib boradi.
      const sellerLast = (c.last_seller_at || 0) >= (c.last_ai_at || 0);
      if (c.followup_count === 0 && silentH >= s.followup_first_hours) {
        const acct = one('SELECT * FROM accounts WHERE id=?', c.account_id), e = effective(c, acct);
        const canAuto = !sellerLast && acct.rollout === 'avto' && e.mode !== 'ochiq' && channelOpen(c, acct) && !inWindow(t, s.quiet_from, s.quiet_to);
        // AI kanalda to‘xtatilgan — taklif matni ham so‘ralmaydi, faqat sotuvchiga vazifa
        const d = acct.ai_enabled === 0 ? { ok: false } : await fokusDraft({ conv: c, acct, mode: 'followup' });
        if (d.ok && d.noReply) { run('UPDATE conversations SET followup_count=2 WHERE id=?', c.id); continue; }
        run('UPDATE conversations SET followup_count=1 WHERE id=?', c.id);
        if (canAuto && d.ok && d.text) { await sendAiFollowup(c.id, d.text, 'ta’qib 1/2').catch(err => console.error('followup', err)); continue; }
        run(`INSERT OR IGNORE INTO tasks(kind,conversation_id,customer_id,user_id,title,body,due_at,created_by,created_at,dedup_key) VALUES('followup',?,?,?,?,?,?,?,?,?)`,
          c.id, c.customer_id, c.owner_user_id, `Jim qolgan mijoz: ${c.display_name || c.handle || 'mijoz'} (1/2)`,
          (sellerLast ? 'Suhbatni siz olib boryapsiz (oxirgi xabar sizdan), shuning uchun AI mijozga o‘zi yozmadi.\n' : '') +
            (d.ok && d.text ? `AI taklif qilgan xabar: «${clip(d.text, 400)}»` : 'Mijoz javob bermayapti — qisqa aniqlovchi savol bilan yozing.'),
          t, 'Muloqot agenti', t, `fu1:${c.id}:${lastOut}`);
      } else if (c.followup_count === 1 && silentH >= s.followup_second_days * 24) {
        run('UPDATE conversations SET followup_count=2 WHERE id=?', c.id);
        run(`INSERT OR IGNORE INTO tasks(kind,conversation_id,customer_id,user_id,title,body,due_at,created_by,created_at,dedup_key) VALUES('followup',?,?,?,?,?,?,?,?,?)`,
          c.id, c.customer_id, c.owner_user_id, `Jim qolgan mijoz: ${c.display_name || c.handle || 'mijoz'} (2/2)`,
          'Oxirgi urinish. Kanal oynasi yopiq bo‘lsa — mijoz ruxsat bergan boshqa kanal (telefon). Jim qolish «raqobatchiga ketdi» degani emas.', t, 'Muloqot agenti', t, `fu2:${c.id}`);
      }
    }
  } finally { fuBusy = false; }
}
