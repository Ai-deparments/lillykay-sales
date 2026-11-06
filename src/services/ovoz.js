import { spawn } from 'node:child_process';
import { config } from '../config.js';

/*
  Matndan ovoz (TTS) — Gemini. Mijoz ovozli xabar yozsa, AI ham ovoz bilan javob beradi: o‘qib o‘tirmaydi,
  quloqqa tanish bo‘ladi. Ovozni eshitish stt.js da (teskari yo‘nalish).
  Gemini xom PCM qaytaradi (16 bit, 24 kHz, mono) — uni ffmpeg tayyor formatga o‘tkazadi:
    Telegram ovozli xabari — OGG/Opus (sendVoice faqat shuni oladi),
    Instagram — M4A/AAC (2026-10-26: MP3 ni Meta «format qo‘llab-quvvatlanmaydi» deb rad etdi; Instagram o‘zi ham
    ovozli xabarni audio/mp4 bo‘lib yuboradi). Quvur orqali yozilgani uchun mp4 «fragmented» bo‘lishi shart.
  Kalit yo‘q, model xato bersa yoki matn uzun bo‘lsa — ovoz yuborilmaydi, javob odatdagidek matn bo‘lib ketadi.
*/
const TTS_URL = m => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`;
const MAX_HARF = 600;                      // uzun matn ovozda charchatadi — o‘shandan oshsa matn qoladi

export const ttsReady = () => Boolean(config.geminiKey) && config.aiVoice !== 'off';

/* Matn → { buf, mime }. format: 'ogg' (Telegram) yoki 'm4a' (Instagram). Bo‘lmasa — null */
export async function speak(text, format = 'ogg') {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (!ttsReady() || !t || t.length > MAX_HARF) return null;
  const pcm = await tts(t);
  if (!pcm) return null;
  const buf = await encode(pcm, format);
  return buf?.length ? { buf, mime: format === 'ogg' ? 'audio/ogg' : 'audio/mp4' } : null;
}

async function tts(text) {
  for (const model of [config.ttsModel, ...FALLBACK].filter(Boolean)) {
    try {
      const res = await fetch(TTS_URL(model), {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': config.geminiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text }] }],
          generationConfig: { responseModalities: ['AUDIO'],
            speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: config.ttsVoice } } } }
        }),
        signal: AbortSignal.timeout(60000)
      });
      if (!res.ok) { console.error(`[ovoz] ${model}: HTTP ${res.status}`); continue; }
      const j = await res.json();
      const d = j?.candidates?.[0]?.content?.parts?.find(p => p.inlineData)?.inlineData?.data;
      if (d) return Buffer.from(d, 'base64');
    } catch (e) { console.error(`[ovoz] ${model}:`, String(e.message || e).slice(0, 120)); }
  }
  return null;
}
const FALLBACK = ['gemini-3.8-flash-tts', 'gemini-2.5-flash-preview-tts'];

/* Xom PCM (s16le 24 kHz mono) → OGG/Opus yoki M4A/AAC */
function encode(pcm, format) {
  const args = ['-hide_banner', '-loglevel', 'error', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', 'pipe:0',
    ...(format === 'ogg' ? ['-c:a', 'libopus', '-b:a', '32k', '-f', 'ogg']
      : ['-c:a', 'aac', '-b:a', '64k', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4']),
    'pipe:1'];
  return new Promise(resolve => {
    const p = spawn('ffmpeg', args);
    const out = [];
    let err = '';
    p.stdout.on('data', d => out.push(d));
    p.stderr.on('data', d => (err += d));
    p.on('error', () => resolve(null));
    const t = setTimeout(() => { p.kill('SIGKILL'); resolve(null); }, 30000);
    p.on('close', code => { clearTimeout(t); if (code !== 0) console.error('[ovoz] ffmpeg:', err.slice(-200)); resolve(code === 0 ? Buffer.concat(out) : null); });
    p.stdin.on('error', () => {});
    p.stdin.end(pcm);
  });
}
