'use client';
import { useEffect, useRef } from 'react';
import { Avatar } from '@/components/ui';
import { clockNow, fmtD, fmtT, sameDay } from '@/lib/format';
import { HEAT } from './CustomerCard';
import type { Conv } from './types';

export const FILTERS: [string, string][] = [['all', 'Hammasi'], ['wait', 'Javob kutmoqda'], ['ai', 'AI kutmoqda'], ['mine', 'Menda'], ['big', 'Katta buyurtma'], ['demo', 'Demo']];

/* Chat qatorida pill'lar o‘rniga bitta kichik nuqta: eng muhim holat (ustuvorlik: katta buyurtma → javobsiz → kutmoqda → AI → yangi).
   Tafsilot (necha daqiqa, kim olgan, filial) nuqta ustiga olib borganda — title'da. */
function statusDot(c: Conv, isFresh: boolean): { kind: string; title: string } | null {
  const bits: string[] = [];
  if (c.taken_by) bits.push(`Olgan: ${c.taken_by}`);
  if (c.remind_at) bits.push(`Eslatma ${fmtD(c.remind_at)}`);
  const place = c.branch || c.account || '';
  if (place) bits.push(place);
  const extra = bits.length ? ` · ${bits.join(' · ')}` : '';
  if (c.big_order && !c.big_accepted) return { kind: 'big', title: `Katta buyurtma${extra}` };
  if (c.pending_since && !c.ai_due_at && c.draft?.status !== 'preparing') {
    return c.overdue ? { kind: 'bad', title: `Javobsiz ${c.wait_min} daq${extra}` } : { kind: 'warn', title: `Kutmoqda ${c.wait_min} daq${extra}` };
  }
  if (c.pending_since && (c.ai_due_at || c.draft?.status === 'preparing')) return { kind: 'ai', title: `AI javob tayyorlamoqda${extra}` };
  if (isFresh) return { kind: 'ok', title: `Yangi xabar${extra}` };
  return null;
}

export interface ConvListProps {
  items: Conv[];
  showArchMore: boolean;
  emptyText: string;
  sel: number | null;
  fresh: Set<number>;
  meId: number;
  onOpen: (id: number) => void;
  onArchMore: () => void;
}

export function ConvItems({ items, showArchMore, emptyText, sel, fresh, meId, onOpen, onArchMore }: ConvListProps) {
  const moreRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (moreRef.current) moreRef.current.disabled = false; }, [items.length]);
  if (!items.length && !showArchMore) return <div className="empty">{emptyText}</div>;
  return (
    <>
      {items.map(c => (
        <button key={c.id} className={`conv${fresh.has(c.id) ? ' fresh' : ''}`} type="button" data-id={c.id} aria-current={c.id === sel} onClick={() => onOpen(c.id)}>
          <Avatar name={c.name} src={c.avatar} ch={c.channel} />
          <span className="conv-name">{c.name} {c.is_demo ? <span className="demo-tag">demo</span> : null}</span>
          <span className="conv-time">{sameDay(c.last_at, clockNow()) ? fmtT(c.last_at) : fmtD(c.last_at)}</span>
          <span className="conv-snip">{c.last_author === 'seller' ? <><b className="who-s">{c.last_user_id && c.last_user_id === meId ? 'Siz' : 'Sotuvchi'}:</b> </> : c.last_author === 'ai' ? <><b className="who-ai">AI:</b> </> : null}{c.last_text}</span>
          {(() => { const d = statusDot(c, fresh.has(c.id)); return (
            <span className="conv-dots">
              {c.heat ? <span className="heat" style={{ background: `var(--wb-${HEAT[c.heat].k})` }} title={`Qiziqish: ${c.heat}`}></span> : null}
              {d ? <span className={`sdot ${d.kind}`} title={d.title} role="img" aria-label={d.title}></span> : null}
            </span>
          ); })()}
        </button>
      ))}
      {showArchMore ? <button ref={moreRef} className="btn sm more-btn" type="button" data-act="archMore" onClick={e => { e.currentTarget.disabled = true; onArchMore(); }}>Yana 200 ta eski yozishma</button> : null}
    </>
  );
}
