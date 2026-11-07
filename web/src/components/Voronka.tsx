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

/* Yo‘qotish sabablari — AI xulosasi (menejer izohlari asosida). O‘qish hammaga, yaratish — rahbarga (har so‘rov AI sarfi) */
interface SababGroup { name: string; n: number; share: number; leads: { id: number; name: string }[]; quote: string | null; fix: string | null }
interface Sabab {
  state: 'off' | 'empty' | 'few' | 'none' | 'ok'; ai: boolean; total_lost: number; with_notes: number; without_notes: number; limit: number;
  stale?: boolean; at?: number; model?: string | null; summary?: string; notes_quality?: string | null; groups?: SababGroup[]; analyzed?: number; reused?: boolean;
}
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
    <div className="panel sabab" data-sabab-state={s.state}>
      <div className="panel-head"><h2>AI xulosasi — izohlardan haqiqiy sabablar</h2><span className="pill ai">AI tahlili</span>
        <span className="sub">{s.total_lost} yo‘qotilgan · izohi bor {s.with_notes} · izohsiz {s.without_notes}</span></div>
      <div className="panel-help">AI faqat menejer izohlarini o‘qiydi (Odoo’dagi rasmiy sabab emas — menejer nima yozgani). Rahbar «Yangilash» bosganda qayta hisoblanadi.</div>
      {s.state === 'off' ? <p className="muted">AI kaliti kiritilmagan — «AI agent» bo‘limida ulang, shunda menejer izohlaridan sabab guruhlari chiqadi.</p>
        : s.state === 'empty' ? <p className="muted">Davrda yo‘qotilgan lid yo‘q.</p>
        : s.state === 'few' ? <p className="muted">Izohi bor yo‘qotilgan lid juda kam ({s.with_notes} ta) — tahlil uchun kamida 3 ta kerak. Menejerlar Odoo’da yo‘qotish sababini izohga yozsin.</p>
        : s.state === 'none' ? <div className="row-actions"><span className="muted" style={{ fontSize: 12.5 }}>{s.with_notes > s.limit ? `Izohi bor ${s.with_notes} liddan eng yangi ${s.limit} tasining` : `${s.with_notes} ta lidning`} izohlari tahlil qilinadi.</span>{runBtn('AI bilan tahlil qilish', false)}{!canRun ? <span className="muted" style={{ fontSize: 12 }}>Tahlilni rahbar ishga tushiradi.</span> : null}</div>
        : <>
          <p className="sum">{s.summary}</p>
          <div className="tbl"><table className="ai-tbl"><thead><tr><th>Guruh</th><th className="n">Lid</th><th className="n">Ulush</th><th>Izohdan iqtibos</th><th>Nima qilish</th><th>Lidlar</th></tr></thead><tbody>
            {s.groups?.map((g, i) => (
              <tr key={i}>
                <td className="who">{g.name}</td><td className="n">{g.n}</td><td className="n">{g.share}%</td>
                <td className={`quote${g.quote ? '' : ' muted'}`}>{g.quote ? `«${g.quote}»` : '—'}</td>
                <td className={`todo${g.fix ? '' : ' muted'}`}>{g.fix || '—'}</td>
                <td><div className="chips">{g.leads.slice(0, 8).map(l => <button key={l.id} className="btn sm ghost" type="button" onClick={() => openLead(l.id)} title="Lid kartasi">{l.name}</button>)}{g.leads.length > 8 ? <span className="muted" style={{ fontSize: 12 }}>… va yana {g.leads.length - 8} ta</span> : null}</div></td>
              </tr>
            ))}
          </tbody></table></div>
          <div className="panel-foot">
            <span className="mono">{s.analyzed} lid izohi · {s.at ? fmtDT(s.at) : ''}{s.model ? ` · ${s.model}` : ''}{s.notes_quality ? ` · ${s.notes_quality}` : ''}</span>
            {s.stale ? <span className="pill warn" title="Yo‘qotilgan lidlar yoki izohlar o‘zgargan">eskirgan</span> : null}
            <div className="right">{runBtn(s.stale ? 'Yangilash' : 'Qayta tahlil', true)}</div>
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
    <div className="panel vk-answers">
      <div className="panel-head"><h2>Uchta asosiy javob</h2><span className="sub">tanlangan davr bo‘yicha</span></div>
      <div className="panel-help">Pastdagi jadvallardan chiqarilgan qisqa xulosa: lid qayerda, nima sababdan va kimda yo‘qolmoqda.</div>
      <div className="answer"><div className="q">Qayerda?</div><div className="a">
        {worst && worst.lost_here ? <>Eng ko‘p lid <b>«{worst.name}»</b> bosqichida yo‘qotilgan — <b>{worst.lost_here} ta ({pct(worst.lost_here, t.lost)}%)</b> yo‘qotilganlardan.</> : <>Davrda yo‘qotilgan lid yo‘q.</>}
        {' '}{slowest ? <>Hozir eng ko‘p qotib qolgan joy — <b>«{slowest.name}»</b>: {slowest.over_24h} ta lid 24 soatdan, {slowest.over_72h} ta 3 kundan ko‘p turibdi.</> : <>24 soatdan ko‘p turgan lid yo‘q.</>}
      </div></div>
      <div className="answer"><div className="q">Nimaga?</div><div className="a">
        {reason ? <>Asosiy sabab — <b>{reason.name}</b>: <b>{reason.n} ta ({pct(reason.n, t.lost)}%)</b>.{d.reasons.some(r => r.name === 'Sabab ko‘rsatilmagan') ? <> <b>{d.reasons.find(r => r.name === 'Sabab ko‘rsatilmagan')?.n}</b> ta lid sababsiz yopilgan — menejerlar Odoo’da sabab tanlamayapti.</> : null}</> : <>Yo‘qotish sabablari hali yo‘q.</>}
      </div></div>
      <div className="answer"><div className="q">Kim tomonidan?</div><div className="a">
        {lossy && lossy.lost ? <>Yo‘qotish ulushi eng yuqori — <b>{lossy.name}: {lossy.lost} / {lossy.total} ({pct(lossy.lost, lossy.total)}%)</b>.</> : <>Menejerlar kesimida yo‘qotish yo‘q.</>}
        {' '}{stuckBy && stuckBy.over_24h ? <>Eng ko‘p qotib qolgan lid <b>{stuckBy.name}</b>da — <b>{stuckBy.over_24h} ta</b>.</> : null}
      </div></div>
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
  const t = d.totals, maxReached = Math.max(1, ...d.stages.map(s => s.reached));
  const lostPct = pct(t.lost, t.total);
  // Jadvalda belgilash faqat eng yomon qatorga — bir qarashda ko‘rinsin (B: tekis, bezaksiz)
  const maxLostHere = Math.max(0, ...d.stages.filter(s => !s.is_won).map(s => s.lost_here));
  const maxOver72 = Math.max(0, ...d.stages.filter(s => !s.is_won).map(s => s.over_72h));
  const maxStuckBy = Math.max(0, ...d.users.map(u => u.over_24h ?? 0));

  return (
    <>
      <div className="filters">
        <label className="field"><span>Jamoa</span>
          <Select value={team || (d.team ? String(d.team.id) : 'all')} onChange={e => setTeam(e.target.value)}>
            {d.teams.map(x => <option key={x.id} value={x.id}>{x.name} ({x.leads})</option>)}<option value="all">Hamma jamoalar</option>
          </Select></label>
        <span className="field"><span>Davr</span>
          <div className="seg" role="group" aria-label="Davr">{PERIODS.map(([n, l]) => <button key={n} type="button" aria-pressed={days === n} onClick={() => setDays(n)}>{l}</button>)}</div></span>
        <span className="muted vk-note">Davr — lid kelgan sana bo‘yicha · Odoo nusxasi: {d.synced} lid · {fmtDT(d.as_of)} holati</span>
      </div>
      {!d.synced ? <div className="banner warn"><div><b>Odoo hali ulanmagan.</b> Lidlar Odoo CRM’dan har 5 daqiqada olinadi — ulanish holati «AI agent» bo‘limida ko‘rinadi.</div></div> : null}
      <div className="kpis">
        <div className="kpi"><span className="lbl">Lidlar</span><span className="v">{t.total}</span><span className="s">davrda kelgan</span></div>
        <div className="kpi"><span className="lbl">Ishda</span><span className="v">{t.active - t.won}</span><span className="s">faol, hali yutilmagan</span></div>
        <div className="kpi link" role="button" tabIndex={0} style={click} onClick={() => open({ kind: 'lost', label: 'davrda yo‘qotilgan lidlar' })} title="Ro‘yxatni ochish"><span className="lbl">Yo‘qotilgan</span><span className="v bad">{t.lost} <small>{lostPct}%</small></span><span className="s">Odoo’da «yo‘qotildi» deb belgilangan · bosilsa — ro‘yxat</span></div>
        <div className="kpi"><span className="lbl">Yutilgan</span><span className="v ok">{t.won} <small>{t.conversion ?? 0}% konversiya</small></span><span className="s">konversiya = yutilgan ÷ kelgan</span></div>
      </div>
      <Answers d={d} />
      {drill ? <LeadsDrill drill={drill} team={team} days={days} onClose={() => setDrill(null)} /> : null}

      <div className="panel vk-stages"><div className="panel-head"><h2>Bosqichlar bo‘yicha</h2><span className="sub">Odoo CRM bosqichlari tartibida</span></div>
        <div className="panel-help">Chiziq — bosqichga yetib kelgan lidlar ulushi (tarix bo‘yicha); ustunlar — hozir shu bosqichda turganlar, shu yerda yo‘qotilganlar va qancha vaqt turgani. Satrga bosilsa — shu bosqichdagi lidlar ro‘yxati.</div>
        <div className="tbl"><table><thead><tr><th>Bosqich</th><th>Yetib kelgan</th><th className="n">Hozir</th><th className="n">Yo‘qotilgan</th><th className="n">24 soat+</th><th className="n">72 soat+</th><th className="n">O‘rtacha turish</th><th className="n">Eng uzoq</th></tr></thead><tbody>
          {d.stages.length ? d.stages.map(s => <tr key={s.id} role="button" style={click} onClick={() => open({ kind: 'stage', id: s.id, label: s.name })} title="Shu bosqichdagi lidlar">
            <td className="who">{s.name}</td>
            <td><span className="bar"><span className="track"><span className={`fill${s.is_won ? ' ok' : ''}`} style={{ width: `${pct(s.reached, maxReached)}%` }}></span></span><b>{s.reached}</b><span className={`pct${s.is_won ? ' ok' : ''}`}>{pct(s.reached, maxReached)}%</span></span></td>
            <td className="n">{s.active}</td>
            <td className="n">{s.is_won ? <span className="muted">—</span> : s.lost_here && s.lost_here === maxLostHere ? <span className="pill bad">{s.lost_here}</span> : s.lost_here}</td>
            <td className="n">{s.is_won ? <span className="muted">—</span> : s.over_24h}</td>
            <td className="n">{s.is_won ? <span className="muted">—</span> : s.over_72h && s.over_72h === maxOver72 ? <span className="pill warn">{s.over_72h}</span> : s.over_72h}</td>
            <td className="n">{s.is_won ? <span className="muted">—</span> : dayStr(s.avg_days)}</td>
            <td className="n">{s.is_won ? <span className="muted">—</span> : dayStr(s.max_days)}</td>
          </tr>) : <tr><td colSpan={8} className="muted">Bu davrda lid yo‘q</td></tr>}
        </tbody></table></div>
      </div>

      <div className="grid-2">
        <div className="panel vk-share"><div className="panel-head"><h2>Yo‘qotish sabablari (Odoo)</h2></div>
          <div className="panel-help">Menejer lidni yopishda Odoo’da tanlagan sabab; ulush — {t.lost} yo‘qotilgan lidga nisbatan. Satrga bosilsa — shu sabab bilan yo‘qotilganlar.</div>
          <div className="tbl"><table><thead><tr><th>Sabab</th><th className="n">Lid</th><th>Ulush</th></tr></thead><tbody>
            {d.reasons.length ? d.reasons.map((r, i) => <tr key={i} role="button" style={click} onClick={() => open({ kind: 'reason', id: r.id, label: r.name })} title="Shu sabab bilan yo‘qotilganlar"><td>{r.name === 'Sabab ko‘rsatilmagan' ? <span className="pill warn">{r.name}</span> : r.name}</td><td className="n">{r.n}</td><td><span className="bar"><span className="track"><span className={`fill${r.name === 'Sabab ko‘rsatilmagan' ? ' bad' : ''}`} style={{ width: `${pct(r.n, t.lost)}%` }}></span></span><b>{pct(r.n, t.lost)}%</b></span></td></tr>)
              : <tr><td colSpan={3} className="muted">Davrda yo‘qotilgan lid yo‘q</td></tr>}
          </tbody></table></div></div>
        <div className="panel"><div className="panel-head"><h2>Manbalar</h2></div>
          <div className="panel-help">Lid qayerdan kelgani va har bir manbadan qanchasi yo‘qotilgan yoki yutilgani. Satrga bosilsa — shu manbadan kelganlar.</div>
          <div className="tbl"><table><thead><tr><th>Manba</th><th className="n">Lid</th><th className="n">Yo‘qotilgan</th><th className="n">Yutilgan</th></tr></thead><tbody>
            {d.sources.length ? d.sources.map((s, i) => <tr key={i} role="button" style={click} onClick={() => open({ kind: 'source', id: s.id, label: s.name })} title="Shu manbadan kelganlar"><td className="who">{s.name === 'Manba yo‘q' ? <span className="pill warn">{s.name}</span> : s.name}</td><td className="n">{s.total}</td><td className="n">{s.lost}</td><td className="n">{s.won}</td></tr>)
              : <tr><td colSpan={4} className="muted">Ma’lumot yo‘q</td></tr>}
          </tbody></table></div></div>
      </div>

      {active ? <SababAI team={team} days={days} canRun={isLead} /> : null}

      <div className="panel"><div className="panel-head"><h2>Menejerlar bo‘yicha</h2></div>
        <div className="panel-help">Har bir mas’ul menejerga biriktirilgan lidlar; «Ulush» — uning lidlaridan yo‘qotilganlar foizi, 40% dan yuqorisi qizil. Satrga bosilsa — uning lidlari.</div>
        <div className="tbl"><table><thead><tr><th>Mas’ul</th><th className="n">Lid</th><th className="n">Ishda</th><th className="n">Yo‘qotilgan</th><th className="n">Ulush</th><th className="n">Yutilgan</th><th className="n">24 soat+</th></tr></thead><tbody>
          {d.users.length ? d.users.map((u, i) => <tr key={i} role="button" style={click} onClick={() => open({ kind: 'user', id: u.id, label: u.name })} title="Shu menejerning lidlari"><td className="who">{u.name === 'Mas’ul yo‘q' ? <span className="pill bad">{u.name}</span> : u.name}</td><td className="n">{u.total}</td><td className="n">{(u.active ?? 0) - u.won}</td>
            <td className="n">{u.lost}</td>
            <td className="n">{u.lost ? pct(u.lost, u.total) >= 40 ? <span className="pill bad">{pct(u.lost, u.total)}%</span> : `${pct(u.lost, u.total)}%` : <span className="muted">0%</span>}</td>
            <td className="n">{u.won}</td><td className="n">{u.over_24h && u.over_24h === maxStuckBy ? <span className="pill warn">{u.over_24h}</span> : u.over_24h ?? 0}</td></tr>)
            : <tr><td colSpan={7} className="muted">Ma’lumot yo‘q</td></tr>}
        </tbody></table></div></div>

      <div className="panel vk-stuck"><div className="panel-head"><h2>Qotib qolgan lidlar</h2><span className="sub">{d.stuck.length} ta</span></div>
        <div className="panel-help">24 soatdan ko‘p bir bosqichda turgan faol lidlar, eng uzoq turgani birinchi. Qatorga bosilsa — lid kartasi.</div>
        {d.stuck.length ? <div className="tbl"><table><thead><tr><th>Lid</th><th>Bosqich</th><th>Mas’ul</th><th>Bosqichda</th><th className="n">Kelganiga</th><th>Oxirgi izoh</th></tr></thead><tbody>
          {d.stuck.map(x => <tr key={x.id} className="row" role="button" style={click} onClick={() => openLead(x.id)} title="Lid kartasi"><td><div className="lead">{x.name}</div></td><td>{x.stage || '—'}</td><td className="who">{x.user || <span className="pill bad">Mas’ul yo‘q</span>}</td>
            <td><span className={`pill ${x.days_on_stage >= 3 ? 'bad' : 'warn'}`}>{dayStr(x.days_on_stage)}</span></td><td className="n">{dayStr(x.age_days)}</td>
            <td className={`cmt${x.last_note ? '' : ' muted'}`}>{x.last_note ? <>{x.last_note}{x.last_note_at ? <> <span className="mono">· {fmtDT(x.last_note_at)}</span></> : null}</> : 'izoh yo‘q'}</td></tr>)}
        </tbody></table></div> : <p className="muted">Hozir qotib qolgan lid yo‘q.</p>}
      </div>
    </>
  );
}
