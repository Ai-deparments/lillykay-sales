'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { fmtDT } from '@/lib/format';
import { useApp } from './AppContext';
import { Select } from './Select';
import { useOpenLead } from './LeadModal';

/* NAZORAT 24 SOAT — Odoo lidlari: nazorat bosqichida qimirlamay qolganlar, menejer kesimi, Telegram ogohlantirishlar (mijoz talabi, 2026-11-06) */
interface StageOpt { id: number; name: string; sequence: number; is_won: number }
interface Item { id: number; name: string; stage: string; user: string | null; user_id: number | null; last_at: number; hours: number; level: number; days: number; last_note: string | null; alerted: number[]; staff: string | null; staff_linked: boolean }
interface ByUser { name: string; user_id: number | null; staff: string | null; linked: boolean; n: number; over_48: number; over_72: number; max_hours: number }
interface Data {
  stages: StageOpt[]; chosen: StageOpt[]; auto: boolean; hours: number; escalate: number; notify: boolean; as_of: number;
  team: number | null; teams: { id: number; name: string; leads: number }[];
  totals: { over_24: number; over_48: number; over_72: number; no_user: number; notified: number }; by_user: ByUser[]; items: Item[];
}

const hoursStr = (h: number) => h >= 48 ? `${Math.floor(h / 24)} kun` : `${h} soat`;
const levelCls = (h: number) => h >= 48 ? 'bad' : 'warn';

function SettingsForm({ d, onSaved }: { d: Data; onSaved: () => void }) {
  const { toast, fail } = useApp();
  const [stages, setStages] = useState<number[]>(d.chosen.map(s => s.id));
  const [hours, setHours] = useState(d.hours);
  const [esc, setEsc] = useState(d.escalate);
  const [notify, setNotify] = useState(d.notify);
  const toggle = (id: number) => setStages(xs => xs.includes(id) ? xs.filter(x => x !== id) : [...xs, id]);
  const save = async () => {
    const r = await api('/api/nazorat/settings', { stages, nazorat_hours: hours, nazorat_escalate_hours: esc, nazorat_notify: notify }).catch(fail);
    if (r) { toast('Saqlandi'); onSaved(); }
  };
  return (
    <div className="panel"><div className="panel-head"><h2>Qoidalar</h2><span className="muted">{d.auto ? 'Bosqichlar nomidan avtomatik tanlangan — kerak bo‘lsa o‘zgartiring' : 'Rahbar tanlagan bosqichlar'}</span></div>
      <div className="form-grid">
        <div className="field" style={{ gridColumn: '1 / -1' }}><span>Nazorat bosqichlari (Odoo)</span>
          <div className="row-actions" style={{ gap: 6 }}>{d.stages.filter(s => !s.is_won).map(s => (
            <button key={s.id} type="button" className={`btn sm ${stages.includes(s.id) ? 'primary' : 'ghost'}`} aria-pressed={stages.includes(s.id)} onClick={() => toggle(s.id)}>{s.name}</button>))}</div></div>
        <label className="field"><span>Menejerga xabar (soat)</span><input type="number" min={1} max={720} value={hours} onChange={e => setHours(Number(e.target.value))} /></label>
        <label className="field"><span>Rahbarga xabar (soat)</span><input type="number" min={1} max={720} value={esc} onChange={e => setEsc(Number(e.target.value))} /></label>
        <label className="field"><span>Telegram xabarlari</span><Select value={notify ? 'true' : 'false'} onChange={e => setNotify(e.target.value === 'true')}><option value="true">yoqilgan</option><option value="false">o‘chiq</option></Select></label>
      </div>
      <p className="muted" style={{ fontSize: 12.5, margin: '8px 0 0' }}>Xabar menejerga — Odoo’dagi mas’ul panelda shu ism bilan bo‘lsa va Telegram ulagan bo‘lsa; bo‘lmasa yoki muddat o‘tsa — rahbarga. Har lid uchun har daraja (24 / 48 / 72 soat) bir marta, faqat ish vaqtida.</p>
      <div className="row-actions"><button className="btn primary" type="button" onClick={() => { void save(); }}>Saqlash</button></div>
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
      <div className="filters">
        <label className="field" style={{ maxWidth: 260 }}><span>Jamoa</span>
          <Select value={team || (d.team != null ? String(d.team) : 'all')} onChange={e => setTeam(e.target.value)}>
            {d.teams.map(x => <option key={x.id} value={x.id}>{x.name} ({x.leads})</option>)}<option value="all">Hamma jamoalar</option>
          </Select></label>
        <span className="muted">Nazorat: {d.chosen.map(s => s.name).join(', ') || 'bosqich tanlanmagan'} · {d.hours} soatdan keyin menejerga, {d.escalate} soatdan keyin rahbarga · {fmtDT(d.as_of)} holati</span>
        {isLead ? <span style={{ marginLeft: 'auto' }} className="row-actions"><button className="btn sm" type="button" onClick={() => { void runNow(); }}>Hozir tekshirish</button></span> : null}
      </div>
      {!d.chosen.length ? <div className="banner warn"><div><b>Nazorat bosqichi tanlanmagan.</b> Odoo’dagi bosqich nomlari «Ўчрашув» / «Тижорат таклиф»ga o‘xshamaydi — quyida qo‘lda tanlang.</div></div> : null}
      <div className="kpis">
        <div className="kpi"><span className="lbl">{d.hours} soat+</span><span className="v">{t.over_24}</span><span className="s">harakatsiz lidlar</span></div>
        <div className="kpi"><span className="lbl">48 soat+</span><span className="v">{t.over_48}</span><span className="s">rahbarga ko‘rinadi</span></div>
        <div className="kpi"><span className="lbl">72 soat+</span><span className="v">{t.over_72}</span><span className="s">3 kundan ko‘p</span></div>
        <div className="kpi"><span className="lbl">Mas’ulsiz</span><span className="v">{t.no_user}</span><span className="s">Odoo’da mas’ul yo‘q · xabar yuborilgan: {t.notified}</span></div>
      </div>

      <div className="panel"><div className="panel-head"><h2>Menejerlar</h2><span className="muted">kimda nechta lid qimirlamayapti; «ulanmagan» — panelda shu ism yo‘q yoki Telegram ulanmagan, xabar rahbarga ketadi</span></div>
        <div className="tbl"><table><thead><tr><th>Mas’ul (Odoo)</th><th>Panelda</th><th className="n">{d.hours} soat+</th><th className="n">48 soat+</th><th className="n">72 soat+</th><th className="n">Eng uzoq</th></tr></thead><tbody>
          {d.by_user.length ? d.by_user.map((u, i) => <tr key={i}><td>{u.name === 'Mas’ul yo‘q' ? <span className="pill bad">{u.name}</span> : u.name}</td>
            <td>{u.linked ? <span className="pill ok">{u.staff} · Telegram</span> : u.staff ? <span className="pill warn">{u.staff} · Telegram ulanmagan</span> : <span className="pill warn">ulanmagan</span>}</td>
            <td className="n mono">{u.n}</td><td className="n mono">{u.over_48}</td><td className="n mono">{u.over_72}</td><td className="n"><span className={`pill ${levelCls(u.max_hours)}`}>{hoursStr(u.max_hours)}</span></td></tr>)
            : <tr><td colSpan={6} className="muted">Nazorat bosqichlarida qimirlamagan lid yo‘q</td></tr>}
        </tbody></table></div></div>

      <div className="panel"><div className="panel-head"><h2>Lidlar</h2><span className="muted">oxirgi harakat — bosqichga kirish, bosqich o‘tishi yoki Odoo’dagi izoh · {d.items.length} ta · satrga bosing — lid kartasi</span></div>
        {d.items.length ? <div className="tbl"><table><thead><tr><th>Lid</th><th>Bosqich</th><th>Mas’ul</th><th className="n">Harakatsiz</th><th>Oxirgi harakat</th><th>Oxirgi izoh</th><th>Xabar</th></tr></thead><tbody>
          {d.items.map(x => <tr key={x.id} style={{ cursor: 'pointer' }} onClick={() => openLead(x.id)} title="Lid kartasi"><td><b>{x.name}</b></td><td>{x.stage}</td><td>{x.user || <span className="pill bad">mas’ul yo‘q</span>}</td>
            <td className="n"><span className={`pill ${levelCls(x.hours)}`}>{hoursStr(x.hours)}</span></td><td className="mono muted">{fmtDT(x.last_at)}</td>
            <td className="muted" style={{ maxWidth: 320 }}>{x.last_note || 'izoh yo‘q'}</td>
            <td>{x.alerted.length ? <span className="pill ok" title="Telegram’ga yetkazilgan darajalar">{x.alerted.map(l => `${l} s`).join(' · ')}</span> : <span className="muted" title="Hali yuborilmagan yoki yetkazilmagan">—</span>}</td></tr>)}
        </tbody></table></div> : <p className="muted" style={{ margin: 0 }}>Hozir nazoratsiz qolgan lid yo‘q.</p>}
      </div>

      {isLead ? <SettingsForm key={`${d.hours}-${d.escalate}-${d.chosen.map(s => s.id).join(',')}`} d={d} onSaved={reload} /> : null}
    </>
  );
}
