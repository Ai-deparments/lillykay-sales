'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { LOST_COL, boardBus, fetchAdvice, moveCard } from '@/lib/boardBus';
import { ago, fmtDT, telHref } from '@/lib/format';
import { Icon } from '@/components/ui';
import { useApp } from '@/components/AppContext';
import { Select } from './Select';

interface Msg { id: number; author: string; text: string; created_at: number }
interface Detail { conv: { name: string; stage: number; lost_reason?: string | null }; messages: Msg[] }

function PreviewBody({ id, d }: { id: number; d: Detail }) {
  const { boot, toast, fail } = useApp();
  const c = d.conv;
  const bi = boardBus.find(id);
  const msgsRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<string | null>(null);
  useEffect(() => { const b = msgsRef.current; if (b) b.scrollTop = b.scrollHeight; }, []);
  const stageOpts: [number, string][] = [...boot.stages.map((n, i) => [i, n] as [number, string]), [LOST_COL, 'Yo‘qotildi']];
  const cur = c.lost_reason ? LOST_COL : c.stage;
  const msgs = d.messages.slice(-30);
  const onAdvice = async () => {
    setBusy(true);
    const a = await fetchAdvice(id, { toast, fail });
    setBusy(false);
    if (a != null) setFresh(a);
  };
  return (
    <>
      <div className="pv-head"><div><h2>{c.name}</h2>{bi?.phone ? <a className="bc-tel" href={telHref(bi.phone)}><Icon name="phone" />{bi.phone}</a> : null}</div>
        <label className="field" style={{ minWidth: 180 }}><span>Bosqich</span>
          <Select id="pvStage" defaultValue={cur} onChange={e => { void moveCard(id, Number(e.target.value), { toast, fail }); }}>
            {stageOpts.map(([i, n]) => <option key={i} value={i}>{n}</option>)}
          </Select></label></div>
      <div className="pv-msgs" id="pvMsgs" ref={msgsRef}>
        {msgs.length ? msgs.map(m => <div key={m.id} className={`pm ${m.author === 'client' ? 'c' : m.author === 'ai' ? 'ai' : 's'}`}>{m.text}<span>{fmtDT(m.created_at)}</span></div>) : <div className="muted">Xabar yo‘q</div>}
      </div>
      <div className="pv-advice" id="pvAdvice">
        {fresh != null ? <><div className="lbl">AI maslahati</div><div className="adv">{fresh}</div></>
          : bi?.advice ? <><div className="lbl">AI maslahati · {ago(bi.advice_at)} oldin</div><div className="adv">{bi.advice}</div></> : null}
      </div>
      <div className="row-actions"><button className="btn sm ai" type="button" id="pvAdv" disabled={busy} onClick={onAdvice}>{busy ? 'AI o‘ylayapti…' : 'AI maslahat olish'}</button>
        <a className="btn sm primary" href={`#suhbat/${id}`} data-close>Suhbatni ochish</a></div>
    </>
  );
}

/** Chatni shu yerning o‘zida ko‘rish: oxirgi xabarlar, bosqich, AI maslahati (app.js `chatPreview`) */
export function useChatPreview(): (id: number) => Promise<void> {
  const { openModal } = useApp();
  return useCallback(async (id: number) => {
    const d = await api<Detail>(`/api/conversations/${id}`);
    openModal({ wide: true, content: <PreviewBody id={id} d={d} /> });
  }, [openModal]);
}
