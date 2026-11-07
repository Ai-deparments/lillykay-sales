'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { api } from '@/lib/api';
import { isUnauthorized, errorText } from '@/lib/api';
import { useInterval } from '@/lib/hooks';
import { Brand, Icon } from '@/components/ui';
import { PageHead } from '@/components/Shell';
import { useApp } from '@/components/AppContext';
import type { Heat } from '@/lib/types';
import { CustomerCard } from './CustomerCard';
import { ConvItems, FILTERS } from './ConvList';
import { Thread } from './Thread';
import { EditCardContent, PhotoPicker, TeachContent } from './modals';
import type { Conv, ConvDetail, ConvList, PickProduct } from './types';

function autoGrow(t: HTMLTextAreaElement) { t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 150) + 'px'; }

/** Suhbatlar bo‘limi: ro‘yxat + ochiq suhbat + mijoz kartasi (app.js «SUHBATLAR») */
export function Inbox({ active }: { active: boolean }) {
  const { boot, isLead, toast, fail, openModal, closeModal, hash, navigate, syncClock, setBadge } = useApp();
  const me = boot.me;

  const [list, setList] = useState<Conv[]>([]);
  const [archivedTotal, setArchivedTotal] = useState(0);
  const [arch, setArch] = useState<Conv[] | null>(null);
  const [archMore, setArchMore] = useState(false);
  const [found, setFound] = useState<Conv[] | null>(null);
  const [filter, setFilter] = useState('all');
  const [ch, setCh] = useState('all');
  const [qRaw, setQRaw] = useState('');
  const [sort, setSort] = useState<string>(() => 'navbat');
  const [sel, setSel] = useState<number | null>(null);
  const [detail, setDetail] = useState<ConvDetail | null>(null);
  const [fresh, setFresh] = useState<Set<number>>(new Set());
  const [openThread, setOpenThread] = useState(false);
  const [showCard, setShowCard] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  const q = qRaw.trim();
  const serverSearch = q.length >= 2;

  const listRef = useRef<Conv[]>([]);
  const listLoaded = useRef(false);
  const selRef = useRef<number | null>(null);
  const detailRef = useRef<ConvDetail | null>(null);
  const sigRef = useRef('');
  const olderRef = useRef(0);
  const keepRef = useRef<number | null>(null);
  const freshRef = useRef<Set<number>>(new Set());
  const typingSent = useRef(0);
  const composeRef = useRef<HTMLTextAreaElement>(null);
  const polling = useRef(false);
  const archRef = useRef<Conv[] | null>(null);
  const chipsRef = useRef<HTMLDivElement>(null);
  const chipScroll = useRef(false);

  // Saralash tanlovi brauzerda saqlanadi
  useEffect(() => { try { setSort(localStorage.getItem('pb_sort') || 'navbat'); } catch { /* ignore */ } }, []);

  /* ---------- ro‘yxat ---------- */
  const loadList = useCallback(async () => {
    const r = await api<ConvList>('/api/conversations');
    // Yangi mijoz xabari: ro‘yxatda belgi + qisqa bildirishnoma (ochiq turgan suhbatdan tashqari)
    const prev = new Map(listRef.current.map(c => [c.id, c.last_at])), news: string[] = [];
    for (const c of r.items) if (listLoaded.current && c.last_author === 'client' && c.id !== selRef.current && (prev.get(c.id) ?? 0) < c.last_at) { freshRef.current.add(c.id); news.push(c.name); }
    listRef.current = r.items; listLoaded.current = true;
    syncClock(r.now);
    setList(r.items); setArchivedTotal(r.archived_total || 0); setFresh(new Set(freshRef.current));
    if (news.length) toast(`Yangi xabar: ${news.slice(0, 2).join(', ')}${news.length > 2 ? ` va yana ${news.length - 2}` : ''}`);
  }, [syncClock, toast]);

  /* Arxiv: Telegram eksportidan yuklangan eski yozishmalar — 200 tadan, so‘nggisi birinchi */
  const loadArch = useCallback(async (more = false) => {
    const cur = archRef.current;
    const before = more && cur?.length ? cur[cur.length - 1].last_at : '';
    const r = await api<ConvList>(`/api/conversations?arxiv=1${before ? `&before=${before}` : ''}`);
    const next = more ? [...(cur || []), ...r.items] : r.items;
    archRef.current = next;
    setArch(next); setArchMore(Boolean(r.more)); setArchivedTotal(r.archived_total || 0);
  }, []);

  /* 2+ harf — serverdan qidiruv (jonli + arxiv) */
  const searchSeq = useRef(0);
  useEffect(() => {
    setFound(null);
    if (q.length < 2) return;
    const t = setTimeout(async () => {
      const seq = ++searchSeq.current;
      const r = await api<ConvList>(`/api/conversations?q=${encodeURIComponent(q)}`).catch(() => null);
      if (seq !== searchSeq.current) return;
      setFound(r ? r.items : []);
    }, 250);
    return () => { clearTimeout(t); searchSeq.current++; };
  }, [q]);

  /* ---------- ochiq suhbat ---------- */
  const openConv = useCallback(async (id: number, opts: { quiet?: boolean } = {}) => {
    void opts;
    if (selRef.current !== id) { selRef.current = id; sigRef.current = ''; detailRef.current = null; olderRef.current = 0; setSel(id); }
    if (freshRef.current.delete(id)) setFresh(new Set(freshRef.current));
    const d = await api<ConvDetail>(`/api/conversations/${id}${olderRef.current ? `?older=${olderRef.current}` : ''}`);
    if (selRef.current !== id) return;
    syncClock(d.now);
    const sig = JSON.stringify([d.messages.length, d.messages_total, d.messages.at(-1)?.id, d.messages.filter(m => m.meta?.edited_at || m.meta?.deleted_at).map(m => m.id + ':' + (m.meta?.edited_at || '') + (m.meta?.deleted_at || '')).join(','), d.drafts.map(x => x.id + x.status), d.conv, d.effective.mode, d.effective.rollout, d.tasks.length, d.customer.verified]);
    const first = !detailRef.current || detailRef.current.conv.id !== id;
    detailRef.current = d;
    if (first) setOpenThread(true);
    if (first || sig !== sigRef.current) { sigRef.current = sig; setDetail(d); }
  }, [syncClock]);

  /* ---------- hash: #suhbat/ID (app.js onRoute, suhbatlar qismi) ---------- */
  useEffect(() => {
    if (!active) return;
    let dead = false;
    (async () => {
      try {
        await loadList();
        if (dead) return;
        const m = hash.match(/^#suhbat\/(\d+)/);
        if (m) await openConv(Number(m[1]));
        else if (!selRef.current && window.matchMedia('(min-width:821px)').matches && listRef.current[0]) await openConv(listRef.current[0].id);
        else if (!m) setOpenThread(false);
      } catch (e) { if (!isUnauthorized(e)) fail(e); }
    })();
    return () => { dead = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, hash]);

  /* ---------- so‘rov (polling): 3 soniyada bir, yashirin tabda emas ---------- */
  const poll = async () => {
    if (polling.current || document.hidden) return;
    polling.current = true;
    try { await loadList(); if (selRef.current) await openConv(selRef.current, { quiet: true }); }
    catch (e) { if (!isUnauthorized(e)) console.warn(e); }
    finally { polling.current = false; }
  };
  const pollRef = useRef(poll);
  pollRef.current = poll;
  useInterval(() => { void pollRef.current(); }, active ? 3000 : null);
  useEffect(() => {
    if (!active) return;
    const on = () => { void pollRef.current(); };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [active]);

  // «Javobsiz» belgisi (chap menyuda)
  useEffect(() => { setBadge('wait', list.filter(c => c.overdue).length); }, [list, setBadge]);

  /* ---------- chiplar: chetlarda xira, g‘ildirak bilan yonga surish ---------- */
  const chipEdges = useCallback(() => {
    const el = chipsRef.current; if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    el.dataset.more = [el.scrollLeft > 2 ? 'l' : '', el.scrollLeft < max - 2 ? 'r' : ''].join(' ').trim();
  }, []);
  useEffect(() => {
    const el = chipsRef.current; if (!el) return;
    const wheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX) || el.scrollWidth <= el.clientWidth) return;
      el.scrollLeft += e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; e.preventDefault();
    };
    el.addEventListener('scroll', chipEdges, { passive: true });
    el.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('resize', chipEdges);
    return () => { el.removeEventListener('scroll', chipEdges); el.removeEventListener('wheel', wheel); window.removeEventListener('resize', chipEdges); };
  }, [chipEdges]);
  useEffect(() => {
    chipEdges();
    // Tanlangan chip chetda yarim ko‘rinib qolsa — to‘liq ko‘rinadigan joyga suriladi
    if (chipScroll.current) {
      chipScroll.current = false;
      const el = chipsRef.current, c = el?.querySelector('[aria-pressed="true"]');
      if (el && c) {
        const r = c.getBoundingClientRect(), b = el.getBoundingClientRect(), pad = 28;
        if (r.left < b.left + pad) el.scrollBy({ left: r.left - b.left - pad, behavior: 'smooth' });
        else if (r.right > b.right - pad) el.scrollBy({ left: r.right - b.right + pad, behavior: 'smooth' });
      }
    }
  });

  /* ---------- filtrlar ---------- */
  const passBase = (c: Conv) => {
    if (ch !== 'all' && c.channel !== ch) return false;
    if (q && !serverSearch && !(`${c.name} ${c.handle || ''} ${c.last_text}`.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  };
  const passF = (c: Conv, f: string) => {
    if (f === 'all') return true;
    if (f === 'wait') return Boolean(c.pending_since);
    if (f === 'ai') return Boolean(c.ai_due_at) || c.draft?.status === 'preparing' || c.draft?.status === 'ready';
    if (f === 'mine') return c.taken_by === me.name || c.owner === me.name;
    if (f === 'big') return Boolean(c.big_order);
    if (f === 'demo') return Boolean(c.is_demo);
    if (f === 'arxiv') return true;
    return false;
  };

  const srcIsList = !serverSearch && filter !== 'arxiv';
  const srcIsArch = !serverSearch && filter === 'arxiv' && arch !== null;
  const src = serverSearch ? (found || []) : filter === 'arxiv' ? (arch || []) : list;
  const items = src.filter(c => passBase(c) && (!srcIsList || passF(c, filter)));
  // «Yangilari yuqorida» — Telegram’dagidek oxirgi xabar bo‘yicha; aks holda navbat
  if (srcIsList && sort === 'yangi') items.sort((a, b) => (b.last_at || 0) - (a.last_at || 0));
  const emptyText = serverSearch ? (found ? 'Hech narsa topilmadi.' : 'Qidirilmoqda…') : srcIsArch ? (arch ? 'Arxiv bo‘sh.' : 'Yuklanmoqda…')
    : list.length ? 'Bu filtrda suhbat yo‘q.' : 'Hozircha suhbat yo‘q. Telegram Business ulanganda mijoz xabarlari shu yerga keladi.';
  const sortNote = serverSearch ? 'Qidiruv: ism, @username, telefon va xabar matni — jonli va arxivdan' : filter === 'arxiv' ? 'Arxiv: Telegram eksportidan yuklangan eski yozishmalar, so‘nggisi birinchi'
    : sort === 'yangi' ? 'Oxirgi xabar bo‘yicha — yangilari yuqorida' : 'Navbat: javob kutayotganlar, katta buyurtmalar, kutish vaqti';

  /* ---------- yozish maydoni ---------- */
  const typing = (on: boolean) => {
    if (!selRef.current) return;
    if (on && Date.now() - typingSent.current < 4000) return;
    typingSent.current = on ? Date.now() : 0;
    api(`/api/conversations/${selRef.current}/typing`, { typing: on }).catch(() => {});
  };
  const sendCompose = async (replyTo: number | null = null, editId: number | null = null): Promise<boolean> => {
    const t = composeRef.current; if (!t) return false;
    const text = t.value.trim(); if (!text) return false;
    const id = selRef.current; if (id == null) return false;
    try {
      const r = await (editId
        ? api<{ ok?: boolean; why?: string }>(`/api/messages/${editId}/edit`, { text })
        : api<{ ok?: boolean; why?: string }>(`/api/conversations/${id}/send`, { text, reply_to: replyTo })).catch(e => ({ ok: false, why: errorText(e) }));
      if (!r.ok) { toast(r.why || 'Yuborilmadi'); return false; }
      t.value = ''; autoGrow(t); typing(false);
      await openConv(id);
      return true;
    } catch (e) { fail(e); return false; }
  };
  /* Fayl / rasm / ovoz: brauzerda base64 ga o‘tkazilib JSON bilan yuboriladi (15 MB gacha) */
  const sendFile = async (file: Blob, o: { name?: string; voice?: boolean; caption?: string; replyTo?: number | null } = {}): Promise<boolean> => {
    const id = selRef.current; if (id == null) return false;
    if (file.size > 15e6) { toast('Fayl 15 MB dan katta'); return false; }
    try {
      const data: string = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result)); fr.onerror = () => rej(fr.error); fr.readAsDataURL(file); });
      const r = await api<{ ok?: boolean; why?: string }>(`/api/conversations/${id}/file`, { name: o.name || (file as File).name || 'fayl', type: file.type, data, voice: o.voice, caption: o.caption, reply_to: o.replyTo })
        .catch(e => ({ ok: false, why: errorText(e) }));
      if (!r.ok) { toast(r.why || 'Yuborilmadi'); return false; }
      await openConv(id);
      return true;
    } catch (e) { fail(e); return false; }
  };

  /* ---------- amallar ---------- */
  const act = async (name: string, aid?: number, extra?: string) => {
    if (name === 'back') { setOpenThread(false); navigate('#suhbatlar'); return; }
    if (name === 'card') { setShowCard(v => !v); return; }
    const id = selRef.current;
    if (id == null) return;
    try {
      if (name === 'older') { olderRef.current = (olderRef.current || 0) + 1; await openConv(id); return; }
      if (name === 'clear') {
        if (!confirm('Bu suhbatdagi barcha xabarlar paneldan VA mijozning Telegram chatidan o‘chiriladi (Instagram xabarni o‘chirishga ruxsat bermaydi — u yerda qoladi). Suhbat va mijoz kartasi qoladi. Qaytarib bo‘lmaydi.\n\nDavom etasizmi?')) return;
        const r = await api<{ messages: number; channel?: number; failed?: number; why?: string }>(`/api/conversations/${id}/clear`, {});
        toast(`Tarix tozalandi: ${r.messages} ta xabar${r.channel ? ` · kanalda ham o‘chdi (${r.channel})` : ''}${r.failed ? ` · kanalda o‘chmadi: ${r.why || r.failed}` : ''}`); return await openConv(id);
      }
      if (name === 'delete') {
        if (!confirm('Suhbat butunlay o‘chiriladi (xabarlar, qoralamalar, topshiriqlar) va xabarlar mijozning Telegram chatidan ham o‘chadi (Instagram’da qoladi). Qaytarib bo‘lmaydi. Mijoz yana yozsa — yangi suhbat ochiladi.\n\nO‘chirilsinmi?')) return;
        const dr = await api<{ channel?: number; failed?: number; why?: string }>(`/api/conversations/${id}/delete`, {}); toast(`Suhbat o‘chirildi${dr.failed ? ` · kanalda o‘chmadi: ${dr.why || dr.failed}` : ''}`);
        selRef.current = null; detailRef.current = null; sigRef.current = '';
        setSel(null); setDetail(null); setOpenThread(false);
        return await loadList();
      }
      if (name === 'delmsg') {
        if (!confirm('Xabar o‘chiriladi (Telegram’da mijozda ham). Qaytarib bo‘lmaydi. Davom etasizmi?')) return;
        const r = await api<{ ok?: boolean; why?: string }>(`/api/messages/${aid}/delete`, {}).catch(e => ({ ok: false, why: errorText(e) }));
        if (!r.ok) return toast(r.why || 'O‘chirilmadi');
      }
      if (name === 'take') { await api(`/api/conversations/${id}/take`, {}); toast('Suhbat sizda. AI to‘xtadi.'); }
      if (name === 'release') { await api(`/api/conversations/${id}/release`, {}); toast('Suhbat AI’ga qaytarildi.'); }
      if (name === 'approve') { const r = await api<{ ok?: boolean; why?: string }>(`/api/drafts/${aid}/approve`, {}); if (!r.ok) return toast(r.why || 'Yuborilmadi'); toast('Yuborildi', 'ai'); }
      if (name === 'cancelDraft') { await api(`/api/drafts/${aid}/cancel`, {}); }
      if (name === 'rate') { await api(`/api/drafts/${aid}/rate`, { rating: extra }); toast('Baho saqlandi'); }
      if (name === 'teach') {
        const d = detailRef.current;
        const dr = d?.drafts.find(x => x.id === aid);
        const qm = d ? [...d.messages].reverse().find(m => m.author === 'client' && m.created_at <= (dr?.created_at || Infinity)) : undefined;
        openModal({
          content: <TeachContent question={qm?.text || ''} answer={dr?.text || ''} />,
          onSubmit: async dd => { await api('/api/answers', { question: dd.question, answer: dd.answer, source: 'draft' }); toast('Saqlandi — agent endi shunday javob beradi'); }
        });
        return;
      }
      if (name === 'edit') { const dr = detailRef.current?.drafts.find(x => x.id === aid); const t = composeRef.current; if (!t) return; t.value = dr?.text || ''; t.focus(); autoGrow(t); typing(true); return; }
      if (name === 'photo') {
        const { items: prods } = await api<{ items: PickProduct[] }>('/api/pick/products');
        const withPhoto = prods.filter(x => x.has_photo);
        if (!withPhoto.length) {
          openModal({ content: <><h2>Tovar rasmi</h2><div className="banner warn"><div>Hali birorta tovarda rasm yo‘q.
        Rasm BILLZ kartasiga yuklansa, sinxrondan keyin shu yerda chiqadi.</div></div></> });
          return;
        }
        openModal({ content: <PhotoPicker items={withPhoto} convId={id} onSent={() => { void openConv(id).catch(fail); }} /> });
        return;
      }
      if (name === 'send') return await sendCompose();
      if (name === 'taskDone') { await api(`/api/tasks/${aid}/done`, {}); }
      if (name === 'simulate') {
        const text = prompt('Mijoz nomidan xabar (demo akkaunt):'); if (!text) return;
        await api('/api/demo/client', { conversation_id: id, text });
      }
      if (name === 'lost') {
        const c = detailRef.current?.conv;
        const reason = prompt('Yo‘qotish sababi (narx / mavjud emas / kech javob / raqobatchidan oldi / boshqa). Bo‘sh qoldirsangiz — olib tashlanadi:', c?.lost_reason || '');
        if (reason === null) return;
        const evidence = reason ? prompt('Dalil (mijozning so‘zi, sana). Jim qolish raqobatchiga ketdi degani emas:', c?.lost_evidence || '') : '';
        if (reason && !evidence) return toast('Yo‘qotish sababi uchun dalil yozing.');
        await api(`/api/conversations/${id}/card`, { lost: reason || null, lost_evidence: evidence });
      }
      if (name === 'editCard') {
        const c = detailRef.current?.conv; if (!c) return;
        openModal({
          content: <EditCardContent c={c} />,
          onSubmit: async data => { await api(`/api/conversations/${selRef.current}/card`, data); toast('Saqlandi'); void openConv(selRef.current as number).catch(fail); }
        });
        return;
      }
      await loadList();
      await openConv(id);
    } catch (err) { fail(err); }
  };

  const onHeat = async (h: Heat) => {
    const id = selRef.current; if (id == null) return;
    await api(`/api/conversations/${id}/card`, { heat: h }).catch(fail);
    openConv(id).catch(fail);
  };
  const onStage = async (stage: number) => {
    const id = selRef.current; if (id == null) return;
    const body: Record<string, unknown> = { stage };
    if (stage === 5) { if (!confirm('«Xarid tasdiqlandi» — BILLZ cheki bor yoki xodim sifatida tasdiqlaysizmi?')) return; body.confirm_purchase = true; }
    await api(`/api/conversations/${id}/card`, body).catch(fail);
    openConv(id).catch(fail);
  };
  const onMode = async (v: string) => {
    const id = selRef.current; if (id == null) return;
    await api(`/api/conversations/${id}/mode`, { mode: v }).catch(fail);
    toast('Avtojavob rejimi o‘zgardi'); openConv(id).catch(fail);
  };

  const onRootClick = (e: MouseEvent<HTMLDivElement>) => {
    // Ochiq «⋯» menyusi: tashqariga yoki biror amalga bosilganda yopiladi
    if (!(e.target as HTMLElement).closest('[data-act="menu"]')) setMenuOpen(false);
  };

  return (
    <div className={`inbox-wrap${openThread ? ' open-thread' : ''}`}>
    <PageHead route="suhbatlar" />
    <div className={`inbox${openThread ? ' open-thread' : ''}${showCard ? ' show-card' : ''}`} id="inbox" onClick={onRootClick}>
      <div className="pane list-pane">
        <div className="list-head">
          <label className="search"><span data-ic="search"><Icon name="search" /></span><input id="q" type="search" placeholder="Ism, @akkaunt yoki mahsulot" autoComplete="off" value={qRaw} onChange={e => setQRaw(e.target.value)} /></label>
          <div className="seg" id="chSeg" role="group" aria-label="Kanal">
            <button type="button" data-ch="tg" aria-pressed={ch === 'tg'} title="Faqat Telegram (qayta bosilsa — hammasi)" aria-label="Faqat Telegram" onClick={() => setCh(c => c === 'tg' ? 'all' : 'tg')}><span data-brand="tg"><Brand ch="tg" /></span></button>
            <button type="button" data-ch="ig" aria-pressed={ch === 'ig'} title="Faqat Instagram (qayta bosilsa — hammasi)" aria-label="Faqat Instagram" onClick={() => setCh(c => c === 'ig' ? 'all' : 'ig')}><span data-brand="ig"><Brand ch="ig" /></span></button>
          </div>
          <div className="chips" id="fChips" ref={chipsRef}>
            {FILTERS.filter(([k]) => (k !== 'demo' || boot.demo) && (k !== 'arxiv' || archivedTotal)).map(([k, l]) => {
              const n = k === 'arxiv' ? archivedTotal.toLocaleString('ru-RU') : list.filter(c => passBase(c) && passF(c, k)).length;
              return <button key={k} className="chip" type="button" data-f={k} aria-pressed={filter === k} onClick={() => { setFilter(k); chipScroll.current = true; if (k === 'arxiv' && !archRef.current) loadArch().catch(fail); }}>{l}<span className="c">{n}</span></button>;
            })}
          </div>
          <div className="sort-note"><span id="sortNote" title={sortNote}>{sortNote}</span>
            <button type="button" className="linkbtn" id="sortBtn" hidden={serverSearch || filter === 'arxiv'} onClick={() => { const s = sort === 'yangi' ? 'navbat' : 'yangi'; setSort(s); try { localStorage.setItem('pb_sort', s); } catch { /* ignore */ } }}>{sort === 'yangi' ? 'Navbat tartibi' : 'Yangilari yuqorida'}</button></div>
        </div>
        <div className="conv-list" id="convList">
          <ConvItems items={items} showArchMore={srcIsArch && archMore && !serverSearch} emptyText={emptyText} sel={sel} fresh={fresh} meId={me.id}
            onOpen={id => navigate(`#suhbat/${id}`)} onArchMore={() => { loadArch(true).catch(fail); }} />
        </div>
      </div>
      <div className="pane thread-pane" id="thread">
        {detail
          ? <Thread key={detail.conv.id} d={detail} isLead={isLead} role={me.role} menuOpen={menuOpen} onMenu={() => setMenuOpen(v => !v)} onAct={act} onMode={onMode}
              composeRef={composeRef} onCompose={() => { const t = composeRef.current; if (t) { autoGrow(t); typing(t.value.trim().length > 0); } }} onSend={sendCompose} onFile={sendFile} keepRef={keepRef} />
          : <div className="empty-state">Suhbatni tanlang.</div>}
      </div>
      <aside className="pane card-pane" id="card" aria-label="Mijoz kartasi">
        {detail ? <CustomerCard d={detail} stages={boot.stages} onAct={act} onHeat={onHeat} onStage={onStage} /> : null}
      </aside>
    </div>
    </div>
  );
}
