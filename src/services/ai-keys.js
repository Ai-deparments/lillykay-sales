import { writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { detectGemini, resetModelCooling } from '../ai/gemini.js';
import { audit } from '../core/audit.js';

/*
  AI kalitini paneldan kiritish (faqat admin/rahbar): serverga SSH’siz, telefondan ham. Kalit tekshiriladi, keyin
  DATA_DIR/ai-keys.env ga (faqat sales foydalanuvchisi o‘qiy oladi, 600) yoziladi va darhol ishga tushadi — qayta ishga tushirish shart emas.
  Kalit panelda qayta ko‘rsatilmaydi, jurnalga faqat uzunligi yoziladi. /opt/sales/.env dagi qiymat (sozla.sh) ustun turadi.
*/
export const aiKeysFile = () => join(config.dataDir, 'ai-keys.env');
let busy = false;
export async function saveGeminiKey(raw, who) {
  const key = String(raw || '').trim();
  if (key.length < 20 || /\s/.test(key)) return { ok: false, why: 'Kalit to‘liq emas — qayta nusxalab qo‘ying.' };
  if (/^sk-ant-/.test(key)) return { ok: false, why: 'Bu Anthropic kaliti — bu yerga Gemini kaliti kiritiladi.' };
  if (busy) return { ok: false, why: 'Tekshiruv ketmoqda — bir oz kuting.' };
  busy = true;
  try {
    const d = await detectGemini(key);
    if (!d.ok) { audit('staff', who, 'Gemini kaliti tekshiruvdan o‘tmadi', { result: d.why.slice(0, 200) }); return { ok: false, why: d.why }; }
    const tmp = aiKeysFile() + '.tmp';
    writeFileSync(tmp, `GEMINI_API_KEY=${key}\nGEMINI_ENDPOINT=${d.endpoint}\nGEMINI_MODEL=${d.model}\nGEMINI_FALLBACKS=${(d.fallbacks || []).join(',')}\nAI_PROVIDER=gemini\n`, { mode: 0o600 });
    renameSync(tmp, aiKeysFile());
    Object.assign(config, { geminiKey: key, geminiEndpoint: d.endpoint, geminiModel: d.model, geminiFallbacks: d.fallbacks || [], aiProvider: 'gemini' });
    resetModelCooling();
    audit('staff', who, `AI ulandi: Gemini · ${d.model}`, { result: `${d.endpoint === 'vertex' ? 'Vertex AI' : 'Google AI Studio'} · kalit ${key.length} belgi` });
    return { ok: true, model: d.model, endpoint: d.endpoint };
  } finally { busy = false; }
}
