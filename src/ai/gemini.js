import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { budgetStop } from '../services/ai-usage.js';
import { AiError } from './errors.js';

/*
  Gemini (Google) — to‘g‘ridan-to‘g‘ri HTTP, tashqi paketsiz (loyiha qarori).
  Kalit ikki xil bo‘ladi: AI Studio (AIza…, yangilari AQ.…) → generativelanguage.googleapis.com,
  Vertex AI express (AQ.…) → aiplatform.googleapis.com. Qaysi biri ishlashi sozlashda sinab aniqlanadi
  (scripts/gemini-sozla.js → GEMINI_ENDPOINT, GEMINI_MODEL) — prefiksga qarab taxmin qilinmaydi.
  Kalit URL’ga emas, x-goog-api-key sarlavhasiga yoziladi: jurnal va xatolarda ko‘rinmaydi.
  Gemini 3: funksiya chaqiruvidan keyin modelning javobi (thoughtSignature bilan) O‘ZGARISHSIZ qaytarilishi shart —
  shuning uchun candidate.content butunicha tarixga qo‘shiladi.
  Matn, rasm va ovozni bitta modelning o‘zi tushunadi (ovoz — transcribeAudio).
*/
const HOSTS = {
  ai: m => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`,
  vertex: m => `https://aiplatform.googleapis.com/v1/publishers/google/models/${m}:generateContent`
};
export const geminiUrl = (endpoint, model) => (HOSTS[endpoint] || HOSTS.ai)(encodeURIComponent(model));
const sleep = ms => new Promise(r => setTimeout(r, ms));

/*
  Tezlik chegarasi. Bepul tarifda Google modelga daqiqasiga bir necha so‘rov beradi (2026-09-28: gemini-3.6-flash — 5 ta).
  So‘rovlar navbat bilan yuboriladi; 429 kelsa javobdagi QuotaFailure’dan daqiqalik limit o‘rganiladi va RetryInfo’dagi
  vaqtcha kutib qayta uriniladi. Kunlik limit tugasa (…PerDay) — kutilmaydi, quota_day xatosi (billing ulash kerak).
  GEMINI_RPM — oldindan ma’lum limit (0 = noma’lum; pullik tarifda limit katta, navbat deyarli sezilmaydi).
*/
const limits = new Map(), stamps = new Map();
if (Number(process.env.GEMINI_RPM) > 0) limits.set('*', Number(process.env.GEMINI_RPM));
let gate = Promise.resolve();
function acquire(model) {
  const p = gate.then(async () => {
    const lim = limits.get(model) || limits.get('*');
    if (!lim) return;
    const recent = () => (stamps.get(model) || []).filter(t => Date.now() - t < 60000);
    let arr = recent();
    if (arr.length >= lim) { await sleep(60000 - (Date.now() - arr[0]) + 300); arr = recent(); }
    arr.push(Date.now()); stamps.set(model, arr);
  });
  gate = p.catch(() => {});
  return p;
}
/* 429 javobidan: daqiqalikmi yoki kunlik, limit qiymati va kutish vaqti */
export function quotaInfo(text) {
  let j; try { j = JSON.parse(text); } catch { return {}; }
  const det = j?.error?.details || [];
  const v = det.find(d => String(d['@type']).endsWith('QuotaFailure'))?.violations || [];
  const perDay = v.some(x => /PerDay/i.test(x.quotaId || ''));
  const perMin = v.find(x => /PerMinute/i.test(x.quotaId || ''));
  const delay = det.find(d => String(d['@type']).endsWith('RetryInfo'))?.retryDelay;
  const free = v.some(x => /FreeTier|free_tier/i.test(`${x.quotaId} ${x.quotaMetric}`));
  return { perDay, perMinLimit: perMin ? Number(perMin.quotaValue) || null : null, waitMs: delay ? Math.ceil(parseFloat(delay) * 1000) : null, free };
}
const noThinking = new Set();   // thinkingConfig’ni umuman qabul qilmaydigan modellar — faqat o‘zlariga yuborilmaydi
const thinkLevel = new Map();   // model -> «minimal» o‘rniga qabul qilgan daraja («low»): fikrlash butunlay o‘chmasin (o‘chsa — model o‘zi ko‘p fikrlaydi, qimmat)
const withThinking = (body, model) => {
  const tc = body.generationConfig?.thinkingConfig;
  if (!tc) return body;
  if (noThinking.has(model)) return { ...body, generationConfig: { ...body.generationConfig, thinkingConfig: undefined } };
  const lvl = thinkLevel.get(model);
  return lvl && lvl !== tc.thinkingLevel ? { ...body, generationConfig: { ...body.generationConfig, thinkingConfig: { ...tc, thinkingLevel: lvl } } } : body;
};

export async function geminiPost(body, { endpoint = config.geminiEndpoint, model = config.geminiModel, key = config.geminiKey, timeoutMs = 120000, retries = 5, maxWaitMs = 150000 } = {}) {
  if (!key) throw new AiError('no_ai_key');
  // Kunlik/oylik chegara: oshgan bo‘lsa so‘rov umuman yuborilmaydi — kutilmagan hisob chiqmasin
  const stop = budgetStop();
  if (stop) throw new AiError(`budget_${stop.why}`, stop.why === 'balance'
    ? `AI to‘xtatildi: balansda $${stop.spent.toFixed(2)} qoldi (zaxira $${stop.limit})`
    : `AI chegarasi: $${stop.spent.toFixed(2)} / $${stop.limit}`);
  let lastErr, waited = 0;
  for (let attempt = 0; attempt < retries; attempt++) {
    await acquire(model);
    const send = withThinking(body, model);
    let res;
    try {
      res = await fetch(geminiUrl(endpoint, model), {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(send), signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (e) { lastErr = new AiError('network', String(e.message || e)); await sleep(1500 * (attempt + 1)); continue; }
    if (res.ok) {
      const j = await res.json();
      // Sarflangan tokenlar yozib boriladi — panelda ko‘rinadi (Google qolgan balansni API orqali bermaydi)
      import('../services/ai-usage.js').then(m => m.recordUsage(model, j?.usageMetadata)).catch(() => {});
      return j;
    }
    const text = await res.text().catch(() => '');
    if (res.status === 429) {
      const q = quotaInfo(text);
      if (q.perDay) throw new AiError('quota_day', text.slice(0, 300));
      if (q.perMinLimit) limits.set(model, Math.max(1, q.perMinLimit - 1));   // bitta zaxira
      const wait = Math.min(q.waitMs ?? 5000 * (attempt + 1), 65000) + 500;
      lastErr = new AiError(q.free ? 'quota_free' : 'http_429', text.slice(0, 300));
      if (waited + wait > maxWaitMs) break;
      waited += wait; await sleep(wait);
      continue;
    }
    // Fikrlash darajasi qabul qilinmasa: avval «minimal» → «low» (arzon qoladi), «low» ham o‘tmasa — shu modelga fikrlashsiz
    if (res.status === 400 && !noThinking.has(model) && send.generationConfig?.thinkingConfig && /thinking/i.test(text)) {
      if (send.generationConfig.thinkingConfig.thinkingLevel === 'minimal') thinkLevel.set(model, 'low'); else noThinking.add(model);
      attempt--; continue;
    }
    if (res.status >= 500) { lastErr = new AiError(`http_${res.status}`, text.slice(0, 300)); await sleep(2000 * (attempt + 1)); continue; }
    // 402 — balans tugadi: panelda qizil holat va «to‘ldirish» tugmasi chiqadi
    if (res.status === 402) import('../services/ai-usage.js').then(m => m.creditsOut(text)).catch(() => {});
    throw new AiError(`http_${res.status}`, text.slice(0, 500));
  }
  throw lastErr;
}
/* Fikrlash darajasi: «minimal» — fikrlash tokenlari chiquvchi narxda ($3.75/1M) hisoblanadi va kunlik chiquvchi sarfning ~yarmi edi.
   Sotuv javobi uchun yetarli (vositalar + ko‘rsatma yo‘naltiradi); sifat tushsa GEMINI_THINKING=low bilan qaytariladi. */
/* «low» — 2026-10-09 sinovi (16 real suhbat): 3.1 Flash-Lite «minimal» da narxni tashlab ketar, ichki izoh yozardi («rasm biriktirmasdan
   javob berdim»); «low» da bu yo‘qoldi, narx +50% ($0.0008 → $0.0012 javobga). 3.8 Flash «minimal» ni umuman qabul qilmaydi. */
const THINKING = process.env.GEMINI_THINKING || 'low';
/* Model bo‘yicha: «minimal» ni faqat lite modellar qabul qiladi — boshqasiga «low» (ortiqcha xato so‘rov ketmasin) */
const thinkingFor = model => (THINKING === 'minimal' && model && !/lite/.test(model) ? 'low' : THINKING);

/*
  Modellar zanjiri. Har modelning limiti alohida (bepul tarifda 2026-09-28: gemini-3.6-flash — kuniga 20, daqiqasiga 5 so‘rov),
  ayrimlari yuklama paytida 503 beradi. Asosiy model limitga yetsa yoki band bo‘lsa — zanjirdagi keyingisi, u bir muddat chetlanadi.
  Zanjirning oxirgisidan boshqalarida uzoq kutilmaydi (darhol keyingisiga). Model faqat birinchi so‘rovda tanlanadi:
  funksiya siklining o‘rtasida model almashtirilmaydi (thoughtSignature o‘sha modelniki).
*/
const DEFAULT_CHAIN = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview'];
const COOLDOWN = { quota_day: 60 * 60e3, quota_free: 60e3, http_429: 60e3, http_503: 3 * 60e3, http_500: 60e3, http_502: 60e3, http_504: 60e3, http_404: 24 * 3600e3, network: 30e3 };
const cooling = new Map();
export function modelChain() {
  const list = [config.geminiModel, ...(config.geminiFallbacks.length ? config.geminiFallbacks : DEFAULT_CHAIN)].filter((m, i, a) => m && a.indexOf(m) === i);
  const up = list.filter(m => (cooling.get(m) || 0) < Date.now());
  return up.length ? up : list.slice(0, 1);
}
export const resetModelCooling = () => cooling.clear();
/* So‘rov uchun zanjir: «prefer» berilsa (aralash rejimda kuchli model) — u birinchi, qolganlari zaxira */
const chainFor = prefer => {
  const base = modelChain();
  return prefer && (cooling.get(prefer) || 0) < Date.now() ? [prefer, ...base.filter(m => m !== prefer)] : base;
};
async function firstWorking(send, chain = modelChain()) {
  let last;
  for (let i = 0; i < chain.length; i++) {
    const m = chain[i], lastOne = i === chain.length - 1;
    try { return { model: m, res: await send(m, lastOne ? {} : { retries: 1, maxWaitMs: 0 }) }; }
    catch (e) {
      if (!(e.code in COOLDOWN)) throw e;
      cooling.set(m, Date.now() + COOLDOWN[e.code]);
      last = e;
    }
  }
  throw last;
}

/* Claude uslubidagi JSON Schema → Gemini qabul qiladigan kichik to‘plam (additionalProperties, pattern, format — yo‘q) */
const KEEP = new Set(['type', 'description', 'enum', 'required', 'minimum', 'maximum', 'minItems', 'maxItems', 'nullable']);
export function toGeminiSchema(s) {
  if (!s || typeof s !== 'object') return s;
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === 'properties') out.properties = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toGeminiSchema(pv)]));
    else if (k === 'items') out.items = toGeminiSchema(v);
    else if (KEEP.has(k)) out[k] = v;
  }
  if (s.pattern) out.description = `${s.description ? s.description + ' — ' : ''}format: ${s.pattern}`;
  return out;
}
const declare = t => ({ name: t.name, description: t.description,
  ...(Object.keys(t.input_schema?.properties || {}).length ? { parameters: toGeminiSchema(t.input_schema) } : {}) });
/* Claude server vositalari → Gemini ichki vositalari */
const BUILT_IN = { web_search: { googleSearch: {} }, web_fetch: { urlContext: {} } };
const BLOCKED = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'RECITATION', 'IMAGE_SAFETY']);
const textOf = parts => parts.filter(p => typeof p.text === 'string' && !p.thought).map(p => p.text).join('').trim();

/*
  claude.runAgent bilan bir xil shartnoma: handlers — { toolName: async (input) => natija }, attachments — [{ mime, data(base64) }].
  Qaytaradi: { text, stop, model, toolLog, usage }
*/

/* ---------- Kontekst keshlash ----------
   Har so'rovda bir xil ko'rsatma va vositalar ta'rifi qayta yuboriladi (~6 200 token).
   Google ularni keshda saqlaydi va keyingi so'rovlarda 10 barobar arzon o'qiydi ($0.075 vs $0.75 / 1 mln).
   Kesh model + ko'rsatma + vositalar bo'yicha kalitlanadi va bir soat yashaydi.
   Xato bo'lsa kesh ishlatilmaydi va so'rov odatdagidek ketadi — suhbat hech qachon to'xtamaydi. */
const CACHE_TTL_S = Number(process.env.GEMINI_CACHE_TTL || 3600);
const CACHE_MIN_CHARS = 8000;              // kichik ko'rsatmani keshlash foyda bermaydi
const caches = new Map();                  // kalit -> { name, until }
const cacheOff = new Map();                // model -> qachongacha urinmaymiz
export const cacheStats = () => ({ live: caches.size, off: cacheOff.size });

async function getCache(model, system, allTools) {
  if (config.geminiEndpoint === 'vertex') return null;          // faqat AI Studio uchun
  if (!system || system.length < CACHE_MIN_CHARS) return null;
  if ((cacheOff.get(model) || 0) > Date.now()) return null;
  const key = model + '|' + createHash('sha1').update(system + JSON.stringify(allTools)).digest('hex');
  const hit = caches.get(key);
  if (hit && hit.until > Date.now() + 120000) return hit.name;  // tugashiga 2 daqiqa qolsa — yangisi
  try {
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/cachedContents', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': config.geminiKey },
      body: JSON.stringify({
        model: 'models/' + model,
        systemInstruction: { parts: [{ text: system }] },
        ...(allTools.length ? { tools: allTools } : {}),
        ttl: CACHE_TTL_S + 's'
      }), signal: AbortSignal.timeout(30000)
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.name) throw new Error(j?.error?.message || `HTTP ${res.status}`);
    caches.set(key, { name: j.name, until: Date.now() + CACHE_TTL_S * 1000 });
    // Kesh saqlash puli (soatiga) panel hisobiga yoziladi; Google token sonini qaytarmasa — taxminan (4 belgi ≈ 1 token)
    const tok = Number(j.usageMetadata?.totalTokenCount) || Math.ceil((system.length + JSON.stringify(allTools).length) / 4);
    import('../services/ai-usage.js').then(m => m.recordCacheStorage(model, tok, CACHE_TTL_S)).catch(() => {});
    return j.name;
  } catch (e) {
    cacheOff.set(model, Date.now() + 10 * 60e3);                // 10 daqiqa qayta urinmaymiz
    console.error('[gemini] kesh yaratilmadi:', String(e.message || e).slice(0, 120));
    return null;
  }
}

/* finalTool — shu vosita majburan chaqiriladi (mode ANY) va chaqirilgach sikl to‘xtaydi: tuzilgan natija kerak bo‘lganda ikkinchi (bekor) so‘rov ketmaydi */
export async function runAgent({ system, userContent, attachments = [], tools = [], serverTools = [], handlers = {}, maxTurns = 8, maxTokens = 8000, model: prefer = null, finalTool = null }) {
  const chain = chainFor(prefer);
  const contents = [{ role: 'user', parts: [{ text: String(userContent) }, ...attachments.map(a => ({ inlineData: { mimeType: a.mime, data: a.data } }))] }];
  const fnTools = tools.length ? [{ functionDeclarations: tools.map(declare) }] : [];
  let builtIn = [...new Set(serverTools.map(t => t.name))].map(n => BUILT_IN[n]).filter(Boolean);
  const toolLog = [], usage = { input: 0, output: 0, cache_read: 0 };
  let model = null;
  for (let turn = 0; turn <= maxTurns; turn++) {
    const allTools = [...fnTools, ...builtIn];
    // Oxirgi qadam: vositalar o‘chiriladi — model yig‘ilgan ma’lumot bilan javobni yozishga majbur (javobsiz qolmaydi)
    const lastTurn = turn === maxTurns - 1 && fnTools.length;
    // Yakun: Gemini ba’zan NONE’ga qaramay vosita chaqiradi (ko‘p qadamli suhbatda ko‘rildi) — unda vositalar umuman yuborilmaydi
    const closing = turn === maxTurns;
    // Keshdan foydalanamiz: ko'rsatma va vositalar qayta yuborilmaydi. Birinchi qadamda ham — zanjirdagi birinchi ishlaydigan
    // model uchun (ilgari 1-qadam har doim keshsiz ketardi: kunlik sarfning ~25%). Oxirgi qadamda vositalar o'chiriladi,
    // shuning uchun u yerda kesh ishlatilmaydi (kesh ichida vositalar bor).
    const cacheModel = model || chain[0];
    const cached = !lastTurn && !closing ? await getCache(cacheModel, system, allTools) : null;
    const lvl = thinkingFor(model || chain[0]);
    const gen = { maxOutputTokens: maxTokens, ...(lvl !== 'off' ? { thinkingConfig: { thinkingLevel: lvl } } : {}) };
    const toolConfig = lastTurn ? { functionCallingConfig: { mode: 'NONE' } }
      : finalTool && !closing && fnTools.length ? { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [finalTool] } } : null;
    const plain = {
      systemInstruction: { parts: [{ text: system }] }, contents,
      ...(allTools.length && !closing ? { tools: allTools } : {}),
      ...(toolConfig ? { toolConfig } : {}),
      generationConfig: gen
    };
    const body = cached ? { cachedContent: cached, contents, ...(toolConfig ? { toolConfig } : {}), generationConfig: gen } : plain;
    let res;
    try {
      if (model) res = await geminiPost(body, { model });
      else {
        // Kesh faqat o'z modeliga tegishli: u model band bo'lsa (limit, 503) — zanjir keshsiz davom etadi
        if (cached) {
          try { res = await geminiPost(body, { model: cacheModel, retries: 1, maxWaitMs: 0 }); model = cacheModel; }
          catch (e) { if (!(e.code in COOLDOWN)) throw e; cooling.set(cacheModel, Date.now() + COOLDOWN[e.code]); }
        }
        if (!model) {
          // Kesh bilan urinilgan model band bo‘lsa — u qayta so‘ralmaydi (zanjir bo‘shab qolsa — butun zanjir)
          const rest = cached ? chain.filter(m => m !== cacheModel) : chain;
          ({ model, res } = await firstWorking((m, o) => geminiPost(plain, { model: m, ...o }), rest.length ? rest : chain));
        }
      }
    } catch (e) {
      // Kesh bilan xato: keshni tashlab, oddiy yo'l bilan qayta urinamiz (javob to'xtab qolmasin)
      if (cached && (e.code === 'http_400' || e.code === 'http_404')) {
        for (const [k, v] of caches) if (v.name === cached) caches.delete(k);
        cacheOff.set(cacheModel, Date.now() + 10 * 60e3);
        console.error('[gemini] kesh ishlamadi, keshsiz davom etamiz:', String(e.message || e).slice(0, 120));
        turn--; continue;
      }
      // Ayrim modellarda Google qidiruvi funksiyalar bilan birga ishlamaydi — qidiruvsiz davom etadi
      if (e.code === 'http_400' && builtIn.length && fnTools.length) { builtIn = []; turn--; continue; }
      throw e;
    }
    const u = res.usageMetadata || {};
    usage.input += u.promptTokenCount || 0; usage.output += (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0); usage.cache_read += u.cachedContentTokenCount || 0;
    if (res.promptFeedback?.blockReason) throw new AiError('refusal', res.promptFeedback.blockReason);
    const cand = res.candidates?.[0];
    if (!cand) throw new AiError('empty');
    if (BLOCKED.has(cand.finishReason)) throw new AiError('refusal', cand.finishReason);
    const parts = cand.content?.parts || [];
    const calls = parts.filter(p => p.functionCall);
    if (!calls.length) {
      if (cand.finishReason === 'MAX_TOKENS') throw new AiError('max_tokens');
      return { text: textOf(parts), stop: cand.finishReason || 'STOP', model: res.modelVersion || model, toolLog, usage };
    }
    contents.push(cand.content);
    const responses = await Promise.all(calls.map(async ({ functionCall: c }) => {
      const h = handlers[c.name], t0 = Date.now();
      let out, isError = false;
      try {
        if (!h) throw new Error(`Noma’lum vosita: ${c.name}`);
        out = await h(c.args || {});
      } catch (e) { out = { error: String(e.message || e) }; isError = true; }
      toolLog.push({ name: c.name, input: c.args, error: isError || undefined, turn, ms: Date.now() - t0 });
      const response = out && typeof out === 'object' && !Array.isArray(out) ? out : { result: out };
      return { functionResponse: { ...(c.id ? { id: c.id } : {}), name: c.name, response } };
    }));
    // Yakuniy vosita chaqirildi — natija qo‘lda, modelga qaytib so‘rov yuborilmaydi
    if (finalTool && calls.some(c => c.functionCall.name === finalTool)) return { text: textOf(parts), stop: 'tool', model: res.modelVersion || model, toolLog, usage };
    // Yakunda ham chaqirsa: vositalar bajarildi (karta yangilanishi yo‘qolmasin), matn bo‘lsa — javob shu
    if (closing) { const text = textOf(parts); if (text.trim()) return { text, stop: cand.finishReason || 'STOP', model: res.modelVersion || model, toolLog, usage }; break; }
    contents.push({ role: 'user', parts: responses });
  }
  throw new AiError('too_many_turns', toolLog.map(t => `${t.turn}:${t.name}:${t.ms}ms`).join(' '));
}

/* Ovozli xabar → matn. Gemini ovozni o‘zi tinglaydi (o‘zbek va rus aralash nutqni ham) */
const TRANSCRIBE = `Siz transkripsiya qiluvchisiz. Ovozda aytilgan so‘zlarni aynan, qanday aytilgan bo‘lsa shunday yozing:
o‘zbekcha — lotin yozuvida, ruscha — kirill yozuvida, aralash bo‘lsa — aralash. Tarjima qilmang, tuzatmang, izoh qo‘shmang, savolga javob bermang.
Faqat aytilgan matnni qaytaring. Nutq bo‘lmasa yoki umuman tushunib bo‘lmasa — bo‘sh javob qaytaring.`;
export async function transcribeAudio(buf, mime = 'audio/ogg') {
  const body = {
    systemInstruction: { parts: [{ text: TRANSCRIBE }] },
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mime, data: Buffer.from(buf).toString('base64') } }, { text: 'Shu ovozli xabarni matnga aylantiring.' }] }],
    generationConfig: { maxOutputTokens: 2048, thinkingConfig: { thinkingLevel: 'minimal' } }
  };
  const { res: r } = await firstWorking((m, o) => geminiPost(body, { model: m, timeoutMs: 90000, retries: 4, maxWaitMs: 70000, ...o }));
  if (r.promptFeedback?.blockReason) throw new AiError('refusal', r.promptFeedback.blockReason);
  return textOf(r.candidates?.[0]?.content?.parts || []);
}

/* Kalitni tekshirish va sozlash: qaysi xizmat (AI Studio yoki Vertex express) va qaysi model ishlashi SINAB aniqlanadi.
   AI Studio’da ro‘yxatdan eng yangi barqaror «gemini-X.Y-flash» (lite/tts/image/live emas); Vertex’da — ma’lum nomlar.
   Qaytaradi: { ok, endpoint, model, log } yoki { ok: false, why, log }. Kalit hech qayerga yozilmaydi. */
const FALLBACK_MODELS = ['gemini-3.5-flash', 'gemini-3-flash', 'gemini-2.5-flash', 'gemini-3-flash-preview'];
let liteCache = [];
const liteNames = () => liteCache;
export async function detectGemini(key, { wanted = null } = {}) {
  const log = [];
  const probe = async (endpoint, model) => {
    try {
      const res = await fetch(geminiUrl(endpoint, model), {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'Bitta so‘z bilan javob bering: tayyor' }] }], generationConfig: { maxOutputTokens: 32 } }),
        signal: AbortSignal.timeout(30000)
      });
      if (res.ok) return { ok: true };
      const t = await res.text().catch(() => '');
      return { ok: false, status: res.status, why: (t.match(/"message":\s*"([^"]{0,160})/) || [])[1] || '' };
    } catch (e) { return { ok: false, status: 0, why: String(e.message || e) } }
  };
  const score = n => {
    const m = n.match(/^gemini-(\d+(?:\.\d+)?)-flash(-latest|-preview[\w.-]*|-\d{3})?$/);
    return m ? Number(m[1]) * 10 - (m[2] && m[2].startsWith('-preview') ? 5 : 0) : -1;
  };
  const tries = [];
  let listed = [];
  const lr = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(30000) }).catch(() => null);
  if (lr?.ok) {
    const all = ((await lr.json()).models || []).filter(m => (m.supportedGenerationMethods || []).includes('generateContent')).map(m => m.name.replace(/^models\//, ''));
    const names = all.filter(n => score(n) >= 0).sort((a, b) => score(b) - score(a));
    liteCache = all.filter(n => /^gemini-[\d.]+-flash-lite$/.test(n)).sort((a, b) => parseFloat(b.slice(7)) - parseFloat(a.slice(7)));
    log.push(`Google AI Studio kalitni qabul qildi (${names.length} ta mos model)`);
    listed = names;
    for (const m of new Set([wanted, ...names.slice(0, 4), ...FALLBACK_MODELS].filter(Boolean))) tries.push(['ai', m]);
  } else log.push(`Google AI Studio: HTTP ${lr?.status || 0} — Vertex AI express sinab ko‘riladi`);
  for (const m of new Set([wanted, ...FALLBACK_MODELS].filter(Boolean))) tries.push(['vertex', m]);
  let lastWhy = '';
  for (const [endpoint, model] of tries) {
    const r = await probe(endpoint, model);
    if (r.ok) {
      log.push(`Ishladi: ${model} (${endpoint === 'vertex' ? 'Vertex AI express' : 'Google AI Studio'})`);
      // Zaxira: ro‘yxatdagi boshqa flash va flash-lite modellar (yangisi oldin), aks holda ma’lum nomlar
      const lite = endpoint === 'ai' ? liteNames(listed) : [];
      const fallbacks = [...new Set([...(endpoint === 'ai' ? listed : FALLBACK_MODELS), ...lite])].filter(m => m !== model).slice(0, 6);
      return { ok: true, endpoint, model, fallbacks, log };
    }
    lastWhy = `${endpoint === 'vertex' ? 'Vertex AI' : 'AI Studio'} ${model}: HTTP ${r.status} ${r.why}`.trim();
  }
  log.push(lastWhy);
  return { ok: false, why: `Kalit ishlamadi. ${lastWhy}. Kalit to‘liq nusxalanganini, Google loyihasida Gemini API (yoki Vertex AI) yoqilganini va billing ulanganini tekshiring.`, log };
}
