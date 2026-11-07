'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { fmtDT } from '@/lib/format';
import { useApp } from './AppContext';
import { Select } from './Select';
import { useOpenLead } from './LeadModal';

/* NAZORAT 24 SOAT — Odoo lidlari: nazorat bosqichida qimirlamay qolganlar, menejer kesimi, Telegram ogohlantirishlar (mijoz talabi, 2026-11-06)
   B varianti (2026-11-07): filtr paneli · KPI · zebra jadvallar · sozlamalar paneli; ekran CSS — app/screens/b-nazorat.css */
interface StageOpt { id: number; name: string; sequence: number; is_won: number }
interface Item { id: number; name: string; stage: string; user: string | null; user_id: number | null; last_at: number; hours: number; level: number; days: number; last_note: string | null; alerted: number[]; staff: string | null; staff_linked: boolean }
interface ByUser { name: string; user_id: number | null; staff: string | null; linked: boolean; n: number; over_48: number; over_72: number; max_hours: number }
interface Data {
  stages: StageOpt[]; chosen: StageOpt[]; auto: boolean; hours: number; escalate: number; max_days: number; notify: boolean; as_of: number;
  team: number | null; teams: { id: number; name: string; leads: number }[];
  totals: { over_24: number; over_48: number; over_72: number; no_user: number; notified: number; old: number }; by_user: ByUser[]; items: Item[];
}

const hoursStr = (h: number) => h >= 48 ? `${Math.floor(h / 24)} kun` : `${h} soat`;
const levelCls = (h: number) => h >= 48 ? 'bad' : 'warn';

/** Kichik belgi ikonalari (ui.tsx IC’da yo‘q): yetkazilgan xabar darajasi va ma’lumot */
const CheckIc = () => <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>;
const InfoIc = () => <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg>;

function SettingsForm({ d, onSaved, onRun }: { d: Data; onSaved: () => void; onRun: () => void }) {
  const { toast, fail } = useApp();
  const [stages, setStages] = useState<number[]>(d.chosen.map(s => s.id));
  const [hours, setHours] = useState(d.hours);
  const [esc, setEsc] = useState(d.escalate);
  const [maxDays, setMaxDays] = useState(d.max_days);
  const [notify, setNotify] = useState(d.notify);
  const toggle = (id: number) => setStages(xs => xs.includes(id) ? xs.filter(x => x !== id) : [...xs, id]);
  const save = async () => {
    const r = await api('/api/nazorat/settings', { stages, nazorat_hours: hours, nazorat_escalate_hours: esc, nazorat_max_days: maxDays, nazorat_notify: notify }).catch(fail);
    if (r) { toast('Saqlandi'); onSaved(); }
  };
  return (
    <div className="panel nz-panel">
      <div className="panel-head"><h2>Sozlamalar</h2><span className="pill brand">faqat rahbar</span><span className="sub muted">{d.auto ? 'Bosqichlar nomidan avtomatik tanlangan — kerak bo‘lsa o‘zgartiring' : 'Rahbar tanlagan bosqichlar'}</span></div>
      <div className="panel-help">Qaysi bosqichlar nazorat qilinadi va necha soatdan keyin kimga xabar ketadi.</div>
      <div className="panel-body">
        <div className="form-grid nz-settings">
          <div className="field nz-stages"><span>Nazorat bosqichlari (Odoo)</span>
            <div className="row-actions chips">{d.stages.filter(s => !s.is_won).map(s => (
              <button key={s.id} type="button" className="chip" aria-pressed={stages.includes(s.id)} onClick={() => toggle(s.id)}>{s.name}</button>))}</div></div>
          <label className="field"><span>Menejerga xabar (soat)</span><input type="number" min={1} max={720} value={hours} onChange={e => setHours(Number(e.target.value))} /></label>
          <label className="field"><span>Rahbarga xabar (soat)</span><input type="number" min={1} max={720} value={esc} onChange={e => setEsc(Number(e.target.value))} /></label>
          <label className="field"><span>Eskirgan deb hisoblash (kun)</span><input type="number" min={1} max={3650} value={maxDays} onChange={e => setMaxDays(Number(e.target.value))} /></label>
          <label className="field"><span>Telegram xabarlari</span><Select value={notify ? 'true' : 'false'} onChange={e => setNotify(e.target.value === 'true')}><option value="true">yoqilgan</option><option value="false">o‘chiq</option></Select></label>
        </div>
        <p className="muted nz-help">Xabar menejerga — Odoo’dagi mas’ul panelda shu ism bilan bo‘lsa va Telegram ulagan bo‘lsa; bo‘lmasa yoki muddat o‘tsa — rahbarga. Har lid uchun har daraja (24 / 48 / 72 soat) bir marta, faqat ish vaqtida. «Eskirgan» lidlar (harakatsiz {maxDays} kundan ko‘p) ro‘yxatga va xabarlarga kirmaydi — ular Voronka’da «Qotib qolgan»da ko‘rinadi.</p>
      </div>
      <div className="panel-foot"><div className="row-actions right">
        <button className="btn" type="button" onClick={onRun}>Hozir tekshirish</button>
        <button className="btn primary" type="button" onClick={() => { void save(); }}>Saqlash</button>
      </div></div>
    </div>
  );
}

export function Nazorat({ active }: { active: boolean }) {
  const { isLead, toast, fail } = useApp();
  const openLead = useOpenLead();
  const [team, setTeam] = useState<string>('');
  const [d, setD] = useState<Data | null>(null);
  const [rev, setRev] = useState(0);
  const reload = useCallback(() => setRev(v => v + 1), []);

  useEffect(() => {
    if (!active) return;
    let dead = false;
    api<Data>(`/api/nazorat${team ? `?team=${team}` : ''}`).then(x => { if (!dead) setD(x); }).catch(fail);
    return () => { dead = true; };
  }, [active, team, rev, fail]);

  const runNow = async () => { const r = await api('/api/nazorat/run', {}).catch(fail); if (r) toast(`Tekshirildi: ${r.leads ?? 0} lid, ${r.sent ?? 0} xabar`); reload(); };

  if (!d) return null;
  const t = d.totals;
  return (
    <>
      <div className="filters nz-filters">
        <span className="lbl">Jamoa</span>
        <Select aria-label="Jamoa" value={team || (d.team != null ? String(d.team) : 'all')} onChange={e => setTeam(e.target.value)}>
          {d.teams.map(x => <option key={x.id} value={x.id}>{x.name} ({x.leads})</option>)}<option value="all">Hamma jamoalar</option>
        </Select>
        <span className="nz-fnote">Nazorat bosqichlari: {[...new Set(d.chosen.map(s => s.name))].join(' · ') || 'bosqich tanlanmagan'}{d.auto ? ' (avtomatik aniqlangan)' : ''} · {d.hours} soatdan keyin menejerga, {d.escalate} soatdan keyin rahbarga · <span className="mono">{fmtDT(d.as_of)}</span> holati</span>
      </div>
      {!d.chosen.length ? <div className="banner warn"><div><b>Nazorat bosqichi tanlanmagan.</b> Odoo’dagi bosqich nomlari «Ўчрашув» / «Тижорат таклиф»ga o‘xshamaydi — quyida qo‘lda tanlang.</div></div> : null}
      <div className="kpis">
        <div className="kpi"><span className="lbl">{d.hours} soat+</span><span className="v">{t.over_24}</span><span className="s">harakatsiz lidlar</span></div>
        <div className="kpi"><span className="lbl">48 soat+</span><span className="v warn">{t.over_48}</span><span className="s">rahbarga ham xabar ketgan</span></div>
        <div className="kpi"><span className="lbl">72 soat+</span><span className="v bad">{t.over_72}</span><span className="s">3 kundan ko‘p jim</span></div>
        <div className="kpi"><span className="lbl">Mas’ulsiz</span><span className={`v${t.no_user ? ' bad' : ''}`}>{t.no_user}</span><span className="s">Odoo’da mas’ul yo‘q</span></div>
      </div>
      <div className="banner nz-notice"><InfoIc /><div>Bugun xabar yuborildi: <b className="mono">{t.notified}</b> lid · {d.max_days} kundan eski <b className="mono">{t.old}</b> lid ro‘yxatdan yashirilgan (sozlamada o‘zgartiriladi).</div></div>

      <div className="panel nz-panel"><div className="panel-head"><h2>Menejerlar bo‘yicha</h2></div>
        <div className="panel-help">Har menejerda nechta harakatsiz lid bor. «Ulanmagan» — panelda shu ism yo‘q yoki Telegram ulanmagan: xabar menejerga yetmaydi, u rahbarga ketadi.</div>
        <div className="tbl nz-tbl"><table><thead><tr><th>Mas’ul (Odoo)</th><th>Panelda</th><th className="n">{d.hours} soat+</th><th className="n">48 soat+</th><th className="n">72 soat+</th><th className="n">Eng uzoq</th></tr></thead><tbody>
          {d.by_user.length ? d.by_user.map((u, i) => <tr key={i}><td className="who">{u.name === 'Mas’ul yo‘q' ? <span className="pill bad">{u.name}</span> : u.name}</td>
            <td>{u.linked ? <span className="pill ok">{u.staff} · Telegram</span> : u.staff ? <span className="pill warn">{u.staff} · Telegram ulanmagan</span> : <span className="pill warn">ulanmagan</span>}</td>
            <td className="n mono">{u.n}</td><td className="n mono">{u.over_48}</td><td className="n mono">{u.over_72}</td><td className="n"><span className={`pill ${levelCls(u.max_hours)}`}>{hoursStr(u.max_hours)}</span></td></tr>)
            : <tr><td colSpan={6} className="muted">Nazorat bosqichlarida qimirlamagan lid yo‘q</td></tr>}
        </tbody></table></div></div>

      <div className="panel nz-panel"><div className="panel-head"><h2>Harakatsiz lidlar — {d.items.length} ta</h2></div>
        <div className="panel-help">Harakat — bosqichga kirish, bosqich o‘tishi yoki Odoo’dagi izoh. Eng uzoq jim turgani birinchi. Qatorga bosilsa — lid kartasi.</div>
        {d.items.length ? <div className="tbl nz-tbl"><table><thead><tr><th>Lid</th><th>Bosqich</th><th>Mas’ul</th><th>Harakatsiz</th><th>Oxirgi harakat</th><th>Xabar</th><th>Oxirgi izoh</th></tr></thead><tbody>
          {d.items.map(x => <tr key={x.id} className="row" onClick={() => openLead(x.id)} title="Lid kartasi"><td className="nz-lid"><span>{x.name}</span></td><td className="nz-stage">{x.stage}</td><td className="who">{x.user || <span className="pill bad">mas’ul yo‘q</span>}</td>
            <td className="nz-hours"><span className={`pill ${levelCls(x.hours)}`}>{hoursStr(x.hours)}</span></td><td className="nz-when"><span className="mono">{fmtDT(x.last_at)}</span></td>
            <td>{x.alerted.length ? <span className="nz-checks" title="Telegram’ga yetkazilgan darajalar">{x.alerted.map(l => <span key={l} className="pill ok">{l} <CheckIc /></span>)}</span> : <span className="muted" title="Hali yuborilmagan yoki yetkazilmagan">—</span>}</td>
            <td className="nz-note">{x.last_note ? <span title={x.last_note}>{x.last_note}</span> : <span className="muted">izoh yo‘q</span>}</td></tr>)}
        </tbody></table></div> : <p className="muted nz-empty">Hozir nazoratsiz qolgan lid yo‘q.</p>}
      </div>

      {isLead ? <SettingsForm key={`${d.hours}-${d.escalate}-${d.chosen.map(s => s.id).join(',')}`} d={d} onSaved={reload} onRun={() => { void runNow(); }} /> : null}
    </>
  );
}
