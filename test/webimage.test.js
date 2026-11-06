/*
  Tovar rasmi internetdan: faqat brend domenidagi sahifa, sahifadan mahsulot rasmi (JSON-LD, og:image),
  o‘lcham tekshiruvi, AI «aynan shu mahsulotmi» tasdig‘i; tasdiqlanmasa saqlanmaydi.
*/
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'sales-wimg-'));
Object.assign(process.env, { DB_FILE: join(dir, 't.db'), DATA_DIR: dir, TG_DISABLED: '1', GEMINI_API_KEY: 'sinov', GEMINI_MODEL: 'g-sinov', ENV_FILE: join(dir, 'yoq.env') });
const { migrate, run, one } = await import('../src/db.js');
const W = await import('../src/services/webimage.js');

// 600×600 JPEG sarlavhasi (SOF0) — o‘lcham tekshiruvi uchun yetarli
const jpeg = (w, h) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255]), Buffer.alloc(3000, 1)]);
let answer = 'HA', calls = [];
const realFetch = globalThis.fetch;
before(() => {
  migrate();
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url); calls.push(u);
    if (u.includes('generativelanguage')) {
      const body = JSON.parse(opts.body);
      if (body.tools) return Response.json({ candidates: [{ content: { parts: [{ text: 'https://www.godox.com/product/sl60iibi' }] },
        groundingMetadata: { groundingChunks: [{ web: { uri: 'https://shop.boshqa-dokon.uz/godox-sl60' } }, { web: { uri: 'https://www.godox.com/product/sl60iibi' } }] } }] });
      return Response.json({ candidates: [{ content: { parts: [{ text: answer }] } }] });
    }
    if (u === 'https://www.godox.com/product/sl60iibi') return new Response(`<html><head><meta property="og:image" content="/img/banner.jpg">
      <script type="application/ld+json">{"@type":"Product","name":"SL60IIBi","image":["https://www.godox.com/img/sl60.jpg"]}</script></head></html>`, { headers: { 'content-type': 'text/html' } });
    if (u === 'https://www.godox.com/img/sl60.jpg') return new Response(jpeg(1200, 1200), { headers: { 'content-type': 'image/jpeg' } });
    if (u === 'https://www.godox.com/img/banner.jpg') return new Response(jpeg(300, 100), { headers: { 'content-type': 'image/jpeg' } });
    return new Response('yo‘q', { status: 404 });
  };
});
after(() => { globalThis.fetch = realFetch; rmSync(dir, { recursive: true, force: true }); });

test('yordamchilar: brend domeni, sahifadagi rasm, o‘lcham', () => {
  assert.equal(W.brandHost('https://store.dji.com/product/mic-mini', 'dji'), true);
  assert.equal(W.brandHost('https://shop.boshqa-dokon.uz/godox-sl60', 'godox'), false, 'begona do‘kon domeni');
  const imgs = W.pageImages('<meta property="og:image" content="/a.jpg"><script type="application/ld+json">{"@graph":[{"@type":"Product","image":{"url":"https://x.com/p.jpg"}}]}</script>', 'https://x.com/page');
  assert.deepEqual(imgs, ['https://x.com/p.jpg', 'https://x.com/a.jpg'], 'avval mahsulot rasmi, keyin og:image');
  const g = W.pageImages('<img src="/static/logo.png"><img src="/static/upload/image/1.jpg" alt=""><img data-src="/up/2.webp?v=1"><img src="/i/icon-cart.svg">', 'https://www.godox.com/p.html');
  assert.deepEqual(g, ['https://www.godox.com/static/upload/image/1.jpg', 'https://www.godox.com/up/2.webp?v=1'], 'oddiy <img>: logo va ikonka olinmaydi');
  assert.deepEqual(W.imageSize(jpeg(1200, 800)), { w: 1200, h: 800, t: 'jpeg' });
  assert.deepEqual(W.modelTokens('Ulanzi TT88 Overhead Selfie Stick — SELFI PALKA'), ['tt88']);
  assert.ok(W.modelTokens('HOLLYLAND LARK M2 — Петличка микрофон').includes('larkm2'), 'qisqa kod oldingi so‘z bilan');
  assert.ok(W.modelTokens('Godox SL60BI II — Осветительный прибор').includes('sl60iibi'), 'avlod raqami boshqa joyda');
  assert.equal(W.pageMatchesModel('https://www.hollyland.com/product/lark-m2', '<title>Hollyland Lark M2</title>', 'HOLLYLAND LARK M2'), true);
  assert.deepEqual(W.bigVariants('https://cdn.djiits.com/u/abc@374*374.png'), ['https://cdn.djiits.com/u/abc.png', 'https://cdn.djiits.com/u/abc@374*374.png']);
  assert.equal(W.bigVariants('https://ulanzi.com/f/x_600x600.jpg?v=12')[0], 'https://ulanzi.com/f/x.jpg?v=12');
  assert.equal(W.pageMatchesModel('https://www.ulanzi.com/products/magsafe-overhead-selfie-stick-t111', '<title>Ulanzi T111</title>', 'Ulanzi TT88 Overhead Selfie Stick'), false, 'TT88 ≠ T111');
  assert.equal(W.pageMatchesModel('https://store.dji.com/product/dji-mic-mini-2', '<title>DJI Mic Mini 2</title>', 'DJI MIC MINI 2 — Петличка микрофон'), true);
});

test('rasmiy saytdan mahsulot rasmi olinadi, begona do‘kon va kichik banner olinmaydi', async () => {
  const id = run(`INSERT INTO products(name,brand,price,stock_json,updated_at) VALUES('GODOX SL60II BI','Godox',150,'{}',?)`, Date.now()).lastInsertRowid;
  const r = await W.findProductImage(id);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.source, 'https://www.godox.com/product/sl60iibi');
  const p = one('SELECT image_url, image_source FROM products WHERE id=?', id);
  assert.match(p.image_url, /^web:/);
  assert.ok(!calls.some(u => u.includes('boshqa-dokon')), 'begona do‘kon sahifasi ochilmadi');
  // Nomzodlar parallel yuklanadi — kichik banner ham yuklanishi mumkin, lekin saqlangani mahsulot rasmi (1200×1200)
  const { readFileSync } = await import('node:fs');
  const saved = readFileSync(join(dir, 'photos', p.image_url.slice(4)));
  assert.deepEqual(W.imageSize(saved), { w: 1200, h: 1200, t: 'jpeg' }, 'banner (300×100) emas, mahsulot rasmi saqlandi');
});

test('AI «bu shu mahsulot emas» desa — rasm saqlanmaydi', async () => {
  answer = 'YOQ';
  const id = run(`INSERT INTO products(name,brand,price,stock_json,updated_at) VALUES('GODOX SL60II BI 2','Godox',150,'{}',?)`, Date.now()).lastInsertRowid;
  const r = await W.findProductImage(id);
  assert.equal(r.ok, false);
  assert.equal(one('SELECT image_url FROM products WHERE id=?', id).image_url, null);
});

test('bir tovarga bir vaqtda ikki so‘rov — internet qidiruvi bitta, ikkinchisi o‘sha natijani kutadi', async () => {
  answer = 'HA';
  const id = run(`INSERT INTO products(name,brand,price,stock_json,updated_at) VALUES('GODOX SL60II BI 3','Godox',150,'{}',?)`, Date.now()).lastInsertRowid;
  calls = [];
  const [a, b] = await Promise.all([W.findProductImage(id), W.findProductImage(id)]);
  assert.equal(a.ok, true, JSON.stringify(a));
  assert.deepEqual(b, a);
  assert.equal(calls.filter(u => u === 'https://www.godox.com/product/sl60iibi').length, 1, 'sahifa bir marta ochildi');
  assert.deepEqual(await W.findProductImage(id), { ok: true, already: true });
});
