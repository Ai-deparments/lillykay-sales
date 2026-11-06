/* Photobuy Sotuv Markazi — panel (ES module, tashqi kutubxonasiz) */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* Hisob valyutasi — Sozlamalar (BILLZ summalari shu valyutada; Photobuy — USD) */
const cur = () => S?.boot?.settings?.currency === 'USD' ? 'USD' : 'UZS';
const num = n => Math.round(n).toLocaleString('ru-RU').replace(/\u00a0/g, ' ');
const money = n => n == null ? '—' : cur() === 'USD' ? `${num(n)} $` : `${num(n)} so‘m`;
/* Keshbek kichik bo‘ladi ($0.40 ham uchraydi) — 100 dan kichik va kasrli summa ikki xona bilan ko‘rsatiladi */
const cash = n => { if (n == null) return '—'; const v = Math.abs(n) < 100 && n % 1 ? n.toFixed(2) : num(n);
  return cur() === 'USD' ? `${v} $` : `${v} so‘m`; };
const BIG = () => cur() === 'USD' ? { div: 1e3, label: 'ming $' } : { div: 1e6, label: 'mln so‘m' };
const pad = n => String(n).padStart(2, '0');
const TZ = 'Asia/Tashkent';
const fmtT = ts => ts ? new Date(ts).toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '';
const fmtD = ts => ts ? new Date(ts).toLocaleDateString('ru-RU', { timeZone: TZ, day: '2-digit', month: '2-digit', ...(new Date(ts).getFullYear() !== new Date().getFullYear() ? { year: '2-digit' } : {}) }) : '';
const fmtDT = ts => ts ? `${fmtD(ts)} ${fmtT(ts)}` : '';
const sameDay = (a, b) => fmtD(a) === fmtD(b);

/* ---------- ikonlar ---------- */
const IC = {
  chat: '<path d="M4 5.5h16v11H10l-4.5 3.5v-3.5H4z"/>',
  more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
  broom: '<path d="M14 3l7 7M11.5 5.5l7 7M8 9l7 7-4.5 4.5a2 2 0 0 1-2.8 0L3.5 16.3a2 2 0 0 1 0-2.8z"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6"/>',
  quyosh: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"/>',
  oy: '<path d="M20 13.5A8 8 0 0 1 10.5 4a8 8 0 1 0 9.5 9.5z"/>',
  tizim: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M9 20.5h6M12 17v3.5"/>',
  refresh: '<path d="M19.5 9A8 8 0 0 0 5 7.2M4.5 3.5v4h4M4.5 15A8 8 0 0 0 19 16.8M19.5 20.5v-4h-4"/>',
  book: '<path d="M5 4.5h10.5a2 2 0 0 1 2 2V20H7a2 2 0 0 1-2-2z"/><path d="M5 18a2 2 0 0 1 2-2h10.5M9 8.5h5"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c.8-3.4 3.2-5 6-5s5.2 1.6 6 5M16 5a3 3 0 0 1 0 6M18 15c1.5.6 2.6 2.2 3 5"/>',
  log: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  tg: '<path d="M20.5 4.5 3.5 11.2l5.6 1.9 2 6 3.1-3.9 4.6 3.4z"/><path d="m9.1 13.1 8.2-5.6"/>',
  ig: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r=".6"/>',
  demo: '<rect x="4" y="4" width="16" height="16" rx="3" stroke-dasharray="3 2.5"/><path d="M9 12h6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  phone: '<path d="M6.5 3.5h3l1.5 4-2 1.3a10 10 0 0 0 6.2 6.2l1.3-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4.5 5.5a2 2 0 0 1 2-2z"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  card: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.6-1.6 1.7-2.4 3-2.4s2.4.8 3 2.4M14 10h4M14 13h3"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  spark: '<path d="M13 2.5 5.5 13.5h6L10.5 21.5 18.5 10h-6z"/>',
  chart: '<path d="M4 20h16M7 20v-6M12 20V6M17 20v-9"/>',
  aperture: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5 16 12M19.36 7.75 14 15.46M19.36 16.25 10 15.46M12 20.5 8 12M4.64 16.25 10 8.54M4.64 7.75 14 8.54"/>',
  send: '<path d="M4.5 12h14M13 6.5l5.5 5.5-5.5 5.5"/>'
};
const svg = n => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${IC[n] || ''}</svg>`;
/* Haqiqiy rangli kanal belgilari (2026-10-09): Telegram — ko‘k doira oq samolyot bilan (Simple Icons, CC0), Instagram — rangli
   kvadratda oq kamera. Boshqa kanal (demo) — oddiy chiziqli belgi. chBadge — mijoz rasmi burchagidagi kichik belgi. */
const BRAND = {
  tg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#229ED9" d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>',
  ig: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" aria-hidden="true"><rect x="4.5" y="4.5" width="15" height="15" rx="4.5"/><circle cx="12" cy="12" r="3.4"/><circle cx="16.6" cy="7.4" r="1" fill="#fff" stroke="none"/></svg>'
};
const brand = ch => (BRAND[ch] ? `<span class="brand-ic b-${ch}">${BRAND[ch]}</span>` : svg(ch));
const chBadge = ch => (BRAND[ch] ? `<span class="ch ch-brand">${brand(ch)}</span>` : `<span class="ch">${svg(ch)}</span>`);
function paintIcons(root = document) {
  $$('[data-ic]', root).forEach(el => { if (!el.dataset.icDone) { el.insertAdjacentHTML('afterbegin', svg(el.dataset.ic)); el.dataset.icDone = 1; } });
  $$('[data-brand]', root).forEach(el => { if (!el.dataset.icDone) { el.insertAdjacentHTML('afterbegin', brand(el.dataset.brand)); el.dataset.icDone = 1; } });
}

/* ---------- API ---------- */
async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (r.status === 401) { location.href = '/login'; throw new Error('unauthorized'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok && !('ok' in j)) throw Object.assign(new Error(j.error || `HTTP ${r.status}`), { data: j });
  return j;
}
const ERR = {
  purchase_needs_confirmation: '«Xarid tasdiqlandi» faqat chek yoki xodim tasdig‘i bilan belgilanadi.', lost_needs_evidence: 'Yo‘qotish sababi uchun dalil yozing.',
  forbidden: 'Bu amal uchun ruxsat yo‘q.', login_taken: 'Bu login band.', bad_user: 'Login (3–32 lotin harf/raqam) va ismni to‘ldiring.', short_password: 'Parol kamida 8 belgi bo‘lsin.',
  period_locked: 'O‘tgan davr rejasi qulflangan — o‘zgartirib bo‘lmaydi.', rule_incomplete: 'Olgan va taklif mahsulotini hamda sababni kiriting.',
  bad_setting: 'Qiymat bo‘sh yoki ruxsat etilgan oraliqdan tashqarida — hech narsa saqlanmadi', bad_current_password: 'Joriy parol noto‘g‘ri.',
  own_role: 'O‘z rolingizni o‘zgartira olmaysiz.', own_delete: 'O‘zingizni o‘chira olmaysiz.',
  bad_photo: 'Rasm yaroqsiz — JPEG yoki PNG, 4 MB gacha.', bad_ad: 'Matn yoki rasm kerak.',
  bad_link: 'Havola https:// bilan boshlansin.',
  low_balance: 'AI balansi zaxiradan past — avval Google AI Studio‘da to‘ldiring va «To‘ldirdim» ni bosing.',
  bad_phone: 'Telefon raqami to‘g‘ri emas. Masalan: +998 90 123 45 67', login_taken: 'Bu raqam bilan xodim allaqachon bor.',
  invite_exists: 'Bu raqamga havola allaqachon berilgan — «Kutayotgan takliflar» ro‘yxatiga qarang.', csrf: 'So‘rov rad etildi — sahifani yangilang.', too_many: 'Juda ko‘p urinish — 10 daqiqadan keyin qayta urinib ko‘ring.',
  bad_tg_username: 'Telegram username: 4–32 lotin harf, raqam yoki _ (masalan @hilola_photobuy).', bad_tg_id: 'Telegram ID — faqat raqam (5–15 ta).',
  tg_taken: 'Bu Telegram username yoki ID boshqa xodimga biriktirilgan.'
};
function toast(text, kind = '') {
  const el = document.createElement('div'); el.className = 'toast ' + kind; el.textContent = text;
  $('#toasts').appendChild(el); setTimeout(() => el.remove(), 5000);
}
const fail = e => toast((ERR[e.message] || ERR[e.data?.error] || e.data?.why || e.message || 'Xato') + (e.data?.key ? ` (${e.data.key})` : ''), '');

/* ---------- holat ---------- */
const S = { boot: null, list: [], listNow: 0, offset: 0, sel: null, detail: null, detailSig: '', filter: 'all', ch: 'all', q: '', typingSent: 0, archivedTotal: 0, arch: null, archMore: false, found: null, older: 0, keepFromBottom: null, fresh: new Set(), listLoaded: false,
  sort: (() => { try { return localStorage.getItem('pb_sort') || 'navbat'; } catch { return 'navbat'; } })() };
const clockNow = () => Date.now() + S.offset;
const isLead = () => ['admin', 'rahbar'].includes(S.boot?.me.role);
/* Smena: hafta kunlari (Du…Ya) va ish vaqti. Bo‘sh — cheklov yo‘q */
const DOWN = ['Du', 'Se', 'Cho', 'Pa', 'Ju', 'Sha', 'Ya'];
const dowBoxes = (val, pre) => `<div class="chips" style="gap:4px">${DOWN.map((d, i) =>
  `<label class="chip" style="cursor:pointer"><input type="checkbox" name="${pre}${i}" ${(!val || val[i] === '1') ? 'checked' : ''} style="margin-inline-end:4px">${d}</label>`).join('')}</div>`;
const dowFrom = (d, pre) => DOWN.map((_, i) => d[`${pre}${i}`] ? '1' : '0').join('');
const shiftText = x => {
  const days = !x.shift_dow || x.shift_dow === '1111111' ? 'har kuni' : DOWN.filter((_, i) => x.shift_dow[i] === '1').join(' ');
  return x.shift_from && x.shift_to ? `${days} ${x.shift_from}–${x.shift_to}` : days;
};
const ROLE = { admin: 'Administrator', rahbar: 'Sotuv rahbari', filial: 'Filial rahbari', sotuvchi: 'Sotuvchi' };
const HEAT = { sovuq: { k: 'cold', x: 10 }, iliq: { k: 'mid', x: 50 }, issiq: { k: 'hot', x: 90 } };
const MODE_L = { doim: 'Doim', kechiksa: 'Kechiksa', ochiq: 'O‘chiq' };
const ROLL_L = { kuzatish: 'Kuzatish', tasdiq: 'Tasdiq bilan', avto: 'Avtomatik' };

async function loadBoot() {
  S.boot = await api('/api/bootstrap');
  S.offset = S.boot.now - Date.now();
  document.body.dataset.role = isLead() ? 'lead' : 'seller';
  $('#meBox').innerHTML = `<span class="me-ava" aria-hidden="true">${esc(initials(S.boot.me.name))}</span><span class="me-txt"><b>${esc(S.boot.me.name)}</b><span>${ROLE[S.boot.me.role]}${S.boot.me.tg_linked ? ' · Telegram ulangan' : ''}</span></span>`;
  renderTopStatus();
}
function renderTopStatus() {
  const i = S.boot.integrations, st = x => x.state === 'ok' ? '' : x.state === 'demo' || x.state === 'pending' ? 'warn' : 'bad';
  $('#topStatus').innerHTML =
    `<span class="status-chip" title="${esc(i.billz.detail)}"><span class="dot ${st(i.billz)}"></span>BILLZ${i.billz.state === 'demo' ? ' · demo' : ''}</span>` +
    `<span class="status-chip" title="${esc(i.telegram.detail)}"><span class="dot ${st(i.telegram)}"></span>${brand('tg')}Telegram</span>` +
    (i.instagram ? `<span class="status-chip" title="${esc(i.instagram.detail)}"><span class="dot ${st(i.instagram)}"></span>${brand('ig')}Instagram</span>` : '') +
    `<span class="status-chip" title="${esc(i.ai.detail)}"><span class="dot ${st(i.ai)}"></span>AI</span>` +
    (S.boot.demo ? '<span class="demo-chip">Demo ma’lumot yoqilgan</span>' : '');
}

/* =====================================================================
   SUHBATLAR
   ===================================================================== */
const FILTERS = [['all', 'Hammasi'], ['wait', 'Javob kutmoqda'], ['ai', 'AI kutmoqda'], ['mine', 'Menda'], ['big', 'Katta buyurtma'], ['demo', 'Demo'], ['arxiv', 'Arxiv']];
/* 2+ harf — serverdan qidiruv (jonli + arxiv: ism, @username, telefon, xabar matni); 1 harf — ro‘yxat ichida */
const serverSearch = () => S.q && S.q.length >= 2;
function passBase(c) {
  if (S.ch !== 'all' && c.channel !== S.ch) return false;
  if (S.q && !serverSearch() && !(`${c.name} ${c.handle || ''} ${c.last_text}`.toLowerCase().includes(S.q.toLowerCase()))) return false;
  return true;
}
function passF(c, f) {
  if (f === 'all') return true;
  if (f === 'wait') return Boolean(c.pending_since);
  if (f === 'ai') return Boolean(c.ai_due_at) || c.draft?.status === 'preparing' || c.draft?.status === 'ready';
  if (f === 'mine') return c.taken_by === S.boot.me.name || c.owner === S.boot.me.name;
  if (f === 'big') return Boolean(c.big_order);
  if (f === 'demo') return Boolean(c.is_demo);
  if (f === 'arxiv') return true;
}
let chipsHtml = '';
function renderChips() {
  const html = FILTERS.filter(([k]) => (k !== 'demo' || S.boot.demo) && (k !== 'arxiv' || S.archivedTotal)).map(([k, l]) => {
    const n = k === 'arxiv' ? S.archivedTotal.toLocaleString('ru-RU') : S.list.filter(c => passBase(c) && passF(c, k)).length;
    return `<button class="chip" type="button" data-f="${k}" aria-pressed="${S.filter === k}">${l}<span class="c">${n}</span></button>`;
  }).join('');
  // Har 3 soniyadagi yangilanishda o‘zgarmagan bo‘lsa qayta chizilmaydi — barmoq bilan surib turganda qator «sakramasin»
  if (html !== chipsHtml) { $('#fChips').innerHTML = chipsHtml = html; }
  chipEdges();
}
/* Chiplar bir qatorda yonga suriladi (Instagram toifalaridek): davomi bor tomon xira bo‘lib turadi */
function chipEdges() {
  const el = $('#fChips'), max = el.scrollWidth - el.clientWidth;
  el.dataset.more = [el.scrollLeft > 2 ? 'l' : '', el.scrollLeft < max - 2 ? 'r' : ''].join(' ').trim();
}
/* Tanlangan chip chetda yarim ko‘rinib qolsa — to‘liq ko‘rinadigan joyga suriladi */
function chipIntoView() {
  const el = $('#fChips'), c = $('[aria-pressed="true"]', el); if (!c) return;
  const r = c.getBoundingClientRect(), b = el.getBoundingClientRect(), pad = 28;
  if (r.left < b.left + pad) el.scrollBy({ left: r.left - b.left - pad, behavior: 'smooth' });
  else if (r.right > b.right - pad) el.scrollBy({ left: r.right - b.right + pad, behavior: 'smooth' });
}
const fmtLeft = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${pad(s % 60)}`; };
function pill(c) {
  const out = [];
  if (c.big_order && !c.big_accepted) out.push('<span class="pill acc">Katta buyurtma</span>');
  if (c.taken_by) out.push(`<span class="pill sel">${esc(c.taken_by)}</span>`);
  if (c.pending_since) {
    if (c.ai_due_at) out.push(`<span class="pill ai" data-due="${c.ai_due_at}">AI · ${fmtLeft(c.ai_due_at - clockNow())}</span>`);
    else if (c.draft?.status === 'preparing') out.push('<span class="pill ai">AI yozmoqda</span>');
    else if (c.overdue) out.push(`<span class="pill bad">Javobsiz ${c.wait_min} daq</span>`);
    else out.push(`<span class="pill warn">Kutmoqda ${c.wait_min} daq</span>`);
  } else if (c.last_author === 'ai') out.push('<span class="pill ai">AI javob berdi</span>');
  if (c.remind_at) out.push(`<span class="pill acc">Eslatma ${fmtD(c.remind_at)}</span>`);
  return out.join('');
}
const initials = n => String(n || '?').replace(/[@·]/g, ' ').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
// Mijozning profil rasmi (Telegram / Instagram) — bosh harflar ustida; yuklanmasa o‘chiriladi va bosh harflar ko‘rinadi
const avaImg = c => (c?.avatar ? `<img class="ava-img" src="${esc(c.avatar)}" alt="" loading="lazy" decoding="async">` : '');
document.addEventListener('error', e => { if (e.target?.classList?.contains('ava-img')) e.target.remove(); }, true);
// Chatdagi kun belgisi: «Bugun», «Kecha», qolgani sana
const dayLabel = ts => sameDay(ts, clockNow()) ? 'Bugun' : sameDay(ts, clockNow() - 864e5) ? 'Kecha' : fmtD(ts);
/* Panel ko‘rinishi uchun (mijozga ketgan matn o‘zgarmaydi): AI va sotuvchi xabarida narx ajralib tursin,
   «Tovar nomi — narx, izoh» qatorida tovar nomi qalin. Matn avval esc() qilinadi, keyin faqat raqam va belgi o‘raladi. */
const PRICE_RE = /(\$\s?\d{1,3}(?:[ ,]\d{3})*(?:\.\d{1,2})?|\d{1,3}(?:[  .,]\d{3})+(?:[.,]\d{1,2})?\s?(?:\$|so(?:‘|’|ʻ|`|&#39;)?m\b|сум)|\d+(?:[.,]\d{1,2})?\s?(?:\$|so(?:‘|’|ʻ|`|&#39;)?m\b|сум))/gi;
const richText = t => esc(t).split('\n').map(line => {
  const p = line.replace(PRICE_RE, '<b class="price">$1</b>');
  return p === line ? line : p.replace(/^(\s*(?:[•·–-]\s*)?)([^—<\n]{2,80}?)(\s[—–-]\s)(?=.*class="price")/, '$1<b class="pname">$2</b>$3');
}).join('\n');
function renderList() {
  renderChips();
  const src = serverSearch() ? (S.found || []) : S.filter === 'arxiv' ? (S.arch || []) : S.list;
  const items = src.filter(c => passBase(c) && (src !== S.list || passF(c, S.filter)));
  // «Yangilari yuqorida» — Telegram’dagidek oxirgi xabar bo‘yicha; aks holda navbat (eng uzoq kutayotgan birinchi)
  if (src === S.list && S.sort === 'yangi') items.sort((a, b) => (b.last_at || 0) - (a.last_at || 0));
  $('#convList').innerHTML = items.map(c => `
    <button class="conv${S.fresh.has(c.id) ? ' fresh' : ''}" type="button" data-id="${c.id}" aria-current="${c.id === S.sel}">
      <span class="avatar">${esc(initials(c.name))}${avaImg(c)}${chBadge(c.channel)}</span>
      <span class="conv-name">${esc(c.name)} ${c.is_demo ? '<span class="demo-tag">demo</span>' : ''}</span>
      <span class="conv-time">${sameDay(c.last_at, clockNow()) ? fmtT(c.last_at) : fmtD(c.last_at)}</span>
      <span class="conv-snip">${c.last_author === 'seller' ? `<b class="who-s">${c.last_user_id && c.last_user_id === S.boot.me.id ? 'Siz' : 'Sotuvchi'}:</b> ` : c.last_author === 'ai' ? '<b class="who-ai">AI:</b> ' : ''}${esc(c.last_text)}</span>
      <span class="conv-meta">${S.fresh.has(c.id) ? '<span class="pill ok">Yangi xabar</span>' : ''}${c.heat ? `<span class="heat" style="background:var(--wb-${HEAT[c.heat].k})" title="Qiziqish: ${c.heat}"></span>` : ''}${pill(c)}<span class="conv-fil">${esc(c.branch || c.account || '')}</span></span>
    </button>`).join('') + (src === S.arch && S.archMore && !serverSearch() ? '<button class="btn sm more-btn" type="button" data-act="archMore">Yana 200 ta eski yozishma</button>' : '')
    || `<div class="empty">${serverSearch() ? (S.found ? 'Hech narsa topilmadi.' : 'Qidirilmoqda…') : src === S.arch ? (S.arch ? 'Arxiv bo‘sh.' : 'Yuklanmoqda…') : S.list.length ? 'Bu filtrda suhbat yo‘q.' : S.archivedTotal ? `Hozir jonli suhbat yo‘q. Eski yozishmalar (${S.archivedTotal.toLocaleString('ru-RU')} ta) — «Arxiv»da.` : 'Hozircha suhbat yo‘q. Telegram Business ulanganda mijoz xabarlari shu yerga keladi.'}</div>`;
  const sn = $('#sortNote'); // ixcham ko‘rinishda bir qatorga sig‘masa «…» bilan qisqaradi — to‘liq matni ustiga olib borilganda chiqadi
  sn.textContent = sn.title = serverSearch() ? 'Qidiruv: ism, @username, telefon va xabar matni — jonli va arxivdan' : S.filter === 'arxiv' ? 'Arxiv: Telegram eksportidan yuklangan eski yozishmalar, so‘nggisi birinchi'
    : S.sort === 'yangi' ? 'Oxirgi xabar bo‘yicha — yangilari yuqorida' : 'Navbat: javob kutayotganlar, katta buyurtmalar, kutish vaqti';
  $('#sortBtn').hidden = serverSearch() || S.filter === 'arxiv';
  $('#sortBtn').textContent = S.sort === 'yangi' ? 'Navbat tartibi' : 'Yangilari yuqorida';
  const waiting = S.list.filter(c => c.overdue).length;
  $('#badgeWait').hidden = !waiting; $('#badgeWait').textContent = waiting;
}

async function loadList() {
  const r = await api('/api/conversations');
  // Yangi mijoz xabari: ro‘yxatda belgi + qisqa bildirishnoma (ochiq turgan suhbatdan tashqari)
  const prev = new Map(S.list.map(c => [c.id, c.last_at])), news = [];
  for (const c of r.items) if (S.listLoaded && c.last_author === 'client' && c.id !== S.sel && (prev.get(c.id) ?? 0) < c.last_at) { S.fresh.add(c.id); news.push(c.name); }
  S.list = r.items; S.offset = r.now - Date.now(); S.archivedTotal = r.archived_total || 0; S.listLoaded = true;
  if (news.length) toast(`Yangi xabar: ${news.slice(0, 2).join(', ')}${news.length > 2 ? ` va yana ${news.length - 2}` : ''}`);
  renderList();
}
/* Arxiv: Telegram eksportidan yuklangan eski yozishmalar — 200 tadan, so‘nggisi birinchi */
async function loadArch(more = false) {
  const before = more && S.arch?.length ? S.arch.at(-1).last_at : '';
  const r = await api(`/api/conversations?arxiv=1${before ? `&before=${before}` : ''}`);
  S.arch = more ? [...(S.arch || []), ...r.items] : r.items; S.archMore = r.more; S.archivedTotal = r.archived_total || 0;
  renderList();
}
let searchTimer = null, searchSeq = 0;
function runSearch() {
  clearTimeout(searchTimer);
  if (!serverSearch()) { S.found = null; return; }
  S.found = null;
  searchTimer = setTimeout(async () => {
    const seq = ++searchSeq, q = S.q;
    const r = await api(`/api/conversations?q=${encodeURIComponent(q)}`).catch(() => null);
    if (seq !== searchSeq || q !== S.q) return;
    S.found = r ? r.items : []; renderList();
  }, 250);
}

/* ---------- ochiq suhbat ---------- */
async function openConv(id, { quiet = false } = {}) {
  if (S.sel !== id) { S.sel = id; S.detailSig = ''; S.detail = null; S.older = 0; }
  S.fresh.delete(id);
  const d = await api(`/api/conversations/${id}${S.older ? `?older=${S.older}` : ''}`);
  if (S.sel !== id) return;
  S.offset = d.now - Date.now();
  const sig = JSON.stringify([d.messages.length, d.messages_total, d.messages.at(-1)?.id, d.messages.filter(m => m.meta?.edited_at || m.meta?.deleted_at).map(m => m.id + ':' + (m.meta.edited_at || '') + (m.meta.deleted_at || '')).join(','), d.drafts.map(x => x.id + x.status), d.conv, d.effective.mode, d.effective.rollout, d.tasks.length, d.customer.verified]);
  const first = !S.detail || S.detail.conv.id !== id;
  S.detail = d;
  if (first) renderThreadShell();
  if (sig !== S.detailSig) { S.detailSig = sig; renderThreadBody(); renderCard(); }
  if (!quiet) renderList();
}

function renderThreadShell() {
  const d = S.detail, c = d.conv;
  $('#thread').innerHTML = `
    <div class="thread-head">
      <button class="btn ghost icon only-mobile" type="button" data-act="back" aria-label="Orqaga">${svg('back')}</button>
      <span class="avatar th-ava" id="thAva" aria-hidden="true"></span>
      <div class="th-id"><div class="thread-title" id="thTitle"></div><div class="thread-sub" id="thSub"></div></div>
      <div class="thread-actions" id="thActions"></div>
    </div>
    <div class="msgs" id="msgs"></div>
    <div class="composer">
      <div class="composer-row">
        <textarea id="compose" rows="1" placeholder="Javob yozing…"></textarea>
        <button class="btn primary send-btn" type="button" data-act="send" title="Yuborish (Enter)">${svg('send')}<span>Yuborish</span></button>
      </div>
      <div class="composer-hint" id="compHint">Enter — yuborish · Shift+Enter — yangi qator · yoza boshlasangiz AI kutadi</div>
    </div>`;
  $('#inbox').classList.add('open-thread');
}

function draftBlock(d) {
  const e = d.effective, dr = d.drafts[0], c = d.conv;
  if (!dr || !c.pending_since || dr.batch !== c.pending_since) {
    const lastCancelled = d.drafts.find(x => x.batch === c.pending_since && x.status === 'cancelled');
    if (lastCancelled) return `<div class="sys">AI qoralamasi bekor qilindi — ${esc(lastCancelled.reason || '')}</div>`;
    return e.ai === false && c.pending_since ? '<div class="sys">AI agent bu kanalda to‘xtatilgan — javobni sotuvchi yozadi</div>' : '';
  }
  if (dr.status === 'preparing') return '<div class="draft-status">AI javob qoralamasini tayyorlamoqda…</div>';
  if (dr.status === 'failed') {
    const why = dr.reason === 'no_ai_key' ? 'AI kaliti kiritilmagan — javobni sotuvchi yozadi.' : esc(dr.reason);
    return `<div class="sys warn">AI qoralama tayyorlamadi: ${why}</div>`;
  }
  if (dr.status === 'cancelled' || dr.status === 'superseded') return `<div class="sys">AI qoralamasi bekor qilindi — ${esc(dr.reason || 'yangi xabar keldi')}</div>`;
  if (dr.status === 'sending') return '<div class="draft-status">AI javobi yuborilmoqda…</div>';
  if (dr.status !== 'ready') return '';
  const due = c.ai_due_at;
  const C = 2 * Math.PI * 15, frac = due ? Math.max(0, Math.min(1, (due - clockNow()) / (e.T * 1000))) : 0;
  const title = e.rollout === 'kuzatish' ? '<b style="font-family:inherit">Kuzatish rejimi</b> — bu javob mijozga yuborilmaydi, faqat baholash uchun'
    : e.rollout === 'tasdiq' ? 'AI javobi tayyor — <b style="font-family:inherit">sotuvchi tasdiqlasa</b> yuboriladi'
    : c.taken_by ? 'Suhbat sotuvchida — AI yubormaydi'
    : e.mode === 'ochiq' ? 'Avtojavob o‘chiq — AI yubormaydi, qoralama taklif sifatida'
    : due ? `AI javobi tayyor · <b id="tLeft">${fmtLeft(due - clockNow())}</b> dan keyin yuboriladi, agar sotuvchi javob bermasa`
    : 'AI javobi tayyor';
  return `<div class="draft" id="draft">
    <div class="draft-head">
      ${due ? `<svg class="ring" viewBox="0 0 40 40" aria-hidden="true"><circle class="bg" cx="20" cy="20" r="15"/><circle class="fg" id="ringFg" data-due="${due}" data-t="${e.T}" cx="20" cy="20" r="15" stroke-dasharray="${C.toFixed(2)}" stroke-dashoffset="${(C * (1 - frac)).toFixed(2)}" transform="rotate(-90 20 20)"/></svg>` : ''}
      <div><div class="draft-title">${title}</div><div class="draft-sub">Rejim: ${MODE_L[e.mode]}${e.mode === 'kechiksa' ? ` · T = ${e.T} s` : ''}${e.night ? ' · tungi vaqt' : ''} · bosqich: ${ROLL_L[e.rollout]}</div></div>
    </div>
    ${dr.photos?.length ? `<div class="draft-photo">${dr.photos.map(ph => `<img src="/api/products/${ph.id}/photo" alt="${esc(ph.name)}" title="${esc(ph.name)}" loading="lazy">`).join('')}<span>Javobga ${dr.photos.length} ta rasm biriktirilgan: ${esc(dr.photos.map(ph => ph.name.split('—')[0].trim()).join(', '))}</span></div>` : ''}
    <div class="draft-body">${esc(dr.text)}</div>
    ${dr.sources.length ? `<div class="src">${dr.sources.slice(0, 3).map(s => `<span>${esc(s)}</span>`).join('')}${dr.sources.length > 3 ? `<span class="muted">… yana ${dr.sources.length - 3} ta manba</span>` : ''}</div>` : ''}
    <div class="draft-actions">
      ${e.rollout !== 'kuzatish' ? `<button class="btn sm ai" type="button" data-act="approve" data-id="${dr.id}">Hozir yuborish</button>` : ''}
      <button class="btn sm" type="button" data-act="edit" data-id="${dr.id}">Tahrirlab o‘zim yuboraman</button>
      <button class="btn sm ghost" type="button" data-act="cancelDraft" data-id="${dr.id}">Bekor qilish</button>
      ${S.boot.me.role !== 'sotuvchi' ? `<button class="btn sm ghost" type="button" data-act="teach" data-id="${dr.id}" title="To‘g‘ri javobni yozing — agent keyingi safar shunday javob beradi">O‘rgatish</button>` : ''}
      <span style="margin-left:auto" class="row-actions"><span class="muted" style="font-size:12px">Baho:</span>
        <button class="btn sm ${dr.rating === 'good' ? 'primary' : ''}" type="button" data-act="rate" data-r="good" data-id="${dr.id}">Yaxshi</button>
        <button class="btn sm ${dr.rating === 'bad' ? 'primary' : ''}" type="button" data-act="rate" data-r="bad" data-id="${dr.id}">Yomon</button></span>
    </div></div>`;
}

function renderThreadBody() {
  const d = S.detail, c = d.conv, a = d.account, e = d.effective;
  $('#thTitle').innerHTML = `${esc(c.name)} ${c.is_demo ? '<span class="demo-tag">demo</span>' : ''}`;
  $('#thAva').innerHTML = `${esc(initials(c.name))}${avaImg(c)}${chBadge(a.channel)}`;
  $('#thSub').innerHTML = `<span class="th-acc">${brand(a.channel)}${esc(a.name)}</span><span class="th-sep" aria-hidden="true"></span><span>${esc(c.branch || 'filial belgilanmagan')}</span><span class="th-sep" aria-hidden="true"></span><span>Mas’ul: ${esc(c.owner || '—')}</span>`;
  const accDef = `Akkaunt bo‘yicha — ${MODE_L[a.mode].toLowerCase()}`;
  // Rahbar/admin: tarixni tozalash va suhbatni o‘chirish (paneldan; mijoz tomonida yozishma qoladi)
  const manage = isLead() ? `<span class="menu-wrap"><button class="btn sm icon ghost" type="button" data-act="menu" title="Boshqa amallar" aria-haspopup="true">${svg('more')}</button>
    <span class="menu" hidden>
      <button type="button" data-act="clear">${svg('broom')}<span>Tarixni tozalash<small>xabarlar o‘chadi, karta qoladi</small></span></button>
      <button type="button" class="danger" data-act="delete">${svg('trash')}<span>Chatni o‘chirish<small>butunlay, qaytarib bo‘lmaydi</small></span></button>
    </span></span>` : '';
  $('#thActions').innerHTML = c.archived ? `<span class="pill">Arxiv</span>${manage}<button class="btn only-narrow" type="button" data-act="card">${svg('card')} Karta</button>` : `
    <label class="mode"><span>Avtojavob</span><select id="modeSel">
      ${[['inherit', accDef], ['doim', 'Bu suhbatda — doim'], ['kechiksa', 'Bu suhbatda — kechiksa'], ['ochiq', 'Bu suhbatda — o‘chiq']].map(([v, l]) => `<option value="${v}" ${c.mode === v ? 'selected' : ''}>${l}</option>`).join('')}
    </select></label>
    ${c.taken_by ? `<span class="pill acc">Sotuvchida: ${esc(c.taken_by)}</span><button class="btn sm" type="button" data-act="release">AI’ga qaytarish</button>`
      : '<button class="btn primary" type="button" data-act="take">O‘zim olaman</button>'}
    ${a.is_demo && isLead() ? '<button class="btn sm" type="button" data-act="simulate">Mijoz sifatida yozish</button>' : ''}
    <button class="btn sm" type="button" data-act="photo">Tovar rasmi</button>
    ${manage}
    <button class="btn only-narrow" type="button" data-act="card">${svg('card')} Karta</button>`;
  $('#thread .composer').hidden = Boolean(c.archived);
  const box = $('#msgs');
  const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
  let lastDay = '';
  const parts = [];
  if (c.archived) parts.push(`<div class="sys">Eski yozishma — Telegram eksportidan yuklangan (${d.messages_total.toLocaleString('ru-RU')} xabar). Mijoz qayta yozsa, suhbat jonli ro‘yxatga o‘tadi va AI shu tarixni biladi.</div>`);
  if (d.messages_total > d.messages.length) parts.push(`<button class="btn sm more-btn" type="button" data-act="older">Oldingi xabarlar — yana ${Math.min(300, d.messages_total - d.messages.length)} ta (jami ${d.messages_total.toLocaleString('ru-RU')})</button>`);
  else if (!e.channel_open && a.channel !== 'demo' && !c.archived) parts.push(`<div class="sys warn">${a.can_reply ? 'Telegram’ning 24 soatlik oynasi yopiq — bot bu chatga yoza olmaydi. Mijozga sotuvchi o‘z ilovasidan yozadi.' : 'Business ulanishda «javob berish» huquqi yo‘q — Telegram sozlamasidan bering.'}</div>`);
  // Bir kishining ketma-ket xabarlari (5 daqiqa ichida) — bitta guruh: ism faqat birinchisida, holat faqat oxirgisida
  const keyOf = m => m.author === 'seller' ? 's:' + (m.user_name || '') : m.author;
  const near = (x, y) => Boolean(x && y && x.author !== 'system' && keyOf(x) === keyOf(y)
    && fmtD(x.created_at) === fmtD(y.created_at) && Math.abs(y.created_at - x.created_at) < 5 * 60e3);
  const list = d.messages;
  for (let i = 0; i < list.length; i++) {
    const m = list[i], cont = near(list[i - 1], m), more = near(m, list[i + 1]);
    const day = fmtD(m.created_at);
    if (day !== lastDay) { parts.push(`<div class="day">${dayLabel(m.created_at)}</div>`); lastDay = day; }
    if (m.author === 'system') { parts.push(`<div class="sys">${m.meta?.offline ? 'Telegram avtojavobi (sotuvchi javobi emas): ' : ''}${esc(m.text)}</div>`); continue; }
    const k = m.author === 'client' ? 'c' : m.author === 'seller' ? 's' : 'ai';
    const grp = cont ? (more ? ' g-mid' : ' g-last') : (more ? ' g-first' : '');
    // Bitta savolga javob: kim yozdi — AI yoki sotuvchi. Ismi ma’lum bo‘lsa ism, bo‘lmasa shunchaki «Sotuvchi».
    // Qaysi ilovadan yozilgani ko‘rsatilmaydi — panelni ochgan odamga bu kerak emas.
    const who = cont ? '' : m.author === 'ai' ? 'AI' : m.author === 'seller' ? (m.meta?.imported ? a.name : m.user_name || 'Sotuvchi') : '';
    // «kechiksa · T tugagach» kabi ichki jargon o‘rniga: odam tasdiqladimi yoki o‘zi ketdimi (guruhda — faqat oxirgisida)
    const tag = !more && m.author === 'ai' && m.meta?.tag
      ? `<span class="tag">${/tasdiqla/i.test(m.meta.tag) ? esc(m.meta.tag) : 'avtomatik yuborildi'}</span>` : '';
    const md = m.meta?.media;
    const media = !md ? '' : md.kind === 'photo' ? `<a href="/api/files/${m.id}" target="_blank" rel="noopener"><img class="msg-img" src="/api/files/${m.id}" alt="Mijoz yuborgan rasm" loading="lazy"></a>`
      : md.kind === 'voice' || md.kind === 'audio' ? `<audio controls preload="none" src="/api/files/${m.id}"></audio>`
      : `<a class="btn sm" href="/api/files/${m.id}" target="_blank" rel="noopener">${md.kind === 'document' ? 'Faylni ochish' : 'Videoni ochish'}${md.name ? ' · ' + esc(md.name) : ''}</a>`;
    const flags = (m.meta?.deleted_at ? '<span class="pill bad">mijoz o‘chirdi</span>' : '') + (m.meta?.edited_at ? `<span title="Avvalgi matn: ${esc(m.meta.original || '')}">tahrirlandi</span>` : '');
    parts.push(`<div class="msg ${k}${grp}${m.meta?.deleted_at ? ' deleted' : ''}">${who ? `<div class="who">${esc(who)}</div>` : ''}${media}<div class="txt">${k === 'c' ? esc(m.text) : richText(m.text)}</div><div class="msg-meta">${flags}${tag}<span class="mono">${fmtT(m.created_at)}</span></div></div>`);
  }
  parts.push(draftBlock(d));
  box.innerHTML = parts.join('');
  if (S.keepFromBottom != null) { box.scrollTop = box.scrollHeight - S.keepFromBottom; S.keepFromBottom = null; }
  else if (atBottom || !box.dataset.scrolled) { box.scrollTop = box.scrollHeight; box.dataset.scrolled = 1; }
}

/* ---------- mijoz kartasi ---------- */
function renderCard() {
  const d = S.detail, c = d.conv, cu = d.customer, stages = S.boot.stages;
  const heat = c.heat;
  const identity = cu.verified
    ? `<div class="idbox ver"><b>Tasdiqlangan · BILLZ #${esc(cu.billz_id)}</b><span>${esc(cu.verified_how || '')}</span></div>`
    : '<div class="idbox unv"><b>BILLZ bilan bog‘lanmagan</b><span>Ism bo‘yicha avtomatik birlashtirilmaydi. Mijoz Telegram’da o‘z kontaktini ulashsa, telefon orqali tasdiqlanadi — shundan keyin xaridlar va keshbek ko‘rinadi.</span></div>';
  const buys = cu.verified ? `
    <div class="card-sec"><div class="sec-title">Keshbek <span class="muted">${cu.cashback ? esc(cu.cashback.source) + ' · ' + fmtDT(Date.parse(cu.cashback.synced_at)) : ''}</span></div>
      ${cu.cashback ? `<div class="cash"><span class="v">${cash(cu.cashback.amount)}</span>${cu.cashback.stale ? '<span class="pill warn">eskirgan</span>' : ''}</div>` : '<div class="why">Ma’lumot yetarli emas — BILLZ’da keshbek topilmadi.</div>'}</div>
    <div class="card-sec"><div class="sec-title">Xaridlar <span class="muted">BILLZ</span></div><div class="purch">
      ${cu.purchases.map(p => `<div class="purch-row ${p.returned ? 'ret' : ''}"><span class="it">${esc(p.item)}${p.qty > 1 ? ' × ' + p.qty : ''}</span><span class="mono">${money(p.amount)}</span>
        <span class="d">${p.date}${p.branch ? ' · ' + esc(p.branch) : ''}${p.returned ? ` · <span class="pill">qaytarilgan ${p.returned}</span>` : ''}</span></div>`).join('') || '<div class="why">Xarid yo‘q</div>'}
    </div></div>` : '';
  let big = '';
  if (c.big_order) {
    const o = JSON.parse(c.big_order_json || '{}');
    big = `<div class="card-sec"><div class="sec-title">Katta buyurtma ${c.big_accepted ? '<span class="pill ok">qabul qilingan</span>' : '<span class="pill warn">qabul kutilmoqda</span>'}</div>
      ${(o.items || []).length ? `<dl class="kv">${o.items.map(i => `<dt>${esc(i.name)}</dt><dd>${Number(i.qty) || 1} · ${esc(String(i.status || '').replace('_', ' '))}${i.note ? ' — ' + esc(i.note) : ''}</dd>`).join('')}</dl>` : '<div class="why">Uzun ro‘yxat aniqlandi — AI tahlili yo‘q.</div>'}
      ${o.estimated_total ? `<div class="why">Taxminiy summa: <b>${money(o.estimated_total)}</b> <span class="pill warn">taxmin</span></div>` : ''}</div>`;
  }
  const tasks = d.tasks.length ? `<div class="card-sec"><div class="sec-title">Ochiq vazifalar</div>${d.tasks.map(t => `<div class="row-actions" style="justify-content:space-between"><span style="font-size:13px">${esc(t.title)}${t.body ? `<br><span class="muted">${esc(t.body)}</span>` : ''}</span><button class="btn sm" type="button" data-act="taskDone" data-id="${t.id}">Bajarildi</button></div>`).join('')}</div>` : '';
  $('#card').innerHTML = `
    <div class="card-sec">
      <div class="ct-row"><span class="avatar lg">${esc(initials(c.name))}${avaImg(c)}${chBadge(d.account.channel)}</span>
        <div style="min-width:0"><div class="ct-name">${esc(c.name)}</div><div class="ct-sub">${esc(c.handle || '')}</div></div>
        <button class="btn ghost icon only-narrow" type="button" data-act="card" aria-label="Kartani yopish" style="margin-left:auto">${svg('x')}</button></div>
      <dl class="kv"><dt>Birinchi murojaat</dt><dd>${fmtDT(c.created_at)}</dd><dt>Filial</dt><dd>${esc(c.branch || '—')}</dd>
        <dt>Mas’ul</dt><dd>${esc(c.owner || '—')}</dd>
        <dt>Manba</dt><dd>${c.source ? `<span class="pill">${esc(c.source)}</span> <span class="muted">${esc(c.source_note || '')}</span>` : '<span class="muted">aniqlanmagan — taxmin qilinmaydi</span>'}</dd></dl>
    </div>
    <div class="card-sec">${identity}</div>
    <div class="card-sec"><div class="sec-title">Qiziqish darajasi <span class="muted">${c.heat_by === 'staff' ? 'sotuvchi belgiladi' : c.heat ? 'AI belgiladi · tuzatish mumkin' : ''}</span></div>
      <div class="wb"><div class="wb-bar">${heat ? `<span class="wb-mark" style="left:${HEAT[heat].x}%"></span>` : ''}</div>
        <div class="wb-opts" role="radiogroup" aria-label="Qiziqish darajasi">${[['sovuq', '7500K'], ['iliq', '5600K'], ['issiq', '3200K']].map(([k, K]) => `<button type="button" role="radio" data-heat="${k}" aria-checked="${heat === k}">${k[0].toUpperCase() + k.slice(1)}<small>${K}</small></button>`).join('')}</div></div>
      ${c.heat_why ? `<div class="why">Sabab: ${esc(c.heat_why)}</div>` : ''}</div>
    <div class="card-sec"><div class="sec-title">Bosqich <span class="muted">bosib o‘zgartiring</span></div>
      <ol class="stages">${stages.map((s, i) => `<li class="${i < c.stage ? 'done' : i === c.stage ? 'cur' : ''}" data-stage="${i}" style="cursor:pointer"><span class="b"></span>${s}</li>`).join('')}
        <li class="lost ${c.lost_reason ? 'cur' : ''}" data-act="lost" style="cursor:pointer"><span class="b"></span>${c.lost_reason ? `Yo‘qotildi: ${esc(c.lost_reason)}` : 'Yo‘qotildi — faqat dalil bilan'}</li></ol>
      ${c.lost_evidence ? `<div class="why">Dalil: ${esc(c.lost_evidence)}</div>` : ''}</div>
    <div class="card-sec"><div class="sec-title">Suhbat kartasi <button class="linkish" type="button" data-act="editCard">tahrirlash</button></div>
      <dl class="kv"><dt>So‘ralgan</dt><dd>${esc(c.asked || '—')}</dd><dt>Budjet</dt><dd>${esc(c.budget || '—')}</dd><dt>Maqsad</dt><dd>${esc(c.purpose || '—')}</dd>
        <dt>Til</dt><dd>${esc(c.lang || '—')}</dd><dt>Keyingi qadam</dt><dd>${esc(c.next_step || '—')}</dd><dt>Eslatma</dt><dd>${esc(c.note || '—')}</dd>
        ${c.remind_at ? `<dt>Qayta aloqa</dt><dd>${fmtDT(c.remind_at)} — ${esc(c.remind_note || '')}</dd>` : ''}</dl></div>
    ${big}${tasks}${buys}`;
}

/* ---------- taymer (har soniya, lokal) ---------- */
setInterval(() => {
  const n = clockNow();
  $$('[data-due]').forEach(el => {
    const due = Number(el.dataset.due);
    if (el.tagName === 'circle') { const C = 2 * Math.PI * 15, T = Number(el.dataset.t) * 1000; el.setAttribute('stroke-dashoffset', (C * (1 - Math.max(0, Math.min(1, (due - n) / T)))).toFixed(2)); }
    else el.textContent = `AI · ${fmtLeft(due - n)}`;
  });
  const tl = $('#tLeft'); const ring = $('#ringFg');
  if (tl && ring) tl.textContent = fmtLeft(Number(ring.dataset.due) - n);
}, 1000);

/* ---------- so‘rov (polling) ---------- */
let polling = false;
async function poll() {
  if (polling || document.hidden) return;
  polling = true;
  try {
    if (route() === 'suhbatlar') { await loadList(); if (S.sel) await openConv(S.sel, { quiet: true }); }
  } catch (e) { if (e.message !== 'unauthorized') console.warn(e); }
  finally { polling = false; }
}
setInterval(poll, 3000);
document.addEventListener('visibilitychange', poll);

/* ---------- hodisalar: suhbatlar ---------- */
$('#fChips').addEventListener('scroll', chipEdges, { passive: true });
window.addEventListener('resize', chipEdges);
/* Kompyuterda sichqoncha g‘ildiragi ham chiplar qatorini yonga suradi */
$('#fChips').addEventListener('wheel', e => {
  const el = e.currentTarget;
  if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
  el.scrollLeft += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; e.preventDefault();
}, { passive: false });
$('#inbox').addEventListener('click', async e => {
  const cv = e.target.closest('.conv');
  if (cv) { location.hash = `#suhbat/${cv.dataset.id}`; return; }
  const f = e.target.closest('[data-f]'); if (f) { S.filter = f.dataset.f; if (S.filter === 'arxiv' && !S.arch) loadArch().catch(fail); renderList(); chipIntoView(); return; }
  if (e.target.id === 'sortBtn') { S.sort = S.sort === 'yangi' ? 'navbat' : 'yangi'; try { localStorage.setItem('pb_sort', S.sort); } catch {} renderList(); return; }
  if (e.target.closest('[data-act="archMore"]')) { e.target.closest('button').disabled = true; loadArch(true).catch(fail); return; }
  if (e.target.closest('[data-act="older"]') && S.sel) { const box = $('#msgs'); S.keepFromBottom = box.scrollHeight - box.scrollTop; S.older = (S.older || 0) + 1; openConv(S.sel).catch(fail); return; }
  // Kanal: Telegram/Instagram belgisi — bosilsa faqat o‘sha kanal, yana bosilsa hammasi
  const ch = e.target.closest('[data-ch]'); if (ch) { S.ch = S.ch === ch.dataset.ch ? 'all' : ch.dataset.ch; $$('#chSeg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.ch === S.ch)); renderList(); return; }
  const h = e.target.closest('[data-heat]');
  if (h && S.sel) { await api(`/api/conversations/${S.sel}/card`, { heat: h.dataset.heat }).catch(fail); return openConv(S.sel); }
  const st = e.target.closest('[data-stage]');
  if (st && S.sel) {
    const stage = Number(st.dataset.stage), body = { stage };
    if (stage === 5) { if (!confirm('«Xarid tasdiqlandi» — BILLZ cheki bor yoki xodim sifatida tasdiqlaysizmi?')) return; body.confirm_purchase = true; }
    await api(`/api/conversations/${S.sel}/card`, body).catch(fail); return openConv(S.sel);
  }
  const a = e.target.closest('[data-act]');
  // Ochiq «⋯» menyusi: tashqariga yoki biror amalga bosilganda yopiladi
  if (a?.dataset.act !== 'menu') $$('#thActions .menu').forEach(m => { m.hidden = true; });
  if (!a) return;
  const act = a.dataset.act, id = S.sel;
  try {
    if (act === 'back') { $('#inbox').classList.remove('open-thread'); location.hash = '#suhbatlar'; return; }
    if (act === 'card') { $('#inbox').classList.toggle('show-card'); return; }
    if (act === 'menu') { const m = a.parentElement.querySelector('.menu'); m.hidden = !m.hidden; return; }
    if (act === 'clear') {
      if (!confirm('Bu suhbatdagi barcha xabarlar va AI qoralamalari paneldan o‘chiriladi. Suhbat, mijoz kartasi qoladi; mijozning Telegram/Instagram’ida yozishma o‘chmaydi.\n\nDavom etasizmi?')) return;
      const r = await api(`/api/conversations/${id}/clear`, {}); toast(`Tarix tozalandi: ${r.messages} ta xabar`); return openConv(id);
    }
    if (act === 'delete') {
      if (!confirm('Suhbat butunlay o‘chiriladi (xabarlar, qoralamalar, topshiriqlar). Qaytarib bo‘lmaydi. Mijoz yana yozsa — yangi suhbat ochiladi.\n\nO‘chirilsinmi?')) return;
      await api(`/api/conversations/${id}/delete`, {}); toast('Suhbat o‘chirildi');
      S.sel = null; S.detail = null; S.detailSig = '';
      $('#thread').innerHTML = '<div class="empty-state">Suhbatni tanlang.</div>';
      $('#inbox').classList.remove('open-thread');
      return loadList();
    }
    if (act === 'take') { await api(`/api/conversations/${id}/take`, {}); toast('Suhbat sizda. AI to‘xtadi.'); }
    if (act === 'release') { await api(`/api/conversations/${id}/release`, {}); toast('Suhbat AI’ga qaytarildi.'); }
    if (act === 'approve') { const r = await api(`/api/drafts/${a.dataset.id}/approve`, {}); if (!r.ok) return toast(r.why || 'Yuborilmadi'); toast('Yuborildi', 'ai'); }
    if (act === 'cancelDraft') { await api(`/api/drafts/${a.dataset.id}/cancel`, {}); }
    if (act === 'rate') { await api(`/api/drafts/${a.dataset.id}/rate`, { rating: a.dataset.r }); toast('Baho saqlandi'); }
    if (act === 'teach') {
      const dr = S.detail.drafts.find(x => x.id === Number(a.dataset.id));
      const q = [...S.detail.messages].reverse().find(m => m.author === 'client' && m.created_at <= (dr?.created_at || Infinity));
      return modal(`<h2>Agentni o‘rgatish</h2><p class="lead" style="font-size:13.5px">Mijoz shu savolni (yoki mazmunan o‘xshashini) bersa, agent endi siz yozgan mazmunda javob beradi. Narx va qoldiq baribir BILLZ’dan olinadi.</p>
        <label class="field"><span>Mijoz savoli</span><textarea name="question" id="t_q" required>${esc(q?.text || '')}</textarea></label>
        <label class="field"><span>To‘g‘ri javob</span><textarea name="answer" id="t_a" required style="min-height:110px">${esc(dr?.text || '')}</textarea></label>`,
      async d => { await api('/api/answers', { question: d.question, answer: d.answer, source: 'draft' }); toast('Saqlandi — agent endi shunday javob beradi'); });
    }
    if (act === 'edit') { const dr = S.detail.drafts.find(x => x.id === Number(a.dataset.id)); const t = $('#compose'); t.value = dr?.text || ''; t.focus(); autoGrow(t); typing(true); return; }
    if (act === 'photo') {
      const { items } = await api('/api/pick/products');
      const withPhoto = items.filter(x => x.has_photo);
      if (!withPhoto.length) return modal(`<h2>Tovar rasmi</h2><div class="banner warn"><div>Hali birorta tovarda rasm yo‘q.
        Rasm BILLZ kartasiga yuklansa, sinxrondan keyin shu yerda chiqadi.</div></div>`, null);
      return modal(`<h2>Mijozga tovar rasmini yuborish</h2>
        <label class="field"><span>Tovar</span><input id="phq" placeholder="Nom bo‘yicha qidiring" autocomplete="off"></label>
        <div class="tbl" style="max-height:320px;overflow:auto"><table><tbody id="phlist"></tbody></table></div>`, null, () => {
        const list = $('#phlist'), q = $('#phq');
        const draw = () => {
          const t = q.value.trim().toLowerCase();
          list.innerHTML = withPhoto.filter(x => !t || x.name.toLowerCase().includes(t)).slice(0, 40)
            .map(x => `<tr><td><img src="/api/products/${x.id}/photo" alt="" style="width:46px;height:46px;object-fit:cover;border-radius:8px"></td>
              <td>${esc(x.name)}</td><td class="n"><button class="btn sm primary" type="button" data-sendphoto="${x.id}">Yuborish</button></td></tr>`).join('')
            || '<tr><td class="muted">Topilmadi</td></tr>';
        };
        q.addEventListener('input', draw); draw();
        list.addEventListener('click', async e => {
          const b = e.target.closest('[data-sendphoto]'); if (!b) return;
          b.disabled = true;
          const r = await api(`/api/conversations/${id}/photo`, { product_id: Number(b.dataset.sendphoto) }).catch(fail);
          if (r?.ok) { $('#modalRoot').innerHTML = ''; toast('Rasm yuborildi'); openConv(id); }
          else { b.disabled = false; toast(r?.why || 'Yuborilmadi'); }
        });
      });
    }
    if (act === 'send') return sendCompose();
    if (act === 'taskDone') { await api(`/api/tasks/${a.dataset.id}/done`, {}); }
    if (act === 'simulate') {
      const text = prompt('Mijoz nomidan xabar (demo akkaunt):'); if (!text) return;
      await api('/api/demo/client', { conversation_id: id, text });
    }
    if (act === 'lost') {
      const reason = prompt('Yo‘qotish sababi (narx / mavjud emas / kech javob / raqobatchidan oldi / boshqa). Bo‘sh qoldirsangiz — olib tashlanadi:', S.detail.conv.lost_reason || '');
      if (reason === null) return;
      const evidence = reason ? prompt('Dalil (mijozning so‘zi, sana). Jim qolish raqobatchiga ketdi degani emas:', S.detail.conv.lost_evidence || '') : '';
      if (reason && !evidence) return toast(ERR.lost_needs_evidence);
      await api(`/api/conversations/${id}/card`, { lost: reason || null, lost_evidence: evidence });
    }
    if (act === 'editCard') return editCardModal();
    await loadList();
    await openConv(id);
  } catch (err) { fail(err); }
});
$('#inbox').addEventListener('change', async e => {
  if (e.target.id !== 'modeSel') return;
  await api(`/api/conversations/${S.sel}/mode`, { mode: e.target.value }).catch(fail);
  toast('Avtojavob rejimi o‘zgardi'); openConv(S.sel);
});
$('#inbox').addEventListener('input', e => {
  if (e.target.id === 'q') { S.q = e.target.value.trim(); runSearch(); renderList(); }
  if (e.target.id === 'compose') { autoGrow(e.target); typing(e.target.value.trim().length > 0); }
});
$('#inbox').addEventListener('keydown', e => { if (e.target.id === 'compose' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendCompose(); } });
function autoGrow(t) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 150) + 'px'; }
function typing(on) {
  if (!S.sel) return;
  if (on && Date.now() - S.typingSent < 4000) return;
  S.typingSent = on ? Date.now() : 0;
  api(`/api/conversations/${S.sel}/typing`, { typing: on }).catch(() => {});
}
async function sendCompose() {
  const t = $('#compose'); const text = t.value.trim(); if (!text) return;
  const r = await api(`/api/conversations/${S.sel}/send`, { text }).catch(e => ({ ok: false, why: e.message }));
  if (!r.ok) return toast(r.why || 'Yuborilmadi');
  t.value = ''; autoGrow(t); typing(false);
  await openConv(S.sel);
}

/* ---------- modal ---------- */
function modal(html, onSubmit, after) {
  $('#modalRoot').innerHTML = `<div class="modal-back"><form class="modal" id="mForm">${html}
    <div class="row-actions" style="justify-content:flex-end">${onSubmit ? '<button class="btn ghost" type="button" data-close>Bekor</button><button class="btn primary" type="submit">Saqlash</button>' : '<button class="btn primary" type="button" data-close>Yopish</button>'}</div></form></div>`;
  const back = $('.modal-back');
  back.addEventListener('click', e => { if (e.target === back || e.target.closest('[data-close]')) $('#modalRoot').innerHTML = ''; });
  $('#mForm').addEventListener('submit', async e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    if (!onSubmit) { $('#modalRoot').innerHTML = ''; return; }
    try { const keep = await onSubmit(data); if (!keep) $('#modalRoot').innerHTML = ''; } catch (err) { fail(err); }
  });
  $('#mForm input, #mForm textarea, #mForm select')?.focus();
  if (after) after();   // oyna chizilgandan keyingi ish (ro‘yxatni to‘ldirish, tinglovchilar)
}
function editCardModal() {
  const c = S.detail.conv, f = (k, l, v, ta) => `<label class="field ${ta ? 'wide' : ''}"><span>${l}</span>${ta ? `<textarea name="${k}" id="f_${k}">${esc(v || '')}</textarea>` : `<input name="${k}" id="f_${k}" value="${esc(v || '')}">`}</label>`;
  modal(`<h2>Suhbat kartasi</h2><div class="form-grid">
    ${f('asked', 'So‘ralgan tovar', c.asked)}${f('budget', 'Budjet', c.budget)}${f('purpose', 'Maqsad', c.purpose)}
    <label class="field"><span>Manba</span><select name="source" id="f_source">${['', 'tavsiya', 'reklama', 'organik', 'mavjud mijoz'].map(s => `<option value="${s}" ${c.source === s ? 'selected' : ''}>${s || 'aniqlanmagan'}</option>`).join('')}</select></label>
    ${f('source_note', 'Manba izohi (masalan, kim tavsiya qildi)', c.source_note)}${f('next_step', 'Keyingi qadam', c.next_step)}
    ${f('note', 'Eslatma', c.note, true)}</div>`,
  async data => { await api(`/api/conversations/${S.sel}/card`, data); toast('Saqlandi'); openConv(S.sel); });
}

/* =====================================================================
   VAZIFALAR
   ===================================================================== */
const TASK_L = { followup: 'Jim qolgan', handoff: 'Sotuvchiga uzatildi', big_order: 'Katta buyurtma', reminder: 'Eslatma', morning: 'Tungi suhbat', send_failed: 'Yuborilmadi', draft_failed: 'AI qoralama yo‘q', window_closed: 'Oyna yopiq' };
/* =====================================================================
   MIJOZLAR DOSKASI (Trello uslubida) + VAZIFALAR
   Har mijoz — karta, ustun — sotuv bosqichi. Sudrab boshqa bosqichga o‘tkaziladi; «Chat» — yozishmani shu yerning o‘zida ko‘rish.
   ===================================================================== */
let taskTab = 'doska', boardF = 'all', boardQ = '', B = null;
const ago = ts => { if (!ts) return ''; const m = Math.max(0, Math.round((clockNow() - ts) / 60e3)); return m < 60 ? `${m} daq` : m < 1440 ? `${Math.round(m / 60)} soat` : `${Math.round(m / 1440)} kun`; };
const telHref = p => 'tel:' + String(p || '').replace(/[^\d+]/g, '');
const LOST_COL = 6;
function boardCard(c) {
  return `<article class="bcard${c.waiting ? ' wait' : ''}" draggable="true" data-bid="${c.id}">
    <div class="bc-top">${c.heat ? `<span class="heat" style="background:var(--wb-${HEAT[c.heat].k})" title="Qiziqish: ${c.heat}"></span>` : ''}<b>${esc(c.name)}</b><span class="bc-ago">${ago(c.last_at)}</span></div>
    ${c.phone ? `<a class="bc-tel" href="${telHref(c.phone)}">${svg('phone')}${esc(c.phone)}</a>` : ''}
    ${c.asked || c.budget ? `<div class="bc-ask">${esc([c.asked, c.budget].filter(Boolean).join(' · '))}</div>` : ''}
    ${c.waiting ? '<div class="bc-flag">javob kutmoqda</div>' : ''}
    ${c.next_step ? `<div class="bc-ai"><span>AI</span>${esc(c.next_step)}</div>` : ''}
    <div class="bc-act"><button class="btn sm" type="button" data-bchat="${c.id}">Chat</button><button class="btn sm ghost" type="button" data-badvice="${c.id}">AI maslahat</button></div>
  </article>`;
}
function boardPass(c) {
  if (boardF === 'phone' && !c.phone) return false;
  if (boardF === 'hot' && c.heat !== 'issiq' && c.heat !== 'iliq') return false;
  if (boardQ && !`${c.name} ${c.phone || ''} ${c.asked || ''}`.toLowerCase().includes(boardQ.toLowerCase())) return false;
  return true;
}
function renderBoardBody() {
  const items = B.items.filter(boardPass);
  const cols = [...B.stages.map((name, i) => ({ i, name, list: items.filter(c => !c.lost && c.stage === i) })), { i: LOST_COL, name: 'Yo‘qotildi', list: items.filter(c => c.lost) }];
  const focus = B.focus.map(id => B.items.find(c => c.id === id)).filter(Boolean);
  $('#boardFocus').innerHTML = focus.length ? `<div class="lbl">Bugun qo‘ng‘iroq qiling</div><div class="focus-row">${focus.map(c => `
    <div class="focus"><b>${esc(c.name)}</b>${c.phone ? `<a class="bc-tel" href="${telHref(c.phone)}">${svg('phone')}${esc(c.phone)}</a>` : ''}<span class="muted">${esc(c.next_step || c.asked || '')}</span>
      <button class="btn sm" type="button" data-bchat="${c.id}">Chat</button></div>`).join('')}</div>` : '';
  $('#board').innerHTML = cols.map(col => `
    <section class="bcol" data-col="${col.i}">
      <header><span>${esc(col.name)}</span><span class="c">${col.list.length}</span></header>
      <div class="bcol-list">${col.list.map(boardCard).join('') || '<div class="bcol-empty">bo‘sh</div>'}</div>
    </section>`).join('');
}
async function renderBoard() {
  B = await api('/api/board');
  const withPhone = B.items.filter(c => c.phone).length;
  $('#taskBody').innerHTML = `
    <div class="board-bar">
      <div class="chips">${[['all', 'Hammasi', B.items.length], ['phone', 'Raqam bergan', withPhone], ['hot', 'Qiziqqan', B.items.filter(c => c.heat === 'issiq' || c.heat === 'iliq').length]]
        .map(([k, l, n]) => `<button class="chip" type="button" data-bf="${k}" aria-pressed="${boardF === k}">${l}<span class="c">${n}</span></button>`).join('')}</div>
      <label class="search"><span>${svg('search')}</span><input id="boardQ" type="search" value="${esc(boardQ)}" placeholder="Ism, telefon yoki tovar" autocomplete="off"></label>
    </div>
    <div id="boardFocus"></div>
    <div class="board" id="board"></div>
    <p class="muted board-hint">Kompyuterda kartani sudrab boshqa ustunga o‘tkazing, telefonda — «Chat» ichidagi «Bosqich» dan. «Xarid tasdiqlandi» — faqat chek bo‘lsa, «Yo‘qotildi» — sabab va dalil bilan.</p>`;
  renderBoardBody();
}
async function renderTaskList() {
  const r = await api('/api/tasks');
  $('#taskBody').innerHTML = `<div class="rows">${r.items.map(t => `
      <div class="row-item">
        <div class="t"><b>${esc(t.conv_name || 'Mijoz')}</b><span class="pill ${t.kind === 'big_order' ? 'acc' : t.kind.includes('fail') || t.kind === 'window_closed' ? 'bad' : 'warn'}">${TASK_L[t.kind] || esc(t.kind)}</span></div>
        <div>${esc(t.title)}${t.body ? `<br><span class="muted">${esc(t.body)}</span>` : ''}</div>
        <div class="row-actions">${esc(t.user_name || 'biriktirilmagan')} · ${fmtDT(t.due_at)}
          ${t.conversation_id ? `<button class="btn sm" type="button" data-bchat="${t.conversation_id}">Chat</button>` : ''}<button class="btn sm" type="button" data-done="${t.id}">Bajarildi</button></div>
      </div>`).join('') || '<div class="row-item"><div class="muted">Ochiq vazifa yo‘q.</div></div>'}</div>` +
    // Yopilgan vazifalar izsiz yo‘qolmasin — sutkalik ro‘yxat shu yerda turadi
    ((r.closed || []).length ? `<details class="closed-tasks"><summary>Oxirgi sutkada yopilgan vazifalar (${r.closed.length})</summary>
      <div class="rows">${r.closed.map(t => `<div class="row-item done">
        <div class="t"><b>${esc(t.conv_name || 'Mijoz')}</b><span class="pill ok">${TASK_L[t.kind] || esc(t.kind)}</span></div>
        <div>${esc(t.title)}${t.result ? `<br><span class="muted">${esc(t.result)}</span>` : ''}</div>
        <div class="row-actions muted">${esc(t.user_name || '—')} · ${fmtDT(t.done_at)}
          ${t.conversation_id ? `<button class="btn sm ghost" type="button" data-bchat="${t.conversation_id}">Chat</button>` : ''}</div>
      </div>`).join('')}</div></details>` : '');
}
async function renderTasks() {
  const r = await api('/api/tasks');
  $('#badgeTasks').hidden = !r.items.length; $('#badgeTasks').textContent = r.items.length;
  $('#tasksPage').innerHTML = `<div class="tabs" role="tablist">
      <button type="button" role="tab" data-ttab="doska" aria-selected="${taskTab === 'doska'}">Mijozlar doskasi</button>
      <button type="button" role="tab" data-ttab="vazifa" aria-selected="${taskTab === 'vazifa'}">Vazifalar (${r.items.length})</button></div>
    <div id="taskBody"></div>`;
  return taskTab === 'doska' ? renderBoard() : renderTaskList();
}

/* Chatni shu yerning o‘zida ko‘rish: oxirgi xabarlar, bosqich, AI maslahati */
async function chatPreview(id) {
  const d = await api(`/api/conversations/${id}`), c = d.conv, bi = B?.items.find(x => x.id === id);
  const msgs = d.messages.slice(-30).map(m => `<div class="pm ${m.author === 'client' ? 'c' : m.author === 'ai' ? 'ai' : 's'}">${esc(m.text)}<span>${fmtDT(m.created_at)}</span></div>`).join('');
  const stageOpts = [...S.boot.stages.map((n, i) => [i, n]), [LOST_COL, 'Yo‘qotildi']]
    .map(([i, n]) => `<option value="${i}" ${(c.lost_reason ? LOST_COL : c.stage) === i ? 'selected' : ''}>${esc(n)}</option>`).join('');
  modal(`<div class="pv-head"><div><h2>${esc(c.name)}</h2>${bi?.phone ? `<a class="bc-tel" href="${telHref(bi.phone)}">${svg('phone')}${esc(bi.phone)}</a>` : ''}</div>
      <label class="field" style="min-width:180px"><span>Bosqich</span><select id="pvStage">${stageOpts}</select></label></div>
    <div class="pv-msgs" id="pvMsgs">${msgs || '<div class="muted">Xabar yo‘q</div>'}</div>
    <div class="pv-advice" id="pvAdvice">${bi?.advice ? `<div class="lbl">AI maslahati · ${ago(bi.advice_at)} oldin</div><div class="adv">${esc(bi.advice)}</div>` : ''}</div>
    <div class="row-actions"><button class="btn sm ai" type="button" id="pvAdv">AI maslahat olish</button><a class="btn sm primary" href="#suhbat/${id}" data-close>Suhbatni ochish</a></div>`,
    null, () => {
      const box = $('#pvMsgs'); box.scrollTop = box.scrollHeight;
      $('#pvStage').addEventListener('change', e => moveCard(id, Number(e.target.value)));
      $('#pvAdv').addEventListener('click', () => adviceFor(id, $('#pvAdvice'), $('#pvAdv')));
    });
  $('.modal')?.classList.add('wide');
}
async function adviceFor(id, box, btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'AI o‘ylayapti…'; }
  const r = await api(`/api/conversations/${id}/advice`, {}).catch(e => ({ ok: false, why: e.message }));
  if (btn) { btn.disabled = false; btn.textContent = 'AI maslahat olish'; }
  if (!r.ok) return toast(r.why || 'AI maslahat bermadi');
  const it = B?.items.find(x => x.id === id); if (it) { it.advice = r.advice; it.advice_at = clockNow(); }
  if (box) box.innerHTML = `<div class="lbl">AI maslahati</div><div class="adv">${esc(r.advice)}</div>`;
  else toast('AI maslahati tayyor — «Chat» ni oching');
}
/* Bosqichni o‘zgartirish (sudrash yoki ro‘yxatdan): xarid — chek bilan, yo‘qotish — sabab va dalil bilan */
async function moveCard(id, col) {
  const it = B?.items.find(x => x.id === id);
  let body;
  if (col === LOST_COL) {
    const reason = prompt('Yo‘qotish sababi (narx / mavjud emas / kech javob / raqobatchidan oldi / boshqa):', it?.lost || '');
    if (!reason) return renderBoardBody();
    const evidence = prompt('Dalil (mijoz nima degan):', '');
    if (!evidence) return renderBoardBody();
    body = { lost: reason, lost_evidence: evidence };
  } else {
    if (col === 5 && !confirm('Xarid tasdiqlandimi? (chek yoki BILLZ’da sotuv bor)')) return renderBoardBody();
    body = { stage: col, ...(col === 5 ? { confirm_purchase: true } : {}), ...(it?.lost ? { lost: null } : {}) };
  }
  const r = await api(`/api/conversations/${id}/card`, body).catch(fail);
  if (!r) return renderBoardBody();
  if (it) { if (col === LOST_COL) it.lost = body.lost; else { it.stage = col; it.lost = null; } }
  toast('Bosqich o‘zgardi');
  if ($('#board')) renderBoardBody();
}

$('#tasksPage').addEventListener('click', async e => {
  const tt = e.target.closest('[data-ttab]'); if (tt) { taskTab = tt.dataset.ttab; return renderTasks(); }
  const bf = e.target.closest('[data-bf]'); if (bf) { boardF = bf.dataset.bf; $$('[data-bf]').forEach(x => x.setAttribute('aria-pressed', x === bf)); return renderBoardBody(); }
  const ch = e.target.closest('[data-bchat]'); if (ch) return chatPreview(Number(ch.dataset.bchat)).catch(fail);
  const ad = e.target.closest('[data-badvice]'); if (ad) { await adviceFor(Number(ad.dataset.badvice), null, ad); return chatPreview(Number(ad.dataset.badvice)).catch(fail); }
  const b = e.target.closest('[data-done]'); if (!b) return;
  const result = prompt('Natija (qisqa):', 'bajarildi'); if (result === null) return;
  await api(`/api/tasks/${b.dataset.done}/done`, { result }).catch(fail); renderTasks();
});
$('#tasksPage').addEventListener('input', e => { if (e.target.id === 'boardQ') { boardQ = e.target.value.trim(); renderBoardBody(); } });
/* Sudrab o‘tkazish (kompyuterda). Telefonda — «Chat» ichidagi «Bosqich» ro‘yxati */
$('#tasksPage').addEventListener('dragstart', e => { const c = e.target.closest('[data-bid]'); if (c) { e.dataTransfer.setData('text/plain', c.dataset.bid); c.classList.add('drag'); } });
$('#tasksPage').addEventListener('dragend', e => e.target.closest?.('[data-bid]')?.classList.remove('drag'));
$('#tasksPage').addEventListener('dragover', e => { const col = e.target.closest('[data-col]'); if (col) { e.preventDefault(); col.classList.add('over'); } });
$('#tasksPage').addEventListener('dragleave', e => e.target.closest?.('[data-col]')?.classList.remove('over'));
$('#tasksPage').addEventListener('drop', e => {
  const col = e.target.closest('[data-col]'); if (!col) return;
  e.preventDefault(); col.classList.remove('over');
  const id = Number(e.dataTransfer.getData('text/plain')), to = Number(col.dataset.col), it = B?.items.find(x => x.id === id);
  if (!it || (it.lost ? LOST_COL : it.stage) === to) return;
  moveCard(id, to);
});

/* =====================================================================
   BILIM BAZASI
   ===================================================================== */
let prodQ = '';
const PF = { stock: 'all', branch: '', status: 'all', limit: 60 };
/* Qoldiq: do‘konlar (darhol) va ombor alohida; filial bo‘yicha batafsil */
function stockLine(b) {
  if (!b.stock_total) return '<span class="pill">qoldiq yo‘q</span>';
  const per = Object.entries(b.stock_by_branch || {}).filter(([, q]) => q > 0)
    .map(([n, q]) => `${esc(n)} ${q}${(b.warehouses || []).includes(n) ? ' <span class="muted">(ombor)</span>' : ''}`).join(' · ');
  return `${b.stock_store ? `<span class="pill ok">do‘konda ${b.stock_store}</span>` : ''}${b.stock_warehouse ? `<span class="pill ${b.stock_store ? '' : 'warn'}">omborda ${b.stock_warehouse}</span>` : ''}
    <span class="muted" style="font-size:12px">${per}</span>`;
}
/* Bilim bazasi: mahsulot kartalari + agentni o‘qitish (tasdiqlangan javoblar, do‘kon ma’lumoti) */
let catTab = 'prod';
const catTabs = n => `<div class="tabs" role="tablist" style="margin-bottom:6px">${[['prod', 'Mahsulot kartalari'], ['ans', `Tasdiqlangan javoblar${n?.ans != null ? ` (${n.ans})` : ''}`], ['kn', 'Do‘kon ma’lumoti']]
  .map(([k, l]) => `<button type="button" role="tab" aria-selected="${catTab === k}" data-ctab="${k}">${l}</button>`).join('')}</div>`;
const SRC_L = { panel: 'panel', telegram: 'Telegram /tuzat', draft: 'AI qoralamasidan', hujjat: 'hujjatdan', import: 'importdan' };

async function renderAnswers() {
  const r = await api('/api/answers'), canEdit = S.boot.me.role !== 'sotuvchi';
  const on = r.items.filter(x => x.active), off = r.items.filter(x => !x.active);
  const card = a => `<div class="ans${a.active ? '' : ' off'}"><div class="ans-q"><span class="muted mono">#${a.id}</span> ${esc(a.question)}</div>
    <div class="ans-a">${esc(a.answer)}</div>
    <div class="ans-meta muted">${esc(SRC_L[a.source] || a.source)} · ${esc(a.author || '—')} · ${fmtDT(a.updated_at || a.created_at)}
      ${canEdit ? `<span class="row-actions" style="margin-left:auto"><button class="btn sm ghost" type="button" data-ansedit="${a.id}">Tahrirlash</button>
        <button class="btn sm ghost" type="button" data-anson="${a.id}" data-v="${a.active ? 0 : 1}">${a.active ? 'O‘chirish' : 'Qayta yoqish'}</button></span>` : ''}</div></div>`;
  $('#catalogPage').innerHTML = `${catTabs({ ans: on.length })}
    <p class="lead">Rahbar tasdiqlagan savol-javoblar. Mijoz shu savolni yoki mazmunan o‘xshashini bersa, agent <b>aynan shu mazmunda</b> javob beradi — bu javoblar agentning umumiy bilimidan ustun. Narx va qoldiq baribir BILLZ’dan olinadi.
      Telegram’dan ham qo‘shish mumkin: botga <span class="mono">/tuzat Savol =&gt; Javob</span>. Suhbatdagi AI qoralamasi ostidagi «O‘rgatish» tugmasi ham shu yerga yozadi.</p>
    ${canEdit ? `<div class="panel"><div class="panel-head"><h2>Yangi javob</h2></div>
      <label class="field"><span>Mijoz savoli</span><textarea id="ansQ" placeholder="Masalan: Yetkazib berasizmi?"></textarea></label>
      <label class="field"><span>To‘g‘ri javob</span><textarea id="ansA" style="min-height:90px" placeholder="Agent shu mazmunda javob beradi"></textarea></label>
      <div class="row-actions"><button class="btn primary" type="button" id="ansSave">Saqlash</button></div></div>` : ''}
    <div class="panel"><div class="panel-head"><h2>Faol javoblar</h2><span class="pill acc">${on.length}</span></div>
      <div class="ans-list">${on.map(card).join('') || '<span class="muted">Hozircha yo‘q. Birinchi javobni yuqorida qo‘shing.</span>'}</div></div>
    ${off.length ? `<details class="panel"><summary>O‘chirilganlar (${off.length})</summary><div class="ans-list">${off.map(card).join('')}</div></details>` : ''}`;
  $('#catalogPage').dataset.answers = JSON.stringify(r.items);
}

const KN_TEMPLATES = ['Kafolat', 'Yetkazib berish', 'To‘lov usullari', 'Keshbek', 'Manzillar va ish vaqti', 'Qaytarish va almashtirish', 'Muddatli to‘lov'];
async function renderKnowledge() {
  const r = await api('/api/knowledge'), canEdit = S.boot.me.role !== 'sotuvchi';
  const have = new Set(r.items.map(k => k.title.toLowerCase()));
  const isDraft = k => !k.active && /^Yozishmalardan/.test(k.author || '');
  const items = [...r.items.filter(isDraft), ...r.items.filter(k => !isDraft(k))], drafts = items.filter(isDraft).length;
  $('#catalogPage').innerHTML = `${catTabs()}
    <p class="lead">Do‘kon qoidalari — agent shu yerda yozilgan narsani mijozga aytadi, yozilmaganini <b>va’da qilmaydi</b> va sotuvchiga uzatadi. Kafolat, yetkazish, to‘lov va keshbek shartlarini shu yerga yozing.</p>
    ${canEdit ? `<div class="row-actions" style="flex-wrap:wrap">${KN_TEMPLATES.filter(t => !have.has(t.toLowerCase())).map(t => `<button class="btn sm" type="button" data-knnew="${esc(t)}">+ ${esc(t)}</button>`).join('')}
      <button class="btn sm ghost" type="button" data-knnew="">+ Boshqa bo‘lim</button></div>` : ''}
    ${drafts ? `<div class="note">${drafts} ta bo‘lim Photobuy’ning eski yozishmalaridan tayyorlandi (sotuvchi ko‘p marta yozgan javoblar asosida). Tekshiring, kerak bo‘lsa tahrirlang va <b>«Tasdiqlash»</b> ni bosing — shundan keyingina agent ulardan foydalanadi. «[Tekshiring: …]» qatorlari agentga berilmaydi.</div>` : ''}
    <div class="ans-list">${items.map(k => { const draft = !k.active && /^Yozishmalardan/.test(k.author || ''); return `<div class="panel${k.active || draft ? '' : ' off'}"><div class="panel-head"><h2>${esc(k.title)}</h2>${k.active ? '' : draft ? '<span class="pill acc">Qoralama · tasdiq kutmoqda</span>' : '<span class="pill">o‘chirilgan</span>'}
      <span class="muted" style="margin-left:auto">${esc(k.author || '—')} · ${fmtDT(k.updated_at)}</span>${canEdit && draft ? `<button class="btn sm primary" type="button" data-knon="${k.id}">Tasdiqlash</button>` : ''}${canEdit ? `<button class="btn sm ghost" type="button" data-knedit="${k.id}">Tahrirlash</button>` : ''}</div>
      <div class="kn-body">${k.body.split('\n').map(l => /^\s*\[tekshiring/i.test(l) ? `<span class="kn-check">${esc(l)}</span>` : esc(l)).join('\n')}</div></div>`; }).join('') || '<div class="panel muted">Hali bo‘lim yo‘q — yuqoridagi tugmalardan birini bosib boshlang.</div>'}</div>`;
  $('#catalogPage').dataset.knowledge = JSON.stringify(r.items);
}

async function renderCatalog() {
  if (catTab === 'ans') return renderAnswers();
  if (catTab === 'kn') return renderKnowledge();
  const qs = new URLSearchParams({ ...(prodQ ? { q: prodQ } : {}), stock: PF.stock, status: PF.status, ...(PF.branch ? { branch: PF.branch } : {}), limit: PF.limit });
  const r = await api('/api/products?' + qs);
  const canEdit = S.boot.me.role !== 'sotuvchi';
  const branches = S.boot.branches || [];
  $('#catalogPage').innerHTML = `${catTabs()}
    <p class="lead">Agent narx va qoldiqni faqat BILLZ’dan, xususiyat va moslikni faqat shu kartalardan oladi. <b>Tasdiqlanmagan</b> karta bo‘yicha agent moslik va’da qilmaydi — sotuvchiga uzatadi. Mazmun o‘zgarsa, tasdiq qaytadan kerak bo‘ladi.</p>
    <div class="panel"><div class="panel-head"><h2>Sotuvchi savoli</h2><span class="muted">Katalog agenti ichki javob beradi — manbasi bilan. Mijozga yuborilmaydi</span></div>
      <div class="row-actions"><input id="askQ" type="text" style="flex:1;min-width:220px" placeholder="Masalan: Sennheiser EW 112P G4 ni Canon R50 ga ulasa bo‘ladimi?">
        <button class="btn primary" type="button" id="askBtn">So‘rash</button></div>
      <div id="askOut" class="note" hidden></div></div>
    <div class="row-actions" style="flex-wrap:wrap"><label class="search" style="flex:1;min-width:220px;max-width:420px"><span>${svg('search')}</span><input id="prodQ" type="search" value="${esc(prodQ)}" placeholder="Model, brend, toifa yoki shtrixkod"></label>
      <label class="field" style="min-width:190px"><span class="sr-only">Holat</span><select id="pfStatus" aria-label="Karta holati bo‘yicha filtr">
        ${[['all', 'Barcha kartalar'], ['queue', 'Tekshirish navbati'], ['draft', 'Tasdiqlanmagan'], ['verified', 'Tasdiqlangan']].map(([v, l]) => `<option value="${v}" ${PF.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field" style="min-width:170px"><span class="sr-only">Qoldiq</span><select id="pfStock" aria-label="Qoldiq bo‘yicha filtr">
        ${[['all', 'Hammasi'], ['store', 'Do‘konda bor'], ['warehouse', 'Faqat omborda'], ['none', 'Qoldiq yo‘q']].map(([v, l]) => `<option value="${v}" ${PF.stock === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field" style="min-width:190px"><span class="sr-only">Filial</span><select id="pfBranch" aria-label="Filial bo‘yicha filtr"><option value="">Barcha filiallar</option>
        ${branches.map(b => `<option value="${esc(b.name)}" ${PF.branch === b.name ? 'selected' : ''}>${esc(b.name)}${b.kind === 'ombor' ? ' (ombor)' : ''}</option>`).join('')}</select></label>
      ${canEdit ? '<button class="btn primary" type="button" data-pnew>Yangi karta</button>' : ''}</div>
    <div class="muted" style="font-size:13px">${r.total} ta tovar${r.total > r.items.length ? ` · ${r.items.length} tasi ko‘rsatilgan` : ''} · tasdiqlangan karta: <b style="color:var(--ink)">${r.verified}</b> / 60 (qabul sinovi Q3)${PF.status === 'queue' ? ' · navbat: omborda bor, tasdiqlanmagan, 90 kunda ko‘p sotilgani oldin' : ''}</div>
    <div class="prod-list">${r.items.map(p => `
      <article class="prod">
        <div class="meta"><span class="pill ${p.status === 'verified' ? 'ok' : 'warn'}">${p.status === 'verified' ? 'tasdiqlangan' : 'tasdiqlanmagan'}</span><span class="pill">${esc(p.category || 'toifa yo‘q')}</span></div>
        <h3>${esc(p.name)}</h3>
        <div class="mono" style="font-size:13px">${p.billz.price != null ? money(p.billz.price) : '<span class="muted">narx yo‘q</span>'}
          <span class="muted" style="font-family:var(--f-body)"> · ${esc(p.billz.source)}${p.billz.stale ? ' · eskirgan' : ''}</span></div>
        <div class="chips" style="align-items:center">${stockLine(p.billz)}${p.sold90 ? `<span class="muted" style="font-size:12px">· 90 kunda ${p.sold90} ta sotilgan</span>` : ''}</div>
        ${p.has_photo ? `<img class="prod-img" src="/api/products/${p.id}/photo" alt="${esc(p.name)}" loading="lazy">` : ''}
        ${p.specs ? `<p>${esc(p.specs)}</p>` : ''}
        ${p.compat ? `<p><b style="color:var(--ink)">Moslik:</b> ${esc(p.compat)}</p>` : ''}
        ${p.limits ? `<p><b style="color:var(--ink)">Cheklov:</b> ${esc(p.limits)}</p>` : ''}
        ${canEdit ? `<div class="row-actions"><button class="btn sm" type="button" data-pedit="${p.id}">Tahrirlash</button>
          <button class="btn sm ${p.status === 'verified' ? '' : 'primary'}" type="button" data-pverify="${p.id}" data-on="${p.status !== 'verified'}">${p.status === 'verified' ? 'Tasdiqni olish' : 'Tasdiqlash'}</button>
          <button class="btn sm" type="button" data-pphoto="${p.id}">${p.has_photo ? 'Rasmni almashtirish' : 'Rasm yuklash'}</button>
          ${p.has_photo ? `<button class="btn sm ghost" type="button" data-pphotodel="${p.id}">Rasmni olib tashlash</button>` : `<button class="btn sm ai" type="button" data-pphotoweb="${p.id}">Internetdan topish</button>`}
          <span class="muted" style="font-size:12px">${p.has_photo ? `Rasm: ${esc(p.photo_from || '')} — AI mijozga yubora oladi` : 'Rasm yo‘q — mijoz so‘rasa AI rasmiy saytdan qidiradi'}</span></div>` : ''}
      </article>`).join('') || '<div class="muted">Bu filtr bo‘yicha tovar yo‘q.</div>'}</div>
    ${r.total > r.items.length ? `<div class="row-actions" style="justify-content:center"><button class="btn" type="button" id="pfMore">Yana ko‘rsatish (${Math.min(60, r.total - r.items.length)})</button></div>` : ''}`;
}
/* Rasm brauzerda kichraytiriladi: telefon rasmi 4–8 MB bo‘ladi, mijozga 1600px yetarli */
function shrinkImage(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Rasmni o‘qib bo‘lmadi')); };
    img.src = url;
  });
}
let prodTimer;
$('#catalogPage').addEventListener('input', e => { if (e.target.id === 'prodQ') { prodQ = e.target.value.trim(); PF.limit = 60; clearTimeout(prodTimer); prodTimer = setTimeout(async () => { await renderCatalog(); const i = $('#prodQ'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 300); } });
$('#catalogPage').addEventListener('change', e => {
  if (e.target.id === 'pfStock') { PF.stock = e.target.value; PF.limit = 60; renderCatalog(); }
  if (e.target.id === 'pfStatus') { PF.status = e.target.value; PF.limit = 60; renderCatalog(); }
  if (e.target.id === 'pfBranch') { PF.branch = e.target.value; PF.limit = 60; renderCatalog(); }
});
/* O‘qitish tablari: tasdiqlangan javoblar va do‘kon ma’lumoti */
$('#catalogPage').addEventListener('click', async e => {
  const tab = e.target.closest('[data-ctab]');
  if (tab) { catTab = tab.dataset.ctab; return renderCatalog(); }
  if (e.target.id === 'ansSave') {
    const question = $('#ansQ').value.trim(), answer = $('#ansA').value.trim();
    if (!question || !answer) return toast('Savol va javobni yozing');
    await api('/api/answers', { question, answer }).then(() => { toast('Saqlandi — agent endi shunday javob beradi'); renderAnswers(); }).catch(fail);
  }
  const ae = e.target.closest('[data-ansedit]');
  if (ae) {
    const a = JSON.parse($('#catalogPage').dataset.answers || '[]').find(x => x.id === Number(ae.dataset.ansedit));
    return modal(`<h2>Javobni tahrirlash #${a.id}</h2><label class="field"><span>Mijoz savoli</span><textarea name="question" id="ae_q" required>${esc(a.question)}</textarea></label>
      <label class="field"><span>To‘g‘ri javob</span><textarea name="answer" id="ae_a" required style="min-height:110px">${esc(a.answer)}</textarea></label>`,
    async d => { await api('/api/answers', { id: a.id, question: d.question, answer: d.answer }); toast('Saqlandi'); renderAnswers(); });
  }
  const ao = e.target.closest('[data-anson]');
  if (ao) { await api(`/api/answers/${ao.dataset.anson}/active`, { on: ao.dataset.v === '1' }).catch(fail); return renderAnswers(); }
  const on = e.target.closest('[data-knon]');
  if (on) {
    const k = JSON.parse($('#catalogPage').dataset.knowledge || '[]').find(x => x.id === Number(on.dataset.knon));
    if (k) { on.disabled = true; await api('/api/knowledge', { id: k.id, title: k.title, body: k.body, active: true }).catch(fail); toast('Tasdiqlandi — agent endi shu ma’lumotdan foydalanadi'); renderKnowledge(); }
    return;
  }
  const kn = e.target.closest('[data-knnew],[data-knedit]');
  if (kn) {
    const k = kn.dataset.knedit ? JSON.parse($('#catalogPage').dataset.knowledge || '[]').find(x => x.id === Number(kn.dataset.knedit)) : { title: kn.dataset.knnew || '', body: '', active: 1 };
    return modal(`<h2>${k.id ? 'Bo‘limni tahrirlash' : 'Yangi bo‘lim'}</h2><label class="field"><span>Sarlavha</span><input name="title" id="kn_t" value="${esc(k.title)}" required></label>
      <label class="field"><span>Matn — agent shuni aytadi</span><textarea name="body" id="kn_b" required style="min-height:160px" placeholder="Masalan: Barcha tovarlarga rasmiy kafolat 12 oy. Kafolat bo‘yicha murojaat — chek bilan istalgan filialga.">${esc(k.body)}</textarea></label>
      ${k.id ? `<label class="field"><span>Holat</span><select name="active" id="kn_a"><option value="1" ${k.active ? 'selected' : ''}>faol</option><option value="0" ${!k.active ? 'selected' : ''}>o‘chirilgan</option></select></label>` : ''}`,
    async d => { await api('/api/knowledge', { id: k.id, title: d.title, body: d.body, active: d.active !== '0' }); toast('Saqlandi'); renderKnowledge(); });
  }
});
$('#catalogPage').addEventListener('click', async e => {
  if (e.target.id === 'pfMore') { PF.limit += 60; const y = scrollY; await renderCatalog(); scrollTo(0, y); return; }
  if (e.target.id === 'askBtn') {
    const q = $('#askQ').value.trim(); if (!q) return;
    const out = $('#askOut'); out.hidden = false; out.textContent = 'Katalog agenti javob tayyorlamoqda…';
    e.target.disabled = true;
    const r = await api('/api/catalog/ask', { q }).catch(err => ({ ok: false, why: err.message }));
    e.target.disabled = false;
    out.innerHTML = r.ok ? `${esc(r.text).replace(/\n/g, '<br>')}${r.sources?.length ? `<br><span class="muted" style="font-size:12px">Manba: ${esc(r.sources.join(' · '))}</span>` : ''}`
      : `<span class="muted">Javob bo‘lmadi: ${esc(r.why || 'xato')}</span>`;
    return;
  }
  const v = e.target.closest('[data-pverify]');
  if (v) { await api(`/api/products/${v.dataset.pverify}/verify`, { on: v.dataset.on === 'true' }).catch(fail); return renderCatalog(); }
  const pw = e.target.closest('[data-pphotoweb]');
  if (pw) {
    pw.disabled = true; pw.textContent = 'Qidirilmoqda… (10–30 s)';
    const r = await api(`/api/products/${pw.dataset.pphotoweb}/photo/web`, {}).catch(err => ({ ok: false, why: err.message }));
    toast(r.ok ? `Rasm topildi: ${r.source ? new URL(r.source).hostname : ''}` : `Topilmadi: ${r.why || ''}`);
    return renderCatalog();
  }
  const pdel = e.target.closest('[data-pphotodel]');
  if (pdel) {
    if (!confirm('Rasmni olib tashlaysizmi? (noto‘g‘ri bo‘lsa)')) return;
    await api(`/api/products/${pdel.dataset.pphotodel}/photo/remove`, {}).catch(fail);
    toast('Rasm olib tashlandi'); return renderCatalog();
  }
  const ph = e.target.closest('[data-pphoto]');
  if (ph) {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/jpeg,image/png';
    inp.onchange = async () => {
      const file = inp.files?.[0]; if (!file) return;
      toast('Rasm yuklanmoqda…');
      try {
        const data = await shrinkImage(file);
        const r = await api(`/api/products/${ph.dataset.pphoto}/photo`, { data });
        if (!r.ok) return toast(r.why || 'Yuklanmadi');
        toast('Rasm saqlandi — AI endi shu rasmni mijozga yubora oladi');
        renderCatalog();
      } catch (err) { fail(err); }
    };
    inp.click();
    return;
  }
  const ed = e.target.closest('[data-pedit]'), nw = e.target.closest('[data-pnew]');
  if (!ed && !nw) return;
  const p = ed ? (await api(`/api/products/${ed.dataset.pedit}`)).item : { sources: [] };
  const f = (k, l, ta) => `<label class="field ${ta ? 'wide' : ''}"><span>${l}</span>${ta ? `<textarea name="${k}" id="p_${k}">${esc(p[k] || '')}</textarea>` : `<input name="${k}" id="p_${k}" value="${esc(p[k] || '')}">`}</label>`;
  modal(`<h2>${ed ? 'Kartani tahrirlash' : 'Yangi karta'}</h2><div class="form-grid">
    ${f('name', 'Nomi (aniq model)')}${f('brand', 'Brend')}${f('category', 'Toifa')}<span></span>
    ${f('specs', 'Asosiy xususiyatlar', true)}${f('kit', 'To‘plam tarkibi', true)}${f('compat', 'Moslik (ulanish, mount, format)', true)}${f('limits', 'Cheklovlar', true)}
    <label class="field wide"><span>Manbalar (har qatorda bittasi: havola yoki hujjat, tekshirilgan sana)</span><textarea name="sources" id="p_sources">${esc((p.sources || []).join('\n'))}</textarea></label></div>
    ${ed ? '<div class="row-actions"><button class="btn sm ai" type="button" id="p_research">Katalog agenti bilan to‘ldirish</button><span class="muted" style="font-size:12px">Ishlab chiqaruvchi manbasidan qoralama. Siz tekshirib saqlaysiz va tasdiqlaysiz.</span></div>' : ''}`,
  async d => {
    await api('/api/products', { ...d, id: p.id, sources: String(d.sources || '').split('\n').map(s => s.trim()).filter(Boolean) });
    toast(ed ? 'Saqlandi (mazmun o‘zgargan bo‘lsa — qayta tasdiqlang)' : 'Karta qo‘shildi'); renderCatalog();
  });
  $('#p_research')?.addEventListener('click', async ev => {
    const b = ev.currentTarget; b.disabled = true; b.textContent = 'Qidirilmoqda… (1–2 daqiqa)';
    const r = await api(`/api/products/${p.id}/research`, {}).catch(e => ({ ok: false, why: e.message }));
    b.disabled = false; b.textContent = 'Katalog agenti bilan to‘ldirish';
    if (!r.ok) return toast(r.why || 'Topilmadi');
    for (const k of ['specs', 'kit', 'compat', 'limits']) if (r.card[k]) $('#p_' + k).value = r.card[k];
    $('#p_sources').value = (r.card.sources || []).join('\n');
    toast('Qoralama to‘ldirildi — tekshirib «Saqlash» bosing', 'ai');
  });
});

/* =====================================================================
   SOTUVCHILAR — boshliq agent: topshiriqlar, reyting, rag‘bat va ogohlantirish
   ===================================================================== */
let sellersDays = 7;
async function renderSellers() {
  const r = await api(`/api/sellers?days=${sellersDays}`), L = r.statusL, st = r.settings;
  const rows = [...r.items].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.offered - a.offered);
  const sum = k => rows.reduce((a, x) => a + (x[k] || 0), 0);
  const offered = sum('offered'), responded = sum('responded'), missed = sum('missed'), done = sum('done');
  const accs = rows.filter(x => x.react_min != null), accAvg = accs.length ? accs.reduce((a, x) => a + x.react_min, 0) / accs.length : null;
  const mins = m => m == null ? '—' : `${Math.max(1, Math.round(m))} daq`;
  const fmtLim = m => m >= 60 && m % 60 === 0 ? `${m / 60} soat` : `${m} daqiqa`;
  const notLinked = rows.filter(x => !x.linked);
  const ST_CLS = { alo: 'ok', yaxshi: 'ok', etibor: 'warn', befarq: 'bad', kam: '' };
  const OPEN_L = { queued: 'navbatda (smena boshlanishini kutmoqda)', offered: 'sotuvchi ko‘rishi kutilmoqda', accepted: 'sotuvchida', escalated: 'rahbarga o‘tdi' };
  $('#sellersPage').innerHTML = `
    <div class="panel"><div class="panel-head"><h2>AI boshliq</h2>
      <div class="seg" role="group" style="margin-left:auto">${[[1, 'Bugun'], [7, '7 kun'], [30, '30 kun']].map(([d, l]) => `<button type="button" data-sdays="${d}" aria-pressed="${sellersDays === d}">${l}</button>`).join('')}</div></div>
      <p class="lead" style="font-size:13px;margin:0">Oddiy savollarga AI o‘zi javob beradi. Faqat rasm topilmasa, to‘lov/chek, buyurtma va dastavka, shikoyat bo‘lsa — AI sotuvchiga rahbar nomidan, oddiy xabar bilan aytadi (tugmasiz, mijoz — havola).
        Sotuvchi ko‘rib biror narsa yozsa yoki mijozga javob bersa — ish bajarilgan hisoblanadi. ${fmtLim(st.assign_done_minutes)} ichida hech qanday javob bo‘lmasa — ogohlantirishsiz keyingi sotuvchiga o‘tadi
        (mijoz hozir to‘lamoqchi bo‘lsa — ${st.assign_urgent_minutes} daqiqada, online sotuvchiga). Tez-tez ko‘rmay qolsa — «iltimos, e’tiborli bo‘ling» deb ogohlantiriladi.
        Har kuni ${esc(st.seller_report_time)} da natija rahbarga yuboriladi.</p>
      <p class="lead" style="font-size:13px;margin:8px 0 0"><b>Topshiriq Photobuy akkauntidan (rahbar nomidan) boradi</b> — buning uchun sotuvchi har kuni ish boshida Photobuy Telegram akkauntiga bitta xabar yozadi (masalan «Salom, ishdaman»). Telegram qoidasi: akkaunt faqat oxirgi 24 soatda unga yozgan odamga yoza oladi. Yozmagan sotuvchiga topshiriq bot orqali boradi.</p></div>
    ${notLinked.length ? `<div class="banner warn"><div><b>${notLinked.length} ta sotuvchi Telegram botga ulanmagan — ular topshiriq olmaydi:</b> ${notLinked.map(x => esc(x.name)).join(', ')}.
      <a href="#xodimlar">Xodimlar</a> sahifasida Telegram username kiriting va ularga ${r.bot ? `<b>t.me/${esc(r.bot)}</b>` : 'botni'} yuboring — «Start» bossa o‘zi ulanadi.</div></div>` : ''}
    <div class="kpis">
      <div class="kpi"><span class="muted">Topshiriqlar</span><div class="v">${offered}</div><div class="s">${done} tasi bajarildi</div></div>
      <div class="kpi"><span class="muted">Javob berildi</span><div class="v">${offered ? Math.round(100 * responded / offered) : 0}<small>%</small></div><div class="s">${responded} / ${offered}</div></div>
      <div class="kpi"><span class="muted">O‘rtacha javob vaqti</span><div class="v">${accAvg == null ? '—' : Math.max(1, Math.round(accAvg))}<small>${accAvg == null ? '' : ' daq'}</small></div><div class="s">chegara ${fmtLim(st.assign_done_minutes)}</div></div>
      <div class="kpi"><span class="muted">Ko‘rmay qolgan</span><div class="v">${missed}</div><div class="s">javobsiz boshqasiga o‘tgan</div></div>
    </div>
    <div class="panel"><div class="panel-head"><h2>Reyting</h2><span class="muted">Ball: javob berish 70% · tezlik 30%, har rad etish −5. 3 tadan kam ishda baho berilmaydi. Ism ustiga bosing — profil.</span></div>
      <div class="tbl"><table><thead><tr><th>Sotuvchi</th><th class="n">Topshiriq</th><th class="n">Javob</th><th class="n">O‘rt. javob</th><th class="n">Ko‘rmadi</th><th class="n">Rad etdi</th><th class="n">Bajardi</th><th class="n">Mijozga xabar</th><th class="n">Ball</th><th>Holat</th><th>Tavsiya</th></tr></thead><tbody>
      ${rows.map(x => `<tr><td><button class="namebtn" type="button" data-sprof="${x.id}" title="Profil: izohlar, yozishma, topshiriqlar"><b>${esc(x.name)}</b></button><div class="muted" style="font-size:12px">${!x.linked ? '<span style="color:var(--bad)">Telegram ulanmagan</span>' : [x.online ? '<span style="color:var(--ok)">online</span>' : x.active_at ? 'faol: ' + ago(x.active_at) + ' oldin' : '', x.at_work ? 'bugun ishda' : 'bugun akkauntga yozmagan', x.on_shift ? '' : 'smenada emas'].filter(Boolean).join(' · ')}</div></td>
        <td class="n mono">${x.offered}</td><td class="n mono">${x.responded}</td><td class="n mono">${mins(x.react_min)}</td>
        <td class="n mono"${x.missed ? ' style="color:var(--bad)"' : ''}>${x.missed}</td><td class="n mono"${x.declined ? ' style="color:var(--bad)"' : ''}>${x.declined}</td>
        <td class="n mono">${x.done}</td><td class="n mono">${x.replies}</td><td class="n mono"><b>${x.score ?? '—'}</b></td>
        <td><span class="pill ${ST_CLS[x.status]}">${esc(L[x.status])}</span></td>
        <td>${x.rec === 'ragbat' ? '<span class="pill ok">Rag‘batlantirish</span>' : x.rec === 'ogohlantirish' ? '<span class="pill bad">Ogohlantirish</span>' : '<span class="muted">—</span>'}</td></tr>`).join('') || '<tr><td colspan="11" class="muted">Sotuvchi yo‘q</td></tr>'}
      </tbody></table></div></div>
    <div class="panel"><div class="panel-head"><h2>Ochiq topshiriqlar</h2><span class="muted">${r.open.length} ta</span></div>
      ${r.open.length ? `<div class="tbl"><table><thead><tr><th>Turi</th><th>Mijoz</th><th>Vazifa</th><th>Kimda</th><th>Holat</th><th class="n">Vaqt</th><th></th></tr></thead><tbody>
      ${r.open.map(a => `<tr><td>${esc(r.kinds[a.kind]?.label || a.kind)}</td><td>${brand(a.channel)} ${esc(a.display_name || a.handle || '#' + a.conversation_id)}</td>
        <td style="max-width:320px">${esc(a.body || a.title)}</td><td>${esc(a.user_name || '—')}${a.attempts > 1 ? `<div class="muted" style="font-size:12px">${a.attempts}-urinish</div>` : ''}</td>
        <td><span class="pill ${a.status === 'escalated' ? 'bad' : a.status === 'accepted' ? 'ok' : 'warn'}">${OPEN_L[a.status] || a.status}</span></td>
        <td class="n muted">${ago(a.accepted_at || a.offered_at || a.created_at)}</td>
        <td><div class="row-actions" style="flex-wrap:nowrap"><a class="btn sm" href="#suhbat/${a.conversation_id}">Ochish</a><button class="btn sm" type="button" data-asdone="${a.id}">Bajarildi</button><button class="btn sm ghost" type="button" data-ascancel="${a.id}">Bekor</button></div></td></tr>`).join('')}
      </tbody></table></div>` : '<p class="muted" style="margin:0">Hozir ochiq topshiriq yo‘q.</p>'}</div>
    <form class="panel" id="sellerSetForm"><div class="panel-head"><h2>Qoidalar</h2></div>
      <div class="form-grid">
        <label class="field"><span>Javob bo‘lmasa — boshqa sotuvchiga (daqiqa)</span><input type="number" min="10" max="1440" name="assign_done_minutes" value="${st.assign_done_minutes}"></label>
        <label class="field"><span>Mijoz hozir to‘lamoqchi — boshqasiga (daqiqa)</span><input type="number" min="1" max="30" name="assign_urgent_minutes" value="${st.assign_urgent_minutes}"></label>
        <label class="field"><span>«Online» hisoblanadi (oxirgi faollik, daqiqa)</span><input type="number" min="5" max="240" name="staff_active_minutes" value="${st.staff_active_minutes}"></label>
        <label class="field"><span>Kunlik hisobot vaqti</span><input type="time" name="seller_report_time" value="${esc(st.seller_report_time)}"></label>
        <label class="field"><span>Tez-tez ko‘rmasa — «e’tiborli bo‘ling»</span><select name="seller_auto_warn"><option value="true" ${st.seller_auto_warn ? 'selected' : ''}>yoqilgan</option><option value="false" ${!st.seller_auto_warn ? 'selected' : ''}>o‘chiq</option></select></label>
      </div>
      <div class="row-actions"><button class="btn primary" type="submit">Saqlash</button></div></form>`;
}
/* Sotuvchi profili: natija, AI izohlari, rahbar bilan yozishma, topshiriqlari */
const NOTE_L = { rad: ['Rad etdi', 'bad'], otkazdi: ['Ko‘rmadi', 'warn'], kechikdi: ['Ko‘rmadi', 'warn'], ogohlantirish: ['Ogohlantirildi', 'bad'], kunlik: ['Kunlik xulosa', ''], ai: ['AI kuzatuvi', 'ai'] };
const STEP_L = { offered: 'berildi', accepted: 'ko‘rdi', done: 'bajardi', missed: 'ko‘rmadi', late: 'ko‘rmadi', declined: 'rad etdi', escalated: 'rahbarga' };
const NOW_L = { done: 'bajarilgan', cancelled: 'bekor', failed: 'yopilmadi', escalated: 'rahbarda', offered: 'ko‘rishi kutilmoqda', accepted: 'sotuvchida', queued: 'navbatda' };
async function sellerProfileModal(id, days = 30) {
  const r = await api(`/api/sellers/${id}?days=${days}`), u = r.user, st = r.stats || {};
  const mins = m => m == null ? '—' : `${Math.max(1, Math.round(m))} daq`;
  const tg = u.at_work ? '<span class="pill ok">bugun ishda (akkauntga yozgan)</span>' : u.biz_open ? '<span class="pill">akkaunt oynasi ochiq</span>'
    : u.bot ? '<span class="pill">bot ulangan</span>' : '<span class="pill bad">Telegram ulanmagan</span>';
  const ST_CLS = { alo: 'ok', yaxshi: 'ok', etibor: 'warn', befarq: 'bad' };
  modal(`<h2>${esc(u.name)}</h2>
    <div class="row-actions">${tg}${u.online ? '<span class="pill ok">online</span>' : u.active_at ? `<span class="pill">faol: ${ago(u.active_at)} oldin</span>` : ''}${u.tg_username ? `<span class="muted">@${esc(u.tg_username)}</span>` : ''}
      <div class="seg" role="group" style="margin-left:auto">${[7, 30, 90].map(d => `<button type="button" data-pdays="${d}" aria-pressed="${days === d}">${d} kun</button>`).join('')}</div></div>
    <div class="agent-stats" style="margin-top:4px"><span>Topshiriq <b>${st.offered ?? 0}</b></span><span>Javob <b>${st.responded ?? 0}</b></span><span>O‘rt. javob <b>${mins(st.react_min)}</b></span>
      <span>Ko‘rmadi <b>${st.missed ?? 0}</b></span><span>Rad etdi <b>${st.declined ?? 0}</b></span><span>Bajardi <b>${st.done ?? 0}</b></span>
      <span>Ball <b>${st.score ?? '—'}</b></span><span class="pill ${ST_CLS[st.status] || ''}">${esc(r.statusL[st.status] || '')}</span>
      ${st.rec === 'ragbat' ? '<span class="pill ok">Rag‘batlantirish</span>' : st.rec === 'ogohlantirish' ? '<span class="pill bad">Ogohlantirish</span>' : ''}</div>
    <h3 style="margin:14px 0 6px">AI izohlari</h3>
    <div class="prof-notes">${r.notes.map(n => `<div class="prof-note"><span class="mono muted">${fmtDT(n.created_at)}</span><span class="pill ${(NOTE_L[n.kind] || ['', ''])[1]}">${esc((NOTE_L[n.kind] || [n.kind])[0])}</span><span>${esc(n.text)}</span></div>`).join('') || '<p class="muted" style="margin:0">Hali izoh yo‘q.</p>'}</div>
    <h3 style="margin:14px 0 6px">Rahbar bilan yozishma</h3>
    <div class="prof-chat">${r.messages.map(m => `<div class="msg ${m.dir === 'out' ? 's' : 'c'}"><div class="who">${m.dir === 'out' ? 'Rahbar (tizim)' : esc(u.name)}</div><div class="txt">${esc(m.text)}</div><div class="msg-meta">${fmtDT(m.created_at)} · ${m.via === 'biz' ? 'Photobuy akkaunti' : 'bot'}</div></div>`).join('') || '<p class="muted" style="margin:0">Yozishma yo‘q.</p>'}</div>
    <h3 style="margin:14px 0 6px">Topshiriqlari</h3>
    <div class="tbl"><table><thead><tr><th>Turi</th><th>Mijoz</th><th>Vazifa</th><th>Uning qadamlari</th><th>Hozir</th></tr></thead><tbody>
    ${r.tasks.map(a => `<tr><td>${esc(r.kinds[a.kind]?.label || a.kind)}${a.urgent ? ' <span class="pill bad">tez</span>' : ''}</td>
      <td>${brand(a.channel)} <a href="#suhbat/${a.conversation_id}" data-close>${esc(a.handle || a.display_name || '#' + a.conversation_id)}</a></td>
      <td style="max-width:280px">${esc(a.body || '')}</td><td class="muted" style="font-size:12.5px">${a.steps.map(x => STEP_L[x] || x).join(' → ')}</td><td>${esc(NOW_L[a.status] || a.status)}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Bu davrda topshiriq yo‘q</td></tr>'}
    </tbody></table></div>`, null, () => {
      $('#mForm').classList.add('wide');
      const ch = $('#mForm .prof-chat'); if (ch) ch.scrollTop = ch.scrollHeight;
      $('#mForm').addEventListener('click', ev => { const b = ev.target.closest('[data-pdays]'); if (b) sellerProfileModal(id, Number(b.dataset.pdays)).catch(fail); });
    });
}
$('#sellersPage').addEventListener('click', async e => {
  const pr = e.target.closest('[data-sprof]');
  if (pr) return sellerProfileModal(Number(pr.dataset.sprof)).catch(fail);
  const d = e.target.closest('[data-sdays]');
  if (d) { sellersDays = Number(d.dataset.sdays); return renderSellers(); }
  const dn = e.target.closest('[data-asdone]'), cn = e.target.closest('[data-ascancel]');
  if (dn) { const r = await api(`/api/assignments/${dn.dataset.asdone}`, { action: 'done' }).catch(fail); if (r) toast(r.msg || 'Bajarildi'); return renderSellers(); }
  if (cn) { if (!confirm('Topshiriq bekor qilinsinmi?')) return; await api(`/api/assignments/${cn.dataset.ascancel}`, { action: 'cancel' }).catch(fail); toast('Bekor qilindi'); return renderSellers(); }
});
$('#sellersPage').addEventListener('submit', async e => {
  if (e.target.id !== 'sellerSetForm') return;
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target).entries());
  d.seller_auto_warn = d.seller_auto_warn === 'true';
  const r = await api('/api/settings', d).catch(fail);
  if (r) { toast('Saqlandi'); renderSellers(); }
});

/* =====================================================================
   AI AGENT — kanal bo‘yicha yoqish/to‘xtatish, bosqich va avtojavob
   ===================================================================== */
const CH_L = { tg: 'Telegram', ig: 'Instagram', demo: 'Demo' };
const ROLL_HINT = { kuzatish: 'AI qoralama yozadi — mijozga yuborilmaydi', tasdiq: 'Sotuvchi «Hozir yuborish» bossa yuboriladi', avto: 'Sotuvchi javob bermasa — AI o‘zi yuboradi' };
/* AI sarfi: tokenlar, pul va balans. Google qolgan balansni API orqali bermaydi —
   shuning uchun rahbar to‘ldirgan summani kiritadi, panel esa shundan sarfni ayirib boradi. */
const usd = n => n == null ? '—' : '$' + (Math.abs(n) < 10 ? n.toFixed(2) : n.toFixed(1));
/* Mayda summalar (bitta javob narxi: lite modelda ~$0.003) — 2 kasr «$0.00» ko‘rsatib qo‘yardi */
const usdS = n => n == null ? '—' : '$' + (Math.abs(n) < 0.01 ? n.toFixed(4) : Math.abs(n) < 0.1 ? n.toFixed(3) : n.toFixed(2));
const tokens = n => !n ? '0' : n >= 1e6 ? (n / 1e6).toFixed(n < 1e7 ? 1 : 0) + ' mln' : n >= 1e3 ? Math.round(n / 1e3) + ' ming' : String(n);

/* AI hisobi (rahbar so‘rovi, 2026-10-09): taxminiy sarf, balans va jadval ko‘rsatilmaydi — faqat Google AI Studio’dagi haqiqiy
   hisobga tugma. Ogohlantirish faqat favqulodda holatda: Google balansi tugagan (402) yoki chegara tufayli AI to‘xtagan. */
function usagePanel(x) {
  const warn = x.credits_out_at ? '<div class="banner warn"><div><b>Balans tugagan.</b> AI javob yoza olmayapti — Google AI Studio’da to‘ldiring.</div></div>'
    : x.stop ? `<div class="banner warn"><div><b>AI to‘xtatilgan</b> — ${x.stop.why === 'day' ? 'kunlik' : x.stop.why === 'month' ? 'oylik' : 'balans'} chegarasi. Suhbatlar sotuvchilarga qolyapti.</div></div>` : '';
  return `<div class="panel${warn ? ' panel-warn' : ''}"><div class="panel-head"><h2>AI hisobi</h2>
      <span class="ai-real" style="margin-left:auto"><a class="btn primary" href="${AISTUDIO_BILLING}" target="_blank" rel="noopener"
        title="Google AI Studio: haqiqiy sarf va qolgan balans">${svg('chart')}Hisobni ko‘rish — Google AI Studio</a></span></div>${warn}</div>`;
}
/* Eski batafsil ko‘rinish (taxminiy sarf, balans, kunlar jadvali) — hozir ishlatilmaydi; kerak bo‘lsa usagePanel o‘rniga qo‘yiladi */
function usagePanelFull(x) {
  const left = x.topup ? x.topup.left : null;
  const low = left != null && left < (x.reserve || 0) + 5;
  const out = Boolean(x.credits_out_at);
  const tile = (l, v, s2 = '') => `<div class="rtile"><span class="rt-l">${l}</span><b class="rt-v">${v}</b>${s2 ? `<span class="rt-s">${s2}</span>` : ''}</div>`;
  // Nechta mijozga nechta javob (server eski bo‘lsa — avvalgidek tokenlar)
  const served = t => (t.people != null ? `${num(t.people)} mijozga ${num(t.replies || 0)} ta javob` : `${tokens(t.in_tok + t.out_tok)} token`);
  return `<div class="panel${out || low ? ' panel-warn' : ''}"><div class="panel-head"><h2>AI sarfi va balans</h2>
      <span class="muted">${esc(x.model || '')} · 1 mln token: kiruvchi $${x.price.in}${x.price.audio && x.price.audio !== x.price.in ? ` (ovoz $${x.price.audio})` : ''}, chiquvchi $${x.price.out}, keshdan $${x.price.cached}${x.price.storage ? ` · kesh saqlash $${x.price.storage}/soat` : ''}</span>
      <span class="row-actions" style="margin-left:auto">
        <a class="btn sm ${out || low ? 'primary' : ''}" href="${AISTUDIO_BILLING}" target="_blank" rel="noopener">Google AI Studio’da to‘ldirish</a>
        <button class="btn sm ghost" type="button" id="aiTopup">To‘ldirdim</button>
        <button class="btn sm ghost" type="button" id="aiLimit">Chegara</button></span></div>
    ${out ? `<div class="banner warn"><b>Balans tugagan.</b> AI javob yoza olmayapti — «Google AI Studio’da to‘ldirish» tugmasini bosing,
      to‘lgandan keyin «To‘ldirdim» ni bosib summani kiriting. ${esc(String(x.credits_out_msg || '').slice(0, 160))}</div>`
      : x.stop?.why === 'balance' ? `<div class="banner warn"><div><b>AI to‘xtatildi — balansda ${usd(x.stop.spent)} qoldi.</b>
          ${usd(x.stop.limit)} qolganda AI o‘zi o‘chadi, hisob minusga kirmasligi uchun. Suhbatlar sotuvchilarga qolyapti.
          Google AI Studio’da to‘ldiring → «To‘ldirdim» ni bosib summani kiriting → pastda AI ni qayta yoqing.</div></div>`
      : x.stop ? `<div class="banner warn"><b>${x.stop.why === 'day' ? 'Kunlik' : 'Oylik'} chegara tugadi</b> — ${usd(x.stop.spent)} / ${usd(x.stop.limit)}.
          AI javob yozmayapti, suhbatlar sotuvchilarga qolyapti. ${x.stop.why === 'day' ? 'Yarim tunda o‘zi tiklanadi' : 'Oy boshida tiklanadi'}, yoki «Chegara» dan oshiring.</div>`
      : low ? `<div class="banner warn"><div><b>Balans tugay deb qoldi:</b> ${usd(left)} qoldi. ${usd(x.reserve)} qolganda AI o‘zi o‘chadi — oldindan to‘ldirib qo‘ying.</div></div>` : ''}
    <div class="rtiles">
      ${tile('Bugun', usd(x.today.usd), `${served(x.today)} · ${x.today.calls} so‘rov`)}
      ${tile('Shu oy', usd(x.month.usd), `${served(x.month)} · ${x.month.calls} so‘rov`)}
      ${x.topup ? tile('Balansdan qoldi', usd(left), `${usd(x.reserve)} qolganda AI o‘zi o‘chadi · oxirgi kiritish ${fmtD(x.topup.at)}`) : tile('Balans', '—', '«To‘ldirdim» ni bosib, to‘ldirgan summangizni kiriting')}
      ${tile('Bitta javob', x.per_reply ? usdS(x.per_reply) : '—', x.per_reply_info ? `o‘rtacha · ${x.per_reply_info.span}, ${x.per_reply_info.drafts} ta javob` : 'o‘rtacha narx')}
      ${x.limits.day ? tile('Bugungi chegara', usd(Math.max(0, x.limits.day - x.today.usd)), `${usd(x.limits.day)} dan qoldi`) : ''}
    </div>
    ${x.days.length ? `<div class="tbl"><table><thead><tr><th>Kun</th><th class="n" title="AI javob bergan mijozlar">Mijoz</th><th class="n" title="AI yozgan javoblar">Javob</th><th class="n">So‘rov</th><th class="n">Kiruvchi</th><th class="n">Chiquvchi</th><th class="n">Narx</th></tr></thead><tbody>
      ${x.days.map(d => `<tr><td>${esc(d.day)}</td><td class="n mono">${d.people != null ? num(d.people) : '—'}</td><td class="n mono">${d.replies ? num(d.replies) : '—'}</td><td class="n mono">${d.calls}</td><td class="n mono">${tokens(d.in_tok)}</td><td class="n mono">${tokens(d.out_tok)}</td><td class="n mono">${usd(d.usd)}</td></tr>`).join('')}
    </tbody></table></div>` : '<p class="muted" style="font-size:12.5px;margin:0">Hali sarf yozilmagan — birinchi javobdan keyin shu yerda ko‘rinadi.</p>'}
    <div class="ai-real"><a class="btn primary" href="${AISTUDIO_BILLING}" target="_blank" rel="noopener"
      title="Google AI Studio: haqiqiy sarf va qolgan balans (paneldagi raqam — taxminiy)">${svg('chart')}Haqiqiy hisobni ko‘rish — Google AI Studio</a></div></div>`;
}
/* Google AI Studio’ning to‘lov sahifasi: haqiqiy sarf, qolgan balans va «Buy credits» (ai.google.dev/gemini-api/docs/billing) */
const AISTUDIO_BILLING = 'https://aistudio.google.com/billing';

async function renderAgent() {
  const r = await api('/api/agent'), ai = r.ai || {}, T = r.settings.T_seconds;
  const use = await api('/api/ai-usage').catch(() => null);
  const live = r.accounts.filter(a => !a.is_demo), anyOn = live.some(a => a.ai_enabled);
  const segs = (a, key, opts) => `<div class="seg" role="group">${Object.entries(opts).map(([k, l]) => `<button type="button" data-acc="${a.id}" data-key="${key}" data-val="${k}" aria-pressed="${a[key] === k}">${l}</button>`).join('')}</div>`;
  const modeHint = { doim: 'Kutmasdan darhol javob', kechiksa: `Sotuvchi ${T} soniyada javob bermasa`, ochiq: 'AI o‘zi yubormaydi, faqat taklif yozadi' };
  const status = a => !a.ai_enabled ? 'AI to‘xtatilgan — mijoz xabarlari keladi, javobni sotuvchi yozadi'
    : a.rollout === 'kuzatish' ? 'AI faqat qoralama yozadi, mijozga yubormaydi'
    : a.rollout === 'tasdiq' ? 'AI yozadi, sotuvchi tasdiqlasa yuboriladi'
    : a.mode === 'ochiq' ? 'Avtojavob o‘chiq — AI faqat taklif yozadi'
    : a.mode === 'doim' ? 'AI mijozga o‘zi, darhol javob beradi' : `AI mijozga o‘zi javob beradi — sotuvchi ${T} s ichida yozmasa`;
  const warn = a => a.channel === 'tg' && !a.can_reply ? 'Telegram Business’da javob huquqi berilmagan' : !a.enabled ? 'Kanal o‘chirilgan' : '';
  // Tartib: avval agentlarni boshqarish (kanallar), keyin umumiy qoidalar, eng pastda AI sarfi va balans
  $('#agentPage').innerHTML = `
    <div class="panel"><div class="panel-head"><h2>AI agent</h2>
      <span class="pill ${ai.state === 'ok' ? 'ok' : 'warn'}">${ai.state === 'ok' ? 'AI ulangan' : 'AI ulanmagan'}</span>
      <span class="muted">${esc(ai.detail || '')}</span>
      ${live.length ? `<button class="btn sm ${anyOn ? 'danger' : 'primary'}" type="button" id="${anyOn ? 'agAllOff' : 'agAllOn'}" style="margin-left:auto">${anyOn ? 'Hammasini to‘xtatish' : 'Hammasini yoqish'}</button>` : ''}</div>
      <p class="lead" style="font-size:13px;margin:0">To‘xtatilgan kanalda mijoz xabarlari panelga kelaveradi, lekin AI javob ham, qoralama ham yozmaydi (AI xarajati yo‘q) — suhbatni sotuvchi olib boradi.</p></div>
    ${r.accounts.map(a => `<div class="panel agent-card${a.ai_enabled ? '' : ' off'}">
      <div class="agent-top">
        <div class="set-name">${brand(a.channel)}<div><b>${CH_L[a.channel] || a.channel}</b> · ${esc(a.name)} ${a.is_demo ? '<span class="demo-tag">demo</span>' : ''}
          <div class="set-sub">${esc(status(a))}${warn(a) ? ` · <span style="color:var(--bad)">${esc(warn(a))}</span>` : ''}</div></div></div>
        <button type="button" class="switch" role="switch" aria-checked="${Boolean(a.ai_enabled)}" data-agai="${a.id}" data-val="${a.ai_enabled ? 0 : 1}" data-avto="${a.rollout === 'avto' && a.mode !== 'ochiq' ? 1 : 0}"><span></span>${a.ai_enabled ? 'Ishlayapti' : 'To‘xtatilgan'}</button>
      </div>
      ${a.ai_enabled ? `<div class="agent-opts">
        <div><div class="muted lbl">Bosqich</div>${segs(a, 'rollout', ROLL_L)}<div class="hint">${ROLL_HINT[a.rollout]}</div></div>
        <div><div class="muted lbl">Avtojavob (faqat «Avtomatik» bosqichida)</div>${segs(a, 'mode', MODE_L)}<div class="hint">${modeHint[a.mode]}</div></div>
      </div>` : ''}
      <div class="agent-stats"><span>Bugun mijoz xabari <b>${a.today.client}</b></span><span>AI yubordi <b>${a.today.sent}</b></span><span>AI xatosi <b>${a.today.failed}</b></span><span>Javob kutmoqda <b>${a.today.waiting}</b></span></div>
    </div>`).join('') || '<div class="banner warn"><div><b>Hali kanal ulanmagan.</b> Telegram yoki Instagram ulangach shu yerda chiqadi.</div></div>'}
    <div class="panel"><div class="panel-head"><h2>Umumiy qoidalar</h2></div>
      <p class="lead" style="font-size:13px;margin:0">Kechikish T = <b>${T} s</b> · tungi avtojavob: <b>${r.settings.night_autoreply ? 'yoqilgan' : 'o‘chiq'}</b> · ish vaqti ${esc(r.settings.work_from)}–${esc(r.settings.work_to)}. O‘zgartirish: <a href="#sozlama">Sozlamalar → Qoidalar</a>.</p></div>
    ${use ? usagePanel(use) : ''}`;
}
/* AI sarfi paneli tugmalari («AI agent» sahifasida turadi) */
async function aiLimitModal() {
  const cur = await api('/api/ai-usage').catch(() => null);
  return modal(`<h2>AI chegarasi</h2>
    <p class="lead" style="font-size:13px">Chegaraga yetganda AI so‘rov yubormaydi — suhbatlar sotuvchilarga qoladi va kutilmagan hisob chiqmaydi.
      Kunlik chegara yarim tunda, oylik chegara oy boshida o‘zi tiklanadi. <b>0</b> — chegara yo‘q.</p>
    <div class="grid-2">
      <label class="field"><span>Kuniga, dollarda</span><input name="day" type="number" min="0" step="0.5" value="${cur?.limits?.day ?? 2}"></label>
      <label class="field"><span>Oyiga, dollarda</span><input name="month" type="number" min="0" step="5" value="${cur?.limits?.month ?? 0}"></label>
    </div>`, async d => {
    if (!await api('/api/ai-usage/limits', { day: d.day, month: d.month }).catch(fail)) return true;
    toast('Chegara saqlandi');
    renderAgent();
  });
}
/* «To‘ldirdim»: rahbar Google AI Studio’da qancha to‘ldirganini kiritadi — avvalgi qoldiqqa qo‘shib hisoblanadi.
   Server kiritilgan paytgacha bo‘lgan bugungi sarfni o‘zi chiqarib tashlaydi (2026-10-09 dan), shuning uchun summa
   o‘zgartirilmay yuboriladi. Ilgari bugungi sarf qo‘shib yuborilardi — endi bu balansni ortiqcha ko‘rsatardi. */
async function topupModal() {
  const cur = await api('/api/ai-usage').catch(() => null);
  const R = cur?.reserve ?? 5, prev = cur?.topup ? Math.max(0, cur.topup.left) : null, per = cur?.per_reply || 0;
  const leftOf = (n, exact) => exact || prev == null ? n : prev + n;
  modal(`<h2>Balansni to‘ldirdingizmi?</h2>
    <p class="lead" style="font-size:13px;margin:0">Google AI Studio’da <b>qancha to‘ldirganingizni kiriting</b> — shunga qarab hisoblaymiz.
      ${prev == null ? 'Birinchi marta kiritayotgan bo‘lsangiz, Google AI Studio’dagi <b>hozirgi balansni</b> yozing.' : `Avvalgi qoldiq — ${usd(prev)} — ustiga qo‘shiladi.`}</p>
    <label class="field"><span>Summa, dollarda</span><input name="usd" id="tuUsd" type="number" min="0.01" step="0.01" inputmode="decimal" placeholder="masalan, 50" required></label>
    ${prev == null ? '' : '<label class="tu-exact"><input type="checkbox" name="exact" id="tuExact">Bu — Google’dagi umumiy balans (avvalgi qoldiq qo‘shilmasin)</label>'}
    <div class="note" id="tuCalc" aria-live="polite"></div>`,
  async d => {
    const n = Number(String(d.usd || '').replace(',', '.'));
    if (!(n > 0)) { toast('Summani raqam bilan yozing, masalan 50'); return true; }
    const left = leftOf(n, Boolean(d.exact));
    if (!await api('/api/ai-usage/topup', { usd: Math.round(left * 100) / 100 }).catch(fail)) return true;
    toast(cur?.low_stopped_at && left > R ? `Saqlandi — balans ${usd(left)}. AI to‘xtatilgan edi: pastda qayta yoqing.` : `Saqlandi — balans ${usd(left)}. ${usd(R)} qolganda AI o‘zi o‘chadi.`, 'ai');
    renderAgent();
  },
  () => {
    const calc = () => {
      const n = Number(String($('#tuUsd').value || '').replace(',', '.')) || 0, left = leftOf(n, $('#tuExact')?.checked);
      const use = Math.max(0, left - R), k = per ? Math.floor(use / per) : 0;
      $('#tuCalc').innerHTML = !n ? `Balansda <b>${usd(R)}</b> qolganda AI agent <b>o‘zi o‘chadi</b> — hisob hech qachon minusga kirmaydi.`
        : left <= R ? `Yangi balans <b>${usd(left)}</b> — bu ${usd(R)} zaxiradan kam, AI ishlamaydi. Kattaroq summa to‘ldiring.`
        : `Yangi balans: <b>${usd(left)}</b>. AI uchun <b>${usd(use)}</b> ishlatiladi${k ? ` (taxminan ${num(k)} ta javob)` : ''}.
           <b>${usd(R)}</b> qolganda AI agent o‘zi o‘chadi — hisob minusga kirmaydi.`;
    };
    $('#tuUsd').addEventListener('input', calc); $('#tuExact')?.addEventListener('change', calc); calc();
  });
}
$('#agentPage').addEventListener('click', async e => {
  if (e.target.id === 'aiTopup') return topupModal();
  if (e.target.id === 'aiLimit') return aiLimitModal();
  const sw = e.target.closest('[data-agai]');
  if (sw) {
    const on = sw.dataset.val === '1';
    if (on && sw.dataset.avto === '1' && !confirm('AI shu kanalda mijozlarga o‘zi javob bera boshlaydi. Yoqasizmi?')) return;
    await api(`/api/accounts/${sw.dataset.agai}`, { ai_enabled: on ? 1 : 0 }).catch(fail);
    toast(on ? 'AI agent yoqildi' : 'AI agent to‘xtatildi', on ? 'ai' : undefined);
    return renderAgent();
  }
  const s = e.target.closest('[data-acc]');
  if (s) {
    if (s.dataset.key === 'rollout' && s.dataset.val === 'avto' && !confirm('«Avtomatik» bosqichida AI mijozlarga o‘zi javob yuboradi. Davom etasizmi?')) return;
    await api(`/api/accounts/${s.dataset.acc}`, { [s.dataset.key]: s.dataset.val }).catch(fail);
    toast('Saqlandi'); return renderAgent();
  }
  if (e.target.id === 'agAllOff' || e.target.id === 'agAllOn') {
    const on = e.target.id === 'agAllOn';
    if (!confirm(on ? 'Barcha kanallarda AI yoqiladi. Davom etasizmi?' : 'Barcha kanallarda AI to‘xtatiladi. Davom etasizmi?')) return;
    e.target.disabled = true;
    const r = await api('/api/agent');
    for (const a of r.accounts.filter(x => !x.is_demo && Boolean(x.ai_enabled) !== on)) await api(`/api/accounts/${a.id}`, { ai_enabled: on ? 1 : 0 }).catch(fail);
    toast(on ? 'AI hamma kanalda yoqildi' : 'AI hamma kanalda to‘xtatildi', on ? 'ai' : undefined);
    return renderAgent();
  }
});

/* =====================================================================
   SOZLAMALAR
   ===================================================================== */
async function renderSettings() {
  await loadBoot();
  const r = await api('/api/settings'), s = r.settings, b = S.boot;
  const intl = [['telegram', 'Telegram'], ['billz', 'BILLZ'], ['ai', 'AI'], ['instagram', 'Instagram'], ['backup', 'Zaxira nusxa']];
  const rd = isLead() ? await api('/api/readiness').catch(() => null) : null;
  const segs = (a, key, opts) => `<div class="seg" role="group">${Object.entries(opts).map(([k, l]) => `<button type="button" data-acc="${a.id}" data-key="${key}" data-val="${k}" aria-pressed="${a[key] === k}">${l}</button>`).join('')}</div>`;
  const STATE_L = { ok: 'tayyor', wait: 'kutilmoqda' };
  $('#settingsPage').innerHTML = `
    ${rd ? `<div class="panel"><div class="panel-head"><h2>Ishga tushirish tayyorligi</h2>
      <span class="pill ${rd.ready === rd.total ? 'ok' : 'warn'}">${rd.ready} / ${rd.total} tayyor</span>
      <span class="muted" style="margin-left:auto">Jonli holat — qo‘lda belgilanmaydi</span></div>
      <div class="tbl"><table><thead><tr><th></th><th>Nima</th><th>Holat</th><th>Kim</th><th>Bo‘lmasa</th></tr></thead><tbody>
      ${rd.items.map(x => `<tr><td><span class="state-dot ${x.state === 'ok' ? 'ok' : 'pending'}"></span></td>
        <td><b>${esc(x.title)}</b><div class="muted" style="font-size:12.5px">${esc(x.detail || '')}</div></td>
        <td><span class="pill ${x.state === 'ok' ? 'ok' : 'warn'}">${STATE_L[x.state]}</span></td>
        <td class="muted">${esc(x.who)}</td><td class="muted" style="font-size:12.5px">${x.state === 'ok' ? '—' : esc(x.gap)}</td></tr>`).join('')}
      </tbody></table></div></div>` : ''}
    <div class="int-list">${intl.map(([k, l]) => { const x = b.integrations[k]; return `<div class="int"><b><span class="state-dot ${x.state}"></span>${l}</b><span class="muted">${esc(x.detail || x.state)}</span>${k === 'billz' && x.state !== 'demo' ? '<button class="btn sm" type="button" id="billzSync">Hozir sinxronlash</button>' : ''}${k === 'ai' && isLead() ? `<button class="btn sm ${x.state === 'ok' ? '' : 'primary'}" type="button" id="aiKeyBtn">${x.state === 'ok' ? 'Kalitni almashtirish' : 'Gemini kalitini kiritish'}</button>` : ''}</div>`; }).join('')}</div>
    ${b.bot ? `<div class="panel"><div class="panel-head"><h2>Mijozni botga ulash</h2><span class="muted">Keshbek va yangi tovar xabarlari faqat botga ulangan va rozilik bergan mijozga boradi</span></div>
      <div class="row-actions"><input class="mono" id="botLink" readonly value="https://t.me/${esc(b.bot)}?start=keshbek" style="flex:1;min-width:240px">
        <button class="btn sm" type="button" id="copyBot">Nusxalash</button></div>
      <p class="lead" style="font-size:13px">Kassada: «Keshbekingizni Telegram’da ko‘rish uchun shu havolaga kiring va raqamingizni ulashing». Havoladan QR kod yasab, kassa oynasiga yoki chek shabloniga qo‘ying. Mijoz botni ochib «Raqamni ulashish» tugmasini bosadi — tizim uni BILLZ bilan solishtiradi.</p></div>` : ''}
    <div class="panel">
      <div class="panel-head"><h2>Akkauntlar</h2><span class="muted">AI yoqish/to‘xtatish, bosqich va avtojavob — <a href="#agent">AI agent</a> sahifasida. Yangi ulangan akkaunt «Kuzatish» bosqichida boshlanadi.</span></div>
      ${b.accounts.length ? b.accounts.map(a => `<div class="set-row">
        <div class="set-name">${brand(a.channel)}<div>${esc(a.name)} ${a.is_demo ? '<span class="demo-tag">demo</span>' : ''}<div class="set-sub">${a.channel === 'tg' ? (a.can_reply ? 'Javob huquqi bor' : 'Javob huquqi YO‘Q — Telegram Business sozlamasida bering') : a.channel === 'demo' ? 'Tashqariga hech narsa yubormaydi' : ''}</div></div></div>
        <div class="row-actions"><span class="pill ${a.ai_enabled ? 'ai' : 'bad'}">AI: ${a.ai_enabled ? `${ROLL_L[a.rollout]} · ${MODE_L[a.mode]}` : 'to‘xtatilgan'}</span><a class="btn sm" href="#agent">Boshqarish</a></div>
        <div class="row-actions"><label class="field" style="min-width:140px"><span>Filial</span><select data-accbranch="${a.id}"><option value="">—</option>${b.branches.map(x => `<option value="${x.id}" ${a.branch_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
          <label class="field" style="min-width:140px"><span>Mas’ul</span><select data-accowner="${a.id}"><option value="">—</option>${b.users.map(x => `<option value="${x.id}" ${a.owner_user_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label></div>
      </div>`).join('') : `<div class="banner warn"><div><b>Hali akkaunt ulanmagan.</b> Sotuvchi Telegram’da: Sozlamalar → Telegram Business → Chat-botlar → <b>@${esc(b.bot || 'sotuv_boti')}</b> ni qo‘shadi va «Xabarlarga javob berish» huquqini beradi (Telegram Premium kerak).</div></div>`}
    </div>
    <form class="panel" id="setForm">
      <div class="panel-head"><h2>Qoidalar</h2><span class="tag-test">Sinov qiymatlari · ish boshida tasdiqlanadi</span></div>
      <div class="form-grid">
        <label class="field"><span>Kechikish chegarasi T (soniya)</span><input type="number" min="15" max="3600" name="T_seconds" id="s_T" value="${s.T_seconds}"></label>
        <label class="field"><span>Tungi avtojavob</span><select name="night_autoreply" id="s_night"><option value="true" ${s.night_autoreply ? 'selected' : ''}>yoqilgan</option><option value="false" ${!s.night_autoreply ? 'selected' : ''}>o‘chiq</option></select></label>
        <label class="field"><span>Ish vaqti boshlanishi</span><input type="time" name="work_from" id="s_wf" value="${s.work_from}"></label>
        <label class="field"><span>Ish vaqti tugashi</span><input type="time" name="work_to" id="s_wt" value="${s.work_to}"></label>
        <label class="field"><span>Ertalabki topshirish</span><input type="time" name="morning_handover" id="s_mh" value="${s.morning_handover}"></label>
        <label class="field"><span>Kichik buyurtma — maksimal kutish (daq)</span><input type="number" min="1" name="small_max_wait_minutes" id="s_sw" value="${s.small_max_wait_minutes}"></label>
        <label class="field"><span>Katta buyurtma: pozitsiyalar ≥</span><input type="number" min="1" name="big_positions" id="s_bp" value="${s.big_positions}"></label>
        <label class="field"><span>Katta buyurtma: dona ≥</span><input type="number" min="1" name="big_qty" id="s_bq" value="${s.big_qty}"></label>
        <label class="field"><span>Katta buyurtma: toifalar ≥</span><input type="number" min="1" name="big_categories" id="s_bc" value="${s.big_categories}"></label>
        <label class="field"><span>Katta buyurtma: summa ≥ (0 — hisobga olinmaydi)</span><input type="number" min="0" name="big_amount" id="s_ba2" value="${s.big_amount}"></label>
        <label class="field"><span>Qabul qilinmasa zaxiraga (daq)</span><input type="number" min="1" name="big_accept_minutes" id="s_ba" value="${s.big_accept_minutes}"></label>
        <label class="field"><span>1-ta’qib (AI) — soatdan keyin</span><input type="number" min="1" name="followup_first_hours" id="s_f1" value="${s.followup_first_hours}"></label>
        <label class="field"><span>2-ta’qib (sotuvchi vazifasi) — kundan keyin</span><input type="number" min="1" name="followup_second_days" id="s_f2" value="${s.followup_second_days}"></label>
        <label class="field"><span>Qayta sotuv: kuniga ko‘pi bilan (vazifa)</span><input type="number" min="0" max="500" name="resale_daily_limit" id="s_rdl" value="${s.resale_daily_limit}"></label>
        <label class="field"><span>Hisob valyutasi (BILLZ summalari)</span><select name="currency" id="s_cur"><option value="UZS" ${s.currency !== 'USD' ? 'selected' : ''}>so‘m (UZS)</option><option value="USD" ${s.currency === 'USD' ? 'selected' : ''}>dollar (USD)</option></select></label>
      </div>
      <div class="row-actions"><button class="btn primary" type="submit">Saqlash</button></div>
    </form>
    <div class="grid-2e">
      <div class="panel"><div class="panel-head"><h2>O‘zgarishlar jurnali</h2></div>
        <div class="chlog">${r.changes.map(c => `<div><span class="mono muted">${fmtDT(c.at)}</span><span>${esc(c.who)} · ${esc(c.what)}</span></div>`).join('') || '<span class="muted">Hali o‘zgarish yo‘q</span>'}</div></div>
      <div class="panel"><div class="panel-head"><h2>Demo ma’lumot</h2></div>
        <p class="lead" style="font-size:13px">Demo akkaunt tashqariga hech narsa yubormaydi: taymer, «O‘zim olaman» va AI javobini xavfsiz sinash uchun. Haqiqiy ishga o‘tishda o‘chiring.</p>
        <div class="row-actions">${b.demo ? '<button class="btn" type="button" id="demoOff">Demo ma’lumotni o‘chirish</button>' : '<button class="btn" type="button" id="demoOn">Demo ma’lumotni yuklash</button>'}</div></div>
    </div>`;
}
$('#settingsPage').addEventListener('click', async e => {
  const s = e.target.closest('[data-acc]');
  if (s) { await api(`/api/accounts/${s.dataset.acc}`, { [s.dataset.key]: s.dataset.val }).catch(fail); toast('Saqlandi'); return renderSettings(); }
  if (e.target.id === 'demoOff' && confirm('Demo akkaunt, katalog namunasi va demo suhbatlar o‘chiriladi. Davom etasizmi?')) { await api('/api/demo/remove', {}); toast('Demo o‘chirildi'); return renderSettings(); }
  if (e.target.id === 'demoOn') { await api('/api/demo/seed', {}); toast('Demo yuklandi'); return renderSettings(); }
  if (e.target.id === 'copyBot') { const el = $('#botLink'); el.select(); try { await navigator.clipboard.writeText(el.value); toast('Havola nusxalandi'); } catch { toast('Havolani qo‘lda nusxalang'); } return; }
  if (e.target.id === 'aiKeyBtn') {
    return modal(`<h2>AI kaliti — Gemini</h2>
      <p class="muted" style="margin:0">Google AI Studio (aistudio.google.com → «Get API key») yoki Vertex AI kaliti. Kalit avval tekshiriladi, ishlasa saqlanadi va darhol ishga tushadi. Keyin qayta ko‘rsatilmaydi.</p>
      <p class="muted" style="margin:0">Billing ulangan (pullik) loyiha kaliti bo‘lsin — bepul tarifda Google yuborilgan ma’lumotdan o‘z mahsulotlarini yaxshilashda foydalanishi mumkin.</p>
      <label class="field"><span>Gemini API kaliti</span><input name="key" id="aik" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" required></label>
      <div id="aikMsg" class="muted" role="status"></div>`,
    async d => {
      const msg = $('#aikMsg'), btn = $('#mForm [type=submit]');
      msg.textContent = 'Tekshirilmoqda… (10–30 soniya)'; btn.disabled = true;
      const r = await api('/api/ai-key', { key: d.key }).catch(err => ({ ok: false, why: err.message }));
      btn.disabled = false;
      if (!r.ok) { msg.textContent = r.why || 'Kalit ishlamadi'; return true; }
      toast(`AI ulandi: ${r.model}${r.redraft ? ` — ${r.redraft} ta kutayotgan suhbatga javob tayyorlanmoqda` : ''}`, 'ai');
      renderSettings();
    });
  }
  if (e.target.id === 'billzSync') {
    e.target.disabled = true; e.target.textContent = 'Sinxronlanmoqda…';
    const r = await api('/api/billz/sync', {}).catch(fail);
    if (r) toast(r.busy ? 'BILLZ: sinxron allaqachon ketmoqda' : 'BILLZ: sinxron boshlandi — natija shu qatorda va jurnalda ko‘rinadi');
    setTimeout(renderSettings, 4000);
    return;
  }
});
$('#settingsPage').addEventListener('change', async e => {
  const br = e.target.dataset.accbranch, ow = e.target.dataset.accowner;
  if (br) { await api(`/api/accounts/${br}`, { branch_id: Number(e.target.value) || null }).catch(fail); toast('Saqlandi'); }
  if (ow) { await api(`/api/accounts/${ow}`, { owner_user_id: Number(e.target.value) || null }).catch(fail); toast('Saqlandi'); }
});
$('#settingsPage').addEventListener('submit', async e => {
  if (e.target.id !== 'setForm') return;
  e.preventDefault();
  const d = Object.fromEntries(new FormData(e.target).entries());
  d.night_autoreply = d.night_autoreply === 'true';
  const r = await api('/api/settings', d).catch(fail);
  if (!r) return;
  toast(r.changed?.length ? `Saqlandi: ${r.changed.length} ta o‘zgarish` : 'O‘zgarish yo‘q'); renderSettings();
});

/* =====================================================================
   XODIMLAR VA FILIALLAR
   ===================================================================== */
async function renderUsers() {
  await loadBoot();
  const r = await api('/api/users'), b = S.boot;
  S.usersBot = r.bot;
  $('#usersPage').innerHTML = `
    <div class="panel"><div class="panel-head"><h2>Filiallar</h2><button class="btn sm" type="button" data-bnew>Filial qo‘shish</button></div>
      <div class="chips">${b.branches.map(x => `<button class="chip" type="button" data-bedit="${x.id}">${esc(x.name)}${x.kind === 'ombor' ? ' · ombor' : ''}</button>`).join('') || '<span class="muted">Filial yo‘q</span>'}</div></div>
    ${(() => { const act = r.items.filter(u => u.active), canIn = act.filter(u => u.has_pass).length, tg = act.filter(u => u.tg_linked).length; return `
    <div class="staff-sum"><div><b>${act.length}</b><span>xodim</span></div><div class="${canIn < act.length ? 'warn' : ''}"><b>${canIn}</b><span>panelga kira oladi</span></div>
      <div class="${tg < act.length ? 'warn' : ''}"><b>${tg}</b><span>Telegram’ga ulangan — bildirishnoma oladi</span></div>
      <p class="muted">Xodim ishlashi uchun 2 qadam: <b>1)</b> «Parol berish» — login va parolni unga yuboring; <b>2)</b> «Tahrirlash»da Telegram username kiriting va xodimga ${r.bot ? `<a href="https://t.me/${esc(r.bot)}" target="_blank" rel="noopener">t.me/${esc(r.bot)}</a>` : 'botni'} yuboring — «Start» bossa o‘zi ulanadi va AI topshiriqlarni (rasm, to‘lov, buyurtma) navbat bilan unga beradi.</p></div>`; })()}
    <div class="panel"><div class="panel-head"><h2>Xodimlar</h2><button class="btn sm primary" type="button" data-uinvite>Xodim qo‘shish</button></div>
      <div class="tbl"><table><thead><tr><th>Ism</th><th>Login (telefon)</th><th>Rol</th><th>Filial</th><th>Smena</th><th>Kirish</th><th>Telegram</th><th></th></tr></thead><tbody>
      ${r.items.map(u => `<tr${u.active ? '' : ' style="opacity:.5"'}><td>${esc(u.name)}</td><td class="mono">${esc(u.login)}</td><td>${ROLE[u.role]}</td>
        <td>${esc(b.branches.find(x => x.id === u.branch_id)?.name || '—')}</td><td class="muted" style="font-size:12.5px">${esc(shiftText(u))}</td>
        <td class="row-actions">${u.has_pass ? '<span class="pill ok">kira oladi</span>' : '<span class="pill warn">parol yo‘q</span>'}
          <button class="btn sm ${u.has_pass ? 'ghost' : 'primary'}" type="button" data-ulink="${u.id}">${u.has_pass ? 'Parolni o‘zgartirish' : 'Kirish havolasi'}</button></td>
        <td>${u.tg_linked ? `<span class="pill ok">ulangan</span>${u.tg_username ? `<div class="muted" style="font-size:12px">@${esc(u.tg_username)}</div>` : ''}`
          : u.tg_username || u.tg_user_id ? `<span class="pill warn" title="Xodim botda «Start» bosishi kerak">Start kutilmoqda</span><div class="muted" style="font-size:12px">${u.tg_username ? '@' + esc(u.tg_username) : 'ID ' + esc(u.tg_user_id)}</div>`
          : `<button class="btn sm" type="button" data-tglink="${u.id}">Telegram havola</button>`}</td>
        <td class="row-actions"><button class="btn sm ghost" type="button" data-uedit="${u.id}">Tahrirlash</button><button class="btn sm ghost" type="button" data-udel="${u.id}" title="Ro‘yxatdan o‘chiradi — tarix qoladi">O‘chirish</button></td></tr>`).join('')}
      </tbody></table></div></div>`;
  $('#usersPage').dataset.users = JSON.stringify(r.items);
  // Kutayotgan takliflar: havola berilgan, lekin xodim hali parol qo‘ymagan
  const inv = await api('/api/invites').catch(() => ({ items: [] }));
  if (inv.items?.length) $('#usersPage').insertAdjacentHTML('beforeend', `
    <div class="panel"><div class="panel-head"><h2>Kutayotgan takliflar</h2><span class="muted">Havola berilgan — xodim hali parol qo‘ymagan</span></div>
      <div class="tbl"><table><thead><tr><th>Ism</th><th>Login</th><th>Lavozim</th><th>Filial</th><th>Muddati</th><th></th></tr></thead><tbody>
      ${inv.items.map(i => `<tr><td>${esc(i.name)}${i.kind === 'reset' ? ' <span class="pill warn">parol almashtirish</span>' : ''}</td><td class="mono">${esc(i.login)}</td><td>${ROLE[i.role]}</td><td>${esc(i.branch_name || '—')}</td>
        <td class="muted">${fmtDT(i.expires_at)} gacha</td>
        <td class="row-actions"><button class="btn sm" type="button" data-invcopy="${esc(inv.base)}/taklif?k=${esc(i.token)}">Havolani nusxalash</button>
          <button class="btn sm ghost" type="button" data-invdel="${i.id}">Bekor qilish</button></td></tr>`).join('')}
      </tbody></table></div></div>`);
  // BILLZ’dagi xodimlar — panelda hali yo‘qlari; «Qo‘shish» ism, filial va loginni to‘ldiradi (tahlil ism bo‘yicha bog‘lanadi)
  const bz = await api('/api/users/billz').catch(() => ({ items: [] }));
  if (bz.items?.length) $('#usersPage').insertAdjacentHTML('beforeend', `
    <div class="panel"><div class="panel-head"><h2>BILLZ’dagi xodimlar</h2><span class="muted">Panelda hali yo‘q. Ism BILLZ’dagidek qoladi — «Reja va tahlil»dagi sotuvlari o‘zi bog‘lanadi</span></div>
      <div class="tbl"><table><thead><tr><th>Ism</th><th>BILLZ roli</th><th>Asosiy filial</th><th class="n">Chek, 90 kun</th><th></th></tr></thead><tbody>
      ${bz.items.map(x => `<tr><td>${esc(x.name)}</td><td class="muted">${esc(x.roles.join(', ') || '—')}</td><td>${esc(x.branch || '—')}</td><td class="n mono">${x.checks_90d}</td>
        <td><button class="btn sm" type="button" data-uinvite data-prefill="${esc(JSON.stringify({ name: x.name, login: x.login, branch_id: x.branch_id, role: 'sotuvchi' }))}">Panelga qo‘shish</button></td></tr>`).join('')}
      </tbody></table></div></div>`);
}
$('#usersPage').addEventListener('click', async e => {
  const b = S.boot, users = JSON.parse($('#usersPage').dataset.users || '[]');
  const ud = e.target.closest('[data-udel]');
  if (ud) {
    const x = users.find(y => y.id === Number(ud.dataset.udel));
    if (!confirm(`${x?.name || 'Xodim'} ro‘yxatdan o‘chirilsinmi?\n\nPanelga kira olmaydi, Telegram ulanishi uziladi va yangi topshiriq olmaydi.\nEski yozishmalari, topshiriqlari va hisobotlari joyida qoladi.`)) return;
    if (!await api(`/api/users/${ud.dataset.udel}/delete`, {}).catch(fail)) return;
    toast('Xodim o‘chirildi — tarix saqlandi');
    await renderUsers();
    return;
  }
  const iv = e.target.closest('[data-uinvite]');
  if (iv) {
    const canAdmin = b.me.role === 'admin';
    // BILLZ ro‘yxatidan kelgan bo‘lsa — ism, login va filial oldindan to‘ldiriladi
    const pf = iv.dataset.prefill ? JSON.parse(iv.dataset.prefill) : {};
    modal(`<h2>Havola bilan xodim qo‘shish</h2>
      <p class="lead" style="font-size:13px">Xodimga havola yuboriladi. U havolani ochib, <b>o‘zi parol qo‘yadi</b> va o‘ziga berilgan lavozimda darhol kiradi — parol sizdan ham, yozishmadan ham o‘tmaydi. Panelga <b>telefon raqami bilan</b> kiradi.</p>
      <div class="grid-2">
        <label class="field"><span>Ism familiya</span><input name="name" required maxlength="80" value="${esc(pf.name || '')}"></label>
        <label class="field"><span>Lavozim</span><select name="role">
          <option value="sotuvchi">Sotuvchi</option><option value="filial">Filial rahbari</option>
          ${canAdmin ? '<option value="rahbar">Rahbar</option><option value="admin">Administrator</option>' : ''}</select></label>
        <label class="field"><span>Filial</span><select name="branch_id"><option value="">—</option>
          ${b.branches.map(x => `<option value="${x.id}" ${pf.branch_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label class="field"><span>Telefon raqami — shu login bo‘ladi</span><input name="phone" type="tel" inputmode="tel" required placeholder="+998 90 123 45 67" title="Xodim shu raqam bilan panelga kiradi"></label>
        <label class="field"><span>Havola amal qiladi</span><select name="days"><option value="3">3 kun</option><option value="7" selected>7 kun</option><option value="30">30 kun</option></select></label>
      </div>`, async data => {
      const r = await api('/api/invites', data);
      await renderUsers();
      modal(`<h2>Havola tayyor</h2>
        <p class="lead" style="font-size:13px"><b>${esc(data.name)}</b> ga shu havolani yuboring. Havola bir marta ishlaydi.</p>
        <div class="pw-box" style="word-break:break-all;font-size:13px">${esc(r.link)}</div>`, null, () => {
        const box = $('#mForm .pw-box');
        box.insertAdjacentHTML('afterend', '<div class="row-actions"><button class="btn primary" type="button" id="invCopy2">Havolani nusxalash</button></div>');
        $('#invCopy2').addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(r.link); toast('Havola nusxalandi'); }
          catch { toast('Havolani qo‘lda nusxalang'); }
        });
      });
    });
    return;
  }
  const ic = e.target.closest('[data-invcopy]');
  if (ic) {
    const link = ic.dataset.invcopy;
    try { await navigator.clipboard.writeText(link); toast('Havola nusxalandi'); }
    catch { modal(`<h2>Havola</h2><div class="pw-box" style="word-break:break-all;font-size:13px">${esc(link)}</div>`, null); }
    return;
  }
  const idl = e.target.closest('[data-invdel]');
  if (idl) {
    if (!confirm('Havola bekor qilinsinmi? Shundan keyin u ishlamaydi.')) return;
    if (!await api(`/api/invites/${idl.dataset.invdel}/revoke`, {}).catch(fail)) return;
    toast('Havola bekor qilindi');
    return renderUsers();
  }
  const ul = e.target.closest('[data-ulink]');
  if (ul) {
    const x = users.find(y => y.id === Number(ul.dataset.ulink));
    if (!confirm(`${x?.name || 'Xodim'} uchun parol havolasi yaratilsinmi?\n\nHavolani ochib, yangi parolni u o‘zi qo‘yadi. Eski paroli va boshqa qurilmalardagi kirishlari bekor bo‘ladi.`)) return;
    const r = await api(`/api/users/${ul.dataset.ulink}/reset-link`, {}).catch(fail); if (!r) return;
    await renderUsers();
    modal(`<h2>Havola tayyor</h2>
      <p class="lead" style="font-size:13px"><b>${esc(r.name)}</b> ga shu havolani yuboring — u yangi parolni o‘zi qo‘yadi. Havola 3 kun amal qiladi va bir marta ishlaydi.</p>
      <div class="pw-box" style="word-break:break-all;font-size:13px">${esc(r.link)}</div>`, null, () => {
      $('#mForm .pw-box').insertAdjacentHTML('afterend', '<div class="row-actions"><button class="btn primary" type="button" id="plCopy">Havolani nusxalash</button></div>');
      $('#plCopy').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(r.link); toast('Havola nusxalandi'); }
        catch { toast('Havolani qo‘lda nusxalang'); }
      });
    });
    return;
  }
  const up = e.target.closest('[data-upass]');
  if (up) {
    const x = users.find(y => y.id === Number(up.dataset.upass));
    if (!confirm(`${x?.name || 'Xodim'}ga yangi parol yaratilsinmi?`)) return;
    const r = await api(`/api/users/${up.dataset.upass}/password`, {}).catch(fail); if (!r) return;
    const msg = `Photobuy sotuv paneli\nSayt: ${location.origin}\nLogin: ${r.login}\nParol: ${r.password}\nKirgach parolni almashtiring.`;
    modal(`<h2>Parol tayyor: ${esc(r.name)}</h2><p class="lead" style="font-size:13.5px">Shu matnni xodimga yuboring. Parol faqat hozir ko‘rinadi — oynani yopsangiz, qayta ko‘rsatilmaydi.</p>
      <textarea class="pw-box" id="pwMsg" readonly style="width:100%;min-height:110px;font-family:var(--f-mono)">${esc(msg)}</textarea>
      <div class="row-actions"><button class="btn sm primary" type="button" id="pwCopy">Nusxalash</button></div>`, null, () => {
        $('#pwCopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(msg); toast('Nusxalandi'); } catch { $('#pwMsg').select(); toast('Belgilandi — Ctrl+C bosing'); } });
      });
    return renderUsers();
  }
  const tl = e.target.closest('[data-tglink]');
  if (tl) {
    const r = await api(`/api/users/${tl.dataset.tglink}/tglink`, {}).catch(fail); if (!r) return;
    modal(`<h2>Telegram bildirishnomalari</h2>${r.link ? `<p class="lead" style="font-size:13.5px">Xodim shu havolani Telegram’da ochib «Start» bosadi (1 soat amal qiladi):</p><div class="pw-box" style="font-size:13px">${esc(r.link)}</div>`
      : '<div class="banner warn">Bot hali ulanmagan (token kiritilmagan). Token kiritilgach havola shu yerda chiqadi.</div>'}`, null);
    return;
  }
  const bn = e.target.closest('[data-bnew]'), be = e.target.closest('[data-bedit]');
  if (bn || be) {
    const x = be ? b.branches.find(y => y.id === Number(be.dataset.bedit)) : {};
    return modal(`<h2>${be ? 'Filial' : 'Yangi filial'}</h2><div class="form-grid"><label class="field"><span>Nomi</span><input name="name" id="b_name" value="${esc(x.name || '')}" required></label>
      <label class="field wide"><span>Ish kunlari</span>${dowBoxes(x.work_dow, 'wd')}</label>
      <label class="field"><span>Ochilish</span><input type="time" name="open_from" id="b_of" value="${esc(x.open_from || '')}"></label>
      <label class="field"><span>Yopilish</span><input type="time" name="open_to" id="b_ot" value="${esc(x.open_to || '')}"></label>
      <label class="field"><span>Turi</span><select name="kind" id="b_kind"><option value="dokon" ${x.kind !== 'ombor' ? 'selected' : ''}>do‘kon (mijoz shu yerda oladi)</option><option value="ombor" ${x.kind === 'ombor' ? 'selected' : ''}>ombor</option></select></label>
      <label class="field wide"><span>Izoh</span><input name="note" id="b_note" value="${esc(x.note || '')}"></label></div>`,
    async d => { await api('/api/branches', { ...d, id: x.id, work_dow: dowFrom(d, 'wd') }); toast('Saqlandi'); renderUsers(); });
  }
  const un = e.target.closest('[data-unew]'), ue = e.target.closest('[data-uedit]');
  if (un || ue) {
    const u = ue ? users.find(y => y.id === Number(ue.dataset.uedit)) : { role: 'sotuvchi', active: 1, ...(un.dataset.prefill ? JSON.parse(un.dataset.prefill) : {}) };
    return modal(`<h2>${ue ? 'Xodim' : 'Yangi xodim'}</h2><div class="form-grid">
      <label class="field"><span>Ism</span><input name="name" id="u_name" value="${esc(u.name || '')}" required></label>
      <label class="field"><span>Login (lotin)</span><input name="login" id="u_login" value="${esc(u.login || '')}" ${ue ? 'readonly' : ''} required></label>
      <label class="field"><span>Rol</span><select name="role" id="u_role">${Object.entries(ROLE).filter(([k]) => k !== 'admin' || S.boot.me.role === 'admin').map(([k, l]) => `<option value="${k}" ${u.role === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="field"><span>Filial</span><select name="branch_id" id="u_branch"><option value="">—</option>${b.branches.map(x => `<option value="${x.id}" ${u.branch_id === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
      <label class="field"><span>Telefon</span><input name="phone" id="u_phone" value="${esc(u.phone || '')}"></label>
      <label class="field"><span>Telegram username</span><input name="tg_username" id="u_tgname" value="${esc(u.tg_username ? '@' + u.tg_username : '')}" placeholder="@hilola_photobuy" autocapitalize="off" spellcheck="false"></label>
      <label class="field"><span>Telegram ID (ixtiyoriy)</span><input name="tg_user_id" id="u_tgid" value="${esc(u.tg_user_id || '')}" inputmode="numeric" placeholder="123456789"></label>
      <p class="muted" style="font-size:12.5px;margin:0;grid-column:1/-1">Tizim xodimni shu username/ID bo‘yicha taniydi: u Photobuy akkauntiga yozsa — mijoz emas, sotuvchi deb biladi (AI unga mijozdek javob bermaydi). Har kuni ish boshida Photobuy akkauntiga «Salom» deb yozsa, topshiriqlar rahbar nomidan shu akkauntdan keladi; zaxira yo‘l — <b>@${esc(S.usersBot || 'bot')}</b> da bir marta «Start».</p>
      <label class="field wide"><span>Ish kunlari (smena)</span>${dowBoxes(u.shift_dow, 'dow')}</label>
      <label class="field"><span>Smena boshi</span><input type="time" name="shift_from" id="u_sf" value="${esc(u.shift_from || '')}"></label>
      <label class="field"><span>Smena oxiri</span><input type="time" name="shift_to" id="u_st" value="${esc(u.shift_to || '')}"></label>
      <label class="field"><span>Zaxira mas’ul (katta buyurtma)</span><select name="backup_user_id" id="u_backup"><option value="">rahbar</option>${users.filter(y => y.id !== u.id && y.active).map(y => `<option value="${y.id}" ${u.backup_user_id === y.id ? 'selected' : ''}>${esc(y.name)}</option>`).join('')}</select></label>
      ${ue ? `<label class="field"><span>Holat</span><select name="active" id="u_active"><option value="1" ${u.active ? 'selected' : ''}>faol</option><option value="0" ${!u.active ? 'selected' : ''}>o‘chirilgan</option></select></label>
        <label class="field"><span>Parol</span><select name="reset_password" id="u_reset"><option value="">o‘zgarmasin</option><option value="1">yangi parol yaratish</option></select></label>` : ''}
      </div>`,
    async d => {
      const r = await api('/api/users', { ...d, id: u.id, branch_id: Number(d.branch_id) || null, backup_user_id: Number(d.backup_user_id) || null, active: d.active !== '0', reset_password: Boolean(d.reset_password), shift_dow: dowFrom(d, 'dow') });
      if (!r.ok) throw Object.assign(new Error(r.error || 'xato'), { data: r });
      renderUsers();
      if (r.password) { modal(`<h2>Bir martalik parol</h2><p class="lead" style="font-size:13.5px">Xodimga bering — boshqa ko‘rsatilmaydi. Kirgach o‘zi o‘zgartiradi.</p><div class="pw-box">${esc(r.password)}</div>`, null); return true; }
    });
  }
});

/* =====================================================================
   AUDIT
   ===================================================================== */
let auditKind = 'all';
async function renderAudit() {
  const r = await api(`/api/audit?kind=${auditKind}`);
  const cls = { ai: 'pill ai', staff: 'pill acc', sys: 'pill' };
  $('#auditPage').innerHTML = `
    <p class="lead">Har bir avtomatik amal: vaqt, bajaruvchi, amal, ishlatilgan ma’lumot va natija. Qayta ishga tushirish takror xabar yaratmaydi — bu ham shu yerda ko‘rinadi.</p>
    <div class="row-actions"><div class="chips">${[['all', 'Hammasi'], ['ai', 'AI agentlar'], ['staff', 'Xodimlar'], ['sys', 'Tizim va integratsiya']].map(([k, l]) => `<button class="chip" type="button" data-j="${k}" aria-pressed="${auditKind === k}">${l}</button>`).join('')}</div>
      <span style="margin-left:auto" class="row-actions"><a class="btn sm ghost" href="/api/export/audit.csv">Jurnal CSV</a><a class="btn sm ghost" href="/api/export/suhbatlar.csv">Suhbatlar CSV</a></span></div>
    <div class="panel" style="padding:6px 8px"><div class="tbl"><table><thead><tr><th>Vaqt</th><th>Bajaruvchi</th><th>Amal</th><th>Ma’lumot</th><th>Natija</th></tr></thead><tbody>
    ${r.items.map(a => `<tr><td class="mono">${fmtDT(a.at)}</td><td><span class="${cls[a.kind]}">${esc(a.actor)}</span></td><td>${esc(a.action)}${a.object?.startsWith('conv:') ? ` <a class="linkish" href="#suhbat/${a.object.slice(5)}">suhbat</a>` : ''}</td><td class="muted">${esc(a.data_used || '')}</td><td>${esc(a.result || '')}</td></tr>`).join('')}
    </tbody></table></div></div>`;
}
$('#auditPage').addEventListener('click', e => { const b = e.target.closest('[data-j]'); if (b) { auditKind = b.dataset.j; renderAudit(); } });

/* =====================================================================
   QAYTA SOTUV (Chaqnoq)
   ===================================================================== */
let RULE_SUG = [], RULE_START = [];
let resaleTab = 'list';
const RESULTS = ['Bog‘lanildi', 'Taklif berildi', 'Xarid', 'Rad etdi', 'Keyinroq'];
let RESALE_ITEMS = new Map();
/* Sotuvchi uchun tayyor taklif matni (nusxalab Telegram yoki SMS’da yuboradi) — faqat BILLZ ma’lumotidan, narx eskirgan bo‘lsa yozilmaydi */
function offerText(t) {
  const m = t.meta || {}, p = m.purchase || {}, s = m.suggest || {};
  const price = s.price != null && !s.stale ? `, narxi ${money(s.price)}` : '';
  const cb = m.cashback?.amount > 0 ? `\nKeshbekingizda ${cash(m.cashback.amount)} bor — shu xaridda ishlatsangiz bo‘ladi.` : '';
  return `Assalomu alaykum! Photobuy’dan yozyapmiz.${p.item ? ` Bizdan ${p.item} olgan edingiz — rahmat!` : ''}\n`
    + `${m.reason ? m.reason.replace(/[.\s]+$/, '') + '. ' : ''}Hozir do‘konimizda ${s.name || 'yangi tovar'} bor${price}.${cb}\nQiziqsangiz, javob yozing — batafsil aytib beramiz.`;
}
async function renderResale() {
  const tabs = `<div class="tabs" role="tablist">${[['list', 'Bugungi ro‘yxat'], ['camp', 'Kampaniyalar'], ['rules', 'Qoidalar']].map(([k, l]) => `<button type="button" role="tab" aria-selected="${resaleTab === k}" data-rtab="${k}">${l}</button>`).join('')}</div>`;
  let body = '';
  if (resaleTab === 'list') {
    const r = await api('/api/resale');
    RESALE_ITEMS = new Map(r.items.map(t => [t.id, t]));
    const open = r.items.filter(t => t.status === 'open'), done = r.items.filter(t => t.status !== 'open');
    body = `
      <div class="strip"><div class="s"><span class="n">${open.length}</span><span class="l">ochiq vazifa</span></div>
        <div class="s"><span class="n">${done.length}</span><span class="l">natija qayd etildi (24 soat)</span></div>
        ${r.overdue ? `<div class="s warn"><span class="n">${r.overdue}</span><span class="l">muddati o‘tgan — rahbarga ko‘rinadi</span></div>` : ''}
        ${isLead() ? '<span class="row-actions" style="margin-left:auto"><a class="btn ghost" href="/api/export/qayta-sotuv.csv">CSV</a><button class="btn" type="button" id="runResale">Ro‘yxatni hozir tuzish</button></span>' : ''}</div>
      <p class="lead">Qayta sotuv agenti har kuni ${esc(S.boot.settings.resale_time)} da BILLZ xaridlaridan ro‘yxat tuzadi. Qaytargan, allaqachon olgan, voz kechgan va oxirgi ${S.boot.settings.resale_quiet_days} kunda bog‘lanilgan mijozlar chiqariladi. Bot va sotuvchi vazifasi bitta aloqa jadvalidan boshqariladi.</p>
      ${!open.length && r.rules === 0 ? `<div class="plan-cta"><div><b>Ro‘yxat bo‘sh, chunki birorta qayta sotuv qoidasi yoqilmagan.</b> Qoida — «kamera olganga obyektiv taklif qilinsin» kabi. Qoidalar bo‘limida 11 ta tayyor qoida bor: «Hammasini qo‘shish» bosilsa, ertadan har kuni sotuvchilarga kimga nima taklif qilish ro‘yxati chiqadi.</div>
        ${isLead() ? '<div class="row-actions"><button class="btn sm primary" type="button" data-rtab="rules">Qoidalarni ko‘rish</button></div>' : ''}</div>` : ''}
      <div class="tasks">${open.map(t => {
        const m = t.meta || {};
        return `<article class="task ${t.due_at < clockNow() ? 'overdue' : ''}">
          <header class="task-head"><b>${esc(t.customer_name || 'Mijoz')}</b>${t.bot_chat_id ? '<span class="pill ok">botga ulangan</span>' : '<span class="pill">faqat telefon</span>'}
            <span class="pill ${t.kind === 'campaign_reply' ? 'ai' : t.kind === 'campaign' ? 'acc' : ''}">${t.kind === 'resale' ? 'Qayta sotuv' : t.kind === 'campaign' ? 'Kampaniya' : 'Kampaniyaga javob'}</span>
            <span class="task-meta">${esc(t.user_name || 'biriktirilmagan')} · muddat ${fmtDT(t.due_at)}${t.phone ? ' · ' + esc(t.phone) : ''}</span></header>
          ${m.purchase ? `<div class="task-grid">
            <div><span class="lbl">So‘nggi xarid</span><span>${esc(m.purchase.item)}</span><span class="src-note">${m.purchase.date}${m.purchase.branch ? ' · ' + esc(m.purchase.branch) : ''} · <span class="mono">${money(m.purchase.amount)}</span></span></div>
            <div><span class="lbl">Keshbek</span>${m.cashback ? `<span class="mono">${cash(m.cashback.amount)}</span><span class="src-note">BILLZ · ${fmtDT(m.cashback.synced_at)}</span>` : '<span class="muted">Ma’lumot yetarli emas</span>'}</div>
            <div><span class="lbl">Taklif sababi</span><span>${esc(m.reason)}</span></div>
            <div><span class="lbl">Tavsiya</span><span>${esc(m.suggest?.name || '')}</span><span class="src-note mono">${m.suggest?.price != null && !m.suggest.stale ? money(m.suggest.price) : 'narx aniqlanadi'} · qoldiq ${m.suggest?.stock ?? '—'}</span></div>
          </div>` : `<div style="font-size:13px">${esc(t.body || '')}</div>`}
          <div class="task-go">
            ${t.phone ? `<a class="btn sm primary" href="${telHref(t.phone)}">${svg('phone')}Qo‘ng‘iroq</a>` : ''}
            ${t.conv_id ? `<a class="btn sm" href="#suhbat/${t.conv_id}">${svg('chat')}Suhbatni ochish</a>` : ''}
            ${m.purchase ? `<button class="btn sm" type="button" data-offer="${t.id}">Taklif matnini nusxalash</button>` : ''}
          </div>
          ${m.purchase ? `<details class="offer"><summary>Tayyor taklif matni</summary><p>${esc(offerText(t))}</p></details>` : ''}
          <footer class="task-actions">${RESULTS.map(x => `<button class="btn sm" type="button" data-tdone="${t.id}" data-r="${x}">${x}</button>`).join('')}</footer>
        </article>`; }).join('') || '<div class="note">Bugun ochiq vazifa yo‘q.</div>'}</div>`;
  } else if (resaleTab === 'camp') {
    const r = await api('/api/campaigns');
    const arr = isLead() ? await api('/api/arrivals').catch(() => ({ items: [] })) : { items: [] };
    body = `${arr.items.length ? `<div class="panel"><div class="panel-head"><h2>Yangi kirim · 14 kun</h2><span class="muted">BILLZ katalogida yangi paydo bo‘lgan va qoldig‘i bor tovarlar. Kampaniya avtomatik ochilmaydi</span></div>
      <div class="tbl"><table><thead><tr><th>Tovar</th><th>Kelgan</th><th class="n">Do‘kon / ombor</th><th class="n">Narx</th><th>Karta</th><th></th></tr></thead><tbody>
      ${arr.items.slice(0, 25).map(p => `<tr><td>${esc(p.name)}<br><span class="muted" style="font-size:12px">${esc(p.category || '')}</span></td>
        <td class="mono">${fmtDT(p.first_seen_at).slice(0, 5)}</td><td class="n mono">${p.stock_store} / ${p.stock_warehouse}</td><td class="n mono">${p.price != null ? money(p.price) : '—'}</td>
        <td>${p.verified ? '<span class="pill ok">tasdiqlangan</span>' : `<button class="btn sm ghost" type="button" data-fillcard="${esc(p.name)}">Kartani to‘ldirish</button>`}</td>
        <td style="white-space:nowrap">${p.campaign ? `<span class="pill">kampaniya: ${{ draft: 'qoralama', running: 'ishlamoqda', paused: 'to‘xtatilgan', done: 'yakunlangan' }[p.campaign.status]}</span>` : `<button class="btn sm primary" type="button" data-newcamp="${p.id}">Kampaniya ochish</button>`}</td></tr>`).join('')}
      </tbody></table></div></div>` : ''}
      <p class="lead">Yangi tovar kelganda mos mijozlarga xabar. Avtomatik xabar faqat Photobuy botiga ulangan va rozilik bergan mijozga ketadi; qolganlarga sotuvchi vazifasi. Kampaniya + mijoz kaliti qayta ishga tushirishda takror xabarni to‘xtatadi. «O‘qildi» ko‘rsatilmaydi — platforma bermaydi.</p>
      ${isLead() ? '<div class="row-actions"><button class="btn primary" type="button" id="newCamp">Yangi kampaniya</button></div>' : ''}
      <div class="tbl"><table><thead><tr><th>Kampaniya</th><th>Holat</th><th class="n">Yuborildi</th><th class="n">Xato</th><th class="n">Vazifa</th><th class="n">Javob</th><th class="n">Xarid</th><th></th></tr></thead><tbody>
      ${r.items.map(c => `<tr><td><b>${esc(c.title)}</b>${c.is_demo ? ' <span class="demo-tag">demo</span>' : ''}<br><span class="muted">${esc(c.product_name)} · kuniga ${c.daily_limit}</span></td>
        <td><span class="pill ${c.status === 'running' ? 'ok' : c.status === 'paused' ? 'warn' : ''}">${{ draft: 'qoralama', running: 'ishlamoqda', paused: 'to‘xtatilgan', done: 'yakunlangan' }[c.status]}</span></td>
        <td class="n">${c.stats.sent}</td><td class="n">${c.stats.failed}</td><td class="n">${c.stats.task}</td><td class="n">${c.stats.replied}</td><td class="n">${c.stats.purchased}</td>
        <td><button class="btn sm" type="button" data-seg="${c.id}">Kimga boradi</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">Kampaniya yo‘q</td></tr>'}
      </tbody></table></div>`;
  } else {
    const canEdit = S.boot.me.role !== 'sotuvchi';
    const [r, sg] = await Promise.all([api('/api/rules'), canEdit ? api('/api/rules/suggest').catch(() => null) : null]);
    RULE_SUG = sg?.items || []; RULE_START = sg?.starter || [];
    const catTxt = c => esc(String(c).replaceAll('|', ' / '));
    const ev = x => `${x.support} / ${x.buyers} mijoz (${String(x.share).replace('.', ',')}%) · tasodifiydan ×${String(x.lift).replace('.', ',')} · odatda ${x.median_days} kundan keyin`;
    body = `<p class="lead">Qoida: «X ni olgan mijozga Y mos, chunki …». Sabab mijozga ham, sotuvchiga ham tushunarli bo‘lishi kerak. Tur bo‘yicha qoidada taklif har kuni shu turdagi do‘konda bor va eng ko‘p sotilgan modeldan tanlanadi.</p>
      ${canEdit ? '<div class="row-actions"><button class="btn primary" type="button" id="newRule">Qoida qo‘shish</button></div>' : ''}
      ${canEdit && sg ? `<div class="note">Xaridlar tarixi (BILLZ, 12 oy): ${sg.total_customers} mijozdan tur-juftliklar tekshirildi; tasodifiy moslikni ajratish uchun statistik filtr (ko‘p taqqoslash tuzatmasi bilan). Mijozlarning ko‘pchiligi bir martalik xaridor — shuning uchun ishonchli tavsiya kam. Pastdagi boshlang‘ich qoidalar foto do‘kon tajribasiga asoslangan; qaysi biri ishlashini vazifa natijalari ko‘rsatadi.</div>` : ''}
      ${RULE_START.length ? `<div class="panel"><div class="panel-head"><h2>Boshlang‘ich qoidalar</h2><span class="muted">Foto-video do‘kon tajribasi, Photobuy turlariga moslangan. Tasdiqlaganingiz ertangi ro‘yxatdan ishlaydi</span>
        ${canEdit ? `<button class="btn sm primary" type="button" id="startAll" style="margin-left:auto">Hammasini qo‘shish (${RULE_START.filter(x => x.suggest).length})</button>` : ''}</div>
        <div class="tbl"><table><thead><tr><th>Olgan (tur)</th><th>Taklif (tur)</th><th>Sabab</th><th>Tarixda</th><th>Bugun taklif</th><th></th></tr></thead><tbody>
        ${RULE_START.map((x, i) => `<tr><td>${catTxt(x.bought_category)}</td><td>${catTxt(x.suggest_category)}</td><td style="font-size:13px">${esc(x.reason)}</td>
          <td class="muted" style="font-size:12.5px;white-space:nowrap">${x.support} / ${x.buyers} mijoz</td>
          <td>${x.suggest ? esc(x.suggest.name) : '<span class="pill warn">qoldiq yo‘q</span>'}</td>
          <td style="white-space:nowrap"><button class="btn sm primary" type="button" data-stadd="${i}">Qo‘shish</button> <button class="btn sm ghost" type="button" data-strej="${i}">Kerak emas</button></td></tr>`).join('')}
        </tbody></table></div></div>` : ''}
      ${RULE_SUG.length ? `<div class="panel"><div class="panel-head"><h2>Xaridlar tarixidan tavsiyalar</h2><span class="muted">Statistik filtrdan o‘tganlar · A turini olgandan keyin 1–180 kunda B turini olganlar. Hech biri avtomatik yoqilmaydi</span></div>
        <div class="tbl"><table><thead><tr><th>Olgan (tur)</th><th>Keyin oladi (tur)</th><th>Dalil</th><th>Bugun taklif</th><th></th></tr></thead><tbody>
        ${RULE_SUG.map((x, i) => `<tr><td>${esc(x.bought_category)}</td><td>${esc(x.suggest_category)}</td><td class="muted" style="font-size:12.5px">${ev(x)}</td>
          <td>${x.suggest ? esc(x.suggest.name) : '<span class="pill warn">qoldiq yo‘q</span>'}</td>
          <td style="white-space:nowrap"><button class="btn sm primary" type="button" data-sadd="${i}">Qo‘shish</button> <button class="btn sm ghost" type="button" data-srej="${i}">Rad etish</button></td></tr>`).join('')}
        </tbody></table></div></div>` : ''}
      <div class="tbl"><table><thead><tr><th>Olgan</th><th>Taklif</th><th>Sabab</th><th class="n">Kun oralig‘i</th><th>Holat</th></tr></thead><tbody>
      ${r.items.map(x => `<tr><td>${x.bought_category ? `<span class="pill">tur</span> ${esc(x.bought_category)}` : esc(x.bought_name || x.bought_match)}</td>
        <td>${x.suggest_category ? `<span class="pill">tur</span> ${esc(x.suggest_category)}<br><span class="muted" style="font-size:12px">bugun: ${esc(x.today || 'qoldiq yo‘q')}</span>` : esc(x.suggest_name)}</td>
        <td>${esc(x.reason)}${x.evidence ? `<br><span class="muted" style="font-size:12px">${x.evidence.source === 'tajriba' ? `tajriba asosida · tarixda ${x.evidence.support} / ${x.evidence.buyers} mijoz` : ev(x.evidence)}</span>` : ''}</td><td class="n">${x.min_days}–${x.max_days}</td><td>${x.active ? '<span class="pill ok">faol</span>' : '<span class="pill">o‘chiq</span>'}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Qoida yo‘q</td></tr>'}
      </tbody></table></div>`;
  }
  $('#resalePage').innerHTML = tabs + body;
}
$('#resalePage').addEventListener('click', async e => {
  const t = e.target.closest('[data-rtab]'); if (t) { resaleTab = t.dataset.rtab; return renderResale(); }
  const of = e.target.closest('[data-offer]');
  if (of) {
    const t = RESALE_ITEMS.get(Number(of.dataset.offer)); if (!t) return;
    try { await navigator.clipboard.writeText(offerText(t)); toast('Taklif matni nusxalandi — Telegram yoki SMS’ga qo‘ying'); }
    catch { of.closest('.task')?.querySelector('.offer')?.setAttribute('open', ''); toast('Nusxalab bo‘lmadi — matnni pastdan belgilab oling'); }
    return;
  }
  const d = e.target.closest('[data-tdone]');
  if (d) { await api(`/api/tasks/${d.dataset.tdone}/done`, { result: d.dataset.r }).catch(fail); toast(`Qayd etildi: ${d.dataset.r}`); return renderResale(); }
  if (e.target.id === 'runResale') { const r = await api('/api/resale/run', {}).catch(fail); if (r) toast(`Ro‘yxat: ${r.created} ta yangi vazifa${r.deferred ? `, yana ${r.deferred} tasi keyingi kunlarga (kunlik cheklov)` : ''}`); return renderResale(); }
  if (e.target.id === 'startAll') {
    const list = RULE_START.filter(x => x.suggest);
    if (!confirm(`${list.length} ta qoida qo‘shilsinmi? Ertadan har kuni sotuvchilarga qayta sotuv vazifalari chiqadi (mijozga avtomatik xabar ketmaydi — sotuvchi o‘zi bog‘lanadi).`)) return;
    e.target.disabled = true;
    let n = 0;
    for (const x of list) {
      const r = await api('/api/rules', { reason: x.reason, min_days: x.min_days, max_days: x.max_days, bought_category: x.bought_category, suggest_category: x.suggest_category,
        suggest_product_id: x.suggest?.id || null, starter: true, evidence: { source: 'tajriba', support: x.support, buyers: x.buyers, share: x.share } }).catch(() => null);
      if (r?.ok !== false) n++;
    }
    toast(`${n} ta qoida qo‘shildi — ertangi ro‘yxatdan ishlaydi`); return renderResale();
  }
  const sta = e.target.closest('[data-stadd]'), str = e.target.closest('[data-strej]');
  if (str) { const x = RULE_START[Number(str.dataset.strej)]; await api('/api/rules/reject', { a: x.bought_category, b: x.suggest_category }).catch(fail); toast('Yashirildi'); return renderResale(); }
  if (sta) {
    const x = RULE_START[Number(sta.dataset.stadd)];
    return modal(`<h2>Qoida: ${esc(x.bought_category.replaceAll('|', ' / '))} → ${esc(x.suggest_category.replaceAll('|', ' / '))}</h2>
      <div class="note">Tarixda: ${x.support} / ${x.buyers} mijoz. Bugun taklif: ${esc(x.suggest?.name || 'qoldiq yo‘q')} — har kuni shu turdagi do‘konda bor model tanlanadi. Sotuvchi mijoz texnikasiga mosligini tekshiradi.</div>
      <div class="form-grid"><label class="field wide"><span>Sabab (mijozga tushunarli)</span><input name="reason" id="st_reason" required value="${esc(x.reason)}"></label>
      <label class="field"><span>Xariddan kamida (kun)</span><input type="number" name="min_days" id="st_min" value="${x.min_days}"></label>
      <label class="field"><span>Ko‘pi bilan (kun)</span><input type="number" name="max_days" id="st_max" value="${x.max_days}"></label></div>`,
    async dd => { await api('/api/rules', { ...dd, bought_category: x.bought_category, suggest_category: x.suggest_category, suggest_product_id: x.suggest?.id || null, starter: true,
      evidence: { source: 'tajriba', support: x.support, buyers: x.buyers, share: x.share } }); toast('Qoida qo‘shildi — ertangi ro‘yxatdan ishlaydi'); renderResale(); });
  }
  const sa = e.target.closest('[data-sadd]'), sr = e.target.closest('[data-srej]');
  if (sr) { const x = RULE_SUG[Number(sr.dataset.srej)]; await api('/api/rules/reject', { a: x.bought_category, b: x.suggest_category }).catch(fail); toast('Tavsiya yashirildi'); return renderResale(); }
  if (sa) {
    const x = RULE_SUG[Number(sa.dataset.sadd)];
    return modal(`<h2>Qoida: tur bo‘yicha</h2>
      <div class="note">${esc(x.bought_category)} → ${esc(x.suggest_category)} · ${x.support} / ${x.buyers} mijoz (${String(x.share).replace('.', ',')}%), tasodifiydan ×${String(x.lift).replace('.', ',')}, odatda ${x.median_days} kundan keyin. Bugun taklif: ${esc(x.suggest?.name || 'qoldiq yo‘q')}.</div>
      <div class="form-grid"><label class="field wide"><span>Sabab (mijozga tushunarli — nima uchun kerakligini yozing)</span><input name="reason" id="rs_reason" required value="${esc(`${x.bought_category} olganlar ko‘pincha keyin ${x.suggest_category} ham oladi`)}"></label>
      <label class="field"><span>Xariddan kamida (kun)</span><input type="number" name="min_days" id="rs_min" value="${x.min_days}"></label>
      <label class="field"><span>Ko‘pi bilan (kun)</span><input type="number" name="max_days" id="rs_max" value="${x.max_days}"></label></div>`,
    async dd => { await api('/api/rules', { ...dd, bought_category: x.bought_category, suggest_category: x.suggest_category, suggest_product_id: x.suggest?.id || null,
      evidence: { support: x.support, buyers: x.buyers, share: x.share, lift: x.lift, median_days: x.median_days } }); toast('Qoida qo‘shildi — ertangi ro‘yxatdan ishlaydi'); renderResale(); });
  }
  const fc = e.target.closest('[data-fillcard]');
  if (fc) { prodQ = fc.dataset.fillcard.split(' — ')[0]; PF.status = 'all'; location.hash = '#katalog'; return; }
  const nc = e.target.closest('[data-newcamp]');
  if (nc || e.target.id === 'newCamp' || e.target.id === 'newRule') {
    const prods = (await api('/api/pick/products')).items;
    const opts = sel => prods.map(p => `<option value="${p.id}" ${sel === p.id ? 'selected' : ''}>${esc(p.name)}${p.stock ? '' : ' (qoldiq yo‘q)'}</option>`).join('');
    if (nc || e.target.id === 'newCamp') return modal(`<h2>Yangi kampaniya</h2><div class="form-grid">
      <label class="field wide"><span>Yangi kelgan mahsulot</span><select name="product_id" id="c_prod">${opts(nc ? Number(nc.dataset.newcamp) : undefined)}</select></label>
      <label class="field"><span>Nomi</span><input name="title" id="c_title" placeholder="Yangi kirim: …"></label>
      <label class="field"><span>Kuniga limit</span><input type="number" name="daily_limit" id="c_lim" value="${S.boot.settings.campaign_daily_limit}"></label>
      <label class="field wide"><span>Xabar (bo‘sh qoldirsangiz — namuna). O‘rinbosarlar: {ism} {xarid} {mahsulot} {narx}</span><textarea name="message" id="c_msg"></textarea></label></div>
      <div class="note">Agent chegirma o‘ylab chiqarmaydi. Narx BILLZ’dan olinadi; eskirgan bo‘lsa «narxini sotuvchi aytadi» deb yoziladi.</div>`,
    async dd => { const r = await api('/api/campaigns', { ...dd, product_id: Number(dd.product_id) }); toast('Kampaniya qoralamasi yaratildi'); resaleTab = 'camp'; renderResale(); if (r.id) setTimeout(() => showSegment(r.id), 50); });
    return modal(`<h2>Qayta sotuv qoidasi</h2><div class="form-grid">
      <label class="field"><span>Olgan mahsulot</span><select name="bought_product_id" id="r_b">${opts()}</select></label>
      <label class="field"><span>Taklif qilinadigan</span><select name="suggest_product_id" id="r_s">${opts()}</select></label>
      <label class="field wide"><span>Sabab (mijozga tushunarli)</span><input name="reason" id="r_reason" required placeholder="Korpus olgan — obyektiv xaridi yo‘q"></label>
      <label class="field"><span>Xariddan kamida (kun)</span><input type="number" name="min_days" id="r_min" value="7"></label>
      <label class="field"><span>Ko‘pi bilan (kun)</span><input type="number" name="max_days" id="r_max" value="365"></label></div>`,
    async dd => { await api('/api/rules', { ...dd, bought_product_id: Number(dd.bought_product_id), suggest_product_id: Number(dd.suggest_product_id) }); toast('Qoida saqlandi'); renderResale(); });
  }
  const sg = e.target.closest('[data-seg]'); if (sg) return showSegment(Number(sg.dataset.seg));
});
async function showSegment(id) {
  const [seg, list] = await Promise.all([api(`/api/campaigns/${id}/segment`), api('/api/campaigns')]);
  const c = list.items.find(x => x.id === id), ex = seg.excluded;
  const row = (l, n, minus) => `<div class="f-row ${minus ? 'minus' : ''}"><span class="lab"><span>${minus ? '− ' : ''}${l}</span><span class="fbar" style="width:${seg.total ? Math.max(2, n / seg.total * 100) : 0}%"></span></span><span class="n">${minus ? '−' : ''}${n}</span></div>`;
  const ok = seg.bot + seg.task + seg.no_consent;
  $('#modalRoot').innerHTML = `<div class="modal-back"><div class="modal"><h2>${esc(c.title)}</h2>
    <div class="funnel">${row('Qoidalar bo‘yicha mos xaridorlar', seg.total)}${row('Xaridni qaytargan', ex.qaytargan, 1)}${row('Allaqachon olgan', ex.allaqachon_olgan, 1)}${row('Xabardan voz kechgan', ex.voz_kechgan, 1)}${row('Qoldiq yo‘q', ex.qoldiq_yoq, 1)}${row('30 kunlik chastota to‘lgan', seg.freq, 1)}
      <div class="f-row total"><span class="lab"><span>Mos mijozlar</span></span><span class="n">${ok}</span></div></div>
    <div class="split"><div class="go"><span class="lbl">Avtomatik (bot)</span><span class="big mono">${seg.bot}</span>ulangan va rozilik bergan</div>
      <div><span class="lbl">Yuborilmaydi</span><span class="big mono">${seg.no_consent}</span>botda, lekin rozilik yo‘q</div>
      <div><span class="lbl">Sotuvchi vazifasi</span><span class="big mono">${seg.task}</span>faqat telefon — raqam Telegram chat emas</div></div>
    ${seg.preview ? `<div class="preview"><div class="chips"><span class="pill acc">Sabab: ${esc(seg.reason)}</span></div><div class="txt">${esc(seg.preview)}</div></div>` : ''}
    <div class="row-actions" style="justify-content:flex-end"><button class="btn ghost" type="button" data-close>Yopish</button>
      ${isLead() ? (c.status === 'running' ? `<button class="btn" type="button" data-cstat="paused">To‘xtatish</button>` : `<button class="btn primary" type="button" data-cstat="running">${c.status === 'draft' ? 'Tasdiqlash va boshlash' : 'Davom ettirish'}</button>`) : ''}</div></div></div>`;
  const back = $('.modal-back');
  back.addEventListener('click', async ev => {
    if (ev.target === back || ev.target.closest('[data-close]')) { $('#modalRoot').innerHTML = ''; return; }
    const b = ev.target.closest('[data-cstat]');
    if (b) { await api(`/api/campaigns/${id}/status`, { status: b.dataset.cstat }).catch(fail); $('#modalRoot').innerHTML = ''; toast(b.dataset.cstat === 'running' ? `Boshlandi — ${S.boot.settings.campaign_from}–${S.boot.settings.campaign_to} oralig‘ida, kuniga ${c.daily_limit} tagacha` : 'To‘xtatildi'); renderResale(); }
  });
}

/* =====================================================================
   REJA VA TAHLIL (Obyektiv)
   ===================================================================== */
let period = null;
const mln = n => n == null ? '—' : (n / BIG().div).toLocaleString('ru-RU', { maximumFractionDigits: 1 }).replace(/\u00a0/g, ' ');
const mlrd = n => n == null ? '—' : (n / 1e9).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function chartSvg(d) {
  const c = d.company, W = 720, H = 280, L = 48, R = 104, T = 22, B = 30;
  // Hali savdo ham, reja ham yo‘q — bo‘sh o‘qlar («0 0 0») o‘rniga tushunarli izoh
  if (!c.plan && !c.net && !c.forecast) return `<div class="empty-state" style="height:180px">Bu davrda hali savdo yo‘q${isLead() ? ' — reja kiritilsa, bajarilish chizig‘i ham chiqadi' : ''}.</div>`;
  const days = d.series.length;
  let cum = 0; const fact = [[0, 0]]; let lastDay = 0;
  d.series.forEach(x => { if (!x.future) { cum += x.net; fact.push([x.day, cum]); lastDay = x.day; } });
  const MAX = Math.max(c.plan || 0, c.high || 0, cum) * 1.08 || 1;
  const x = v => L + v / days * (W - L - R), y = v => T + (1 - v / MAX) * (H - T - B);
  const P = pts => pts.map((p, i) => (i ? 'L' : 'M') + x(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1)).join(' ');
  const step = Math.pow(10, Math.floor(Math.log10(MAX / 4))), tick = [1, 2, 2.5, 5, 10].map(m => m * step).find(s => MAX / s <= 6) || step * 10;
  let g = '';
  for (let v = 0; v <= MAX; v += tick) g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${mln(v)}</text>`;
  for (const dd of [1, 5, 10, 15, 20, 25, days]) g += `<text x="${x(dd - 0.5)}" y="${H - 10}" text-anchor="middle">${dd}</text>`;
  if (c.plan) { g += `<path d="${P([[0, 0], [days, c.plan]])}" stroke="var(--ink-3)" stroke-width="1.5" fill="none"/><circle cx="${x(days)}" cy="${y(c.plan)}" r="3" fill="var(--ink-3)"/><text class="t-strong" x="${x(days) + 8}" y="${y(c.plan) - 5}">Reja ${mln(c.plan)}</text>`; }
  if (lastDay < days) {
    g += `<path d="M${x(lastDay)} ${y(cum)} L${x(days)} ${y(c.high)} L${x(days)} ${y(c.low)} Z" fill="var(--accent)" fill-opacity=".12"/>`;
    g += `<path d="${P([[lastDay, cum], [days, c.forecast]])}" stroke="var(--accent)" stroke-width="2" stroke-dasharray="5 4" fill="none"/>`;
    g += `<circle cx="${x(days)}" cy="${y(c.forecast)}" r="3.5" fill="var(--surface)" stroke="var(--accent)" stroke-width="2"/><text class="t-acc" x="${x(days) + 8}" y="${y(c.forecast) + (c.plan && Math.abs(y(c.plan) - y(c.forecast)) < 16 ? 16 : 4)}">Prognoz ${mln(c.forecast)}</text>`;
    g += `<line x1="${x(lastDay)}" x2="${x(lastDay)}" y1="${T - 6}" y2="${H - B}" stroke="var(--ink-3)" stroke-dasharray="3 3"/><text x="${x(lastDay)}" y="${T - 10}" text-anchor="middle">bugun</text>`;
  }
  g += `<path d="${P(fact)} L${x(lastDay)} ${y(0)} L${x(0)} ${y(0)} Z" fill="var(--accent)" fill-opacity=".1"/><path d="${P(fact)}" stroke="var(--accent)" stroke-width="2.5" fill="none" stroke-linejoin="round"/>`;
  g += `<circle cx="${x(lastDay)}" cy="${y(cum)}" r="4.5" fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/><text class="t-acc" x="${x(lastDay) + 10}" y="${y(cum) + 20}">Fakt ${mln(cum)}</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tushum: fakt ${mln(cum)} ${BIG().label}, prognoz ${mln(c.forecast)} ${BIG().label}, reja ${mln(c.plan)} ${BIG().label}">${g}</svg>`;
}
const pctCell = (p, plan) => plan ? `<span class="bar ${p < 55 ? 'low' : ''}"><span class="track"><span class="fill" style="width:${Math.min(100, p)}%"></span></span>${p} %</span>` : '<span class="muted">reja belgilanmagan</span>';
async function renderAnalytics() {
  period ||= new Date(clockNow() + 5 * 3600e3).toISOString().slice(0, 7);
  const d = await api(`/api/analytics?period=${period}`), c = d.company, seller = S.boot.me.role === 'sotuvchi';
  const periods = [0, 1, 2].map(i => { const t = new Date(clockNow() + 5 * 3600e3); t.setUTCDate(1); t.setUTCMonth(t.getUTCMonth() - i); return t.toISOString().slice(0, 7); });
  $('#analyticsPage').innerHTML = `
    <div class="filters"><label class="field" style="max-width:180px"><span>Davr</span><select id="perSel">${periods.map(p => `<option ${p === period ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
      <span class="muted">${d.scope && d.scope.kind !== 'company' ? `<b>${esc(d.scope.label)}</b> · ` : ''}Manba: ${esc(d.source)} · oyning ${Math.round(d.elapsed * 100)}% o‘tdi · ${fmtDT(d.as_of)} holati</span>
      ${isLead() ? `<span style="margin-left:auto" class="row-actions"><a class="btn sm ghost" href="/api/export/filiallar.csv?period=${period}">Filiallar CSV</a><a class="btn sm ghost" href="/api/export/sotuvchilar.csv?period=${period}">Sotuvchilar CSV</a><button class="btn sm" type="button" id="runIns">Xulosani hozir yangilash</button></span>` : ''}</div>
    ${!c.plan && isLead() ? (() => { const sg = d.versions.find(v => v.status !== 'approved'); return `<div class="plan-cta">
      <div><b>${period} rejasi hali tasdiqlanmagan.</b> ${sg ? `Tizim tavsiyasi: <b>${mln(sg.revenue)} ${BIG().label}</b> <span class="muted">(${esc(sg.basis || '')})</span>` : 'Tizim tavsiyasini oling yoki o‘zingiz kiriting.'} Reja bo‘lmasa, bajarilish foizi va filiallar solishtiruvi chiqmaydi.</div>
      <div class="row-actions">${sg ? `<button class="btn sm primary" type="button" data-approveplan="${sg.revenue}">Tavsiyani tasdiqlash</button>` : '<button class="btn sm primary" type="button" id="suggestPlan">Tizim tavsiyasi</button>'}<button class="btn sm" type="button" id="setPlan">Boshqa summa</button></div></div>`; })() : ''}
    <div class="kpis">
      <div class="kpi"><span class="lbl">${seller ? 'Mening sof savdom' : 'Sof tushum · fakt'}</span><span class="v">${mln(c.net)} <small>${BIG().label}</small></span><span class="s">Sotuv ${mln(c.gross)} − qaytarish ${mln(c.returns)} · ${c.checks} chek</span><button class="linkbtn" data-ex="fakt">Qanday hisoblandi?</button></div>
      <div class="kpi"><span class="lbl">Reja bajarilishi</span><span class="v">${c.plan ? c.pct + ' <small>%</small>' : '<small>reja belgilanmagan</small>'}</span>${c.plan ? `<div class="rail2"><span class="fill" style="width:${Math.min(100, c.pct)}%"></span><span class="tick" style="left:${Math.round(d.elapsed * 100)}%"></span></div>` : ''}<span class="s">${c.plan ? `Reja ${mln(c.plan)} ${BIG().label} (v${c.plan_version})` : 'Rahbar rejani kiritadi'}</span><button class="linkbtn" data-ex="bajarilish">Qanday hisoblandi?</button></div>
      <div class="kpi"><span class="lbl">Oy oxiriga prognoz</span><span class="v">${mln(c.forecast)} <small>${BIG().label}</small></span><span class="s">Diapazon ${mln(c.low)}–${mln(c.high)} · ishonch: ${esc(c.confidence)}</span><button class="linkbtn" data-ex="prognoz">Qanday hisoblandi?</button></div>
      <div class="kpi"><span class="lbl">O‘rtacha chek</span><span class="v">${mln(c.avg_check)}${c.avg_check == null ? '' : ` <small>${BIG().label}</small>`}</span><span class="s">Suhbatlar: ${d.conv?.convs ?? 0} · 1-javob mediana ${d.conv?.first_median_min ?? '—'} daq</span></div>
    </div>
    <div class="grid-2"><div class="panel"><div class="panel-head"><h2>Tushum: reja, fakt, prognoz</h2><span class="muted">${BIG().label}, yig‘ma</span></div>
      <div class="legend"><span><i class="sw"></i>Fakt (${esc(d.source)}, sof)</span><span><i class="sw fc"></i>Prognoz va diapazon</span><span><i class="sw pl"></i>Reja</span></div>
      <div class="chart-wrap">${chartSvg(d)}</div></div>
      <div class="panel"><div class="panel-head"><h2>Reja</h2><span class="muted">o‘tgan davr qulflanadi</span></div>
        <div class="versions">${d.versions.map(v => `<div><span class="pill ${v.status === 'approved' ? 'acc' : ''}">v${v.version}</span><span>${v.status === 'approved' ? 'Tasdiqlangan' : 'Tizim tavsiyasi'} · ${esc(v.created_by)}<br><span class="muted">${esc(v.basis || '')}</span></span><span class="mono">${mln(v.revenue)}</span></div>`).join('') || '<span class="muted">Reja kiritilmagan</span>'}</div>
        ${isLead() ? `<div class="row-actions"><button class="btn sm" type="button" id="suggestPlan">Tizim tavsiyasi</button><button class="btn sm primary" type="button" id="setPlan">Rejani kiritish</button></div>` : ''}</div></div>
    ${(d.products || []).length ? `<div class="grid-2"><div class="panel"><div class="panel-head"><h2>Eng ko‘p sotilgan tovarlar</h2><span class="muted">sof savdo</span>${isLead() ? `<a class="btn sm ghost" style="margin-left:auto" href="/api/export/tovarlar.csv?period=${period}">CSV</a>` : ''}</div>
      <div class="tbl"><table><thead><tr><th>Tovar</th><th class="n">Sof</th><th class="n">Dona</th><th class="n">Chek</th></tr></thead><tbody>
      ${d.products.map(x => `<tr><td>${esc(x.name)}${x.returned ? ` <span class="pill warn">qaytarilgan ${x.returned}</span>` : ''}</td><td class="n mono">${money(x.net)}</td><td class="n mono">${x.qty}</td><td class="n mono">${x.checks}</td></tr>`).join('')}
      </tbody></table></div></div>
      <div class="panel"><div class="panel-head"><h2>Toifalar</h2><span class="muted">sof savdo</span></div>
      <div class="tbl"><table><thead><tr><th>Toifa</th><th class="n">Sof</th><th class="n">Dona</th><th class="n">Chek</th></tr></thead><tbody>
      ${d.categories.map(x => `<tr><td>${esc(x.name)}</td><td class="n mono">${money(x.net)}</td><td class="n mono">${x.qty}</td><td class="n mono">${x.checks}</td></tr>`).join('')}
      </tbody></table></div></div></div>` : ''}
    ${d.branches.length ? `<div class="panel"><div class="panel-head"><h2>Filiallar</h2><span class="muted">${BIG().label} · «Kuniga» — ish kunlariga bo‘lingan; «Tovar» — katalogning shu filialda bor ulushi</span></div>
      ${(() => { const bPlan = d.branches.some(b => b.plan), bConv = d.branches.some(b => b.conv?.convs != null); return `
      <div class="tbl"><table><thead><tr><th>Filial</th>${bPlan ? '<th class="n">Reja</th>' : ''}<th class="n">Fakt</th>${bPlan ? '<th class="n">Bajarilish</th>' : ''}<th class="n">Kuniga</th><th class="n">Ish kuni</th><th class="n">Tovar</th><th class="n">Prognoz</th><th class="n">Chek</th>${bConv ? '<th class="n">Suhbat</th><th class="n">1-javob</th><th class="n">30+ daq javobsiz</th>' : ''}${isLead() ? '<th></th>' : ''}</tr></thead><tbody>
      ${d.branches.map(b => `<tr><td>${esc(b.name)}${b.kind === 'ombor' ? ' <span class="pill">ombor</span>' : ''}</td>${bPlan ? `<td class="n">${mln(b.plan)}</td>` : ''}<td class="n">${mln(b.net)}</td>${bPlan ? `<td class="n">${pctCell(b.pct, b.plan)}</td>` : ''}
        <td class="n mono">${b.per_day != null ? money(b.per_day) : '—'}</td><td class="n mono">${b.work_days ?? '—'}</td><td class="n mono">${b.stock_share != null ? b.stock_share + '%' : '—'}</td><td class="n">${mln(b.forecast)}</td><td class="n">${b.checks}</td>
        ${bConv ? `<td class="n">${b.conv?.convs ?? '—'}</td><td class="n">${b.conv?.first_median_min != null ? b.conv.first_median_min + ' daq' : '—'}</td><td class="n">${b.conv?.late30 ?? '—'}</td>` : ''}
        ${isLead() ? `<td><button class="btn sm ghost" type="button" data-bplan="${esc(b.name)}">Reja</button></td>` : ''}</tr>`).join('') || '<tr><td colspan="13" class="muted">Ma’lumot yo‘q</td></tr>'}
      </tbody></table></div>${!bConv ? '<p class="muted tbl-note">Suhbat ko‘rsatkichlari (javob tezligi, javobsiz qolganlar) Telegram akkauntiga filial biriktirilgach chiqadi: Sozlamalar → Akkauntlar → Filial.</p>' : ''}`; })()}</div>` : ''}
    <div class="panel"><div class="panel-head"><h2>${seller ? 'Mening natijam' : 'Sotuvchilar'}</h2></div>
      ${(() => { const list = [...d.sellers].sort((a, b) => (b.net || 0) - (a.net || 0)), sPlan = list.some(x => x.plan), sConv = list.some(x => x.conv?.convs != null); return `
      <div class="tbl"><table><thead><tr><th>Sotuvchi</th><th class="n">Fakt, ${BIG().label}</th>${sPlan ? '<th class="n">Reja</th><th class="n">Bajarilish</th>' : ''}<th class="n">Chek</th>${sConv ? '<th class="n">Suhbat</th><th class="n">1-javob (o‘zi)</th><th class="n">AI yordam</th>' : ''}<th class="n">Ochiq vazifa</th></tr></thead><tbody>
      ${list.map(s => `<tr><td>${esc(s.name)}</td><td class="n">${mln(s.net)}</td>${sPlan ? `<td class="n">${mln(s.plan)}</td><td class="n">${pctCell(s.pct, s.plan)}</td>` : ''}<td class="n">${s.checks}</td>
        ${sConv ? `<td class="n">${s.conv?.convs ?? '—'}</td><td class="n">${s.conv?.first_human_median_min != null ? s.conv.first_human_median_min + ' daq' : '—'}</td><td class="n">${s.conv?.ai_assisted ?? '—'}</td>` : ''}<td class="n">${s.open_tasks ?? '—'}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">Ma’lumot yo‘q</td></tr>'}
      </tbody></table></div>${!sConv ? '<p class="muted tbl-note">Suhbat ko‘rsatkichlari sotuvchi panelga kirib javob bera boshlaganda chiqadi (hozir 10 sotuvchida parol yo‘q).</p>' : ''}`; })()}</div>
    <div class="panel"><div class="panel-head"><h2>Tahlilchi xulosalari</h2><span class="muted">sabab isbotlanmasa — gipoteza</span></div>
      ${d.insights.map(i => `<div class="insight"><div class="who">${svg('chart')}Tahlilchi · ${fmtDT(i.at)}</div><h3>${esc(i.title)}</h3><dl>
        ${i.metric ? `<dt>Ko‘rsatkich</dt><dd>${esc(i.metric)}</dd>` : ''}<dt>Davr</dt><dd>${esc(i.period)}</dd>
        ${i.cause ? `<dt>Ehtimoliy sabab</dt><dd>${i.hypothesis ? '<span class="hyp">Gipoteza</span>' : ''}${esc(i.cause)}</dd>` : ''}
        <dt>Dalil</dt><dd>${esc(i.evidence || '')}</dd><dt>Tavsiya</dt><dd>${esc(i.advice || '')}</dd><dt>Mas’ul</dt><dd>${esc(i.owner || '')}</dd></dl></div>`).join('') || '<span class="muted">Hozircha xulosa yo‘q. Har kuni ' + esc(S.boot.settings.report_time) + ' da yangilanadi.</span>'}</div>`;
  $('#analyticsPage').dataset.d = JSON.stringify({ c, method: c.method, source: d.source, elapsed: d.elapsed });
}
$('#analyticsPage').addEventListener('change', e => { if (e.target.id === 'perSel') { period = e.target.value; renderAnalytics(); } });
$('#analyticsPage').addEventListener('click', async e => {
  const x = JSON.parse($('#analyticsPage').dataset.d || '{}'), c = x.c;
  const ex = e.target.closest('[data-ex]');
  if (ex) {
    const T = { fakt: ['Sof tushum', `Sof tushum = sotuvlar − qaytarishlar = ${mln(c.gross)} − ${mln(c.returns)} = ${mln(c.net)} ${BIG().label}. Qaytarish o‘zi qilingan kunda ayiriladi. Cheklar: ${c.checks}. Manba: ${x.source}.`],
      bajarilish: ['Reja bajarilishi', c.plan ? `Bajarilish = fakt ÷ reja = ${mln(c.net)} ÷ ${mln(c.plan)} = ${c.pct}%. Oyning ${Math.round(x.elapsed * 100)}% o‘tdi. Reja v${c.plan_version}.` : 'Reja kiritilmagan — foiz o‘rniga «reja belgilanmagan» ko‘rsatiladi.'],
      prognoz: ['Prognoz', `Prognoz = fakt + qolgan kunlar kutilmasi = ${mln(c.net)} + ${mln(c.expected)} = ${mln(c.forecast)} ${BIG().label}. Usul: ${x.method}. Ishonch: ${c.confidence}. Diapazon ${mln(c.low)}–${mln(c.high)}. Prognoz kafolat emas.`] }[ex.dataset.ex];
    return modal(`<h2>${T[0]} — qanday hisoblandi</h2><div class="note" style="font-size:14px">${esc(T[1])}</div>`, null);
  }
  if (e.target.id === 'runIns') { const r = await api('/api/insights/run', {}).catch(fail); if (r) toast(`Xulosalar: ${r.made ?? 0} ta`); return renderAnalytics(); }
  const ap = e.target.closest('[data-approveplan]');
  if (ap) {
    if (!confirm(`${period} rejasi: ${mln(Number(ap.dataset.approveplan))} ${BIG().label}. Tasdiqlaysizmi?`)) return;
    await api('/api/plans', { period, scope: 'company', key: '*', revenue: Number(ap.dataset.approveplan) }).catch(fail);
    toast('Reja tasdiqlandi'); return renderAnalytics();
  }
  if (e.target.id === 'suggestPlan') { const r = await api('/api/plans/suggest', { period }).catch(fail); if (r) toast(r.ok ? `Tavsiya: ${mln(r.revenue)} ${BIG().label} (${r.basis}) — tasdiqlash uchun «Rejani kiritish»` : r.why); return renderAnalytics(); }
  const bp = e.target.closest('[data-bplan]');
  if (e.target.id === 'setPlan' || bp) {
    const key = bp ? bp.dataset.bplan : '*';
    return modal(`<h2>Reja: ${esc(bp ? key : 'kompaniya')} · ${period}</h2><label class="field"><span>Tushum rejasi (${cur() === 'USD' ? '$' : 'so‘m'})</span><input type="number" min="0" step="${cur() === 'USD' ? 100 : 1000000}" name="revenue" id="pl_rev" required></label>
      <div class="note">Har kiritish yangi versiya bo‘lib saqlanadi. O‘tgan oy rejasi o‘zgartirilmaydi.</div>`,
    async dd => { await api('/api/plans', { period, scope: bp ? 'branch' : 'company', key, revenue: Number(dd.revenue) }); toast('Reja saqlandi'); renderAnalytics(); });
  }
});

/* =====================================================================
   YO‘NALISH
   ===================================================================== */
/* ---------- Keshbek: BILLZ balansi bor mijozlar ---------- */
const CF = { q: '', min: 0, phone: '', period: 'all', sort: 'keshbek' };
let cbTimer = null;
async function renderCashback() {
  const r = await api('/api/cashback?' + new URLSearchParams(CF));
  const sel = (id, val, opts) => `<select id="${id}">${opts.map(([v, l]) => `<option value="${v}" ${String(val) === String(v) ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  $('#cashbackPage').innerHTML = `
    <div class="panel"><div class="panel-head"><h2>Keshbegi bor mijozlar</h2>
      <span class="muted">${r.n} ta topildi${r.n !== r.hammasi ? ` (jami ${r.hammasi} ta)` : ''} · balanslar yig‘indisi ${cash(r.total)} · BILLZ: ${r.synced_at ? fmtDT(r.synced_at) : '—'}</span></div>
      <div class="filters" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px">
        <label class="search" style="min-width:240px"><span data-ic="search"></span><input id="cbQ" type="search" placeholder="Ism yoki telefon" value="${esc(CF.q)}" autocomplete="off"></label>
        <label class="field"><span>Eng kam keshbek</span>${sel('cbMin', CF.min, [[0, 'Hammasi — $0.01 dan ham'], [1, '$1 dan'], [10, '$10 dan'], [50, '$50 dan'], [100, '$100 dan']])}</label>
        <label class="field"><span>Oxirgi xarid</span>${sel('cbPeriod', CF.period, [['all', 'Hammasi'], ['yangi', 'Oxirgi 90 kunda'], ['uxlagan', '1 yildan beri yo‘q']])}</label>
        <label class="field"><span>Telefon</span>${sel('cbPhone', CF.phone, [['', 'Hammasi'], ['1', 'Faqat raqami borlar']])}</label>
        <label class="field"><span>Tartib</span>${sel('cbSort', CF.sort, [['keshbek', 'Keshbek'], ['xarid', 'Jami xarid'], ['oxirgi', 'Oxirgi xarid']])}</label>
      </div>
      <div class="tbl"><table><thead><tr><th>Mijoz</th><th>Telefon</th><th class="n">Keshbek</th><th class="n">Jami xarid</th><th>Oxirgi xarid</th><th></th></tr></thead><tbody>
      ${r.items.map(x => `<tr><td>${esc(x.name || '—')}</td><td class="mono">${esc(x.phone || '—')}</td>
        <td class="n mono">${cash(x.amount)}</td><td class="n mono">${money(x.spent)}</td>
        <td class="muted">${x.last_buy ? fmtDT(x.last_buy) : 'xaridi yo‘q'}</td>
        <td>${x.conv_id ? `<a class="btn sm ghost" href="#suhbat/${x.conv_id}">Suhbat</a>` : ''}</td></tr>`).join('')
        || '<tr><td colspan="6" class="muted">Shu shartlarga mos mijoz topilmadi</td></tr>'}
      </tbody></table></div>
      <p class="muted tbl-note">Ko‘pi bilan 200 ta ko‘rsatiladi — qidiruv va filtr bilan toraytiring. Balans BILLZ’dan har kuni yangilanadi; keshbegi bor mijoz qayta xaridga osonroq keladi.</p></div>`;
}
$('#cashbackPage').addEventListener('input', e => {
  if (e.target.id !== 'cbQ') return;
  clearTimeout(cbTimer);
  cbTimer = setTimeout(() => { CF.q = e.target.value.trim(); renderCashback(); }, 350);
});
$('#cashbackPage').addEventListener('change', e => {
  const m = { cbMin: 'min', cbPeriod: 'period', cbPhone: 'phone', cbSort: 'sort' }[e.target.id];
  if (!m) return;
  CF[m] = e.target.value;
  renderCashback();
});

/* ---------- Hisobot: to'liq tahlil, chop etish va PDF uchun ----------
   Ma'lumot /api/analytics dan (BILLZ). Grafiklar bitta qatorli — shuning uchun afsona kerak emas,
   sarlavhaning o'zi nimani ko'rsatayotganini aytadi; har bir grafikning raqamlari pastdagi jadvalda ham bor. */
let repPeriod = null;

const repMonths = () => {
  const out = [], d = new Date();
  for (let i = 0; i < 12; i++) { out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); d.setMonth(d.getMonth() - 1); }
  return out;
};
const MON = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const repMonthName = p => { const [y, m] = p.split('-'); return `${MON[Number(m) - 1]} ${y}`; };

/* Kunlik ustunlar. Kelajak kunlar (hali bo'lmagan) och rangda — fakt bilan aralashmasin. */
function repBars(series, planPerDay) {
  const W = 720, H = 168, padT = 12, padB = 20;
  const vals = series.map(s => s.net || 0);
  const max = Math.max(1, ...vals, planPerDay || 0);
  const n = series.length || 1, bw = W / n;
  const y = v => H - padB - (v / max) * (H - padT - padB);
  const bars = series.map((s, i) => {
    const h = Math.max(s.net > 0 ? 2 : 0, (s.net || 0) / max * (H - padT - padB));
    return `<rect x="${(i * bw + 1.5).toFixed(1)}" y="${(H - padB - h).toFixed(1)}" width="${(bw - 3).toFixed(1)}" height="${h.toFixed(1)}" rx="3"
      class="${s.future ? 'rb-next' : 'rb-now'}"><title>${esc(s.date)} — ${money(s.net || 0)}</title></rect>`;
  }).join('');
  const ticks = series.map((s, i) => (i % 5 === 0 || i === n - 1)
    ? `<text x="${(i * bw + bw / 2).toFixed(1)}" y="${H - 6}" class="rb-tick">${Number(s.date.slice(-2))}</text>` : '').join('');
  const planLine = planPerDay ? `<line x1="0" x2="${W}" y1="${y(planPerDay).toFixed(1)}" y2="${y(planPerDay).toFixed(1)}" class="rb-plan"/>
    <text x="4" y="${(y(planPerDay) - 5).toFixed(1)}" class="rb-plan-t">kunlik reja ${money(planPerDay)}</text>` : '';
  return `<svg class="rchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Kunlik sof tushum">
    <line x1="0" x2="${W}" y1="${H - padB}" y2="${H - padB}" class="rb-axis"/>${planLine}${bars}${ticks}</svg>`;
}

/* Gorizontal ustunlar: kim qancha sotdi — eng kattasidan boshlab */
function repHBars(rows, fmt = money) {
  const max = Math.max(1, ...rows.map(r => r.v));
  return `<div class="rhbars">${rows.map(r => `<div class="rhb">
    <span class="rhb-n">${esc(r.name)}</span>
    <span class="rhb-t"><span class="rhb-f" style="width:${Math.max(1.5, r.v / max * 100).toFixed(1)}%"></span></span>
    <span class="rhb-v mono">${fmt(r.v)}</span></div>`).join('') || '<div class="muted">Ma’lumot yo‘q</div>'}</div>`;
}

async function renderReport() {
  repPeriod = repPeriod || (S.boot.period || repMonths()[0]);
  const d = await api(`/api/analytics?period=${repPeriod}`);
  const c = d.company, sellers = [...d.sellers].sort((a, b) => (b.net || 0) - (a.net || 0));
  const branches = [...d.branches].sort((a, b) => (b.net || 0) - (a.net || 0));
  const workDays = Math.max(1, d.series.filter(s => !s.future).length);
  const planPerDay = c.plan ? Math.round(c.plan / d.series.length) : null;
  const tile = (lbl, val, sub = '') => `<div class="rtile"><span class="rt-l">${lbl}</span><b class="rt-v">${val}</b>${sub ? `<span class="rt-s">${sub}</span>` : ''}</div>`;

  $('#reportPage').innerHTML = `
    <div class="rep-bar no-print">
      <label class="field"><span>Davr</span><select id="repPer">${repMonths().map(p => `<option value="${p}" ${p === repPeriod ? 'selected' : ''}>${repMonthName(p)}</option>`).join('')}</select></label>
      <button class="btn primary" type="button" id="repPrint">PDF saqlash yoki chop etish</button>
      <span class="muted">PDF uchun: tugmani bosing → «Printer» o‘rniga «Save as PDF» ni tanlang</span>
    </div>

    <div class="report" id="repDoc">
      <header class="rep-head">
        <div><div class="rep-brand">Photobuy · Sotuv markazi</div>
          <h1>Sotuv hisoboti — ${repMonthName(repPeriod)}</h1></div>
        <div class="rep-meta">Tayyorlandi: ${fmtDT(Date.now())}<br>Manba: ${esc(d.source)}<br>Davrning ${Math.round(d.elapsed * 100)}% o‘tdi</div>
      </header>

      <section class="rep-sec">
        <h2>Asosiy ko‘rsatkichlar</h2>
        <div class="rtiles">
          ${tile('Sof tushum', mln(c.net), `${money(c.gross)} sotuv − ${money(c.returns)} qaytarish`)}
          ${tile('Reja', c.plan ? mln(c.plan) : '—', c.plan ? `bajarilish ${c.pct}%` : 'reja kiritilmagan')}
          ${tile('Prognoz', mln(c.forecast), `${mln(c.low)}–${mln(c.high)} · ishonch: ${esc(c.confidence)}`)}
          ${tile('Cheklar', String(c.checks), `o‘rtacha chek ${money(c.avg_check)}`)}
          ${tile('Kuniga', money(Math.round(c.net / workDays)), `${workDays} kun hisobida`)}
        </div>
      </section>

      <section class="rep-sec">
        <h2>Kunlik sof tushum</h2>
        <p class="rep-note">Har bir ustun — bir kunlik sof tushum (sotuv minus qaytarish). Och ustunlar — hali kelmagan kunlar.</p>
        ${repBars(d.series, planPerDay)}
      </section>

      <section class="rep-sec">
        <h2>Kim sotdi</h2>
        ${repHBars(sellers.filter(s => s.net > 0).map(s => ({ name: s.name, v: s.net })))}
        <div class="tbl"><table><thead><tr><th>Sotuvchi</th><th class="n">Sof tushum</th><th class="n">Chek</th><th class="n">O‘rtacha chek</th>${sellers.some(s => s.plan) ? '<th class="n">Reja</th><th class="n">Bajarilish</th>' : ''}<th class="n">Ochiq vazifa</th></tr></thead><tbody>
          ${sellers.map(s => `<tr><td>${esc(s.name)}</td><td class="n mono">${money(s.net)}</td><td class="n mono">${s.checks}</td>
            <td class="n mono">${s.checks ? money(Math.round(s.net / s.checks)) : '—'}</td>
            ${sellers.some(x => x.plan) ? `<td class="n mono">${s.plan ? money(s.plan) : '—'}</td><td class="n mono">${s.pct != null ? s.pct + '%' : '—'}</td>` : ''}
            <td class="n mono">${s.open_tasks ?? '—'}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Ma’lumot yo‘q</td></tr>'}
        </tbody></table></div>
      </section>

      <section class="rep-sec">
        <h2>Filiallar</h2>
        ${repHBars(branches.filter(b => b.net > 0).map(b => ({ name: b.name, v: b.net })))}
        <div class="tbl"><table><thead><tr><th>Filial</th><th class="n">Sof tushum</th><th class="n">Chek</th><th class="n">Kuniga</th><th class="n">Ish kuni</th><th class="n">Prognoz</th></tr></thead><tbody>
          ${branches.map(b => `<tr><td>${esc(b.name)}${b.kind === 'ombor' ? ' (ombor)' : ''}</td><td class="n mono">${money(b.net)}</td><td class="n mono">${b.checks}</td>
            <td class="n mono">${b.per_day != null ? money(b.per_day) : '—'}</td><td class="n mono">${b.work_days ?? '—'}</td><td class="n mono">${money(b.forecast)}</td></tr>`).join('')}
        </tbody></table></div>
      </section>

      <section class="rep-sec">
        <h2>Nimalar sotildi</h2>
        ${repHBars((d.products || []).slice(0, 10).map(p => ({ name: p.name, v: p.net })))}
        <div class="tbl"><table><thead><tr><th>Tovar</th><th>Toifa</th><th class="n">Sof tushum</th><th class="n">Dona</th><th class="n">Chek</th></tr></thead><tbody>
          ${(d.products || []).map(p => `<tr><td>${esc(p.name)}</td><td class="muted">${esc(p.category || '—')}</td><td class="n mono">${money(p.net)}</td><td class="n mono">${p.qty}</td><td class="n mono">${p.checks}</td></tr>`).join('')}
        </tbody></table></div>
      </section>

      <section class="rep-sec">
        <h2>Toifalar bo‘yicha</h2>
        ${repHBars((d.categories || []).map(x => ({ name: x.name, v: x.net })))}
      </section>

      ${d.conv && d.conv.convs != null ? `<section class="rep-sec">
        <h2>Mijozlar bilan muloqot</h2>
        <div class="rtiles">
          ${tile('Suhbatlar', String(d.conv.convs), 'shu davrda')}
          ${tile('Birinchi javob', d.conv.first_median_min != null ? d.conv.first_median_min + ' daq' : '—', 'mediana')}
          ${tile('Sotuvchi javobi', d.conv.first_human_median_min != null ? d.conv.first_human_median_min + ' daq' : '—', 'AI’siz, mediana')}
          ${tile('30+ daq javobsiz', String(d.conv.late30 ?? '—'), 'suhbat')}
          ${tile('AI yordam bergan', String(d.conv.ai_assisted ?? '—'), 'suhbat')}
          ${d.conv.conversion != null ? tile('Konversiya', d.conv.conversion + '%', `${d.conv.won ?? 0} ta sotuv${d.conv.lost != null ? ` · ${d.conv.lost} yo‘qotildi` : ''}`) : ''}
        </div>
      </section>` : ''}

      ${(d.insights || []).length ? `<section class="rep-sec">
        <h2>Tahlilchi xulosalari</h2>
        ${d.insights.map(i => `<div class="rep-ins"><h3>${esc(i.title)}</h3>
          <dl>${i.metric ? `<dt>Ko‘rsatkich</dt><dd>${esc(i.metric)}</dd>` : ''}
          ${i.cause ? `<dt>Ehtimoliy sabab</dt><dd>${i.hypothesis ? '(gipoteza) ' : ''}${esc(i.cause)}</dd>` : ''}
          <dt>Dalil</dt><dd>${esc(i.evidence || '')}</dd><dt>Tavsiya</dt><dd>${esc(i.advice || '')}</dd></dl></div>`).join('')}
      </section>` : ''}

      <footer class="rep-foot">Photobuy sotuv markazi · ${repMonthName(repPeriod)} · hisobot ${fmtDT(Date.now())} da tayyorlandi.
        Summalar BILLZ ma’lumotidan, sof tushum = sotuv − qaytarish.</footer>
    </div>`;
}
$('#reportPage').addEventListener('change', e => { if (e.target.id === 'repPer') { repPeriod = e.target.value; renderReport(); } });
$('#reportPage').addEventListener('click', e => { if (e.target.id === 'repPrint') window.print(); });

/* ---------- Buyurtmalar: karta/to'lov, dastavka, muammoli tovar, yakunlanganlar ----------
   Manba — AI boshliq qo'ygan topshiriqlar (assignments). Mijozga javob berish vazifalari bu yerda emas:
   ular «Vazifalar» bo'limida qoladi, bu bo'lim faqat buyurtma bilan bog'liq ishlar uchun. */
const ORD_TABS = [['tolov', 'Karta va to‘lov'], ['buyurtma', 'Dastavka'], ['shikoyat', 'Muammoli tovar'],
  ['rasm', 'Rasm so‘raganlar'], ['boshqa', 'Boshqa'], ['yakun', 'Yakunlangan']];
const ORD_ST = { queued: 'navbatda', offered: 'sotuvchi ko‘rishi kutilmoqda', accepted: 'sotuvchida', escalated: 'rahbarga o‘tdi', done: 'bajarildi' };
let ordTab = 'tolov';

async function renderOrders() {
  const r = await api(`/api/orders?tab=${ordTab}`);
  const tabs = ORD_TABS.map(([k, l]) => `<button type="button" role="tab" data-otab="${k}" aria-selected="${ordTab === k}">${l}${r.counts[k] ? ` (${r.counts[k]})` : ''}</button>`).join('');
  const done = ordTab === 'yakun';
  $('#ordersPage').innerHTML = `<div class="tabs" role="tablist">${tabs}</div>
    <div class="rows">${r.items.map(t => `
      <div class="row-item${done ? ' done' : ''}">
        <div class="t"><b>${esc(t.display_name || t.handle || 'Mijoz')}</b>
          <span class="pill">${t.channel === 'ig' ? 'Instagram' : t.channel === 'tg' ? 'Telegram' : esc(t.channel)}</span>
          ${t.urgent && !done ? '<span class="pill bad">shoshilinch</span>' : ''}
          ${t.heat ? `<span class="pill ${t.heat === 'issiq' ? 'bad' : t.heat === 'iliq' ? 'warn' : ''}">${esc(t.heat)}</span>` : ''}</div>
        <div>${esc(t.title || '')}${t.body ? `<br><span class="muted">${esc(t.body)}</span>` : ''}</div>
        <div class="row-actions muted">${esc(t.user_name || 'biriktirilmagan')} · ${ORD_ST[t.status] || esc(t.status)} · ${fmtDT(done ? t.done_at : t.created_at)}
          ${t.phone ? `<a class="btn sm ghost" href="${telHref(t.phone)}">${esc(t.phone)}</a>` : ''}
          <button class="btn sm" type="button" data-bchat="${t.conversation_id}">Suhbat</button>
          ${!done && isLead() ? `<button class="btn sm primary" type="button" data-odone="${t.id}">Bajarildi</button>` : ''}</div>
      </div>`).join('') || `<div class="row-item"><div class="muted">${done ? 'Oxirgi 7 kunda yakunlangan ish yo‘q.' : 'Bu bo‘limda hozircha ish yo‘q.'}</div></div>`}</div>`;
}
$('#ordersPage').addEventListener('click', async e => {
  const tb = e.target.closest('[data-otab]');
  if (tb) { ordTab = tb.dataset.otab; return renderOrders(); }
  const od = e.target.closest('[data-odone]');
  if (od) {
    if (!await api(`/api/assignments/${od.dataset.odone}`, { action: 'done' }).catch(fail)) return;
    toast('Bajarildi deb belgilandi');
    return renderOrders();
  }
  const bc = e.target.closest('[data-bchat]');
  if (bc) return chatPreview(Number(bc.dataset.bchat));
});

/* ---------- Bot: keshbek boti va reklama ---------- */
let adPhoto = null;   // yuklangan rasm (data URL), yuborilgandan keyin tozalanadi

async function renderBot() {
  const r = await api('/api/bot');
  const s = r.stats || {};
  const tile = (l, v, s2 = '') => `<div class="rtile"><span class="rt-l">${l}</span><b class="rt-v">${v}</b>${s2 ? `<span class="rt-s">${s2}</span>` : ''}</div>`;
  const St = { ok: 'ishlayapti', error: 'xato', off: 'o‘chiq' };
  $('#botPage').innerHTML = `
    <div class="panel"><div class="panel-head"><h2>Keshbek boti</h2>
      <span class="pill ${r.state === 'ok' ? 'ok' : 'warn'}">${St[r.state] || esc(r.state || '—')}</span>
      ${r.username ? `<a class="btn sm ghost" href="https://t.me/${esc(r.username)}" target="_blank" rel="noopener">t.me/${esc(r.username)}</a>` : ''}
      <span class="muted">${esc(r.detail || '')}</span></div>
      <p class="lead" style="font-size:13px;margin:0">Mijoz botga <b>Start</b> bosadi, tugma orqali telefon raqamini yuboradi — ismi va keshbek balansi ko‘rsatiladi. Bot boshqa hech narsa qilmaydi.
        Raqam faqat tugma orqali olinadi, shuning uchun birov boshqa odamning keshbegini ko‘ra olmaydi.</p>
      <div class="rtiles">
        ${tile('Obunachilar', String(s.jami || 0), 'botga Start bosganlar')}
        ${tile('Faol', String(s.faol || 0), 'bloklamaganlar — reklama shularga ketadi')}
        ${tile('Mijoz sifatida tanilgan', String(s.tanilgan || 0), 'raqami bazada topilgan')}
        ${tile('Bugun qo‘shilgan', String(s.bugun || 0), '')}
      </div></div>

    <div class="panel"><div class="panel-head"><h2>Reklama yuborish</h2>
      <span class="muted" id="adCount">Botga Start bosgan ${s.faol || 0} ta odamga yuboriladi</span></div>
      <form id="adForm" class="form-grid">
        <label class="field"><span>Keshbek summasi — dan (so‘m)</span><input name="cb_min" id="adCbMin" type="number" min="0" step="1000" placeholder="masalan 50 000" data-filter></label>
        <label class="field"><span>Keshbek summasi — gacha (so‘m)</span><input name="cb_max" id="adCbMax" type="number" min="0" step="1000" placeholder="bo‘sh — chegarasiz" data-filter></label>
        <label class="field" style="grid-column:1/-1;flex-direction:row;align-items:center;gap:8px"><input type="checkbox" name="known" id="adKnown" value="true" data-filter><span>Faqat raqami bazada topilgan (BILLZ mijozi) obunachilarga</span></label>
        <label class="field" style="grid-column:1/-1"><span>Matn</span>
          <textarea name="text" id="adText" rows="4" maxlength="900" placeholder="Reklama matni…"></textarea></label>
        <label class="field"><span>Havola (ixtiyoriy)</span><input name="link_url" type="url" placeholder="https://instagram.com/photobuy.uz"></label>
        <label class="field"><span>Tugma yozuvi</span><input name="link_text" maxlength="30" placeholder="Batafsil"></label>
        <label class="field" style="grid-column:1/-1"><span>Rasm (ixtiyoriy, 4 MB gacha)</span>
          <input type="file" id="adFile" accept="image/jpeg,image/png"></label>
        <div id="adPrev" style="grid-column:1/-1"></div>
      </form>
      <div class="row-actions">
        <button class="btn primary" type="button" id="adSend" ${r.busy || !(s.faol > 0) ? 'disabled' : ''}>Yuborish</button>
        <button class="btn ghost" type="button" id="adClear">Tozalash</button>
        ${r.busy ? '<span class="muted">Avvalgi reklama hali yuborilmoqda…</span>' : ''}
      </div>
      <p class="muted" style="font-size:12px;margin:0">Yuborilgandan keyin xabarni qaytarib bo‘lmaydi. Bloklagan odamlar ro‘yxatdan o‘zi chiqariladi.</p></div>

    ${(r.history || []).length ? `<div class="panel"><div class="panel-head"><h2>Yuborilgan reklamalar</h2></div>
      <div class="tbl"><table><thead><tr><th>Vaqt</th><th>Matn</th><th>Kimga</th><th class="n">Jami</th><th class="n">Yetdi</th><th class="n">Bloklagan</th><th class="n">Xato</th><th>Kim</th></tr></thead><tbody>
      ${r.history.map(b => `<tr><td class="muted">${fmtDT(b.created_at)}</td>
        <td>${b.photo ? '🖼 ' : ''}${esc(clipText(b.text || '', 60))}${b.link_url ? `<br><span class="muted">${esc(b.link_url)}</span>` : ''}</td>
        <td class="muted">${esc(b.who || 'hamma obunachi')}</td>
        <td class="n mono">${b.total}</td><td class="n mono">${b.sent}</td><td class="n mono">${b.blocked}</td><td class="n mono">${b.failed}</td>
        <td class="muted">${esc(b.created_by)}</td></tr>`).join('')}
      </tbody></table></div></div>` : ''}`;
  adSegment();
}
const clipText = (t, n) => t.length > n ? t.slice(0, n - 1) + '…' : t;

/* Filtr o‘zgarganda — nechta odamga ketishi darhol ko‘rinadi (yuborishdan oldin) */
const adFilter = () => {
  const d = Object.fromEntries(new FormData($('#adForm')).entries());
  return { cb_min: d.cb_min || null, cb_max: d.cb_max || null, known: d.known === 'true' };
};
let adSeg = null;
async function adSegment() {
  const f = adFilter();
  const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v).map(([k, v]) => [k, String(v)]));
  adSeg = await api(`/api/bot/segment?${q}`).catch(() => null);
  const el = $('#adCount'); if (!el || !adSeg) return;
  const sum = adSeg.cashback_sum ? ` · keshbek jami ${Math.round(adSeg.cashback_sum).toLocaleString('ru-RU')} so‘m` : '';
  el.textContent = `${adSeg.total} ta odamga yuboriladi — ${adSeg.who}${sum}`;
  const btn = $('#adSend'); if (btn) btn.disabled = !(adSeg.total > 0);
}
$('#botPage').addEventListener('input', e => { if (e.target.dataset.filter !== undefined) { clearTimeout(adSegment.t); adSegment.t = setTimeout(adSegment, 300); } });

$('#botPage').addEventListener('change', async e => {
  if (e.target.id !== 'adFile') return;
  const f = e.target.files?.[0];
  if (!f) { adPhoto = null; $('#adPrev').innerHTML = ''; return; }
  if (f.size > 4e6) { toast('Rasm 4 MB dan katta'); e.target.value = ''; return; }
  adPhoto = await new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(f); });
  $('#adPrev').innerHTML = `<img src="${adPhoto}" alt="Reklama rasmi" style="max-width:260px;border-radius:10px;border:1px solid var(--line)">`;
});

$('#botPage').addEventListener('click', async e => {
  if (e.target.id === 'adClear') { adPhoto = null; $('#adForm').reset(); $('#adPrev').innerHTML = ''; adSegment(); return; }
  if (e.target.id !== 'adSend') return;
  const d = Object.fromEntries(new FormData($('#adForm')).entries());
  const text = String(d.text || '').trim();
  if (!text && !adPhoto) return toast('Matn yoki rasm kerak');
  if (d.link_url && !/^https?:\/\//i.test(d.link_url)) return toast('Havola https:// bilan boshlansin');
  await adSegment();
  const n = adSeg?.total || 0;
  if (!n) return toast('Filtrga mos obunachi yo‘q');
  if (!confirm(`Reklama ${n} ta odamga yuborilsinmi? (${adSeg.who})\n\nYuborilgandan keyin qaytarib bo‘lmaydi.`)) return;
  e.target.disabled = true;
  const r = await api('/api/bot/reklama', { text, photo: adPhoto, link_url: d.link_url || null, link_text: d.link_text || null, filter: adFilter() }).catch(fail);
  e.target.disabled = false;
  if (!r) return;
  toast(`Yuborish boshlandi: ${r.total} ta odam`);
  adPhoto = null; $('#adForm').reset(); $('#adPrev').innerHTML = '';
  setTimeout(renderBot, 2000);
});

/* ---------- Ko'rinish: tizim / yorug' / qorong'i ----------
   Tanlov brauzerda saqlanadi (pb_theme) va sahifa chizilgunga qadar /theme.js qo'yadi. */
const THEMES = [['auto', 'Tizim bo‘yicha', 'tizim'], ['light', 'Yorug‘', 'quyosh'], ['dark', 'Qorong‘i', 'oy']];
const getTheme = () => { try { return localStorage.getItem('pb_theme') || 'auto'; } catch { return 'auto'; } };
function applyTheme(v) {
  try { localStorage.setItem('pb_theme', v); } catch {}
  if (v === 'light' || v === 'dark') document.documentElement.dataset.theme = v;
  else delete document.documentElement.dataset.theme;
  drawThemeBtn();
}
function drawThemeBtn() {
  const b = $('#btnTheme'); if (!b) return;
  const [v, label, icon] = THEMES.find(t => t[0] === getTheme()) || THEMES[0];
  b.innerHTML = svg(icon) + label;
  b.setAttribute('aria-label', `Ko‘rinish: ${label}. O‘zgartirish uchun bosing`);
}
$('#btnTheme')?.addEventListener('click', () => {
  const i = THEMES.findIndex(t => t[0] === getTheme());
  applyTheme(THEMES[(i + 1) % THEMES.length][0]);
});
drawThemeBtn();

const SCREENS = {
  suhbatlar: ['Suhbatlar', 'Telegram va Instagram — bitta navbat'],
  vazifalar: ['Vazifalar', 'Agentlar qo‘ygan ochiq ishlar'],
  buyurtmalar: ['Buyurtmalar', 'Karta, dastavka, muammoli tovar va yakunlanganlar'],
  qayta: ['Qayta sotuv', 'Kunlik ro‘yxat, kampaniyalar, qoidalar — Chaqnoq'],
  tahlil: ['Reja va tahlil', 'Reja, fakt, prognoz · filial va sotuvchilar — Obyektiv'],
  katalog: ['Bilim bazasi', 'Mahsulot kartalari — agent faqat shu yerdan gapiradi'],
  agent: ['AI agent', 'Kanal bo‘yicha yoqish, to‘xtatish va bosqichlar'],
  sotuvchilar: ['Sotuvchilar', 'AI boshliq: topshiriqlar, tezlik, rag‘bat va ogohlantirish'],
  keshbek: ['Keshbek', 'BILLZ balansi bor mijozlar — qayta xaridga chaqirish uchun'],
  hisobot: ['Hisobot', 'Oylik to‘liq tahlil — chop etish va PDF uchun'],
  bot: ['Bot va reklama', 'Keshbek boti va unga Start bosganlarga reklama'],
  sozlama: ['Sozlamalar', 'Rahbar sozlaydi · har bir o‘zgarish yoziladi'],
  xodimlar: ['Xodimlar va filiallar', 'Rollar, Telegram bildirishnomalari'],
  jurnal: ['Audit jurnali', 'Har bir avtomatik amal']
};
function route() { const h = (location.hash || '#suhbatlar').slice(1); return h.startsWith('suhbat/') ? 'suhbatlar' : (SCREENS[h] ? h : 'suhbatlar'); }
async function onRoute() {
  let k = route();
  if (['agent', 'sotuvchilar', 'keshbek', 'hisobot', 'bot', 'sozlama', 'xodimlar'].includes(k) && !isLead()) { location.hash = '#suhbatlar'; return; }
  $$('.screen').forEach(s => s.hidden = s.id !== 's-' + k);
  $$('.nav-item').forEach(a => a.getAttribute('href') === '#' + k ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current'));
  $('#scrTitle').textContent = SCREENS[k][0]; $('#scrSub').textContent = SCREENS[k][1];
  try {
    if (k === 'suhbatlar') {
      await loadList();
      const m = location.hash.match(/^#suhbat\/(\d+)/);
      if (m) await openConv(Number(m[1]));
      else if (!S.sel && window.matchMedia('(min-width:821px)').matches && S.list[0]) await openConv(S.list[0].id);
      else if (!m) $('#inbox').classList.remove('open-thread');
    }
    if (k === 'vazifalar') await renderTasks();
    if (k === 'buyurtmalar') await renderOrders();
    if (k === 'qayta') await renderResale();
    if (k === 'tahlil') await renderAnalytics();
    if (k === 'katalog') await renderCatalog();
    if (k === 'agent') await renderAgent();
    if (k === 'sotuvchilar') await renderSellers();
    if (k === 'keshbek') await renderCashback();
    if (k === 'hisobot') await renderReport();
    if (k === 'bot') await renderBot();
    if (k === 'sozlama') await renderSettings();
    if (k === 'xodimlar') await renderUsers();
    if (k === 'jurnal') await renderAudit();
  } catch (e) { if (e.message !== 'unauthorized') fail(e); }
}
window.addEventListener('hashchange', onRoute);

$('#btnTg').addEventListener('click', async () => {
  const r = await api(`/api/users/${S.boot.me.id}/tglink`, {}).catch(fail); if (!r) return;
  modal(`<h2>Telegram bildirishnomalari</h2>${S.boot.me.tg_linked ? '<div class="banner ai">Telegram allaqachon ulangan. Qayta ulasangiz, yangi chat ishlatiladi.</div>' : ''}
    ${r.link ? `<p class="lead" style="font-size:13.5px">Havolani telefoningizda oching va <b>Start</b> bosing (1 soat amal qiladi):</p><a class="pw-box" style="font-size:13px;display:block;word-break:break-all" href="${esc(r.link)}" target="_blank" rel="noopener">${esc(r.link)}</a>`
      : '<div class="banner warn">Bot hali ulanmagan — administrator bot tokenini kiritishi kerak.</div>'}`, null);
});
$('#btnLogout').addEventListener('click', async () => { await api('/api/logout', {}); location.href = '/login'; });
/* Telefonda chap ustun yashirinadi — shu tugmalar «Men» oynasida bo‘ladi */
$('#btnMe').addEventListener('click', () => {
  const me = S.boot.me;
  modal(`<h2>${esc(me.name)}</h2><p class="lead" style="font-size:13.5px">${ROLE[me.role]}${me.tg_linked ? ' · Telegram ulangan' : ' · Telegram ulanmagan'}</p>
    <button class="btn install-btn install-rail" type="button" data-me="app" data-install>${svg('download')}Ilovani yuklab olish</button>
    <div class="row-actions"><button class="btn" type="button" data-me="tg">Telegram ulash</button><button class="btn" type="button" data-me="pw">Parol</button>
      <a class="btn ghost" href="/yoriqnoma">Yo‘riqnoma</a><button class="btn ghost" type="button" data-me="out">Chiqish</button></div>`, null);
});
$('#modalRoot').addEventListener('click', e => {
  const b = e.target.closest('[data-me]'); if (!b) return;
  $('#modalRoot').innerHTML = '';
  if (b.dataset.me === 'tg') $('#btnTg').click();
  if (b.dataset.me === 'pw') $('#btnPw').click();
  if (b.dataset.me === 'out') $('#btnLogout').click();
});
$('#btnPw').addEventListener('click', () => modal(`<h2>Parolni o‘zgartirish</h2><label class="field"><span>Joriy parol</span><input type="password" name="current" id="pw_cur" autocomplete="current-password" required></label>
  <label class="field"><span>Yangi parol (kamida 8 belgi)</span><input type="password" name="password" id="pw_new" autocomplete="new-password" minlength="8" required></label>`,
  async d => { await api('/api/me/password', { current: d.current, password: d.password }); toast('Parol o‘zgardi'); }));

/* ---------- ishga tushish ---------- */
paintIcons();
await loadBoot();
await onRoute();
api('/api/tasks').then(r => { $('#badgeTasks').hidden = !r.items.length; $('#badgeTasks').textContent = r.items.length; }).catch(() => {});
