'use client';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '@/lib/api';
import { fmtDT, money } from '@/lib/format';
import { useApp } from './AppContext';

/* Lid kartasi (modal) va chuqur ko‘rish paneli: Voronka va Nazorat’dan — bosqich / menejer / sabab / manba bo‘yicha lidlar, har lid — to‘liq ma’lumot */
export interface LeadRow {
  id: number; name: string; partner: string | null; contact: string | null; phone: string | null; email: string | null; city: string | null;
  status: 'active' | 'won' | 'lost'; stage: string | null; user: string | null; reason: string | null; source: string | null;
  expected_revenue: number; created_at: number; stage_at: number; days_on_stage: number | null; age_days: number; last_note: string | null; last_note_at: number | null; notes: number;
}
interface DetailResp extends Omit<LeadRow, 'notes'> {
  team: string | null; probability: number; closed_at: number | null; tags: number[]; staff: { name: string; linked: boolean } | null;
  history: { at: number; author: string | null; source: string; from_stage: string | null; to_stage: string | null }[];
  notes: { id: number; at: number; author: string | null; kind: string; body: string }[];
}

export const STATUS_L: Record<string, [string, string]> = { active: ['Ishda', 'acc'], won: ['Yutilgan', 'ok'], lost: ['Yo‘qotilgan', 'bad'] };
const dayStr = (d: number | null) => d == null ? '—' : d < 1 ? `${Math.max(1, Math.round(d * 24))} soat` : `${d} kun`;

function Row({ k, v }: { k: string; v: ReactNode }) { return v == null || v === '' ? null : <><dt>{k}</dt><dd>{v}</dd></>; }

function LeadCard({ id }: { id: number }) {
  const { fail } = useApp();
  const [d, setD] = useState<DetailResp | null>(null);
  useEffect(() => { api<DetailResp>(`/api/voronka/lead/${id}`).then(setD).catch(fail); }, [id, fail]);
  if (!d) return <p className="muted lm-loading">Yuklanmoqda…</p>;
  const [stL, stC] = STATUS_L[d.status];
  const stuck = d.status === 'active' && d.days_on_stage != null && d.days_on_stage >= 1;
  const unlinked = !!d.user && !(d.staff && d.staff.linked);
  return (
    <div className="lm">
      <div className="lm-head">
        <h2>{d.name} <span className={`pill ${stC}`}>{stL}</span>{d.stage && d.days_on_stage != null ? <span className={`pill ${d.days_on_stage >= 3 ? 'bad' : d.days_on_stage >= 1 ? 'warn' : ''}`}>{d.stage} · {dayStr(d.days_on_stage)}</span> : null}</h2>
        <button className="btn ghost lm-x" type="button" data-close aria-label="Yopish">×</button>
      </div>
      <div className="lm-help">Ma’lumot Odoo’dan, faqat o‘qish uchun. O‘zgartirish — Odoo’da.</div>
      {stuck ? <div className={`notice${d.days_on_stage != null && d.days_on_stage >= 3 ? ' bad' : ''}`}><div>Bu lid <b>{dayStr(d.days_on_stage)}</b> bir bosqichda harakatsiz.{unlinked ? <> Menejer {d.user} Telegram’ga ulanmagan — eslatma olmaydi.</> : null}</div></div> : null}
      <div className="grid-2e">
        <div className="lm-block"><h3 className="section-title">Mijoz</h3><dl className="kv">
          <Row k="Kompaniya" v={d.partner} /><Row k="Kontakt" v={d.contact} />
          <Row k="Telefon" v={d.phone ? <a className="mono" href={`tel:${d.phone}`}>{d.phone}</a> : null} /><Row k="Email" v={d.email} /><Row k="Shahar" v={d.city} />
          <Row k="Manba" v={d.source} /><Row k="Teglar" v={d.tags.length ? `${d.tags.length} ta` : null} /></dl></div>
        <div className="lm-block"><h3 className="section-title">Sotuv</h3><dl className="kv">
          <Row k="Jamoa" v={d.team} /><Row k="Mas’ul (Odoo)" v={d.user || <span className="pill bad">mas’ul yo‘q</span>} />
          <Row k="Panelda" v={d.user ? (d.staff ? <span className={`pill ${d.staff.linked ? 'ok' : 'warn'}`}>{d.staff.name}{d.staff.linked ? ' · Telegram' : ' · Telegram ulanmagan'}</span> : <span className="pill warn">ulanmagan</span>) : null} />
          <Row k="Bosqich" v={d.stage} /><Row k="Bosqichda" v={d.days_on_stage != null ? dayStr(d.days_on_stage) : null} />
          <Row k="Kelgan" v={<span className="mono">{fmtDT(d.created_at)}</span>} /><Row k="Yopilgan" v={d.closed_at ? <span className="mono">{fmtDT(d.closed_at)}</span> : null} />
          <Row k="Ehtimol" v={d.probability ? <span className="mono">{Math.round(d.probability)} %</span> : null} /><Row k="Kutilayotgan summa" v={d.expected_revenue ? <span className="mono">{money(d.expected_revenue)}</span> : null} />
          <Row k="Yo‘qotish sababi" v={d.status === 'lost' ? (d.reason || <span className="pill warn">sabab ko‘rsatilmagan</span>) : null} /></dl></div>
      </div>
      <div>
        <h3 className="section-title">Bosqich tarixi</h3>
        {d.history.length ? <div className="prof-notes lm-timeline">{d.history.map((h, i) => (
          <div className="prof-note" key={i}><span className="tl-dot"></span><time>{fmtDT(h.at)}</time><span className="tl-text"><span>{h.from_stage ? <>{h.from_stage} → </> : null}<b>{h.to_stage || '—'}</b></span>
            {h.author ? <span className="tl-who">· {h.author}</span> : null}{h.source === 'snapshot' ? <span className="tl-who" title="Kuzatuv boshlangandagi holat">· kirish</span> : null}</span></div>))}</div>
          : <p className="empty">Tarix yo‘q.</p>}
      </div>
      <div>
        <h3 className="section-title">Izohlar ({d.notes.length})</h3>
        {d.notes.length ? <div className="prof-notes lm-comments">{d.notes.map(n => (
          <div className="prof-note" key={n.id}><div className="c-meta"><b>{n.author || '—'}</b><time>{fmtDT(n.at)}</time>{n.kind === 'email' ? <span className="pill">email</span> : null}</div>
            <p>{n.body}</p></div>))}</div>
          : <p className="empty">Odoo’da izoh yo‘q — menejer uchrashuvdan keyin hech narsa yozmagan.</p>}
      </div>
    </div>
  );
}

export function useOpenLead() {
  const { openModal } = useApp();
  return (id: number) => openModal({ wide: true, content: <LeadCard id={id} /> });
}

export interface Drill { kind: 'stage' | 'user' | 'reason' | 'source' | 'lost'; id?: number; label: string }
const KIND_L: Record<Drill['kind'], string> = { stage: 'Bosqich', user: 'Mas’ul', reason: 'Sabab', source: 'Manba', lost: 'Yo‘qotilganlar' };

/* Chuqur ko‘rish: filtr bo‘yicha lidlar jadvali (Voronka sahifasida alohida panel), satrga bosilsa — lid kartasi */
export function LeadsDrill({ drill, team, days, onClose }: { drill: Drill; team: string; days: number; onClose: () => void }) {
  const { fail } = useApp();
  const openLead = useOpenLead();
  const [items, setItems] = useState<LeadRow[] | null>(null);
  useEffect(() => {
    let dead = false;
    const q = new URLSearchParams({ days: String(days) });
    if (team) q.set('team', team);
    if (drill.kind === 'lost') q.set('lost', '1'); else q.set(drill.kind, String(drill.id ?? 0));
    setItems(null);
    api<{ items: LeadRow[] }>(`/api/voronka/leads?${q}`).then(r => { if (!dead) setItems(r.items); }).catch(fail);
    return () => { dead = true; };
  }, [drill, team, days, fail]);
  return (
    <div className="panel" id="drillPanel" style={{ borderColor: 'var(--accent)' }}>
      <div className="panel-head"><h2>{KIND_L[drill.kind]}: {drill.label}</h2><span className="sub">{items ? `${items.length} ta lid` : 'yuklanmoqda…'}</span>
        <button className="btn sm ghost" type="button" style={{ marginLeft: 'auto' }} onClick={onClose}>Yopish ×</button></div>
      <div className="panel-help">Tanlangan filtr bo‘yicha lidlar (faol va yo‘qotilgan). Satrga bosilsa — lidning to‘liq kartasi.</div>
      {items && !items.length ? <p className="muted" style={{ margin: 0 }}>Bu filtrda lid yo‘q.</p> : items ? <div className="tbl"><table>
        <thead><tr><th>Lid</th><th>Mijoz · telefon</th><th>Bosqich</th><th>Mas’ul</th><th>Holat</th><th className="n">Bosqichda</th><th className="n">Kelganiga</th><th>Oxirgi izoh</th></tr></thead><tbody>
          {items.map(x => { const [sl, sc] = STATUS_L[x.status]; return (
            <tr key={x.id} role="button" style={{ cursor: 'pointer' }} onClick={() => openLead(x.id)}>
              <td className="who"><b>{x.name}</b>{x.source ? <div className="muted" style={{ fontSize: 12 }}>{x.source}</div> : null}</td>
              <td>{x.partner || x.contact || <span className="muted">—</span>}{x.phone ? <div className="mono" style={{ fontSize: 12 }}>{x.phone}</div> : null}{x.city ? <div className="muted" style={{ fontSize: 12 }}>{x.city}</div> : null}</td>
              <td>{x.stage || '—'}</td><td>{x.user || <span className="pill bad">mas’ul yo‘q</span>}</td>
              <td><span className={`pill ${sc}`}>{sl}</span>{x.status === 'lost' ? <div className="muted" style={{ fontSize: 12 }}>{x.reason || 'sabab ko‘rsatilmagan'}</div> : null}</td>
              <td className="n">{x.days_on_stage != null ? <span className={`pill ${x.days_on_stage >= 3 ? 'bad' : x.days_on_stage >= 1 ? 'warn' : ''}`}>{dayStr(x.days_on_stage)}</span> : '—'}</td>
              <td className="n mono">{dayStr(x.age_days)}</td>
              <td className="muted" style={{ maxWidth: 300 }}>{x.last_note || 'izoh yo‘q'}{x.notes > 1 ? <span className="mono"> · {x.notes} ta</span> : null}</td>
            </tr>); })}
        </tbody></table></div> : null}
    </div>
  );
}
