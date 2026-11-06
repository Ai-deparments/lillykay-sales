import { config } from '../config.js';

/*
  Claude Messages API — to‘g‘ridan-to‘g‘ri HTTP (loyiha qarori: tashqi paketlarsiz).
  - model: AI_MODEL (Photobuy: claude-sonnet-5), thinking: adaptive, effort: AI_EFFORT (default medium)
  - fallbacks: "default" — faqat Opus 5 / Fable 5.1 da (rad etilsa server boshqa modelda qayta ishlaydi)
  - stop_reason har doim content'dan oldin tekshiriladi (refusal / max_tokens)
*/
const URL_ = 'https://api.anthropic.com/v1/messages';
/* Server tomonidagi zaxira (fallbacks: "default") hujjatda Opus 5 va Fable 5.1 uchun tasdiqlangan — boshqa modellarda yuborilmaydi.
   Rad javobi (refusal) bo‘lsa qoralama yozilmaydi va javobni sotuvchi yozadi. */
const FALLBACK_MODELS = new Set(['claude-opus-5', 'claude-fable-5-1']);
const useFallback = () => FALLBACK_MODELS.has(config.aiModel);

import { AiError } from './errors.js';
export { AiError };

async function post(body, { timeoutMs = 120000 } = {}) {
  if (!config.aiKey) throw new AiError('no_ai_key');
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try {
      res = await fetch(URL_, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': config.aiKey,
          'anthropic-version': '2023-06-01',
          ...(useFallback() ? { 'anthropic-beta': 'server-side-fallback-2026-07-01' } : {})
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (e) { lastErr = new AiError('network', String(e.message || e)); await sleep(1500 * (attempt + 1)); continue; }
    if (res.ok) return res.json();
    const text = await res.text().catch(() => '');
    // 429 / 5xx / 529 — qayta urinish; 4xx — so‘rov xatosi, qayta urinilmaydi
    if (res.status === 429 || res.status >= 500) {
      lastErr = new AiError(`http_${res.status}`, text.slice(0, 300));
      const ra = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra, 20) * 1000 : 2000 * (attempt + 1));
      continue;
    }
    throw new AiError(`http_${res.status}`, text.slice(0, 500));
  }
  throw lastErr;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Mid-output fallback bo‘lsa, oxirgi `fallback` blokidan oldingi thinking/tool_use bloklari qaytarilmaydi */
function echoable(content) {
  const lastFb = content.map(b => b.type).lastIndexOf('fallback');
  if (lastFb < 0) return content;
  return content.filter((b, i) => i > lastFb || !['thinking', 'redacted_thinking', 'tool_use'].includes(b.type));
}

/*
  Tool loop: handlers — { toolName: async (input) => result(obj|string) }.
  Qaytaradi: { text, stop, model, toolLog, usage }
*/
/* finalTool — shu vosita majburan chaqiriladi (tool_choice) va chaqirilgach sikl to‘xtaydi: tuzilgan natija uchun ikkinchi so‘rov ketmaydi */
export async function runAgent({ system, userContent, attachments = [], tools = [], serverTools = [], handlers = {}, maxTurns = 8, maxTokens = 8000, effort = config.aiEffort, finalTool = null }) {
  // attachments: [{ mime, data(base64) }] — mijoz yuborgan rasmlar (Claude: image/jpeg, png, gif, webp)
  const imgs = attachments.filter(a => /^image\/(jpeg|png|gif|webp)$/.test(a.mime));
  const messages = [{ role: 'user', content: imgs.length
    ? [{ type: 'text', text: userContent }, ...imgs.map(a => ({ type: 'image', source: { type: 'base64', media_type: a.mime, data: a.data } }))]
    : userContent }];
  const toolLog = [];
  const usage = { input: 0, output: 0, cache_read: 0 };
  let last;
  for (let turn = 0; turn < maxTurns; turn++) {
    last = await post({
      model: config.aiModel,
      max_tokens: maxTokens,
      system,
      messages,
      tools: [...serverTools, ...tools],
      // Oxirgi qadam: vositalarsiz — model yig‘ilgan ma’lumot bilan javobni yozadi
      ...(turn === maxTurns - 1 && (serverTools.length || tools.length) ? { tool_choice: { type: 'none' } } : finalTool && tools.length ? { tool_choice: { type: 'tool', name: finalTool } } : {}),
      thinking: { type: 'adaptive' },
      output_config: { effort },
      ...(useFallback() ? { fallbacks: 'default' } : {}),
      cache_control: { type: 'ephemeral' }
    });
    usage.input += last.usage?.input_tokens || 0;
    usage.output += last.usage?.output_tokens || 0;
    usage.cache_read += last.usage?.cache_read_input_tokens || 0;

    if (last.stop_reason === 'refusal') throw new AiError('refusal', last.stop_details?.category || null);
    if (last.stop_reason === 'max_tokens') throw new AiError('max_tokens');

    const content = last.content || [];
    if (last.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: echoable(content) }); continue; }
    if (last.stop_reason !== 'tool_use') {
      const text = content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
      return { text, stop: last.stop_reason, model: last.model, toolLog, usage };
    }

    messages.push({ role: 'assistant', content: echoable(content) });
    const calls = content.filter(b => b.type === 'tool_use');
    // Parallel chaqiruvlar: hammasining natijasi bitta user xabarida qaytadi
    const results = await Promise.all(calls.map(async c => {
      const h = handlers[c.name], t0 = Date.now();
      let out, isError = false;
      try {
        if (!h) throw new Error(`Noma’lum vosita: ${c.name}`);
        out = await h(c.input || {});
      } catch (e) { out = { error: String(e.message || e) }; isError = true; }
      toolLog.push({ name: c.name, input: c.input, error: isError || undefined, turn, ms: Date.now() - t0 });
      return { type: 'tool_result', tool_use_id: c.id, content: typeof out === 'string' ? out : JSON.stringify(out), ...(isError ? { is_error: true } : {}) };
    }));
    // Yakuniy vosita chaqirildi — natija qo‘lda, modelga qaytib so‘rov yuborilmaydi
    if (finalTool && calls.some(c => c.name === finalTool)) return { text: content.filter(b => b.type === 'text').map(b => b.text).join('').trim(), stop: 'tool', model: last.model, toolLog, usage };
    messages.push({ role: 'user', content: results });
  }
  throw new AiError('too_many_turns');
}
