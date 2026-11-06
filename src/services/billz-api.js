import { config } from '../config.js';

/*
  BILLZ 2.0 Public API mijozi — faqat O‘QISH. Manba: rasmiy hujjat https://docs.billz.io (OpenAPI 2026.08).
  - Kirish: POST /v1/auth/login {secret_token} → access_token (15 kun). Token faqat xotirada turadi, bazaga yozilmaydi.
  - 401 → qayta kirish va so‘rov bir marta takrorlanadi (refresh ishlatilmaydi: u platform-id va bir martalik token talab qiladi).
  - Chegara: soniyasiga 2 so‘rov → barcha so‘rovlar navbatda, orasida ≥ 600 ms; 429 → kutib qayta (1, 2, 4, 8 s).
  - Xato matnida kalit ham, token ham bo‘lmaydi.
*/

const GAP_MS = Number(process.env.BILLZ_GAP_MS ?? 600);
let token = null, tokenExp = 0, last = 0, queue = Promise.resolve();
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class BillzError extends Error {
  constructor(status, body, path) {
    const detail = body && typeof body === 'object' ? [body.message, typeof body.error === 'string' ? body.error : body.error?.message].filter(Boolean).join(' / ') : '';
    super(`BILLZ ${path}: HTTP ${status}${detail ? ' — ' + detail : ''}`);
    this.status = status;
  }
}

/* Barcha so‘rovlar bitta navbatda — chegaradan oshmaslik uchun */
function enqueue(fn) {
  const p = queue.then(async () => { const w = last + GAP_MS - Date.now(); if (w > 0) await sleep(w); try { return await fn(); } finally { last = Date.now(); } });
  queue = p.catch(() => {});
  return p;
}

async function raw(method, path, { query, body, auth = true } = {}) {
  const url = new URL(path, config.billzBase);
  for (const [k, v] of Object.entries(query || {})) if (v != null && v !== '') url.searchParams.set(k, String(v));
  for (let attempt = 0; ; attempt++) {
    const headers = { accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) };
    if (auth) headers.authorization = `Bearer ${token}`;
    let res;
    try { res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45000) }); }
    catch (e) { if (attempt < 2) { await sleep(2000 * (attempt + 1)); continue; } throw new BillzError(0, { message: e.name === 'TimeoutError' ? 'javob kelmadi (45 s)' : 'tarmoq xatosi' }, path); }
    const j = await res.json().catch(() => null);
    if (res.status === 429 && attempt < 4) { await sleep(1000 * 2 ** attempt); continue; }
    if (res.status >= 500 && attempt < 2) { await sleep(3000 * (attempt + 1)); continue; }
    if (!res.ok) throw new BillzError(res.status, j, path);
    return j;
  }
}

async function login() {
  if (!config.billzToken) throw new BillzError(0, { message: 'BILLZ kaliti kiritilmagan' }, '/v1/auth/login');
  const j = await raw('POST', '/v1/auth/login', { body: { secret_token: config.billzToken }, auth: false });
  const d = j?.data;
  if (!d?.access_token) throw new BillzError(200, { message: 'javobda access_token yo‘q' }, '/v1/auth/login');
  token = d.access_token;
  tokenExp = Date.now() + (Number(d.expires_in) || 86400) * 1000;
}

/* GET/POST — token avtomatik; muddati tugashiga 1 soat qolsa yoki 401 bo‘lsa qayta kiriladi */
export function billz(method, path, opts = {}) {
  return enqueue(async () => {
    if (!token || Date.now() > tokenExp - 3600e3) await login();
    try { return await raw(method, path, opts); }
    catch (e) {
      if (e.status !== 401) throw e;
      token = null; await login();
      return raw(method, path, opts);
    }
  });
}

/* Sahifalab o‘qish: hamma sahifa olinmaguncha natija qaytmaydi (to‘liq sinxron chala qolmasin) */
export async function billzAll(path, { query = {}, listKey, limit = 100, maxPages = 10000 } = {}) {
  const out = [];
  let count = null;
  for (let page = 1; page <= maxPages; page++) {
    const j = await billz('GET', path, { query: { ...query, page, limit } });
    const items = (listKey ? j?.[listKey] : null) ?? j?.data?.[listKey] ?? [];
    if (!Array.isArray(items)) throw new BillzError(200, { message: `javobda «${listKey}» ro‘yxati yo‘q` }, path);
    if (count == null) count = Number(j?.count ?? j?.data?.count ?? NaN);
    out.push(...items);
    if (items.length < limit || (Number.isFinite(count) && out.length >= count)) break;
  }
  return { items: out, count: Number.isFinite(count) ? count : out.length };
}

export const resetBillzAuth = () => { token = null; tokenExp = 0; };
