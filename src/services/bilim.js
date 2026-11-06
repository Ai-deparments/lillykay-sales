import { all, one, run } from '../db.js';
import { now, clip } from '../util.js';
import { audit } from '../core/audit.js';

/*
  Agentning o‘qitilgan bilimi (Sotuvchi agent usuli, Photobuy uchun):
   • answers — rahbar tasdiqlagan savol-javoblar (/tuzat, panel, hujjat). Umumiy bilimdan USTUN.
   • knowledge — do‘kon ma’lumoti bo‘limlari: kafolat, yetkazish, to‘lov, keshbek, manzil, ish vaqti.
  Narx va qoldiq bu yerda saqlanmaydi — ular doim BILLZ’dan jonli olinadi.
*/
const MAX_PROMPT = 14000;   // tizim ko‘rsatmasiga qo‘shiladigan bilim hajmi (belgilar)

export const activeAnswers = () => all(`SELECT * FROM answers WHERE active=1 ORDER BY id DESC`);
export const activeKnowledge = () => all(`SELECT * FROM knowledge WHERE active=1 ORDER BY id`);

export function saveAnswer({ id, question, answer, author = '', source = 'panel' }, who = author) {
  const q = clip(String(question || '').trim(), 600), a = clip(String(answer || '').trim(), 2500);
  if (!q || !a) throw Object.assign(new Error('savol_javob_kerak'), { status: 400, code: 'savol_javob_kerak' });
  if (id) {
    const r = run(`UPDATE answers SET question=?, answer=?, updated_at=? WHERE id=?`, q, a, now(), Number(id));
    if (!r.changes) throw Object.assign(new Error('not_found'), { status: 404, code: 'not_found' });
    audit('staff', who || 'Tizim', `Tasdiqlangan javob tahrirlandi #${id}`, { data: clip(q, 120) });
    return Number(id);
  }
  // Aynan shu savol allaqachon bo‘lsa — yangi javob eskisining o‘rnini oladi (ikki xil javob turmasin)
  const dup = one(`SELECT id FROM answers WHERE active=1 AND lower(trim(question))=lower(?)`, q);
  if (dup) run(`UPDATE answers SET active=0, updated_at=? WHERE id=?`, now(), dup.id);
  const newId = run(`INSERT INTO answers(question,answer,author,source,created_at) VALUES(?,?,?,?,?)`, q, a, clip(author, 80), source, now()).lastInsertRowid;
  audit('staff', who || 'Tizim', `Tasdiqlangan javob qo‘shildi #${newId}`, { data: clip(q, 120), result: dup ? `#${dup.id} o‘rniga` : 'yangi' });
  return newId;
}
export function setAnswerActive(id, on, who) {
  const r = run(`UPDATE answers SET active=?, updated_at=? WHERE id=?`, on ? 1 : 0, now(), Number(id));
  if (r.changes) audit('staff', who || 'Tizim', `Tasdiqlangan javob ${on ? 'yoqildi' : 'o‘chirildi'} #${id}`);
  return r.changes > 0;
}
export function saveKnowledge({ id, title, body, active = true }, who) {
  const t = clip(String(title || '').trim(), 120), b = clip(String(body || '').trim(), 6000);
  if (!t || !b) throw Object.assign(new Error('sarlavha_matn_kerak'), { status: 400, code: 'sarlavha_matn_kerak' });
  if (id) run(`UPDATE knowledge SET title=?, body=?, active=?, author=?, updated_at=? WHERE id=?`, t, b, active === false ? 0 : 1, clip(who, 80), now(), Number(id));
  else id = run(`INSERT INTO knowledge(title,body,author,updated_at) VALUES(?,?,?,?)`, t, b, clip(who, 80), now()).lastInsertRowid;
  audit('staff', who || 'Tizim', `Do‘kon ma’lumoti saqlandi: ${t}`);
  return Number(id);
}

/* Tizim ko‘rsatmasiga qo‘shiladigan blok: avval do‘kon ma’lumoti, keyin tasdiqlangan javoblar (yangisi oldin).
   Hajm chegarasidan oshsa — eng eski javoblar tushib qoladi (hammasi panelda saqlanadi). */
/* «[Tekshiring: …]» qatorlari — rahbar uchun eslatma, agentga berilmaydi */
export const forAgent = body => String(body || '').split('\n').filter(l => !/^\s*\[tekshiring/i.test(l)).join('\n').trim();
export function knowledgePrompt() {
  const parts = [];
  const kn = activeKnowledge();
  if (kn.length) parts.push('## Do‘kon ma’lumoti (rahbar tasdiqlagan)', ...kn.map(k => `### ${k.title}\n${forAgent(k.body)}`));
  const ans = activeAnswers();
  if (ans.length) {
    parts.push('', '## Tasdiqlangan javoblar',
      'Mijoz shu savolni yoki mazmunan o‘xshashini bersa — AYNAN shu javob mazmunida javob bering (so‘zma-so‘z shart emas). Bu javoblar umumiy bilimingizdan USTUN. Lekin narx va qoldiqni baribir faqat search_catalog (BILLZ) dan ayting — javobdagi raqam eskirgan bo‘lishi mumkin.');
    let size = parts.join('\n').length;
    for (const a of ans) {
      const block = `### #${a.id}\nSavol: ${a.question}\nJavob: ${a.answer}`;
      if (size + block.length > MAX_PROMPT) break;
      parts.push(block); size += block.length + 1;
    }
  }
  return parts.join('\n');
}
