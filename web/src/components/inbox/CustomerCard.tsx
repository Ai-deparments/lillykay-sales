'use client';
import { Fragment } from 'react';
import { cash, fmtDT, money } from '@/lib/format';
import { Avatar, Icon } from '@/components/ui';
import type { Heat } from '@/lib/types';
import type { ActFn } from './DraftBlock';
import type { ConvDetail } from './types';

export const HEAT: Record<string, { k: string; x: number }> = { sovuq: { k: 'cold', x: 10 }, iliq: { k: 'mid', x: 50 }, issiq: { k: 'hot', x: 90 } };

interface BigOrder { items?: { name: string; qty?: number; status?: string; note?: string }[]; estimated_total?: number }

/** Mijoz kartasi (app.js `renderCard`) */
export function CustomerCard({ d, stages, onAct, onHeat, onStage }: { d: ConvDetail; stages: string[]; onAct: ActFn; onHeat: (h: Heat) => void; onStage: (i: number) => void }) {
  const c = d.conv, cu = d.customer;
  const heat = c.heat;
  let o: BigOrder = {};
  if (c.big_order) { try { o = JSON.parse(c.big_order_json || '{}'); } catch { o = {}; } }
  return (
    <>
      <div className="card-sec">
        <div className="ct-row"><Avatar name={c.name} src={c.avatar} ch={d.account.channel} className="lg" />
          <div style={{ minWidth: 0 }}><div className="ct-name">{c.name}</div><div className="ct-sub">{c.handle || ''}</div></div>
          <button className="btn ghost icon only-narrow" type="button" data-act="card" aria-label="Kartani yopish" style={{ marginLeft: 'auto' }} onClick={() => onAct('card')}><Icon name="x" /></button></div>
        <dl className="kv"><dt>Birinchi murojaat</dt><dd>{fmtDT(c.created_at)}</dd><dt>Filial</dt><dd>{c.branch || '—'}</dd>
          <dt>Mas’ul</dt><dd>{c.owner || '—'}</dd>
          <dt>Manba</dt><dd>{c.source ? <><span className="pill">{c.source}</span> <span className="muted">{c.source_note || ''}</span></> : <span className="muted">aniqlanmagan — taxmin qilinmaydi</span>}</dd></dl>
      </div>
      <div className="card-sec">
        {cu.verified
          ? <div className="idbox ver"><b>Tasdiqlangan · BILLZ #{cu.billz_id}</b><span>{cu.verified_how || ''}</span></div>
          : <div className="idbox unv"><b>BILLZ bilan bog‘lanmagan</b><span>Ism bo‘yicha avtomatik birlashtirilmaydi. Mijoz Telegram’da o‘z kontaktini ulashsa, telefon orqali tasdiqlanadi — shundan keyin xaridlar va keshbek ko‘rinadi.</span></div>}
      </div>
      <div className="card-sec"><div className="sec-title">Qiziqish darajasi <span className="muted">{c.heat_by === 'staff' ? 'sotuvchi belgiladi' : c.heat ? 'AI belgiladi · tuzatish mumkin' : ''}</span></div>
        <div className="wb"><div className="wb-bar">{heat ? <span className="wb-mark" style={{ left: `${HEAT[heat].x}%` }}></span> : null}</div>
          <div className="wb-opts" role="radiogroup" aria-label="Qiziqish darajasi">{([['sovuq', '7500K'], ['iliq', '5600K'], ['issiq', '3200K']] as [Heat, string][]).map(([k, K]) =>
            <button type="button" role="radio" key={k} data-heat={k} aria-checked={heat === k} onClick={() => onHeat(k)}>{k[0].toUpperCase() + k.slice(1)}<small>{K}</small></button>)}</div></div>
        {c.heat_why ? <div className="why">Sabab: {c.heat_why}</div> : null}</div>
      <div className="card-sec"><div className="sec-title">Bosqich <span className="muted">bosib o‘zgartiring</span></div>
        <ol className="stages">{stages.map((s, i) => <li key={i} className={i < c.stage ? 'done' : i === c.stage ? 'cur' : ''} data-stage={i} style={{ cursor: 'pointer' }} onClick={() => onStage(i)}><span className="b"></span>{s}</li>)}
          <li className={`lost ${c.lost_reason ? 'cur' : ''}`} data-act="lost" style={{ cursor: 'pointer' }} onClick={() => onAct('lost')}><span className="b"></span>{c.lost_reason ? `Yo‘qotildi: ${c.lost_reason}` : 'Yo‘qotildi — faqat dalil bilan'}</li></ol>
        {c.lost_evidence ? <div className="why">Dalil: {c.lost_evidence}</div> : null}</div>
      <div className="card-sec"><div className="sec-title">Suhbat kartasi <button className="linkish" type="button" data-act="editCard" onClick={() => onAct('editCard')}>tahrirlash</button></div>
        <dl className="kv"><dt>So‘ralgan</dt><dd>{c.asked || '—'}</dd><dt>Budjet</dt><dd>{c.budget || '—'}</dd><dt>Maqsad</dt><dd>{c.purpose || '—'}</dd>
          <dt>Til</dt><dd>{c.lang || '—'}</dd><dt>Keyingi qadam</dt><dd>{c.next_step || '—'}</dd><dt>Eslatma</dt><dd>{c.note || '—'}</dd>
          {c.remind_at ? <><dt>Qayta aloqa</dt><dd>{fmtDT(c.remind_at)} — {c.remind_note || ''}</dd></> : null}</dl></div>
      {c.big_order ? <div className="card-sec"><div className="sec-title">Katta buyurtma {c.big_accepted ? <span className="pill ok">qabul qilingan</span> : <span className="pill warn">qabul kutilmoqda</span>}</div>
        {(o.items || []).length ? <dl className="kv">{o.items!.map((i, n) => <Fragment key={n}><dt>{i.name}</dt><dd>{Number(i.qty) || 1} · {String(i.status || '').replace('_', ' ')}{i.note ? ' — ' + i.note : ''}</dd></Fragment>)}</dl> : <div className="why">Uzun ro‘yxat aniqlandi — AI tahlili yo‘q.</div>}
        {o.estimated_total ? <div className="why">Taxminiy summa: <b>{money(o.estimated_total)}</b> <span className="pill warn">taxmin</span></div> : null}</div> : null}
      {d.tasks.length ? <div className="card-sec"><div className="sec-title">Ochiq vazifalar</div>{d.tasks.map(t =>
        <div className="row-actions" style={{ justifyContent: 'space-between' }} key={t.id}><span style={{ fontSize: 13 }}>{t.title}{t.body ? <><br /><span className="muted">{t.body}</span></> : null}</span><button className="btn sm" type="button" data-act="taskDone" onClick={() => onAct('taskDone', t.id)}>Bajarildi</button></div>)}</div> : null}
      {cu.verified ? <>
        <div className="card-sec"><div className="sec-title">Keshbek <span className="muted">{cu.cashback ? cu.cashback.source + ' · ' + fmtDT(Date.parse(cu.cashback.synced_at)) : ''}</span></div>
          {cu.cashback ? <div className="cash"><span className="v">{cash(cu.cashback.amount)}</span>{cu.cashback.stale ? <span className="pill warn">eskirgan</span> : null}</div> : <div className="why">Ma’lumot yetarli emas — BILLZ’da keshbek topilmadi.</div>}</div>
        <div className="card-sec"><div className="sec-title">Xaridlar <span className="muted">BILLZ</span></div><div className="purch">
          {cu.purchases.map((p, i) => <div className={`purch-row ${p.returned ? 'ret' : ''}`} key={i}><span className="it">{p.item}{p.qty > 1 ? ' × ' + p.qty : ''}</span><span className="mono">{money(p.amount)}</span>
            <span className="d">{p.date}{p.branch ? ' · ' + p.branch : ''}{p.returned ? <> · <span className="pill">qaytarilgan {p.returned}</span></> : null}</span></div>)}
          {cu.purchases.length ? null : <div className="why">Xarid yo‘q</div>}
        </div></div></> : null}
    </>
  );
}
