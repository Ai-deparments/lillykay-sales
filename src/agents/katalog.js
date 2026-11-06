import { runAgent, AiError } from '../ai/index.js';
import { product, searchProducts } from '../services/catalog.js';
import { knownFacts } from '../services/karta-tayyor.js';
import { audit } from '../core/audit.js';
import { local, clip } from '../util.js';

/*
  Katalog — mahsulot bilimi agenti (SOT 04).
  Ishlab chiqaruvchi manbasidan karta qoralamasi tayyorlaydi: xususiyat, to‘plam, moslik, cheklovlar, manba va sana.
  Natija saqlanmaydi — xodim ko‘rib chiqib saqlaydi va tasdiqlaydi. Mijozga yozmaydi.
*/
const SYSTEM = `Sen SUN-HIGHTECH kompaniyasi uchun mahsulot kartasini tayyorlaysan. Kartadan mijozlarga javob beradigan agent foydalanadi, shuning uchun har bir fakt aniq va tekshirilgan bo‘lishi kerak.

Qoidalar
- Aynan berilgan model va versiyani qidir (masalan, «Mark II», «II», mount turi, to‘plam varianti). Boshqa versiya ma’lumotini aralashtirma.
- Avval ishlab chiqaruvchining rasmiy sahifasi va texnik xususiyatlar sahifasini ishlat. Rasmiy manba topilmasa, buni «limits» maydonida ochiq yoz.
- Narx va qoldiq yozma — ular BILLZ’dan olinadi. Raqobatchi narxini yozma.
- Moslikni aniq yoz: ulanish turi (mount, 3.5 mm TRS, USB-C, Bowens, SD/CFexpress), qaysi turdagi qurilmalar bilan ishlaydi. Tasdiqlay olmagan moslikni yozma.
- Qisqa, o‘zbek tilida (lotin), texnik atamalar asl holicha.
- Oxirida save_card vositasini bir marta chaqir.`;

const SAVE = { name: 'save_card', description: 'Tayyor karta qoralamasini saqlaydi (xodim tekshiradi).',
  input_schema: { type: 'object', additionalProperties: false, required: ['specs', 'sources'], properties: {
    specs: { type: 'string', description: 'Asosiy xususiyatlar, 2–5 jumla' }, kit: { type: 'string', description: 'To‘plam tarkibi' },
    compat: { type: 'string', description: 'Moslik: ulanish turlari va qurilmalar' }, limits: { type: 'string', description: 'Cheklovlar va noaniqliklar' },
    sources: { type: 'array', items: { type: 'string' }, description: 'Har biri: URL — qisqa izoh' }
  } } };

export async function researchProduct(id, who) {
  const p = product(id);
  if (!p) throw new Error('not_found');
  // Faqat lokal sinov: kalitsiz to‘plamli oqimni (to‘lqin, parallel, davom ettirish) tekshirish uchun
  if (process.env.AI_MOCK === '1') {
    const card = { specs: `[Sinov] ${p.name} — xususiyatlar tekshirilmagan namuna.`, kit: '[Sinov] to‘plam', compat: '[Sinov] moslik',
      limits: '[Sinov] bu karta AI kalitsiz yaratilgan namuna', sources: ['https://example.com — sinov manbasi'] };
    card.sources = card.sources.map(s => `${s} (tekshirildi ${local().date})`);
    return { ok: true, card };
  }
  let card = null;
  try {
    const r = await runAgent({
      system: SYSTEM,
      // Bizda bor faktlar (BILLZ va model nomi) beriladi: agent noldan qidirmaydi, boshqa versiyani chalkashtirmaydi
      userContent: `Bizdagi ma’lumot:\n${knownFacts(p)}\n\nMavjud karta (bo‘lsa, tekshir va to‘ldir; «Dastlabki…» matni tekshirilmagan taxmin — tasdiqlansa qoldir, aks holda tuzat):\nXususiyatlar: ${p.specs || '—'}\nTo‘plam: ${p.kit || '—'}\nMoslik: ${p.compat || '—'}\nCheklovlar: ${p.limits || '—'}`,
      serverTools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }, { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 5 }],
      tools: [SAVE],
      handlers: { save_card: input => { card = input; return { ok: true }; } },
      maxTurns: 10, maxTokens: 12000, effort: 'medium'
    });
    if (!card) return { ok: false, why: 'Agent kartani saqlamadi: ' + (r.text || '').slice(0, 200) };
  } catch (e) {
    return { ok: false, why: e instanceof AiError ? (e.code === 'no_ai_key' ? 'AI kaliti kiritilmagan' : `AI xatosi: ${e.code}`) : String(e.message || e) };
  }
  const date = local().date;
  card.sources = (card.sources || []).map(s => `${s} (tekshirildi ${date})`);
  audit('ai', 'Katalog agenti', `Karta qoralamasi: ${p.name}`, { object: `product:${id}`, data: card.sources.join(' · '), result: 'Xodim tasdig‘ini kutmoqda' });
  return { ok: true, card };
}

/* Sotuvchilarning ichki texnik savoli (TZ SOT 04): javob manbasi bilan. Mijozga yuborilmaydi — panelda sotuvchiga ko‘rinadi. */
const ASK_SYSTEM = `Sen SUN-HIGHTECH sotuvchilariga ichki yordam beradigan mahsulot mutaxassisisan. Javobing mijozga emas, sotuvchiga ketadi.

Qoidalar
- Avval search_catalog bilan SUN-HIGHTECH katalogidan qara. Karta «verified» bo‘lsa — undagi ma’lumotga tayan va shuni manba qilib ko‘rsat.
- Karta tasdiqlanmagan yoki yetarli bo‘lmasa — internetdan ishlab chiqaruvchi manbasidan tekshir va havolasini yoz.
- Narx va qoldiq — faqat katalog natijasidagi billz maydonidan (boshqa joydan olma).
- Aniq bilmasang «aniq emas» deb yoz va nimani tekshirish kerakligini ayt. Taxminni fakt qilib ko‘rsatma.
- Qisqa yoz: javob, keyin «Manba:» qatori. O‘zbek tilida (lotin), texnik atamalar asl holicha.`;

export async function askCatalog(question, who) {
  const q = clip(String(question || '').trim(), 500);
  if (!q) return { ok: false, why: 'Savol bo‘sh' };
  const sources = [];
  try {
    const r = await runAgent({
      system: ASK_SYSTEM,
      userContent: `Sotuvchi savoli: ${q}`,
      serverTools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 4 }, { type: 'web_fetch_20260209', name: 'web_fetch', max_uses: 4 }],
      tools: [{ name: 'search_catalog', description: 'SUN-HIGHTECH katalogidan qidiradi: karta (xususiyat, moslik, tasdiq holati) va BILLZ narxi hamda qoldig‘i.',
        input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } }],
      handlers: {
        search_catalog: ({ query }) => {
          const res = searchProducts(query, 6);
          for (const p of res) sources.push(`${p.name}: ${p.status === 'verified' ? 'karta tasdiqlangan' : 'karta tasdiqlanmagan'} · ${p.billz.source}`);
          return res.length ? res : { found: 0, note: 'Katalogda topilmadi' };
        }
      },
      maxTurns: 8, maxTokens: 4000, effort: 'medium'
    });
    audit('ai', 'Katalog agenti', `Sotuvchi savoli: ${clip(q, 120)}`, { data: sources.join(' · '), result: clip(r.text || '', 200) });
    return { ok: true, text: r.text || '', sources, model: r.model };
  } catch (e) {
    return { ok: false, why: e instanceof AiError ? (e.code === 'no_ai_key' ? 'AI kaliti kiritilmagan' : `AI xatosi: ${e.code}`) : String(e.message || e) };
  }
}
