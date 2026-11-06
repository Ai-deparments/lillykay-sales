'use client';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type { DragEvent } from 'react';
import { api, isUnauthorized } from '@/lib/api';
import { LOST_COL, boardBus, fetchAdvice, moveCard } from '@/lib/boardBus';
import type { BoardData, BoardItem } from '@/lib/boardBus';
import { ago, fmtDT, telHref } from '@/lib/format';
import { Icon } from '@/components/ui';
import { useApp } from '@/components/AppContext';
import { useChatPreview } from '@/components/ChatPreview';

const TASK_L: Record<string, string> = { followup: 'Jim qolgan', handoff: 'Sotuvchiga uzatildi', big_order: 'Katta buyurtma', reminder: 'Eslatma', morning: 'Tungi suhbat', send_failed: 'Yuborilmadi', draft_failed: 'AI qoralama yo‘q', window_closed: 'Oyna yopiq' };
const HEAT_K: Record<string, string> = { sovuq: 'cold', iliq: 'mid', issiq: 'hot' };

interface Task { id: number; kind: string; title: string; body?: string | null; conv_name?: string | null; user_name?: string | null; due_at: number; done_at?: number; result?: string | null; conversation_id?: number | null }
interface TasksResp { items: Task[]; closed?: Task[] }

function Phone({ phone }: { phone?: string | null }) {
  return phone ? <a className="bc-tel" href={telHref(phone)}><Icon name="phone" />{phone}</a> : null;
}

export function Tasks({ active }: { active: boolean }) {
  const { toast, fail, setBadge } = useApp();
  const preview = useChatPreview();
  const [tab, setTab] = useState<'doska' | 'vazifa'>('doska');
  const [tasks, setTasks] = useState<TasksResp | null>(null);
  const [boardF, setBoardF] = useState('all');
  const [boardRaw, setBoardRaw] = useState('');
  const boardQ = boardRaw.trim();
  const [dragId, setDragId] = useState<number | null>(null);
  const [overCol, setOverCol] = useState<number | null>(null);
  const [advBusy, setAdvBusy] = useState<number | null>(null);
  const B = useSyncExternalStore(boardBus.subscribe, () => boardBus.data, () => null);
  // Doska ob’ekti joyida o‘zgartiriladi (boardBus.notify) — qayta chizish uchun versiya
  const [, force] = useState(0);
  useEffect(() => boardBus.subscribe(() => force(x => x + 1)), []);

  const load = useCallback(async (t: 'doska' | 'vazifa') => {
    try {
      const r = await api<TasksResp>('/api/tasks');
      setBadge('tasks', r.items.length);
      setTasks(r);
      if (t === 'doska') boardBus.set(await api<BoardData>('/api/board'));
    } catch (e) { if (!isUnauthorized(e)) fail(e); }
  }, [fail, setBadge]);
  useEffect(() => { if (active) void load(tab); }, [active, tab, load]);

  const boardPass = (c: BoardItem) => {
    if (boardF === 'phone' && !c.phone) return false;
    if (boardF === 'hot' && c.heat !== 'issiq' && c.heat !== 'iliq') return false;
    if (boardQ && !`${c.name} ${c.phone || ''} ${c.asked || ''}`.toLowerCase().includes(boardQ.toLowerCase())) return false;
    return true;
  };

  const openChat = (id: number) => { preview(id).catch(fail); };
  const onAdvice = async (id: number) => {
    setAdvBusy(id);
    const a = await fetchAdvice(id, { toast, fail });
    setAdvBusy(null);
    if (a != null) toast('AI maslahati tayyor — «Chat» ni oching');
    openChat(id);
  };
  const onDone = async (id: number) => {
    const result = prompt('Natija (qisqa):', 'bajarildi'); if (result === null) return;
    await api(`/api/tasks/${id}/done`, { result }).catch(fail);
    void load(tab);
  };
  const onDrop = (e: DragEvent<HTMLElement>, to: number) => {
    e.preventDefault(); setOverCol(null);
    const id = Number(e.dataTransfer.getData('text/plain')), it = boardBus.find(id);
    if (!it || (it.lost ? LOST_COL : it.stage) === to) return;
    void moveCard(id, to, { toast, fail });
  };

  const boardCard = (c: BoardItem) => (
    <article key={c.id} className={`bcard${c.waiting ? ' wait' : ''}${dragId === c.id ? ' drag' : ''}`} draggable data-bid={c.id}
      onDragStart={e => { e.dataTransfer.setData('text/plain', String(c.id)); setDragId(c.id); }} onDragEnd={() => setDragId(null)}>
      <div className="bc-top">{c.heat ? <span className="heat" style={{ background: `var(--wb-${HEAT_K[c.heat]})` }} title={`Qiziqish: ${c.heat}`}></span> : null}<b>{c.name}</b><span className="bc-ago">{ago(c.last_at)}</span></div>
      <Phone phone={c.phone} />
      {c.asked || c.budget ? <div className="bc-ask">{[c.asked, c.budget].filter(Boolean).join(' · ')}</div> : null}
      {c.waiting ? <div className="bc-flag">javob kutmoqda</div> : null}
      {c.next_step ? <div className="bc-ai"><span>AI</span>{c.next_step}</div> : null}
      <div className="bc-act"><button className="btn sm" type="button" data-bchat={c.id} onClick={() => openChat(c.id)}>Chat</button>
        <button className="btn sm ghost" type="button" data-badvice={c.id} disabled={advBusy === c.id} onClick={() => { void onAdvice(c.id); }}>{advBusy === c.id ? 'AI o‘ylayapti…' : 'AI maslahat'}</button></div>
    </article>
  );

  const renderBoard = () => {
    if (!B) return null;
    const withPhone = B.items.filter(c => c.phone).length;
    const items = B.items.filter(boardPass);
    const cols = [...B.stages.map((name, i) => ({ i, name, list: items.filter(c => !c.lost && c.stage === i) })), { i: LOST_COL, name: 'Yo‘qotildi', list: items.filter(c => c.lost) }];
    const focus = B.focus.map(id => B.items.find(c => c.id === id)).filter((x): x is BoardItem => Boolean(x));
    return (
      <>
        <div className="board-bar">
          <div className="chips">{([['all', 'Hammasi', B.items.length], ['phone', 'Raqam bergan', withPhone], ['hot', 'Qiziqqan', B.items.filter(c => c.heat === 'issiq' || c.heat === 'iliq').length]] as [string, string, number][])
            .map(([k, l, n]) => <button key={k} className="chip" type="button" data-bf={k} aria-pressed={boardF === k} onClick={() => setBoardF(k)}>{l}<span className="c">{n}</span></button>)}</div>
          <label className="search"><span><Icon name="search" /></span><input id="boardQ" type="search" value={boardRaw} onChange={e => setBoardRaw(e.target.value)} placeholder="Ism, telefon yoki tovar" autoComplete="off" /></label>
        </div>
        <div id="boardFocus">{focus.length ? <><div className="lbl">Bugun qo‘ng‘iroq qiling</div><div className="focus-row">{focus.map(c => (
          <div className="focus" key={c.id}><b>{c.name}</b><Phone phone={c.phone} /><span className="muted">{c.next_step || c.asked || ''}</span>
            <button className="btn sm" type="button" data-bchat={c.id} onClick={() => openChat(c.id)}>Chat</button></div>))}</div></> : null}</div>
        <div className="board" id="board" title="Kartani sudrab boshqa ustunga o‘tkazing. «Xarid tasdiqlandi» — faqat chek bo‘lsa, «Yo‘qotildi» — sabab va dalil bilan.">{cols.map(col => (
          <section key={col.i} className={`bcol${overCol === col.i ? ' over' : ''}`} data-col={col.i}
            onDragOver={e => { e.preventDefault(); setOverCol(col.i); }} onDragLeave={() => setOverCol(o => (o === col.i ? null : o))} onDrop={e => onDrop(e, col.i)}>
            <header><span>{col.name}</span><span className="c">{col.list.length}</span></header>
            <div className="bcol-list">{col.list.map(boardCard)}{col.list.length ? null : <div className="bcol-empty">bo‘sh</div>}</div>
          </section>))}</div>
      </>
    );
  };

  const renderList = () => {
    if (!tasks) return null;
    return (
      <>
        <div className="rows">{tasks.items.length ? tasks.items.map(t => (
          <div className="row-item" key={t.id}>
            <div className="t"><b>{t.conv_name || 'Mijoz'}</b><span className={`pill ${t.kind === 'big_order' ? 'acc' : t.kind.includes('fail') || t.kind === 'window_closed' ? 'bad' : 'warn'}`}>{TASK_L[t.kind] || t.kind}</span></div>
            <div>{t.title}{t.body ? <><br /><span className="muted">{t.body}</span></> : null}</div>
            <div className="row-actions">{t.user_name || 'biriktirilmagan'} · {fmtDT(t.due_at)}
              {t.conversation_id ? <button className="btn sm" type="button" data-bchat={t.conversation_id} onClick={() => openChat(t.conversation_id as number)}>Chat</button> : null}<button className="btn sm" type="button" data-done={t.id} onClick={() => { void onDone(t.id); }}>Bajarildi</button></div>
          </div>)) : <div className="row-item"><div className="muted">Ochiq vazifa yo‘q.</div></div>}</div>
        {(tasks.closed || []).length ? <details className="closed-tasks"><summary>Oxirgi sutkada yopilgan vazifalar ({tasks.closed!.length})</summary>
          <div className="rows">{tasks.closed!.map(t => (
            <div className="row-item done" key={t.id}>
              <div className="t"><b>{t.conv_name || 'Mijoz'}</b><span className="pill ok">{TASK_L[t.kind] || t.kind}</span></div>
              <div>{t.title}{t.result ? <><br /><span className="muted">{t.result}</span></> : null}</div>
              <div className="row-actions muted">{t.user_name || '—'} · {fmtDT(t.done_at)}
                {t.conversation_id ? <button className="btn sm ghost" type="button" data-bchat={t.conversation_id} onClick={() => openChat(t.conversation_id as number)}>Chat</button> : null}</div>
            </div>))}</div></details> : null}
      </>
    );
  };

  return (
    <>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" data-ttab="doska" aria-selected={tab === 'doska'} onClick={() => setTab('doska')}>Mijozlar doskasi</button>
        <button type="button" role="tab" data-ttab="vazifa" aria-selected={tab === 'vazifa'} onClick={() => setTab('vazifa')}>Vazifalar ({tasks ? tasks.items.length : 0})</button>
      </div>
      <div id="taskBody">{tab === 'doska' ? renderBoard() : renderList()}</div>
    </>
  );
}
