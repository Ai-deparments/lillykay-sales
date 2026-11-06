import { config, aiProvider, geminiReady } from '../config.js';
import { AiError } from './errors.js';
import * as claude from './claude.js';
import * as gemini from './gemini.js';
import * as claudeCli from './claude-cli.js';

/* Agentlar shu yerdan chaqiradi: qaysi AI ishlashi sozlamaga bog‘liq (config.aiProvider), shartnoma bir xil */
export { AiError };

/* Rasmni Gemini ko‘radi: obuna (claude_cli) rejimida rasm vaqtinchalik faylga yozilib CLI’ga Read qildiriladi —
   sekin va ishonchsiz. Gemini kaliti bo‘lsa rasmli so‘rov to‘g‘ridan-to‘g‘ri unga ketadi, matnli suhbat esa
   odatdagi provayderda qoladi. O‘chirish: AI_VISION=off */
const IMG = /^image\/(jpeg|png|gif|webp)$/;
const hasImage = a => Array.isArray(a) && a.some(x => IMG.test(x?.mime || ''));
export const visionProvider = atts =>
  config.aiVision === 'gemini' && geminiReady() && hasImage(atts) ? 'gemini' : null;

export async function runAgent(opts) {
  const p = aiProvider();
  if (!p) throw new AiError('no_ai_key');
  if (p !== 'gemini' && visionProvider(opts?.attachments)) return gemini.runAgent(opts);
  if (p === 'gemini') return gemini.runAgent(opts);
  if (p === 'claude_cli') return claudeCli.runAgent(opts);
  return claude.runAgent(opts);
}
export function aiInfo() {
  const p = aiProvider();
  const vis = p !== 'gemini' && config.aiVision === 'gemini' && geminiReady() ? ` · rasm: Gemini ${config.geminiModel}` : '';
  if (p === 'gemini') return `Gemini · ${config.geminiModel}${config.geminiEndpoint === 'vertex' ? ' · Vertex AI' : ''}`;
  if (p === 'claude_cli') return `Claude · ${config.aiModel} · obuna (CLI)${vis}`;
  if (p === 'claude') return `Claude · ${config.aiModel} · effort ${config.aiEffort}${vis}`;
  return null;
}
