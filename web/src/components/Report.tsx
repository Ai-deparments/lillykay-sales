'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { fmtDT, mln, money } from '@/lib/format';
import { useApp } from './AppContext';
import { Select } from './Select';

/* Hisobot: to‘liq tahlil, chop etish va PDF uchun. Ma’lumot /api/analytics dan (BILLZ). */
/* eslint-disable @typescript-eslint/no-explicit-any */
interface Analytics { company: any; sellers: any[]; branches: any[]; series: any[]; products?: any[]; categories?: any[]; conv?: any; insights?: any[]; source: string; elapsed: number }

const repMonths = (): string[] => {
  const out: string[] = [], d = new Date();
  for (let i = 0; i < 12; i++) { out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); d.setMonth(d.getMonth() - 1); }
  return out;
};
const MON = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
const repMonthName = (p: string): string => { const [y, m] = p.split('-'); return `${MON[Number(m) - 1]} ${y}`; };

/* Kunlik ustunlar. Kelajak kunlar (hali bo‘lmagan) och rangda — fakt bilan aralashmasin. */
function RepBars({ series, planPerDay }: { series: any[]; planPerDay: number | null }) {
  const W = 720, H = 168, padT = 12, padB = 20;
  const vals = series.map(s => s.net || 0);
  const max = Math.max(1, ...vals, planPerDay || 0);
  const n = series.length || 1, bw = W / n;
  const y = (v: number) => H - padB - (v / max) * (H - padT - padB);
  return (
    <svg className="rchart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Kunlik sof tushum">
      <line x1="0" x2={W} y1={H - padB} y2={H - padB} className="rb-axis" />
      {planPerDay ? <>
        <line x1="0" x2={W} y1={y(planPerDay).toFixed(1)} y2={y(planPerDay).toFixed(1)} className="rb-plan" />
        <text x="4" y={(y(planPerDay) - 5).toFixed(1)} className="rb-plan-t">kunlik reja {money(planPerDay)}</text></> : null}
      {series.map((s, i) => {
        const h = Math.max(s.net > 0 ? 2 : 0, (s.net || 0) / max * (H - padT - padB));
        return <rect key={i} x={(i * bw + 1.5).toFixed(1)} y={(H - padB - h).toFixed(1)} width={(bw - 3).toFixed(1)} height={h.toFixed(1)} rx="3" className={s.future ? 'rb-next' : 'rb-now'}><title>{`${s.date} — ${money(s.net || 0)}`}</title></rect>;
      })}
      {series.map((s, i) => (i % 5 === 0 || i === n - 1)
        ? <text key={'t' + i} x={(i * bw + bw / 2).toFixed(1)} y={H - 6} className="rb-tick">{Number(s.date.slice(-2))}</text> : null)}
    </svg>
  );
}

/* Gorizontal ustunlar: kim qancha sotdi — eng kattasidan boshlab */
function RepHBars({ rows, fmt = money }: { rows: { name: string; v: number }[]; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map(r => r.v));
  return (
    <div className="rhbars">{rows.length ? rows.map((r, i) => (
      <div className="rhb" key={i}>
        <span className="rhb-n">{r.name}</span>
        <span className="rhb-t"><span className="rhb-f" style={{ width: `${Math.max(1.5, r.v / max * 100).toFixed(1)}%` }}></span></span>
        <span className="rhb-v mono">{fmt(r.v)}</span></div>
    )) : <div className="muted">Ma’lumot yo‘q</div>}</div>
  );
}

function Tile({ lbl, val, sub = '' }: { lbl: string; val: string; sub?: string }) {
  return <div className="rtile"><span className="rt-l">{lbl}</span><b className="rt-v">{val}</b>{sub ? <span className="rt-s">{sub}</span> : null}</div>;
}

export function Report({ active }: { active: boolean }) {
  const { boot, fail } = useApp();
  const [repPeriod, setRepPeriod] = useState<string>(boot.period || repMonths()[0]);
  const [d, setD] = useState<Analytics | null>(null);

  useEffect(() => {
    if (!active) return;
    let dead = false;
    api<Analytics>(`/api/analytics?period=${repPeriod}`).then(x => { if (!dead) setD(x); }).catch(fail);
    return () => { dead = true; };
  }, [active, repPeriod, fail]);

  if (!d) return null;
  const c = d.company, sellers = [...d.sellers].sort((a, b) => (b.net || 0) - (a.net || 0));
  const branches = [...d.branches].sort((a, b) => (b.net || 0) - (a.net || 0));
  const workDays = Math.max(1, d.series.filter(s => !s.future).length);
  const planPerDay = c.plan ? Math.round(c.plan / d.series.length) : null;
  const anyPlan = sellers.some(x => x.plan);
  const now = Date.now();

  return (
    <>
      <div className="rep-bar no-print">
        <label className="field"><span>Davr</span><Select id="repPer" value={repPeriod} onChange={e => setRepPeriod(e.target.value)}>{repMonths().map(p => <option key={p} value={p}>{repMonthName(p)}</option>)}</Select></label>
        <button className="btn primary" type="button" id="repPrint" onClick={() => window.print()}>PDF saqlash yoki chop etish</button>
        <span className="muted">PDF uchun: tugmani bosing → «Printer» o‘rniga «Save as PDF» ni tanlang</span>
      </div>

      <div className="report" id="repDoc">
        <header className="rep-head">
          <div><div className="rep-brand">Sun HighTech · Sotuv markazi</div>
            <h1>Sotuv hisoboti — {repMonthName(repPeriod)}</h1></div>
          <div className="rep-meta">Tayyorlandi: {fmtDT(now)}<br />Manba: {d.source}<br />Davrning {Math.round(d.elapsed * 100)}% o‘tdi</div>
        </header>

        <section className="rep-sec">
          <h2>Asosiy ko‘rsatkichlar</h2>
          <div className="rtiles">
            <Tile lbl="Sof tushum" val={mln(c.net)} sub={`${money(c.gross)} sotuv − ${money(c.returns)} qaytarish`} />
            <Tile lbl="Reja" val={c.plan ? mln(c.plan) : '—'} sub={c.plan ? `bajarilish ${c.pct}%` : 'reja kiritilmagan'} />
            <Tile lbl="Prognoz" val={mln(c.forecast)} sub={`${mln(c.low)}–${mln(c.high)} · ishonch: ${c.confidence}`} />
            <Tile lbl="Cheklar" val={String(c.checks)} sub={`o‘rtacha chek ${money(c.avg_check)}`} />
            <Tile lbl="Kuniga" val={money(Math.round(c.net / workDays))} sub={`${workDays} kun hisobida`} />
          </div>
        </section>

        <section className="rep-sec">
          <h2>Kunlik sof tushum</h2>
          <p className="rep-note">Har bir ustun — bir kunlik sof tushum (sotuv minus qaytarish). Och ustunlar — hali kelmagan kunlar.</p>
          <RepBars series={d.series} planPerDay={planPerDay} />
        </section>

        <section className="rep-sec">
          <h2>Kim sotdi</h2>
          <RepHBars rows={sellers.filter(s => s.net > 0).map(s => ({ name: s.name, v: s.net }))} />
          <div className="tbl"><table><thead><tr><th>Sotuvchi</th><th className="n">Sof tushum</th><th className="n">Chek</th><th className="n">O‘rtacha chek</th>{anyPlan ? <><th className="n">Reja</th><th className="n">Bajarilish</th></> : null}<th className="n">Ochiq vazifa</th></tr></thead><tbody>
            {sellers.length ? sellers.map((s, i) => (
              <tr key={i}><td>{s.name}</td><td className="n mono">{money(s.net)}</td><td className="n mono">{s.checks}</td>
                <td className="n mono">{s.checks ? money(Math.round(s.net / s.checks)) : '—'}</td>
                {anyPlan ? <><td className="n mono">{s.plan ? money(s.plan) : '—'}</td><td className="n mono">{s.pct != null ? s.pct + '%' : '—'}</td></> : null}
                <td className="n mono">{s.open_tasks ?? '—'}</td></tr>
            )) : <tr><td colSpan={7} className="muted">Ma’lumot yo‘q</td></tr>}
          </tbody></table></div>
        </section>

        <section className="rep-sec">
          <h2>Filiallar</h2>
          <RepHBars rows={branches.filter(b => b.net > 0).map(b => ({ name: b.name, v: b.net }))} />
          <div className="tbl"><table><thead><tr><th>Filial</th><th className="n">Sof tushum</th><th className="n">Chek</th><th className="n">Kuniga</th><th className="n">Ish kuni</th><th className="n">Prognoz</th></tr></thead><tbody>
            {branches.map((b, i) => (
              <tr key={i}><td>{b.name}{b.kind === 'ombor' ? ' (ombor)' : ''}</td><td className="n mono">{money(b.net)}</td><td className="n mono">{b.checks}</td>
                <td className="n mono">{b.per_day != null ? money(b.per_day) : '—'}</td><td className="n mono">{b.work_days ?? '—'}</td><td className="n mono">{money(b.forecast)}</td></tr>
            ))}
          </tbody></table></div>
        </section>

        <section className="rep-sec">
          <h2>Nimalar sotildi</h2>
          <RepHBars rows={(d.products || []).slice(0, 10).map(p => ({ name: p.name, v: p.net }))} />
          <div className="tbl"><table><thead><tr><th>Tovar</th><th>Toifa</th><th className="n">Sof tushum</th><th className="n">Dona</th><th className="n">Chek</th></tr></thead><tbody>
            {(d.products || []).map((p, i) => (
              <tr key={i}><td>{p.name}</td><td className="muted">{p.category || '—'}</td><td className="n mono">{money(p.net)}</td><td className="n mono">{p.qty}</td><td className="n mono">{p.checks}</td></tr>
            ))}
          </tbody></table></div>
        </section>

        <section className="rep-sec">
          <h2>Toifalar bo‘yicha</h2>
          <RepHBars rows={(d.categories || []).map(x => ({ name: x.name, v: x.net }))} />
        </section>

        {d.conv && d.conv.convs != null ? <section className="rep-sec">
          <h2>Mijozlar bilan muloqot</h2>
          <div className="rtiles">
            <Tile lbl="Suhbatlar" val={String(d.conv.convs)} sub="shu davrda" />
            <Tile lbl="Birinchi javob" val={d.conv.first_median_min != null ? d.conv.first_median_min + ' daq' : '—'} sub="mediana" />
            <Tile lbl="Sotuvchi javobi" val={d.conv.first_human_median_min != null ? d.conv.first_human_median_min + ' daq' : '—'} sub="AI’siz, mediana" />
            <Tile lbl="30+ daq javobsiz" val={String(d.conv.late30 ?? '—')} sub="suhbat" />
            <Tile lbl="AI yordam bergan" val={String(d.conv.ai_assisted ?? '—')} sub="suhbat" />
            {d.conv.conversion != null ? <Tile lbl="Konversiya" val={d.conv.conversion + '%'} sub={`${d.conv.won ?? 0} ta sotuv${d.conv.lost != null ? ` · ${d.conv.lost} yo‘qotildi` : ''}`} /> : null}
          </div>
        </section> : null}

        {(d.insights || []).length ? <section className="rep-sec">
          <h2>Tahlilchi xulosalari</h2>
          {d.insights!.map((i, k) => (
            <div className="rep-ins" key={k}><h3>{i.title}</h3>
              <dl>{i.metric ? <><dt>Ko‘rsatkich</dt><dd>{i.metric}</dd></> : null}
                {i.cause ? <><dt>Ehtimoliy sabab</dt><dd>{i.hypothesis ? '(gipoteza) ' : ''}{i.cause}</dd></> : null}
                <dt>Dalil</dt><dd>{i.evidence || ''}</dd><dt>Tavsiya</dt><dd>{i.advice || ''}</dd></dl></div>
          ))}
        </section> : null}

        <footer className="rep-foot">Sun HighTech sotuv markazi · {repMonthName(repPeriod)} · hisobot {fmtDT(now)} da tayyorlandi.
          {' '}Summalar BILLZ ma’lumotidan, sof tushum = sotuv − qaytarish.</footer>
      </div>
    </>
  );
}
