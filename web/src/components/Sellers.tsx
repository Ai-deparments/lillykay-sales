'use client';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { api, isUnauthorized } from '@/lib/api';
import { ago, fmtDT } from '@/lib/format';
import { Brand } from '@/components/ui';
import { useApp } from '@/components/AppContext';
import { Select } from './Select';

/* eslint-disable @typescript-eslint/no-explicit-any */
interface SellerRow {
  id: number; name: string; linked: boolean; online?: boolean; active_at?: number | null; at_work?: boolean; on_shift?: boolean;
  offered: number; responded: number; missed: number; declined: number; done: number; replies: number; react_min: number | null;
  score: number | null; status: string; rec?: string | null;
}
interface SellersResp {
  items: SellerRow[]; statusL: Record<string, string>; settings: Record<string, any>; open: any[]; kinds: Record<string, { label: string }>; bot?: string | null;
}

const NOTE_L: Record<string, [string, string]> = { rad: ['Rad etdi', 'bad'], otkazdi: ['Ko‘rmadi', 'warn'], kechikdi: ['Ko‘rmadi', 'warn'], ogohlantirish: ['Ogohlantirildi', 'bad'], kunlik: ['Kunlik xulosa', ''], ai: ['AI kuzatuvi', 'ai'] };
const STEP_L: Record<string, string> = { offered: 'berildi', accepted: 'ko‘rdi', done: 'bajardi', missed: 'ko‘rmadi', late: 'ko‘rmadi', declined: 'rad etdi', escalated: 'rahbarga' };
const NOW_L: Record<string, string> = { done: 'bajarilgan', cancelled: 'bekor', failed: 'yopilmadi', escalated: 'rahbarda', offered: 'ko‘rishi kutilmoqda', accepted: 'sotuvchida', queued: 'navbatda' };
const mins = (m: number | null | undefined) => m == null ? '—' : `${Math.max(1, Math.round(m))} daq`;

/* Sotuvchi profili: natija, AI izohlari, rahbar bilan yozishma, topshiriqlari */
function SellerProfile({ id, initial, initialDays }: { id: number; initial: any; initialDays: number }) {
  const { fail } = useApp();
  const [r, setR] = useState<any>(initial);
  const [days, setDays] = useState(initialDays);
  const chatRef = useRef<HTMLDivElement>(null);
  useEffect(() => { const ch = chatRef.current; if (ch) ch.scrollTop = ch.scrollHeight; }, [r]);
  const u = r.user, st = r.stats || {};
  const ST_CLS: Record<string, string> = { alo: 'ok', yaxshi: 'ok', etibor: 'warn', befarq: 'bad' };
  const tg = u.at_work ? <span className="pill ok">bugun ishda (akkauntga yozgan)</span> : u.biz_open ? <span className="pill">akkaunt oynasi ochiq</span>
    : u.bot ? <span className="pill">bot ulangan</span> : <span className="pill bad">Telegram ulanmagan</span>;
  const pick = async (d: number) => {
    try { const n = await api(`/api/sellers/${id}?days=${d}`); setR(n); setDays(d); } catch (e) { fail(e); }
  };
  return (
    <>
      <h2>{u.name}</h2>
      <div className="row-actions">{tg}{u.online ? <span className="pill ok">online</span> : u.active_at ? <span className="pill">faol: {ago(u.active_at)} oldin</span> : null}{u.tg_username ? <span className="muted">@{u.tg_username}</span> : null}
        <div className="seg" role="group" style={{ marginLeft: 'auto' }}>{[7, 30, 90].map(d => <button key={d} type="button" data-pdays={d} aria-pressed={days === d} onClick={() => { void pick(d); }}>{d} kun</button>)}</div></div>
      <div className="agent-stats" style={{ marginTop: 4 }}><span>Topshiriq <b>{st.offered ?? 0}</b></span><span>Javob <b>{st.responded ?? 0}</b></span><span>O‘rt. javob <b>{mins(st.react_min)}</b></span>
        <span>Ko‘rmadi <b>{st.missed ?? 0}</b></span><span>Rad etdi <b>{st.declined ?? 0}</b></span><span>Bajardi <b>{st.done ?? 0}</b></span>
        <span>Ball <b>{st.score ?? '—'}</b></span><span className={`pill ${ST_CLS[st.status] || ''}`}>{r.statusL[st.status] || ''}</span>
        {st.rec === 'ragbat' ? <span className="pill ok">Rag‘batlantirish</span> : st.rec === 'ogohlantirish' ? <span className="pill bad">Ogohlantirish</span> : null}</div>
      <h3 style={{ margin: '14px 0 6px' }}>AI izohlari</h3>
      <div className="prof-notes">{r.notes.length ? r.notes.map((n: any, i: number) => (
        <div className="prof-note" key={i}><span className="mono muted">{fmtDT(n.created_at)}</span><span className={`pill ${(NOTE_L[n.kind] || ['', ''])[1]}`}>{(NOTE_L[n.kind] || [n.kind])[0]}</span><span>{n.text}</span></div>))
        : <p className="muted" style={{ margin: 0 }}>Hali izoh yo‘q.</p>}</div>
      <h3 style={{ margin: '14px 0 6px' }}>Rahbar bilan yozishma</h3>
      <div className="prof-chat" ref={chatRef}>{r.messages.length ? r.messages.map((m: any, i: number) => (
        <div className={`msg ${m.dir === 'out' ? 's' : 'c'}`} key={i}><div className="who">{m.dir === 'out' ? 'Rahbar (tizim)' : u.name}</div><div className="txt">{m.text}</div><div className="msg-meta">{fmtDT(m.created_at)} · {m.via === 'biz' ? 'Photobuy akkaunti' : 'bot'}</div></div>))
        : <p className="muted" style={{ margin: 0 }}>Yozishma yo‘q.</p>}</div>
      <h3 style={{ margin: '14px 0 6px' }}>Topshiriqlari</h3>
      <div className="tbl"><table><thead><tr><th>Turi</th><th>Mijoz</th><th>Vazifa</th><th>Uning qadamlari</th><th>Hozir</th></tr></thead><tbody>
        {r.tasks.length ? r.tasks.map((a: any, i: number) => (
          <tr key={i}><td>{r.kinds[a.kind]?.label || a.kind}{a.urgent ? <> <span className="pill bad">tez</span></> : null}</td>
            <td><Brand ch={a.channel} /> <a href={`#suhbat/${a.conversation_id}`} data-close>{a.handle || a.display_name || '#' + a.conversation_id}</a></td>
            <td style={{ maxWidth: 280 }}>{a.body || ''}</td><td className="muted" style={{ fontSize: 12.5 }}>{a.steps.map((x: string) => STEP_L[x] || x).join(' → ')}</td><td>{NOW_L[a.status] || a.status}</td></tr>))
          : <tr><td colSpan={5} className="muted">Bu davrda topshiriq yo‘q</td></tr>}
      </tbody></table></div>
    </>
  );
}

export function Sellers({ active }: { active: boolean }) {
  const { toast, fail, openModal } = useApp();
  const [days, setDays] = useState(7);
  const [r, setR] = useState<SellersResp | null>(null);
  const [ver, setVer] = useState(0);

  const load = useCallback(async () => {
    try { setR(await api<SellersResp>(`/api/sellers?days=${days}`)); setVer(v => v + 1); } catch (e) { if (!isUnauthorized(e)) fail(e); }
  }, [days, fail]);
  useEffect(() => { if (active) void load(); }, [active, load]);

  const profile = async (id: number) => {
    try { const d = await api(`/api/sellers/${id}?days=30`); openModal({ wide: true, content: <SellerProfile id={id} initial={d} initialDays={30} /> }); } catch (e) { fail(e); }
  };
  const asDone = async (id: number) => { const x = await api(`/api/assignments/${id}`, { action: 'done' }).catch(fail); if (x) toast(x.msg || 'Bajarildi'); void load(); };
  const asCancel = async (id: number) => {
    if (!confirm('Topshiriq bekor qilinsinmi?')) return;
    await api(`/api/assignments/${id}`, { action: 'cancel' }).catch(fail); toast('Bekor qilindi'); void load();
  };
  const onSettings = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const d: Record<string, unknown> = Object.fromEntries(new FormData(e.currentTarget).entries());
    d.seller_auto_warn = d.seller_auto_warn === 'true';
    const x = await api('/api/settings', d).catch(fail);
    if (x) { toast('Saqlandi'); void load(); }
  };

  if (!r) return null;
  const st = r.settings;
  const rows = [...r.items].sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.offered - a.offered);
  const sum = (k: 'offered' | 'responded' | 'missed' | 'done') => rows.reduce((a, x) => a + (x[k] || 0), 0);
  const offered = sum('offered'), responded = sum('responded'), missed = sum('missed'), done = sum('done');
  const accs = rows.filter(x => x.react_min != null), accAvg = accs.length ? accs.reduce((a, x) => a + (x.react_min as number), 0) / accs.length : null;
  const fmtLim = (m: number) => m >= 60 && m % 60 === 0 ? `${m / 60} soat` : `${m} daqiqa`;
  const notLinked = rows.filter(x => !x.linked);
  const ST_CLS: Record<string, string> = { alo: 'ok', yaxshi: 'ok', etibor: 'warn', befarq: 'bad', kam: '' };
  const OPEN_L: Record<string, string> = { queued: 'navbatda (smena boshlanishini kutmoqda)', offered: 'sotuvchi ko‘rishi kutilmoqda', accepted: 'sotuvchida', escalated: 'rahbarga o‘tdi' };

  const sub = (x: SellerRow): ReactNode => {
    if (!x.linked) return <span style={{ color: 'var(--bad)' }}>Telegram ulanmagan</span>;
    const parts: ReactNode[] = [x.online ? <span style={{ color: 'var(--ok)' }}>online</span> : x.active_at ? 'faol: ' + ago(x.active_at) + ' oldin' : '', x.at_work ? 'bugun ishda' : 'bugun akkauntga yozmagan', x.on_shift ? '' : 'smenada emas'].filter(Boolean);
    return parts.map((p, i) => <Fragment key={i}>{i ? ' · ' : null}{p}</Fragment>);
  };

  return (
    <>
      <div className="panel"><div className="panel-head"><h2>AI boshliq</h2>
        <div className="seg" role="group" style={{ marginLeft: 'auto' }}>{([[1, 'Bugun'], [7, '7 kun'], [30, '30 kun']] as [number, string][]).map(([d, l]) => <button key={d} type="button" data-sdays={d} aria-pressed={days === d} onClick={() => setDays(d)}>{l}</button>)}</div></div>
        <p className="lead" style={{ fontSize: 13, margin: 0 }}>{`Oddiy savollarga AI o‘zi javob beradi. Faqat rasm topilmasa, to‘lov/chek, buyurtma va dastavka, shikoyat bo‘lsa — AI sotuvchiga rahbar nomidan, oddiy xabar bilan aytadi (tugmasiz, mijoz — havola). Sotuvchi ko‘rib biror narsa yozsa yoki mijozga javob bersa — ish bajarilgan hisoblanadi. ${fmtLim(st.assign_done_minutes)} ichida hech qanday javob bo‘lmasa — ogohlantirishsiz keyingi sotuvchiga o‘tadi (mijoz hozir to‘lamoqchi bo‘lsa — ${st.assign_urgent_minutes} daqiqada, online sotuvchiga). Tez-tez ko‘rmay qolsa — «iltimos, e’tiborli bo‘ling» deb ogohlantiriladi. Har kuni ${st.seller_report_time} da natija rahbarga yuboriladi.`}</p>
        <p className="lead" style={{ fontSize: 13, margin: '8px 0 0' }}><b>Topshiriq Sun HighTech akkauntidan (rahbar nomidan) boradi</b> — buning uchun sotuvchi har kuni ish boshida Photobuy Telegram akkauntiga bitta xabar yozadi (masalan «Salom, ishdaman»). Telegram qoidasi: akkaunt faqat oxirgi 24 soatda unga yozgan odamga yoza oladi. Yozmagan sotuvchiga topshiriq bot orqali boradi.</p></div>
      {notLinked.length ? <div className="banner warn"><div><b>{notLinked.length} ta sotuvchi Telegram botga ulanmagan — ular topshiriq olmaydi:</b> {notLinked.map(x => x.name).join(', ')}.{' '}
        <a href="#xodimlar">Xodimlar</a> sahifasida Telegram username kiriting va ularga {r.bot ? <b>t.me/{r.bot}</b> : 'botni'} yuboring — «Start» bossa o‘zi ulanadi.</div></div> : null}
      <div className="kpis">
        <div className="kpi"><span className="muted">Topshiriqlar</span><div className="v">{offered}</div><div className="s">{done} tasi bajarildi</div></div>
        <div className="kpi"><span className="muted">Javob berildi</span><div className="v">{offered ? Math.round(100 * responded / offered) : 0}<small>%</small></div><div className="s">{responded} / {offered}</div></div>
        <div className="kpi"><span className="muted">O‘rtacha javob vaqti</span><div className="v">{accAvg == null ? '—' : Math.max(1, Math.round(accAvg))}<small>{accAvg == null ? '' : ' daq'}</small></div><div className="s">chegara {fmtLim(st.assign_done_minutes)}</div></div>
        <div className="kpi"><span className="muted">Ko‘rmay qolgan</span><div className="v">{missed}</div><div className="s">javobsiz boshqasiga o‘tgan</div></div>
      </div>
      <div className="panel"><div className="panel-head"><h2>Reyting</h2><span className="muted">Ball: javob berish 70% · tezlik 30%, har rad etish −5. 3 tadan kam ishda baho berilmaydi. Ism ustiga bosing — profil.</span></div>
        <div className="tbl"><table><thead><tr><th>Sotuvchi</th><th className="n">Topshiriq</th><th className="n">Javob</th><th className="n">O‘rt. javob</th><th className="n">Ko‘rmadi</th><th className="n">Rad etdi</th><th className="n">Bajardi</th><th className="n">Mijozga xabar</th><th className="n">Ball</th><th>Holat</th><th>Tavsiya</th></tr></thead><tbody>
          {rows.length ? rows.map(x => (
            <tr key={x.id}><td><button className="namebtn" type="button" data-sprof={x.id} title="Profil: izohlar, yozishma, topshiriqlar" onClick={() => { void profile(x.id); }}><b>{x.name}</b></button><div className="muted" style={{ fontSize: 12 }}>{sub(x)}</div></td>
              <td className="n mono">{x.offered}</td><td className="n mono">{x.responded}</td><td className="n mono">{mins(x.react_min)}</td>
              <td className="n mono" style={x.missed ? { color: 'var(--bad)' } : undefined}>{x.missed}</td><td className="n mono" style={x.declined ? { color: 'var(--bad)' } : undefined}>{x.declined}</td>
              <td className="n mono">{x.done}</td><td className="n mono">{x.replies}</td><td className="n mono"><b>{x.score ?? '—'}</b></td>
              <td><span className={`pill ${ST_CLS[x.status] ?? ''}`}>{r.statusL[x.status]}</span></td>
              <td>{x.rec === 'ragbat' ? <span className="pill ok">Rag‘batlantirish</span> : x.rec === 'ogohlantirish' ? <span className="pill bad">Ogohlantirish</span> : <span className="muted">—</span>}</td></tr>))
            : <tr><td colSpan={11} className="muted">Sotuvchi yo‘q</td></tr>}
        </tbody></table></div></div>
      <div className="panel"><div className="panel-head"><h2>Ochiq topshiriqlar</h2><span className="muted">{r.open.length} ta</span></div>
        {r.open.length ? <div className="tbl"><table><thead><tr><th>Turi</th><th>Mijoz</th><th>Vazifa</th><th>Kimda</th><th>Holat</th><th className="n">Vaqt</th><th></th></tr></thead><tbody>
          {r.open.map((a: any) => (
            <tr key={a.id}><td>{r.kinds[a.kind]?.label || a.kind}</td><td><Brand ch={a.channel} /> {a.display_name || a.handle || '#' + a.conversation_id}</td>
              <td style={{ maxWidth: 320 }}>{a.body || a.title}</td><td>{a.user_name || '—'}{a.attempts > 1 ? <div className="muted" style={{ fontSize: 12 }}>{a.attempts}-urinish</div> : null}</td>
              <td><span className={`pill ${a.status === 'escalated' ? 'bad' : a.status === 'accepted' ? 'ok' : 'warn'}`}>{OPEN_L[a.status] || a.status}</span></td>
              <td className="n muted">{ago(a.accepted_at || a.offered_at || a.created_at)}</td>
              <td><div className="row-actions" style={{ flexWrap: 'nowrap' }}><a className="btn sm" href={`#suhbat/${a.conversation_id}`}>Ochish</a><button className="btn sm" type="button" data-asdone={a.id} onClick={() => { void asDone(a.id); }}>Bajarildi</button><button className="btn sm ghost" type="button" data-ascancel={a.id} onClick={() => { void asCancel(a.id); }}>Bekor</button></div></td></tr>))}
        </tbody></table></div> : <p className="muted" style={{ margin: 0 }}>Hozir ochiq topshiriq yo‘q.</p>}</div>
      <form className="panel" id="sellerSetForm" key={ver} onSubmit={onSettings}><div className="panel-head"><h2>Qoidalar</h2></div>
        <div className="form-grid">
          <label className="field"><span>Javob bo‘lmasa — boshqa sotuvchiga (daqiqa)</span><input type="number" min="10" max="1440" name="assign_done_minutes" defaultValue={st.assign_done_minutes} /></label>
          <label className="field"><span>Mijoz hozir to‘lamoqchi — boshqasiga (daqiqa)</span><input type="number" min="1" max="30" name="assign_urgent_minutes" defaultValue={st.assign_urgent_minutes} /></label>
          <label className="field"><span>«Online» hisoblanadi (oxirgi faollik, daqiqa)</span><input type="number" min="5" max="240" name="staff_active_minutes" defaultValue={st.staff_active_minutes} /></label>
          <label className="field"><span>Kunlik hisobot vaqti</span><input type="time" name="seller_report_time" defaultValue={st.seller_report_time} /></label>
          <label className="field"><span>Tez-tez ko‘rmasa — «e’tiborli bo‘ling»</span><Select name="seller_auto_warn" defaultValue={st.seller_auto_warn ? 'true' : 'false'}><option value="true">yoqilgan</option><option value="false">o‘chiq</option></Select></label>
        </div>
        <div className="row-actions"><button className="btn primary" type="submit">Saqlash</button></div></form>
    </>
  );
}
