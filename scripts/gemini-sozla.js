#!/usr/bin/env node
/*
  Gemini kalitini tekshirish va sozlash (deploy/sozla.sh gemini chaqiradi). Kalit stdin’dan o‘qiladi — buyruq qatorida ko‘rinmaydi.
  Muvaffaqiyatda stdout’ga bitta qator: "<ai|vertex> <model> <zaxira,modellar|->"; izohlar stderr’ga. Kalit hech qayerga chiqarilmaydi.
  Majburiy model: GEMINI_MODEL_WANT=... bash sozla.sh gemini
*/
import { detectGemini } from '../src/ai/gemini.js';

const key = (await new Promise(r => { let s = ''; process.stdin.on('data', d => (s += d)); process.stdin.on('end', () => r(s)); })).trim();
if (!key) { console.error('Kalit bo‘sh.'); process.exit(1); }
const d = await detectGemini(key, { wanted: process.env.GEMINI_MODEL_WANT || null });
for (const l of d.log) console.error('   ' + l);
if (!d.ok) { console.error('   ' + d.why); process.exit(1); }
console.log(`${d.endpoint} ${d.model} ${(d.fallbacks || []).join(',') || '-'}`);
