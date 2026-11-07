import { db, one, all, run, tx, kvGet, kvSet } from '../db.js';
import { now, inWindow, clip, jparse } from '../util.js';
import { getSettings, logChange } from './settings.js';
import { lowBalance } from './ai-usage.js';
import { audit } from '../core/audit.js';
import { config } from '../config.js';

/*
  Suhbatlar markazi (SOT 01, 03).

  Taymer qoidasi (TZ SOT 03):
  - pending_since — mijozning BIRINCHI javobsiz xabari vaqti. Ketma-ket xabarlar uni surmaydi.
  - ai_due_at — AI yuborishi mumkin bo‘lgan eng erta vaqt (pending_since + T). Faqat "avto" bosqichida ishlatiladi.
  - Sotuvchi javob bersa yoki «O‘zim olaman» bossa: yuborilmagan qoralamalar bekor, ai_due_at o‘chadi.
  - Yuborishdan oldin BEGIN IMMEDIATE ichida qayta tekshiriladi: bitta hodisaga bitta javob.
*/

const hooks = { draft: null, send: null, sendFile: null, typing: null, notify: null, onClient: null, onSellerReply: null };
export function setInboxHooks(h) { Object.assign(hooks, h); }

export const STAGES = ['Yangi murojaat', 'Ehtiyoj aniqlanmoqda', 'Taklif berildi', 'Qaror kutilmoqda', 'Buyurtma kelishildi', 'Xarid tasdiqlandi'];

export const account = id => one('SELECT * FROM accounts WHERE id=?', id);
export const conversation = id => one('SELECT * FROM conversations WHERE id=?', id);

export function isNight(ts = now(), s = getSettings()) { return !inWindow(ts, s.work_from, s.work_to); }

/* Samarali rejim: suhbat > akkaunt. Tunda (sozlama yoqilgan bo‘lsa) «kechiksa» → darhol.
   Akkauntda AI to‘xtatilgan bo‘lsa — suhbat sozlamasidan qat’i nazar «ochiq» (avtojavob yo‘q). */
export const aiOn = acct => acct.ai_enabled !== 0;
export function effective(conv, acct, ts = now(), s = getSettings()) {
  let mode = !aiOn(acct) ? 'ochiq' : conv.mode !== 'inherit' ? conv.mode : acct.mode;
  const night = isNight(ts, s);
  let delayMs = mode === 'doim' ? 0 : s.T_seconds * 1000;
  if (mode !== 'ochiq' && night && s.night_autoreply) delayMs = 0;
  return { mode, night, delayMs, rollout: acct.rollout, taken: Boolean(conv.taken_by), ai: aiOn(acct) };
}
export const channelOpen = (conv, acct, ts = now()) =>
  acct.channel === 'demo' || (Boolean(acct.can_reply) && acct.enabled && conv.window_until != null && ts < conv.window_until);

/* Eksportdan yuklangan arxiv suhbati (tgarx:…) mijoz qayta yozganda jonli suhbatga aylanadi — eski tarix shu yerda qoladi.
   HTML eksportda Telegram ID yo‘q, shuning uchun faqat ism bo‘yicha: kamida ikki so‘z (ism + familiya) va arxivda yagona bo‘lsa.
   Bitta so‘zli ism («Aziz») — boshqa odam bo‘lishi mumkin, bog‘lanmaydi. */
const normName = n => String(n || '').replace(/\s+/g, ' ').trim();
export function adoptArchived(acct, { extChatId, extUserId, handle, name }) {
  const nm = normName(name);
  if (acct.channel !== 'tg' || nm.split(' ').length < 2 || nm.length < 5) return null;
  const cands = all(`SELECT id FROM conversations WHERE account_id=? AND archived=1 AND ext_chat_id LIKE 'tgarx:%' AND display_name=? LIMIT 2`, acct.id, nm);
  if (cands.length !== 1) return null;
  run(`UPDATE conversations SET ext_chat_id=?, ext_user_id=?, handle=COALESCE(?,handle), archived=0 WHERE id=?`,
    String(extChatId), extUserId == null ? null : String(extUserId), handle || null, cands[0].id);
  audit('sys', 'Suhbatlar', `Eski mijoz qayta yozdi: ${nm} — arxivdagi yozishma bog‘landi`, { object: `conv:${cands[0].id}`, data: acct.name });
  return one('SELECT * FROM conversations WHERE id=?', cands[0].id);
}

export function upsertConversation(acct, { extChatId, extUserId, handle, name, ts }) {
  let c = one('SELECT * FROM conversations WHERE account_id=? AND ext_chat_id=?', acct.id, String(extChatId));
  if (!c) c = adoptArchived(acct, { extChatId, extUserId, handle, name });
  if (c?.archived) { run('UPDATE conversations SET archived=0 WHERE id=?', c.id); c.archived = 0; }
  if (!c) {
    run(`INSERT INTO conversations(account_id,ext_chat_id,ext_user_id,handle,display_name,branch_id,owner_user_id,is_demo,created_at,source)
         VALUES(?,?,?,?,?,?,?,?,?,?)`, acct.id, String(extChatId), extUserId == null ? null : String(extUserId), handle || null, name || null,
      acct.branch_id, acct.owner_user_id, acct.is_demo, ts, null);
    c = one('SELECT * FROM conversations WHERE account_id=? AND ext_chat_id=?', acct.id, String(extChatId));
    audit('sys', 'Suhbatlar', `Yangi suhbat: ${name || handle || extChatId}`, { object: `conv:${c.id}`, data: acct.name });
  } else if ((name && name !== c.display_name) || (handle && handle !== c.handle)) {
    run('UPDATE conversations SET display_name=COALESCE(?,display_name), handle=COALESCE(?,handle) WHERE id=?', name || null, handle || null, c.id);
  }
  return c;
}

/* Mijoz xabari keldi */
export function ingestClient(acct, { extChatId, extUserId, handle, name, text, extMsgId, ts = now(), meta = null }) {
  const s = getSettings();
  const res = tx(() => {
    const c = upsertConversation(acct, { extChatId, extUserId, handle, name, ts });
    const ins = run('INSERT OR IGNORE INTO messages(conversation_id,author,text,ext_msg_id,meta,created_at) VALUES(?,?,?,?,?,?)',
      c.id, 'client', text || '', extMsgId == null ? null : String(extMsgId), meta && JSON.stringify(meta), ts);
    if (!ins.changes) return { c, dup: true };
    const fresh = conversation(c.id);
    const e = effective(fresh, acct, ts, s);
    const firstPending = fresh.pending_since == null;
    const pending = firstPending ? ts : fresh.pending_since;
    const due = !e.taken && e.mode !== 'ochiq' && e.rollout === 'avto' ? (fresh.ai_due_at ?? pending + e.delayMs) : null;
    run(`UPDATE conversations SET last_client_at=?, last_msg_at=?, window_until=?, pending_since=?, ai_due_at=?, followup_count=0,
           remind_at=CASE WHEN remind_note LIKE 'jim:%' THEN NULL ELSE remind_at END WHERE id=?`,
      ts, ts, ts + 24 * 3600e3, pending, due, c.id);
    return { c: conversation(c.id), dup: false, firstPending };
  });
  // Qoralamani yuborish vaqtidan sal oldin tayyorlaymiz. Ilgari darhol tayyorlanib, 60 soniya kutib turardi:
  // shu oraliqda mijoz yana yozsa (eskiradi) yoki sotuvchi javob bersa (bekor bo‘ladi) — tayyor javob va u uchun
  // to‘langan tokenlar behuda ketardi. O‘lchov: bir kunda tayyorlangan qoralamalarning 48 foizi shunday yo‘qolgan.
  if (!res.dup) { scheduleDraft(res.c.id, draftDelay(res.c)); hooks.onClient?.(res.c, text); }
  return res.c;
}

/* Javobdan keyin: javob ko‘rgan xabardan (seenMaxId) keyin mijoz yana yozgan bo‘lsa — o‘sha xabar javobsiz qolmaydi,
   undan yangi kutish boshlanadi. seenMaxId yo‘q (Telegram ilovasidan javob — update’lar tartib bilan keladi) — hammasi javob olgan. */
function nextPending(convId, seenMaxId, prevBatch) {
  if (seenMaxId == null) return null;
  const t = one(`SELECT min(created_at) t FROM messages WHERE conversation_id=? AND author='client' AND id>?
    AND json_extract(COALESCE(meta,'{}'),'$.deleted_at') IS NULL`, convId, seenMaxId)?.t;
  return t == null ? null : Math.max(t, (prevBatch || 0) + 1); // qoralama partiyasi kaliti takrorlanmasin
}
function armAfterReply(convId, pending) {
  if (pending == null) { run('UPDATE conversations SET pending_since=NULL, ai_due_at=NULL WHERE id=?', convId); return false; }
  const c = conversation(convId), e = effective(c, account(c.account_id));
  run('UPDATE conversations SET pending_since=?, ai_due_at=? WHERE id=?', pending, !e.taken && e.mode !== 'ochiq' && e.rollout === 'avto' ? pending + e.delayMs : null, convId);
  return true;
}
const lastMsgId = convId => one('SELECT max(id) m FROM messages WHERE conversation_id=?', convId).m;

/* Suhbatga javob berilganda shu suhbatning «javob kerak» vazifalari o‘zi yopiladi. Ilgari faqat qo‘lda yopilardi — 2026-10-08 da
   635 ta ochiq vazifa to‘planib, yangilari ro‘yxatga (200 ta) sig‘may qolgan edi.
   Sotuvchi javobi — uzatilgan, AI yoza olmagan / yubora olmagan, ertalab davom ettirish va ta’qib vazifalarini yopadi;
   AI javobi — faqat AI xatolari vazifalarini (uzatilgan ishni AI javobi hal qilmaydi: rasm, to‘lov va h.k. sotuvchida). */
const SELLER_CLOSES = ['handoff', 'draft_failed', 'send_failed', 'send_unknown', 'followup', 'morning'];
const AI_CLOSES = ['draft_failed', 'send_failed', 'send_unknown'];
export function closeTasksOnReply(convId, who, userId = null, ts = now()) {
  const kinds = who === 'ai' ? AI_CLOSES : SELLER_CLOSES;
  return run(`UPDATE tasks SET status='done', result=?, done_at=?, user_id=COALESCE(user_id,?) WHERE conversation_id=? AND status='open' AND created_at<=?
      AND kind IN (${kinds.map(() => '?').join(',')})`,
    who === 'ai' ? 'AI mijozga javob berdi — avtomatik yopildi' : 'Sotuvchi mijozga javob berdi — avtomatik yopildi', ts, userId, convId, ts, ...kinds).changes;
}
/* Eski to‘planib qolganlar: vazifadan keyin suhbatga javob berilgan bo‘lsa — yopiladi (ishga tushganda va har kecha) */
export function closeAnsweredTasks(ts = now()) {
  const q = (kinds, after) => `kind IN (${kinds.map(k => `'${k}'`).join(',')}) AND EXISTS (SELECT 1 FROM conversations c WHERE c.id=tasks.conversation_id AND ${after} > tasks.created_at)`;
  return run(`UPDATE tasks SET status='done', result='Suhbatga javob berilgan — avtomatik yopildi', done_at=? WHERE status='open' AND conversation_id IS NOT NULL
      AND ((${q(SELLER_CLOSES, 'COALESCE(c.last_seller_at,0)')}) OR (${q(AI_CLOSES, 'MAX(COALESCE(c.last_seller_at,0), COALESCE(c.last_ai_at,0))')}))`, ts).changes;
}

/* Sotuvchi javobi (paneldan yoki Telegram ilovasidan to‘g‘ridan-to‘g‘ri) — kutilayotgan AI javobini bekor qiladi */
export function markSellerReply(convId, { text, userId = null, extMsgId = null, ts = now(), via = 'panel', seenMaxId = null, meta = null }) {
  let again = false, inserted = false;
  const n = tx(() => {
    const ins = run('INSERT OR IGNORE INTO messages(conversation_id,author,user_id,text,ext_msg_id,meta,created_at) VALUES(?,?,?,?,?,?,?)',
      convId, 'seller', userId, text || '', extMsgId == null ? null : String(extMsgId), JSON.stringify({ via, ...(meta || {}) }), ts);
    if (!ins.changes) return 0;
    inserted = true;
    const cancelled = cancelOpenDrafts(convId, via === 'telegram' ? 'Sotuvchi Telegram’da javob yozdi' : 'Sotuvchi javob yozdi', userId ? `user:${userId}` : 'seller');
    const prev = conversation(convId).pending_since;
    run('UPDATE conversations SET last_seller_at=?, last_msg_at=?, owner_user_id=COALESCE(owner_user_id,?), archived=0 WHERE id=?', ts, ts, userId, convId);
    again = armAfterReply(convId, nextPending(convId, seenMaxId, prev));
    closeTasksOnReply(convId, 'seller', userId, ts);
    return cancelled;
  });
  if (again) scheduleDraft(convId);
  if (inserted) try { hooks.onSellerReply?.(convId, { userId, via }); } catch (e) { console.error('onSellerReply', e); }
  return n;
}

/* Platformaning o‘zi yuborgan xabar (Telegram Business «Uzoqdaman»/«Salomlashuv», Meta Business Suite avtojavobi) — sotuvchi javobi EMAS:
   kutish va AI qoralamasi o‘zgarmaydi, faqat tarixda ko‘rinadi */
export function recordAutoMessage(convId, { text, extMsgId, ts = now(), via = 'telegram', tag = 'Telegram avtojavobi' }) {
  run('INSERT OR IGNORE INTO messages(conversation_id,author,text,ext_msg_id,meta,created_at) VALUES(?,?,?,?,?,?)',
    convId, 'system', text || '', extMsgId == null ? null : String(extMsgId), JSON.stringify({ via, offline: true, tag }), ts);
}

/* Mijoz o‘z xabarini o‘chirdi: kutilayotgan hamma savol o‘chirilgan bo‘lsa — AI unga javob yozmaydi */
export function clientDeleted(convId) {
  const c = conversation(convId);
  if (!c?.pending_since) return;
  const left = one(`SELECT count(*) n FROM messages WHERE conversation_id=? AND author='client' AND created_at>=?
    AND json_extract(COALESCE(meta,'{}'),'$.deleted_at') IS NULL`, convId, c.pending_since).n;
  if (left) return;
  tx(() => {
    cancelOpenDrafts(convId, 'Mijoz savolini o‘chirdi', 'client');
    run('UPDATE conversations SET pending_since=NULL, ai_due_at=NULL WHERE id=?', convId);
  });
}

export function cancelOpenDrafts(convId, reason, who) {
  const r = run(`UPDATE drafts SET status='cancelled', reason=?, decided_at=?, decided_by=? WHERE conversation_id=? AND status IN ('preparing','ready')`,
    reason, now(), who, convId);
  if (r.changes) audit('ai', 'Muloqot agenti', `Qoralama bekor qilindi — ${reason}`, { object: `conv:${convId}`, result: 'Yuborilmadi' });
  return r.changes;
}

export function takeOver(convId, user) {
  tx(() => {
    run('UPDATE conversations SET taken_by=?, taken_at=?, ai_due_at=NULL, owner_user_id=COALESCE(owner_user_id,?) WHERE id=?', user.id, now(), user.id, convId);
    cancelOpenDrafts(convId, `«O‘zim olaman» — ${user.name}`, `user:${user.id}`);
  });
  audit('staff', user.name, 'Suhbatni o‘z boshqaruviga oldi', { object: `conv:${convId}`, result: 'AI to‘xtadi' });
}
export function release(convId, user) {
  const s = getSettings();
  tx(() => {
    run('UPDATE conversations SET taken_by=NULL, taken_at=NULL WHERE id=?', convId);
    const c = conversation(convId), a = account(c.account_id), e = effective(c, a, now(), s);
    if (c.pending_since && e.rollout === 'avto' && e.mode !== 'ochiq') run('UPDATE conversations SET ai_due_at=? WHERE id=?', Math.max(now() + 5000, c.pending_since + e.delayMs), convId);
  });
  audit('staff', user.name, 'Suhbatni AI’ga qaytardi', { object: `conv:${convId}` });
  if (conversation(convId).pending_since) scheduleDraft(convId, 0);
}

export function setConvMode(convId, mode, user) {
  if (!['inherit', 'doim', 'kechiksa', 'ochiq'].includes(mode)) throw new Error('bad_mode');
  const c = conversation(convId);
  tx(() => {
    run('UPDATE conversations SET mode=? WHERE id=?', mode, convId);
    const fresh = conversation(convId), a = account(fresh.account_id), e = effective(fresh, a);
    const recent = fresh.ai_due_at != null || fresh.pending_since >= now() - getSettings().small_max_wait_minutes * 60e3;
    if (e.mode === 'ochiq' || e.rollout !== 'avto' || fresh.taken_by) run('UPDATE conversations SET ai_due_at=NULL WHERE id=?', convId);
    else if (fresh.pending_since && recent) run('UPDATE conversations SET ai_due_at=? WHERE id=?', fresh.pending_since + e.delayMs, convId);
    if (e.mode === 'ochiq') cancelOpenDrafts(convId, 'Suhbatda avtojavob o‘chirildi', `user:${user.id}`);
  });
  const label = { inherit: 'akkaunt bo‘yicha', doim: 'doim', kechiksa: 'kechiksa', ochiq: 'o‘chiq' };
  logChange(user.name, `${c.display_name || c.handle || 'Suhbat #' + convId}: ${label[c.mode]} → ${label[mode]}`);
  audit('staff', user.name, `Avtojavob (suhbat): ${label[c.mode]} → ${label[mode]}`, { object: `conv:${convId}`, result: 'Qo‘llandi' });
}

/* Akkaunt rejimi/bosqichi o‘zgarsa — kutilayotgan taymerlar qayta hisoblanadi.
   Faqat yaqinda kelgan savollar (kechikish chegarasidan yangi) AI’ga beriladi: «kuzatish»dan «avto»ga o‘tganda
   soatlab oldingi javobsiz suhbatlarga birdaniga AI javoblari ketmasin — ular sotuvchida qoladi. */
export function setAccount(acctId, patch, user) {
  const a = account(acctId);
  if (!a) throw new Error('not_found');
  const mode = patch.mode ?? a.mode, rollout = patch.rollout ?? a.rollout;
  const ai = patch.ai_enabled == null ? a.ai_enabled : patch.ai_enabled ? 1 : 0;
  // Balans zaxiradan past bo‘lsa AI ni qayta yoqib bo‘lmaydi — avval Google AI Studio’da to‘ldirish kerak
  if (ai && !a.ai_enabled) {
    const left = lowBalance();
    if (left != null) throw Object.assign(new Error('low_balance'), { status: 400, code: 'low_balance', left });
  }
  if (!['doim', 'kechiksa', 'ochiq'].includes(mode) || !['kuzatish', 'tasdiq', 'avto'].includes(rollout)) throw new Error('bad_value');
  const redraft = [];
  tx(() => {
    run('UPDATE accounts SET mode=?, rollout=?, ai_enabled=?, branch_id=COALESCE(?,branch_id), owner_user_id=COALESCE(?,owner_user_id) WHERE id=?',
      mode, rollout, ai, patch.branch_id ?? null, patch.owner_user_id ?? null, acctId);
    const s = getSettings(), acct = account(acctId), fresh = now() - s.small_max_wait_minutes * 60e3;
    for (const c of all('SELECT * FROM conversations WHERE account_id=? AND pending_since IS NOT NULL', acctId)) {
      const e = effective(c, acct, now(), s);
      const arm = !e.taken && e.mode !== 'ochiq' && e.rollout === 'avto' && (c.ai_due_at != null || c.pending_since >= fresh);
      run('UPDATE conversations SET ai_due_at=? WHERE id=?', arm ? c.pending_since + e.delayMs : null, c.id);
      // AI qayta yoqildi: yaqinda kelgan javobsiz savollarga qoralama tayyorlanadi (eski suhbatlar sotuvchida qoladi)
      if (ai && !a.ai_enabled && !c.taken_by && c.pending_since >= fresh) redraft.push(c.id);
    }
    if (!ai && a.ai_enabled) {
      for (const { conversation_id } of all(`SELECT DISTINCT d.conversation_id FROM drafts d JOIN conversations c ON c.id=d.conversation_id
          WHERE c.account_id=? AND d.status IN ('preparing','ready')`, acctId)) cancelOpenDrafts(conversation_id, 'AI agent to‘xtatildi', `user:${user.id}`);
    }
  });
  redraft.forEach((id, i) => scheduleDraft(id, 1000 + i * 3000));
  const L = { doim: 'Doim', kechiksa: 'Kechiksa', ochiq: 'O‘chiq', kuzatish: 'Kuzatish', tasdiq: 'Tasdiq bilan', avto: 'Avtomatik' };
  if (mode !== a.mode) logChange(user.name, `${a.name}: ${L[a.mode]} → ${L[mode]}`);
  if (rollout !== a.rollout) logChange(user.name, `${a.name}: bosqich ${L[a.rollout]} → ${L[rollout]}`);
  if (ai !== a.ai_enabled) logChange(user.name, `${a.name}: AI agent ${ai ? 'yoqildi' : 'to‘xtatildi'}`);
  audit('staff', user.name, `Akkaunt sozlamasi: ${a.name}`, { data: { mode, rollout, ai_enabled: ai }, result: 'Qo‘llandi' });
}

/* ---------- qoralama (AI) ---------- */
const timers = new Map();
const inflight = new Set();   // hozir tayyorlanayotgan qoralamalar (id) — qayta ishga tushgandan keyin «preparing»da qolganlarini ajratish uchun
let sendingNow = 0, closing = false;
const DEBOUNCE = Number(process.env.DRAFT_DEBOUNCE_MS || 25000);   // mijoz ketma-ket yozsa, bitta javob tayyorlansin (8 s da kunlik qoralamalarning ~20% eskirardi)
/* Qoralama kutish vaqti (T) TUGAGACH tayyorlanadi va tayyor bo‘lishi bilan ketadi (lite modelda 3–8 soniya).
   Ilgari 35 s oldin tayyorlanardi: shu oraliqda sotuvchi yozib qo‘ysa qoralama bekor — 7 kunda 72 ta AI javobi behuda ketgan. */
const GEN_LEAD_MS = Number(process.env.DRAFT_LEAD_MS || 0);
const STALE_DRAFT_MS = 15 * 60e3; // bundan eski tayyor qoralama avtomatik yuborilmaydi — yangidan tayyorlanadi
/* Qachon tayyorlash: avtomatik yuboriladigan bo‘lsa — yuborish vaqtidan GEN_LEAD_MS oldin;
   tasdiq yoki kuzatish rejimida sotuvchi kutadi, shuning uchun odatdagi kutish. */
const draftDelay = c => {
  if (!c?.ai_due_at) return DEBOUNCE;
  return Math.max(DEBOUNCE, c.ai_due_at - now() - GEN_LEAD_MS);
};

export function scheduleDraft(convId, delay = DEBOUNCE) {
  if (closing) return;
  clearTimeout(timers.get(convId));
  timers.set(convId, setTimeout(() => { timers.delete(convId); makeDraft(convId).catch(e => console.error('draft', e)); }, delay));
}

const limitRetries = new Map();
/* Vaqtinchalik AI uzilishi (limit, Google bandligi, tarmoq) — ayb suhbatda emas: AI tiklanganda qayta urinib ko‘riladi */
const TEMP_FAIL = /^Gemini limiti|^Gemini kunlik limiti|^AI xatosi: (http_(429|5\d\d)|network)/;
const lastTempFail = convId => one(`SELECT reason, decided_at FROM drafts WHERE conversation_id=? AND status='failed' ORDER BY id DESC LIMIT 1`, convId);

/* AI ishga qaytganda (ai_ok_at yangilanganda) javobsiz qolgan yangi suhbatlarni qayta navbatga qo‘yadi.
   Faqat so‘nggi 6 soat ichidagilar: eski suhbatga AI endi o‘zi yozmaydi — ularga sotuvchi javob beradi (vazifa allaqachon bor). */
export function retryAfterOutage() {
  const okAt = Number(kvGet('ai_ok_at') || 0);
  if (!okAt) return 0;
  const rows = all(`SELECT c.id, c.pending_since FROM conversations c WHERE c.pending_since IS NOT NULL AND c.pending_since > ? AND c.taken_by IS NULL
      AND c.archived=0 AND c.ai_due_at IS NULL AND NOT EXISTS (SELECT 1 FROM drafts d WHERE d.conversation_id=c.id AND d.batch=c.pending_since
        AND d.status IN ('ready','sent','sending','preparing','unknown','cancelled'))`, now() - 6 * 3600e3);
  const pick = rows.filter(c => { const f = lastTempFail(c.id); return f && TEMP_FAIL.test(f.reason || '') && (f.decided_at || 0) < okAt; }).slice(0, 5);
  pick.forEach((c, i) => scheduleDraft(c.id, 3000 + i * 20000));
  if (pick.length) audit('ai', 'Muloqot agenti', `AI tiklandi — ${pick.length} ta javobsiz suhbat qayta navbatga qo‘yildi`);
  return pick.length;
}

/* Bitta suhbat uchun bir vaqtda faqat BITTA tayyorlash. 2026-10-09: Instagram’ga shablon salom ~3 s ketadi; shu orada dvigatel
   har soniya «qoralama yo‘q» deb yana tayyorlashni boshlagan va mijozga bir xil salom 4 marta borgan. */
const drafting = new Set();
async function makeDraft(convId) {
  if (drafting.has(convId)) return;          // tayyorlanyapti — tugagach yangi xabar bo‘lsa o‘zi qayta navbatga qo‘yadi
  drafting.add(convId);
  try { await makeDraftOnce(convId); } finally { drafting.delete(convId); }
}
async function makeDraftOnce(convId) {
  const c = conversation(convId);
  if (!c || !c.pending_since || c.taken_by) return;
  // Javob yuborilayotgan payt: yuborish tugagach kutish qayta hisoblanadi — hozir qoralama yozish behuda (AI xarajati)
  if (one(`SELECT 1 FROM drafts WHERE conversation_id=? AND status='sending'`, convId)) { scheduleDraft(convId, 1000); return; }
  const a = account(c.account_id);
  if (!aiOn(a)) return; // AI bu kanalda to‘xtatilgan — qoralama ham yozilmaydi (xarajat yo‘q)
  const batch = c.pending_since;

  // Tezkor shablon javoblar («salom» → shablon salom, «rahmat/ok» → javobsiz) — STANDART O‘CHIQ (rahbar so‘rovi, 2026-10-09:
  // «mijoz nima yozsa AI javob bersin»). QUICK_REPLIES=1 bilan qayta yoqiladi. AI javob yozolmasa — fokus o‘zi tasdiqni aniqlaydi.
  try {
    const eff = effective(c, a);
    if (process.env.QUICK_REPLIES === '1' && eff.rollout === 'avto' && eff.mode !== 'ochiq' && !eff.taken) {
      const { quickAnswer } = await import('./tezjavob.js');
      const q = quickAnswer(c, batch);
      if (q) { await sendQuick(c, a, q, batch); return; }
    }
  } catch (e) { console.error('[tezjavob]', e); }

  const id = tx(() => {
    run(`UPDATE drafts SET status='superseded', decided_at=? WHERE conversation_id=? AND status IN ('preparing','ready') AND batch=?`, now(), convId, batch);
    return run('INSERT INTO drafts(conversation_id,batch,status,created_at,upto_msg_id) VALUES(?,?,?,?,?)', convId, batch, 'preparing', now(), lastMsgId(convId)).lastInsertRowid;
  });
  let out;
  inflight.add(id);
  // Mijoz kutib turmasin: AI o'ylayotganini Direct'da ham ko'rsin ("yozmoqda"). Meta uni ~10 s ushlaydi,
  // shuning uchun uzoq o'ylasa takrorlanadi; xato bo'lsa jim o'tiladi — javobga aloqasi yo'q.
  const typing = startTyping(a, c);
  try { out = await hooks.draft({ conv: c, acct: a }); }
  catch (e) { out = { ok: false, reason: String(e.message || e) }; }
  finally { inflight.delete(id); typing.stop(); }
  const cur = one('SELECT status FROM drafts WHERE id=?', id);
  if (!cur || cur.status !== 'preparing') return; // bu orada bekor qilingan yoki eskirgan
  const rkey = `${convId}:${batch}`;
  if (!out.ok) {
    run(`UPDATE drafts SET status='failed', reason=?, decided_at=? WHERE id=?`, out.reason, now(), id);
    // AI limiti (bepul tarif) — bir daqiqadan keyin qayta, 3 martagacha; sotuvchiga xabar faqat oxirida
    const tries = (limitRetries.get(rkey) || 0) + 1;
    if (/^Gemini limiti/.test(out.reason || '') && tries <= 3) {
      limitRetries.set(rkey, tries);
      audit('ai', 'Muloqot agenti', 'Qoralama kechiktirildi (AI limiti)', { object: `conv:${convId}`, result: `${tries}/3 — 1 daqiqadan keyin qayta` });
      scheduleDraft(convId, 60000);
      return;
    }
    limitRetries.delete(rkey);
    run('UPDATE conversations SET ai_due_at=NULL WHERE id=? AND pending_since=?', convId, batch);
    audit('ai', 'Muloqot agenti', 'Qoralama tayyorlanmadi', { object: `conv:${convId}`, result: out.reason });
    if (out.reason !== 'no_ai_key') hooks.notify?.('draft_failed', { conv: conversation(convId), reason: out.reason });
    if (out.bigOrder) hooks.notify?.('big_order', { conv: conversation(convId), order: out.bigOrder });
    return;
  }
  limitRetries.delete(rkey);
  const pics = (Array.isArray(out.photos) && out.photos.length ? out.photos : out.photo ? [out.photo] : []).map(Number).slice(0, 3);
  if (pics.length) run('UPDATE drafts SET photo_product_id=?, photo_ids=? WHERE id=?', pics[0], JSON.stringify(pics), id);
  kvSet('ai_ok_at', now());   // AI yana ishlayapti — vaqtincha uzilishda qolib ketgan suhbatlar qayta navbatga tushadi
  // Javoblar hisobi (panel: «bitta javob» narxi) — suhbat o‘chirilsa ham, eski qoralamalar tozalansa ham o‘zgarmaydi
  import('./ai-usage.js').then(m => m.recordReply(out.model)).catch(() => {});
  if (out.card) applyCard(convId, out.card, 'ai');
  if (out.reminder) setReminder(convId, out.reminder, 'ai');
  if (out.bigOrder) hooks.notify?.('big_order', { conv: conversation(convId), order: out.bigOrder });
  if (out.handoff) hooks.notify?.('handoff', { conv: conversation(convId), ...(typeof out.handoff === 'object' ? out.handoff : { reason: out.handoff }) });
  if (out.noReply) {
    tx(() => {
      run(`UPDATE drafts SET status='cancelled', reason=?, text=?, decided_at=?, decided_by='ai' WHERE id=?`, 'Javob shart emas (suhbat yakunlangan)', '', now(), id);
      run('UPDATE conversations SET pending_since=NULL, ai_due_at=NULL WHERE id=? AND pending_since=?', convId, batch);
    });
    audit('ai', 'Muloqot agenti', 'Javob shart emas — suhbat yakunlangan', { object: `conv:${convId}` });
    return;
  }
  run(`UPDATE drafts SET status='ready', text=?, sources=?, card=?, tools=?, model=? WHERE id=?`,
    out.text || '', JSON.stringify(out.sources || []), JSON.stringify(out.card || {}), JSON.stringify(out.toolLog || []), out.model || null, id);
  audit('ai', 'Muloqot agenti', `Qoralama tayyor${a.rollout === 'kuzatish' ? ' (kuzatish rejimi — yuborilmaydi)' : ''}`,
    { object: `conv:${convId}`, data: (out.sources || []).join(' · '), result: a.rollout === 'avto' ? 'Taymer kutmoqda' : 'Sotuvchi ko‘radi' });
  const fresh = conversation(convId);
  if (fresh.ai_due_at && fresh.ai_due_at <= now()) await attemptAutoSend(convId);
}

/* Tarixni tozalash (rahbar/admin): xabarlar va qoralamalar paneldan o‘chadi, suhbat, karta va mijoz qoladi.
   Mijozning Telegram/Instagram’idagi yozishmaga tegilmaydi. */
export function clearHistory(convId, user) {
  const c = conversation(convId);
  if (!c) return { ok: false, why: 'not_found' };
  clearTimeout(timers.get(convId)); timers.delete(convId);
  const n = tx(() => {
    const m = run('DELETE FROM messages WHERE conversation_id=?', convId).changes;
    run('DELETE FROM drafts WHERE conversation_id=?', convId);
    run(`UPDATE conversations SET pending_since=NULL, ai_due_at=NULL, last_client_at=NULL, last_seller_at=NULL, last_ai_at=NULL,
         followup_count=0, typing_until=NULL, remind_at=NULL WHERE id=?`, convId);
    return m;
  });
  audit('staff', user.name, 'Suhbat tarixi tozalandi', { object: `conv:${convId}`, result: `${n} ta xabar` });
  return { ok: true, messages: n };
}

/* Suhbatni butunlay o‘chirish (rahbar/admin). Unga bog‘liq topshiriqlar o‘chadi, vazifalar suhbatsiz qoladi (tarix uchun).
   Mijoz yana yozsa — yangi suhbat ochiladi. */
export function deleteConversation(convId, user) {
  const c = conversation(convId);
  if (!c) return { ok: false, why: 'not_found' };
  clearTimeout(timers.get(convId)); timers.delete(convId);
  tx(() => {
    run('DELETE FROM messages WHERE conversation_id=?', convId);
    run('DELETE FROM drafts WHERE conversation_id=?', convId);
    run('DELETE FROM assignment_events WHERE assignment_id IN (SELECT id FROM assignments WHERE conversation_id=?)', convId);
    run('DELETE FROM staff_notes WHERE assignment_id IN (SELECT id FROM assignments WHERE conversation_id=?)', convId);
    run('UPDATE staff_messages SET assignment_id=NULL WHERE assignment_id IN (SELECT id FROM assignments WHERE conversation_id=?)', convId);
    run('DELETE FROM assignments WHERE conversation_id=?', convId);
    run('UPDATE tasks SET conversation_id=NULL WHERE conversation_id=?', convId);
    run('DELETE FROM conversations WHERE id=?', convId);
  });
  audit('staff', user.name, 'Suhbat o‘chirildi', { object: `conv:${convId}`, result: String(c.display_name || c.handle || c.ext_chat_id || '') });
  import('./avatar.js').then(m => m.dropAvatar(convId)).catch(() => {});   // profil rasmi ham
  return { ok: true };
}

/* AI kartani to‘ldiradi; sotuvchi qo‘lda qo‘ygan qiziqish darajasini AI o‘zgartirmaydi */
export function applyCard(convId, card, by) {
  const c = conversation(convId);
  const f = {};
  for (const k of ['asked', 'budget', 'purpose', 'lang', 'next_step']) if (card[k]) f[k] = clip(card[k], 300);
  if (card.heat && ['sovuq', 'iliq', 'issiq'].includes(card.heat) && !(by === 'ai' && c.heat_by === 'staff')) { f.heat = card.heat; f.heat_why = clip(card.heat_why || '', 300); f.heat_by = by; }
  if (Number.isInteger(card.stage) && card.stage >= 0 && card.stage <= 4 && card.stage > c.stage) f.stage = card.stage; // «Xarid tasdiqlandi» faqat chek yoki xodim bilan
  if (card.source && !c.source) { f.source = card.source; f.source_note = clip(card.source_note || '', 200); }
  // Mijoz suhbatda bergan raqam (tasdiqlanmagan): sotuvchi uchun. BILLZ mijoziga avtomatik bog‘lanmaydi —
  // aks holda kimdir begona raqamni yozib, o‘sha odamning keshbekini bilib olishi mumkin edi.
  if (card.phone) { const ph = String(card.phone).replace(/[^0-9+]/g, ''); if (ph.replace(/\D/g, '').length >= 9) f.phone = ph.slice(0, 20); }
  if (card.name && !c.display_name) f.display_name = clip(card.name, 100);
  if (card.voice === 'ha' || card.voice === 'yoq') f.voice_pref = card.voice;
  const keys = Object.keys(f);
  if (keys.length) run(`UPDATE conversations SET ${keys.map(k => k + '=?').join(',')} WHERE id=?`, ...keys.map(k => f[k]), convId);
  // Telefon birinchi marta kelganda — lid Google jadvalga. Reklama izohidan kelgan mijoz shu yerda qayd etiladi.
  if (f.phone && !c.phone) {
    import('./jadval.js').then(m => m.sendLead(convId, {
      channel: c.channel, phone: f.phone,
      name: card.name || c.display_name || c.handle || '',
      region: card.region, object_type: card.object_type,
      budget: f.budget || c.budget, asked: f.asked || c.asked, purpose: f.purpose || c.purpose,
      heat: f.heat || c.heat
    })).catch(() => {});
  }
}

export function setReminder(convId, { at, note }, by) {
  if (!Number.isFinite(at) || at < now()) return;
  run('UPDATE conversations SET remind_at=?, remind_note=? WHERE id=?', at, clip(note || '', 200), convId);
  audit(by === 'ai' ? 'ai' : 'staff', by === 'ai' ? 'Muloqot agenti' : by, `Eslatma qo‘yildi: ${new Date(at).toISOString().slice(0, 16).replace('T', ' ')} UTC`, { object: `conv:${convId}`, data: note });
}

export function setTyping(convId, typing) {
  run('UPDATE conversations SET typing_until=? WHERE id=?', typing ? now() + 8000 : null, convId);
}

/* ---------- yuborish ---------- */
function claimDraft(convId, draftId, { requireDue, who }) {
  return tx(() => {
    const c = conversation(convId), a = account(c.account_id);
    const d = one('SELECT * FROM drafts WHERE id=? AND conversation_id=?', draftId, convId);
    if (!d || d.status !== 'ready') return { ok: false, why: 'Qoralama tayyor emas yoki bekor qilingan' };
    // Sotuvchi javobi (markSellerReply) pending_since’ni shu tranzaksiyada o‘chiradi — alohida vaqt solishtirish kerak emas:
    // Telegram vaqti soniyagacha yaxlitlanadi, panel esa millisekund — solishtirish yangi savolni «javob berilgan» deb o‘tkazib yuborardi.
    if (!c.pending_since || d.batch !== c.pending_since) return { ok: false, why: 'Mijoz savoliga allaqachon javob berilgan' };
    if (c.taken_by && who === 'auto') return { ok: false, why: 'Suhbat sotuvchida' };
    // Bir suhbatda bir vaqtda bitta javob: oldingisi yuborilayotgan bo‘lsa — kutiladi (tugagach yangi savol bo‘lsa, u alohida qayta ko‘riladi)
    if (one(`SELECT 1 FROM drafts WHERE conversation_id=? AND status='sending' AND id<>?`, convId, draftId)) return { ok: false, why: 'Oldingi javob yuborilmoqda', retry: true };
    if (who === 'auto' && c.typing_until && c.typing_until > now()) return { ok: false, why: 'Sotuvchi yozmoqda', retry: true };
    if (requireDue && (!c.ai_due_at || c.ai_due_at > now())) return { ok: false, why: 'Vaqti kelmagan', retry: true };
    if (!channelOpen(c, a)) return { ok: false, why: 'Kanal oynasi yopiq yoki javob huquqi yo‘q', closed: true };
    run(`UPDATE drafts SET status='sending', decided_at=?, decided_by=? WHERE id=? AND status='ready'`, now(), who, draftId);
    run('UPDATE conversations SET ai_due_at=NULL WHERE id=?', convId);
    return { ok: true, c, a, d };
  });
}

/* AI biriktirgan tovar rasmi: rasm javob matni bilan bitta xabarda ketadi (Telegram izohi 1024 belgi).
   Rasm olinmasa yoki matn uzun bo‘lsa — oddiy matn yuboriladi, javob kechikmaydi. */
/* Qoralamaga biriktirilgan tovar rasmlari (1–3). Rasm olinmasa — o‘tkazib yuboriladi, javob kechikmaydi */
async function draftPhotos(d, channel) {
  if (channel !== 'tg') return [];
  const ids = (jparse(d.photo_ids, null) || (d.photo_product_id ? [d.photo_product_id] : [])).slice(0, 3);
  const { productPhoto } = await import('./media.js');
  const out = [];
  for (const id of ids) {
    try {
      const p = await productPhoto(id);
      if (!p) continue;
      const row = one('SELECT image_url FROM products WHERE id=?', id);
      out.push({ ...p, media: { kind: 'photo', url: row?.image_url, uid: `product-${id}`, mime: 'image/jpeg' } });
    } catch (e) { console.error('[rasm] tovar rasmi olinmadi:', e.message); }
  }
  return out;
}

/* Photobuy sotuvchilari bitta uzun emas, bir nechta qisqa xabar yuboradi (yozishmalarda 45% holat).
   AI javobidagi bo‘sh qator bilan ajratilgan qismlar alohida xabar bo‘lib ketadi — ko‘pi bilan 3 ta. */
export function splitReply(text) {
  const parts = String(text || '').split(/\n[ \t]*\n/).map(x => x.trim()).filter(Boolean);
  if (!parts.length) return [String(text || '').trim()];
  return parts.length <= 3 ? parts : [parts[0], parts[1], parts.slice(2).join('\n')];
}
const partPause = () => Number(process.env.REPLY_PART_PAUSE_MS ?? 1200);   // odam yozayotgandek kichik tanaffus
const pause = ms => new Promise(r => setTimeout(r, ms));

/* Yuborilgan qismni DARHOL tarixga yozadi. Sababi: Instagram/Telegram aks-sadosi (is_echo) bir soniyada qaytadi,
   biz esa ilgari hamma qism ketgach yozardik — shu oraliqda aks-sado «sotuvchi javobi» bo‘lib tushardi va bitta AI javobi
   panelda «Instagram ilovasidan» + «AI» bo‘lib ikkiga bo‘linib ko‘rinardi. Kalit — ext_msg_id, shuning uchun qayta yozilmaydi. */
function markPart(convId, d, m, i, tag, userId) {
  run('INSERT OR IGNORE INTO messages(conversation_id,author,user_id,text,ext_msg_id,meta,created_at) VALUES(?,?,?,?,?,?,?)',
    convId, 'ai', userId, m.text, m.ext == null ? `ai-${d.id}${i ? '-' + i : ''}` : String(m.ext),
    JSON.stringify({ draft: d.id, tag, ...(i ? { part: i + 1 } : {}), ...(m.media ? { media: m.media } : {}) }), now() + i);
}

async function deliver(claim, { tag, userId = null }) {
  const { c, a, d } = claim;
  const photos = await draftPhotos(d, a.channel);
  // Qadamlar: 1 rasm va qisqa matn — rasm + izoh bitta xabarda; 2–3 rasm — albom (har rasm ostida tovar nomi), keyin matn qismlari
  const steps = photos.length === 1 && (d.text || '').length <= 1000 ? [{ photo: photos[0], text: d.text }]
    : [...(photos.length > 1 ? [{ album: photos }] : photos.length === 1 ? [{ photo: photos[0], text: '' }] : []), ...splitReply(d.text).map(t => ({ text: t }))];
  const sent = [];
  sendingNow++;
  try {
    for (let i = 0; i < steps.length; i++) {
      if (i) await pause(partPause());
      const st = steps[i];
      const was = sent.length;
      if (st.album) {
        const exts = await hooks.sendAlbum(a, c, st.album.map(p => ({ buf: p.buf, caption: p.name })));
        st.album.forEach((p, k) => sent.push({ text: `[rasm] ${p.name}`, ext: exts?.[k], media: p.media }));
      } else if (st.photo) {
        sent.push({ text: st.text || `[rasm] ${st.photo.name}`, ext: await hooks.sendPhoto(a, c, st.photo.buf, st.text), media: st.photo.media });
      } else sent.push({ text: st.text, ext: await hooks.send(a, c, st.text) });
      // Aks-sado qaytguncha ulgurish kerak — shuning uchun keyingi qismni kutmasdan yoziladi
      for (let k = was; k < sent.length; k++) { try { markPart(c.id, d, sent[k], k, tag, userId); } catch {} }
    }
  }
  catch (e) {
    const why = String(e.message || e);
    if (sent.length) {
      // Birinchi qism(lar) ketgan: yuborilgani tarixga yoziladi, qolgani haqida sotuvchiga xabar
      audit('ai', 'Muloqot agenti', 'Javob qisman yuborildi', { object: `conv:${c.id}`, result: `${sent.length} xabar ketdi · ${why}` });
      hooks.notify?.('send_failed', { conv: conversation(c.id), reason: `AI javobining bir qismi yuborildi, qolgani ketmadi: ${why}` });
      finishSent(c.id, d, sent, tag, userId);
      return { ok: true, partial: true };
    }
    // Tarmoq xatosi yoki javob kelmadi — xabar ketgan bo‘lishi mumkin: «noma’lum», sotuvchi tekshiradi (Telegram aks-sadosi kelsa o‘zi tasdiqlanadi)
    run(`UPDATE drafts SET status=?, reason=? WHERE id=?`, e.uncertain ? 'unknown' : 'failed', (e.uncertain ? 'Yuborilgani noma’lum: ' : 'Yuborishda xato: ') + why, d.id);
    run('UPDATE conversations SET ai_due_at=NULL WHERE id=?', c.id);
    audit('ai', 'Muloqot agenti', e.uncertain ? 'Javob holati noma’lum' : 'Javob yuborilmadi', { object: `conv:${c.id}`, result: why });
    hooks.notify?.(e.uncertain ? 'send_unknown' : 'send_failed', { conv: conversation(c.id), reason: why });
    return { ok: false, why: e.uncertain ? 'send_unknown' : 'send_failed' };
  } finally { sendingNow--; }
  await voiceReply(c, a, d).catch(() => {});
  finishSent(c.id, d, sent, tag, userId);
  return { ok: true };
}

/* «Yozmoqda»: Meta va Telegram belgisini 8 soniyada bir yangilab turadi (ikkalasi ham ~10 s da so'nadi).
   stop() — qoralama tayyor bo'lganda yoki xato bo'lganda. Kanal qo'llamasa yoki xato bersa — jim o'tiladi. */
function startTyping(a, c) {
  if (!hooks.typing) return { stop() {} };
  const tick = () => hooks.typing(a, c).catch(() => {});
  tick();
  const t = setInterval(tick, 8000);
  t.unref?.();
  return { stop() { clearInterval(t); } };
}

/* Ovozga ovoz bilan: mijoz ovozli xabar yuborgan bo'lsa, matndan keyin o'sha javob ovoz bo'lib ham ketadi.
   Matn baribir yuborilgan - ovoz qo'shimcha, xato bo'lsa jim o'tiladi (javob yo'qolmaydi). AI_VOICE bilan boshqariladi. */
async function voiceReply(c, a, d) {
  if (config.aiVoice === 'off' || !hooks.sendFile) return;
  const pref = conversation(c.id)?.voice_pref;
  if (pref === 'yoq') return;                                   // mijoz matnda so'radi — ovoz yubormaymiz
  if (config.aiVoice !== 'hamma' && pref !== 'ha' && !clientSentVoice(c.id)) return;
  const { speak } = await import('./ovoz.js');
  const ogg = a.channel === 'tg';
  const v = await speak(d.text, ogg ? 'ogg' : 'm4a');
  if (!v) return;
  try {
    await hooks.sendFile(a, c, { buf: v.buf, mime: v.mime, kind: 'voice', name: ogg ? 'javob.ogg' : 'javob.m4a' }, '');
    audit('ai', 'Muloqot agenti', 'Javob ovoz bilan ham yuborildi', { object: `conv:${c.id}`, result: `${Math.round(v.buf.length / 1024)} KB` });
  } catch (e) {
    audit('sys', 'Muloqot agenti', 'Ovozli javob yuborilmadi', { object: `conv:${c.id}`, result: String(e.message || e).slice(0, 160) });
  }
}
const clientSentVoice = convId => {
  const m = one("SELECT text FROM messages WHERE conversation_id=? AND author='client' ORDER BY id DESC LIMIT 1", convId);
  return Boolean(m && /\[ovozli xabar\]/.test(m.text || ''));
};

/* Shablon javob: AI chaqirilmasdan yuboriladi. Tarixda «AI» bo‘lib ko‘rinadi, lekin izohda «shablon» deb yoziladi —
   panelni ochgan odam buni model yozmaganini biladi. Javobsiz holatda esa suhbat navbatdan chiqadi. */
async function sendQuick(c, a, q, batch) {
  const upto = lastMsgId(c.id);
  const ts = now();
  let again = false;
  if (q.silent) {
    tx(() => { again = armAfterReply(c.id, nextPending(c.id, upto, batch)); });
    audit('ai', 'Muloqot agenti', 'Javob kerak emas (shablon qoida)', { object: `conv:${c.id}`, result: q.why });
    if (again) scheduleDraft(c.id);
    return;
  }
  // Zaxira himoya: shu suhbatga 2 daqiqa ichida aynan shu shablon allaqachon ketgan bo‘lsa — qayta yuborilmaydi
  if (one(`SELECT 1 FROM messages WHERE conversation_id=? AND author='ai' AND text=? AND created_at>?`, c.id, q.text, now() - 120e3)) {
    tx(() => { again = armAfterReply(c.id, nextPending(c.id, upto, batch)); });
    if (again) scheduleDraft(c.id);
    return;
  }
  let ext = null;
  try { ext = await hooks.send(a, c, q.text); }
  catch (e) {
    // Kanal ishlamayapti (token o‘lgan, aloqa yo‘q): 5 daqiqadan keyin qayta — aks holda dvigatel har soniyada urinib,
    // jurnalni to‘ldirardi (2026-10-08: Instagram tokeni o‘lganda bir kunda 117 000 yozuv)
    run('UPDATE conversations SET ai_due_at=? WHERE id=? AND ai_due_at IS NOT NULL', now() + 5 * 60e3, c.id);
    audit('ai', 'Muloqot agenti', 'Shablon javob yuborilmadi', { object: `conv:${c.id}`, result: String(e.message || e) });
    return;
  }
  tx(() => {
    run('INSERT OR IGNORE INTO messages(conversation_id,author,user_id,text,ext_msg_id,meta,created_at) VALUES(?,?,?,?,?,?,?)',
      c.id, 'ai', null, q.text, ext == null ? `tz-${c.id}-${ts}` : String(ext),
      JSON.stringify({ tag: 'shablon javob (AI ishlatilmadi)', quick: q.why }), ts);
    run('UPDATE conversations SET last_ai_at=?, last_msg_at=? WHERE id=?', ts, ts, c.id);
    again = armAfterReply(c.id, nextPending(c.id, upto, batch));
  });
  audit('ai', 'Muloqot agenti', 'Shablon javob yuborildi (AI ishlatilmadi)', { object: `conv:${c.id}`, result: q.why });
  if (again) scheduleDraft(c.id);
}

/* sent: [{ text, ext }] — har qism alohida xabar (panelda ham Telegram’dagidek ko‘rinadi); eski chaqiruv — bitta ext */
function finishSent(convId, d, sent, tag, userId) {
  const ts = now();
  const list = Array.isArray(sent) ? sent : [{ text: d.text, ext: sent }];
  let again = false;
  tx(() => {
    run(`UPDATE drafts SET status='sent', decided_at=COALESCE(decided_at,?) WHERE id=?`, ts, d.id);
    list.forEach((m, i) => run('INSERT OR IGNORE INTO messages(conversation_id,author,user_id,text,ext_msg_id,meta,created_at) VALUES(?,?,?,?,?,?,?)',
      convId, 'ai', userId, m.text, m.ext == null ? `ai-${d.id}${i ? '-' + i : ''}` : String(m.ext),
      JSON.stringify({ draft: d.id, tag, ...(i ? { part: i + 1 } : {}), ...(m.media ? { media: m.media } : {}) }), ts + i));
    run('UPDATE conversations SET last_ai_at=?, last_msg_at=? WHERE id=?', ts, ts, convId);
    again = armAfterReply(convId, nextPending(convId, d.upto_msg_id, d.batch));
    closeTasksOnReply(convId, 'ai', null, ts);
  });
  audit('ai', 'Muloqot agenti', `Javob yuborildi (${tag})`, { object: `conv:${convId}`, data: jparse(d.sources, []).join(' · '), result: 'Yuborildi' });
  hooks.notify?.('ai_sent', { conv: conversation(convId), draft: d, tag });
  if (again) scheduleDraft(convId); // yuborish paytida kelgan savolga alohida javob tayyorlanadi
}

/* Telegram botning o‘z xabari (aks-sado) keldi: holati «noma’lum» qoralama aslida yuborilgan — tasdiqlanadi */
export function confirmEcho(convId, text, extMsgId) {
  // Javob qismlarga bo‘lingan bo‘lsa, aks-sado har qism uchun alohida keladi — qismlardan biri mos kelsa ham tasdiq
  const d = all(`SELECT * FROM drafts WHERE conversation_id=? AND status='unknown' ORDER BY id DESC LIMIT 5`, convId)
    .find(x => x.text === text || splitReply(x.text).includes(String(text || '').trim()));
  if (!d) return false;
  finishSent(convId, d, extMsgId, 'yuborilgani Telegram’da tasdiqlandi', null);
  return true;
}

export async function attemptAutoSend(convId) {
  if (closing) return;
  const c = conversation(convId);
  if (!c?.ai_due_at) return;
  const d = one(`SELECT * FROM drafts WHERE conversation_id=? AND batch=? ORDER BY id DESC LIMIT 1`, convId, c.pending_since);
  // Qoralama yo‘q yoki eskirgan (qayta ishga tushish, uzoq kutish) — yangidan tayyorlanadi; taymer o‘chmaydi
  const redo = () => { if (!timers.has(convId) && !drafting.has(convId)) scheduleDraft(convId, 0); };
  if (!d || d.status === 'superseded') return redo();
  if (d.status === 'preparing') {
    if (inflight.has(d.id)) return; // tayyor bo‘lgach makeDraft o‘zi chaqiradi
    run(`UPDATE drafts SET status='superseded', reason=?, decided_at=? WHERE id=?`, 'Tayyorlash to‘xtab qolgan — qayta tayyorlanadi', now(), d.id);
    return redo();
  }
  if (d.status === 'ready' && now() - d.created_at > STALE_DRAFT_MS) {
    run(`UPDATE drafts SET status='superseded', reason=?, decided_at=? WHERE id=?`, 'Eskirgan — yangidan tayyorlanadi', now(), d.id);
    return redo();
  }
  if (d.status !== 'ready') { run('UPDATE conversations SET ai_due_at=NULL WHERE id=?', convId); return; }
  const claim = claimDraft(convId, d.id, { requireDue: true, who: 'auto' });
  if (!claim.ok) {
    if (claim.retry) return; // sotuvchi yozmoqda yoki vaqti kelmagan — keyingi soniyada qayta
    // Boshqa sabab (javob berilgan, suhbat sotuvchida, kanal yopiq) — taymer o‘chadi: dvigatel har soniya aylanmaydi, kechikish eskalatsiyasi ishlaydi
    run('UPDATE conversations SET ai_due_at=NULL WHERE id=?', convId);
    if (claim.closed) hooks.notify?.('window_closed', { conv: c });
    return;
  }
  const e = effective(claim.c, claim.a);
  return deliver(claim, { tag: e.night ? 'tungi avtojavob' : e.delayMs ? 'kechiksa · T tugagach' : 'doim' });
}

export async function approveDraft(convId, draftId, user) {
  const claim = claimDraft(convId, Number(draftId), { requireDue: false, who: `user:${user.id}` });
  if (!claim.ok) return claim;
  if (claim.a.rollout === 'kuzatish') {
    run(`UPDATE drafts SET status='ready' WHERE id=?`, claim.d.id);
    return { ok: false, why: 'Kuzatish rejimida AI javobi mijozga yuborilmaydi' };
  }
  return deliver(claim, { tag: `${user.name} tasdiqladi`, userId: user.id });
}

export function rateDraft(draftId, user, rating) {
  const d = one('SELECT * FROM drafts WHERE id=?', draftId);
  if (!d || !['good', 'bad'].includes(rating)) return false;
  run('UPDATE drafts SET rating=?, rated_by=? WHERE id=?', rating, user.name, draftId);
  audit('staff', user.name, `AI qoralamasini baholadi: ${rating === 'good' ? 'yaxshi' : 'yomon'}`, { object: `conv:${d.conversation_id}` });
  return true;
}

/* Sotuvchi paneldan yozadi. AI shu soniyada yuborayotgan bo‘lsa — kutadi (ikki javob ketmasin). */
/* Tovar rasmini mijozga yuborish: matn yuborish bilan bir xil qoidalar (AI to‘xtaydi, oyna tekshiriladi) */
export async function sellerSendPhoto(convId, user, photo) {
  if (!photo?.buf) return { ok: false, why: 'Bu tovarda rasm yo‘q' };
  const claim = tx(() => {
    const c = conversation(convId), a = account(c.account_id);
    if (one(`SELECT 1 FROM drafts WHERE conversation_id=? AND status='sending'`, convId)) return { ok: false, why: 'AI hozir javob yubormoqda — bir soniyadan keyin qayta urinib ko‘ring' };
    if (!channelOpen(c, a)) return { ok: false, why: a.channel === 'tg' ? 'Telegram 24 soatlik oynasi yopiq' : 'Kanal javob berishga ruxsat bermaydi' };
    cancelOpenDrafts(convId, `${user.name} rasm yubordi`, `user:${user.id}`);
    run('UPDATE conversations SET ai_due_at=NULL WHERE id=?', convId);
    return { ok: true, c, a, seen: lastMsgId(convId) };
  });
  if (!claim.ok) return claim;
  let ext;
  sendingNow++;
  try { ext = await hooks.sendPhoto(claim.a, claim.c, photo.buf, photo.name); }
  catch (e) {
    audit('staff', user.name, 'Rasm yuborilmadi', { object: `conv:${convId}`, result: String(e.message || e) });
    return { ok: false, why: (e.uncertain ? 'Yuborilgani noma’lum — Telegram’da tekshiring: ' : 'Yuborishda xato: ') + String(e.message || e) };
  } finally { sendingNow--; }
  markSellerReply(convId, { text: `[rasm] ${photo.name}`, userId: user.id, extMsgId: ext == null ? `p-${now()}` : String(ext), via: 'panel', seenMaxId: claim.seen });
  audit('staff', user.name, 'Mijozga tovar rasmi yuborildi', { object: `conv:${convId}`, data: photo.name });
  return { ok: true };
}

export async function sellerSend(convId, user, text, replyMsgId = null) {
  text = String(text || '').trim();
  if (!text) return { ok: false, why: 'Bo‘sh xabar' };
  const reply = replyTarget(convId, replyMsgId);
  const claim = tx(() => {
    const c = conversation(convId), a = account(c.account_id);
    if (one(`SELECT 1 FROM drafts WHERE conversation_id=? AND status='sending'`, convId)) return { ok: false, why: 'AI hozir javob yubormoqda — bir soniyadan keyin qayta urinib ko‘ring' };
    if (!channelOpen(c, a)) return { ok: false, why: a.channel === 'tg' ? 'Telegram 24 soatlik oynasi yopiq — bot bu chatga yoza olmaydi' : 'Kanal javob berishga ruxsat bermaydi' };
    cancelOpenDrafts(convId, `${user.name} javob yozdi`, `user:${user.id}`);
    run('UPDATE conversations SET ai_due_at=NULL WHERE id=?', convId);
    return { ok: true, c, a, seen: lastMsgId(convId) };
  });
  if (!claim.ok) return claim;
  let ext;
  sendingNow++;
  try { ext = await hooks.send(claim.a, claim.c, text, { replyTo: reply.ext }); }
  catch (e) {
    audit('staff', user.name, 'Xabar yuborilmadi', { object: `conv:${convId}`, result: String(e.message || e) });
    return { ok: false, why: (e.uncertain ? 'Yuborilgani noma’lum — Telegram’da tekshiring: ' : 'Yuborishda xato: ') + String(e.message || e) };
  } finally { sendingNow--; }
  // Sotuvchi ko‘rgan xabardan keyin mijoz yana yozgan bo‘lsa — u javobsiz qolmaydi
  markSellerReply(convId, { text, userId: user.id, extMsgId: ext == null ? `s-${now()}` : String(ext), via: 'panel', seenMaxId: claim.seen, meta: reply.meta });
  return { ok: true };
}

/* Javob (reply): panel xabar id si → kanaldagi xabar id si. Soxta id lar (s-…, p-…) kanalga ketmaydi — faqat panelda iqtibos ko‘rinadi */
function replyTarget(convId, msgId) {
  if (!msgId) return { ext: null, meta: null };
  const m = one('SELECT id, ext_msg_id FROM messages WHERE id=? AND conversation_id=?', Number(msgId), convId);
  if (!m) return { ext: null, meta: null };
  const real = m.ext_msg_id && !/^(s|p|f|fu|ai)-\d+$/.test(m.ext_msg_id) ? m.ext_msg_id : null;
  return { ext: real, meta: { reply_to: m.id, ...(real ? { reply_ext: real } : {}) } };
}

/* Panel orqali fayl yuborish (rasm, video, ovoz, hujjat). Fayl serverda keshlanadi — panelda shu yerdan ko‘rinadi. */
export async function sellerSendFile(convId, user, file, caption = '', replyMsgId = null) {
  caption = String(caption || '').trim();
  const reply = replyTarget(convId, replyMsgId);
  const claim = tx(() => {
    const c = conversation(convId), a = account(c.account_id);
    if (one(`SELECT 1 FROM drafts WHERE conversation_id=? AND status='sending'`, convId)) return { ok: false, why: 'AI hozir javob yubormoqda — bir soniyadan keyin qayta urinib ko‘ring' };
    if (!channelOpen(c, a)) return { ok: false, why: a.channel === 'tg' ? 'Telegram 24 soatlik oynasi yopiq — bot bu chatga yoza olmaydi' : 'Kanal javob berishga ruxsat bermaydi' };
    cancelOpenDrafts(convId, `${user.name} fayl yubordi`, `user:${user.id}`);
    run('UPDATE conversations SET ai_due_at=NULL WHERE id=?', convId);
    return { ok: true, c, a, seen: lastMsgId(convId) };
  });
  if (!claim.ok) return claim;
  let ext;
  sendingNow++;
  try { ext = await hooks.sendFile(claim.a, claim.c, file, caption, { replyTo: reply.ext }); }
  catch (e) {
    audit('staff', user.name, 'Fayl yuborilmadi', { object: `conv:${convId}`, result: String(e.message || e) });
    return { ok: false, why: (e.uncertain ? 'Yuborilgani noma’lum — Telegram’da tekshiring: ' : 'Yuborishda xato: ') + String(e.message || e) };
  } finally { sendingNow--; }
  const uid = `out-${now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dir = join(config.dataDir, 'files'); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, uid), file.buf);
  const label = { photo: '[rasm]', video: '[video]', voice: '[ovozli xabar]', audio: '[audio]' }[file.kind] || `[fayl: ${file.name}]`;
  markSellerReply(convId, { text: caption ? `${label} ${caption}` : label, userId: user.id, extMsgId: ext == null ? `f-${now()}` : String(ext), via: 'panel', seenMaxId: claim.seen,
    meta: { ...reply.meta, media: { kind: file.kind, uid, mime: file.mime, name: file.name, size: file.buf.length } } });
  audit('staff', user.name, 'Mijozga fayl yuborildi', { object: `conv:${convId}`, data: file.name });
  return { ok: true };
}

/* Yuborilgan xabarni tahrirlash — faqat o‘zi (panel yoki sotuvchi) yuborgan matnli xabar; kanal ruxsat bersa u yerda ham o‘zgaradi */
export async function editSellerMessage(msgId, user, text) {
  text = String(text || '').trim();
  const m = one('SELECT * FROM messages WHERE id=?', Number(msgId));
  if (!m || m.author === 'client') return { ok: false, why: 'Bu xabarni tahrirlab bo‘lmaydi' };
  if (!text) return { ok: false, why: 'Bo‘sh xabar' };
  const meta = JSON.parse(m.meta || '{}');
  if (meta.media) return { ok: false, why: 'Fayl xabarini tahrirlab bo‘lmaydi — o‘chirib, qayta yuboring' };
  const c = conversation(m.conversation_id), a = account(c.account_id);
  const real = m.ext_msg_id && !/^(s|p|f|fu|ai)-\d+$/.test(m.ext_msg_id);
  if (real) try { await hooks.editMsg(a, c, m.ext_msg_id, text); } catch (e) { return { ok: false, why: String(e.message || e) }; }
  meta.edited_at = now(); meta.original ??= m.text;
  run('UPDATE messages SET text=?, meta=? WHERE id=?', text, JSON.stringify(meta), m.id);
  audit('staff', user.name, 'Xabar tahrirlandi', { object: `conv:${m.conversation_id}` });
  return { ok: true };
}

/* Bitta xabarni o‘chirish: kanalda ham (Telegram), keyin panelda. Kanal o‘chira olmasa — panelda o‘chmaydi, sabab aytiladi. */
export async function deleteMessage(msgId, user) {
  const m = one('SELECT * FROM messages WHERE id=?', Number(msgId));
  if (!m) return { ok: false, why: 'Xabar topilmadi' };
  const c = conversation(m.conversation_id), a = account(c.account_id);
  const real = m.ext_msg_id && !/^(s|p|f|fu|ai)-\d+$/.test(m.ext_msg_id);
  if (real) try { await hooks.deleteMsgs(a, [m.ext_msg_id]); } catch (e) { return { ok: false, why: String(e.message || e) }; }
  run('DELETE FROM messages WHERE id=?', m.id);
  audit('staff', user.name, 'Xabar o‘chirildi', { object: `conv:${m.conversation_id}` });
  return { ok: true };
}

/* Kanal tomonida ham o‘chirish (tarixni tozalash / suhbatni o‘chirish). Qaytaradi: { channel: n, failed: n, why } */
async function wipeOnChannel(convId) {
  const c = conversation(convId), a = account(c.account_id);
  const ids = all(`SELECT ext_msg_id FROM messages WHERE conversation_id=? AND ext_msg_id IS NOT NULL`, convId).map(r => r.ext_msg_id).filter(x => /^\d+$/.test(x));
  if (!ids.length || a.channel === 'demo') return { channel: 0, failed: 0 };
  try { await hooks.deleteMsgs(a, ids); return { channel: ids.length, failed: 0 }; }
  catch (e) { return { channel: 0, failed: ids.length, why: String(e.message || e) }; }
}
export async function clearHistoryEverywhere(convId, user) {
  const w = await wipeOnChannel(convId);
  return { ...clearHistory(convId, user), channel: w.channel, failed: w.failed, why: w.why };
}
export async function deleteConversationEverywhere(convId, user) {
  const w = await wipeOnChannel(convId);
  return { ...deleteConversation(convId, user), channel: w.channel, failed: w.failed, why: w.why };
}

/* Ta’qib xabari (javob emas): pending’ga tegmaydi, faqat oyna ochiq va suhbat sotuvchida bo‘lmasa */
export async function sendAiFollowup(convId, text, tag) {
  const c = conversation(convId), a = account(c.account_id);
  if (c.taken_by || c.pending_since || !channelOpen(c, a)) return { ok: false, why: 'shart bajarilmadi' };
  const ext = await hooks.send(a, c, text);
  const ts = now();
  run('INSERT OR IGNORE INTO messages(conversation_id,author,text,ext_msg_id,meta,created_at) VALUES(?,?,?,?,?,?)',
    convId, 'ai', text, ext == null ? `fu-${ts}` : String(ext), JSON.stringify({ tag }), ts);
  run('UPDATE conversations SET last_ai_at=?, last_msg_at=? WHERE id=?', ts, ts, convId);
  audit('ai', 'Muloqot agenti', `Ta’qib xabari yuborildi (${tag})`, { object: `conv:${convId}`, result: 'Yuborildi' });
  return { ok: true };
}

/* Taymer dvigateli: har soniyada muddati kelgan suhbatlar */
let engine;
export function startEngine() {
  closing = false;
  engine = setInterval(() => {
    const due = all('SELECT id FROM conversations WHERE ai_due_at IS NOT NULL AND ai_due_at<=? ORDER BY ai_due_at LIMIT 20', now());
    for (const { id } of due) attemptAutoSend(id).catch(e => console.error('autosend', e));
  }, 1000);
  engine.unref?.();
}
export const stopEngine = () => clearInterval(engine);

/* Qayta ishga tushgandan keyin: xotiradagi taymerlar yo‘qolgan — chala qolgan qoralama va yuborishlar tiklanadi */
/* AI kaliti hozirgina kiritildi: javob kutayotgan suhbatlarga qoralama navbat bilan qayta tayyorlanadi (yuborish rejimi o‘zgarmaydi) */
export function redraftPending() {
  const convs = all(`SELECT c.id FROM conversations c WHERE c.pending_since IS NOT NULL AND c.taken_by IS NULL AND c.archived=0 AND NOT EXISTS
    (SELECT 1 FROM drafts d WHERE d.conversation_id=c.id AND d.batch=c.pending_since AND d.status IN ('ready','sent','sending','preparing','unknown','cancelled'))`);
  convs.forEach((c, i) => scheduleDraft(c.id, 2000 + i * 15000));   // bepul tarif limitiga urilmasin
  return convs.length;
}

export function recoverInbox() {
  const t = now();
  for (const d of all(`SELECT * FROM drafts WHERE status IN ('preparing','sending')`)) {
    // «superseded» — «failed» emas: taymer o‘chmasin, dvigatel qoralamani qayta tayyorlatadi
    if (d.status === 'preparing') { run(`UPDATE drafts SET status='superseded', reason=?, decided_at=? WHERE id=?`, 'Tizim qayta ishga tushdi — qayta tayyorlanadi', t, d.id); continue; }
    const why = 'Tizim yuborish paytida qayta ishga tushdi — javob mijozga ketgan-ketmagani noma’lum';
    run(`UPDATE drafts SET status='unknown', reason=? WHERE id=?`, why, d.id);
    audit('sys', 'Suhbatlar', 'Javob holati noma’lum (qayta ishga tushish)', { object: `conv:${d.conversation_id}` });
    hooks.notify?.('send_unknown', { conv: conversation(d.conversation_id), reason: why });
  }
  // So‘nggi 24 soatda javob kutayotgan, qoralamasi yo‘q suhbatlar — navbat bilan qayta tayyorlanadi (AI’ga bir yo‘la yuk tushmasin)
  const convs = all(`SELECT c.id FROM conversations c WHERE c.pending_since>? AND c.taken_by IS NULL AND NOT EXISTS
    (SELECT 1 FROM drafts d WHERE d.conversation_id=c.id AND d.batch=c.pending_since AND d.status IN ('ready','sent','unknown','cancelled'))`, t - 24 * 3600e3);
  const fresh = convs.filter(c => { const f = lastTempFail(c.id); return !(f && TEMP_FAIL.test(f.reason || '') && now() - (f.decided_at || 0) < 30 * 60e3); });
  fresh.forEach((c, i) => scheduleDraft(c.id, 3000 + i * 1500));
  return fresh.length;
}

/* To‘xtashdan oldin: yangi yuborish boshlanmaydi, boshlanganlari tugashi kutiladi (≤ ms) */
export async function drainInbox(ms = 10000) {
  closing = true;
  stopEngine();
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  const t0 = Date.now();
  while (sendingNow > 0 && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 100));
  return sendingNow;
}
