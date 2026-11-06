import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from '../config.js';
import { AiError } from './errors.js';

export { AiError };

/*
  Claude — OBUNA orqali (API kaliti kerak emas), `claude` CLI ustida.

  Nega: API kaliti har xabar uchun pul oladi. Obunada (Claude Max) esa to‘lov oylik.
  Auth — `claude setup-token` bilan olingan uzoq muddatli CLAUDE_CODE_OAUTH_TOKEN.

  Cheklov: CLI’ga o‘z vositalarimizni (tools) berib bo‘lmaydi. Shuning uchun model
  har qadamda FAQAT bitta JSON qaytaradi:
      {"tool_calls":[{"name":"...","input":{...}}]}   yoki   {"text":"mijozga javob"}
  Vosita sikli shu faylda emulyatsiya qilinadi — agentlar kodi (fokus, katalog, boshliq)
  o‘zgarmaydi, `runAgent` shartnomasi aynan claude.js dagidek.

  Internet qidiruvi (web_search / web_fetch): CLI’ning o‘z WebSearch/WebFetch vositalari yoqiladi.

  Xavf: obuna limiti Nova/Imir/Rustam bilan umumiy. Limit tugasa CLI xato qaytaradi →
  AiError('limit') → chaqiruvchi mijozga xavfsiz javob beradi va operatorga signal ketadi.
*/

const PROTOCOL = `
# JAVOB FORMATI — TEXNIK, QAT'IY
Siz vositalarni to'g'ridan-to'g'ri chaqira olmaysiz. HAR SAFAR faqat BITTA JSON obyekt qaytarasiz.
Undan oldin ham, keyin ham hech narsa yozilmaydi (izoh, markdown, \`\`\` yo'q):

  vosita kerak bo'lsa:   {"tool_calls":[{"name":"<vosita nomi>","input":{<parametrlar>}}]}
  yakuniy javob:         {"text":"<javob matni>"}

Bir vaqtda bir nechta vosita kerak bo'lsa — hammasini bitta "tool_calls" ro'yxatiga yozing.
Suhbatda [VOSITA NATIJASI] — bu tizim ma'lumoti, odam yozgani emas.
Javobni yozishdan oldin yaxshilab o'ylang: ma'lumot yetarlimi, aniqmi, foydalimi.

# MAVJUD VOSITALAR (JSON Schema)
__TOOLS__
`;

const SIZ_HAQINGIZDA = `Siz ichki xizmat dasturisiz. Fayl o'qish/yozish, buyruq bajarish kabi
ishlar talab qilinmaydi — faqat yuqoridagi JSON formatida javob bering.`;

function cliPath() {
  return config.aiCliPath || 'claude';
}

function workdir() {
  const d = config.aiCliWorkdir || join(tmpdir(), 'sales-claude-cli');
  try { mkdirSync(d, { recursive: true }); } catch { /* bor */ }
  return d;
}

/* Xabarlar ro'yxatini bitta matn transkriptga aylantiradi (CLI faqat matn qabul qiladi) */
function transcript(messages) {
  const lines = [];
  for (const m of messages) {
    const c = m.content;
    if (typeof c === 'string') {
      lines.push(`[${m.role === 'user' ? 'MIJOZ' : 'SIZ (oldingi javob)'}]: ${c}`);
      continue;
    }
    for (const b of c || []) {
      if (b.type === 'text') lines.push(`[${m.role === 'user' ? 'MIJOZ' : 'SIZ'}]: ${b.text}`);
      else if (b.type === 'tool_use') lines.push(`[SIZ vosita chaqirdingiz]: ${b.name} ${JSON.stringify(b.input || {})}`);
      else if (b.type === 'tool_result') lines.push(`[VOSITA NATIJASI]: ${typeof b.content === 'string' ? b.content : JSON.stringify(b.content)}`);
      else if (b.type === 'image') lines.push(`[MIJOZ RASM YUBORDI — fayl: ${b._file || 'rasm'}]`);
    }
  }
  return lines.join('\n');
}

/* Modeldan kelgan matndan JSON obyektni ajratib oladi (model ba'zan atrofiga matn qo'shadi) */
function extractJson(text) {
  let t = String(text || '').trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  try { const v = JSON.parse(t); if (v && typeof v === 'object') return v; } catch { /* pastda */ }
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  if (i !== -1 && j > i) {
    try { const v = JSON.parse(t.slice(i, j + 1)); if (v && typeof v === 'object') return v; } catch { /* yo'q */ }
  }
  return null;
}

function classifyError(out, code) {
  const s = `${out}`.toLowerCase();
  if (/rate.?limit|too many requests|429|limit reached|usage limit/.test(s)) return new AiError('limit', 'obuna limiti');
  if (/unauthor|forbidden|invalid.*token|401|403/.test(s)) return new AiError('auth', 'obuna tokeni yaroqsiz');
  if (/timeout|timed out/.test(s)) return new AiError('network', 'CLI javob bermadi');
  return new AiError('network', `claude CLI xato (kod ${code}): ${String(out).slice(0, 300)}`);
}

/* Bitta CLI chaqiruvi: (system, prompt) -> { text, usage } */
function runCli(system, prompt, { allowTools = '', timeoutMs = 180000, model } = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p', '--output-format', 'json',
      '--model', model || config.aiModel,
      '--tools', allowTools,
      '--setting-sources', 'project',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--system-prompt', system
    ];
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;            // obuna tokeni ishlatilsin
    env.CLAUDE_CONFIG_DIR = join(workdir(), '.claude');
    env.DISABLE_AUTOUPDATER = '1';

    let child;
    try { child = spawn(cliPath(), args, { cwd: workdir(), env }); }
    catch (e) { return reject(new AiError('network', `claude CLI ishga tushmadi: ${e.message}`)); }

    let out = '', err = '', done = false;
    const timer = setTimeout(() => { done = true; child.kill('SIGKILL'); reject(new AiError('network', 'claude CLI vaqt tugadi')); }, timeoutMs);

    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('error', e => { if (!done) { clearTimeout(timer); reject(new AiError('network', String(e.message || e))); } });
    child.on('close', code => {
      if (done) return;
      clearTimeout(timer);
      let data = null;
      const lines = out.trim().split('\n').filter(Boolean);
      try { data = JSON.parse(lines[lines.length - 1]); } catch { /* pastda */ }
      if (code !== 0 || !data || data.is_error || (data.subtype && data.subtype !== 'success')) {
        return reject(classifyError(data?.result || err || out, code));
      }
      const u = data.usage || {};
      resolve({
        text: String(data.result || ''),
        model: data.model || config.aiModel,
        usage: {
          input: u.input_tokens || 0,
          output: u.output_tokens || 0,
          cache_read: u.cache_read_input_tokens || 0
        }
      });
    });

    child.stdin.end(prompt);
  });
}

export async function runAgent({
  system, userContent, attachments = [], tools = [], serverTools = [],
  handlers = {}, maxTurns = 8, maxTokens = 8000, effort, model, finalTool = null
} = {}) {
  void maxTokens; void effort;                       // CLI bularni qabul qilmaydi
  const tmp = mkdtempSync(join(workdir(), 'ish-'));
  try {
    // Rasmlar: CLI faylni o'qiy oladi — vaqtinchalik faylga yozamiz
    const imgs = attachments.filter(a => /^image\/(jpeg|png|gif|webp)$/.test(a.mime));
    const files = imgs.map((a, i) => {
      const ext = { 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[a.mime] || 'jpg';
      const f = join(tmp, `rasm${i + 1}.${ext}`);
      writeFileSync(f, Buffer.from(a.data, 'base64'));
      return f;
    });

    // Internet vositalari server tomonidan so'ralgan bo'lsa — CLI'nikini yoqamiz
    const wantsWeb = serverTools.some(t => /web_search|web_fetch/.test(t.type || t.name || ''));
    const allow = [wantsWeb ? 'WebSearch,WebFetch' : '', files.length ? 'Read' : ''].filter(Boolean).join(',');

    const spec = JSON.stringify(tools.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema })), null, 1);
    const sysFull = [system, SIZ_HAQINGIZDA, PROTOCOL.replace('__TOOLS__', spec || '[]')].join('\n\n');

    let first = userContent;
    if (files.length) first = `${userContent}\n\n[Mijoz rasm yubordi. Avval Read vositasi bilan o'qing: ${files.join(', ')}]`;

    const messages = [{ role: 'user', content: first }];
    const toolLog = [];
    const usage = { input: 0, output: 0, cache_read: 0 };

    for (let turn = 0; turn < maxTurns; turn++) {
      const r = await runCli(sysFull, transcript(messages), { allowTools: allow, model });
      usage.input += r.usage.input; usage.output += r.usage.output; usage.cache_read += r.usage.cache_read;

      const obj = extractJson(r.text);
      const calls = (obj?.tool_calls || []).filter(c => c && typeof c.name === 'string' && handlers[c.name]);

      // Vosita so'ralmadi → bu yakuniy javob
      if (!calls.length) {
        const text = typeof obj?.text === 'string' ? obj.text : (obj ? '' : r.text.trim());
        if (!text) throw new AiError('bad_format', 'model javobini tushunib bo‘lmadi');
        return { text: text.trim(), stop: 'end_turn', model: r.model, toolLog, usage };
      }

      // Yakuniy vosita chaqirildi — uni bajarib to‘xtaymiz (CLI majburlay olmaydi, lekin ikkinchi progon ketmaydi)
      if (finalTool && calls.some(c => c.name === finalTool)) {
        for (const c of calls.filter(c => c.name === finalTool)) {
          const t0 = Date.now();
          try { await handlers[c.name](c.input || {}); toolLog.push({ name: c.name, input: c.input, turn, ms: Date.now() - t0 }); }
          catch (e) { toolLog.push({ name: c.name, input: c.input, error: true, turn, ms: Date.now() - t0 }); throw new AiError('tool_failed', String(e.message || e)); }
        }
        return { text: typeof obj?.text === 'string' ? obj.text.trim() : '', stop: 'tool', model: r.model, toolLog, usage };
      }
      // Oxirgi qadamda vositalar o'chadi — yig'ilgani bilan javob yoziladi
      if (turn === maxTurns - 1) {
        const last = await runCli(`${sysFull}\n\n[DIQQAT: vositalar tugadi. Yig'ilgan ma'lumot bilan {"text":"..."} javobini bering.]`,
          transcript(messages), { allowTools: '', model });
        usage.input += last.usage.input; usage.output += last.usage.output;
        const o = extractJson(last.text);
        const text = (typeof o?.text === 'string' ? o.text : last.text).trim();
        return { text, stop: 'end_turn', model: last.model, toolLog, usage };
      }

      messages.push({ role: 'assistant', content: calls.map((c, i) => ({ type: 'tool_use', id: `cli_${turn}_${i}`, name: c.name, input: c.input || {} })) });

      const results = await Promise.all(calls.map(async (c, i) => {
        const t0 = Date.now();
        let out, isError = false;
        try { out = await handlers[c.name](c.input || {}); }
        catch (e) { out = { error: String(e.message || e) }; isError = true; }
        toolLog.push({ name: c.name, input: c.input, error: isError || undefined, turn, ms: Date.now() - t0 });
        return { type: 'tool_result', tool_use_id: `cli_${turn}_${i}`, content: typeof out === 'string' ? out : JSON.stringify(out), ...(isError ? { is_error: true } : {}) };
      }));
      messages.push({ role: 'user', content: results });
    }
    throw new AiError('too_many_turns');
  } finally {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* mayli */ }
  }
}
