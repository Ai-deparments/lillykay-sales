import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { geminiReady } from '../config.js';
import { transcribeAudio } from '../ai/gemini.js';

/*
  Ovozli xabar → matn. Gemini kaliti bo‘lsa — Gemini tinglaydi (o‘zbekchani Whisper’dan yaxshi tushunadi, bir necha soniyada);
  Gemini ishlamasa yoki kalit yo‘q bo‘lsa — serverning o‘zidagi ochiq manbali Whisper (whisper.cpp): kalit kerak emas, ovoz serverdan chiqmaydi.
  (Claude API ovozni qabul qilmaydi — faqat matn, rasm, hujjat.)
  2026-09-26 o‘lchovi (2 yadro, small q5_1, -ac 512): 9 s ovoz → ~24 s, xotira ~470 MB. Katta model aniqroq, lekin 2–7 barobar sekin.
  Bir vaqtda bittadan (server ikki yadroli, Nova ham shu yerda), nice 10 bilan.
*/
const BIN = process.env.WHISPER_BIN || '/usr/bin/whisper-cli';
const MODEL = process.env.WHISPER_MODEL || '/opt/sales/models/ggml-small-q5_1.bin';
const MAX_SEC = 180;

let engine = null;                       // sinovlar uchun almashtiriladi: async (buf, mime) => ({ text, lang })
export const setSttEngine = fn => { engine = fn; };
export const sttReady = () => Boolean(engine) || geminiReady() || (existsSync(BIN) && existsSync(MODEL));

let chain = Promise.resolve();
export function transcribe(buf, mime = 'audio/ogg') {
  const p = chain.then(() => (engine ? engine(buf, mime) : listen(buf, mime)));
  chain = p.catch(() => {});
  return p;
}
const GEMINI_MAX = 15e6;   // so‘rovdagi fayl chegarasi (inline 20 MB)
async function listen(buf, mime) {
  if (geminiReady() && buf.length <= GEMINI_MAX) {
    const t0 = Date.now();
    try { return { text: cleanTranscript(await transcribeAudio(buf, mime)), via: 'gemini', ms: Date.now() - t0 }; }
    catch (e) { console.error('[stt] gemini ishlamadi, Whisper’ga o‘tildi:', e.code || e.message); }
  }
  return { ...(await whisper(buf)), via: 'whisper' };
}

/* Whisper shovqin yoki jimlikda «to‘qib chiqaradigan» tipik iboralar — bular matn deb olinmaydi */
const HALLUCINATION = /^((продолжение следует|спасибо за просмотр|thanks? for watching|music|музыка|you)[.!…\s]*|(субтитры (сделал|создавал|подготовил)|редактор субтитров|корректор)(\s.*)?)$/i;   // \b kirill harflarida ishlamaydi
export function cleanTranscript(t) {
  const x = String(t || '').replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
  return !x || HALLUCINATION.test(x) ? '' : x;
}

function exec(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => (out += d)); p.stderr.on('data', d => (err += d));
    const t = setTimeout(() => { p.kill('SIGKILL'); reject(new Error('stt_timeout')); }, timeoutMs);
    p.on('error', e => { clearTimeout(t); reject(e); });
    p.on('close', code => { clearTimeout(t); code === 0 ? resolve({ out, err }) : reject(new Error(`${cmd} ${code}: ${err.slice(-200)}`)); });
  });
}

async function whisper(buf) {
  if (!existsSync(BIN) || !existsSync(MODEL)) throw new Error('stt_off');
  const dir = mkdtempSync(join(tmpdir(), 'stt-'));
  try {
    const inp = join(dir, 'in'), wav = join(dir, 'a.wav');
    writeFileSync(inp, buf);
    await exec('ffmpeg', ['-y', '-loglevel', 'error', '-i', inp, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], 60000);
    const sec = Math.max(0, (statSync(wav).size - 44) / 32000);
    if (sec > MAX_SEC) return { text: '', skipped: `juda uzun (${Math.round(sec)} s)` };
    // Qisqa ovozda kodlovchi kontekstini qisqartirish tezlikni ~1,5 barobar oshiradi (sifat deyarli o‘zgarmaydi)
    const ac = sec <= 10 ? 512 : sec <= 20 ? 1000 : 1500;
    const t0 = Date.now();
    const { out, err } = await exec('nice', ['-n', '10', BIN, '-m', MODEL, '-f', wav, '-l', 'auto', '-t', '2', '-nt', '-np', '-ac', String(ac)], 150000);
    const lang = (err.match(/auto-detected language:\s*([a-z]{2})/) || [])[1] || null;
    return { text: cleanTranscript(out), lang, ms: Date.now() - t0, sec: Math.round(sec) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
