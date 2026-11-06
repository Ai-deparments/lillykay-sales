'use client';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import { dayLabel, fmtD, fmtT, richText } from '@/lib/format';
import { Avatar, Brand, Icon } from '@/components/ui';
import { DraftBlock, MODE_L } from './DraftBlock';
import type { ActFn } from './DraftBlock';
import type { ConvDetail, Msg } from './types';

/* Bir kishining ketma-ket xabarlari (5 daqiqa ichida) — bitta guruh */
const keyOf = (m: Msg) => m.author === 'seller' ? 's:' + (m.user_name || '') : m.author;
const near = (x?: Msg, y?: Msg) => Boolean(x && y && x.author !== 'system' && keyOf(x) === keyOf(y)
  && fmtD(x.created_at) === fmtD(y.created_at) && Math.abs(y.created_at - x.created_at) < 5 * 60e3);

const MODES = (accDef: string): [string, string][] => [['inherit', accDef], ['doim', 'Bu suhbatda — doim'], ['kechiksa', 'Bu suhbatda — kechiksa'], ['ochiq', 'Bu suhbatda — o‘chiq']];

export interface MsgActions { onReply: (m: Msg) => void; onEdit: (m: Msg) => void; onDelete: (m: Msg) => void; onCopy: (m: Msg) => void }

function Message({ m, prev, next, accName, all, act }: { m: Msg; prev?: Msg; next?: Msg; accName: string; all: Msg[]; act: MsgActions }) {
  const cont = near(prev, m), more = near(m, next);
  if (m.author === 'system') return <div className="sys">{m.meta?.offline ? 'Telegram avtojavobi (sotuvchi javobi emas): ' : ''}{m.text}</div>;
  const k = m.author === 'client' ? 'c' : m.author === 'seller' ? 's' : 'ai';
  const grp = cont ? (more ? ' g-mid' : ' g-last') : (more ? ' g-first' : '');
  // Kim yozdi — AI yoki sotuvchi. Ismi ma’lum bo‘lsa ism, bo‘lmasa shunchaki «Sotuvchi».
  const who = cont ? '' : m.author === 'ai' ? 'AI' : m.author === 'seller' ? (m.meta?.imported ? accName : m.user_name || 'Sotuvchi') : '';
  const tag = !more && m.author === 'ai' && m.meta?.tag
    ? <span className="tag">{/tasdiqla/i.test(m.meta.tag) ? m.meta.tag : 'avtomatik yuborildi'}</span> : null;
  const md = m.meta?.media;
  const media = !md ? null : md.kind === 'photo' ? <a href={`/api/files/${m.id}`} target="_blank" rel="noopener"><img className="msg-img" src={`/api/files/${m.id}`} alt="Rasm" loading="lazy" /></a>
    : md.kind === 'voice' || md.kind === 'audio' ? <audio controls preload="none" src={`/api/files/${m.id}`}></audio>
    : md.kind === 'video' ? <video className="msg-img" controls preload="none" src={`/api/files/${m.id}`}></video>
    : <a className="btn sm" href={`/api/files/${m.id}`} target="_blank" rel="noopener">{md.kind === 'document' ? 'Faylni ochish' : 'Videoni ochish'}{md.name ? ' · ' + md.name : ''}</a>;
  // Javob (reply) iqtibosi: sotuvchi javobida ichki id, mijoz javobida kanal id si bo‘yicha topiladi
  const q = m.meta?.reply_to ? all.find(x => x.id === m.meta?.reply_to) : m.meta?.reply_ext ? all.find(x => x.ext_msg_id === m.meta?.reply_ext) : undefined;
  const quote = (m.meta?.reply_to || m.meta?.reply_ext) ? <div className="quote"><b>{q ? (q.author === 'client' ? 'Mijoz' : q.author === 'ai' ? 'AI' : q.user_name || 'Sotuvchi') : 'Xabar'}</b><span>{q ? q.text.slice(0, 120) : 'eski xabar'}</span></div> : null;
  const deleted = Boolean(m.meta?.deleted_at);
  return (
    <div className={`msg ${k}${grp}${deleted ? ' deleted' : ''}`} data-mid={m.id}>
      {!deleted ? <div className="msg-tools" role="toolbar" aria-label="Xabar amallari">
        <button type="button" title="Javob berish" onClick={() => act.onReply(m)}>↩</button>
        <button type="button" title="Nusxa olish" onClick={() => act.onCopy(m)}>⧉</button>
        {k !== 'c' && !md ? <button type="button" title="Tahrirlash" onClick={() => act.onEdit(m)}>✎</button> : null}
        <button type="button" className="danger" title="O‘chirish" onClick={() => act.onDelete(m)}><Icon name="trash" /></button>
      </div> : null}
      {who ? <div className="who">{who}</div> : null}
      {quote}
      {media}
      {k === 'c' ? <div className="txt">{m.text}</div> : <div className="txt" dangerouslySetInnerHTML={{ __html: richText(m.text) }} />}
      <div className="msg-meta">
        {m.meta?.deleted_at ? <span className="pill bad">mijoz o‘chirdi</span> : null}
        {m.meta?.edited_at ? <span title={`Avvalgi matn: ${m.meta.original || ''}`}>tahrirlandi</span> : null}
        {tag}<span className="mono">{fmtT(m.created_at)}</span>
      </div>
    </div>
  );
}

export interface ThreadProps {
  d: ConvDetail;
  isLead: boolean;
  role: string;
  menuOpen: boolean;
  onMenu: () => void;
  onAct: ActFn;
  onMode: (v: string) => void;
  composeRef: RefObject<HTMLTextAreaElement | null>;
  onCompose: () => void;
  onSend: (replyTo: number | null, editId: number | null) => Promise<boolean>;
  onFile: (file: Blob, o?: { name?: string; voice?: boolean; caption?: string; replyTo?: number | null }) => Promise<boolean>;
  keepRef: MutableRefObject<number | null>;
}

/** Ochiq suhbat: sarlavha, xabarlar, yozish maydoni. `key={conv.id}` bilan chaqiriladi (yangi suhbat — yangi holat). */
export function Thread({ d, isLead, role, menuOpen, onMenu, onAct, onMode, composeRef, onCompose, onSend, onFile, keepRef }: ThreadProps) {
  const c = d.conv, a = d.account, e = d.effective;
  const boxRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true), scrolled = useRef(false);
  const [reply, setReply] = useState<Msg | null>(null), [editing, setEditing] = useState<Msg | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [rec, setRec] = useState<{ sec: number } | null>(null);
  const recRef = useRef<{ mr: MediaRecorder; chunks: Blob[]; stream: MediaStream; cancel: boolean; t: ReturnType<typeof setInterval> } | null>(null);
  useEffect(() => () => { const r = recRef.current; if (r) { r.cancel = true; clearInterval(r.t); r.stream.getTracks().forEach(t => t.stop()); } }, []);

  const focusCompose = () => composeRef.current?.focus();
  const send = async () => {
    if (busy) return;
    setBusy(true);
    const ok = await onSend(reply?.id ?? null, editing?.id ?? null).finally(() => setBusy(false));
    if (ok) { setReply(null); setEditing(null); }
  };
  /* Rasm yuborish (Telegram va Instagram): tanlangan rasmlar ketma-ket ketadi; yozilgan matn — izoh */
  const sendImages = async (files: File[]) => {
    const imgs = files.filter(f => /^image\//.test(f.type));
    if (!imgs.length || busy) return;
    setBusy(true);
    const t = composeRef.current, cap = imgs.length === 1 ? (t?.value.trim() || '') : '';
    let ok = true;
    for (const f of imgs) { if (!(await onFile(f, { caption: cap, replyTo: reply?.id ?? null }))) { ok = false; break; } }
    setBusy(false);
    if (ok) { if (t && cap) { t.value = ''; t.style.height = 'auto'; } setReply(null); }
  };
  const startEdit = (m: Msg) => { setReply(null); setEditing(m); const t = composeRef.current; if (t) { t.value = m.text; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 150) + 'px'; t.focus(); } };
  const cancelEdit = () => { setEditing(null); const t = composeRef.current; if (t) { t.value = ''; t.style.height = 'auto'; } };
  const act2: MsgActions = {
    onReply: m => { setEditing(null); setReply(m); focusCompose(); },
    onEdit: startEdit,
    onDelete: m => onAct('delmsg', m.id),
    onCopy: m => { void navigator.clipboard?.writeText(m.text).catch(() => {}); }
  };
  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream), chunks: Blob[] = [];
      const t0 = Date.now();
      const t = setInterval(() => setRec({ sec: Math.floor((Date.now() - t0) / 1000) }), 500);
      recRef.current = { mr, chunks, stream, cancel: false, t };
      mr.ondataavailable = ev => { if (ev.data.size) chunks.push(ev.data); };
      mr.onstop = async () => {
        clearInterval(t); stream.getTracks().forEach(x => x.stop());
        const r = recRef.current; recRef.current = null; setRec(null);
        if (!r || r.cancel || !chunks.length) return;
        setBusy(true);
        const ok = await onFile(new Blob(chunks, { type: mr.mimeType || 'audio/webm' }), { name: 'ovoz', voice: true, replyTo: reply?.id ?? null });
        setBusy(false);
        if (ok) setReply(null);
      };
      mr.start(); setRec({ sec: 0 });
    } catch { alert('Mikrofonga ruxsat berilmadi — brauzer manzil satridagi ruxsatni yoqing.'); }
  };
  const stopRec = (cancel: boolean) => { const r = recRef.current; if (!r) return; r.cancel = cancel; r.mr.stop(); };

  // Xabarlar o‘zgarganda: pastda bo‘lgan bo‘lsa yoki birinchi marta — pastga; «Oldingi xabarlar» bosilgan bo‘lsa — joyida qoladi
  useLayoutEffect(() => {
    const box = boxRef.current; if (!box) return;
    if (keepRef.current != null) { box.scrollTop = box.scrollHeight - keepRef.current; keepRef.current = null; }
    else if (atBottom.current || !scrolled.current) { box.scrollTop = box.scrollHeight; scrolled.current = true; }
  }, [d, keepRef]);

  const curMode = ['inherit', 'doim', 'kechiksa', 'ochiq'].includes(String(c.mode)) ? String(c.mode) : 'inherit';
  const accDef = `Akkaunt bo‘yicha — ${MODE_L[a.mode].toLowerCase()}`;
  const manage = isLead ? (
    <span className="menu-wrap"><button className="btn sm icon ghost" type="button" data-act="menu" title="Boshqa amallar" aria-haspopup="true" onClick={onMenu}><Icon name="more" /></button>
      <span className="menu" hidden={!menuOpen}>
        <button type="button" data-act="clear" onClick={() => onAct('clear')}><Icon name="broom" /><span>Tarixni tozalash<small>xabarlar o‘chadi, karta qoladi</small></span></button>
        <button type="button" className="danger" data-act="delete" onClick={() => onAct('delete')}><Icon name="trash" /><span>Chatni o‘chirish<small>butunlay, qaytarib bo‘lmaydi</small></span></button>
      </span></span>) : null;
  const cardBtn = <button className="btn only-narrow" type="button" data-act="card" onClick={() => onAct('card')}><Icon name="card" /> Karta</button>;

  const list = d.messages;
  const parts: React.ReactNode[] = [];
  let lastDay = '';
  if (c.archived) parts.push(<div className="sys" key="arch">Eski yozishma — Telegram eksportidan yuklangan ({d.messages_total.toLocaleString('ru-RU')} xabar). Mijoz qayta yozsa, suhbat jonli ro‘yxatga o‘tadi va AI shu tarixni biladi.</div>);
  if (d.messages_total > list.length) parts.push(<button className="btn sm more-btn" type="button" data-act="older" key="older" onClick={() => {
    const box = boxRef.current; if (box) keepRef.current = box.scrollHeight - box.scrollTop; onAct('older');
  }}>Oldingi xabarlar — yana {Math.min(300, d.messages_total - list.length)} ta (jami {d.messages_total.toLocaleString('ru-RU')})</button>);
  else if (!e.channel_open && a.channel !== 'demo' && !c.archived) parts.push(<div className="sys warn" key="closed">{a.can_reply ? 'Telegram’ning 24 soatlik oynasi yopiq — bot bu chatga yoza olmaydi. Mijozga sotuvchi o‘z ilovasidan yozadi.' : 'Business ulanishda «javob berish» huquqi yo‘q — Telegram sozlamasidan bering.'}</div>);
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    const day = fmtD(m.created_at);
    if (day !== lastDay) { parts.push(<div className="day" key={'d' + m.id}>{dayLabel(m.created_at)}</div>); lastDay = day; }
    parts.push(<Message key={m.id} m={m} prev={list[i - 1]} next={list[i + 1]} accName={a.name} all={list} act={act2} />);
  }
  parts.push(<DraftBlock key="draft" d={d} role={role} onAct={onAct} />);

  return (
    <>
      <div className="thread-head">
        <button className="btn ghost icon only-mobile" type="button" data-act="back" aria-label="Orqaga" onClick={() => onAct('back')}><Icon name="back" /></button>
        <Avatar name={c.name} src={c.avatar} ch={a.channel} className="th-ava" id="thAva" ariaHidden />
        <div className="th-id">
          <div className="thread-title" id="thTitle">{c.name} {c.is_demo ? <span className="demo-tag">demo</span> : null}</div>
          <div className="thread-sub" id="thSub"><span className="th-acc"><Brand ch={a.channel} />{a.name}</span><span className="th-sep" aria-hidden="true"></span><span>{c.branch || 'filial belgilanmagan'}</span><span className="th-sep" aria-hidden="true"></span><span>Mas’ul: {c.owner || '—'}</span></div>
        </div>
        <div className="thread-actions" id="thActions">
          {c.archived ? <>
            <span className="pill">Arxiv</span>{manage}{cardBtn}
          </> : <div className="glass-pill">
            {c.taken_by ? <><span className="gp-state" title={`Suhbat ${c.taken_by} da — AI to‘xtagan`}>{c.taken_by}</span><button className="gp-btn" type="button" data-act="release" onClick={() => onAct('release')}>AI’ga qaytarish</button></>
              : <button className="gp-btn primary" type="button" data-act="take" onClick={() => onAct('take')}>O‘zim olaman</button>}
            <span className="menu-wrap"><button className="gp-dots" type="button" data-act="menu" title="Boshqa amallar" aria-label="Boshqa amallar" aria-haspopup="true" aria-expanded={menuOpen} onClick={onMenu}><Icon name="more" /></button>
              <span className="menu thread-menu" hidden={!menuOpen}>
                <div className="menu-title">Avtojavob</div>
                {MODES(accDef).map(([v, l]) => <button key={v} type="button" className={`mode-opt${curMode === v ? ' on' : ''}`} onClick={() => onMode(v)}><span>{l}</span><i aria-hidden="true">{curMode === v ? '✓' : ''}</i></button>)}
                <div className="menu-sep" />
                <button type="button" data-act="photo" onClick={() => onAct('photo')}><Icon name="aperture" /><span>Tovar rasmi yuborish</span></button>
                {a.is_demo && isLead ? <button type="button" data-act="simulate" onClick={() => onAct('simulate')}><Icon name="demo" /><span>Mijoz sifatida yozish</span></button> : null}
                <button type="button" className="only-narrow" data-act="card" onClick={() => onAct('card')}><Icon name="card" /><span>Mijoz kartasi</span></button>
                {isLead ? <>
                  <div className="menu-sep" />
                  <button type="button" data-act="clear" onClick={() => onAct('clear')}><Icon name="broom" /><span>Tarixni tozalash<small>xabarlar o‘chadi, karta qoladi</small></span></button>
                  <button type="button" className="danger" data-act="delete" onClick={() => onAct('delete')}><Icon name="trash" /><span>Chatni o‘chirish<small>butunlay, qaytarib bo‘lmaydi</small></span></button>
                </> : null}
              </span></span>
          </div>}
        </div>
      </div>
      <div className="msgs" id="msgs" ref={boxRef} onScroll={() => { const b = boxRef.current; if (b) atBottom.current = b.scrollHeight - b.scrollTop - b.clientHeight < 60; }}>{parts}</div>
      <div className="composer" hidden={Boolean(c.archived)}>
        {reply ? <div className="reply-bar"><div><b>Javob: {reply.author === 'client' ? 'Mijoz' : reply.author === 'ai' ? 'AI' : reply.user_name || 'Sotuvchi'}</b><span>{reply.text.slice(0, 140)}</span></div>
          <button type="button" className="btn ghost icon" aria-label="Bekor qilish" onClick={() => setReply(null)}><Icon name="x" /></button></div> : null}
        {editing ? <div className="reply-bar edit"><div><b>Tahrirlash</b><span>{editing.text.slice(0, 140)}</span></div>
          <button type="button" className="btn ghost icon" aria-label="Bekor qilish" onClick={cancelEdit}><Icon name="x" /></button></div> : null}
        {rec ? <div className="rec-bar"><span className="rec-dot" aria-hidden="true"></span>Yozilmoqda… {Math.floor(rec.sec / 60)}:{String(rec.sec % 60).padStart(2, '0')}
          <button type="button" className="btn sm" onClick={() => stopRec(true)}>Bekor</button><button type="button" className="btn sm primary" onClick={() => stopRec(false)}>Yuborish</button></div> : null}
        <div className="composer-row">
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden onChange={ev => { const f = Array.from(ev.target.files || []); ev.target.value = ''; void sendImages(f); }} />
          <button type="button" className="mic-btn attach-btn" title="Rasm yuborish" aria-label="Rasm yuborish" disabled={busy || Boolean(editing)} onClick={() => fileRef.current?.click()}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3.5"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-8.5 9"/></svg></button>
          <textarea id="compose" rows={1} placeholder={editing ? 'Xabarni tahrirlang…' : 'Javob yozing…'} ref={composeRef} onInput={onCompose}
            onKeyDown={ev => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); void send(); } else if (ev.key === 'Escape') { setReply(null); if (editing) cancelEdit(); } }}></textarea>
          <button type="button" className="mic-btn" title="Ovozli xabar" aria-label="Ovozli xabar" disabled={busy || Boolean(editing) || Boolean(rec)} onClick={() => { void startRec(); }}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg></button>
          <button className="btn primary send-btn" type="button" data-act="send" title="Yuborish (Enter)" disabled={busy} onClick={() => { void send(); }}><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M21.8 2.9 2.6 10.3a.8.8 0 0 0 0 1.5l4.9 1.8 1.9 6a.8.8 0 0 0 1.3.4l2.7-2.3 4.9 3.6c.5.4 1.3.1 1.4-.6l3.2-15.4c.1-.7-.5-1.2-1.1-1z"/></svg><span>{editing ? 'Saqlash' : 'Yuborish'}</span></button>
        </div>
      </div>
    </>
  );
}
