'use client';
import { clockNow, fmtLeft } from '@/lib/format';
import { useTick } from '@/lib/hooks';
import type { Mode, Rollout } from '@/lib/types';
import type { ConvDetail } from './types';

export const MODE_L: Record<string, string> = { doim: 'Doim', kechiksa: 'Kechiksa', ochiq: 'O‘chiq' };
export const ROLL_L: Record<string, string> = { kuzatish: 'Kuzatish', tasdiq: 'Tasdiq bilan', avto: 'Avtomatik' };

/** «AI · 1:24» — har soniya yangilanadi */
export function DuePill({ due }: { due: number }) {
  useTick(1000);
  return <span className="pill ai" data-due={due}>AI · {fmtLeft(due - clockNow())}</span>;
}

function TLeft({ due }: { due: number }) {
  useTick(1000);
  return <b id="tLeft">{fmtLeft(due - clockNow())}</b>;
}

const RC = 2 * Math.PI * 15;
function Ring({ due, T }: { due: number; T: number }) {
  useTick(1000);
  const frac = Math.max(0, Math.min(1, (due - clockNow()) / (T * 1000)));
  return (
    <svg className="ring" viewBox="0 0 40 40" aria-hidden="true">
      <circle className="bg" cx="20" cy="20" r="15" />
      <circle className="fg" id="ringFg" data-due={due} data-t={T} cx="20" cy="20" r="15" strokeDasharray={RC.toFixed(2)} strokeDashoffset={(RC * (1 - frac)).toFixed(2)} transform="rotate(-90 20 20)" />
    </svg>
  );
}

export type ActFn = (act: string, id?: number, extra?: string) => void;

/** AI qoralamasi bloki (app.js `draftBlock`) */
export function DraftBlock({ d, role, onAct }: { d: ConvDetail; role: string; onAct: ActFn }) {
  const e = d.effective, dr = d.drafts[0], c = d.conv;
  if (!dr || !c.pending_since || dr.batch !== c.pending_since) {
    const lastCancelled = d.drafts.find(x => x.batch === c.pending_since && x.status === 'cancelled');
    if (lastCancelled) return <div className="sys">AI qoralamasi bekor qilindi — {lastCancelled.reason || ''}</div>;
    return e.ai === false && c.pending_since ? <div className="sys">AI agent bu kanalda to‘xtatilgan — javobni sotuvchi yozadi</div> : null;
  }
  if (dr.status === 'preparing') return <div className="draft-status">AI javob qoralamasini tayyorlamoqda…</div>;
  if (dr.status === 'failed') {
    const why = dr.reason === 'no_ai_key' ? 'AI kaliti kiritilmagan — javobni sotuvchi yozadi.' : dr.reason;
    return <div className="sys warn">AI qoralama tayyorlamadi: {why}</div>;
  }
  if (dr.status === 'cancelled' || dr.status === 'superseded') return <div className="sys">AI qoralamasi bekor qilindi — {dr.reason || 'yangi xabar keldi'}</div>;
  if (dr.status === 'sending') return <div className="draft-status">AI javobi yuborilmoqda…</div>;
  if (dr.status !== 'ready') return null;
  const due = c.ai_due_at;
  const bi = { fontFamily: 'inherit' };
  const title = e.rollout === 'kuzatish' ? <><b style={bi}>Kuzatish rejimi</b> — bu javob mijozga yuborilmaydi, faqat baholash uchun</>
    : e.rollout === 'tasdiq' ? <>AI javobi tayyor — <b style={bi}>sotuvchi tasdiqlasa</b> yuboriladi</>
    : c.taken_by ? 'Suhbat sotuvchida — AI yubormaydi'
    : e.mode === 'ochiq' ? 'Avtojavob o‘chiq — AI yubormaydi, qoralama taklif sifatida'
    : due ? <>AI javobi tayyor · <TLeft due={due} /> dan keyin yuboriladi, agar sotuvchi javob bermasa</>
    : 'AI javobi tayyor';
  return (
    <div className="draft" id="draft">
      <div className="draft-lbl"><svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" /></svg>AI qoralama · {ROLL_L[e.rollout as Rollout]}</div>
      <div className="draft-head">
        {due ? <Ring due={due} T={e.T} /> : null}
        <div><div className="draft-title">{title}</div><div className="draft-sub">Rejim: {MODE_L[e.mode as Mode]}{e.mode === 'kechiksa' ? ` · T = ${e.T} s` : ''}{e.night ? ' · tungi vaqt' : ''} · bosqich: {ROLL_L[e.rollout as Rollout]}</div></div>
      </div>
      {dr.photos?.length ? <div className="draft-photo">{dr.photos.map(ph => <img key={ph.id} src={`/api/products/${ph.id}/photo`} alt={ph.name} title={ph.name} loading="lazy" />)}<span>Javobga {dr.photos.length} ta rasm biriktirilgan: {dr.photos.map(ph => ph.name.split('—')[0].trim()).join(', ')}</span></div> : null}
      <div className="draft-body">{dr.text}</div>
      {dr.sources.length ? <div className="src">{dr.sources.slice(0, 3).map((s, i) => <span key={i}>{s}</span>)}{dr.sources.length > 3 ? <span className="muted">… yana {dr.sources.length - 3} ta manba</span> : null}</div> : null}
      <div className="draft-actions">
        {e.rollout !== 'kuzatish' ? <button className="btn sm primary" type="button" onClick={() => onAct('approve', dr.id)}>Yuborish</button> : null}
        <button className="btn sm" type="button" title="Matn yozish maydoniga tushadi — o‘zingiz tahrirlab yuborasiz" onClick={() => onAct('edit', dr.id)}>Tahrirlash</button>
        <button className="btn sm ghost" type="button" onClick={() => onAct('cancelDraft', dr.id)}>Rad etish</button>
        {role !== 'sotuvchi' ? <button className="btn sm ghost" type="button" onClick={() => onAct('teach', dr.id)} title="To‘g‘ri javobni yozing — agent keyingi safar shunday javob beradi">O‘rgatish</button> : null}
        <span style={{ marginLeft: 'auto' }} className="row-actions"><span className="muted" style={{ fontSize: 12 }}>Baho:</span>
          <button className={`btn sm ${dr.rating === 'good' ? 'primary' : ''}`} type="button" onClick={() => onAct('rate', dr.id, 'good')}>Yaxshi</button>
          <button className={`btn sm ${dr.rating === 'bad' ? 'primary' : ''}`} type="button" onClick={() => onAct('rate', dr.id, 'bad')}>Yomon</button></span>
      </div>
    </div>
  );
}
