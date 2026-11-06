import { all } from '../db.js';

/*
  Oddiy xabarlarga AI chaqirilmaydi. «Assalomu alaykum», «rahmat», «ok» kabi xabarlar uchun model ishlatish —
  bir javobga ~$0.01 isrof. Bu yerda shablon javob beriladi yoki umuman javob yozilmaydi.
  Qoida qat'iy: xabarda savol, raqam, mahsulot nomi yoki boshqa ma'no bo'lsa — bu yerda ushlanmaydi, AI ishlaydi.
*/

const clean = t => String(t || '')
  .replace(/\[stiker[^\]]*\]/gi, ' ')                  // «[stiker 👋]» — emoji kabi: yolg‘iz kelsa javob kerak emas
  .replace(/[’'ʻʼ‘`]/g, '')                             // xo‘p → xop, bo‘ldi → boldi — lug‘at bir xil yoziladi
  .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{1F3FB}-\u{1F3FF}\u{20E3}]/gu, ' ')   // \p{Emoji_Component} emas — u raqamlarni ham o‘chirardi
  .replace(/[^\p{L}\p{N}\s]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

/* Salomlashish: boshqa hech narsa yozilmagan bo'lsa */
const GREET = [
  'assalomu alaykum', 'assalomu aleykum', 'asalomu alaykum', 'assalom alaykum', 'assalom', 'salom',
  'salomalekum', 'salom alekum', 'hayrli kun', 'hayrli tong', 'hayrli kech', 'xayrli kun', 'xayrli tong',
  'здравствуйте', 'здраствуйте', 'привет', 'доброе утро', 'добрый день', 'добрый вечер', 'салам', 'ассалому алайкум',
  'hello', 'hi'
];
/* Minnatdorchilik va tasdiq: javob kutilmaydi */
const THANKS = ['rahmat', 'raxmat', 'rahmad', 'raxamt', 'rahamt', 'rahmat sizga', 'katta rahmat', 'tashakkur',
  'спасибо', 'большое спасибо', 'благодарю', 'рахмат', 'раҳмат'];
const ACK = ['ok', 'oke', 'okey', 'xop', 'hop', 'xo p', 'yaxshi', 'bo ldi', 'boldi', 'boladi', 'tushunarli', 'tushundim', 'zo r', 'zor',
  'aha', 'axa', 'mayli', 'kutaman', 'kelishdik', 'xayr', 'hayr',
  'ладно', 'хорошо', 'понял', 'поняла', 'понятно', 'ясно', 'ок', 'окей', 'да', 'ха', 'ага', 'аха', 'угу', 'хоп', 'пока', 'ha', 'yo q', 'yoq'];
/* Minnatdorchilik/tasdiq jumlasidagi qo‘shimcha so‘zlar: «axa hop tushunarli rahmat», «hop rahmat aka» — hamma so‘zi shu to‘plamdan bo‘lsa javob kutilmaydi */
const FILLER = ['aka', 'opa', 'ака', 'siz', 'sizga', 'ham', 'juda', 'katta', 'sizlarga', 'вам', 'тоже', 'ilohim', 'yaxshi',
  'akajon', 'opajon', 'ukajon', 'jon', 'акажон', 'опажон', 'брат', 'brat'];   // «Xop akajon» — AI chaqirilmaydi (2026-10-09)
const SMALL = new Set([...THANKS, ...ACK, ...FILLER].flatMap(s => s.split(' ')));

const isOneOf = (t, list) => {
  if (!t) return false;
  if (list.includes(t)) return true;
  // «salom aka», «rahmat katta» — lug‘atdagi so‘zdan keyin faqat qo‘shimcha so‘zlar. Ma’noli so‘z qo‘shilsa
  // («rahmat kelmadiku», «xop rasmini tashlang») — bu AI ishi; ilgari uzunlik bo‘yicha o‘tib ketardi
  return list.some(g => t.startsWith(g + ' ') && t.slice(g.length + 1).split(' ').every(w => SMALL.has(w)));
};
/* 5 so‘zgacha va har so‘zi minnatdorchilik/tasdiq lug‘atidan — AI chaqirilmaydi (7 kunda model 59 marta shunday xabarga «javob shart emas» degan) */
const isSmallTalk = t => { const w = t.split(' '); return w.length <= 5 && w.every(x => SMALL.has(x)); };

const ru = t => /[а-яё]/.test(t) && !/\b(salom|rahmat|xop|yaxshi)\b/.test(t);

/* Javob matnlari navbat bilan almashadi — bir xil jumla takrorlanmasin. Mijoz salom bergan — sotuvchilar kabi alik olinadi
   («Va aleykum assalom»); «Nima bo‘yicha yordam kerak?» kabi robot savollari yo‘q (2026-10-08, rahbar so‘rovi) */
const GREET_UZ = [
  'Va aleykum assalom 😊 nima kerak edi?',
  'Va aleykum assalom, marhamat, qaysi tovar qiziqtirdi?',
  'Va aleykum assalom 😊 sizga nima kerak edi?'
];
const GREET_RU = [
  'Здравствуйте 😊 что вас интересует?',
  'Здравствуйте, подскажите, что ищете?'
];
const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];

/*
  Qaytaradi:
    { text }   — shablon javob yuboriladi (AI chaqirilmaydi)
    { silent } — javob yozilmaydi, suhbat navbatdan chiqadi
    null       — oddiy emas, AI ishlasin
*/
export function quickAnswer(conv, batch) {
  const rows = all(`SELECT text FROM messages WHERE conversation_id=? AND author='client' AND created_at>=?
      AND json_extract(COALESCE(meta,'{}'),'$.deleted_at') IS NULL ORDER BY id`, conv.id, batch);
  if (!rows.length || rows.length > 2) return null;          // ko'p yozilgan bo'lsa — AI ko'rsin
  const texts = rows.map(r => clean(r.text));
  // «+», «++» yoki «?» — mijoz qiziqdi yoki savol bermoqchi: bu AI ishi, shablon bilan yopilmaydi
  if (rows.some(r => /^[+\s]+$/.test(String(r.text || '')) || String(r.text || '').includes('?'))) return null;
  if (texts.some(t => !t)) {                                  // faqat emoji yoki media
    const hasMedia = rows.some(r => /\[(rasm|video|reels|post|storis|ovozli|fayl|xabar)/i.test(r.text || ''));
    return hasMedia ? null : { silent: true, why: 'emoji' };   // media bo'lsa AI ko'rsin
  }
  if (texts.some(t => /\d/.test(t))) return null;              // raqam bor — narx, model, miqdor bo'lishi mumkin
  const joined = texts.join(' ');
  if (joined.split(' ').length > 4) return null;

  if (texts.every(t => isOneOf(t, GREET))) {
    const seen = all(`SELECT 1 FROM messages WHERE conversation_id=? AND author IN ('ai','seller') LIMIT 1`, conv.id).length;
    // Suhbat allaqachon ketayotgan bo'lsa, quruq «salom» ga qayta savol bermaymiz — AI kontekstni biladi
    if (seen) return null;
    const seed = conv.id + Math.floor(Date.now() / 864e5);
    return { text: ru(joined) ? pick(GREET_RU, seed) : pick(GREET_UZ, seed), why: 'salom' };
  }
  if (texts.every(t => isOneOf(t, THANKS) || isOneOf(t, ACK) || isSmallTalk(t))) return { silent: true, why: 'rahmat/ok' };
  return null;
}
