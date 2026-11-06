/*
  Gemini: kalit sarlavhada (URL’da emas), funksiya chaqiruvi sikli (thoughtSignature o‘zgarishsiz qaytadi),
  rasm AI’ga ilova qilinadi, sxema Gemini kichik to‘plamiga keltiriladi, rad javobi xato sifatida,
  ovoz Gemini orqali matnga aylanadi, Gemini ishlamasa Whisper’ga o‘tadi.
*/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sales-gem-'));
Object.assign(process.env, { DB_FILE: join(dir, 't.db'), DATA_DIR: dir, TG_DISABLED: '1', DRAFT_DEBOUNCE_MS: '999999',
  GEMINI_API_KEY: 'sinov-kalit-123', GEMINI_ENDPOINT: 'ai', GEMINI_MODEL: 'gemini-sinov-flash', WHISPER_BIN: '/yoq/whisper' });
delete process.env.ANTHROPIC_API_KEY;
const { migrate, run, one } = await import('../src/db.js');
const { aiProvider } = await import('../src/config.js');
const { runAgent, aiInfo, AiError } = await import('../src/ai/index.js');
const { toGeminiSchema, geminiUrl } = await import('../src/ai/gemini.js');
const { transcribe } = await import('../src/services/stt.js');
const { ingestClient, drainInbox } = await import('../src/services/inbox.js');
const { fokusDraft, asksPhoto } = await import('../src/agents/fokus.js');

let calls = [], replies = [], cacheCalls = [];
let mediaBytes = Buffer.alloc(0), mediaFetches = 0;   // Instagram CDN (lookaside) javobi — story/post fayli
const realFetch = globalThis.fetch;
before(() => {
  migrate();
  globalThis.fetch = async (url, opts = {}) => {
    // Kesh yaratish (cachedContents) — alohida hisob: javoblar navbatini yemaydi, nomi qaytadi
    if (/cachedContents/.test(String(url))) { cacheCalls.push({ body: JSON.parse(opts.body) }); return new Response(JSON.stringify({ name: 'cachedContents/sinov-' + cacheCalls.length }), { status: 200 }); }
    if (/lookaside\.fbsbx\.com/.test(String(url))) { mediaFetches++; return new Response(mediaBytes, { status: 200 }); }
    calls.push({ url: String(url), headers: opts.headers || {}, body: opts.body ? JSON.parse(opts.body) : null });
    const r = replies.shift();
    if (!r) throw new Error('kutilmagan so‘rov');
    if (r.status && r.status !== 200) return new Response(r.raw || JSON.stringify({ error: { message: r.message || 'xato' } }), { status: r.status });
    return new Response(JSON.stringify(r), { status: 200 });
  };
});
after(async () => { globalThis.fetch = realFetch; await drainInbox(100); rmSync(dir, { recursive: true, force: true }); });
const reset = (...rs) => { calls = []; replies = rs; };
const say = (parts, extra = {}) => ({ candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 20 }, modelVersion: 'gemini-sinov-flash', ...extra });

test('provayder: faqat Gemini kaliti bo‘lsa — Gemini; manzil va kalit sarlavhada', () => {
  assert.equal(aiProvider(), 'gemini');
  assert.match(aiInfo(), /^Gemini · gemini-sinov-flash/);
  assert.equal(geminiUrl('ai', 'm-1'), 'https://generativelanguage.googleapis.com/v1beta/models/m-1:generateContent');
  assert.equal(geminiUrl('vertex', 'm-1'), 'https://aiplatform.googleapis.com/v1/publishers/google/models/m-1:generateContent');
});

test('sxema: additionalProperties va pattern olib tashlanadi, pattern izohga o‘tadi', () => {
  const g = toGeminiSchema({ type: 'object', additionalProperties: false, required: ['date'], properties: {
    date: { type: 'string', pattern: '^\\d{4}$', description: 'Sana' }, items: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { n: { type: 'integer', minimum: 1 } } } } } });
  assert.deepEqual(g, { type: 'object', required: ['date'], properties: {
    date: { type: 'string', description: 'Sana — format: ^\\d{4}$' }, items: { type: 'array', items: { type: 'object', properties: { n: { type: 'integer', minimum: 1 } } } } } });
});

test('funksiya sikli: vosita chaqiriladi, thoughtSignature o‘zgarishsiz qaytadi, rasm ilova qilinadi', async () => {
  reset(
    say([{ functionCall: { id: 'c1', name: 'search_catalog', args: { query: 'Canon R50' } }, thoughtSignature: 'IMZO-1' }]),
    say([{ text: 'Canon R50 bor, narxi 690 $.' }])
  );
  const seen = [];
  const r = await runAgent({
    system: 'Tizim', userContent: 'Mijoz: shu bormi?', attachments: [{ mime: 'image/jpeg', data: 'QUJD' }],
    tools: [{ name: 'search_catalog', description: 'qidiruv', input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } },
      { name: 'get_customer_profile', description: 'profil', input_schema: { type: 'object', properties: {}, additionalProperties: false } }],
    handlers: { search_catalog: a => { seen.push(a.query); return [{ name: 'Canon R50', price: 690 }]; } }
  });
  assert.equal(r.text, 'Canon R50 bor, narxi 690 $.');
  assert.deepEqual(seen, ['Canon R50']);
  assert.equal(calls.length, 2);
  const [a, b] = calls;
  assert.equal(a.headers['x-goog-api-key'], 'sinov-kalit-123');
  assert.ok(!a.url.includes('sinov-kalit'), 'kalit URL’da emas');
  assert.deepEqual(a.body.contents[0].parts[1], { inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } });
  assert.equal(a.body.systemInstruction.parts[0].text, 'Tizim');
  const decl = a.body.tools[0].functionDeclarations;
  assert.ok(!('parameters' in decl[1]), 'parametrsiz vosita — parameters yo‘q');
  assert.ok(!JSON.stringify(decl).includes('additionalProperties'));
  assert.deepEqual(b.body.contents[1], { role: 'model', parts: [{ functionCall: { id: 'c1', name: 'search_catalog', args: { query: 'Canon R50' } }, thoughtSignature: 'IMZO-1' }] });
  assert.deepEqual(b.body.contents[2], { role: 'user', parts: [{ functionResponse: { id: 'c1', name: 'search_catalog', response: { result: [{ name: 'Canon R50', price: 690 }] } } }] });
  assert.deepEqual(r.usage, { input: 200, output: 40, cache_read: 0 });
});

test('finalTool: vosita majburan so‘raladi (mode ANY) va chaqirilgach sikl to‘xtaydi — bitta so‘rov, ikkinchi (bekor) so‘rov yo‘q', async () => {
  reset(say([{ functionCall: { id: 'c1', name: 'xulosa', args: { summary: 'S', groups: [] } } }]), say([{ text: 'bu so‘rov ketmasligi kerak' }]));
  let got = null;
  const r = await runAgent({ system: 's', userContent: 'u', maxTurns: 2, finalTool: 'xulosa',
    tools: [{ name: 'xulosa', description: 'x', input_schema: { type: 'object', properties: { summary: { type: 'string' } } } }],
    handlers: { xulosa: a => { got = a; return { ok: true }; } } });
  assert.equal(calls.length, 1, 'faqat bitta so‘rov');
  assert.deepEqual(calls[0].body.toolConfig, { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: ['xulosa'] } });
  assert.equal(got.summary, 'S'); assert.equal(r.stop, 'tool'); assert.equal(r.toolLog[0].name, 'xulosa');
});

test('oxirgi qadamda vositalar o‘chiriladi — model yig‘ilganini yozadi, «juda ko‘p qadam» xatosi bo‘lmaydi', async () => {
  const fc = n => say([{ functionCall: { id: 'c' + n, name: 'search_catalog', args: { query: 'chiroq ' + n } } }]);
  reset(fc(1), fc(2), say([{ text: 'Mana 2 ta variant' }]));
  const r = await runAgent({ system: 's', userContent: 'u', maxTurns: 3,
    tools: [{ name: 'search_catalog', description: 'q', input_schema: { type: 'object', properties: { query: { type: 'string' } } } }],
    handlers: { search_catalog: () => [] } });
  assert.equal(r.text, 'Mana 2 ta variant');
  assert.equal(calls.length, 3);
  assert.ok(!calls[0].body.toolConfig && !calls[1].body.toolConfig, 'oldingi qadamlarda vositalar ochiq');
  assert.deepEqual(calls[2].body.toolConfig, { functionCallingConfig: { mode: 'NONE' } });
  assert.ok(r.toolLog.every(t => Number.isFinite(t.ms) && Number.isInteger(t.turn)), 'har vosita qadami va vaqti yoziladi');
});

test('model NONE’ga qaramay vosita chaqirsa — vosita bajariladi, yakuniy so‘rov vositalarsiz ketadi, javob chiqadi', async () => {
  const fc = (n, name = 'search_catalog') => say([{ functionCall: { id: 'c' + n, name, args: { query: 'chiroq ' + n } } }]);
  reset(fc(1), fc(2), fc(3, 'update_card'), say([{ text: 'Mana variantlar' }]));
  const ran = [];
  const r = await runAgent({ system: 's', userContent: 'u', maxTurns: 3,
    tools: ['search_catalog', 'update_card'].map(name => ({ name, description: 'q', input_schema: { type: 'object', properties: { query: { type: 'string' } } } })),
    handlers: { search_catalog: () => [], update_card: () => { ran.push('card'); return { ok: true }; } } });
  assert.equal(r.text, 'Mana variantlar');
  assert.equal(calls.length, 4);
  assert.deepEqual(calls[2].body.toolConfig, { functionCallingConfig: { mode: 'NONE' } });
  assert.ok(!calls[3].body.tools && !calls[3].body.toolConfig, 'yakuniy so‘rovda vositalar yo‘q');
  assert.deepEqual(ran, ['card'], 'NONE’dagi chaqiruv ham bajarilgan');
});

test('vosita chaqiruvi matn bo‘lib kelsa — mijozga ketmaydi, qolgan javob qoladi', async () => {
  const { stripToolText } = await import('../src/agents/fokus.js');
  const src = [];
  const t = stripToolText('yaxshi kunlarizga xizmat qilsin\n\nyana savol bo‘lsa yozing!\n\nupdate_card(stage: 4, next_step: "Suhbatni yakunlash")\nsearch_catalog(query: "canon")', src);
  assert.equal(t, 'yaxshi kunlarizga xizmat qilsin\n\nyana savol bo‘lsa yozing!');
  assert.match(src[0], /update_card/);
  assert.equal(stripToolText('Narxi 530$. (Chegirma bilan)'), 'Narxi 530$. (Chegirma bilan)', 'oddiy qavsli matn tegilmaydi');
  assert.equal(stripToolText('update_card(stage: 4)'), '', 'faqat chaqiruv bo‘lsa — bo‘sh (qoralama xato bilan to‘xtaydi)');
  assert.equal(stripToolText('narxi 125$\n\n[handoff_to_seller(kind: rasm, task: \'rasmini tashlab yuboring\')]'), 'narxi 125$', 'kvadrat qavs ichidagi chaqiruv ham');
  assert.equal(stripToolText('narxi 125$\n`attach_product_photo(id: 1672'), 'narxi 125$', 'yopilmagan qavs ham');
});

test('JSON, kod bloki va markdown mijozga ketmaydi; faqat kod bo‘lsa — bo‘sh', async () => {
  const { stripCodeText, stripToolText } = await import('../src/agents/fokus.js');
  const src = [];
  assert.equal(stripCodeText('Sony ZV-E10 bor, narxi 670$\n\n```json\n{"stage": 2, "asked": "zv e10"}\n```\n\nbody kerakmi?', src), 'Sony ZV-E10 bor, narxi 670$\n\nbody kerakmi?');
  assert.match(src[0], /kod\/JSON/);
  assert.equal(stripCodeText('{"stage": 4, "next_step": "yakunlash"}'), '', 'faqat JSON — bo‘sh');
  assert.equal(stripCodeText('**Godox C01** — `35$`\n### Variantlar\n- bor'), 'Godox C01 — 35$\nVariantlar\n- bor', 'belgilar ketadi, so‘z qoladi');
  assert.equal(stripCodeText('narxi 670$ (kit bilan) — do‘konda bor'), 'narxi 670$ (kit bilan) — do‘konda bor', 'oddiy qavs tegilmaydi');
  assert.equal(stripCodeText('Godox C01 — 35$\n{\n  "asked": "c01",\n  "stage": 1\n}'), 'Godox C01 — 35$', 'ko‘p qatorli JSON');
  assert.equal(stripToolText('bor, narxi 35$\n```\nupdate_card(stage: 2)\n```'), 'bor, narxi 35$', 'kod blokidagi vosita ham');
  assert.equal(stripCodeText('Godox CB-01 bor, narxi 150$\n\nfilialdan olasizmi?\n\n<details>\n<summary>update_card</summary>\n</details>'), 'Godox CB-01 bor, narxi 150$\n\nfilialdan olasizmi?', 'HTML blok');
  assert.equal(stripCodeText('<b>Godox C01</b> — 35$'), 'Godox C01 — 35$', 'HTML teg');
  assert.equal(stripCodeText('narxi 35$ <3'), 'narxi 35$ <3', 'teg bo‘lmagan «<» tegilmaydi');
});

test('ichki izoh mijozga ketmaydi: «Mijoz … so‘ramaganligi sababli … javob berdim»; «mijozlarimiz» kabi oddiy gap qoladi', async () => {
  const { tidyTone } = await import('../src/agents/fokus.js');
  assert.equal(tidyTone('Mijoz Instagram’da rasm so‘ramaganligi sababli, rasm biriktirmasdan javob berdim.'), '[JAVOB_SHART_EMAS]');
  assert.equal(tidyTone('Ulanzi MT-84 — 30$\n\nMijoz rasm so‘ramagani uchun rasm biriktirmadim.'), 'Ulanzi MT-84 — 30$');
  assert.equal(tidyTone('Mijozlarimiz ko‘pincha shuni oladi, qulay'), 'Mijozlarimiz ko‘pincha shuni oladi, qulay');
});

test('shablon gaplar olib tashlanadi; narxli gap va oddiy javob tegilmaydi; faqat shablon bo‘lsa — javob shart emas', async () => {
  const { tidyTone } = await import('../src/agents/fokus.js');
  const src = [];
  assert.equal(tidyTone('Assalomu alaykum, xush kelibsiz! Sony ZV-E10 bor, narxi 670$.\n\nYana savollaringiz bo‘lsa yozing, doim yordam berishga tayyormiz!', src),
    'Assalomu alaykum! Sony ZV-E10 bor, narxi 670$.');
  assert.match(src[0], /savollaringiz/);
  assert.equal(tidyTone('yaxshi kunlarizga xizmat qilsin, foydali kontentlar tilab qolamiz\n\nyana biror narsa kerak bo‘lsa yozing, doim yordam berishga tayyormiz!'), '[JAVOB_SHART_EMAS]');
  assert.equal(tidyTone('Biror narsa kerak bo‘lsa, Canon R50 ham bor — narxi 690$'), 'Biror narsa kerak bo‘lsa, Canon R50 ham bor — narxi 690$', 'raqamli gap tegilmaydi');
  assert.equal(tidyTone('bor, narxi 35$\n\nqaysi kameraga?'), 'bor, narxi 35$\n\nqaysi kameraga?');
  assert.equal(tidyTone('Понял вас. Если возникнут вопросы — обращайтесь!'), 'Понял вас.');
  assert.equal(tidyTone('[JAVOB_SHART_EMAS]'), '[JAVOB_SHART_EMAS]');
  // «reels ochilmaydi» / «videoni ko‘ra olmayman» — ibora kesiladi, savol qoladi
  assert.equal(tidyTone('Assalomu aleykum, reelsdagi videoni ko‘ra olmayman. Qaysi tovar edi, nomini yozasizmi?'), 'Assalomu aleykum. Qaysi tovar edi, nomini yozasizmi?');
  assert.equal(tidyTone('Bizda reels ochilmaydi, videodagi qaysi tovar sizni qiziqtiryapti?'), 'videodagi qaysi tovar sizni qiziqtiryapti?');
  assert.equal(tidyTone('Videoni ko‘ra olmayman, afsuski bizda reels ochilmaydi.\n\nnomini yozib yuborasizmi?'), 'nomini yozib yuborasizmi?');
  assert.equal(tidyTone('Reels bizda ochilmaydi, agar nomini yozsangiz narxini aytaman'), 'agar nomini yozsangiz narxini aytaman');
  assert.equal(tidyTone('Va aleykum assalom opa, yordam bera olamanmi? Qaysi biri telefoningizga mosroq?'), 'Va aleykum assalom opa. Qaysi biri telefoningizga mosroq?');
  assert.equal(tidyTone('Здравствуйте, чем могу помочь?'), 'Здравствуйте.');
  // Story / post / rasm «ochilmayapti» (2026-10-09 jonli javob) — gap boshi bilan kesiladi; rasmdagi nom ko‘rinmasligi — oddiy gap
  assert.equal(tidyTone('afsus aka, storidagi rasm ochilmayapti, nima ekanini tushunmadim. Nomini yozib yuborasizmi?'), 'Nomini yozib yuborasizmi?');
  assert.equal(tidyTone('Post ochilmadi, qaysi tovar edi?'), 'qaysi tovar edi?');
  assert.match(tidyTone('tushundim aka, rasmdagi tovar nomi ko‘rinmayapti, qaysi model edi?'), /rasmdagi tovar nomi ko‘rinmayapti, qaysi model edi\?/);
});

test('mijozga ism bilan murojaat qilinmaydi — faqat aka/opa; username so‘zi oddiy gapni buzmaydi', async () => {
  const { hideClientName } = await import('../src/agents/fokus.js');
  assert.equal(hideClientName('Assalomu alaykum Sardor aka! Bor, narxi 120$', ['Sardor Rahimov', '@sardor_01']), 'Assalomu alaykum aka! Bor, narxi 120$');
  assert.equal(hideClientName('Sardorjon aka, keladi', ['Sardor']), 'aka, keladi');
  assert.equal(hideClientName('Sardor, narxi 120$. Rahmat, Sardor!', ['Sardor']), 'narxi 120$. Rahmat!');
  assert.equal(hideClientName('Ha, Sardor aka', ['Сардор']), 'Ha, aka', 'kirill profil nomi — lotin javobda ham');
  assert.equal(hideClientName('Сардор ака, бор', ['Сардор']), 'ака, бор');
  assert.equal(hideClientName('Malika opa, bor', ['Malika']), 'opa, bor');
  assert.equal(hideClientName('Kamera, objektiv va shtativ bor', ['@kamera_uz']), 'Kamera, objektiv va shtativ bor', 'username so‘zi — gap buzilmaydi');
  assert.equal(hideClientName('opa, bu model yengilroq', ['Malika']), 'opa, bu model yengilroq');
  assert.equal(hideClientName('bor, narxi 50$', [null, '']), 'bor, narxi 50$');
  // Ism xabarda yozilgan bo‘lsa ham (yetkazish ma’lumoti) — 2026-10-09 sinovida AI mijoz xabaridagi ismni murojaatga qo‘shgan
  const { namesInText } = await import('../src/agents/fokus.js');
  assert.deepEqual(namesInText(['Sardor Aliyev\n90 000 00 00\nQarshi shahar', 'Сардор Алиев', 'Sony ZV-E10 bormi', 'Godox Litemons LC500R']), ['Sardor', 'Сардор']);
  assert.equal(hideClientName('Xop, rahmat Sardor aka!', namesInText(['Sardor Aliyev'])), 'Xop, rahmat aka!');
});

test('sotuvchi yozadi degan va’da taniladi (topshiriqsiz qolmasin), oddiy javob — yo‘q', async () => {
  const { promisesSeller } = await import('../src/agents/fokus.js');
  for (const t of ['Hozir sotuvchimiz rasmini tashlab beradi.', 'sotuvchimiz siz bilan bog‘lanadi', 'buni sotuvchimiz aniqlab, javob beradi', 'sotuvchimiz siz bilan bir gaplashib ko‘rsin',
    'Наш менеджер уточнит наличие и актуальные цены, сейчас вам напишет.', 'Я уточню у нашего специалиста возможность заказа и напишу вам.',
    'Этих объективов сейчас нет, уточню у поставщиков, напишу вам'])
    assert.equal(promisesSeller(t), true, t);
  for (const t of ['Godox C01 bor, narxi 35$', 'Postdagi mahsulot nomini yozib yuborasizmi, aniqlab narxini aytaman.', 'хорошо, ждем чек', 'Sotuvchilarimiz ham shuni tavsiya qiladi'])
    assert.equal(promisesSeller(t), false, t);
});

test('o‘zini tanishtirish: so‘ralmasa kesiladi; ism yoki «botmisiz» so‘ralsa — tegilmaydi', async () => {
  const { cutSelfIntro, asksIdentity } = await import('../src/agents/fokus.js');
  assert.equal(cutSelfIntro('Salom Belia, men Photobuy sotuvchi yordamchisiman\n\nnima qidiryapsiz?'), 'Salom Belia\n\nnima qidiryapsiz?');
  assert.equal(cutSelfIntro('Salom! Photobuy do‘konidan Madina, Photobuy sotuvchisiman.'), 'Salom!');
  assert.equal(cutSelfIntro('Здравствуйте, я виртуальный помощник Photobuy. Какая модель интересует?'), 'Здравствуйте. Какая модель интересует?');
  assert.equal(cutSelfIntro('Godox C01 bor, narxi 35$'), 'Godox C01 bor, narxi 35$');
  assert.equal(cutSelfIntro('men Photobuy sotuvchi yordamchisiman'), '', 'faqat tanishtirish bo‘lsa — bo‘sh (javob shart emas)');
  for (const t of ['siz botmisiz?', 'ismingiz nima', 'kim bilan gaplashyapman', 'вы бот?', 'как вас зовут', 'odam bilan gaplashay', 'Исмингиз ким'])
    assert.equal(asksIdentity(t), true, t);
  // Mijoz o‘z ismini aytishi yoki yoshini so‘rashi — bizning kimligimizni so‘rash emas
  for (const t of ['Canon R50 bormi', 'Salom, mening ismim Belia, necha yoshdasiz?', 'narxi qancha', 'Здравствуйте, сколько стоит?'])
    assert.equal(asksIdentity(t), false, t);
  // «aytsangiz mos variantlarni topib beraman» — robot iborasi kesiladi
  const { tidyTone } = await import('../src/agents/fokus.js');
  assert.equal(tidyTone('nima qidiryapsiz, aytsangiz mos variantlarni topib beraman?'), 'nima qidiryapsiz?');
});

test('variant so‘rovi taniladi; «sotuvchi rasm tashlaydi» gapi mijoz rasm so‘ramasa kesiladi', async () => {
  const { asksVariants, cutPhotoPromise } = await import('../src/agents/fokus.js');
  for (const t of ['kamera tavsiya qiling', 'вариантларни корсатсангиз', 'nimalar bor', 'qaysi birini tavsiya berasz', 'что есть из петличек', 'посоветуйте свет', 'biror kamera taklif bering'])
    assert.equal(asksVariants(t), true, t);
  for (const t of ['Godox C01 bormi', 'narxi qancha', '[rasm]', 'rahmat']) assert.equal(asksVariants(t), false, t);
  assert.equal(cutPhotoPromise('kamera uchun bular bor:\n\nSony ZV E10 — 670$\n\nqaysi biri yoqdi?\n\nhozir sotuvchimiz rasmini tashlab beradi'), 'kamera uchun bular bor:\n\nSony ZV E10 — 670$\n\nqaysi biri yoqdi?');
  assert.equal(cutPhotoPromise('Hozir sotuvchimiz rasmlarini tashlab beradi.\n\nqaysi biri ma’qul?'), 'qaysi biri ma’qul?');
  assert.equal(cutPhotoPromise('Godox C01 bor, narxi 35$'), 'Godox C01 bor, narxi 35$');
  assert.equal(cutPhotoPromise('hozir sotuvchimiz siz bilan bog‘lanadi'), 'hozir sotuvchimiz siz bilan bog‘lanadi', 'rasm haqida bo‘lmasa tegilmaydi');
});

test('xodim ismi javobda bo‘lmaydi — «sotuvchimiz»; mijozning o‘z ismi tegilmaydi', async () => {
  const { hideStaffNames } = await import('../src/agents/fokus.js');
  const staff = ['Akobir Norqulov', 'Salohiddin', 'MUHAMMAD ALI', 'Dasturchi (yangi)'];
  assert.equal(hideStaffNames('xop opa, ertaga ertalab filialda kutamiz\n\nsotuvchimiz Akobir aka sizga xabar yozib, buyurtmani rasmiylashtirib qo‘yadi', staff),
    'xop opa, ertaga ertalab filialda kutamiz\n\nsotuvchimiz sizga xabar yozib, buyurtmani rasmiylashtirib qo‘yadi');
  assert.equal(hideStaffNames('Akobir aka hozir yozadi', staff), 'sotuvchimiz hozir yozadi');
  assert.equal(hideStaffNames('Salohiddin sizga qo‘ng‘iroq qiladi', staff), 'sotuvchimiz sizga qo‘ng‘iroq qiladi');
  assert.equal(hideStaffNames('Akobir aka, qaysi tovar haqida so‘rayapsiz?', staff, 'akobir'), 'Akobir aka, qaysi tovar haqida so‘rayapsiz?', 'mijozning ismi Akobir — tegilmaydi');
  assert.equal(hideStaffNames('Godox C01 bor, narxi 35$', staff), 'Godox C01 bor, narxi 35$');
});

test('$ narxdan keyin bir marta «savdo milliy valyutada» qavsi; model o‘zi yozgan bo‘lsa takrorlanmaydi; narxsiz javobga tegilmaydi', async () => {
  const { currencyNote } = await import('../src/agents/fokus.js');
  assert.equal(currencyNote('Godox CB-01 sumkasi bor, narxi 150$\n\nalohida kerakmi?'), 'Godox CB-01 sumkasi bor, narxi 150$ (savdo milliy valyutada qabul qilinadi)\n\nalohida kerakmi?');
  assert.equal(currencyNote('Sony ZV-E10 — 670$ ¶ ZV-E10 II — 1000$'), 'Sony ZV-E10 — 670$ (savdo milliy valyutada qabul qilinadi) ¶ ZV-E10 II — 1000$', 'faqat birinchisidan keyin');
  assert.equal(currencyNote('narxi 150$ (savdo milliy valyutada qabul qilinadi)'), 'narxi 150$ (savdo milliy valyutada qabul qilinadi)');
  assert.equal(currencyNote('Godox C01 — 35$, есть в наличии'), 'Godox C01 — 35$ (оплата принимается в национальной валюте), есть в наличии');
  assert.equal(currencyNote('qaysi filialdan olasiz?'), 'qaysi filialdan olasiz?');
  assert.equal(currencyNote('Ulanzi TT88 narxi 295 000 so‘m'), 'Ulanzi TT88 narxi 295 000 so‘m', 'so‘mdagi narxga qavs kerak emas');
});

test('oldin sotuvchi yoki AI aytgan narxni takrorlash bloklanmaydi', async () => {
  const { statedPrices, unknownPrices } = await import('../src/agents/fokus.js');
  assert.deepEqual(statedPrices('Godox v1 pro c narxi 240$ ¶ DJI MIC MINI 2S 1+1 130$'), [240, 130]);
  const P = new Set([70, ...statedPrices('narxi 130$ bo‘ladi')]);
  assert.equal(unknownPrices('narxi 130$ dan boshlanadi, yuqorida yozganimdek 1+1 yoki 2+2', P), null);
  assert.equal(unknownPrices('narxi 150$', P), '150$', 'yangi narx baribir faqat katalogdan');
});

test('BILLZ aksiyasi va do‘kondagi farqli narx: tekshiruv to‘xtatmaydi; modelga tayyor «aksiya» matni boradi', async () => {
  const { unknownPrices, billzPrices, promoLabel } = await import('../src/agents/fokus.js');
  const b = { price: 300, currency: 'USD', stale: false, price_by_branch: { Photobuy: '300 $', Photobuy2: '1 320 $' },
    promo: [{ branch: 'Photobuy', price: 250, name: 'Kuzgi aksiya' }], promo_info: { price: 250, name: 'Kuzgi aksiya', partial: false, branches: ['Photobuy'] } };
  assert.equal(unknownPrices('hozir aksiyada 250$', new Set([300])), '250$', 'eski holat: faqat oddiy narx bilinardi — to‘xtatilardi');
  assert.equal(unknownPrices('hozir aksiyada 250$, odatda 300$; ikkinchi do‘konda 1320$', new Set(billzPrices(b))), null);
  assert.deepEqual(billzPrices(null), []);
  assert.equal(promoLabel(b), 'AKSIYADA — hozirgi narx 250 $, odatiy narx 300 $, «Kuzgi aksiya»');
  assert.match(promoLabel({ ...b, promo_info: { ...b.promo_info, partial: true } }), /; aksiya faqat Photobuy do‘konida$/);
  assert.equal(promoLabel({ ...b, stale: true }), null, 'eskirgan ma’lumot — aksiya aytilmaydi');
  assert.equal(promoLabel({ price: 300 }), null);

  // To‘liq yo‘l: model aksiya narxini aytadi — qayta so‘ralmaydi, javob qoladi
  const acct = one('SELECT * FROM accounts WHERE id=?', run(`INSERT INTO accounts(channel,ext_id,name,can_reply,enabled,mode,rollout,created_at) VALUES('tg','aks1','Sinov',1,1,'kechiksa','kuzatish',?)`, Date.now()).lastInsertRowid);
  run(`INSERT INTO products(name,category,price,price_json,stock_json,stock_synced_at,status,billz_id,updated_at) VALUES('AKSIYALI SL60W SINOV','Свет',300,?,?,?,'draft','B-aks-1',?)`,
    JSON.stringify({ Photobuy: { price: 300, currency: 'USD', promo: 250, promo_name: 'Kuzgi aksiya' } }), JSON.stringify({ Photobuy: 3 }), Date.now(), Date.now());
  const c = ingestClient(acct, { extChatId: 'aks-1', extUserId: 801, name: 'M', text: 'AKSIYALI SL60W narxi qancha?', extMsgId: 1, ts: Date.now() });
  reset(say([{ functionCall: { id: 'a1', name: 'search_catalog', args: { query: 'AKSIYALI SL60W' } } }]),
    say([{ text: 'Hozir aksiyada 250$, odatda 300$. Do‘konda bor 😊' }]));
  const d = await fokusDraft({ conv: one('SELECT * FROM conversations WHERE id=?', c.id), acct });
  assert.equal(d.ok, true, JSON.stringify(d));
  assert.match(d.text, /aksiyada 250\$/);
  assert.equal(calls.filter(x => /generateContent/.test(x.url)).length, 2, 'aksiya narxi haqiqiy narx deb tanildi — qayta so‘ralmadi');
  const fr = JSON.stringify(calls[1].body.contents.at(-1));
  assert.match(fr, /AKSIYADA/, 'modelga tayyor aksiya matni bordi');
  assert.doesNotMatch(fr, /promo/, 'xom promo ro‘yxati yuborilmaydi');
});

test('aralash rejim: «model» berilsa — so‘rov o‘sha modelga; berilmasa — asosiy; qiyin holatni tanish', async () => {
  const { needsStrong, asksPrice } = await import('../src/agents/fokus.js');
  reset(say([{ text: 'ok' }]));
  await runAgent({ system: 's', userContent: 'u', model: 'kuchli-sinov-flash' });
  assert.match(calls[0].url, /kuchli-sinov-flash/, 'kuchli model birinchi');
  reset(say([{ text: 'ok' }]));
  await runAgent({ system: 's', userContent: 'u' });
  assert.doesNotMatch(calls[0].url, /kuchli-sinov-flash/, 'oddiy holat — asosiy model');
  assert.equal(calls[0].body.generationConfig.thinkingConfig.thinkingLevel, 'low', 'lite bo‘lmagan modelga «minimal» yuborilmaydi (3.8 Flash uni rad etadi)');
  assert.equal(needsStrong({ attachments: 1, text: '[rasm] nechpul' }), true, 'rasm — kuchli model');
  assert.equal(needsStrong({ text: 'kamera tavsiya qiling' }), false, 'variant — arzon model («low» bilan yetarli; narxsiz bo‘lsa ko‘tariladi)');
  assert.equal(needsStrong({ text: 'Canon R6 — 2 dona\nRF 24-105 — 2 dona\nGodox V1 — 3 dona\nTripod — 4 dona\nLark M2 — 2 dona' }), true, 'katta ro‘yxat');
  assert.equal(needsStrong({ text: 'Godox C01 bormi narxi qancha' }), false, 'oddiy narx savoli — arzon model');
  assert.equal(needsStrong({ text: 'Assalomu alaykum' }), false);
  for (const t of ['nechpul', 'narxi qancha', 'Nech pul', 'сколько стоит', 'канча', 'Qanca']) assert.equal(asksPrice(t), true, t);
  assert.equal(asksPrice('rahmat'), false);
});

test('bo‘sh javob: savol («Nechpul») bo‘lsa jim qolinmaydi (xato — sotuvchi ko‘radi); faqat «xop rahmat» bo‘lsa — javob shart emas', async () => {
  const acct = one('SELECT * FROM accounts WHERE id=?', run(`INSERT INTO accounts(channel,ext_id,name,can_reply,enabled,mode,rollout,created_at) VALUES('tg','bo1','Sinov',1,1,'kechiksa','kuzatish',?)`, Date.now()).lastInsertRowid);
  const c1 = ingestClient(acct, { extChatId: 'bosh-1', extUserId: 701, name: 'M', text: 'Nechpul', extMsgId: 1, ts: Date.now() });
  reset(say([{ text: '' }]), say([{ text: '' }]));
  const d1 = await fokusDraft({ conv: one('SELECT * FROM conversations WHERE id=?', c1.id), acct });
  assert.equal(d1.ok, false, 'narx savoli — «javob shart emas» deb yopilmaydi');
  assert.equal(calls.filter(c => /generateContent/.test(c.url)).length, 2, 'bo‘sh javob bir marta qayta so‘raldi');
  const c2 = ingestClient(acct, { extChatId: 'bosh-2', extUserId: 702, name: 'M', text: 'xop rahmat', extMsgId: 2, ts: Date.now() });
  reset(say([{ text: '' }]), say([{ text: '' }]));
  const d2 = await fokusDraft({ conv: one('SELECT * FROM conversations WHERE id=?', c2.id), acct });
  assert.equal(d2.ok, true); assert.equal(d2.noReply, true, 'tasdiq — javob shart emas');
});

test('o‘zbekcha kirill javob lotinga o‘giriladi, ruscha javobga tegilmaydi', async () => {
  const { uzLatin } = await import('../src/agents/fokus.js');
  assert.equal(uzLatin('макул, кутаман. тўлов қилиб чекини ташласангиз, дарров йўлга қўямиз.'), 'makul, kutaman. to‘lov qilib chekini tashlasangiz, darrov yo‘lga qo‘yamiz.');
  assert.equal(uzLatin('Ертага келади, ғилоф ҳам бор'), 'Yertaga keladi, g‘ilof ham bor');
});

test('mijoz rasm so‘radimi: «[rasm]» belgisi, «rasmiy», «rasm olish», «fotoapparat» — so‘rov emas', () => {
  for (const t of ['Rasmlarini tawen', 'ikkalasinixam rasmi bilan xarakteristikasini yuboring', 'Iltimos rasmi, qanday bo‘lishini ko‘rsata olasizmi?',
    'расмини ташланг', 'фото можно?', 'покажите пожалуйста', 'qanaqa ko‘rinishda'])
    assert.equal(asksPhoto([t]), true, t);
  for (const t of ['[rasm]', '[yo‘naltirilgan] [rasm] narxi?', 'здравствуйте можно узнать цены на фотоапарат canon', 'расм олиш учун керак',
    'rasmiy kafolat bormi', 'suratga olish uchun kamera kerak', 'DJI Osmo Mobile 7 bormi? narxi qancha'])
    assert.equal(asksPhoto([t]), false, t);
});

test('Google qidiruvi funksiyalar bilan ishlamasa — qidiruvsiz qayta so‘raladi', async () => {
  reset({ status: 400, message: 'Tool use with function calling is unsupported' }, say([{ text: 'ok' }]));
  const r = await runAgent({ system: 's', userContent: 'u', serverTools: [{ type: 'web_search_20260209', name: 'web_search' }],
    tools: [{ name: 'save_card', description: 'x', input_schema: { type: 'object', properties: { a: { type: 'string' } } } }], handlers: {} });
  assert.equal(r.text, 'ok');
  assert.ok(calls[0].body.tools.some(t => t.googleSearch));
  assert.ok(!calls[1].body.tools.some(t => t.googleSearch));
});

test('xavfsizlik bloki — refusal xatosi (qoralama yozilmaydi)', async () => {
  reset({ candidates: [{ content: { parts: [] }, finishReason: 'SAFETY' }] });
  await assert.rejects(runAgent({ system: 's', userContent: 'u' }), e => e instanceof AiError && e.code === 'refusal');
});

test('ovoz: Gemini matnga aylantiradi; Gemini ishlamasa Whisper’ga o‘tadi', async () => {
  reset(say([{ text: 'Assalomu alaykum, Canon R50 bormi?' }]));
  const r = await transcribe(Buffer.from('OggS-sinov'), 'audio/ogg');
  assert.equal(r.text, 'Assalomu alaykum, Canon R50 bormi?');
  assert.equal(r.via, 'gemini');
  assert.equal(calls[0].body.contents[0].parts[0].inlineData.mimeType, 'audio/ogg');
  reset({ status: 403, message: 'yo‘q' });
  await assert.rejects(transcribe(Buffer.from('OggS'), 'audio/ogg'), /stt_off/, 'Gemini rad etdi → Whisper (bu kompyuterda yo‘q)');
});

test('mijoz rasmi AI so‘roviga ilova qilinadi (Telegram rasmi — JPEG)', async () => {
  const acct = one('SELECT * FROM accounts WHERE id=?', run(`INSERT INTO accounts(channel,ext_id,name,can_reply,enabled,mode,rollout,created_at) VALUES('tg','bc9','Photobuy.uz',1,1,'kechiksa','kuzatish',?)`, Date.now()).lastInsertRowid);
  mkdirSync(join(dir, 'files'), { recursive: true });
  writeFileSync(join(dir, 'files', 'rasm1'), Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]));   // telegramFile keshi
  const conv = ingestClient(acct, { extChatId: '555', extUserId: 555, name: 'Rasmli Mijoz', text: '[rasm] shu bormi?', extMsgId: 1, ts: Date.now(),
    meta: { media: { kind: 'photo', file_id: 'F1', uid: 'rasm1', mime: 'image/jpeg', size: 7 } } });
  reset(say([{ text: 'Bu Sony ZV-E10 — bor, narxini aytaman.' }]));
  const d = await fokusDraft({ conv, acct });
  assert.equal(d.ok, true);
  // 1-qadam ham keshdan: ko‘rsatma va vositalar so‘rov ichida emas, kesh nomi bilan (sarfning ~25% shu edi)
  assert.ok(calls[0].body.cachedContent, '1-so‘rov keshli');
  assert.ok(!calls[0].body.systemInstruction && !calls[0].body.tools, 'ko‘rsatma/vositalar qayta yuborilmaydi');
  assert.ok(cacheCalls.at(-1).body.systemInstruction.parts[0].text.length > 8000, 'kesh ichida to‘liq ko‘rsatma');
  const parts = calls[0].body.contents[0].parts;
  assert.equal(parts[1].inlineData.mimeType, 'image/jpeg');
  assert.equal(parts[1].inlineData.data, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64'));
  assert.match(parts[0].text, /MIJOZ YUBORGAN RASM\(LAR\) \/ ULASHGAN POST: 1 ta/);
});

test('Instagram story video bo‘lsa — AI’ga videodan 3 ta kadr bitta JPEG rasmda boradi; qayta chaqirilganda keshdan; faqat ovoz — kadr yo‘q', async (t) => {
  const { execFileSync } = await import('node:child_process');
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); } catch { t.skip('ffmpeg o‘rnatilmagan'); return; }
  const f = join(dir, 'story.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=3:size=360x640:rate=10', '-pix_fmt', 'yuv420p', '-y', f]);
  mediaBytes = readFileSync(f);
  const acct = one('SELECT * FROM accounts WHERE id=?', run(`INSERT INTO accounts(channel,ext_id,name,can_reply,enabled,mode,rollout,created_at) VALUES('ig','igv1','IG sinov',1,1,'kechiksa','kuzatish',?)`, Date.now()).lastInsertRowid);
  // Meta story havolasini «rasm» deb beradi (storyMeta), aslida — MP4
  const c = ingestClient(acct, { extChatId: 'igv-1', extUserId: 'u1', name: 'Sardor', text: '[storyga javob] qancha', extMsgId: 'mv1', ts: Date.now(),
    meta: { media: { ch: 'ig', kind: 'photo', url: 'https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=777&signature=a', mime: 'image/jpeg', story: true }, story_reply: true } });
  const conv = one('SELECT * FROM conversations WHERE id=?', c.id);
  const { recentImages } = await import('../src/agents/fokus.js');
  const imgs = await recentImages(conv, acct);
  assert.equal(imgs.length, 1, 'video tashlab yuborilmadi');
  assert.equal(imgs[0].mime, 'image/jpeg');
  assert.equal(imgs[0].video, true);
  const kadr = join(dir, 'kadr.jpg');
  writeFileSync(kadr, Buffer.from(imgs[0].data, 'base64'));
  assert.equal(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', kadr]).toString().trim(), '1080,640', '3 ta tik kadr yonma-yon');
  const n = mediaFetches;
  assert.equal((await recentImages(conv, acct)).length, 1);
  assert.equal(mediaFetches, n, 'ikkinchi marta — keshdan, video qayta yuklanmadi');
  // AI so‘rovida: kadrlar rasmi va «3 ta kadr» izohi
  reset(say([{ text: 'bu chiroqmi yoki shtativmi?' }]));
  const d = await fokusDraft({ conv, acct });
  assert.equal(d.ok, true, JSON.stringify(d));
  const parts = calls[0].body.contents[0].parts;
  assert.match(parts[0].text, /3 ta kadr bitta rasmda/);
  assert.equal(parts.filter(p => p.inlineData?.mimeType === 'image/jpeg').length, 1);
  // Instagram ovozli xabari ham «ftyp» (m4a) — tasvir yo‘q, kadr olinmaydi
  const { videoFrames } = await import('../src/services/media.js');
  const a = join(dir, 'ovoz.m4a');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=duration=1', '-c:a', 'aac', '-y', a]);
  assert.equal(await videoFrames(readFileSync(a)), null);
});

test('paneldan kalit: faqat admin/rahbar; tekshiruvdan o‘tsa saqlanadi va darhol ishlaydi, kalit javobda yo‘q', async () => {
  const { saveGeminiKey, aiKeysFile } = await import('../src/services/ai-keys.js');
  const { readFileSync, statSync } = await import('node:fs');
  const { config } = await import('../src/config.js');
  assert.equal((await saveGeminiKey('qisqa', 'Rahbar')).ok, false);
  assert.match((await saveGeminiKey('sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaa', 'Rahbar')).why, /Anthropic/);
  // AI Studio ro‘yxati → barqaror flash (preview’dan ustun, lite/embedding emas) tanlanadi va sinovdan o‘tadi
  reset({ models: [{ name: 'models/gemini-9.1-flash-lite', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-9.0-flash', supportedGenerationMethods: ['generateContent'] },
    { name: 'models/gemini-9.2-flash-preview-09-2026', supportedGenerationMethods: ['generateContent'] }, { name: 'models/text-embedding-9', supportedGenerationMethods: ['embedContent'] }] },
    say([{ text: 'tayyor' }]));
  const r = await saveGeminiKey('AQ.yangi-sinov-kaliti-1234567890', 'Rahbar');
  assert.deepEqual(r, { ok: true, model: 'gemini-9.0-flash', endpoint: 'ai' });
  assert.ok(!JSON.stringify(r).includes('AQ.yangi'), 'kalit javobda qaytmaydi');
  assert.equal(config.geminiModel, 'gemini-9.0-flash');
  assert.equal(config.geminiKey, 'AQ.yangi-sinov-kaliti-1234567890');
  assert.match(readFileSync(aiKeysFile(), 'utf8'), /^GEMINI_API_KEY=AQ\.yangi-sinov-kaliti-1234567890\nGEMINI_ENDPOINT=ai\nGEMINI_MODEL=gemini-9\.0-flash\nGEMINI_FALLBACKS=gemini-9\.2-flash-preview-09-2026,gemini-9\.1-flash-lite\nAI_PROVIDER=gemini\n$/);
  assert.equal(statSync(aiKeysFile()).mode & 0o777, 0o600);
  // AI Studio rad etsa — Vertex express sinaladi
  reset({ status: 403, message: 'API key not valid' }, say([{ text: 'tayyor' }]));
  const v = await saveGeminiKey('AQ.vertex-sinov-kaliti-1234567890', 'Rahbar');
  assert.equal(v.endpoint, 'vertex');
  assert.match(calls[1].url, /^https:\/\/aiplatform\.googleapis\.com\/v1\/publishers\/google\/models\//);
});

test('429: daqiqalik limit — Google aytgan vaqtcha kutib qayta; kunlik limit — darhol quota_day', async () => {
  const { geminiPost, quotaInfo } = await import('../src/ai/gemini.js');
  const q429 = (id, delay) => ({ status: 429, raw: JSON.stringify({ error: { code: 429, status: 'RESOURCE_EXHAUSTED', details: [
    { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaMetric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests', quotaId: id, quotaValue: '5' }] },
    { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: delay }] } }) });
  assert.deepEqual(quotaInfo(q429('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '8.49s').raw), { perDay: false, perMinLimit: 5, waitMs: 8490, free: true });
  reset(q429('GenerateRequestsPerMinutePerProjectPerModel-FreeTier', '0.05s'), say([{ text: 'ok' }]));
  const r = await geminiPost({ contents: [] }, { model: 'kvota-model' });
  assert.equal(r.candidates[0].content.parts[0].text, 'ok');
  assert.equal(calls.length, 2, 'kutib qayta urindi');
  reset(q429('GenerateRequestsPerDayPerProjectPerModel-FreeTier', '3600s'));
  await assert.rejects(geminiPost({ contents: [] }, { model: 'kvota-model-2' }), e => e.code === 'quota_day');
  assert.equal(calls.length, 1, 'kunlik limitda kutilmaydi');
});

test('modellar zanjiri: asosiy model kunlik limitga yetsa yoki band bo‘lsa — keyingisi, u bir muddat chetlanadi', async () => {
  const { config } = await import('../src/config.js');
  const { modelChain, resetModelCooling } = await import('../src/ai/gemini.js');
  const saved = { m: config.geminiModel, f: config.geminiFallbacks };
  Object.assign(config, { geminiModel: 'zanjir-a', geminiFallbacks: ['zanjir-b', 'zanjir-c'] });
  resetModelCooling();
  const day = { status: 429, raw: JSON.stringify({ error: { details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', quotaValue: '20' }] }] } }) };
  reset(day, { status: 503, message: 'high demand' }, say([{ text: 'zaxira model javobi' }]));
  const r = await runAgent({ system: 's', userContent: 'u' });
  assert.equal(r.text, 'zaxira model javobi');
  assert.deepEqual(calls.map(c => c.url.match(/models\/([^:]+):/)[1]), ['zanjir-a', 'zanjir-b', 'zanjir-c']);
  assert.deepEqual(modelChain(), ['zanjir-c'], 'limitga yetgan va band modellar chetlandi');
  reset(say([{ text: 'yana' }]));
  await runAgent({ system: 's', userContent: 'u' });
  assert.match(calls[0].url, /zanjir-c/, 'keyingi so‘rov darhol ishlaydigan modelga');
  Object.assign(config, { geminiModel: saved.m, geminiFallbacks: saved.f });
  resetModelCooling();
});

test('«minimal» ni qabul qilmagan model «low» ga o‘tadi, «low» ham o‘tmasa — faqat o‘zida o‘chadi, boshqalarida qoladi', async () => {
  const { geminiPost } = await import('../src/ai/gemini.js');
  reset({ status: 400, message: 'Thinking level MINIMAL is not supported for this model.' }, say([{ text: 'ok' }]), say([{ text: 'ok2' }]));
  await geminiPost({ contents: [], generationConfig: { maxOutputTokens: 10, thinkingConfig: { thinkingLevel: 'minimal' } } }, { model: 'eski-model' });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.generationConfig.thinkingConfig.thinkingLevel, 'minimal', '1-urinish: minimal');
  assert.equal(calls[1].body.generationConfig.thinkingConfig.thinkingLevel, 'low', '2-urinish: shu modelga «low» (fikrlash o‘chmaydi — o‘chsa qimmat)');
  await geminiPost({ contents: [], generationConfig: { maxOutputTokens: 10, thinkingConfig: { thinkingLevel: 'low' } } }, { model: 'yangi-model' });
  assert.ok(calls[2].body.generationConfig.thinkingConfig, 'boshqa modelga fikrlash baribir yuboriladi');
  reset({ status: 400, message: 'Thinking level MINIMAL is not supported for this model.' }, { status: 400, message: 'Thinking level LOW is not supported for this model.' }, say([{ text: 'ok' }]));
  await geminiPost({ contents: [], generationConfig: { maxOutputTokens: 10, thinkingConfig: { thinkingLevel: 'minimal' } } }, { model: 'juda-eski-model' });
  assert.equal(calls.length, 3);
  assert.equal(calls[1].body.generationConfig.thinkingConfig.thinkingLevel, 'low');
  assert.ok(!calls[2].body.generationConfig.thinkingConfig, '«low» ham o‘tmasa — shu modelga fikrlashsiz');
});
