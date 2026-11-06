import { config } from '../config.js';
import { one, all, run, kvGet, kvSet } from '../db.js';
import { now, esc, clip, jparse, local, onDuty, inWindow } from '../util.js';
import { getSettings } from './settings.js';
import { takeOver } from './inbox.js';
import { audit } from '../core/audit.js';

/*
  Boshliq agent — AI sotuvchilarni rahbar nomidan boshqaradi.
  AI o‘zi qila olmaydigan ish (rasm topilmadi, to‘lov/chek, dastavka va buyurtma, shikoyat, javobsiz qolgan mijoz) — navbatdagi sotuvchiga
  jonli rahbardek, tugmasiz yoziladi: «Mirzohid, Instagramdagi @ali_v Canon R50 rasmini so‘rayapti, tashlab yuboring» (@ali_v — havola).
  Yo‘l: Photobuy Business akkaunti (sotuvchi bugun unga yozgan bo‘lsa), aks holda bot.
  Qoidalar (rahbar talabi, 2026-10-03):
  - Sotuvchi ko‘rib biror narsa yozsa («ok», «tashladim», savol) yoki mijozga javob bersa — ish qabul qilingan va bajarilgan hisoblanadi.
  - assign_done_minutes (2 soat) ichida hech qanday harakat bo‘lmasa — jimgina keyingi sotuvchiga (shoshilinchda assign_urgent_minutes).
  - Har o‘tkazib yuborishga ogohlantirish yo‘q; faqat tez-tez e’tiborsiz bo‘lsa (7 kunda 3+) — «iltimos, e’tiborli bo‘ling», kuniga ko‘pi bilan bir marta.
  - «Vaqtim yo‘q, boshqasiga ayting» — darhol keyingisiga, reytingga ta’sir qiladi. Erkin javoblarni boshliq AI tushunadi.
  - Hamma o‘tkazsa yoki hech kim ulanmagan bo‘lsa — rahbarga (rahbar ulanmagan bo‘lsa — 30 daqiqadan keyin qaytadan sotuvchilarga).
  Har qadam: assignment_events (reyting), staff_messages (yozishma), staff_notes (profil izohlari), audit.
*/

export const KINDS = {
  rasm: { label: 'Rasm yuborish', take: false },
  tolov: { label: 'To‘lovni tasdiqlash', take: true },
  buyurtma: { label: 'Buyurtma va dastavka', take: true },
  shikoyat: { label: 'Shikoyat / servis', take: true },
  javob: { label: 'Mijozga javob berish', take: false },
  boshqa: { label: 'Mijoz bilan bog‘lanish', take: false }
};
const CH = { tg: 'Telegram', ig: 'Instagram', demo: 'Demo' };
const CHDA = { tg: 'Telegramdagi', ig: 'Instagramdagi', demo: 'Demodagi' };
const OPEN = `('queued','offered','accepted','escalated')`;
const REROUND_MS = 30 * 60e3;
const ATTN_MISSES = 3, ATTN_DAYS = 7;   // shuncha marta e’tiborsiz — «iltimos, e’tiborli bo‘ling»

/* Telegram: Business akkaunt faqat oxirgi 24 soatda unga yozgan odamga yoza oladi (zaxira bilan 23,5 soat) */
const BIZ_WINDOW = 23.5 * 3600e3;
export const bizOpen = (u, t = now()) => Boolean(u?.biz_seen_at) && t - u.biz_seen_at < BIZ_WINDOW;
/* Bugun Photobuy akkauntiga yozgan — ishga kelgan */
const atWork = (u, t = now()) => bizOpen(u, t) && local(u.biz_seen_at).date === local(t).date;

/* Xabar yuboruvchi. channel: 'auto' — Photobuy akkauntidan (rahbar yozgandek), bo‘lmasa bot; 'bot' — faqat bot. Tugma yo‘q.
   Qaytaradi: { via: 'biz' | 'bot', msgId } yoki false (yetmadi). Sinovda almashtiriladi. */
let sender = async (user, text, { channel = 'auto' } = {}) => {
  const tgm = await import('../channels/telegram.js');
  if (channel !== 'bot' && bizOpen(user)) {
    const msgId = await tgm.sendStaffBusiness(user, text, null);
    if (msgId) return { via: 'biz', msgId };
  }
  return await tgm.sendStaffChecked(user, text, null) ? { via: 'bot', msgId: null } : false;
};
export function setDispatchSender(fn) { sender = fn; }

/* Boshliq AI (sotuvchining erkin javobini tushunadi) — sinovda almashtiriladi */
let bossAgent = async args => (await import('../agents/boshliq.js')).bossReply(args);
export function setBossAgent(fn) { bossAgent = fn; }

const ev = (assignmentId, userId, event, ms = null) =>
  run('INSERT INTO assignment_events(assignment_id,user_id,event,ms,at) VALUES(?,?,?,?,?)', assignmentId, userId ?? null, event, ms, now());
const who = c => esc(c.display_name || c.handle || `Suhbat #${c.id}`);
const clientRef = c => c.handle || c.display_name || `mijoz #${c.id}`;
const firstName = u => String(u?.name || '').trim().split(/\s+/)[0] || '';
const convUrl = c => `${config.publicUrl}/#suhbat/${c.id}`;
const fmtMin = m => m >= 60 && m % 60 === 0 ? `${m / 60} soat` : `${m} daqiqa`;
const isLeader = u => ['rahbar', 'admin'].includes(u?.role);
const channelOf = c => one('SELECT channel FROM accounts WHERE id=?', c.account_id)?.channel;
const plain = s => String(s).replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

/* Sotuvchiga (yoki rahbarga) yozish + yozishma jurnali (profilda ko‘rinadi) */
async function say(u, text, { channel = 'auto', assignmentId = null } = {}) {
  const r = await sender(u, text, { channel });
  if (r) run('INSERT INTO staff_messages(user_id,dir,text,via,assignment_id,created_at) VALUES(?,?,?,?,?,?)', u.id, 'out', clip(plain(text), 2000), r.via || 'bot', assignmentId, now());
  return r;
}

/* Sotuvchi profilidagi izoh (rad etdi, javob bermadi, ogohlantirildi, kunlik xulosa, AI kuzatuvi) */
export function note(userId, kind, text, { assignmentId = null, by = 'Boshliq agent' } = {}) {
  if (!userId || !text) return;
  run('INSERT INTO staff_notes(user_id,assignment_id,kind,text,created_by,created_at) VALUES(?,?,?,?,?,?)', userId, assignmentId, kind, clip(String(text), 600), by, now());
}

/* Mijoz — matn ichida havola. Telegram: @username (Telegram o‘zi havola qiladi). Instagram: Instagram chatiga havola
   (oddiy @username Telegram’da boshqa odamga havola bo‘lib qolardi). Username bo‘lmasa — ismi. */
function clientHtml(c, ch) {
  const h = String(c.handle || '').replace(/^@/, '');
  if (ch === 'ig' && /^[A-Za-z0-9_.]{2,40}$/.test(h)) return `<a href="https://ig.me/m/${h}">@${esc(h)}</a>`;
  if (ch === 'tg' && /^[A-Za-z0-9_]{4,40}$/.test(h)) return `@${esc(h)}`;
  return esc(c.display_name || c.handle || 'mijoz');
}

/* Topshiriq oladigan sotuvchilar: faol, sotuvchi yoki filial roli; Telegram bot ulangan yoki oxirgi 24 soatda Photobuy akkauntiga yozgan */
const reachable = () => all(`SELECT * FROM users WHERE active=1 AND role IN ('sotuvchi','filial') AND (tg_chat_id IS NOT NULL OR biz_seen_at>?) ORDER BY id`, now() - BIZ_WINDOW);
/* Smenada: smena vaqti kiritilgan bo‘lsa — o‘sha, aks holda do‘kon ish vaqti */
export function onShift(u, t = now(), s = getSettings()) {
  if (!onDuty({ dow: u.shift_dow, from: u.shift_from, to: u.shift_to }, t)) return false;
  return u.shift_from && u.shift_to ? true : inWindow(t, s.work_from, s.work_to);
}

/* Navbat.
   Oddiy ish: bugun ishga kelganlar (akkauntga yozgan) oldin → kam band → eng uzoq vaqt ish olmagan (galma-gal).
   Shoshilinch (mijoz hozir to‘lamoqchi): hozir «online» (staff_active_minutes ichida faol) → eng oxirgi faol bo‘lgan → kam band. */
function pickSeller(tried, t, s, urgent = false) {
  const pool = reachable().filter(u => !tried.includes(u.id) && onShift(u, t, s));
  if (!pool.length) return null;
  const load = id => one(`SELECT count(*) n FROM assignments WHERE user_id=? AND status IN ('offered','accepted')`, id).n;
  const last = id => one(`SELECT max(at) t FROM assignment_events WHERE user_id=? AND event='offered'`, id).t || 0;
  const online = u => (u.active_at || 0) > t - s.staff_active_minutes * 60e3;
  const rows = pool.map(u => ({ u, load: load(u.id), last: last(u.id), work: atWork(u, t) ? 0 : 1, on: online(u) ? 0 : 1, act: u.active_at || 0 }));
  rows.sort(urgent
    ? (x, y) => x.on - y.on || y.act - x.act || x.load - y.load || x.u.id - y.u.id
    : (x, y) => x.work - y.work || x.load - y.load || x.last - y.last || x.u.id - y.u.id);
  return rows[0].u;
}

/* Javob muddati: oddiy ish — 2 soat, shoshilinch — bir necha daqiqa */
const reactLimit = (a, s) => a.urgent ? s.assign_urgent_minutes : s.assign_done_minutes;
const lastClient = c => one(`SELECT text FROM messages WHERE conversation_id=? AND author='client' ORDER BY id DESC LIMIT 1`, c.id)?.text;

/* Rahbar ovozi: sotuvchi ismi + oddiy gap, mijoz — havola. Vazifada mijoz tilga olinmagan bo‘lsa — keyingi qatorda.
   «Javob bering» turidagi ishda mijozning so‘nggi savoli ham (rahbar yozishmani ko‘chirib bergandek). */
function taskMessage(a, c, u, ch, again = false) {
  const task = String(a.body || a.title).trim().replace(/[.!]+$/, '');
  let html = esc(task);
  const handle = c.handle && esc(c.handle), link = clientHtml(c, ch);
  const named = (handle && html.includes(handle)) || (c.display_name && task.toLowerCase().includes(String(c.display_name).toLowerCase()));
  if (handle && html.includes(handle)) html = html.split(handle).join(link);
  const lines = [`${esc(firstName(u))}, ${a.urgent ? 'tezda: ' : ''}${html}`];
  if (!named) lines.push(`${CHDA[ch] || ''} ${link}`.trim());
  if (c.phone && !task.includes(String(c.phone))) lines.push(`Tel: ${esc(c.phone)}`);
  if (['javob', 'boshqa', 'shikoyat'].includes(a.kind)) { const q = lastClient(c); if (q) lines.push(`U yozgan: «${esc(clip(q, 200))}»`); }
  if (again) lines.push('Tezroq iltimos, mijoz kutib qoldi');
  return lines.join('\n');
}

/* Yangi ish. Bir suhbatda bir turdagi ochiq ish bitta — takrorida faqat vazifa matni yangilanadi. */
export async function assign({ conv, kind = 'boshqa', task, urgent = false, by = 'Boshliq agent' }) {
  if (!conv) return null;
  if (!KINDS[kind]) kind = 'boshqa';
  urgent = urgent === true || kind === 'tolov';   // to‘lov — mijoz kutib turibdi
  const body = clip(String(task || KINDS[kind].label).trim(), 500);
  const open = one(`SELECT * FROM assignments WHERE conversation_id=? AND kind=? AND status IN ${OPEN}`, conv.id, kind);
  if (open) {
    if (urgent && !open.urgent) run('UPDATE assignments SET urgent=1 WHERE id=?', open.id);
    if (body && body !== open.body) {
      run('UPDATE assignments SET body=? WHERE id=?', body, open.id);
      // Yangi sabab (masalan avval «javob ketmadi», keyin «akkauntdan yozib bo‘lmayapti») — ish kimda bo‘lsa, bilsin
      const u = open.user_id && ['offered', 'accepted'].includes(open.status) && one('SELECT * FROM users WHERE id=?', open.user_id);
      if (u) await say(u, `${esc(firstName(u))}, ${clientHtml(conv, channelOf(conv))} bo‘yicha: ${esc(body)}`, { assignmentId: open.id });
    }
    return open.id;
  }
  const id = Number(run(`INSERT INTO assignments(conversation_id,kind,title,body,status,urgent,created_by,created_at) VALUES(?,?,?,?,'queued',?,?,?)`,
    conv.id, kind, KINDS[kind].label, body, urgent ? 1 : 0, by, now()).lastInsertRowid);
  audit('ai', 'Boshliq agent', `Topshiriq${urgent ? ' (shoshilinch)' : ''}: ${KINDS[kind].label}`, { object: `conv:${conv.id}`, data: body });
  await offer(id);
  return id;
}

/* Bitta ish bir vaqtda faqat bir marta taklif qilinadi: yangi ish (assign) va fon ishi (navbatdagilar) bir paytda
   ishlaganda sotuvchiga ikki marta borardi (2026-10-03, jonli: 31–363 ms farq bilan ikki xabar). */
const offering = new Set();
async function offer(id, opts = {}) {
  if (offering.has(id)) return 'busy';
  offering.add(id);
  try { return await offerNow(id, opts); } finally { offering.delete(id); }
}

/* Navbatdagi sotuvchiga taklif. Qaytaradi: 'offered' | 'queued' | 'escalated' | undefined (yopilgan) */
async function offerNow(id, { again = false } = {}) {
  const a = one('SELECT * FROM assignments WHERE id=?', id);
  if (!a || !['queued', 'offered', 'accepted'].includes(a.status)) return;
  const c = one('SELECT * FROM conversations WHERE id=?', a.conversation_id);
  if (!c) return;
  // «Javob bering» — mijoz endi javob kutmayapti (javob berilgan yoki suhbat yopilgan): taklif qilinmaydi
  if (a.kind === 'javob' && !c.pending_since) {
    run(`UPDATE assignments SET status='cancelled', done_at=? WHERE id=?`, now(), a.id);
    return;
  }
  const s = getSettings(), t = now(), ch = channelOf(c);
  const all_ = reachable();
  if (!all_.length) return escalate(a, c, ch, 'Telegram’ga ulangan sotuvchi yo‘q — sotuvchilar Photobuy akkauntiga yozishi yoki botda «Start» bosishi kerak.');
  if (!all_.some(u => onShift(u, t, s))) {   // hech kim smenada emas (tun, dam olish) — smena boshlanganda
    if (a.status !== 'queued') run(`UPDATE assignments SET status='queued', user_id=NULL WHERE id=?`, a.id);
    return 'queued';
  }
  const tried = jparse(a.tried, []);
  for (;;) {
    const u = pickSeller(tried, t, s, Boolean(a.urgent));
    if (!u) return escalate(a, c, ch, `${tried.length} ta sotuvchi ishni ko‘rmadi yoki rad etdi.`);
    tried.push(u.id);
    const r = await say(u, taskMessage(a, c, u, ch, again || a.attempts > 0), { assignmentId: a.id });
    if (r) {
      const via = r.via || 'bot';
      run(`UPDATE assignments SET status='offered', user_id=?, offered_at=?, accepted_at=NULL, attempts=attempts+1, tried=?, via=?, msg_id=? WHERE id=?`,
        u.id, now(), JSON.stringify(tried), via, r.msgId ?? null, a.id);
      ev(a.id, u.id, 'offered');
      audit('ai', 'Boshliq agent', `Topshiriq ${u.name}ga berildi: ${KINDS[a.kind].label}`, { object: `conv:${c.id}`,
        result: `${via === 'biz' ? 'Photobuy akkauntidan' : 'bot orqali'} · ${a.urgent ? 'shoshilinch, online sotuvchi' : a.attempts ? `${a.attempts + 1}-urinish` : 'navbat bo‘yicha'}` });
      return 'offered';
    }
    // Yetkazilmadi (bot bloklangan yoki «Start» bosilmagan, akkaunt oynasi yopiq) — keyingisi
    run('UPDATE assignments SET tried=? WHERE id=?', JSON.stringify(tried), a.id);
  }
}

async function escalate(a, c, ch, why) {
  run(`UPDATE assignments SET status='escalated', user_id=NULL WHERE id=?`, a.id);
  ev(a.id, null, 'escalated');
  const text = `Hech kim olmadi: ${esc(KINDS[a.kind].label.toLowerCase())} — ${CHDA[ch] || ''} ${clientHtml(c, ch)}\n${esc(a.body || a.title)}\n${esc(why)}\n<a href="${convUrl(c)}">Panelda ochish</a>`;
  for (const u of all(`SELECT * FROM users WHERE active=1 AND role IN ('rahbar','admin') AND tg_chat_id IS NOT NULL`)) await say(u, text, { channel: 'bot', assignmentId: a.id });
  audit('sys', 'Boshliq agent', `Topshiriq rahbarga o‘tdi: ${KINDS[a.kind].label}`, { object: `conv:${c.id}`, result: why });
  return 'escalated';
}

function complete(a, userId, how) {
  const t = now();
  if (!run(`UPDATE assignments SET status='done', done_at=?, done_how=?, user_id=COALESCE(?,user_id) WHERE id=? AND status IN ${OPEN}`, t, how, userId ?? null, a.id).changes) return false;
  const uid = userId ?? a.user_id;
  ev(a.id, uid, 'done', a.offered_at ? t - a.offered_at : null);
  // Ilgari shu yerda suhbatning HAMMA ochiq vazifasi «bajarildi» deb yopilardi — sotuvchi mijozga bitta javob yozsa,
  // «rasm yuboring» yoki «kartani to‘ldiring» kabi bajarilmagan vazifalar ham ko‘zdan yo‘qolardi.
  // Endi faqat belgi qo‘yiladi: vazifa ro‘yxatda qoladi, uni odam o‘zi «Bajarildi» deb yopadi.
  run(`UPDATE tasks SET result=? WHERE conversation_id=? AND status='open'
       AND kind IN ('handoff','draft_failed','send_failed','send_unknown','window_closed')`,
    'Sotuvchi mijozga javob yozdi — bajarilganini tekshiring', a.conversation_id);
  const name = uid ? one('SELECT name FROM users WHERE id=?', uid)?.name : null;
  audit('staff', name || 'Sotuvchi', `Topshiriq bajarildi: ${KINDS[a.kind]?.label || a.kind}`, { object: `conv:${a.conversation_id}`,
    result: { javob: 'mijozga javob yozildi', korildi: 'ko‘rdi va javob berdi', tugma: 'tugma bilan belgilandi', xabar: 'rahbarga «bajarildi» deb yozdi', panel: 'rahbar paneldan belgiladi' }[how] || how });
  return true;
}

/* Sotuvchi ishni ko‘rdi (biror narsa yozdi, eski xabardagi tugmani bosdi) — qabul qilingan va bajarilgan hisoblanadi.
   To‘lov, buyurtma, shikoyat — suhbat unga o‘tadi (AI mijozga aralashmaydi). Qaytaradi: xodimga ko‘rsatiladigan matn. */
export function acceptAssignment(id, staff, how = 'korildi') {
  const a = one('SELECT * FROM assignments WHERE id=?', Number(id));
  if (!a) return 'Topshiriq topilmadi';
  if (a.status === 'done') return a.user_id === staff.id ? 'Rahmat' : 'Bu ishni boshqa xodim qilgan';
  if (!['offered', 'accepted', 'escalated', 'queued'].includes(a.status)) return 'Topshiriq yopilgan';
  if (a.user_id && a.user_id !== staff.id && !isLeader(staff)) return 'Bu ish boshqa sotuvchiga o‘tgan';
  if (a.status !== 'accepted') ev(a.id, staff.id, 'accepted', a.offered_at && a.user_id === staff.id ? now() - a.offered_at : null);
  complete(a, staff.id, how);
  if (KINDS[a.kind]?.take) takeOver(a.conversation_id, staff);
  return 'Rahmat';
}
/* Eski xabarlardagi «Bajarildi» tugmasi va panel — xuddi shu */
export function doneAssignment(id, staff, how = 'tugma') {
  const a = one('SELECT * FROM assignments WHERE id=?', Number(id));
  if (!a) return 'Topshiriq topilmadi';
  if (a.status === 'done') return 'Allaqachon bajarilgan';
  const r = acceptAssignment(id, staff, how);
  return r === 'Rahmat' ? 'Rahmat! Bajarildi deb belgilandi.' : r;
}

/* Sotuvchi rad etdi («vaqtim yo‘q», «boshqasiga ayting») — darhol keyingi sotuvchiga; reytingiga ta’sir qiladi, profilida izoh.
   Qaytaradi: { week } (shu haftadagi rad etishlar soni) yoki null (ish unda emas). */
export async function declineAssignment(id, staff, reason = '') {
  const a = one('SELECT * FROM assignments WHERE id=?', Number(id));
  if (!a || !['offered', 'accepted'].includes(a.status) || a.user_id !== staff.id) return null;
  const c = one('SELECT * FROM conversations WHERE id=?', a.conversation_id);
  ev(a.id, staff.id, 'declined');
  const week = one(`SELECT count(*) n FROM assignment_events WHERE user_id=? AND event='declined' AND at>?`, staff.id, now() - 7 * 864e5).n;
  note(staff.id, 'rad', `Ishni rad etdi${reason ? `: «${clip(String(reason), 200)}»` : ''} — ${KINDS[a.kind].label.toLowerCase()}, ${clientRef(c)}. Shu haftada ${week}-marta.`, { assignmentId: a.id });
  audit('staff', staff.name, `Topshiriqni rad etdi: ${KINDS[a.kind].label}`, { object: `conv:${a.conversation_id}`, data: reason ? clip(String(reason), 300) : null, result: `shu haftada ${week}-marta` });
  run(`UPDATE assignments SET status='queued', user_id=NULL, accepted_at=NULL WHERE id=?`, a.id);
  await offer(a.id, { again: true });
  return { week };
}

/* ---------- sotuvchi bilan yozishma ---------- */
const Q = '[‘\'’`ʻ]?';
const DONE_RE = new RegExp(`(bajarildi|bajardim|bajarib|tashladim|tashlab (berdim|yubordim)|yubordim|jo${Q}natdim|qilib bo${Q}ldim|gaplashdim|hal qildim|готово|сделал|отправил|скинул|\\bdone\\b)`, 'i');
const ACCEPT_RE = new RegExp(`^(\\+|➕|👍|ok\\b|ок\\b|okay|xo${Q}p|хоп|hop\\b|ha\\b|xa\\b|да\\b|qabul|принял|принято|olaman|men olaman|mayli|ko${Q}rdim|hozir|bo${Q}ldi|tayyor)`, 'i');
const DECLINE_RE = new RegExp(`(vaqtim yo|bandman|band edim|qila olmayman|qilolmayman|ololmayman|boshqa(siga| sotuvchiga| odamga)|men emas|ishda emasman|uydaman|dam olyapman|kasalman|не могу|занят|другому)`, 'i');
const DELAY_RE = /\d+\s*(daqiqa|minut|min)|keyinroq qilaman|birozdan keyin/i;
const GREET_RE = new RegExp(`^(salom|assalom|assalomu alaykum|ishdaman|keldim|ishga keldim|xayrli tong|привет|здравствуйте)`, 'i');

/* Sotuvchi rahbarga yozdi (Photobuy akkaunti — via 'biz', yoki bot — via 'bot').
   Ochiq ishi bo‘lsa: rad etish («vaqtim yo‘q») — boshqasiga; boshqa har qanday javob — ko‘rdi (bajarildi). Savol bo‘lsa — boshliq AI javob beradi.
   Javob doim o‘sha yo‘l bilan qaytadi. */
export async function onStaffMessage(u, { text = '', replyTo = null, firstToday = false, via = 'biz' } = {}) {
  const t = String(text || '').trim(), ts = now();
  run('UPDATE users SET active_at=? WHERE id=?', ts, u.id);
  if (t) {
    run('INSERT INTO staff_messages(user_id,dir,text,via,created_at) VALUES(?,?,?,?,?)', u.id, 'in', clip(t, 2000), via, ts);
    audit('staff', u.name, 'Rahbarga yozdi', { data: clip(t, 300) });
  }
  const channel = via === 'bot' ? 'bot' : 'auto';
  const reply = msg => msg ? say(u, msg, { channel }) : null;
  const open = all(`SELECT * FROM assignments WHERE user_id=? AND status IN ('offered','accepted') ORDER BY offered_at DESC`, u.id);
  const a = (replyTo && open.find(x => x.msg_id === replyTo)) || open[0] || null;
  if (firstToday) await reply(`Salom, ${esc(firstName(u))}! Ish kuningiz boshlandi, ish bo‘lsa shu yerga yozaman.`);
  if (!t || (firstToday && GREET_RE.test(t) && t.split(/\s+/).length <= 4)) return;

  // 1) Qisqa aniq javob — AI’siz, darhol: rad etish yoki «ko‘rdim / qildim»
  if (a && t.split(/\s+/).length <= 4) {
    if (DECLINE_RE.test(t) && !DELAY_RE.test(t)) { await declineAssignment(a.id, u, t); return reply(pick(['Xo‘p, boshqasiga beraman', 'Tushunarli, boshqa sotuvchiga beraman'])); }
    if (DONE_RE.test(t) || ACCEPT_RE.test(t)) { acceptAssignment(a.id, u, DONE_RE.test(t) ? 'xabar' : 'korildi'); return reply(pick(['Rahmat', 'Yaxshi, rahmat', 'Xo‘p, rahmat'])); }
  }

  // 2) Erkin matn — boshliq AI (savolga javob, rad etish, ko‘rdi)
  const recent = all(`SELECT * FROM staff_messages WHERE user_id=? ORDER BY id DESC LIMIT 16`, u.id).reverse();
  const lost = all(`SELECT a.* FROM assignments a JOIN assignment_events e ON e.assignment_id=a.id WHERE e.user_id=? AND e.event IN ('missed','late','declined') AND e.at>? ORDER BY e.at DESC LIMIT 3`, u.id, ts - 3 * 3600e3);
  let out;
  try { out = await bossAgent({ user: u, text: t, open, lost, recent, replyTo: a?.id ?? null }); }
  catch (e) { out = { ok: false, reason: String(e.message || e) }; }
  if (out?.ok) {
    // AI amal tanlamagan bo‘lsa ham: ochiq ishi bor sotuvchi javob yozdi — demak ko‘rdi
    const still = a && one(`SELECT status FROM assignments WHERE id=?`, a.id);
    if (still && ['offered', 'accepted'].includes(still.status) && one('SELECT user_id FROM assignments WHERE id=?', a.id).user_id === u.id) acceptAssignment(a.id, u, 'korildi');
    return reply(out.reply ? esc(out.reply) : null);
  }

  // 3) AI ishlamadi — oddiy qoidalar: rad etish, aks holda ko‘rdi
  if (!a) return;
  if (DECLINE_RE.test(t) && !DELAY_RE.test(t)) { await declineAssignment(a.id, u, t); return reply('Xo‘p, boshqasiga beraman'); }
  acceptAssignment(a.id, u, DONE_RE.test(t) ? 'xabar' : 'korildi');
  return reply('Xo‘p, rahmat');
}

/* Sotuvchi mijozga yozdi (panel, Telegram Business yoki Instagram ilovasi) — shu suhbatdagi ochiq ishlar bajarildi.
   Paneldan — kim yozgani aniq; ilovadan — akkaunt umumiy, shuning uchun ish kimda bo‘lsa o‘shaniki. */
export function onSellerReply(convId, { userId = null, via = 'panel' } = {}) {
  for (const a of all(`SELECT * FROM assignments WHERE conversation_id=? AND status IN ${OPEN}`, convId)) {
    complete(a, via === 'panel' && userId ? userId : a.user_id ?? userId, 'javob');
  }
}

/* Ko‘rmadi (muddatida hech qanday harakat yo‘q): ogohlantirishsiz, profilida izoh. Tez-tez bo‘lsa — kuniga bir marta «iltimos, e’tiborli bo‘ling». */
async function missed(a, s) {
  const u = a.user_id && one('SELECT * FROM users WHERE id=?', a.user_id), c = one('SELECT * FROM conversations WHERE id=?', a.conversation_id);
  if (!u || !c) return;
  note(u.id, 'otkazdi', `${fmtMin(reactLimit(a, s))} ichida ko‘rmadi — ${KINDS[a.kind].label.toLowerCase()}, ${clientRef(c)}. Boshqa sotuvchiga o‘tdi.`, { assignmentId: a.id });
  if (!s.seller_auto_warn) return;
  const n = one(`SELECT count(*) n FROM assignment_events WHERE user_id=? AND event IN ('missed','late') AND at>?`, u.id, now() - ATTN_DAYS * 864e5).n;
  const lastWarn = Number(kvGet(`attn_warn:${u.id}`) || 0);
  if (n < ATTN_MISSES || now() - lastWarn < 24 * 3600e3) return;
  kvSet(`attn_warn:${u.id}`, now());
  await say(u, `${esc(firstName(u))}, iltimos, e’tiborli bo‘ling — so‘nggi kunlarda ${n} ta ishni ko‘rmay qoldingiz.`);
  note(u.id, 'ogohlantirish', `«Iltimos, e’tiborli bo‘ling» deb ogohlantirildi — ${ATTN_DAYS} kunda ${n} ta ishni ko‘rmagan.`);
  audit('sys', 'Boshliq agent', `Sotuvchi ogohlantirildi: ${u.name}`, { result: `${ATTN_DAYS} kunda ${n} ta ishni ko‘rmagan` });
}

/* Fon ishi (har 30 soniya): navbatdagilar, ko‘rilmaganlar, rahbarga o‘tganlar, kunlik hisobot */
let busy = false;
export async function dispatchJob() {
  if (busy) return; busy = true;
  try {
    const s = getSettings(), t = now();
    for (const a of all(`SELECT id FROM assignments WHERE status='queued' ORDER BY id LIMIT 20`)) await offer(a.id);
    // Muddatida hech qanday harakat yo‘q — jimgina keyingi sotuvchiga. «accepted» — eski versiyadan qolganlar ham shu qoida bilan.
    for (const a of all(`SELECT * FROM assignments WHERE status IN ('offered','accepted') AND COALESCE(accepted_at, offered_at) < CASE WHEN urgent=1 THEN ? ELSE ? END ORDER BY id LIMIT 20`,
        t - s.assign_urgent_minutes * 60e3, t - s.assign_done_minutes * 60e3)) {
      if (offering.has(a.id)) continue;
      ev(a.id, a.user_id, a.status === 'accepted' ? 'late' : 'missed');
      audit('sys', 'Boshliq agent', `Ko‘rilmadi (${fmtMin(reactLimit(a, s))}) — keyingi sotuvchiga`, { object: `conv:${a.conversation_id}`, data: one('SELECT name FROM users WHERE id=?', a.user_id)?.name });
      await missed(a, s);
      await offer(a.id, { again: true });
    }
    run(`UPDATE assignments SET status='failed' WHERE status='escalated' AND created_at<?`, t - 24 * 3600e3);
    // Rahbar ham Telegram’ga ulanmagan — «hech kim olmadi» xabari hech kimga yetmaydi. Mijoz unutilmasin:
    // har 30 daqiqada sotuvchilarga qaytadan (hammasi yana navbatda) taklif qilinadi
    if (!one(`SELECT 1 FROM users WHERE active=1 AND role IN ('rahbar','admin') AND tg_chat_id IS NOT NULL`)) {
      for (const a of all(`SELECT * FROM assignments WHERE status='escalated' ORDER BY id LIMIT 20`)) {
        const last = one('SELECT max(at) t FROM assignment_events WHERE assignment_id=?', a.id).t || a.created_at;
        if (t - last < REROUND_MS) continue;
        run(`UPDATE assignments SET status='queued', tried='[]' WHERE id=? AND status='escalated'`, a.id);
        audit('sys', 'Boshliq agent', 'Rahbar Telegram’ga ulanmagan — ish sotuvchilarga qayta taklif qilinmoqda', { object: `conv:${a.conversation_id}` });
        await offer(a.id, { again: true });
      }
    }
    await dailyReport(s);
  } finally { busy = false; }
}

/* ---------- sotuvchilar nazorati ---------- */
export const STATUS_L = { alo: 'A’lo', yaxshi: 'Yaxshi', etibor: 'E’tibor kerak', befarq: 'Befarq', kam: 'Ma’lumot kam' };
const clamp01 = x => Math.max(0, Math.min(1, x));

/* Davr bo‘yicha har sotuvchi: ish, ko‘rdi (javob berdi) ulushi va tezligi, ko‘rmadi, rad etdi, ball va tavsiya.
   Ball = 70% javob berish ulushi + 30% tezlik (javob muddatiga nisbatan), har rad etish −5 (ko‘pi bilan −20).
   3 tadan kam ishda baho berilmaydi. */
export function sellerStats(from, to = now(), s = getSettings()) {
  const users = all(`SELECT id,name,role,branch_id,tg_chat_id,tg_username,shift_dow,shift_from,shift_to,biz_seen_at,active_at FROM users WHERE active=1 AND role IN ('sotuvchi','filial') ORDER BY name`);
  const evs = all(`SELECT user_id, event, count(*) n, avg(ms) avg_ms FROM assignment_events WHERE at>=? AND at<? AND user_id IS NOT NULL GROUP BY user_id, event`, from, to);
  const resp = all(`SELECT user_id, count(DISTINCT assignment_id) n FROM assignment_events WHERE event IN ('accepted','done') AND at>=? AND at<? AND user_id IS NOT NULL GROUP BY user_id`, from, to);
  const replies = all(`SELECT user_id, count(*) n FROM messages WHERE author='seller' AND user_id IS NOT NULL AND created_at>=? AND created_at<? GROUP BY user_id`, from, to);
  return users.map(u => {
    const e = k => evs.find(x => x.user_id === u.id && x.event === k) || { n: 0, avg_ms: null };
    const offered = e('offered').n, missedN = e('missed').n + e('late').n, done = e('done').n, declined = e('declined').n;
    const responded = Math.min(offered || Infinity, resp.find(x => x.user_id === u.id)?.n || 0);
    const reactMin = e('done').avg_ms != null ? e('done').avg_ms / 60e3 : null;
    let score = null, status = 'kam', rec = null;
    if (offered) {
      const respRate = clamp01(responded / offered);
      const speed = reactMin == null ? 0 : clamp01(1 - reactMin / s.assign_done_minutes);
      score = Math.max(0, Math.round(100 * (0.7 * respRate + 0.3 * speed)) - Math.min(20, 5 * declined));
      if (offered >= 3) status = score >= 85 ? 'alo' : score >= 65 ? 'yaxshi' : score >= 45 ? 'etibor' : 'befarq';
      if (status === 'alo' && offered >= 5 && !missedN && !declined) rec = 'ragbat';
      else if (offered >= 3 && (status === 'befarq' || missedN >= ATTN_MISSES || declined >= 3)) rec = 'ogohlantirish';
    }
    return { id: u.id, name: u.name, role: u.role, linked: Boolean(u.tg_chat_id) || bizOpen(u), tg_username: u.tg_username, on_shift: onShift(u, now(), s),
      at_work: atWork(u), active_at: u.active_at, online: (u.active_at || 0) > now() - s.staff_active_minutes * 60e3,
      offered, responded, missed: missedN, declined, done, react_min: reactMin,
      replies: replies.find(x => x.user_id === u.id)?.n || 0, score, status, rec };
  });
}

export function openAssignments() {
  return all(`SELECT a.id, a.kind, a.title, a.body, a.status, a.attempts, a.urgent, a.via, a.created_at, a.offered_at, a.accepted_at, a.conversation_id,
      u.name AS user_name, c.display_name, c.handle, ac.channel
    FROM assignments a JOIN conversations c ON c.id=a.conversation_id JOIN accounts ac ON ac.id=c.account_id LEFT JOIN users u ON u.id=a.user_id
    WHERE a.status IN ${OPEN} ORDER BY a.created_at DESC LIMIT 100`);
}

/* Sotuvchi profili: natija (davr), izohlar (AI va tizim), rahbar bilan yozishma, ishlari va har biridagi o‘z qadami */
export function sellerProfile(userId, days = 30) {
  const u = one(`SELECT id,name,role,branch_id,phone,tg_username,tg_chat_id,biz_seen_at,active_at,shift_dow,shift_from,shift_to FROM users WHERE id=?`, Number(userId));
  if (!u) return null;
  const s = getSettings(), from = now() - days * 864e5;
  const stats = sellerStats(from, now(), s).find(r => r.id === u.id) || null;
  const steps = all(`SELECT assignment_id, group_concat(event, ',') evs, max(at) at FROM assignment_events WHERE user_id=? AND at>? GROUP BY assignment_id`, u.id, from);
  const tasks = steps.length ? all(`SELECT a.id, a.kind, a.body, a.status, a.urgent, a.conversation_id, c.display_name, c.handle, ac.channel
      FROM assignments a JOIN conversations c ON c.id=a.conversation_id JOIN accounts ac ON ac.id=c.account_id
      WHERE a.id IN (${steps.map(() => '?').join(',')})`, ...steps.map(x => x.assignment_id))
    .map(a => { const st = steps.find(x => x.assignment_id === a.id); return { ...a, steps: st.evs.split(','), at: st.at }; })
    .sort((x, y) => y.at - x.at).slice(0, 60) : [];
  return {
    user: { id: u.id, name: u.name, role: u.role, tg_username: u.tg_username, bot: Boolean(u.tg_chat_id), at_work: atWork(u), biz_open: bizOpen(u),
      active_at: u.active_at, online: (u.active_at || 0) > now() - s.staff_active_minutes * 60e3 },
    stats, tasks,
    notes: all(`SELECT id, kind, text, created_by, created_at, assignment_id FROM staff_notes WHERE user_id=? ORDER BY id DESC LIMIT 100`, u.id),
    messages: all(`SELECT id, dir, text, via, created_at FROM staff_messages WHERE user_id=? ORDER BY id DESC LIMIT 80`, u.id).reverse()
  };
}

const dayStart = date => Date.parse(`${date}T00:00:00+05:00`);
const mins = m => m == null ? '—' : `${Math.max(1, Math.round(m))} daq`;

/* Kun yakuni — har sotuvchiga o‘z natijasi bo‘yicha bitta gap, boshliq ohangida.
   Ibora navbat bilan almashadi: har kuni bir xil matn kelsa, xodim o‘qimay qo‘yadi. */
const DAY_WORDS = {
  alo: [
    'bugun zo‘r ishladingiz', 'bugungi natijangiz a’lo', 'bugun jamoadagi eng yaxshi natijalardan biri sizda',
    'bugun ishni qoyil qildingiz'],
  yaxshi: [
    'bugun yaxshi ishladingiz', 'bugungi natija yaxshi', 'bugun ish joyida bo‘ldi', 'bugun bardam ishladingiz'],
  etibor: [
    'bugun biroz sustroq ketdi', 'bugun e’tibor yetishmadi', 'bugungi natija o‘rtacha', 'bugun sur’at pasaydi'],
  befarq: [
    'bugun e’tiborsiz bo‘ldingiz', 'bugun ishlar ko‘p o‘tkazib yuborildi', 'bugun topshiriqlar javobsiz qoldi'],
  kam: ['bugun ish kam bo‘ldi']
};
const DAY_TAIL = {
  alo: ['Shu sur’atni saqlang.', 'Rahmat, shunday davom eting.', 'Ertaga ham shunday kutaman.'],
  yaxshi: ['Ertaga yana shunday.', 'Shu ohangda davom eting.', 'Yaxshi, biroz tezlashsa — a’lo bo‘ladi.'],
  etibor: ['Ertaga topshiriqni ko‘rganda darhol javob bering.', 'Ertaga tezroq javob bersangiz, natija ko‘tariladi.',
           'Ertaga e’tiborliroq bo‘ling.'],
  befarq: ['Ertaga e’tiborli bo‘ling — mijoz kutib qolmasin.', 'Ertaga buni tuzatamiz, topshiriqlarni o‘tkazib yubormang.',
           'Ertaga har topshiriqni ko‘rganda qabul qiling.'],
  kam: ['Ertaga ko‘proq ish bo‘ladi.']
};
const pickFor = (arr, seed) => arr[Math.abs(seed) % arr.length];

function dayWord(r, dateStr) {
  const nm = esc(firstName(r)), seed = r.id * 7 + Number(String(dateStr).replace(/-/g, '').slice(-4));
  const st = r.status in DAY_WORDS ? r.status : 'kam';
  if (!r.offered) return `${nm}, bugun mijozlarga ${r.replies} ta xabar yozdingiz, topshiriq bo‘lmadi. Ertaga ko‘rishamiz.`;
  const fact = `${r.offered} ta ish, ${r.responded} tasiga javob berdingiz` +
    (r.missed ? `, ${r.missed} tasini ko‘rmadingiz` : '') +
    (r.declined ? `, ${r.declined} tasini rad etdingiz` : '') +
    (r.react_min != null ? ` · o‘rtacha ${mins(r.react_min)}` : '');
  return `${nm}, ${pickFor(DAY_WORDS[st], seed)} — ${fact}. ${pickFor(DAY_TAIL[st], seed + 3)}`;
}

/* Kunlik hisobot: rahbarga — jamoa jadvali va tavsiyalar; har sotuvchiga — o‘z natijasi (ish kuni oxirida, jim vaqtdan oldin);
   profilga kunlik izoh yoziladi. */
async function dailyReport(s) {
  const l = local();
  if (l.hm < s.seller_report_time || kvGet('seller_report_date') === l.date) return;
  kvSet('seller_report_date', l.date);
  const rows = sellerStats(dayStart(l.date), now(), s).filter(r => r.offered || r.replies);
  if (!rows.length) return;
  rows.sort((x, y) => (y.score ?? -1) - (x.score ?? -1));
  const line = r => `${esc(r.name)} — ${r.offered} ish, ${r.responded} javob (o‘rt. ${mins(r.react_min)}), ${r.missed} ko‘rmadi, ${r.declined} rad etdi${r.replies ? `, mijozga ${r.replies} xabar` : ''} · <b>${STATUS_L[r.status]}</b>${r.score != null ? ` (${r.score})` : ''}`;
  const praise = rows.filter(r => r.rec === 'ragbat').map(r => esc(r.name)), warnList = rows.filter(r => r.rec === 'ogohlantirish').map(r => esc(r.name));
  const text = `<b>Sotuvchilar — bugungi natija (${l.date})</b>\n` + rows.map((r, i) => `${i + 1}. ${line(r)}`).join('\n') +
    (praise.length ? `\n\n<b>Rag‘batlantirish tavsiya etiladi:</b> ${praise.join(', ')}` : '') +
    (warnList.length ? `\n<b>Ogohlantirish kerak:</b> ${warnList.join(', ')}` : '') +
    `\n<a href="${config.publicUrl}/#sotuvchilar">Sotuvchilar sahifasi</a>`;
  for (const u of all(`SELECT * FROM users WHERE active=1 AND role IN ('rahbar','admin') AND tg_chat_id IS NOT NULL`)) await say(u, text, { channel: 'bot' });
  // Har sotuvchiga o‘z kuni — faqat Telegram’ga ulanganlariga (ish kuni oxiri: seller_report_time, jim vaqtdan oldin)
  for (const r of rows) {
    const su = one(`SELECT * FROM users WHERE id=? AND active=1 AND tg_chat_id IS NOT NULL`, r.id);
    if (su) await say(su, dayWord(r, l.date), { channel: 'bot' });
  }
  for (const r of rows) note(r.id, 'kunlik', `${l.date}: ${plain(line(r)).replace(/^[^—]+— /, '')}${r.rec === 'ragbat' ? ' — rag‘batlantirish tavsiya etildi' : r.rec === 'ogohlantirish' ? ' — ogohlantirish kerak' : ''}`);
  audit('sys', 'Boshliq agent', 'Kunlik sotuvchilar hisoboti', { result: `${rows.length} sotuvchi` });
}
