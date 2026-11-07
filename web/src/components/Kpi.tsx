'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { api, errorText, isUnauthorized } from '@/lib/api';
import { clockNow, num, TZ } from '@/lib/format';
import type { KpiCriterion, KpiData, KpiManager, KpiMetric, KpiRule, KpiSettings, KpiSettingsResp, KpiSettingsSaved, KpiStageRow, KpiStages, KpiTier } from '@/lib/types';
import { useApp } from './AppContext';
import { PageHead } from './Shell';

/* KPI — menejerlarning reja/fakt sahifasi (B2B savdo rejasi, Bobur 07.11). B dizayn (design-demo-b/tahlil.html uslubi).
   Ma’lumot: GET /api/kpi?month=YYYY-MM (bitta so‘rov — menejerlar, bo‘lim savdosi, sozlamalar), GET/POST /api/kpi/settings (faqat rahbar/admin).
   Hamma ko‘radi; sotuvchiga backend faqat o‘z qatorini beradi. Sozlamalar shakli — services/kpi.js DEFAULTS (ichma-ich obyekt). */

type MetricKey = 'meetings' | 'offers' | 'contracts';
type StageKey = 'meeting' | 'offer' | 'contract';
const METRICS: [MetricKey, string, string][] = [['meetings', 'Uchrashuv', 'Uchrashuv'], ['offers', 'Tijorat taklifi', 'Taklif'], ['contracts', 'Shartnoma', 'Shartnoma']];
const STAGE_L: Record<keyof KpiStages, string> = { meeting: 'Uchrashuv', offer: 'Tijorat taklifi', contract: 'Shartnoma', won: 'Yutilgan (sotuv)' };
const CRITERION_L: Record<KpiCriterion, string> = { won: 'yutilgan lid', contract: 'shartnoma bosqichi' };

/* ---------- formatlash ---------- */
/** So‘m: ≥1 mlrd → «1.6 mlrd so‘m», ≥1 mln → «186 mln so‘m» (kasr faqat kerak bo‘lsa), kichigi — to‘liq raqam */
const som = (n: number): string => {
  const a = Math.abs(n), one = (x: number) => (Math.round(x * 10) / 10).toString();
  if (a >= 1e9) return `${one(n / 1e9)} mlrd so‘m`;
  if (a >= 1e6) return `${one(n / 1e6)} mln so‘m`;
  return `${num(n)} so‘m`;
};
/** Foiz: backend reja 0 bo‘lsa null beradi → «—» */
const pct1 = (v: number | null): string => (v == null ? '—' : Number.isInteger(v) ? String(v) : v.toFixed(1));
const ddmm = (iso: string): string => { const [, m, d] = iso.split('-'); return d && m ? `${d}.${m}` : iso; };
/** Toshkent bo‘yicha joriy oy «YYYY-MM» */
const monthOf = (ts: number): string => new Date(ts).toLocaleDateString('en-CA', { timeZone: TZ }).slice(0, 7);
const shiftMonth = (ym: string, by: number): string => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const barW = (fact: number, plan: number): string => `${plan > 0 ? Math.min(100, Math.round(100 * fact / plan)) : 0}%`;

const Chev = ({ dir }: { dir: 'l' | 'r' }) => <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={dir === 'l' ? 'm15 6-6 6 6 6' : 'm9 6 6 6-6 6'} /></svg>;

/* ---------- jadval katagi: fakt/reja · chiziq · foiz pill · «bugungi kungacha N» ---------- */
function MetricCell({ m, current }: { m: KpiMetric; current: boolean }) {
  return (
    <td className="kp-m">
      <div className="kp-fp"><b className="mono">{num(m.fact)}</b><span className="muted">/ {num(m.plan)}</span>
        {m.state === 'sozlanmagan' ? <span className="pill warn" title="Odoo bosqichi topilmadi">sozlanmagan</span> : <span className={`pill ${m.ok ? 'ok' : 'bad'}`} title={`To‘lov: ${som(m.pay)}`}>{pct1(m.pct)}%</span>}</div>
      <span className={`bar${m.ok ? '' : ' low'}`}><span className="track"><span className="fill" style={{ width: barW(m.fact, m.plan) }} /></span></span>
      {current ? <small className="muted">bugungi kungacha {num(m.mtd_plan)}</small> : null}
    </td>
  );
}

/* ---------- «Bugun»: har menejer bo‘yicha bugungi fakt/reja (faqat joriy oy) ---------- */
function TodayStrip({ managers, today }: { managers: KpiManager[]; today: string }) {
  const cell = (m: KpiMetric, label: string) => <span className={m.today_fact >= m.today_plan ? 'ok' : ''}>{label} <b className="mono">{num(m.today_fact)}/{num(m.today_plan)}</b></span>;
  return (
    <div className="panel kp-today">
      <div className="panel-head"><h2>Bugun</h2><span className="sub">{ddmm(today)} · kunlik reja bo‘yicha fakt</span></div>
      <div className="kp-tcells">
        {managers.map(m => <div className={`kp-tcell${m.is_me ? ' me' : ''}`} key={m.user_id}>
          <b className="who">{m.name}</b>
          <span className="vals">{cell(m.meetings, 'Uchrashuv')}<i>·</i>{cell(m.offers, 'Taklif')}<i>·</i>{cell(m.contracts, 'Shartnoma')}</span>
        </div>)}
      </div>
    </div>
  );
}

/* ---------- Oylik reja va fakt: asosiy jadval, etakda jami ---------- */
function ManagersTable({ d, current }: { d: KpiData; current: boolean }) {
  const ms = d.managers;
  const sum = (f: (m: KpiManager) => number) => ms.reduce((a, m) => a + f(m), 0);
  return (
    <div className="panel">
      <div className="panel-head"><h2>Oylik reja va fakt</h2><span className="sub">{d.month} · ish kuni {num(d.workdays.elapsed)} / {num(d.workdays.total)}{d.team ? ` · ${d.team.name}` : ''}</span></div>
      {d.note ? <div className="panel-help">{d.note}</div> : null}
      <div className="tbl kp-tbl"><table>
        <thead><tr><th>Menejer</th>{METRICS.map(([k, l]) => <th key={k}>{l}</th>)}<th className="n">Transport</th><th className="n">KPI to‘lov</th><th className="n">Jami</th></tr></thead>
        <tbody>
          {ms.length ? ms.map(m => <tr key={m.user_id} className={m.is_me ? 'me' : undefined}>
            <td className="who">{m.name}{m.is_me ? <> <span className="pill brand">siz</span></> : null}{!m.staff_user_id ? <> <span className="pill warn" title="Odoo foydalanuvchisi panel xodimiga bog‘lanmagan">panelda yo‘q</span></> : null}</td>
            {METRICS.map(([k]) => <MetricCell key={k} m={m[k]} current={current} />)}
            <td className="n"><span className="mono">{num(m.transport.pay)}</span><small className="muted">{num(m.transport.meetings)} × {num(m.transport.per)}</small></td>
            <td className="n"><span className="mono">{num(m.kpi_pay)}</span><small className="muted">+ fiks {num(m.fixed)}</small></td>
            <td className="n"><b className="mono">{num(m.total)}</b></td>
          </tr>) : <tr><td colSpan={7} className="muted">Bu oyda hisoblangan menejer yo‘q</td></tr>}
        </tbody>
        {ms.length ? <tfoot><tr>
          <td>Jami · {ms.length} menejer</td>
          {METRICS.map(([k]) => <td key={k} className="kp-m"><div className="kp-fp"><b className="mono">{num(sum(m => m[k].fact))}</b><span className="muted">/ {num(sum(m => m[k].plan))}</span></div></td>)}
          <td className="n"><span className="mono">{num(sum(m => m.transport.pay))}</span></td>
          <td className="n"><span className="mono">{num(sum(m => m.kpi_pay))}</span></td>
          <td className="n"><b className="mono">{num(sum(m => m.total))}</b></td>
        </tr></tfoot> : null}
      </table></div>
      <div className="panel-foot">Foiz — oy rejasiga nisbatan fakt. To‘lov har KPI uchun eng kam foizga yetganda beriladi (shartnoma — rejaning 100 %). Fiks — davomat bo‘yicha, HR hisoblaydi. Summalar so‘mda.</div>
    </div>
  );
}

/* ---------- Bo‘lim savdosi: oy chizig‘i · haftalar · chorak ---------- */
function SalesPanel({ d }: { d: KpiData }) {
  const s = d.sales, mo = s.month, q = s.quarter, rules = d.settings.sales, tiers = rules.week_tiers;
  const period = (label: string, p: { volume: number; plan: number; pct: number | null; ok: boolean; bonus: number }, sub?: string) => (
    <div className="kp-period">
      <div className="kp-plabel"><b>{label}</b>{sub ? <span className="muted">{sub}</span> : null}</div>
      <span className={`bar${p.ok ? '' : ' low'}`}><span className="track"><span className="fill" style={{ width: barW(p.volume, p.plan) }} /></span></span>
      <div className="kp-pvals"><b className="mono">{som(p.volume)}</b><span className="muted">/ {som(p.plan)}</span><span className={`pill ${p.ok ? 'ok' : 'bad'}`}>{pct1(p.pct)}%</span>
        <span className={`kp-bonus${p.bonus > 0 ? ' on' : ''}`}>{p.bonus > 0 ? `bonus ${som(p.bonus)}` : 'bonus yo‘q'}</span></div>
    </div>
  );
  return (
    <div className="panel">
      <div className="panel-head"><h2>Bo‘lim savdosi</h2><span className="sub">reja va bonus — butun bo‘lim bo‘yicha</span><div className="right"><span className="pill">hisob: {CRITERION_L[s.criterion]}</span></div></div>
      <div className="panel-help">Oylik bonus — reja {pct1(rules.month_pct)}% dan oshsa; haftalik — hafta hajmi pog‘onaning {pct1(rules.week_pct)}% iga yetsa (eng yuqori pog‘ona, qo‘shilmaydi); choraklik — chorak rejasining {pct1(rules.quarter_pct)}% i bajarilsa.</div>
      {period('Oy rejasi', mo, d.month)}
      <div className="tbl kp-tbl"><table>
        <thead><tr><th>Hafta</th><th className="n">Hajm</th><th>Pog‘ona</th><th className="n">Bonus</th></tr></thead>
        <tbody>
          {s.weeks.length ? s.weeks.map(w => {
            const idx = w.tier == null ? -1 : tiers.findIndex(t => t.from === w.tier);
            return <tr key={w.from}>
              <td className="who"><span className="mono">{ddmm(w.from)} – {ddmm(w.to)}</span></td>
              <td className="n">{som(w.volume)}</td>
              <td>{w.tier == null ? <span className="muted">pog‘onaga yetmadi</span> : <span className="pill ok">{idx >= 0 ? `${idx + 1}-pog‘ona · ` : ''}{som(w.tier)}+</span>}</td>
              <td className="n">{w.bonus > 0 ? som(w.bonus) : <span className="muted">—</span>}</td>
            </tr>;
          }) : <tr><td colSpan={4} className="muted">Bu oyda hafta hisobi yo‘q</td></tr>}
        </tbody>
      </table></div>
      {period('Chorak', q, `${q.from} – ${q.to}`)}
    </div>
  );
}

/* ---------- Sozlamalar (faqat rahbar): KPI qoidalari · transport · bo‘lim bonusi · pog‘onalar · bosqichlar · HR havolasi ---------- */
const RULE_FIELDS: [keyof KpiRule, string][] = [['day', 'Kunlik reja'], ['month', 'Oylik reja'], ['pct', 'Eng kam foiz, %'], ['pay', 'To‘lov, so‘m']];
const SALES_FIELDS: [keyof Omit<KpiSettings['sales'], 'week_tiers'>, string][] = [
  ['month_plan', 'Oylik reja, so‘m'], ['month_pct', 'Oylik bonus uchun eng kam %'], ['month_bonus', 'Oylik bonus, so‘m'],
  ['quarter_plan', 'Chorak rejasi, so‘m'], ['quarter_pct', 'Chorak bonusi uchun eng kam %'], ['quarter_bonus', 'Chorak bonusi, so‘m'],
  ['week_pct', 'Haftalik pog‘ona uchun eng kam %']
];
const DOW_L = ['Du', 'Se', 'Cho', 'Pa', 'Ju', 'Sha', 'Ya'];
const NumField = ({ label, value, pct, onChange }: { label: string; value: number; pct?: boolean; onChange: (v: number) => void }) => (
  <label className="field"><span>{label}</span><input type="number" min={0} max={pct ? 100 : undefined} step={pct ? 1 : 'any'} value={value} onChange={e => onChange(Number(e.target.value))} /></label>
);

function SettingsPanel({ init, open, onToggle, onSaved, panelRef }: { init: KpiSettings; open: boolean; onToggle: () => void; onSaved: (s: KpiSettings) => void; panelRef: RefObject<HTMLDivElement | null> }) {
  const { toast, fail } = useApp();
  const [s, setS] = useState<KpiSettings>(init);
  const [busy, setBusy] = useState(false);
  // Odoo bosqichlari ro‘yxati va avtomatik topilganlari — panel ochilganda bir marta (GET /api/kpi/settings)
  const [meta, setMeta] = useState<{ stages: KpiStageRow[]; detected: KpiStages } | null>(null);
  useEffect(() => {
    if (!open || meta) return;
    let dead = false;
    api<KpiSettingsResp>('/api/kpi/settings').then(r => { if (!dead) setMeta({ stages: r.stages, detected: r.detected }); }).catch(e => { if (!dead) fail(e); });
    return () => { dead = true; };
  }, [open, meta, fail]);

  const setRule = (k: MetricKey, f: keyof KpiRule, v: number) => setS(x => ({ ...x, [k]: { ...x[k], [f]: v } }));
  const setSales = (f: keyof Omit<KpiSettings['sales'], 'week_tiers'>, v: number) => setS(x => ({ ...x, sales: { ...x.sales, [f]: v } }));
  const setTiers = (tiers: KpiTier[]) => setS(x => ({ ...x, sales: { ...x.sales, week_tiers: tiers } }));
  const setTier = (i: number, f: keyof KpiTier, v: number) => setTiers(s.sales.week_tiers.map((t, k) => (k === i ? { ...t, [f]: v } : t)));
  const addTier = () => { const last = s.sales.week_tiers.at(-1); setTiers([...s.sales.week_tiers, last ? { from: last.from * 2, bonus: last.bonus * 2 } : { from: 0, bonus: 0 }]); };
  const rmTier = (i: number) => setTiers(s.sales.week_tiers.filter((_, k) => k !== i));
  const toggleDow = (i: number) => setS(x => ({ ...x, work_dow: x.work_dow.split('').map((c, k) => (k === i ? (c === '1' ? '0' : '1') : c)).join('') }));
  const setStage = (k: StageKey, v: string) => setS(x => ({ ...x, stages: { ...x.stages, [k]: v ? Number(v) : null } }));

  const save = async () => {
    setBusy(true);
    try {
      const tiers = [...s.sales.week_tiers].sort((a, b) => a.from - b.from);
      const r = await api<KpiSettingsSaved>('/api/kpi/settings', { ...s, sales: { ...s.sales, week_tiers: tiers } });
      setS(r.settings); onSaved(r.settings); toast(r.changed.length ? 'Saqlandi' : 'O‘zgarish yo‘q', 'ok');
    } catch (e) { fail(e); } finally { setBusy(false); }
  };
  return (
    <div className="panel kp-settings" ref={panelRef} id="kpiSettings">
      <div className="panel-head"><h2>Sozlamalar</h2><span className="pill brand">faqat rahbar</span><span className="sub">reja, to‘lov va bonus qoidalari</span>
        <div className="right"><button className="btn sm ghost" type="button" aria-expanded={open} aria-controls="kpiSettingsBody" onClick={onToggle}>{open ? 'Yig‘ish' : 'Ochish'}</button></div></div>
      {open ? <div id="kpiSettingsBody" className="kp-sbody">
        <div className="panel-help">O‘zgarish saqlangach joriy oy qayta hisoblanadi. Reja — bir menejer uchun; bo‘lim rejasi — butun bo‘lim hajmi.</div>
        <div className="kp-groups">
          {METRICS.map(([k, title]) => <div className="kp-group" key={k}>
            <h3>{title}</h3>
            <div className="kp-fields">{RULE_FIELDS.map(([f, l]) => <NumField key={f} label={l} value={s[k][f]} pct={f === 'pct'} onChange={v => setRule(k, f, v)} />)}</div>
          </div>)}
          <div className="kp-group">
            <h3>Fiks, transport, ish kunlari</h3>
            <div className="kp-fields">
              <NumField label="Fiks maosh, so‘m" value={s.fixed} onChange={v => setS(x => ({ ...x, fixed: v }))} />
              <NumField label="Bir uchrashuvga, so‘m" value={s.transport.per} onChange={v => setS(x => ({ ...x, transport: { ...x.transport, per: v } }))} />
              <NumField label="Transport chegarasi, so‘m" value={s.transport.max} onChange={v => setS(x => ({ ...x, transport: { ...x.transport, max: v } }))} />
            </div>
            <div className="seg kp-dow" role="group" aria-label="Ish kunlari">
              {DOW_L.map((l, i) => <button key={l} type="button" aria-pressed={s.work_dow[i] === '1'} onClick={() => toggleDow(i)}>{l}</button>)}
            </div>
          </div>
          <div className="kp-group">
            <h3>Bo‘lim bonusi</h3>
            <div className="kp-fields">{SALES_FIELDS.map(([f, l]) => <NumField key={f} label={l} value={s.sales[f]} pct={f.endsWith('_pct')} onChange={v => setSales(f, v)} />)}</div>
          </div>
          <div className="kp-group">
            <h3>Haftalik pog‘onalar</h3>
            <div className="tbl kp-tiers"><table>
              <thead><tr><th>#</th><th>Hajm chegarasi, so‘m</th><th>Bonus, so‘m</th><th /></tr></thead>
              <tbody>{s.sales.week_tiers.map((t, i) => <tr key={i}>
                <td className="mono">{i + 1}</td>
                <td><input className="input" type="number" min={0} value={t.from} aria-label={`${i + 1}-pog‘ona chegarasi`} onChange={e => setTier(i, 'from', Number(e.target.value))} /></td>
                <td><input className="input" type="number" min={0} value={t.bonus} aria-label={`${i + 1}-pog‘ona bonusi`} onChange={e => setTier(i, 'bonus', Number(e.target.value))} /></td>
                <td className="n"><button className="btn sm ghost danger" type="button" onClick={() => rmTier(i)} aria-label="Qatorni o‘chirish">×</button></td>
              </tr>)}
              {!s.sales.week_tiers.length ? <tr><td colSpan={4} className="muted">Pog‘ona yo‘q — saqlab bo‘lmaydi, kamida bittasi kerak</td></tr> : null}</tbody>
            </table></div>
            <div className="row-actions"><button className="btn sm" type="button" onClick={addTier}>Qator qo‘shish</button><span className="muted">Hafta hajmi chegaraning {pct1(s.sales.week_pct)}% iga yetsa — o‘sha pog‘ona bonusi; saqlashda o‘sish tartibida saralanadi.</span></div>
          </div>
          <div className="kp-group">
            <h3>Bo‘lim savdosi nimadan sanaladi</h3>
            <div className="seg" role="group" aria-label="Savdo mezoni">
              {(['won', 'contract'] as KpiCriterion[]).map(c => <button key={c} type="button" aria-pressed={s.sales_criterion === c} onClick={() => setS(x => ({ ...x, sales_criterion: c }))}>{c === 'won' ? 'Yutilgan lid' : 'Shartnoma bosqichi'}</button>)}
            </div>
            <h3>Odoo bosqichlari</h3>
            <div className="kp-stages">{(['meeting', 'offer', 'contract'] as StageKey[]).map(k => <label className="field" key={k}><span>{STAGE_L[k]}</span>
              <select value={s.stages[k] ?? ''} onChange={e => setStage(k, e.target.value)} disabled={!meta}>
                <option value="">{meta?.detected[k] ? `avtomatik — ${meta.detected[k].name}` : 'avtomatik — topilmadi'}</option>
                {(meta?.stages || []).filter(x => !x.is_won).map(x => <option key={x.id} value={x.id}>{x.name} (#{x.id})</option>)}
              </select></label>)}
              <div><span className="muted">{STAGE_L.won}</span>{meta?.detected.won ? <span className="pill ok">{meta.detected.won.name}</span> : <span className="pill warn">topilmadi</span>}</div>
            </div>
            <p className="muted kp-shint">«Avtomatik» — bosqich Odoo’dagi nomidan topiladi; nomlar jamoalar orasida takrorlansa, kerakli bosqichni qo‘lda tanlang.</p>
          </div>
          <div className="kp-group">
            <h3>HR paneliga yuborish</h3>
            <label className="field"><span>Webhook havolasi (https://…)</span><input type="url" value={s.hr_webhook_url ?? ''} placeholder="bo‘sh — yuborilmaydi" onChange={e => setS(x => ({ ...x, hr_webhook_url: e.target.value }))} /></label>
            <p className="muted kp-shint">Har ish kuni 18:00 dan keyin joriy oy hisobi JSON ko‘rinishida shu havolaga POST qilinadi; natija audit jurnalida.</p>
          </div>
        </div>
        <div className="panel-foot"><div className="row-actions right"><button className="btn primary" type="button" disabled={busy} onClick={() => { void save(); }}>{busy ? 'Saqlanmoqda…' : 'Saqlash'}</button></div></div>
      </div> : null}
    </div>
  );
}

export function Kpi({ active }: { active: boolean }) {
  const { isLead } = useApp();
  const [month, setMonth] = useState(() => monthOf(clockNow()));
  const [d, setD] = useState<KpiData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement | null>(null);
  const retry = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    if (!active) return;
    let dead = false;
    setD(null); setErr(null);
    api<KpiData>(`/api/kpi?month=${month}`).then(x => { if (!dead) setD(x); }).catch(e => { if (!dead && !isUnauthorized(e)) setErr(errorText(e)); });
    return () => { dead = true; };
  }, [active, month, tick]);

  const nowMonth = monthOf(clockNow());
  const current = month === nowMonth;
  const openSettings = () => {
    setSettingsOpen(true);
    requestAnimationFrame(() => settingsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  const head = (
    <PageHead route="kpi">
      <div className="kp-month" role="group" aria-label="Oy">
        <button className="btn sm icon" type="button" aria-label="Oldingi oy" onClick={() => setMonth(m => shiftMonth(m, -1))}><Chev dir="l" /></button>
        <span className="mono">{month}</span>
        <button className="btn sm icon" type="button" aria-label="Keyingi oy" disabled={current} onClick={() => setMonth(m => shiftMonth(m, 1))}><Chev dir="r" /></button>
      </div>
      {isLead ? <button className="btn ghost" type="button" onClick={openSettings}>Sozlamalar</button> : null}
    </PageHead>
  );
  if (err) return <>{head}<div className="banner bad"><div><b>KPI yuklanmadi.</b> {err}</div><div className="right"><button className="btn sm" type="button" onClick={retry}>Qayta urinish</button></div></div></>;
  if (!d) return <>{head}<p className="muted kp-loading">Yuklanmoqda…</p></>;

  const missing = (Object.keys(STAGE_L) as (keyof KpiStages)[]).filter(k => !d.stages[k] && (k !== 'won' || d.settings.sales_criterion === 'won'));

  return (
    <>
      {head}
      {missing.length ? <div className="banner warn"><div><b>KPI bosqichlari sozlanmagan:</b> {missing.map(k => STAGE_L[k]).join(', ')}. Odoo’da shu nomdagi bosqich topilmadi — raqamlar nol bo‘lib turadi{isLead ? '; Sozlamalarda qo‘lda tanlang' : ''}.</div></div> : null}
      {current && d.managers.length ? <TodayStrip managers={d.managers} today={d.today} /> : null}
      <ManagersTable d={d} current={current} />
      <SalesPanel d={d} />
      {isLead ? <SettingsPanel key={`${d.month}-${tick}`} init={d.settings} open={settingsOpen} onToggle={() => setSettingsOpen(v => !v)} panelRef={settingsRef}
        onSaved={s => { setD({ ...d, settings: s }); retry(); }} /> : null}
    </>
  );
}
