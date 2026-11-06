import { one, all, run, kvGet, kvSet } from '../db.js';
import { now, local, money, esc, currency, jparse, workDays } from '../util.js';
import { getSettings } from '../services/settings.js';
import { audit } from '../core/audit.js';
import { sendStaff } from '../channels/telegram.js';
import { config } from '../config.js';

/*
  Obyektiv — sotuv tahlilchisi (SOT 09, 10).
  - Fakt: BILLZ xaridlari; sof sotuv = sotuv − qaytarish (qaytarish sanasida ayiriladi).
  - Prognoz: fakt + qolgan kunlar kutilmasi (so‘nggi 8 hafta, hafta kuni bo‘yicha). Tarix kam — oddiy sur’at va past ishonch.
  - Reja: versiyalar saqlanadi, o‘tgan davr qulflanadi, reja 0 bo‘lsa foiz emas «reja belgilanmagan».
  - Xulosa: ko‘rsatkich, davr, sabab (gipoteza yoki dalil), tavsiya, mas’ul.
*/
const DAY = 864e5;
const pad = n => String(n).padStart(2, '0');
export const currentPeriod = () => local().date.slice(0, 7);
export function bounds(period) {
  const [y, m] = period.split('-').map(Number);
  const start = Date.parse(`${period}-01T00:00:00+05:00`);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${pad(m + 1)}`;
  const end = Date.parse(`${next}-01T00:00:00+05:00`);
  return { start, end, days: Math.round((end - start) / DAY) };
}
const dayKey = ts => local(ts).date;

/* Kunlik sof sotuv va cheklar (ixtiyoriy filtr: filial nomi yoki sotuvchi) */
function series(start, end, filter = {}) {
  const w = [], a = [];
  if (filter.branch) { w.push('lower(branch_name)=lower(?)'); a.push(filter.branch); }
  if (filter.seller) { w.push('lower(seller_name)=lower(?)'); a.push(filter.seller); }
  // BILLZ’dan haqiqiy ma’lumot bor bo‘lsa — demo qatorlar hisobga olinmaydi (aralashmasin)
  if (one('SELECT 1 FROM purchases WHERE is_demo=0 LIMIT 1')) w.push('is_demo=0');
  const where = w.length ? 'AND ' + w.join(' AND ') : '';
  const rows = all(`SELECT sold_at, returned_at, amount, receipt, is_demo, kind, order_type FROM purchases WHERE ((sold_at>=? AND sold_at<?) OR (returned_at>=? AND returned_at<?)) ${where}`, start, end, start, end, ...a);
  const days = new Map();
  const get = k => days.get(k) || (days.set(k, { gross: 0, returns: 0, receipts: new Set() }), days.get(k));
  let demo = rows.length > 0;
  for (const r of rows) {
    if (!r.is_demo) demo = false;
    // BILLZ qaytarishi — alohida qator (kind='return'): sotuvga ham, chek soniga ham qo‘shilmaydi, faqat qaytarish kuniga
    // «Обмен» (almashtirish) cheki summaga kiradi, lekin sotuv cheklari soniga emas (BILLZ orders_count kabi)
    if (r.kind !== 'return' && r.sold_at >= start && r.sold_at < end) { const d = get(dayKey(r.sold_at)); d.gross += r.amount; if (!/ОБМЕН|EXCHANGE/i.test(r.order_type || '')) d.receipts.add(r.receipt); }
    if (r.returned_at && r.returned_at >= start && r.returned_at < end) get(dayKey(r.returned_at)).returns += r.amount;
  }
  return { days, demo };
}

export function facts(period, filter = {}) {
  const b = bounds(period), t = now(), end = Math.min(b.end, t + 1);
  const { days, demo } = series(b.start, end, filter);
  let gross = 0, returns = 0; const receipts = new Set();
  for (const d of days.values()) { gross += d.gross; returns += d.returns; d.receipts.forEach(x => receipts.add(x)); }
  const net = gross - returns;
  const byDay = [];
  for (let i = 0; i < b.days; i++) {
    const k = local(b.start + i * DAY + 6 * 3600e3).date, d = days.get(k);
    byDay.push({ day: i + 1, date: k, net: d ? d.gross - d.returns : 0, future: b.start + i * DAY > t });
  }
  return { gross, returns, net, checks: receipts.size, avg_check: receipts.size ? Math.round(net / receipts.size) : null, byDay, demo, source: demo ? 'BILLZ (demo)' : 'BILLZ' };
}

/* Prognoz: hafta kuni bo‘yicha o‘rtacha (so‘nggi 8 hafta) */
export function forecast(period, filter = {}) {
  const b = bounds(period), t = now(), f = facts(period, filter);
  if (t >= b.end) return { ...f, expected: 0, forecast: f.net, low: f.net, high: f.net, confidence: 'yakunlangan', method: 'fakt' };
  const histStart = t - 56 * DAY;
  const { days } = series(histStart, Date.parse(`${local(t).date}T00:00:00+05:00`), filter);
  const byWd = Array.from({ length: 7 }, () => []);
  for (const [k, d] of days) byWd[new Date(`${k}T12:00:00+05:00`).getUTCDay()].push(d.gross - d.returns);
  const histDays = days.size;
  const elapsedDays = Math.max(1, (Math.min(t, b.end) - b.start) / DAY);
  const weeks = histDays / 7;
  let expected = 0, method, confidence;
  const todayKey = local(t).date;
  if (weeks >= 4) {
    // bo‘sh kunlar (savdo bo‘lmagan) ham hisobga olinadi: 8 haftada har hafta kuni ~8 marta
    const avg = wd => byWd[wd].reduce((a, x) => a + x, 0) / 8;
    for (let ts = Date.parse(`${todayKey}T12:00:00+05:00`); ts < b.end; ts += DAY) {
      const k = local(ts).date, wd = new Date(`${k}T12:00:00+05:00`).getUTCDay();
      if (k === todayKey) expected += Math.max(0, avg(wd) - (f.byDay.find(x => x.date === k)?.net || 0));
      else expected += avg(wd);
    }
    method = 'hafta kuni bo‘yicha o‘rtacha (8 hafta)'; confidence = weeks >= 7 ? 'o‘rta' : 'past';
  } else {
    expected = f.net / elapsedDays * Math.max(0, (b.end - t) / DAY);
    method = 'oddiy sur’at (tarix yetarli emas)'; confidence = 'past';
  }
  expected = Math.round(expected);
  const spread = confidence === 'o‘rta' ? 0.07 : 0.15;
  const fc = f.net + expected;
  return { ...f, expected, forecast: fc, low: Math.round(f.net + expected * (1 - spread * 2)), high: Math.round(f.net + expected * (1 + spread * 2)), confidence, method, history_days: histDays };
}

/* ---------- reja ---------- */
export function planOf(period, scope = 'company', key = '*') {
  return one(`SELECT * FROM plans WHERE period=? AND scope=? AND scope_key=? AND status='approved' ORDER BY version DESC LIMIT 1`, period, scope, key);
}
export const planVersions = (period, scope = 'company', key = '*') => all(`SELECT * FROM plans WHERE period=? AND scope=? AND scope_key=? ORDER BY version DESC`, period, scope, key);
const nextVersion = (period, scope, key) => (one(`SELECT max(version) v FROM plans WHERE period=? AND scope=? AND scope_key=?`, period, scope, key)?.v || 0) + 1;

export function setPlan({ period, scope = 'company', key = '*', revenue, checks = null }, who) {
  if (period < currentPeriod()) throw Object.assign(new Error('period_locked'), { status: 400 });
  const v = nextVersion(period, scope, key);
  run(`INSERT INTO plans(period,scope,scope_key,revenue,checks,version,status,basis,created_by,created_at) VALUES(?,?,?,?,?,?,'approved',?,?,?)`,
    period, scope, key, Math.max(0, Math.round(Number(revenue) || 0)), checks, v, 'Rahbar tasdiqladi', who, now());
  audit('staff', who, `Reja v${v} tasdiqlandi: ${period} · ${scope === 'company' ? 'kompaniya' : key} · ${money(revenue)}`);
  return v;
}

/* Tizim tavsiyasi: so‘nggi 3 to‘liq oy o‘rtachasi × shu oy kunlari (rahbar tasdiqlaydi) */
export function suggestPlan(period, who) {
  const b = bounds(period);
  let total = 0, daysTot = 0; const byBranch = new Map();
  for (let i = 1; i <= 3; i++) {
    const d = new Date(b.start); d.setUTCMonth(d.getUTCMonth() - i);
    const p = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
    const pb = bounds(p);
    const rows = all(`SELECT branch_name, sum(CASE WHEN kind='return' THEN -amount WHEN returned_at IS NULL THEN amount ELSE 0 END) s FROM purchases WHERE sold_at>=? AND sold_at<? GROUP BY branch_name`, pb.start, pb.end);
    for (const r of rows) { total += r.s; byBranch.set(r.branch_name || '—', (byBranch.get(r.branch_name || '—') || 0) + r.s); }
    daysTot += pb.days;
  }
  if (!total) return { ok: false, why: 'Tarixiy sotuv yo‘q — tavsiya uchun kamida 1 oylik BILLZ ma’lumoti kerak' };
  const unit = currency() === 'USD' ? 100 : 1e6; // reja yaxlitlash: 100 $ yoki 1 mln so‘m
  const perDay = total / daysTot, revenue = Math.round(perDay * b.days / unit) * unit;
  const v = nextVersion(period, 'company', '*');
  const basis = `3 oy o‘rtachasi ${money(Math.round(perDay))}/kun × ${b.days} kun`;
  run(`INSERT INTO plans(period,scope,scope_key,revenue,version,status,basis,created_by,created_at) VALUES(?,'company','*',?,?,'suggested',?,?,?)`, period, revenue, v, basis, who, now());
  const shares = [...byBranch].map(([k, s]) => ({ branch: k, revenue: Math.round(revenue * s / total / unit) * unit }));
  audit('ai', 'Tahlilchi', `Reja tavsiyasi ${period}: ${money(revenue)}`, { data: basis, result: 'Rahbar tasdig‘ini kutmoqda' });
  return { ok: true, revenue, basis, version: v, shares };
}

/* ---------- suhbat ko‘rsatkichlari (birinchi javob, javobsiz, AI yordami) ---------- */
export function convMetrics(start, end) {
  const msgs = all(`SELECT m.conversation_id, m.author, m.created_at, c.owner_user_id, c.branch_id, c.stage, c.lost_reason
    FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE m.created_at>=? AND m.created_at<? ORDER BY m.conversation_id, m.created_at`, start - DAY, end);
  const agg = new Map(), g = k => agg.get(k) || (agg.set(k, { convs: new Set(), first: [], firstHuman: [], late: 0, ai: new Set(), won: new Set(), lost: {} }), agg.get(k));
  let open = null;
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i], keys = [`u:${m.owner_user_id ?? 0}`, `b:${m.branch_id ?? 0}`, 'all'];
    if (i === 0 || msgs[i - 1].conversation_id !== m.conversation_id) open = null;
    if (m.created_at >= start) for (const k of keys) { const a = g(k); a.convs.add(m.conversation_id); if (m.author === 'ai') a.ai.add(m.conversation_id); if (m.stage === 5) a.won.add(m.conversation_id); if (m.lost_reason) a.lost[m.lost_reason] = (a.lost[m.lost_reason] || 0) + 1; }
    if (m.author === 'client') { if (!open) open = m.created_at; continue; }
    if (open && (m.author === 'seller' || m.author === 'ai') && open >= start) {
      const dt = (m.created_at - open) / 60e3;
      for (const k of keys) { const a = g(k); a.first.push(dt); if (m.author === 'seller') a.firstHuman.push(dt); if (dt > 30) a.late++; }
      open = null;
    }
  }
  // hali javob berilmagan va 30 daqiqadan oshganlar
  for (const c of all(`SELECT owner_user_id, branch_id, pending_since FROM conversations WHERE pending_since IS NOT NULL AND pending_since>=? AND pending_since<?`, start, end))
    if (now() - c.pending_since > 30 * 60e3) for (const k of [`u:${c.owner_user_id ?? 0}`, `b:${c.branch_id ?? 0}`, 'all']) g(k).late++;
  const med = xs => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return Math.round(s[Math.floor(s.length / 2)] * 10) / 10; };
  const out = {};
  for (const [k, a] of agg) out[k] = { convs: a.convs.size, first_median_min: med(a.first), first_human_median_min: med(a.firstHuman), late30: a.late, ai_assisted: a.ai.size, won: a.won.size,
    conversion: a.convs.size ? Math.round(a.won.size / a.convs.size * 100) : null, lost: a.lost };
  return out;
}

/* Mahsulot kesimi (TZ SOT 10): davr ichida sof savdo bo‘yicha tovarlar va toifalar. Qaytarish ayiriladi. */
export function topProducts(period, { by = 'product', limit = 12, branch = null, seller = null } = {}) {
  const b = bounds(period), end = Math.min(b.end, now() + 1);
  const key = by === 'category' ? `COALESCE(pr.category, '—')` : `COALESCE(pr.name, p.product_name)`;
  // Ko‘rish doirasi: filial rahbariga — o‘z filiali, sotuvchiga — o‘z savdosi
  const w = [], a = [];
  if (branch != null) { w.push('lower(p.branch_name)=lower(?)'); a.push(branch); }
  if (seller != null) { w.push('lower(p.seller_name)=lower(?)'); a.push(seller); }
  const extra = w.length ? 'AND ' + w.join(' AND ') : '';
  return all(`SELECT ${key} AS name, ${by === 'category' ? `'' AS category` : `COALESCE(pr.category,'') AS category`},
      sum(CASE WHEN p.kind='return' THEN -p.amount ELSE p.amount END) AS net,
      sum(CASE WHEN p.kind='return' THEN -p.qty ELSE p.qty END) AS qty,
      count(DISTINCT CASE WHEN p.kind='sale' THEN p.receipt END) AS checks,
      sum(CASE WHEN p.kind='return' THEN p.qty ELSE 0 END) AS returned
    FROM purchases p LEFT JOIN products pr ON pr.id=p.product_id
    WHERE p.is_demo=0 AND p.sold_at>=? AND p.sold_at<? ${extra} GROUP BY ${key} ORDER BY net DESC LIMIT ?`, b.start, end, ...a, limit);
}

/* ---------- panel uchun yig‘ma ---------- */
/* Ko‘rish doirasi (rollar): rahbar/admin — butun kompaniya; filial rahbari — o‘z filiali; sotuvchi — o‘z natijasi.
   Doira faqat panelda emas, ma’lumotning o‘zida cheklanadi: boshqa filialning raqami javobga umuman tushmaydi. */
export function scopeOf(user) {
  if (user.role === 'filial') {
    const br = user.branch_id ? one('SELECT id,name FROM branches WHERE id=?', user.branch_id) : null;
    return { kind: 'branch', name: br?.name ?? '', branch_id: br?.id ?? 0, label: br ? `${br.name} filiali` : 'Filial biriktirilmagan' };
  }
  if (user.role === 'sotuvchi') return { kind: 'user', name: user.name, user_id: user.id, label: 'Mening natijam' };
  return { kind: 'company', name: null, label: 'Kompaniya' };
}

export function dashboard(period, user) {
  const b = bounds(period), sc = scopeOf(user);
  const filter = sc.kind === 'branch' ? { branch: sc.name } : sc.kind === 'user' ? { seller: sc.name } : {};
  const fc = forecast(period, filter);
  const plan = sc.kind === 'company' ? planOf(period) : planOf(period, sc.kind, sc.name);
  const elapsed = Math.min(1, Math.max(0, (Math.min(now(), b.end) - b.start) / (b.end - b.start)));
  const cm = convMetrics(b.start, b.end);
  const convKey = sc.kind === 'branch' ? `b:${sc.branch_id}` : sc.kind === 'user' ? `u:${sc.user_id}` : 'all';

  // Filiallar bo‘limi: kompaniya — hammasi, filial rahbari — faqat o‘ziniki, sotuvchi — yo‘q
  const branchNames = sc.kind === 'user' ? []
    : sc.kind === 'branch' ? (sc.name ? [sc.name] : [])
      : [...new Set([...all('SELECT name FROM branches WHERE active=1').map(r => r.name),
        ...all(`SELECT DISTINCT branch_name FROM purchases WHERE branch_name IS NOT NULL AND sold_at>=? AND sold_at<?`, b.start, b.end).map(r => r.branch_name)])];
  // Filiallarni adolatli solishtirish (TZ SOT 09): ish kunlari va o‘sha filialdagi tovar mavjudligi hisobga olinadi
  const stockAt = new Map(); let withStock = 0;
  for (const p of all(`SELECT stock_json FROM products WHERE is_demo=0 AND billz_id IS NOT NULL`)) {
    const s = jparse(p.stock_json, {}) || {}; let any = false;
    for (const [bn, q] of Object.entries(s)) if (Number(q) > 0) { any = true; stockAt.set(bn, (stockAt.get(bn) || 0) + 1); }
    if (any) withStock++;
  }
  const branches = branchNames.map(name => {
    const f = forecast(period, { branch: name }), p = planOf(period, 'branch', name), br = one('SELECT * FROM branches WHERE lower(name)=lower(?)', name);
    const wd = workDays(br?.work_dow, b.start, Math.min(b.end, now()));
    return { id: br?.id ?? null, name, net: f.net, checks: f.checks, forecast: f.forecast, plan: p?.revenue ?? null, pct: p?.revenue ? Math.round(f.net / p.revenue * 1000) / 10 : null,
      conv: br ? cm[`b:${br.id}`] || null : null, kind: br?.kind || 'dokon',
      work_days: wd, per_day: wd ? Math.round(f.net / wd) : null,
      stock_share: withStock ? Math.round((stockAt.get(name) || 0) / withStock * 100) : null };
  });

  // Sotuvchilar: kompaniya — hammasi, filial — shu filialnikilar, sotuvchi — faqat o‘zi
  const soldHere = all(`SELECT DISTINCT seller_name FROM purchases WHERE seller_name IS NOT NULL AND sold_at>=? AND sold_at<?
      ${sc.kind === 'branch' ? 'AND lower(branch_name)=lower(?)' : ''}`, b.start, b.end, ...(sc.kind === 'branch' ? [sc.name] : [])).map(r => r.seller_name);
  const users = all(`SELECT id,name,branch_id FROM users WHERE active=1 AND role IN ('sotuvchi','filial')
      ${sc.kind === 'branch' ? 'AND branch_id=?' : ''}`, ...(sc.kind === 'branch' ? [sc.branch_id] : []));
  const sellerKeys = sc.kind === 'user' ? [user.name] : [...new Set([...users.map(u => u.name), ...soldHere])];
  const sellers = sellerKeys.map(name => {
    const u = users.find(x => x.name.toLowerCase() === name.toLowerCase()) || (sc.kind === 'user' ? { id: user.id } : null);
    const f = facts(period, { seller: name, ...(sc.kind === 'branch' ? { branch: sc.name } : {}) }), p = planOf(period, 'user', name);
    return { name, user_id: u?.id ?? null, net: f.net, checks: f.checks, plan: p?.revenue ?? null, pct: p?.revenue ? Math.round(f.net / p.revenue * 1000) / 10 : null,
      conv: u ? cm[`u:${u.id}`] || null : null,
      open_tasks: u ? one(`SELECT count(*) n FROM tasks WHERE user_id=? AND status='open'`, u.id).n : null };
  });

  // Xulosalar: shaxsiy — faqat egasiga; jamoa — rahbarga, filial rahbariga esa o‘z filiali va umumiylari
  const insights = sc.kind === 'user'
    ? all(`SELECT * FROM insights WHERE user_id=? ORDER BY id DESC LIMIT 12`, user.id)
    : sc.kind === 'branch'
      ? all(`SELECT * FROM insights WHERE (audience='team' AND (branch_id IS NULL OR branch_id=?)) OR user_id=? ORDER BY id DESC LIMIT 12`, sc.branch_id, user.id)
      : all(`SELECT * FROM insights WHERE audience='team' OR user_id=? ORDER BY id DESC LIMIT 12`, user.id);

  return {
    period, elapsed, as_of: now(), source: fc.source, scope: { kind: sc.kind, name: sc.name, label: sc.label },
    products: topProducts(period, { limit: 10, ...filter }), categories: topProducts(period, { by: 'category', limit: 8, ...filter }),
    company: { net: fc.net, gross: fc.gross, returns: fc.returns, checks: fc.checks, avg_check: fc.avg_check, forecast: fc.forecast, low: fc.low, high: fc.high, expected: fc.expected,
      confidence: fc.confidence, method: fc.method, plan: plan?.revenue ?? null, plan_version: plan?.version ?? null, pct: plan?.revenue ? Math.round(fc.net / plan.revenue * 1000) / 10 : null },
    series: fc.byDay, branches, sellers, conv: cm[convKey] || null,
    versions: sc.kind === 'company' ? planVersions(period) : planVersions(period, sc.kind, sc.name), insights
  };
}

/* ---------- xulosalar va ogohlantirishlar (har kuni) ---------- */
export async function dailyInsights({ force = false } = {}) {
  const s = getSettings(), l = local();
  if (!force && (l.hm < s.report_time || kvGet('insights_date') === l.date)) return null;
  kvSet('insights_date', l.date);
  const period = currentPeriod(), d = dashboard(period, { role: 'rahbar', id: 0 });
  const made = [];
  // Bir xil xulosa har kuni qayta qo‘shilmaydi: oxirgi 14 kunda shu nomli xulosa bo‘lsa — yangisi o‘rniga o‘sha yangilanadi (dalil va sana)
  const add = (x) => {
    // Takror — bir xil ko‘rsatkich (metric) shu filial/sotuvchi uchun; sarlavhadagi raqam har kuni o‘zgarishi mumkin
    const prev = one(`SELECT id FROM insights WHERE metric=? AND audience=? AND COALESCE(branch_id,0)=? AND COALESCE(user_id,0)=? AND at>? ORDER BY id DESC LIMIT 1`,
      x.metric, x.audience, x.branch_id ?? 0, x.user_id ?? 0, now() - 14 * 864e5);
    if (prev) run(`UPDATE insights SET at=?, title=?, evidence=?, cause=?, advice=?, period=? WHERE id=?`, now(), x.title, x.evidence, x.cause, x.advice, period, prev.id);
    else run(`INSERT INTO insights(at,audience,user_id,branch_id,title,metric,period,cause,evidence,hypothesis,advice,owner,source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      now(), x.audience, x.user_id ?? null, x.branch_id ?? null, x.title, x.metric, period, x.cause, x.evidence, x.hypothesis ? 1 : 0, x.advice, x.owner, 'qoida');
    made.push(x);
  };
  const c = d.company;
  if (c.plan && c.pct != null && c.pct < d.elapsed * 100 - 5)
    add({ audience: 'team', title: `Reja ortda: ${c.pct}% (oyning ${Math.round(d.elapsed * 100)}% o‘tdi)`, metric: 'Sof tushum / reja',
      cause: d.conv?.first_median_min > s.small_max_wait_minutes ? `Birinchi javob medianasi ${d.conv.first_median_min} daq` : 'Aniq sabab yo‘q — filiallarni ko‘ring',
      evidence: `Fakt ${money(c.net)}, reja ${money(c.plan)}, prognoz ${money(c.forecast)} (ishonch: ${c.confidence})`, hypothesis: true,
      advice: 'Ortda qolgan filial va sotuvchilarga qayta aloqa ro‘yxatini kuchaytirish', owner: 'Sotuv rahbari' });
  const shops = d.branches.filter(b => b.kind !== 'ombor');
  const bestStock = Math.max(0, ...shops.map(b => b.stock_share ?? 0));
  for (const b of shops) {
    if (b.plan && b.pct != null && b.pct < d.elapsed * 100 - 10)
      add({ audience: 'team', branch_id: b.id, title: `${b.name}: reja ${b.pct}%`, metric: 'Filial sof tushumi', cause: b.conv?.first_median_min > s.small_max_wait_minutes ? `Kech javob (mediana ${b.conv.first_median_min} daq)` : 'Murojaat, smena va tovar mavjudligini tekshiring',
        evidence: `Fakt ${money(b.net)} / reja ${money(b.plan)}; kuniga ${money(b.per_day)} (${b.work_days} ish kuni); 30+ daq javobsiz: ${b.conv?.late30 ?? '—'}`, hypothesis: true,
        advice: 'Kechki smenada «kechiksa» rejimini yoqish, qayta aloqa', owner: `${b.name} filial rahbari` });
    // Tovar mavjudligi: filialni sotuvchi bilan emas, assortiment bilan solishtirish (TZ SOT 09)
    if (b.stock_share != null && bestStock >= 40 && b.stock_share < bestStock / 2 && b.net > 0)
      add({ audience: 'team', branch_id: b.id, title: `${b.name}: katalogning atigi ${b.stock_share}% i bor`, metric: 'Tovar mavjudligi', cause: 'Assortiment tor — sotuv imkoniyati cheklangan', hypothesis: false,
        evidence: `${b.name}: ${b.stock_share}% · eng yaxshi filial: ${bestStock}% · kuniga ${money(b.per_day)} (${b.work_days} ish kuni)`,
        advice: 'Ko‘p so‘raladigan tovarlarni shu filialga ko‘chiring yoki ombordan yetkazishni kelishing', owner: `${b.name} filial rahbari` });
  }
  for (const sl of d.sellers) {
    if (!sl.user_id) continue;
    const bad = [];
    if (sl.conv?.first_human_median_min > s.small_max_wait_minutes) bad.push(`birinchi javob medianasi ${sl.conv.first_human_median_min} daq`);
    if (sl.open_tasks > 5) bad.push(`${sl.open_tasks} ta ochiq vazifa`);
    if (sl.plan && sl.pct != null && sl.pct < d.elapsed * 100 - 10) bad.push(`reja ${sl.pct}%`);
    if (bad.length) add({ audience: 'user', user_id: sl.user_id, title: `${sl.name}: ${bad.join(', ')}`, metric: 'Shaxsiy ko‘rsatkichlar', cause: null, evidence: bad.join('; '),
      hypothesis: false, advice: sl.open_tasks > 5 ? 'Bugun avval ochiq vazifalarni yoping: qayta aloqa ro‘yxati panelda' : 'Javob kechiksa, «kechiksa» rejimini yoqing — AI kutib turadi', owner: sl.name });
  }
  for (const x of made) {
    const targets = x.audience === 'user' ? [one('SELECT * FROM users WHERE id=?', x.user_id)]
      : all(`SELECT * FROM users WHERE active=1 AND (role IN ('rahbar','admin')${x.branch_id ? " OR (role='filial' AND branch_id=?)" : ''})`, ...(x.branch_id ? [x.branch_id] : []));
    for (const u of targets.filter(Boolean)) await sendStaff(u, `<b>${esc(x.title)}</b>\n${esc(x.evidence)}${x.cause ? `\n${x.hypothesis ? 'Gipoteza' : 'Sabab'}: ${esc(x.cause)}` : ''}\nTavsiya: ${esc(x.advice)}`,
      [[{ text: 'Reja va tahlil', url: `${config.publicUrl}/#tahlil` }]]);
  }
  audit('ai', 'Tahlilchi', `Kunlik xulosa: ${made.length} ta`, { data: `fakt ${money(c.net)} · prognoz ${money(c.forecast)}`, result: 'OK' });
  return made.length;
}
