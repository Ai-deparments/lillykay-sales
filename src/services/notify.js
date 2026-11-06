import { config } from '../config.js';
import { one, all, run, kvGet, kvSet } from '../db.js';
import { now, esc, clip, jparse, local, money, onDuty } from '../util.js';
import { getSettings } from './settings.js';
import { audit } from '../core/audit.js';
import { sendStaff } from '../channels/telegram.js';
import { assign, dispatchJob } from './dispatch.js';

/*
  Xodimlarga bildirishnomalar (Telegram). Kim oladi: suhbat egasi → filial xodimlari → rahbar.
  Telegram ulanmagan bo‘lsa ham hodisa panelda (vazifa sifatida) ko‘rinadi.
*/

const convUrl = c => `${config.publicUrl}/#suhbat/${c.id}`;
const who = c => esc(c.display_name || c.handle || `Suhbat #${c.id}`);
const chan = c => ({ tg: 'Telegram', ig: 'Instagram', demo: 'Demo' })[one('SELECT channel FROM accounts WHERE id=?', c.account_id)?.channel] || '';
/* Boshliq ovozi uchun: «Instagramdagi @ali_v» */
const place = c => `${({ tg: 'Telegramdagi', ig: 'Instagramdagi' })[one('SELECT channel FROM accounts WHERE id=?', c.account_id)?.channel] || ''} ${c.handle || c.display_name || 'mijoz'}`.trim();

const duty = u => onDuty({ dow: u.shift_dow, from: u.shift_from, to: u.shift_to });
function recipients(c) {
  if (c.owner_user_id) { const u = one('SELECT * FROM users WHERE id=? AND active=1', c.owner_user_id); if (u) return [u]; }
  if (c.branch_id) { const us = all(`SELECT * FROM users WHERE branch_id=? AND active=1 AND role IN ('filial','sotuvchi')`, c.branch_id); if (us.length) return us; }
  return all(`SELECT * FROM users WHERE active=1 AND role IN ('rahbar','admin')`);
}
/* Shoshilinch signal (katta buyurtma, kechikkan javob): mas’ul smenada bo‘lmasa — smenadagi filial sotuvchisi ham xabar oladi */
function urgentRecipients(c) {
  const base = recipients(c);
  if (base.some(duty)) return base;
  const onShift = c.branch_id ? all(`SELECT * FROM users WHERE branch_id=? AND active=1 AND role IN ('filial','sotuvchi')`, c.branch_id).filter(duty) : [];
  return onShift.length ? [...base, ...onShift.filter(u => !base.some(b => b.id === u.id))] : base;
}
const leaders = () => all(`SELECT * FROM users WHERE active=1 AND role IN ('rahbar','admin')`);

function task(kind, c, userId, title, body, dedup) {
  run(`INSERT OR IGNORE INTO tasks(kind,conversation_id,customer_id,user_id,title,body,due_at,created_by,created_at,dedup_key) VALUES(?,?,?,?,?,?,?,?,?,?)`,
    kind, c.id, c.customer_id, userId, title, body, now(), 'Muloqot agenti', now(), dedup);
}

export async function notify(kind, p) {
  const c = p.conv;
  if (!c) return;
  const rs = recipients(c);
  const open = [{ text: 'Suhbatni ochish', url: convUrl(c) }];
  if (kind === 'ai_sent') {
    const q = all(`SELECT text FROM messages WHERE conversation_id=? AND author='client' AND created_at>=? ORDER BY id`, c.id, p.draft.batch).map(m => m.text).join(' / ');
    const card = jparse(p.draft.card, {});
    const text = `<b>AI javob berdi</b> · ${who(c)} (${chan(c)})\n<b>Savol:</b> ${esc(clip(q, 300))}\n<b>Javob:</b> ${esc(clip(p.draft.text, 500))}\n` +
      (card.asked ? `<b>Tavsiya:</b> ${esc(clip(card.asked, 120))}\n` : '') + (card.next_step || c.next_step ? `<b>Keyingi qadam:</b> ${esc(clip(card.next_step || c.next_step, 160))}` : '');
    for (const u of rs) await sendStaff(u, text, [[...open, { text: 'O‘zim olaman', callback_data: `take:${c.id}` }]]);
  } else if (kind === 'big_order') {
    if (c.big_notified_at) { // bitta suhbat — bitta signal; AI keyinroq batafsil ro‘yxat bersa, faqat karta yangilanadi
      if ((p.order?.items || []).length) run('UPDATE conversations SET big_order_json=? WHERE id=?', JSON.stringify(p.order), c.id);
      return;
    }
    const s = getSettings(), items = p.order?.items || [];
    run('UPDATE conversations SET big_order=1, big_order_json=?, big_notified_at=?, heat=COALESCE(heat,\'issiq\') WHERE id=?', JSON.stringify(p.order || {}), now(), c.id);
    const urgent = urgentRecipients(c);
    const lines = items.slice(0, 12).map(i => `• ${esc(i.name)} — ${Number(i.qty) || 1} ${i.status !== 'aniq' ? '(' + esc(String(i.status || '').replace('_', ' ')) + ')' : ''}`).join('\n');
    const text = `<b>Katta buyurtma</b> · ${who(c)} (${chan(c)})\n` + (items.length ? `${items.length} pozitsiya · ${items.reduce((a, i) => a + i.qty, 0)} dona${p.order.corporate ? ' · korporativ' : ''}\n${lines}\n` : 'Uzun ro‘yxat yubordi (AI tahlili tayyor emas)\n') +
      (p.order?.estimated_total ? `Taxminan: ${money(p.order.estimated_total)} (taxmin, fakt emas)\n` : '') +
      `${s.big_accept_minutes} daqiqada qabul qiling, aks holda zaxira mas’ulga o‘tadi.`;
    for (const u of urgent) await sendStaff(u, text, [[{ text: 'Qabul qilaman', callback_data: `accept:${c.id}` }, ...open]]);
    task('big_order', c, rs[0]?.id ?? null, 'Katta buyurtma — qabul qiling', clip(items.map(i => `${i.name} × ${i.qty}`).join('; '), 500), `big:${c.id}`);
    audit('ai', 'Muloqot agenti', 'Katta buyurtma signali', { object: `conv:${c.id}`, data: `${items.length} pozitsiya`, result: `${rs.map(u => u.name).join(', ') || 'panel'}ga yuborildi` });
  } else if (kind === 'handoff') {
    // AI uzatdi: boshliq agent navbatdagi sotuvchiga topshiriq beradi (qabul qilinmasa — keyingisiga)
    const key = `handoff:${c.id}:${c.pending_since}`;
    if (kvGet(key)) return; kvSet(key, 1);
    task('handoff', c, null, 'Sotuvchiga uzatildi', clip(p.task || p.reason, 500), key);
    await assign({ conv: c, kind: p.kind || 'boshqa', task: p.task || p.reason, urgent: p.urgent === true });
  } else if (['send_failed', 'send_unknown', 'draft_failed', 'window_closed'].includes(kind)) {
    const msg = { send_failed: 'AI javobi yuborilmadi', send_unknown: 'AI javobi yuborilgan bo‘lishi mumkin — Telegram’da tekshiring, keyin javob bering',
      draft_failed: 'AI javob tayyorlay olmadi', window_closed: 'Kanal oynasi yopiq — AI yoza olmaydi' }[kind];
    const key = `${kind}:${c.id}:${c.pending_since}`;
    if (kvGet(key)) return; kvSet(key, 1);
    task(kind, c, null, msg, p.reason || null, key);
    const say = { send_failed: `${place(c)} ga javob ketmadi — o‘zingiz yozing`, send_unknown: `${place(c)} ga javob ketdimi, aniq emas — chatni tekshirib, kerak bo‘lsa yozing`,
      draft_failed: `${place(c)} ga o‘zingiz javob bering`, window_closed: `${place(c)} ga akkauntdan yozib bo‘lmayapti — boshqa yo‘l bilan (telefon) bog‘laning` }[kind];
    await assign({ conv: c, kind: 'javob', task: say });
  }
}

/* ---------- fon ishlari (har 30 soniya) ---------- */
async function escalateBigOrders() {
  const s = getSettings();
  const rows = all(`SELECT * FROM conversations WHERE big_order=1 AND big_accepted_by IS NULL AND big_escalated_at IS NULL AND big_notified_at<?`, now() - s.big_accept_minutes * 60e3);
  for (const c of rows) {
    run('UPDATE conversations SET big_escalated_at=? WHERE id=?', now(), c.id);
    const owner = c.owner_user_id && one('SELECT * FROM users WHERE id=?', c.owner_user_id);
    const backup = owner?.backup_user_id ? [one('SELECT * FROM users WHERE id=?', owner.backup_user_id)] : leaders();
    for (const u of backup.filter(Boolean)) await sendStaff(u, `<b>Katta buyurtma qabul qilinmadi</b> (${s.big_accept_minutes} daq) · ${who(c)}\nZaxira mas’ul sifatida siz oldingiz.`,
      [[{ text: 'Qabul qilaman', callback_data: `accept:${c.id}` }, { text: 'Suhbatni ochish', url: convUrl(c) }]]);
    audit('sys', 'Navbat', 'Katta buyurtma zaxira mas’ulga eskalatsiya qilindi', { object: `conv:${c.id}` });
  }
}

async function reminders() {
  for (const c of all('SELECT * FROM conversations WHERE remind_at IS NOT NULL AND remind_at<=?', now())) {
    run('UPDATE conversations SET remind_at=NULL WHERE id=?', c.id);
    const rs = recipients(c);
    task('reminder', c, rs[0]?.id ?? null, 'Mijozga qayta aloqa', c.remind_note, `rem:${c.id}:${c.remind_at}`);
    for (const u of rs) await sendStaff(u, `<b>Eslatma</b> · ${who(c)}\n${esc(c.remind_note || '')}`, [[{ text: 'Suhbatni ochish', url: convUrl(c) }]]);
  }
}

/* Bir xil jumla har safar takrorlansa, xodim o‘qimay qo‘yadi — matn navbat bilan almashadi.
   Kalit suhbat va kutish boshlangan vaqtdan olinadi: bitta hodisa uchun matn o‘zgarmaydi. */
const WAIT_LINES = [
  'Mijoz javobingizni kutyapti.', 'Mijoz hali javob olmadi.', 'Shu mijoz sizdan javob kutmoqda.',
  'Mijoz yozgan — javobsiz turibdi.', 'Mijozga hali hech kim javob bermadi.'];
const TASK_LINES = [
  (pl, m) => `${pl} ${m} daqiqadan beri javob kutyapti`,
  (pl, m) => `${pl} yozgan, ${m} daqiqa bo‘ldi — javobsiz`,
  (pl, m) => `${pl} javob kutmoqda (${m} daq)`,
  (pl, m) => `${pl} bilan suhbat ${m} daqiqa javobsiz turibdi`];
const varyKey = c => Math.abs((c.id || 0) * 3 + Math.floor((c.pending_since || 0) / 60e3));

/* Kechikkan kichik suhbatlar: AI javob bermaydigan (o‘chiq, kuzatish, sotuvchida, xato) va chegaradan oshgan —
   avval mas’ulga, ikki barobar oshsa rahbarga. Bir kutish davri uchun bir marta. */
async function lateReplies() {
  const s = getSettings(), lim = s.small_max_wait_minutes * 60e3, t = now();
  const rows = all(`SELECT c.* FROM conversations c WHERE c.pending_since IS NOT NULL AND c.ai_due_at IS NULL AND c.pending_since < ?
    AND NOT EXISTS (SELECT 1 FROM drafts d WHERE d.conversation_id=c.id AND d.batch=c.pending_since AND d.status IN ('preparing','sending') AND d.created_at>?)`, t - lim, t - 5 * 60e3);
  for (const c of rows) {
    const mins = Math.floor((t - c.pending_since) / 60e3);
    const k1 = `late1:${c.id}:${c.pending_since}`, k2 = `late2:${c.id}:${c.pending_since}`;
    if (!kvGet(k1)) {
      kvSet(k1, 1);
      // Mas’ul biriktirilgan va Telegram’ga ulangan bo‘lsa — o‘ziga eslatma; aks holda boshliq agent navbatdagi sotuvchiga topshiradi
      const own = c.owner_user_id && one('SELECT * FROM users WHERE id=? AND active=1 AND tg_chat_id IS NOT NULL', c.owner_user_id);
      if (own) await sendStaff(own, `<b>Javob kutilmoqda · ${mins} daq</b> · ${who(c)} (${chan(c)})\n${WAIT_LINES[varyKey(c) % WAIT_LINES.length]}`,
        [[{ text: 'Suhbatni ochish', url: convUrl(c) }]]);
      else await assign({ conv: c, kind: 'javob', task: TASK_LINES[varyKey(c) % TASK_LINES.length](place(c), mins) });
      audit('sys', 'Navbat', `Javob kechikdi: ${mins} daq — ${own ? 'mas’ulga eslatildi' : 'sotuvchiga topshiriq berildi'}`, { object: `conv:${c.id}` });
    } else if (!kvGet(k2) && t - c.pending_since > 2 * lim) {
      kvSet(k2, 1);
      for (const u of leaders()) await sendStaff(u, `<b>Javobsiz ${mins} daq</b> · ${who(c)} (${chan(c)})\nMas’ul: ${esc(one('SELECT name FROM users WHERE id=?', c.owner_user_id)?.name || 'biriktirilmagan')}`,
        [[{ text: 'Suhbatni ochish', url: convUrl(c) }]]);
      audit('sys', 'Navbat', `Javobsiz ${mins} daq — rahbarga eskalatsiya`, { object: `conv:${c.id}` });
    }
  }
}

/* Ertalabki topshirish: tunda AI javob bergan suhbatlar — qisqa mazmun va ustuvorlik bilan */
async function morningHandover() {
  const s = getSettings(), l = local();
  if (l.hm < s.morning_handover || kvGet('handover_date') === l.date) return;
  kvSet('handover_date', l.date);
  const since = now() - 16 * 3600e3;
  const rows = all(`SELECT * FROM conversations WHERE last_ai_at>? AND (last_seller_at IS NULL OR last_seller_at<last_ai_at) ORDER BY CASE heat WHEN 'issiq' THEN 0 WHEN 'iliq' THEN 1 ELSE 2 END, last_ai_at`, since);
  if (!rows.length) return;
  const byUser = new Map();
  for (const c of rows) for (const u of recipients(c)) { if (!byUser.has(u.id)) byUser.set(u.id, { u, list: [] }); byUser.get(u.id).list.push(c); }
  for (const { u, list } of byUser.values()) {
    const text = `<b>Ertalabki topshirish</b> · tungi suhbatlar: ${list.length}\n` + list.slice(0, 15).map((c, i) =>
      `${i + 1}. ${who(c)} — ${esc(clip(c.asked || 'savol', 60))}${c.heat ? ' · ' + c.heat : ''}${c.next_step ? '\n   Keyingi: ' + esc(clip(c.next_step, 80)) : ''}`).join('\n');
    await sendStaff(u, text, [[{ text: 'Panelni ochish', url: `${config.publicUrl}/#suhbatlar` }]]);
  }
  for (const c of rows) task('morning', c, recipients(c)[0]?.id ?? null, 'Tungi suhbatni davom ettiring', c.next_step, `morning:${c.id}:${l.date}`);
  audit('sys', 'Tizim', `Ertalabki topshirish: ${rows.length} suhbat`, { result: 'OK' });
}

/* Integratsiya nosozligi (BILLZ, Telegram, AI) — holat o‘zgarganda rahbarga bir marta xabar; tiklanganda ham.
   Zaxira nusxa 36 soatdan beri olinmagan bo‘lsa — ogohlantirish (kunlik timer ishlamay qolgan bo‘lishi mumkin). */
async function integrationWatch() {
  const names = { billz: 'BILLZ', telegram: 'Telegram', ai: 'AI (Claude)' };
  for (const r of all('SELECT name, state, detail FROM integrations')) {
    if (!names[r.name]) continue;
    const prev = kvGet(`int_state:${r.name}`);
    if (prev === r.state) continue;
    kvSet(`int_state:${r.name}`, r.state);
    if (!prev) continue; // birinchi ko‘rish — xabar emas
    if (r.state === 'error') {
      audit('sys', names[r.name], 'Ulanish uzildi', { result: r.detail });
      for (const u of leaders()) await sendStaff(u, `<b>${names[r.name]}: ulanish uzildi</b>\n${esc(clip(r.detail || '', 300))}`, [[{ text: 'Sozlamalar', url: `${config.publicUrl}/#sozlama` }]]);
    } else if (prev === 'error' && r.state === 'ok') {
      audit('sys', names[r.name], 'Ulanish tiklandi', { result: r.detail });
      for (const u of leaders()) await sendStaff(u, `<b>${names[r.name]}: ulanish tiklandi</b>\n${esc(clip(r.detail || '', 200))}`);
    }
  }
  const b = Number(kvGet('backup_at') || 0), t = now();
  if (b && t - b > 36 * 3600e3 && kvGet('backup_warned') !== String(local().date)) {
    kvSet('backup_warned', local().date);
    audit('sys', 'Tizim', 'Zaxira nusxa 36 soatdan beri olinmadi', { result: new Date(b).toISOString().slice(0, 16) });
    for (const u of leaders()) await sendStaff(u, `<b>Zaxira nusxa olinmadi</b>\nOxirgisi: ${new Date(b + 5 * 3600e3).toISOString().slice(0, 16).replace('T', ' ')} (Toshkent). Server jurnalini tekshirish kerak: <code>systemctl status sales-backup</code>`);
  }
}

/* Kunlik tozalash: bir martalik bildirishnoma belgilari (30 kundan eski), muddati o‘tgan sessiya va havolalar, fayl keshi (30 kun) */
async function cleanup() {
  const l = local();
  if (kvGet('cleanup_date') === l.date) return;
  kvSet('cleanup_date', l.date);
  const t = now(), old = t - 30 * 864e5;
  let n = 0;
  for (const { k } of all(`SELECT k FROM kv WHERE k GLOB '*:*:*'`)) {
    const ts = Number(k.split(':').pop());
    if (ts > 1e12 && ts < old) { run('DELETE FROM kv WHERE k=?', k); n++; }
  }
  run('DELETE FROM sessions WHERE expires_at<?', t);
  run('DELETE FROM tg_links WHERE expires_at<?', t);
  const { readdir, stat, unlink } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const dir = join(config.dataDir, 'files');
  let f = 0;
  for (const name of await readdir(dir).catch(() => [])) {
    const p = join(dir, name), st = await stat(p).catch(() => null);
    if (st?.isFile() && st.mtimeMs < old) { await unlink(p).catch(() => {}); f++; }
  }
  if (n || f) audit('sys', 'Tizim', 'Kunlik tozalash', { result: `${n} eski belgi, ${f} fayl` });
}

export function startJobs() {
  const t = setInterval(() => {
    escalateBigOrders().catch(e => console.error('escalate', e));
    reminders().catch(e => console.error('reminders', e));
    morningHandover().catch(e => console.error('handover', e));
    lateReplies().catch(e => console.error('late', e));
    integrationWatch().catch(e => console.error('intwatch', e));
    cleanup().catch(e => console.error('cleanup', e));
    dispatchJob().catch(e => console.error('dispatch', e));
  }, 30000);
  t.unref?.();
}
