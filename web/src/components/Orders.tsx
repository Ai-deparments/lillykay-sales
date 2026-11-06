'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, isUnauthorized } from '@/lib/api';
import { fmtDT, telHref } from '@/lib/format';
import { useApp } from '@/components/AppContext';
import { useChatPreview } from '@/components/ChatPreview';

const ORD_TABS: [string, string][] = [['tolov', 'Karta va to‘lov'], ['buyurtma', 'Dastavka'], ['shikoyat', 'Muammoli tovar'],
  ['rasm', 'Rasm so‘raganlar'], ['boshqa', 'Boshqa'], ['yakun', 'Yakunlangan']];
const ORD_ST: Record<string, string> = { queued: 'navbatda', offered: 'sotuvchi ko‘rishi kutilmoqda', accepted: 'sotuvchida', escalated: 'rahbarga o‘tdi', done: 'bajarildi' };

interface Order {
  id: number; conversation_id: number; display_name?: string | null; handle?: string | null; channel: string; urgent?: boolean; heat?: string | null;
  title?: string | null; body?: string | null; user_name?: string | null; status: string; done_at?: number; created_at: number; phone?: string | null;
}
interface OrdersResp { items: Order[]; counts: Record<string, number> }

export function Orders({ active }: { active: boolean }) {
  const { isLead, toast, fail } = useApp();
  const preview = useChatPreview();
  const [tab, setTab] = useState('tolov');
  const [r, setR] = useState<OrdersResp | null>(null);

  const load = useCallback(async () => {
    try { setR(await api<OrdersResp>(`/api/orders?tab=${tab}`)); } catch (e) { if (!isUnauthorized(e)) fail(e); }
  }, [tab, fail]);
  useEffect(() => { if (active) void load(); }, [active, load]);

  const onDone = async (id: number) => {
    if (!await api(`/api/assignments/${id}`, { action: 'done' }).catch(fail)) return;
    toast('Bajarildi deb belgilandi');
    void load();
  };
  if (!r) return null;
  const done = tab === 'yakun';
  return (
    <>
      <div className="tabs" role="tablist">{ORD_TABS.map(([k, l]) => (
        <button key={k} type="button" role="tab" data-otab={k} aria-selected={tab === k} onClick={() => setTab(k)}>{l}{r.counts[k] ? ` (${r.counts[k]})` : ''}</button>))}</div>
      <div className="rows">{r.items.length ? r.items.map(t => (
        <div className={`row-item${done ? ' done' : ''}`} key={t.id}>
          <div className="t"><b>{t.display_name || t.handle || 'Mijoz'}</b>
            <span className="pill">{t.channel === 'ig' ? 'Instagram' : t.channel === 'tg' ? 'Telegram' : t.channel}</span>
            {t.urgent && !done ? <span className="pill bad">shoshilinch</span> : null}
            {t.heat ? <span className={`pill ${t.heat === 'issiq' ? 'bad' : t.heat === 'iliq' ? 'warn' : ''}`}>{t.heat}</span> : null}</div>
          <div>{t.title || ''}{t.body ? <><br /><span className="muted">{t.body}</span></> : null}</div>
          <div className="row-actions muted">{t.user_name || 'biriktirilmagan'} · {ORD_ST[t.status] || t.status} · {fmtDT(done ? t.done_at : t.created_at)}
            {t.phone ? <a className="btn sm ghost" href={telHref(t.phone)}>{t.phone}</a> : null}
            <button className="btn sm" type="button" data-bchat={t.conversation_id} onClick={() => { preview(t.conversation_id).catch(fail); }}>Suhbat</button>
            {!done && isLead ? <button className="btn sm primary" type="button" data-odone={t.id} onClick={() => { void onDone(t.id); }}>Bajarildi</button> : null}</div>
        </div>)) : <div className="row-item"><div className="muted">{done ? 'Oxirgi 7 kunda yakunlangan ish yo‘q.' : 'Bu bo‘limda hozircha ish yo‘q.'}</div></div>}</div>
    </>
  );
}
