import { readFileSync, existsSync } from 'node:fs';
import { setDefaultResultOrder } from 'node:dns';

/* Photobuy serverida IPv6 orqali Telegram’ga yo‘l yo‘q (2026-09-26: curl -6 o‘tmaydi, -4 o‘tadi).
   Node avval IPv6 ni sinab, ba’zan vaqtida IPv4 ga o‘tolmay «aloqa yo‘q» beradi — shuning uchun IPv4 birinchi. */
setDefaultResultOrder('ipv4first');
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* .env — oddiy KEY=VALUE qatorlar. Serverda /opt/sales/.env (chmod 600), deploy/sozla.sh to‘ldiradi.
   Muhit o‘zgaruvchisi .env dan ustun turadi. */
function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
loadEnv(process.env.ENV_FILE || join(ROOT, '.env'));
/* Paneldan kiritilgan AI kaliti (services/ai-keys.js) — asosiy .env da bo‘lmasa shu yerdan */
loadEnv(join(process.env.DATA_DIR || join(ROOT, 'data'), 'ai-keys.env'));

const env = (k, d = '') => process.env[k] ?? d;
const flag = k => /^(1|true|yes)$/i.test(env(k));

export const config = {
  host: env('HOST', '127.0.0.1'),
  port: Number(env('PORT', 8200)),
  publicUrl: env('PUBLIC_URL', 'http://127.0.0.1:8200').replace(/\/$/, ''),
  secure: flag('SECURE'),
  dataDir: env('DATA_DIR', join(ROOT, 'data')),
  tz: env('BIZ_TZ', 'Asia/Tashkent'),

  demoData: flag('DEMO_DATA'),

  tgToken: env('TG_BOT_TOKEN'),
  cbToken: env('CASHBACK_BOT_TOKEN'),   // keshbek boti — mijozlar o‘z balansini ko‘radi
  tgDisabled: flag('TG_DISABLED'),
  /* Nova agentining tokeni bu yerda HECH QACHON ishlatilmaydi (409 Conflict → Nova to‘xtaydi). */
  tgForbiddenUsernames: env('TG_FORBIDDEN_BOTS', 'photobuy_ai_bot').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),

  aiKey: env('ANTHROPIC_API_KEY'),
  aiModel: env('AI_MODEL', 'claude-opus-5'),
  aiEffort: env('AI_EFFORT', 'medium'),
  /* Gemini (Google): kalit, qaysi xizmat (ai — AI Studio, vertex — Vertex AI express) va model sozlashda aniqlanadi (deploy/sozla.sh gemini).
     AI_PROVIDER: gemini | claude — ikkala kalit bo‘lsa qaysi biri ishlashi; bo‘sh bo‘lsa — kaliti borini. */
  aiProvider: env('AI_PROVIDER', ''),
  /* Obuna orqali Claude (API kaliti emas): AI_PROVIDER=claude_cli + CLAUDE_CODE_OAUTH_TOKEN */
  aiCliToken: env('CLAUDE_CODE_OAUTH_TOKEN'),
  aiCliPath: env('CLAUDE_CLI', ''),
  aiCliWorkdir: env('CLAUDE_CLI_WORKDIR', ''),
  geminiKey: env('GEMINI_API_KEY'),
  geminiEndpoint: env('GEMINI_ENDPOINT', 'ai'),
  geminiModel: env('GEMINI_MODEL', 'gemini-2.5-flash'),
  /* Zaxira modellar: asosiysi limitga yetsa yoki band bo‘lsa (429/503) — navbatdagisi. Bo‘sh bo‘lsa — ma’lum ro‘yxat */
  geminiFallbacks: env('GEMINI_FALLBACKS', '').split(',').map(s => s.trim()).filter(Boolean),
  /* Aralash rejim: qiyin holatlar (rasm, post, variant, uzun ro‘yxat) va arzon model yaroqsiz javob bersa — shu kuchli model.
     Bo‘sh bo‘lsa — hammasi asosiy modelda. Masalan: GEMINI_MODEL=gemini-3.1-flash-lite, GEMINI_STRONG_MODEL=gemini-3.8-flash */
  geminiStrongModel: env('GEMINI_STRONG_MODEL', ''),
  /* Rasmni kim ko'radi: gemini (kaliti bo'lsa — matnli suhbat boshqa provayderda qolsa ham) | off */
  aiVision: env('AI_VISION', 'gemini'),
  /* Izohga javobni kim yozadi: gemini (kaliti bo'lsa) | off — eski shablon */
  aiComments: env('AI_COMMENTS', 'gemini'),
  /* Reklamadagi izoh kodi: «izohga 7 yozing», ««OK» deb yozing», 🔥 — vergul bilan. Raqam va «+» allaqachon tushuniladi,
     bu ro‘yxat qisqa so‘z, harf va emoji kodlar uchun. Masalan: IG_COMMENT_CODES=ok,narx,🔥 */
  /* Google jadval (Apps Script veb-ilovasi): lid ism va telefon bilan shu yerga yoziladi.
     SHEET_URL — deploy havolasi (.../exec), SHEET_SECRET — Kod.gs dagi MAXFIY_SOZ. Bo‘sh bo‘lsa yozilmaydi. */
  /* Matndan ovoz (TTS, Gemini). AI_VOICE: ovozga — mijoz ovoz yuborsa javob ham ovozda | hamma | off */
  aiVoice: env('AI_VOICE', 'ovozga'),
  ttsModel: env('TTS_MODEL', 'gemini-3.8-flash-tts'),
  ttsVoice: env('TTS_VOICE', 'Kore'),
  sheetUrl: env('SHEET_URL'),
  sheetSecret: env('SHEET_SECRET'),
  igCommentCodes: env('IG_COMMENT_CODES', '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean),

  billzToken: env('BILLZ_SECRET_TOKEN'),
  billzBase: env('BILLZ_API_BASE', 'https://api-admin.billz.ai'),

  /* Mijozning Odoo CRM (faqat o‘qish): JSON-RPC, login + API kalit (kalit parol o‘rnida). Kalit faqat serverda. */
  odooUrl: env('ODOO_URL').replace(/\/$/, ''),
  odooDb: env('ODOO_DB'),
  odooLogin: env('ODOO_LOGIN', 'admin'),
  odooKey: env('ODOO_API_KEY'),
  odooTimeoutMs: Number(env('ODOO_TIMEOUT_MS', 60000)),

  /* Instagram Direct (Meta). Token va sirlar faqat .env da; veb-huk imzosi app secret bilan tekshiriladi. */
  igToken: env('IG_TOKEN'),
  igUserId: env('IG_USER_ID'),
  igAppSecret: env('IG_APP_SECRET'),
  igVerifyToken: env('IG_VERIFY_TOKEN'),
  igApiBase: env('IG_API_BASE', 'https://graph.instagram.com/v26.0'),
  igDisabled: flag('IG_DISABLED')
};

export const geminiReady = () => Boolean(config.geminiKey);
/* Qaysi AI ishlaydi: AI_PROVIDER aniq aytilgan bo‘lsa va kaliti bo‘lsa — o‘sha; aks holda kaliti bori (Claude ustun) */
export function aiProvider() {
  if (config.aiProvider === 'claude_cli' && config.aiCliToken) return 'claude_cli';
  if (config.aiProvider === 'gemini' && config.geminiKey) return 'gemini';
  if (config.aiProvider === 'claude' && config.aiKey) return 'claude';
  /* Sozlama ko'rsatilmasa: obuna -> API kaliti -> Gemini */
  if (config.aiCliToken) return 'claude_cli';
  return config.aiKey ? 'claude' : config.geminiKey ? 'gemini' : null;
}
export const aiReady = () => Boolean(aiProvider());
export const tgReady = () => Boolean(config.tgToken) && !config.tgDisabled;
export const igReady = () => Boolean(config.igToken && config.igUserId) && !config.igDisabled;
