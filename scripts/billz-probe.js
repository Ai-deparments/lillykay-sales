/*
  BILLZ ulanishini tekshirish — faqat O‘QISH, bazaga hech narsa yozmaydi.
  Chiqaradi: soni, maydon nomlari va turlari. Mijozlarning ismi/telefoni chiqarilmaydi.
  Serverda: ENV_FILE=/opt/sales/.env node /opt/sales/app/scripts/billz-probe.js
*/
import { billz } from '../src/services/billz-api.js';
import { config } from '../src/config.js';

const shape = (o, depth = 0) => {
  if (Array.isArray(o)) return o.length ? [shape(o[0], depth + 1)] : [];
  if (o && typeof o === 'object') return depth > 2 ? '{…}' : Object.fromEntries(Object.keys(o).sort().map(k => [k, shape(o[k], depth + 1)]));
  return o === null ? 'null' : typeof o;
};
/* Sana formatini ko‘rsatish (raqamlar niqoblanadi): "2026-09-18 14:05:00" → "dddd-dd-dd dd:dd:dd" */
const fmt = s => typeof s === 'string' ? s.replace(/\d/g, 'd') : typeof s;
const ymd = d => new Date(d.getTime() + 5 * 3600e3).toISOString().slice(0, 10);

async function step(name, fn) {
  try { const r = await fn(); console.log(`✔ ${name}`); if (r !== undefined) console.log(JSON.stringify(r, null, 1)); }
  catch (e) { console.log(`✖ ${name}: ${e.message}`); }
}

console.log(`BILLZ: ${config.billzBase} · kalit ${config.billzToken ? config.billzToken.length + ' belgi' : 'YO‘Q'}`);
try { await billz('GET', '/v1/shop', { query: { limit: 1, page: 1 } }); console.log('✔ kirish (token olindi)'); }
catch (e) { console.log(`✖ kirish: ${e.message}`); process.exit(1); } // kalit ishlamasa — boshqa so‘rov yuborilmaydi
let SHOPS = '';
await step('magazinlar', async () => {
  const j = await billz('GET', '/v1/shop', { query: { limit: 100, page: 1 } });
  SHOPS = (j.shops || []).map(s => s.id).join(',');
  return { count: j.count, names: (j.shops || []).map(s => s.name) };
});
await step('tovarlar (1 ta namuna tuzilmasi)', async () => {
  const j = await billz('GET', '/v2/products', { query: { limit: 1, page: 1, include_empty_stocks: 'true' } });
  const p = j.products?.[0];
  return { count: j.count, keys: p ? shape(p) : null, updated_at_format: fmt(p?.updated_at), shops_in_stock: p?.shop_measurement_values?.length, shops_in_price: p?.shop_prices?.length };
});
await step('mijozlar (faqat maydon nomlari)', async () => {
  const j = await billz('GET', '/v1/client', { query: { limit: 1, page: 1 } });
  const c = j.clients?.[0];
  return { count: j.count, keys: c ? Object.keys(c).sort() : null, phone_format: c?.phone_numbers?.[0] ? fmt(c.phone_numbers[0]) : null, balance_type: typeof c?.balance };
});
const y = new Date(Date.now() - 864e5), w = new Date(Date.now() - 7 * 864e5);
await step(`mijoz xaridlari ${ymd(w)}…${ymd(y)} (tuzilma)`, async () => {
  const j = await billz('GET', '/v1/customer-purchases-table', { query: { start_date: ymd(w), end_date: ymd(y), with_customers: 'false', limit: 3, page: 1, currency: 'UZS', shop_ids: SHOPS } });
  const rows = j.purchases || j.data?.purchases || [];
  const r = rows[0];
  return {
    top_keys: Object.keys(j || {}), count: j.count ?? j.data?.count, rows: rows.length, keys: r ? shape(r) : null,
    formats: r ? Object.fromEntries(Object.entries(r).filter(([k]) => /date|_at|time/i.test(k)).map(([k, v]) => [k, fmt(v)])) : null,
    order_types: [...new Set(rows.map(x => x.order_type))]
  };
});
await step(`tranzaksiyalar ${ymd(y)} (tuzilma)`, async () => {
  const j = await billz('GET', '/v1/transaction-report-table', { query: { start_date: ymd(y), end_date: ymd(y), limit: 2, page: 1, shop_ids: SHOPS } });
  const r = j.rows?.[0];
  return { top_keys: Object.keys(j || {}), count: j.count, keys: r ? shape(r) : null };
});
await step(`umumiy hisobot ${ymd(y)} (magazin × kun)`, async () => {
  const j = await billz('GET', '/v1/general-report-table', { query: { start_date: ymd(y), end_date: ymd(y), detalization: 'day', currency: 'UZS', limit: 50, page: 1, shop_ids: SHOPS } });
  const rows = j.shop_stats_by_date || j.rows || j.data?.rows || [];
  return { top_keys: Object.keys(j || {}), rows: Array.isArray(rows) ? rows.length : typeof rows, keys: Array.isArray(rows) && rows[0] ? shape(rows[0]) : null };
});
process.exit(0);
