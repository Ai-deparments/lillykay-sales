import { one, all } from '../db.js';
import { local, clip, money } from '../util.js';
import { runAgent } from '../ai/index.js';
import { searchProducts } from '../services/catalog.js';
import { getSettings } from '../services/settings.js';
import { audit } from '../core/audit.js';

/*
  Boshliq — sotuvchi rahbarga (SUN-HIGHTECH akkaunti yoki bot) erkin yozganda javobni tushunadi va amal qiladi:
  qabul qildi, bajardi, rad etdi (boshqasiga), mijoz haqida so‘radi, tovar haqida so‘radi; muhim narsani profiliga izoh qiladi.
  Chiqish: { ok, reply } — reply rahbar nomidan sotuvchiga ketadi (bo‘sh — javob shart emas).
*/

const SYSTEM = `Siz SUN-HIGHTECH kompaniyasining rahbariyati nomidan sotuvchilar bilan Telegram’da yozishasiz. Sotuvchilarga ishni tizim beradi; siz sotuvchining javobini tushunib, kerakli amalni vosita bilan bajarasiz va qisqa javob yozasiz.

Qanday yozasiz:
- Jonli rahbardek: 1–2 qisqa gap, oddiy so‘zlar, o‘zbekcha lotinda (sotuvchi ruscha yozsa — ruscha). «Siz» deb murojaat qiling. Emoji, ro‘yxat, markdown, qavs ichidagi izoh yo‘q.
- Talabchan, lekin hurmat bilan. Bahona qilsa — tushunganingizni bildiring va ishni boshqasiga bering, nasihat qilmang, qo‘pol bo‘lmang.
- Ismingiz — Salohiddin aka, SUN-HIGHTECH rahbari. Sotuvchi «kimsiz», «kim yozyapti» desa shunday tanishtiring.
- O‘zingizni bot yoki AI deb e’lon qilmang. Lekin sotuvchi to‘g‘ridan-to‘g‘ri «siz botmisiz / AI misiz / kim yozyapti» deb so‘rasa — yolg‘on gapirmang: xabarlar SUN-HIGHTECH tizimi orqali rahbariyat nomidan yuborilishini ayting.
- Bilmagan narsani o‘ylab topmang: mijoz haqida — faqat customer_info dan, narx va qoldiq — faqat search_catalog dan.

Amallar — har amal uchun vositani chaqiring (matnda «qabul qildim» deyish yetmaydi):
- task_seen — sotuvchi ishni ko‘rdi: «ok», «xop», «ko‘rdim», «hozir», «5 daqiqada qilaman», «tashladim», «gaplashdim», «bo‘ldi». Rahbar qoidasi: ko‘rdi — demak oldi va qiladi, ish yopiladi.
- decline_task — qila olmaydi yoki boshqasiga berishni so‘radi: «vaqtim yo‘q», «bandman», «boshqasiga ayting», «men emas», «bugun ishda emasman». reason — uning so‘zi. Ish darhol boshqa sotuvchiga o‘tadi; reytingiga ta’sir qilishini aytish shart emas.
- customer_info — sotuvchi mijoz haqida so‘rasa (kim, nima so‘radi, raqami, qaysi tovar, qaysi kanal).
- search_catalog — tovar narxi, qoldig‘i, qaysi filialda borligi so‘ralsa.
- add_note — sotuvchi haqida rahbar bilishi kerak bo‘lgan muhim narsa bo‘lsa: bahona, shikoyat, va’da, mijoz bilan muammo, intizom. Oddiy holatga yozmang. Uchinchi shaxsda, qisqa: «Mijoz raqamini topa olmayotganini aytdi».
Qaysi ish haqida gapirayotgani noaniq bo‘lsa — «Javob berilgan xabar» yoki eng oxirgi ochiq ishni oling; umuman tushunarsiz bo‘lsa — qisqa so‘rang.
Ishi bo‘lmagan sotuvchi rad etsa yoki «ok» desa — amal shart emas, qisqa javob yetarli.
Salomlashish, rahmat va shunga o‘xshash xabarga — juda qisqa javob. Javob umuman shart bo‘lmasa — faqat [JAVOB_SHART_EMAS].`;

const TID = { task_id: { type: 'integer', description: 'Ochiq ishning raqami (#...)' } };
const TOOLS = [
  { name: 'task_seen', description: 'Sotuvchi ishni ko‘rdi (oldi yoki qildi) — ish yopiladi.', input_schema: { type: 'object', properties: TID, required: ['task_id'], additionalProperties: false } },
  { name: 'decline_task', description: 'Sotuvchi qila olmaydi yoki boshqasiga berishni so‘radi — ish darhol boshqa sotuvchiga o‘tadi.',
    input_schema: { type: 'object', properties: { ...TID, reason: { type: 'string', description: 'Sotuvchining so‘zi (bahonasi)' } }, required: ['task_id', 'reason'], additionalProperties: false } },
  { name: 'customer_info', description: 'Ishdagi mijoz: ismi, @username, kanal, telefoni, so‘nggi xabarlari.', input_schema: { type: 'object', properties: TID, required: ['task_id'], additionalProperties: false } },
  { name: 'search_catalog', description: 'SUN-HIGHTECH katalogi: tovar narxi (BILLZ) va filiallar bo‘yicha qoldiq.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } },
  { name: 'add_note', description: 'Sotuvchi profiliga rahbar uchun izoh.', input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } }
];

const CH = { tg: 'Telegram', ig: 'Instagram', demo: 'Demo' };
const ST = { offered: 'javob kutilmoqda', accepted: 'qabul qilgan, bajarilmoqda' };
const ago = t => t ? `${Math.max(1, Math.round((Date.now() - t) / 60e3))} daqiqa oldin` : '';
const convOf = a => one(`SELECT c.*, ac.channel FROM conversations c JOIN accounts ac ON ac.id=c.account_id WHERE c.id=?`, a.conversation_id);

function context({ user, text, open, lost, recent, replyTo }) {
  const s = getSettings(), l = local();
  const line = a => { const c = convOf(a); return `#${a.id} [${a.kind}${a.urgent ? ', shoshilinch' : ''}; ${ST[a.status] || a.status}; berilgan ${ago(a.offered_at)}] ${a.body || a.title} — mijoz: ${c?.handle || c?.display_name || '?'} (${CH[c?.channel] || ''})`; };
  return [
    `Hozir: ${l.date} ${l.hm} (Toshkent). Ish vaqti ${s.work_from}–${s.work_to}. Qoida: sotuvchi ishni ko‘rib javob yozsa yoki mijozga yozsa — ish bajarilgan hisoblanadi; ${s.assign_done_minutes} daqiqada (shoshilinchda ${s.assign_urgent_minutes}) hech qanday javob bo‘lmasa — boshqa sotuvchiga o‘tadi.`,
    `Sotuvchi: ${user.name}.`,
    open.length ? 'Uning ochiq ishlari:\n' + open.map(line).join('\n') : 'Uning ochiq ishi yo‘q.',
    ...(lost.length ? ['Yaqinda undan boshqasiga o‘tgan ishlar (javob bermagan, kechikkan yoki rad etgan):\n' + lost.map(line).join('\n')] : []),
    ...(replyTo ? [`Sotuvchi #${replyTo} ish xabariga javob qilib yozdi.`] : []),
    '',
    'Oxirgi yozishma (siz ↔ sotuvchi):',
    ...recent.slice(0, -1).map(m => `[${local(m.created_at).hm}] ${m.dir === 'out' ? 'Siz' : 'Sotuvchi'}: ${clip(m.text, 300)}`),
    '',
    `Sotuvchining yangi xabari: «${clip(text, 800)}»`,
    'Kerakli amalni bajaring va sotuvchiga javob yozing.'
  ].join('\n');
}

/* runner — sinov uchun (standart: runAgent) */
export async function bossReply({ user, text, open = [], lost = [], recent = [], replyTo = null }, runner = runAgent) {
  const d = await import('../services/dispatch.js');
  const mine = id => open.find(a => a.id === Number(id));
  const handlers = {
    task_seen: ({ task_id }) => mine(task_id) ? { ok: true, result: d.acceptAssignment(task_id, user, 'korildi') } : { ok: false, error: 'Bunday ochiq ish yo‘q' },
    decline_task: async ({ task_id, reason }) => {
      if (!mine(task_id)) return { ok: false, error: 'Bunday ochiq ish yo‘q' };
      const r = await d.declineAssignment(task_id, user, reason);
      return r ? { ok: true, note: 'Ish boshqa sotuvchiga berildi.' } : { ok: false, error: 'Ish holati o‘zgargan' };
    },
    customer_info: ({ task_id }) => {
      const a = mine(task_id) || lost.find(x => x.id === Number(task_id));
      if (!a) return { ok: false, error: 'Bunday ish yo‘q' };
      const c = convOf(a);
      const last = all(`SELECT author, text FROM messages WHERE conversation_id=? ORDER BY id DESC LIMIT 6`, c.id).reverse();
      return { name: c.display_name, username: c.handle, channel: CH[c.channel], phone: c.phone || null, asked: c.asked || null,
        last_messages: last.map(m => `${m.author === 'client' ? 'Mijoz' : 'Do‘kon'}: ${clip(m.text, 200)}`) };
    },
    search_catalog: ({ query }) => {
      const r = searchProducts(query, 5);
      return r.length ? r.map(p => ({ name: p.name, price: p.billz?.price != null ? money(p.billz.price) : null, stock: p.billz?.stock_by_branch || p.billz?.stock_total || null })) : { found: 0 };
    },
    add_note: ({ text: t }) => {
      d.note(user.id, 'ai', t, { by: 'Boshliq AI' });
      audit('ai', 'Boshliq AI', `Sotuvchi profiliga izoh: ${user.name}`, { data: clip(String(t), 300) });
      return { ok: true };
    }
  };
  const r = await runner({ system: SYSTEM, userContent: context({ user, text, open, lost, recent, replyTo }), tools: TOOLS, handlers, maxTurns: 5, maxTokens: 1500 });
  const reply = String(r.text || '').trim();
  return { ok: true, reply: /^\[JAVOB_SHART_EMAS\]$/.test(reply) ? '' : clip(reply, 600) };
}
