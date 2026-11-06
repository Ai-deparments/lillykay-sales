/*
  Q6 nazorat hisobi: tizim hisoblagan sof savdo va cheklar ↔ BILLZ umumiy hisobot (net_gross_sales), magazinlar kesimida. Faqat o‘qish.
  Serverda: sudo -u sales env ENV_FILE=/opt/sales/.env node scripts/billz-check.js <kun YYYY-MM-DD> <davr boshi> <davr oxiri>
*/
import { billz } from '../src/services/billz-api.js';
import { all, one } from '../src/db.js';
const shops = all('SELECT billz_shop_id, name FROM branches WHERE billz_shop_id IS NOT NULL');
const ids = shops.map(s => s.billz_shop_id).join(',');
const day = d => Date.parse(`${d}T00:00:00+05:00`);
async function billzNet(from, to) {
  const j = await billz('GET', '/v1/general-report-table', { query: { start_date: from, end_date: to, detalization: 'day', currency: 'UZS', limit: 500, page: 1, shop_ids: ids } });
  const rows = j.shop_stats_by_date || [];
  const by = {};
  for (const r of rows) { const k = r.shop_name || '?'; by[k] = by[k] || { net: 0, gross: 0, orders: 0, returns: 0 }; by[k].net += r.net_gross_sales || 0; by[k].gross += r.gross_sales || 0; by[k].orders += r.orders_count || 0; by[k].returns += r.returns_count || 0; }
  return { rows: rows.length, by };
}
function ours(from, to) {
  const s = day(from), e = day(to) + 864e5;
  // Panel hisobi (obyektiv.facts) bilan bir xil: «Обмен» cheki sotuv cheklari soniga kirmaydi
  const r = all(`SELECT branch_name b, kind, sum(amount) a, count(DISTINCT CASE WHEN COALESCE(order_type,'') NOT IN ('Обмен','EXCHANGE') THEN receipt END) n
    FROM purchases WHERE is_demo=0 AND sold_at>=? AND sold_at<? GROUP BY b, kind`, s, e);
  const by = {};
  for (const x of r) { by[x.b] = by[x.b] || { sales: 0, returns: 0, checks: 0 }; if (x.kind === 'return') by[x.b].returns += x.a; else { by[x.b].sales += x.a; by[x.b].checks += x.n; } }
  return by;
}
for (const [from, to] of [[process.argv[2], process.argv[2]], [process.argv[3], process.argv[4]]]) {
  const b = await billzNet(from, to), o = ours(from, to);
  console.log(`\n${from}…${to} (BILLZ qatorlari: ${b.rows})`);
  const names = [...new Set([...Object.keys(b.by), ...Object.keys(o)])];
  let tb = 0, to_ = 0;
  for (const n of names) {
    const bb = b.by[n] || { net: 0, gross: 0, orders: 0, returns: 0 }, oo = o[n] || { sales: 0, returns: 0, checks: 0 };
    const net = oo.sales - oo.returns; tb += bb.net; to_ += net;
    console.log(`  ${n.padEnd(18)} BILLZ sof ${Math.round(bb.net).toLocaleString('ru-RU').padStart(14)} | tizim ${Math.round(net).toLocaleString('ru-RU').padStart(14)} | farq ${Math.round(net - bb.net).toLocaleString('ru-RU').padStart(10)} | chek BILLZ ${bb.orders} / tizim ${oo.checks} | qaytarish BILLZ ${bb.returns}`);
  }
  console.log(`  JAMI               BILLZ ${Math.round(tb).toLocaleString('ru-RU')} | tizim ${Math.round(to_).toLocaleString('ru-RU')} | farq ${(tb ? ((to_ - tb) / tb * 100).toFixed(2) : '—')}%`);
}
const linked = one(`SELECT sum(customer_id IS NOT NULL) l, count(*) n, sum(product_id IS NOT NULL) p FROM purchases WHERE is_demo=0`);
console.log(`\nBog‘lanish: mijoz ${linked.l}/${linked.n} qator, tovar ${linked.p}/${linked.n} qator`);
process.exit(0);
