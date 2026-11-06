import { kvGet, kvSet } from '../db.js';
import { now, clip, local } from '../util.js';
import { config } from '../config.js';
import { audit } from '../core/audit.js';

/*
  Google jadvalga lid yozish (SOT: reklama izohidan kelgan mijoz).
  Usul: jadvalning o‘ziga qo‘yilgan Apps Script veb-ilovasi (deploy/google/Kod.gs) — xizmat hisobi,
  kalit fayli va qo‘shimcha paket kerak emas, faqat havola va maxfiy so‘z. Jadval egasi — mijozning o‘zi.
  Bir suhbatdan bitta qator: takror yozilmasligi uchun kv da belgilanadi; xato bo‘lsa belgi olib tashlanadi
  (keyingi safar yana urinadi). Javob kutilmaydi — mijozga javob yozish bundan sekinlashmaydi.
*/
export const jadvalReady = () => Boolean(config.sheetUrl && config.sheetSecret);

const CH = { ig: 'Instagram', tg: 'Telegram', demo: 'Demo' };

export async function sendLead(convId, lead = {}) {
  if (!jadvalReady()) return false;
  const key = `sheet_lead:${convId}`;
  if (kvGet(key)) return false;
  kvSet(key, now());                                   // qo‘shni so‘rov ham yozib yubormasin
  try {
    const body = {
      maxfiy: config.sheetSecret,
      sana: (t => `${t.date} ${t.hm}`)(local()),        // Toshkent vaqti (UTC emas — jadvalni odam o‘qiydi)
      ism: clip(lead.name || '', 100),
      telefon: lead.phone || '',
      hudud: clip(lead.region || '', 100),
      sorov: clip([lead.object_type, lead.asked || lead.purpose].filter(Boolean).join(' — '), 300),
      forma: 'Instagram izoh',
      lid_id: `conv-${convId}`,
      kanal: CH[lead.channel] || lead.channel || ''
    };
    const r = await fetch(config.sheetUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body), redirect: 'follow', signal: AbortSignal.timeout(20000)
    });
    const j = await r.json().catch(() => null);
    if (!j?.ok) throw new Error(j?.xato || `HTTP ${r.status}`);
    audit('ai', 'Google jadval', 'Lid yozildi', { object: `conv:${convId}`, result: `${body.ism || '—'} · ${body.telefon} · qator ${j.qator || '?'}` });
    return true;
  } catch (e) {
    kvSet(key, '');                                    // yozilmadi — keyingi safar qayta urinadi
    audit('sys', 'Google jadval', 'Lid yozilmadi', { object: `conv:${convId}`, result: String(e.message || e).slice(0, 200) });
    return false;
  }
}
