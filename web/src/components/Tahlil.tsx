'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, errorText, isUnauthorized } from '@/lib/api';
import { fmtDT, fmtT, num } from '@/lib/format';
import type { TahlilCmp, TahlilData, TahlilManager, TahlilPeriod, TahlilSource, TahlilXulosa } from '@/lib/types';
import { useApp } from './AppContext';
import { PageHead } from './Shell';

/* Tahlil — rahbar sahifasi (B dizayn, design-demo-b/tahlil.html). Uchta savol: bugun nima bo‘ldi · qayerda yo‘qotamiz · kimga e’tibor kerak.
   Ma’lumot: GET /api/tahlil?period=today|7|30 (bitta so‘rov — hamma bloklar), POST /api/tahlil/xulosa — AI xulosasini qayta tuzish. */

const PERIODS: [TahlilPeriod, string][] = [['today', 'Bugun'], ['7', '7 kun'], ['30', '30 kun']];
const NO_SOURCE = 'Manba yo‘q';
const NO_MANAGER = 'Mas’ul yo‘q';

/* ---------- formatlash ---------- */
/** So‘m: ≥1 mlrd → «1.2 mlrd», ≥1 mln → «186 mln» (kasr faqat kerak bo‘lsa), kichigi — to‘liq raqam */
const somParts = (n: number): { v: string; unit: string } => {
  const a = Math.abs(n), one = (x: number) => (Math.round(x * 10) / 10).toString();
  if (a >= 1e9) return { v: one(n / 1e9), unit: 'mlrd so‘m' };
  if (a >= 1e6) return { v: one(n / 1e6), unit: 'mln so‘m' };
  return { v: num(n), unit: 'so‘m' };
};
const som = (n: number): string => { const p = somParts(n); return `${p.v} ${p.unit}`; };
/** Jadval uchun qisqa: «402 mln» (so‘msiz) */
const somShort = (n: number): string => { const p = somParts(n); return `${p.v} ${p.unit.replace(' so‘m', '')}`.trim(); };
const pct1 = (v: number): string => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const signed = (d: number, fmt: (x: number) => string = x => String(x)): string => (d === 0 ? '0' : (d > 0 ? '+' : '−') + fmt(Math.abs(d)));
const ddmm = (iso: string): string => { const [, m, d] = iso.split('-'); return d && m ? `${d}.${m}` : iso; };

/* ---------- KPI solishtiruv belgisi: ▲ yaxshi (yashil) · ▼ yomon (qizil) · = o‘zgarmadi ---------- */
function Cmp({ now, cmp, moreIsWorse = false, fmt, note }: { now: number; cmp: TahlilCmp; moreIsWorse?: boolean; fmt?: (x: number) => string; note: string }) {
  const d = now - cmp.prev;
  const better = d === 0 ? null : moreIsWorse ? d < 0 : d > 0;
  const cls = better == null ? 'flat' : better ? 'up' : 'down';
  const arrow = better == null ? '=' : better ? '▲' : '▼';
  return <div className="cmp"><b className={cls}>{arrow} {signed(d, fmt)}</b><span>{note}</span></div>;
}

/* ---------- «Bugun oddiy tilda»: AI xulosasi, «Yangilash» → POST ---------- */
function Xulosa({ x, syncedAt, onChange }: { x: TahlilXulosa; syncedAt: number | null; onChange: (x: TahlilXulosa) => void }) {
  const { fail, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      // Backend AI xatosini 502 + { ok:false, why } bilan qaytaradi — api() tashlamaydi, o‘zimiz tekshiramiz (Voronka kabi)
      const r = await api<{ ok?: boolean; why?: string; text: string[] | null; at: number | null; model: string | null }>('/api/tahlil/xulosa', { force: true });
      if (r.ok === false) { toast(r.why || 'AI xatosi', 'bad'); return; }
      onChange({ text: r.text, at: r.at, model: r.model, stale: false });
      toast('AI xulosasi tayyor', 'ai');
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  const btn = (label: string) => <button className="btn sm primary" type="button" disabled={busy} onClick={() => { void run(); }}>{busy ? 'AI yozmoqda…' : label}</button>;
  return (
    <div className="panel th-xulosa">
      <div className="panel-head"><h2>Bugun oddiy tilda</h2><span className="pill ai">AI yozdi</span>
        {x.text && x.stale ? <span className="pill warn" title="Bir soatdan eski — «Yangilash» bosing">eskirgan</span> : null}
        <div className="right">{x.at ? <span className="muted mono">{fmtT(x.at)}{x.model ? ` · ${x.model}` : ''}</span> : null}{x.text ? btn('Yangilash') : null}</div></div>
      <div className="panel-help">Raqamlardan AI tuzgan xulosa. Har gap pastdagi jadvallardan olingan, raqamlar o‘sha yerda tekshiriladi.</div>
      {x.text ? (
        <div className="summary">
          <ul>{x.text.map((t, i) => <li key={i}>{t}</li>)}</ul>
          <div className="meta">manba: Odoo{syncedAt ? ` · ${fmtDT(syncedAt)}` : ''}</div>
        </div>
      ) : (
        <div className="row-actions"><span className="muted">Xulosa hali tuzilmagan.</span>{btn('Xulosa tuzish')}</div>
      )}
    </div>
  );
}

/* ---------- 30 kun: kelgan lid (kulrang) va sotuv (ko‘k) ustunlari, sof CSS ---------- */
function Chart({ d }: { d: TahlilData }) {
  const s = d.series, max = Math.max(1, ...s.map(p => p.in));
  const h = (v: number) => `${Math.round(100 * v / max)}%`;
  const t = d.series_total, dconv = t.conv - t.prev_conv;
  const labels = [0, 7, 14, 21].filter(i => i < s.length - 1).map(i => ddmm(s[i].date));
  return (
    <div className="panel">
      <div className="panel-head"><h2>30 kun dinamika</h2><span className="sub">har kun: kelgan lidlar va sotuvlar</span>
        <div className="right legend"><span><i className="in" />Kelgan lid</span><span><i className="won" />Sotuv</span></div></div>
      <div className="panel-help">Kulrang ustun — shu kuni kelgan lidlar, ko‘k — shu kuni yopilgan sotuvlar. Konversiya = sotuv ÷ kelgan.</div>
      {s.length ? <>
        <div className="chart" role="img" aria-label={`30 kun: ${t.in} lid, ${t.won} sotuv`}>
          {s.map(p => <div className="d" key={p.date} title={`${ddmm(p.date)}: ${p.in} lid · ${p.won} sotuv`}><i className="in" style={{ height: h(p.in) }} /><i className="won" style={{ height: h(p.won) }} /></div>)}
        </div>
        <div className="chart-x">{labels.map(l => <span key={l}>{l}</span>)}<span>bugun</span></div>
      </> : <p className="muted">Hali ma’lumot yo‘q.</p>}
      <div className="panel-foot">30 kunda: <b>{num(t.in)} lid</b> kelgan · <b>{num(t.won)} sotuv</b> · konversiya <b>{pct1(t.conv)}%</b> (oldingi 30 kun: {pct1(t.prev_conv)}%)
        <div className="right">{dconv > 0 ? <span className="ok-txt">▲ yaxshilanyapti</span> : dconv < 0 ? <span className="flag">▼ yomonlashyapti</span> : <span className="muted">= o‘zgarmadi</span>}</div></div>
    </div>
  );
}

/* ---------- Manbalar: eng yaxshi konversiya yashil; izoh — «har N-lid sotuvga aylanadi» ---------- */
function bestSource(rows: TahlilSource[]): TahlilSource | null {
  const withWon = rows.filter(r => r.won > 0 && r.name !== NO_SOURCE);
  return withWon.length ? withWon.reduce((a, b) => (b.conv > a.conv ? b : a)) : null;
}

/* ---------- Menejer holati: pill yoki qizil belgi ---------- */
function ManagerStatus({ m }: { m: TahlilManager }) {
  if (m.status === 'yaxshi') return <span className="pill ok">yaxshi</span>;
  if (m.status === 'ortacha') return <span className="pill">o‘rtacha</span>;
  if (m.status === 'etibor') return <span className="flag">e’tibor: {m.silent_leads} lid 2 kundan jim</span>;
  if (!m.user_id || m.name === NO_MANAGER) return <span className="flag">taqsimlanmagan</span>;
  return <span className="muted">—</span>;
}

export function Tahlil({ active }: { active: boolean }) {
  const [period, setPeriod] = useState<TahlilPeriod>('today');
  const [allManagers, setAllManagers] = useState(false);   // davrda lid olmagan menejerlar (Odoo’dagi barcha foydalanuvchilar) — yig‘ilgan holda
  const [d, setD] = useState<TahlilData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const retry = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    if (!active) return;
    let dead = false;
    setD(null); setErr(null);
    api<TahlilData>(`/api/tahlil?period=${period}`).then(x => { if (!dead) setD(x); }).catch(e => { if (!dead && !isUnauthorized(e)) setErr(errorText(e)); });
    return () => { dead = true; };
  }, [active, period, tick]);

  const head = (
    <PageHead route="tahlil">
      <div className="seg" role="group" aria-label="Davr">{PERIODS.map(([p, l]) => <button key={p} type="button" aria-pressed={period === p} onClick={() => setPeriod(p)}>{l}</button>)}</div>
    </PageHead>
  );
  if (err) return <>{head}<div className="banner bad"><div><b>Tahlil yuklanmadi.</b> {err}</div><div className="right"><button className="btn sm" type="button" onClick={retry}>Qayta urinish</button></div></div></>;
  if (!d) return <>{head}<p className="muted th-loading">Yuklanmoqda…</p></>;

  const t = d.today, label = PERIODS.find(([p]) => p === period)?.[1] ?? '';
  const prevL = period === 'today' ? 'kecha' : 'oldingi davr';
  // Ulush faqat ma’noli bo‘lsa: «ishga olingan» davrda ochilganlar bo‘yicha sanaladi, eski lidlar ham kiradi — yangidan ko‘p bo‘lsa foiz ko‘rsatilmaydi
  const takenPct = t.new && t.taken <= t.new ? Math.round(100 * t.taken / t.new) : null;
  const amount = somParts(t.won_amount);
  const maxAvg = Math.max(1, ...d.stages.map(s => s.avg_days ?? 0));
  // Jadvalda — davrda lid olgan/sotgan menejerlar va «Mas’ul yo‘q»; qolganlari (ro‘yxat uzun, ko‘pi Odoo’dagi bo‘sh hisoblar) — tugma bilan
  const isActiveM = (m: TahlilManager) => m.taken > 0 || m.won > 0 || !m.user_id || m.name === NO_MANAGER;
  const idleManagers = d.managers.filter(m => !isActiveM(m));
  const shownManagers = allManagers ? d.managers : d.managers.filter(isActiveM);
  const best = bestSource(d.sources);
  const ai = d.ai;

  return (
    <>
      {head}
      <div className="today">
        <div className="kpi"><div className="lbl">Yangi lid</div><div className="v">{num(t.new)}</div>
          <Cmp now={t.new} cmp={t.cmp.new} note={`${prevL} ${num(t.cmp.new.prev)} · 7 kun o‘rtacha ${pct1(t.cmp.new.avg7)}`} /></div>
        <div className="kpi"><div className="lbl">Ishga olingan</div><div className="v">{num(t.taken)}{takenPct != null ? <small>{takenPct}%</small> : null}</div>
          <Cmp now={t.taken} cmp={t.cmp.taken} note={`${prevL} ${num(t.cmp.taken.prev)}`} /></div>
        <div className="kpi"><div className="lbl">Sotuv</div><div className="v ok">{num(t.won)}</div>
          <Cmp now={t.won} cmp={t.cmp.won} note={`${prevL} ${num(t.cmp.won.prev)} · 7 kun ${pct1(t.cmp.won.avg7)}`} /></div>
        <div className="kpi"><div className="lbl">Sotuv summasi</div><div className="v">{amount.v} <small>{amount.unit}</small></div>
          <Cmp now={t.won_amount} cmp={t.cmp.won_amount} fmt={somShort} note={`${prevL} ${somShort(t.cmp.won_amount.prev)}`} /></div>
        <div className="kpi"><div className="lbl">Yo‘qotilgan</div><div className="v bad">{num(t.lost)}</div>
          <Cmp now={t.lost} cmp={t.cmp.lost} moreIsWorse note={`${prevL} ${num(t.cmp.lost.prev)}${t.lost_top_reason ? ` · sabab: ${t.lost_top_reason.name} ${t.lost_top_reason.n}` : ''}`} /></div>
      </div>

      <Xulosa x={d.xulosa} syncedAt={d.odoo_synced_at} onChange={x => setD({ ...d, xulosa: x })} />

      <Chart d={d} />

      <div className="sec-two">
        <div className="panel">
          <div className="panel-head"><h2>Qayerda yo‘qotamiz</h2><span className="sub">bosqichlar bo‘yicha, {label.toLowerCase()}</span></div>
          <div className="panel-help">«Qotib qolgan» — 24 soatdan ko‘p harakatsiz lid. Eng muammoli bosqich qizil bilan.</div>
          <div className="tbl"><table>
            <thead><tr><th>Bosqich</th><th className="n">Hozir</th><th className="n">Qotib qolgan</th><th className="n">Yo‘qotilgan</th><th>O‘rtacha vaqt</th></tr></thead>
            <tbody>
              {d.stages.length ? d.stages.map(s => <tr key={s.id}>
                <td className="who">{s.name}{s.is_bottleneck ? <> <span className="pill bad">muammo</span></> : null}</td>
                <td className="n">{num(s.now)}</td>
                <td className="n">{s.is_bottleneck ? <span className="pill bad">{num(s.stuck)}</span> : num(s.stuck)}</td>
                <td className="n">{s.is_bottleneck ? <span className="pill bad">{num(s.lost)}</span> : num(s.lost)}</td>
                <td>{s.avg_days == null ? <span className="muted">—</span> : <span className="bar"><span className="track"><span className={`fill${s.is_bottleneck ? ' bad' : ''}`} style={{ width: `${Math.round(100 * s.avg_days / maxAvg)}%` }} /></span><b>{pct1(s.avg_days)} kun</b></span>}</td>
              </tr>) : <tr><td colSpan={5} className="muted">Bu davrda lid yo‘q</td></tr>}
            </tbody></table></div>
          {d.stages_note ? <p className="tbl-note">{d.stages_note}</p> : null}
        </div>

        <div className="panel">
          <div className="panel-head"><h2>Manbalar</h2><span className="sub">qayerdan kelgan va qanchasi sotilgan, {label.toLowerCase()}</span></div>
          <div className="panel-help">Konversiya — sotuv ÷ kelgan. Marketing xarajati Bobur dashboardidan qo‘shiladi.</div>
          <div className="tbl"><table>
            <thead><tr><th>Manba</th><th className="n">Kelgan</th><th className="n">Sotuv</th><th className="n">Konversiya</th></tr></thead>
            <tbody>
              {d.sources.length ? d.sources.map(s => <tr key={s.id}>
                <td className="who">{s.name === NO_SOURCE ? <span className="pill warn">{s.name}</span> : s.name}</td>
                <td className="n">{num(s.in)}</td><td className="n">{num(s.won)}</td>
                <td className="n">{!s.won ? <span className="muted">—</span> : best && best.id === s.id ? <span className="pill ok">{pct1(s.conv)}%</span> : `${pct1(s.conv)}%`}</td>
              </tr>) : <tr><td colSpan={4} className="muted">Ma’lumot yo‘q</td></tr>}
            </tbody></table></div>
          <p className="tbl-note">{best ? <>{best.name} eng foydali manba: har {Math.max(1, Math.round(best.in / best.won))}-lid sotuvga aylanadi.</> : 'Davrda sotuvga aylangan lid yo‘q.'}</p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h2>Menejerlar</h2><span className="sub">{label} · kim qanday ishlayapti</span></div>
        <div className="panel-help">«Vaqtida javob» — lidga 24 soat ichida birinchi harakat. «E’tibor» — 2 kundan ko‘p jim turgan lidlar bor.</div>
        <div className="tbl"><table>
          <thead><tr><th>Menejer</th><th className="n">Olgan lid</th><th className="n">Vaqtida javob</th><th className="n">Sotuv</th><th className="n">Summa</th><th className="n">Yo‘qotgan</th><th>Holat</th></tr></thead>
          <tbody>
            {d.managers.length ? shownManagers.map((m, i) => {
              const noOwner = !m.user_id || m.name === NO_MANAGER;
              return <tr key={m.user_id || `n${i}`}>
                <td className="who">{noOwner ? <span className="pill warn">{m.name || NO_MANAGER}</span> : m.name}</td>
                <td className="n">{num(m.taken)}</td>
                <td className="n">{m.on_time_pct == null ? <span className="muted">—</span> : m.on_time_pct < 70 ? <span className="pill bad">{pct1(m.on_time_pct)}%</span> : `${pct1(m.on_time_pct)}%`}</td>
                <td className="n">{num(m.won)}</td>
                <td className="n">{m.won_amount ? somShort(m.won_amount) : <span className="muted">—</span>}</td>
                <td className="n">{noOwner ? <span className="muted">—</span> : m.lost_pct >= 30 ? <span className="pill bad">{pct1(m.lost_pct)}%</span> : `${pct1(m.lost_pct)}%`}</td>
                <td><ManagerStatus m={m} /></td>
              </tr>;
            }) : <tr><td colSpan={7} className="muted">Ma’lumot yo‘q</td></tr>}
          </tbody></table></div>
        {idleManagers.length ? <div className="panel-foot"><span className="muted">{allManagers ? 'Davrda lid olmaganlar ham ko‘rsatilmoqda' : `Yana ${idleManagers.length} ta menejer davrda lid olmagan`}</span>
          <div className="right"><button className="btn sm ghost" type="button" onClick={() => setAllManagers(v => !v)}>{allManagers ? 'Yashirish' : 'Ko‘rsatish'}</button></div></div> : null}
      </div>

      <div className="panel">
        <div className="panel-head"><h2>AI agent hissasi</h2><span className="sub">{label} · Instagram va Telegram suhbatlari</span></div>
        <div className="panel-help">AI birinchi javobni beradi va ism-telefon oladi; keyin lid sotuvchiga o‘tadi.</div>
        <div className="ai-grid">
          <div><div className="lbl">Suhbat</div><div className="v">{num(ai.conversations)}</div><div className="s">yangi mijoz yozdi</div></div>
          <div><div className="lbl">AI javob berdi</div><div className="v">{num(ai.ai_replied)} <small>{pct1(ai.ai_replied_pct)}%</small></div><div className="s">{ai.avg_reply_sec == null ? 'javob vaqti hali yo‘q' : `o‘rtacha ${ai.avg_reply_sec} soniyada`}</div></div>
          <div><div className="lbl">Telefon olindi</div><div className="v ok">{num(ai.phones)}</div><div className="s">{pct1(ai.phones_pct)}% suhbatdan</div></div>
          <div><div className="lbl">Sotuvchiga uzatildi</div><div className="v">{num(ai.handoffs)}</div>
            <div className="s">{ai.handoffs_unanswered > 0 ? <span className="flag">{num(ai.handoffs_unanswered)} tasi javobsiz qoldi — sotuvchilar Telegram’ga ulanmagan</span> : ai.handoffs ? 'hammasiga sotuvchi javob berdi' : 'hali uzatilmagan'}</div></div>
        </div>
      </div>
    </>
  );
}
