'use client';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { fmtDT } from '@/lib/format';
import { useApp } from './AppContext';
import { Select } from './Select';
import { LeadsDrill, useOpenLead } from './LeadModal';
import type { Drill } from './LeadModal';

/* VORONKA — Odoo CRM bo‘yicha: lid qayerda tushib qolyapti · nimaga · kim tomonidan (mijoz doskasidagi 3 savol, 2026-11-06) */
interface Stage { id: number; name: string; is_won: boolean; active: number; lost_here: number; reached: number; over_24h: number; over_72h: number; avg_days: number | null; max_days: number | null }
interface Row { id: number; name: string; total: number; active?: number; lost: number; won: number; over_24h?: number }
interface Stuck { id: number; name: string; stage: string | null; user: string | null; days_on_stage: number; age_days: number; last_note: string | null; last_note_at: number | null }
interface Data {
  synced: number; teams: { id: number; name: string; leads: number }[]; team: { id: number; name: string } | null; period_days: number; as_of: number;
  totals: { total: number; active: number; lost: number; won: number; conversion: number | null };
  stages: Stage[]; reasons: { id: number; name: string; n: number }[]; users: Row[]; sources: Row[]; stuck: Stuck[];
}

const ANSWER_STYLE = `.answer{margin:0;font-size:13.5px;line-height:1.55;color:var(--ink-2)} .answer b{color:var(--ink)}`;

/* Yo‘qotish sabablari — AI xulosasi (menejer izohlari asosida). O‘qish hammaga, yaratish — rahbarga (har so‘rov AI sarfi) */
interface SababGroup { name: string; n: number; share: number; leads: { id: number; name: string }[]; quote: string | null; fix: string | null }
interface Sabab {
  state: 'off' | 'empty' | 'few' | 'none' | 'ok'; ai: boolean; total_lost: number; with_notes: number; without_notes: number; limit: number;
  stale?: boolean; at?: number; model?: string | null; summary?: string; notes_quality?: string | null; groups?: SababGroup[]; analyzed?: number; reused?: boolean;
}
const SABAB_STYLE = `.sabab{border-top:1px solid var(--line);margin-top:12px;padding-top:12px} .sabab .sum{margin:0 0 10px;font-size:13.5px;line-height:1.55} .sabab .grp{padding:8px 0;border-top:1px dashed var(--line)}
.sabab .grp h4{margin:0 0 4px;font-size:13.5px;display:flex;gap:8px;align-items:center} .sabab .q{font-style:italic;color:var(--ink-2);font-size:12.5px;margin:2px 0} .sabab .fix{font-size:12.5px;margin:2px 0}
.sabab .chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px} .sabab .chips button{font-size:11.5px;padding:2px 8px}`;
function SababAI({ team, days, canRun }: { team: string; days: number; canRun: boolean }) {
  const { fail, toast } = useApp();
  const openLead = useOpenLead();
  const [s, setS] = useState<Sabab | null>(null);
  const [busy, setBusy] = useState(false);
  const q = `days=${days}${team ? `&team=${team}` : ''}`;
  const qRef = useRef(q); qRef.current = q;
  // Filtr o‘zgarsa — eski natija ko‘rinmasin; kechikkan javob (boshqa jamoa/davr) yozilmasin
  useEffect(() => { let dead = false; setS(null); api<Sabab>(`/api/voronka/sabab?${q}`).then(x => { if (!dead) setS(x); }).catch(fail); return () => { dead = true; }; }, [q, fail]);
  const run = async (force: boolean) => {
    setBusy(true);
    try {
      const r = await api<Sabab & { ok?: boolean; why?: string }>(`/api/voronka/sabab?${q}`, { force });
      if (qRef.current !== q) return;
      if (r.ok === false) { toast(r.why || 'AI xatosi'); return; }
      setS(r); toast(r.reused ? 'Yaqinda tahlil qilingan — saqlangani ko‘rsatildi' : 'AI xulosasi tayyor');
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  if (!s) return null;
  const runBtn = (label: string, force: boolean) => canRun ? <button className="btn sm primary" type="button" data-sabab-run disabled={busy} onClick={() => { void run(force); }}>{busy ? 'AI o‘qiyapti…' : label}</button> : null;
  return (
    <div className="sabab" data-sabab-state={s.state}>
      <style>{SABAB_STYLE}</style>
      <div className="panel-head" style={{ padding: 0, marginBottom: 6 }}><h3 style={{ margin: 0, fontSize: 14 }}>AI xulosasi — izohlardan haqiqiy sabablar</h3>
        <span className="muted" style={{ fontSize: 12 }}>{s.total_lost} yo‘qotilgan · izohi bor {s.with_notes} · izohsiz {s.without_notes}</span></div>
      {s.state === 'off' ? <p className="muted" style={{ margin: 0 }}>AI kaliti kiritilmagan — «AI agent» bo‘limida ulang, shunda menejer izohlaridan sabab guruhlari chiqadi.</p>
        : s.state === 'empty' ? <p className="muted" style={{ margin: 0 }}>Davrda yo‘qotilgan lid yo‘q.</p>
        : s.state === 'few' ? <p className="muted" style={{ margin: 0 }}>Izohi bor yo‘qotilgan lid juda kam ({s.with_notes} ta) — tahlil uchun kamida 3 ta kerak. Menejerlar Odoo’da yo‘qotish sababini izohga yozsin.</p>
        : s.state === 'none' ? <div className="row-actions"><span className="muted" style={{ fontSize: 12.5 }}>{s.with_notes > s.limit ? `Izohi bor ${s.with_notes} liddan eng yangi ${s.limit} tasining` : `${s.with_notes} ta lidning`} izohlari tahlil qilinadi (Odoo’dagi rasmiy sabab emas — menejer nima yozgani).</span>{runBtn('AI bilan tahlil qilish', false)}{!canRun ? <span className="muted" style={{ fontSize: 12 }}>Tahlilni rahbar ishga tushiradi.</span> : null}</div>
        : <>
          <p className="sum">{s.summary}</p>
          {s.groups?.map((g, i) => (
            <div className="grp" key={i}>
              <h4><span>{g.name}</span><span className="pill">{g.n} ta · {g.share}%</span></h4>
              {g.quote ? <p className="q">«{g.quote}»</p> : null}
              {g.fix ? <p className="fix"><b>Nima qilish:</b> {g.fix}</p> : null}
              <div className="chips">{g.leads.slice(0, 8).map(l => <button key={l.id} className="btn sm ghost" type="button" onClick={() => openLead(l.id)} title="Lid kartasi">{l.name}</button>)}{g.leads.length > 8 ? <span className="muted" style={{ fontSize: 12 }}>… va yana {g.leads.length - 8} ta</span> : null}</div>
            </div>
          ))}
          <div className="row-actions" style={{ marginTop: 8 }}>
            <span className="muted" style={{ fontSize: 12 }}>{s.analyzed} lid izohi · {s.at ? fmtDT(s.at) : ''}{s.model ? ` · ${s.model}` : ''}{s.notes_quality ? ` · ${s.notes_quality}` : ''}</span>
            {s.stale ? <span className="pill warn" title="Yo‘qotilgan lidlar yoki izohlar o‘zgargan">eskirgan</span> : null}
            {runBtn(s.stale ? 'Yangilash' : 'Qayta tahlil', true)}
          </div>
        </>}
    </div>
  );
}
const PERIODS: [number, string][] = [[7, '7 kun'], [30, '30 kun'], [90, '90 kun'], [0, 'Hammasi']];
const pct = (n: number, of: number) => (of ? Math.round(100 * n / of) : 0);
const dayStr = (d: number | null) => d == null ? '—' : d < 1 ? `${Math.max(1, Math.round(d * 24))} soat` : `${d} kun`;

/* Uchta savolga qisqa javob — raqamlar bilan, jadvallardan oldin */
function Answers({ d }: { d: Data }) {
  const t = d.totals, open = d.stages.filter(s => !s.is_won);
  const worst = [...open].sort((a, b) => b.lost_here - a.lost_here)[0];
  const slowest = [...open].filter(s => s.over_24h).sort((a, b) => b.over_72h - a.over_72h || b.over_24h - a.over_24h)[0];
  const reason = d.reasons[0];
  const users = d.users.filter(u => u.total >= 3);
  const lossy = [...users].sort((a, b) => pct(b.lost, b.total) - pct(a.lost, a.total))[0];
  const stuckBy = [...users].sort((a, b) => (b.over_24h ?? 0) - (a.over_24h ?? 0))[0];
  if (!t.total) return null;
  return (
    <div className="grid-2e" style={{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}>
      <style>{ANSWER_STYLE}</style>
      <div className="panel"><div className="panel-head"><h2>Qayerda?</h2></div>
        <p className="answer">
          {worst && worst.lost_here ? <>Eng ko‘p lid <b>«{worst.name}»</b> bosqichida yo‘qotilgan — <b>{worst.lost_here}</b> ta ({pct(worst.lost_here, t.lost)}% yo‘qotilganlardan).</> : <>Davrda yo‘qotilgan lid yo‘q.</>}
          {' '}{slowest ? <>Hozir eng ko‘p qotib qolgan joy — <b>«{slowest.name}»</b>: {slowest.over_24h} ta lid 24 soatdan, {slowest.over_72h} ta 3 kundan ko‘p turibdi.</> : <>24 soatdan ko‘p turgan lid yo‘q.</>}
        </p></div>
      <div className="panel"><div className="panel-head"><h2>Nimaga?</h2></div>
        <p className="answer">
          {reason ? <>Asosiy sabab — <b>{reason.name}</b>: {reason.n} ta ({pct(reason.n, t.lost)}%).{d.reasons.some(r => r.name === 'Sabab ko‘rsatilmagan') ? <> <b>{d.reasons.find(r => r.name === 'Sabab ko‘rsatilmagan')?.n}</b> ta lid sababsiz yopilgan — menejerlar Odoo’da sabab tanlamayapti.</> : null}</> : <>Yo‘qotish sabablari hali yo‘q.</>}
        </p></div>
      <div className="panel"><div className="panel-head"><h2>Kim tomonidan?</h2></div>
        <p className="answer">
          {lossy && lossy.lost ? <>Yo‘qotish ulushi eng yuqori — <b>{lossy.name}</b>: {lossy.lost} / {lossy.total} ({pct(lossy.lost, lossy.total)}%).</> : <>Menejerlar kesimida yo‘qotish yo‘q.</>}
          {' '}{stuckBy && stuckBy.over_24h ? <>Eng ko‘p qotib qolgan lid <b>{stuckBy.name}</b>da — {stuckBy.over_24h} ta.</> : null}
        </p></div>
    </div>
  );
}

export function Voronka({ active }: { active: boolean }) {
  const { fail, isLead } = useApp();
  const [team, setTeam] = useState<string>('');
  const [days, setDays] = useState(30);
  const [d, setD] = useState<Data | null>(null);
  const [drill, setDrill] = useState<Drill | null>(null);
  const openLead = useOpenLead();
  // Satrga bosilsa — chuqur ko‘rish paneli ochiladi va ekran unga suriladi
  const open = (dr: Drill) => { setDrill(dr); setTimeout(() => document.getElementById('drillPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); };
  const click = { cursor: 'pointer' as const };

  useEffect(() => {
    if (!active) return;
    let dead = false;
    api<Data>(`/api/voronka?days=${days}${team ? `&team=${team}` : ''}`).then(x => { if (!dead) setD(x); }).catch(fail);
    return () => { dead = true; };
  }, [active, team, days, fail]);

  if (!d) return null;
  const t = d.totals, maxActive = Math.max(1, ...d.stages.map(s => s.active));
  const lostPct = pct(t.lost, t.total);

  return (
    <>
      <div className="filters">
        <label className="field" style={{ maxWidth: 260 }}><span>Jamoa</span>
          <Select value={team || (d.team ? String(d.team.id) : 'all')} onChange={e => setTeam(e.target.value)}>
            {d.teams.map(x => <option key={x.id} value={x.id}>{x.name} ({x.leads})</option>)}<option value="all">Hamma jamoalar</option>
          </Select></label>
        <div className="seg" role="group" aria-label="Davr">{PERIODS.map(([n, l]) => <button key={n} type="button" aria-pressed={days === n} onClick={() => setDays(n)}>{l}</button>)}</div>
        <span className="muted">Davr — lid kelgan sana bo‘yicha · Odoo nusxasi: {d.synced} lid · {fmtDT(d.as_of)} holati</span>
      </div>
      {!d.synced ? <div className="banner warn"><div><b>Odoo hali ulanmagan.</b> Lidlar Odoo CRM’dan har 5 daqiqada olinadi — ulanish holati «AI agent» bo‘limida ko‘rinadi.</div></div> : null}
      <div className="kpis">
        <div className="kpi"><span className="lbl">Lidlar</span><span className="v">{t.total}</span><span className="s">davrda kelgan</span></div>
        <div className="kpi"><span className="lbl">Ishda</span><span className="v">{t.active - t.won}</span><span className="s">faol, hali yutilmagan</span></div>
        <div className="kpi" style={click} onClick={() => open({ kind: 'lost', label: 'davrda yo‘qotilgan lidlar' })} title="Ro‘yxatni ochish"><span className="lbl">Yo‘qotilgan</span><span className="v">{t.lost} <small>{lostPct}%</small></span><span className="s">Odoo’da «yo‘qotildi» deb belgilangan · bosing — ro‘yxat</span></div>
        <div className="kpi"><span className="lbl">Yutilgan</span><span className="v">{t.won} <small>{t.conversion ?? 0}%</small></span><span className="s">konversiya = yutilgan ÷ kelgan</span></div>
      </div>
      <Answers d={d} />
      {drill ? <LeadsDrill drill={drill} team={team} days={days} onClose={() => setDrill(null)} /> : null}

      <div className="panel"><div className="panel-head"><h2>Bosqichlar</h2><span className="muted">har bosqichda hozir nechta lid, shu bosqichda nechtasi yo‘qotilgan, qancha turibdi</span></div>
        <div className="tbl"><table><thead><tr><th>Bosqich</th><th>Hozir</th><th className="n">Yo‘qotilgan</th><th className="n">24 soat+</th><th className="n">72 soat+</th><th className="n">O‘rtacha</th><th className="n">Eng uzoq</th><th className="n">O‘tgan</th></tr></thead><tbody>
          {d.stages.length ? d.stages.map(s => <tr key={s.id} style={click} onClick={() => open({ kind: 'stage', id: s.id, label: s.name })} title="Shu bosqichdagi lidlar">
            <td>{s.is_won ? <span className="pill ok">{s.name}</span> : s.name}</td>
            <td><span className="bar"><span className="track"><span className="fill" style={{ width: `${pct(s.active, maxActive)}%` }}></span></span><b className="mono">{s.active}</b></span></td>
            <td className="n">{s.lost_here ? <span className="pill bad">{s.lost_here}</span> : <span className="muted">0</span>}</td>
            <td className="n">{s.is_won ? '—' : s.over_24h ? <span className="pill warn">{s.over_24h}</span> : <span className="muted">0</span>}</td>
            <td className="n">{s.is_won ? '—' : s.over_72h ? <span className="pill bad">{s.over_72h}</span> : <span className="muted">0</span>}</td>
            <td className="n mono">{s.is_won ? '—' : dayStr(s.avg_days)}</td>
            <td className="n mono">{s.is_won ? '—' : dayStr(s.max_days)}</td>
            <td className="n mono muted">{s.reached}</td>
          </tr>) : <tr><td colSpan={8} className="muted">Bu davrda lid yo‘q</td></tr>}
        </tbody></table></div>
        <p className="muted tbl-note">Satrga bosing — shu bosqichdagi lidlar ro‘yxati (faol va yo‘qotilgan). «Yo‘qotilgan» — lid qaysi bosqichda turganida yo‘qotildi deb belgilangan. «24 soat+ / 72 soat+» — hozir shu bosqichda shuncha vaqtdan ko‘p turgan faol lidlar. «O‘tgan» — shu bosqichga kirgan lidlar soni (tarix bo‘yicha).</p>
      </div>

      <div className="grid-2">
        <div className="panel"><div className="panel-head"><h2>Nimaga yo‘qotildi</h2><span className="muted">Odoo’dagi yo‘qotish sabablari</span></div>
          <div className="tbl"><table><thead><tr><th>Sabab</th><th className="n">Lid</th><th className="n">Ulush</th></tr></thead><tbody>
            {d.reasons.length ? d.reasons.map((r, i) => <tr key={i} style={click} onClick={() => open({ kind: 'reason', id: r.id, label: r.name })} title="Shu sabab bilan yo‘qotilganlar"><td>{r.name === 'Sabab ko‘rsatilmagan' ? <span className="pill warn">{r.name}</span> : r.name}</td><td className="n mono">{r.n}</td><td className="n"><span className="bar"><span className="track"><span className="fill" style={{ width: `${pct(r.n, t.lost)}%` }}></span></span>{pct(r.n, t.lost)} %</span></td></tr>)
              : <tr><td colSpan={3} className="muted">Davrda yo‘qotilgan lid yo‘q</td></tr>}
          </tbody></table></div>
          {active ? <SababAI team={team} days={days} canRun={isLead} /> : null}</div>
        <div className="panel"><div className="panel-head"><h2>Manbalar</h2><span className="muted">qayerdan kelgan, qanchasi yutildi</span></div>
          <div className="tbl"><table><thead><tr><th>Manba</th><th className="n">Lid</th><th className="n">Yo‘qotilgan</th><th className="n">Yutilgan</th></tr></thead><tbody>
            {d.sources.length ? d.sources.map((s, i) => <tr key={i} style={click} onClick={() => open({ kind: 'source', id: s.id, label: s.name })} title="Shu manbadan kelganlar"><td>{s.name}</td><td className="n mono">{s.total}</td><td className="n mono">{s.lost}</td><td className="n mono">{s.won}</td></tr>)
              : <tr><td colSpan={4} className="muted">Ma’lumot yo‘q</td></tr>}
          </tbody></table></div></div>
      </div>

      <div className="panel"><div className="panel-head"><h2>Kim tomonidan</h2><span className="muted">menejer kesimida: nechta lid, nechtasi yo‘qotilgan, nechtasi 24 soatdan ko‘p qimirlamayapti · satrga bosing — uning lidlari</span></div>
        <div className="tbl"><table><thead><tr><th>Mas’ul</th><th className="n">Lid</th><th className="n">Ishda</th><th className="n">Yo‘qotilgan</th><th className="n">Yutilgan</th><th className="n">24 soat+</th></tr></thead><tbody>
          {d.users.length ? d.users.map((u, i) => <tr key={i} style={click} onClick={() => open({ kind: 'user', id: u.id, label: u.name })} title="Shu menejerning lidlari"><td>{u.name === 'Mas’ul yo‘q' ? <span className="pill bad">{u.name}</span> : u.name}</td><td className="n mono">{u.total}</td><td className="n mono">{(u.active ?? 0) - u.won}</td>
            <td className="n">{u.lost ? <span className={`pill ${pct(u.lost, u.total) >= 40 ? 'bad' : ''}`}>{u.lost} · {pct(u.lost, u.total)}%</span> : <span className="muted">0</span>}</td>
            <td className="n mono">{u.won}</td><td className="n">{u.over_24h ? <span className="pill warn">{u.over_24h}</span> : <span className="muted">0</span>}</td></tr>)
            : <tr><td colSpan={6} className="muted">Ma’lumot yo‘q</td></tr>}
        </tbody></table></div></div>

      <div className="panel"><div className="panel-head"><h2>Qotib qolgan lidlar</h2><span className="muted">bosqichda 24 soatdan ko‘p turganlar — eng uzoq turgani birinchi · {d.stuck.length} ta</span></div>
        {d.stuck.length ? <div className="tbl"><table><thead><tr><th>Lid</th><th>Bosqich</th><th>Mas’ul</th><th className="n">Bosqichda</th><th className="n">Kelganiga</th><th>Oxirgi izoh</th></tr></thead><tbody>
          {d.stuck.map(x => <tr key={x.id} style={click} onClick={() => openLead(x.id)} title="Lid kartasi"><td><b>{x.name}</b></td><td>{x.stage || '—'}</td><td>{x.user || <span className="pill bad">mas’ul yo‘q</span>}</td>
            <td className="n"><span className={`pill ${x.days_on_stage >= 3 ? 'bad' : 'warn'}`}>{dayStr(x.days_on_stage)}</span></td><td className="n mono">{dayStr(x.age_days)}</td>
            <td className="muted" style={{ maxWidth: 360 }}>{x.last_note ? <>{x.last_note}{x.last_note_at ? <> <span className="mono">· {fmtDT(x.last_note_at)}</span></> : null}</> : 'izoh yo‘q'}</td></tr>)}
        </tbody></table></div> : <p className="muted" style={{ margin: 0 }}>Hozir qotib qolgan lid yo‘q.</p>}
      </div>
    </>
  );
}
