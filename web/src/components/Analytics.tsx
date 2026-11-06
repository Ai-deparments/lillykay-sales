'use client';
import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '@/lib/api';
import { BIG, cur, fmtDT, mln, money } from '@/lib/format';
import { Icon } from './ui';
import { useApp } from './AppContext';
import { Select } from './Select';

/* REJA VA TAHLIL (Obyektiv) */
/* eslint-disable @typescript-eslint/no-explicit-any */
interface Version { version: number; status: string; created_by: string; basis?: string; revenue: number }
interface Data {
  company: any; series: { day: number; net: number; future?: boolean }[]; versions: Version[]; products?: any[]; categories: any[]; branches: any[]; sellers: any[]; insights: any[];
  source: string; elapsed: number; as_of: number; scope?: { kind: string; label: string }; conv?: any;
}

function Chart({ d, isLead }: { d: Data; isLead: boolean }) {
  const c = d.company, W = 720, H = 280, L = 48, R = 104, T = 22, B = 30;
  // Hali savdo ham, reja ham yo‘q — bo‘sh o‘qlar («0 0 0») o‘rniga tushunarli izoh
  if (!c.plan && !c.net && !c.forecast) return <div className="empty-state" style={{ height: 180 }}>Bu davrda hali savdo yo‘q{isLead ? ' — reja kiritilsa, bajarilish chizig‘i ham chiqadi' : ''}.</div>;
  const days = d.series.length;
  let cum = 0; const fact: [number, number][] = [[0, 0]]; let lastDay = 0;
  d.series.forEach(x => { if (!x.future) { cum += x.net; fact.push([x.day, cum]); lastDay = x.day; } });
  const MAX = Math.max(c.plan || 0, c.high || 0, cum) * 1.08 || 1;
  const x = (v: number) => L + v / days * (W - L - R), y = (v: number) => T + (1 - v / MAX) * (H - T - B);
  const P = (pts: [number, number][]) => pts.map((p, i) => (i ? 'L' : 'M') + x(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1)).join(' ');
  const step = Math.pow(10, Math.floor(Math.log10(MAX / 4))), tick = [1, 2, 2.5, 5, 10].map(m => m * step).find(s => MAX / s <= 6) || step * 10;
  const g: ReactNode[] = [];
  for (let v = 0; v <= MAX; v += tick) g.push(<g key={'y' + v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--line)" /><text x={L - 8} y={y(v) + 4} textAnchor="end">{mln(v)}</text></g>);
  for (const dd of [1, 5, 10, 15, 20, 25, days]) g.push(<text key={'x' + dd} x={x(dd - 0.5)} y={H - 10} textAnchor="middle">{dd}</text>);
  if (c.plan) g.push(<g key="plan"><path d={P([[0, 0], [days, c.plan]])} stroke="var(--ink-3)" strokeWidth="1.5" fill="none" /><circle cx={x(days)} cy={y(c.plan)} r="3" fill="var(--ink-3)" /><text className="t-strong" x={x(days) + 8} y={y(c.plan) - 5}>Reja {mln(c.plan)}</text></g>);
  if (lastDay < days) {
    g.push(<g key="fc">
      <path d={`M${x(lastDay)} ${y(cum)} L${x(days)} ${y(c.high)} L${x(days)} ${y(c.low)} Z`} fill="var(--accent)" fillOpacity=".12" />
      <path d={P([[lastDay, cum], [days, c.forecast]])} stroke="var(--accent)" strokeWidth="2" strokeDasharray="5 4" fill="none" />
      <circle cx={x(days)} cy={y(c.forecast)} r="3.5" fill="var(--surface)" stroke="var(--accent)" strokeWidth="2" />
      <text className="t-acc" x={x(days) + 8} y={y(c.forecast) + (c.plan && Math.abs(y(c.plan) - y(c.forecast)) < 16 ? 16 : 4)}>Prognoz {mln(c.forecast)}</text>
      <line x1={x(lastDay)} x2={x(lastDay)} y1={T - 6} y2={H - B} stroke="var(--ink-3)" strokeDasharray="3 3" /><text x={x(lastDay)} y={T - 10} textAnchor="middle">bugun</text></g>);
  }
  g.push(<g key="fact"><path d={`${P(fact)} L${x(lastDay)} ${y(0)} L${x(0)} ${y(0)} Z`} fill="var(--accent)" fillOpacity=".1" /><path d={P(fact)} stroke="var(--accent)" strokeWidth="2.5" fill="none" strokeLinejoin="round" />
    <circle cx={x(lastDay)} cy={y(cum)} r="4.5" fill="var(--accent)" stroke="var(--surface)" strokeWidth="2" /><text className="t-acc" x={x(lastDay) + 10} y={y(cum) + 20}>Fakt {mln(cum)}</text></g>);
  return <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Tushum: fakt ${mln(cum)} ${BIG().label}, prognoz ${mln(c.forecast)} ${BIG().label}, reja ${mln(c.plan)} ${BIG().label}`}>{g}</svg>;
}

const PctCell = ({ p, plan }: { p: number; plan: number }) => plan
  ? <span className={`bar ${p < 55 ? 'low' : ''}`}><span className="track"><span className="fill" style={{ width: `${Math.min(100, p)}%` }}></span></span>{p} %</span>
  : <span className="muted">reja belgilanmagan</span>;

export function Analytics({ active }: { active: boolean }) {
  const { boot, isLead, clockNow, toast, fail, openModal } = useApp();
  const [period, setPeriod] = useState<string>(() => new Date(clockNow() + 5 * 3600e3).toISOString().slice(0, 7));
  const [d, setD] = useState<Data | null>(null);
  const [rev, setRev] = useState(0);
  const reload = useCallback(() => setRev(v => v + 1), []);

  useEffect(() => {
    if (!active) return;
    let dead = false;
    api<Data>(`/api/analytics?period=${period}`).then(x => { if (!dead) setD(x); }).catch(fail);
    return () => { dead = true; };
  }, [active, period, rev, fail]);

  if (!d) return null;
  const c = d.company, seller = boot.me.role === 'sotuvchi';
  const periods = [0, 1, 2].map(i => { const t = new Date(clockNow() + 5 * 3600e3); t.setUTCDate(1); t.setUTCMonth(t.getUTCMonth() - i); return t.toISOString().slice(0, 7); });
  const label = BIG().label;

  const explain = (k: 'fakt' | 'bajarilish' | 'prognoz') => {
    const T = {
      fakt: ['Sof tushum', `Sof tushum = sotuvlar − qaytarishlar = ${mln(c.gross)} − ${mln(c.returns)} = ${mln(c.net)} ${label}. Qaytarish o‘zi qilingan kunda ayiriladi. Cheklar: ${c.checks}. Manba: ${d.source}.`],
      bajarilish: ['Reja bajarilishi', c.plan ? `Bajarilish = fakt ÷ reja = ${mln(c.net)} ÷ ${mln(c.plan)} = ${c.pct}%. Oyning ${Math.round(d.elapsed * 100)}% o‘tdi. Reja v${c.plan_version}.` : 'Reja kiritilmagan — foiz o‘rniga «reja belgilanmagan» ko‘rsatiladi.'],
      prognoz: ['Prognoz', `Prognoz = fakt + qolgan kunlar kutilmasi = ${mln(c.net)} + ${mln(c.expected)} = ${mln(c.forecast)} ${label}. Usul: ${c.method}. Ishonch: ${c.confidence}. Diapazon ${mln(c.low)}–${mln(c.high)}. Prognoz kafolat emas.`]
    }[k];
    openModal({ content: <><h2>{T[0]} — qanday hisoblandi</h2><div className="note" style={{ fontSize: 14 }}>{T[1]}</div></> });
  };

  const runIns = async () => { const r = await api('/api/insights/run', {}).catch(fail); if (r) toast(`Xulosalar: ${r.made ?? 0} ta`); reload(); };
  const approve = async (rev: number) => {
    if (!confirm(`${period} rejasi: ${mln(rev)} ${label}. Tasdiqlaysizmi?`)) return;
    await api('/api/plans', { period, scope: 'company', key: '*', revenue: rev }).catch(fail);
    toast('Reja tasdiqlandi'); reload();
  };
  const suggest = async () => {
    const r = await api('/api/plans/suggest', { period }).catch(fail);
    if (r) toast(r.ok ? `Tavsiya: ${mln(r.revenue)} ${label} (${r.basis}) — tasdiqlash uchun «Rejani kiritish»` : r.why);
    reload();
  };
  const setPlan = (bp?: string) => {
    const key = bp ? bp : '*';
    openModal({
      content: <><h2>Reja: {bp ? key : 'kompaniya'} · {period}</h2><label className="field"><span>Tushum rejasi ({cur() === 'USD' ? '$' : 'so‘m'})</span><input type="number" min="0" step={cur() === 'USD' ? 100 : 1000000} name="revenue" id="pl_rev" required /></label>
        <div className="note">Har kiritish yangi versiya bo‘lib saqlanadi. O‘tgan oy rejasi o‘zgartirilmaydi.</div></>,
      onSubmit: async dd => { await api('/api/plans', { period, scope: bp ? 'branch' : 'company', key, revenue: Number(dd.revenue) }); toast('Reja saqlandi'); reload(); }
    });
  };

  const sg = d.versions.find(v => v.status !== 'approved');
  const bPlan = d.branches.some(b => b.plan), bConv = d.branches.some(b => b.conv?.convs != null);
  const list = [...d.sellers].sort((a, b) => (b.net || 0) - (a.net || 0)), sPlan = list.some(x => x.plan), sConv = list.some(x => x.conv?.convs != null);

  return (
    <>
      <div className="filters"><label className="field" style={{ maxWidth: 180 }}><span>Davr</span><Select id="perSel" value={period} onChange={e => setPeriod(e.target.value)}>{periods.map(p => <option key={p}>{p}</option>)}</Select></label>
        <span className="muted">{d.scope && d.scope.kind !== 'company' ? <><b>{d.scope.label}</b> · </> : null}Manba: {d.source} · oyning {Math.round(d.elapsed * 100)}% o‘tdi · {fmtDT(d.as_of)} holati</span>
        {isLead ? <span style={{ marginLeft: 'auto' }} className="row-actions"><a className="btn sm ghost" href={`/api/export/filiallar.csv?period=${period}`}>Filiallar CSV</a><a className="btn sm ghost" href={`/api/export/sotuvchilar.csv?period=${period}`}>Sotuvchilar CSV</a><button className="btn sm" type="button" id="runIns" onClick={runIns}>Xulosani hozir yangilash</button></span> : null}</div>
      {!c.plan && isLead ? <div className="plan-cta">
        <div><b>{period} rejasi hali tasdiqlanmagan.</b> {sg ? <>Tizim tavsiyasi: <b>{mln(sg.revenue)} {label}</b> <span className="muted">({sg.basis || ''})</span></> : 'Tizim tavsiyasini oling yoki o‘zingiz kiriting.'} Reja bo‘lmasa, bajarilish foizi va filiallar solishtiruvi chiqmaydi.</div>
        <div className="row-actions">{sg ? <button className="btn sm primary" type="button" onClick={() => approve(sg.revenue)}>Tavsiyani tasdiqlash</button> : <button className="btn sm primary" type="button" id="suggestPlan" onClick={suggest}>Tizim tavsiyasi</button>}<button className="btn sm" type="button" id="setPlan" onClick={() => setPlan()}>Boshqa summa</button></div></div> : null}
      <div className="kpis">
        <div className="kpi"><span className="lbl">{seller ? 'Mening sof savdom' : 'Sof tushum · fakt'}</span><span className="v">{mln(c.net)} <small>{label}</small></span><span className="s">Sotuv {mln(c.gross)} − qaytarish {mln(c.returns)} · {c.checks} chek</span><button className="linkbtn" onClick={() => explain('fakt')}>Qanday hisoblandi?</button></div>
        <div className="kpi"><span className="lbl">Reja bajarilishi</span><span className="v">{c.plan ? <>{c.pct} <small>%</small></> : <small>reja belgilanmagan</small>}</span>{c.plan ? <div className="rail2"><span className="fill" style={{ width: `${Math.min(100, c.pct)}%` }}></span><span className="tick" style={{ left: `${Math.round(d.elapsed * 100)}%` }}></span></div> : null}<span className="s">{c.plan ? `Reja ${mln(c.plan)} ${label} (v${c.plan_version})` : 'Rahbar rejani kiritadi'}</span><button className="linkbtn" onClick={() => explain('bajarilish')}>Qanday hisoblandi?</button></div>
        <div className="kpi"><span className="lbl">Oy oxiriga prognoz</span><span className="v">{mln(c.forecast)} <small>{label}</small></span><span className="s">Diapazon {mln(c.low)}–{mln(c.high)} · ishonch: {c.confidence}</span><button className="linkbtn" onClick={() => explain('prognoz')}>Qanday hisoblandi?</button></div>
        <div className="kpi"><span className="lbl">O‘rtacha chek</span><span className="v">{mln(c.avg_check)}{c.avg_check == null ? '' : <> <small>{label}</small></>}</span><span className="s">Suhbatlar: {d.conv?.convs ?? 0} · 1-javob mediana {d.conv?.first_median_min ?? '—'} daq</span></div>
      </div>
      <div className="grid-2"><div className="panel"><div className="panel-head"><h2>Tushum: reja, fakt, prognoz</h2><span className="muted">{label}, yig‘ma</span></div>
        <div className="legend"><span><i className="sw"></i>Fakt ({d.source}, sof)</span><span><i className="sw fc"></i>Prognoz va diapazon</span><span><i className="sw pl"></i>Reja</span></div>
        <div className="chart-wrap"><Chart d={d} isLead={isLead} /></div></div>
        <div className="panel"><div className="panel-head"><h2>Reja</h2><span className="muted">o‘tgan davr qulflanadi</span></div>
          <div className="versions">{d.versions.length ? d.versions.map((v, i) => <div key={i}><span className={`pill ${v.status === 'approved' ? 'acc' : ''}`}>v{v.version}</span><span>{v.status === 'approved' ? 'Tasdiqlangan' : 'Tizim tavsiyasi'} · {v.created_by}<br /><span className="muted">{v.basis || ''}</span></span><span className="mono">{mln(v.revenue)}</span></div>) : <span className="muted">Reja kiritilmagan</span>}</div>
          {isLead ? <div className="row-actions"><button className="btn sm" type="button" id="suggestPlan" onClick={suggest}>Tizim tavsiyasi</button><button className="btn sm primary" type="button" id="setPlan" onClick={() => setPlan()}>Rejani kiritish</button></div> : null}</div></div>
      {(d.products || []).length ? <div className="grid-2"><div className="panel"><div className="panel-head"><h2>Eng ko‘p sotilgan tovarlar</h2><span className="muted">sof savdo</span>{isLead ? <a className="btn sm ghost" style={{ marginLeft: 'auto' }} href={`/api/export/tovarlar.csv?period=${period}`}>CSV</a> : null}</div>
        <div className="tbl"><table><thead><tr><th>Tovar</th><th className="n">Sof</th><th className="n">Dona</th><th className="n">Chek</th></tr></thead><tbody>
          {d.products!.map((x, i) => <tr key={i}><td>{x.name}{x.returned ? <> <span className="pill warn">qaytarilgan {x.returned}</span></> : null}</td><td className="n mono">{money(x.net)}</td><td className="n mono">{x.qty}</td><td className="n mono">{x.checks}</td></tr>)}
        </tbody></table></div></div>
        <div className="panel"><div className="panel-head"><h2>Toifalar</h2><span className="muted">sof savdo</span></div>
          <div className="tbl"><table><thead><tr><th>Toifa</th><th className="n">Sof</th><th className="n">Dona</th><th className="n">Chek</th></tr></thead><tbody>
            {d.categories.map((x, i) => <tr key={i}><td>{x.name}</td><td className="n mono">{money(x.net)}</td><td className="n mono">{x.qty}</td><td className="n mono">{x.checks}</td></tr>)}
          </tbody></table></div></div></div> : null}
      {d.branches.length ? <div className="panel"><div className="panel-head"><h2>Filiallar</h2><span className="muted">{label} · «Kuniga» — ish kunlariga bo‘lingan; «Tovar» — katalogning shu filialda bor ulushi</span></div>
        <div className="tbl"><table><thead><tr><th>Filial</th>{bPlan ? <th className="n">Reja</th> : null}<th className="n">Fakt</th>{bPlan ? <th className="n">Bajarilish</th> : null}<th className="n">Kuniga</th><th className="n">Ish kuni</th><th className="n">Tovar</th><th className="n">Prognoz</th><th className="n">Chek</th>{bConv ? <><th className="n">Suhbat</th><th className="n">1-javob</th><th className="n">30+ daq javobsiz</th></> : null}{isLead ? <th></th> : null}</tr></thead><tbody>
          {d.branches.map((b, i) => <tr key={i}><td>{b.name}{b.kind === 'ombor' ? <> <span className="pill">ombor</span></> : null}</td>{bPlan ? <td className="n">{mln(b.plan)}</td> : null}<td className="n">{mln(b.net)}</td>{bPlan ? <td className="n"><PctCell p={b.pct} plan={b.plan} /></td> : null}
            <td className="n mono">{b.per_day != null ? money(b.per_day) : '—'}</td><td className="n mono">{b.work_days ?? '—'}</td><td className="n mono">{b.stock_share != null ? b.stock_share + '%' : '—'}</td><td className="n">{mln(b.forecast)}</td><td className="n">{b.checks}</td>
            {bConv ? <><td className="n">{b.conv?.convs ?? '—'}</td><td className="n">{b.conv?.first_median_min != null ? b.conv.first_median_min + ' daq' : '—'}</td><td className="n">{b.conv?.late30 ?? '—'}</td></> : null}
            {isLead ? <td><button className="btn sm ghost" type="button" onClick={() => setPlan(b.name)}>Reja</button></td> : null}</tr>)}
        </tbody></table></div>{!bConv ? <p className="muted tbl-note">Suhbat ko‘rsatkichlari (javob tezligi, javobsiz qolganlar) Telegram akkauntiga filial biriktirilgach chiqadi: Sozlamalar → Akkauntlar → Filial.</p> : null}</div> : null}
      <div className="panel"><div className="panel-head"><h2>{seller ? 'Mening natijam' : 'Sotuvchilar'}</h2></div>
        <div className="tbl"><table><thead><tr><th>Sotuvchi</th><th className="n">Fakt, {label}</th>{sPlan ? <><th className="n">Reja</th><th className="n">Bajarilish</th></> : null}<th className="n">Chek</th>{sConv ? <><th className="n">Suhbat</th><th className="n">1-javob (o‘zi)</th><th className="n">AI yordam</th></> : null}<th className="n">Ochiq vazifa</th></tr></thead><tbody>
          {list.length ? list.map((s, i) => <tr key={i}><td>{s.name}</td><td className="n">{mln(s.net)}</td>{sPlan ? <><td className="n">{mln(s.plan)}</td><td className="n"><PctCell p={s.pct} plan={s.plan} /></td></> : null}<td className="n">{s.checks}</td>
            {sConv ? <><td className="n">{s.conv?.convs ?? '—'}</td><td className="n">{s.conv?.first_human_median_min != null ? s.conv.first_human_median_min + ' daq' : '—'}</td><td className="n">{s.conv?.ai_assisted ?? '—'}</td></> : null}<td className="n">{s.open_tasks ?? '—'}</td></tr>)
            : <tr><td colSpan={9} className="muted">Ma’lumot yo‘q</td></tr>}
        </tbody></table></div>{!sConv ? <p className="muted tbl-note">Suhbat ko‘rsatkichlari sotuvchi panelga kirib javob bera boshlaganda chiqadi (hozir 10 sotuvchida parol yo‘q).</p> : null}</div>
      <div className="panel"><div className="panel-head"><h2>Tahlilchi xulosalari</h2><span className="muted">sabab isbotlanmasa — gipoteza</span></div>
        {d.insights.length ? d.insights.map((i, k) => <div className="insight" key={k}><div className="who"><Icon name="chart" />Tahlilchi · {fmtDT(i.at)}</div><h3>{i.title}</h3><dl>
          {i.metric ? <><dt>Ko‘rsatkich</dt><dd>{i.metric}</dd></> : null}<dt>Davr</dt><dd>{i.period}</dd>
          {i.cause ? <><dt>Ehtimoliy sabab</dt><dd>{i.hypothesis ? <span className="hyp">Gipoteza</span> : null}{i.cause}</dd></> : null}
          <dt>Dalil</dt><dd>{i.evidence || ''}</dd><dt>Tavsiya</dt><dd>{i.advice || ''}</dd><dt>Mas’ul</dt><dd>{i.owner || ''}</dd></dl></div>)
          : <span className="muted">Hozircha xulosa yo‘q. Har kuni {String(boot.settings.report_time)} da yangilanadi.</span>}</div>
    </>
  );
}
