'use client';
import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { fmtDT, money } from '@/lib/format';
import { shrinkImage } from '@/lib/image';
import { Icon } from './ui';
import { useApp } from './AppContext';
import { Select } from './Select';

interface Billz { price: number | null; source: string; stale?: boolean; stock_total: number; stock_store: number; stock_warehouse: number; stock_by_branch?: Record<string, number>; warehouses?: string[] }
interface Product {
  id: number; name: string; status: string; category?: string; billz: Billz; sold90?: number; has_photo?: boolean; photo_from?: string;
  specs?: string; compat?: string; limits?: string; kit?: string; brand?: string; sources?: string[];
}
interface ProdResp { items: Product[]; total: number; verified: number }
interface Answer { id: number; question: string; answer: string; active: number | boolean; source: string; author?: string; updated_at?: number; created_at: number }
interface Knowledge { id: number; title: string; body: string; active: number | boolean; author?: string; updated_at: number }
interface AskResp { ok: boolean; text?: string; sources?: string[]; why?: string }

type CatTab = 'prod' | 'ans' | 'kn';
const SRC_L: Record<string, string> = { panel: 'panel', telegram: 'Telegram /tuzat', draft: 'AI qoralamasidan', hujjat: 'hujjatdan', import: 'importdan' };
const KN_TEMPLATES = ['Kafolat', 'Yetkazib berish', 'To‘lov usullari', 'Keshbek', 'Manzillar va ish vaqti', 'Qaytarish va almashtirish', 'Muddatli to‘lov'];

/* Qoldiq: do‘konlar (darhol) va ombor alohida; filial bo‘yicha batafsil */
function StockLine({ b }: { b: Billz }) {
  if (!b.stock_total) return <span className="pill">qoldiq yo‘q</span>;
  const per = Object.entries(b.stock_by_branch || {}).filter(([, q]) => q > 0);
  return (
    <>
      {b.stock_store ? <span className="pill ok">do‘konda {b.stock_store}</span> : null}
      {b.stock_warehouse ? <span className={`pill ${b.stock_store ? '' : 'warn'}`}>omborda {b.stock_warehouse}</span> : null}
      {' '}
      <span className="muted" style={{ fontSize: 12 }}>
        {per.map(([n, q], i) => (
          <Fragment key={n}>{i ? ' · ' : ''}{n} {q}{(b.warehouses || []).includes(n) ? <> <span className="muted">(ombor)</span></> : null}</Fragment>
        ))}
      </span>
    </>
  );
}

function TextField({ k, l, v, ta, pre }: { k: string; l: string; v?: string; ta?: boolean; pre: string }) {
  return (
    <label className={`field ${ta ? 'wide' : ''}`}><span>{l}</span>
      {ta ? <textarea name={k} id={`${pre}${k}`} defaultValue={v || ''} /> : <input name={k} id={`${pre}${k}`} defaultValue={v || ''} />}
    </label>
  );
}

/* Mahsulot kartasi formasi (tahrirlash / yangi) */
function ProductForm({ p, ed }: { p: Partial<Product>; ed: boolean }) {
  const { toast } = useApp();
  const [f, setF] = useState({ specs: p.specs || '', kit: p.kit || '', compat: p.compat || '', limits: p.limits || '', sources: (p.sources || []).join('\n') });
  const [busy, setBusy] = useState(false);
  const area = (k: 'specs' | 'kit' | 'compat' | 'limits', l: string) => (
    <label className="field wide"><span>{l}</span><textarea name={k} id={`p_${k}`} value={f[k]} onChange={e => setF(s => ({ ...s, [k]: e.target.value }))} /></label>
  );
  const research = async () => {
    setBusy(true);
    const r = await api<{ ok: boolean; why?: string; card: Record<string, string> & { sources?: string[] } }>(`/api/products/${p.id}/research`, {}).catch(e => ({ ok: false, why: (e as Error).message, card: {} as Record<string, string> & { sources?: string[] } }));
    setBusy(false);
    if (!r.ok) return toast(r.why || 'Topilmadi');
    setF(s => ({
      specs: r.card.specs || s.specs, kit: r.card.kit || s.kit, compat: r.card.compat || s.compat, limits: r.card.limits || s.limits,
      sources: (r.card.sources || []).join('\n')
    }));
    toast('Qoralama to‘ldirildi — tekshirib «Saqlash» bosing', 'ai');
  };
  return (
    <>
      <h2>{ed ? 'Kartani tahrirlash' : 'Yangi karta'}</h2>
      <div className="form-grid">
        <TextField k="name" l="Nomi (aniq model)" v={p.name} pre="p_" /><TextField k="brand" l="Brend" v={p.brand} pre="p_" /><TextField k="category" l="Toifa" v={p.category} pre="p_" /><span></span>
        {area('specs', 'Asosiy xususiyatlar')}{area('kit', 'To‘plam tarkibi')}{area('compat', 'Moslik (ulanish, mount, format)')}{area('limits', 'Cheklovlar')}
        <label className="field wide"><span>Manbalar (har qatorda bittasi: havola yoki hujjat, tekshirilgan sana)</span>
          <textarea name="sources" id="p_sources" value={f.sources} onChange={e => setF(s => ({ ...s, sources: e.target.value }))} /></label>
      </div>
      {ed ? <div className="row-actions"><button className="btn sm ai" type="button" id="p_research" disabled={busy} onClick={research}>{busy ? 'Qidirilmoqda… (1–2 daqiqa)' : 'Katalog agenti bilan to‘ldirish'}</button><span className="muted" style={{ fontSize: 12 }}>Ishlab chiqaruvchi manbasidan qoralama. Siz tekshirib saqlaysiz va tasdiqlaysiz.</span></div> : null}
    </>
  );
}

export function Catalog({ active }: { active: boolean }) {
  const { boot, toast, fail, openModal, catalogSeed, setCatalogSeed } = useApp();
  const canEdit = boot.me.role !== 'sotuvchi';
  const branches = boot.branches || [];
  const [tab, setTab] = useState<CatTab>('prod');
  const [qInput, setQInput] = useState('');
  const [prodQ, setProdQ] = useState('');
  const [stock, setStock] = useState('all');
  const [status, setStatus] = useState('all');
  const [branch, setBranch] = useState('');
  const [limit, setLimit] = useState(60);
  const [prod, setProd] = useState<ProdResp | null>(null);
  const [answers, setAnswers] = useState<Answer[] | null>(null);
  const [know, setKnow] = useState<Knowledge[] | null>(null);
  const [reload, setReload] = useState(0);
  const [askQ, setAskQ] = useState('');
  const [askBusy, setAskBusy] = useState(false);
  const [askOut, setAskOut] = useState<null | { loading?: boolean; res?: AskResp }>(null);
  const [ansQ, setAnsQ] = useState('');
  const [ansA, setAnsA] = useState('');
  const [photoBusy, setPhotoBusy] = useState<number | null>(null);
  const seq = useRef(0);
  const refresh = useCallback(() => setReload(n => n + 1), []);

  // «Kartani to‘ldirish» (Qayta sotuv) dan kelgan qidiruv
  useEffect(() => {
    if (active && catalogSeed) {
      setQInput(catalogSeed.q); setProdQ(catalogSeed.q); setStatus(catalogSeed.status); setLimit(60);
      setCatalogSeed(null);
    }
  }, [active, catalogSeed, setCatalogSeed]);

  // Qidiruv: 300 ms kutiladi
  useEffect(() => {
    if (qInput.trim() === prodQ) return;
    const id = setTimeout(() => { setProdQ(qInput.trim()); setLimit(60); }, 300);
    return () => clearTimeout(id);
  }, [qInput, prodQ]);

  // Ma’lumot: bo‘lim ochilganda va filtr/tab/amaldan keyin
  useEffect(() => {
    if (!active) return;
    const my = ++seq.current;
    (async () => {
      try {
        if (tab === 'ans') { const r = await api<{ items: Answer[] }>('/api/answers'); if (my === seq.current) setAnswers(r.items); }
        else if (tab === 'kn') { const r = await api<{ items: Knowledge[] }>('/api/knowledge'); if (my === seq.current) setKnow(r.items); }
        else {
          const qs = new URLSearchParams({ ...(prodQ ? { q: prodQ } : {}), stock, status, ...(branch ? { branch } : {}), limit: String(limit) });
          const r = await api<ProdResp>('/api/products?' + qs);
          if (my === seq.current) setProd(r);
        }
      } catch (e) { fail(e); }
    })();
  }, [active, tab, prodQ, stock, status, branch, limit, reload, fail]);

  const tabs = (n?: { ans?: number }) => (
    <div className="tabs" role="tablist" style={{ marginBottom: 6 }}>
      {([['prod', 'Mahsulot kartalari'], ['ans', `Tasdiqlangan javoblar${n?.ans != null ? ` (${n.ans})` : ''}`], ['kn', 'Do‘kon ma’lumoti']] as const).map(([k, l]) => (
        <button key={k} type="button" role="tab" aria-selected={tab === k} data-ctab={k} onClick={() => setTab(k)}>{l}</button>
      ))}
    </div>
  );

  /* ---------- tasdiqlangan javoblar ---------- */
  if (tab === 'ans') {
    const items = answers || [];
    const on = items.filter(x => x.active), off = items.filter(x => !x.active);
    const editAns = (a: Answer) => openModal({
      content: <>
        <h2>Javobni tahrirlash #{a.id}</h2>
        <label className="field"><span>Mijoz savoli</span><textarea name="question" id="ae_q" required defaultValue={a.question} /></label>
        <label className="field"><span>To‘g‘ri javob</span><textarea name="answer" id="ae_a" required style={{ minHeight: 110 }} defaultValue={a.answer} /></label>
      </>,
      onSubmit: async d => { await api('/api/answers', { id: a.id, question: d.question, answer: d.answer }); toast('Saqlandi'); refresh(); }
    });
    const toggle = async (a: Answer) => { await api(`/api/answers/${a.id}/active`, { on: !a.active }).catch(fail); refresh(); };
    const card = (a: Answer) => (
      <div className={`ans${a.active ? '' : ' off'}`} key={a.id}>
        <div className="ans-q"><span className="muted mono">#{a.id}</span> {a.question}</div>
        <div className="ans-a">{a.answer}</div>
        <div className="ans-meta muted"><span className={`pill ${a.active ? 'ok' : ''}`}>{a.active ? 'faol' : 'o‘chiq'}</span>{SRC_L[a.source] || a.source} · {a.author || '—'} · <span className="mono">{fmtDT(a.updated_at || a.created_at)}</span>
          {canEdit ? <span className="row-actions" style={{ marginLeft: 'auto' }}><button className="btn sm ghost" type="button" onClick={() => editAns(a)}>Tahrirlash</button>
            <button className="btn sm ghost" type="button" onClick={() => toggle(a)}>{a.active ? 'O‘chirish' : 'Qayta yoqish'}</button></span> : null}</div>
      </div>
    );
    const save = async () => {
      const question = ansQ.trim(), answer = ansA.trim();
      if (!question || !answer) return toast('Savol va javobni yozing');
      await api('/api/answers', { question, answer }).then(() => { toast('Saqlandi — agent endi shunday javob beradi'); refresh(); }).catch(fail);
    };
    return (
      <>
        {tabs({ ans: on.length })}
        <p className="lead">Rahbar tasdiqlagan savol-javoblar. Mijoz shu savolni yoki mazmunan o‘xshashini bersa, agent <b>aynan shu mazmunda</b> javob beradi — bu javoblar agentning umumiy bilimidan ustun. Narx va qoldiq baribir BILLZ’dan olinadi.
          Telegram’dan ham qo‘shish mumkin: botga <span className="mono">/tuzat Savol =&gt; Javob</span>. Suhbatdagi AI qoralamasi ostidagi «O‘rgatish» tugmasi ham shu yerga yozadi.</p>
        {canEdit ? <div className="panel"><div className="panel-head"><h2>Yangi javob</h2></div>
          <label className="field"><span>Mijoz savoli</span><textarea id="ansQ" placeholder="Masalan: Yetkazib berasizmi?" value={ansQ} onChange={e => setAnsQ(e.target.value)} /></label>
          <label className="field"><span>To‘g‘ri javob</span><textarea id="ansA" style={{ minHeight: 90 }} placeholder="Agent shu mazmunda javob beradi" value={ansA} onChange={e => setAnsA(e.target.value)} /></label>
          <div className="row-actions"><button className="btn primary" type="button" id="ansSave" onClick={save}>Saqlash</button></div></div> : null}
        <div className="panel"><div className="panel-head"><h2>Faol javoblar</h2><span className="pill acc">{on.length}</span></div>
          <div className="ans-list">{on.length ? on.map(card) : <span className="muted">Hozircha yo‘q. Birinchi javobni yuqorida qo‘shing.</span>}</div></div>
        {off.length ? <details className="panel"><summary>O‘chirilganlar ({off.length})</summary><div className="ans-list">{off.map(card)}</div></details> : null}
      </>
    );
  }

  /* ---------- do‘kon ma’lumoti ---------- */
  if (tab === 'kn') {
    const rows = know || [];
    const have = new Set(rows.map(k => k.title.toLowerCase()));
    const isDraft = (k: Knowledge) => !k.active && /^Yozishmalardan/.test(k.author || '');
    const items = [...rows.filter(isDraft), ...rows.filter(k => !isDraft(k))], drafts = items.filter(isDraft).length;
    const editKn = (k: { id?: number; title: string; body: string; active: number | boolean }) => openModal({
      content: <>
        <h2>{k.id ? 'Bo‘limni tahrirlash' : 'Yangi bo‘lim'}</h2>
        <label className="field"><span>Sarlavha</span><input name="title" id="kn_t" defaultValue={k.title} required /></label>
        <label className="field"><span>Matn — agent shuni aytadi</span><textarea name="body" id="kn_b" required style={{ minHeight: 160 }} placeholder="Masalan: Barcha tovarlarga rasmiy kafolat 12 oy. Kafolat bo‘yicha murojaat — chek bilan istalgan filialga." defaultValue={k.body} /></label>
        {k.id ? <label className="field"><span>Holat</span><Select name="active" id="kn_a" defaultValue={k.active ? '1' : '0'}><option value="1">faol</option><option value="0">o‘chirilgan</option></Select></label> : null}
      </>,
      onSubmit: async d => { await api('/api/knowledge', { id: k.id, title: d.title, body: d.body, active: d.active !== '0' }); toast('Saqlandi'); refresh(); }
    });
    const approve = async (k: Knowledge, b: HTMLButtonElement) => {
      b.disabled = true;
      await api('/api/knowledge', { id: k.id, title: k.title, body: k.body, active: true }).catch(fail);
      toast('Tasdiqlandi — agent endi shu ma’lumotdan foydalanadi'); refresh();
    };
    return (
      <>
        {tabs()}
        <p className="lead">Do‘kon qoidalari — agent shu yerda yozilgan narsani mijozga aytadi, yozilmaganini <b>va’da qilmaydi</b> va sotuvchiga uzatadi. Kafolat, yetkazish, to‘lov va keshbek shartlarini shu yerga yozing.</p>
        {canEdit ? <div className="row-actions" style={{ flexWrap: 'wrap' }}>{KN_TEMPLATES.filter(t => !have.has(t.toLowerCase())).map(t => <button className="btn sm" type="button" key={t} onClick={() => editKn({ title: t, body: '', active: 1 })}>+ {t}</button>)}
          <button className="btn sm ghost" type="button" onClick={() => editKn({ title: '', body: '', active: 1 })}>+ Boshqa bo‘lim</button></div> : null}
        {drafts ? <div className="note">{drafts} ta bo‘lim Sun HighTech’ning eski yozishmalaridan tayyorlandi (sotuvchi ko‘p marta yozgan javoblar asosida). Tekshiring, kerak bo‘lsa tahrirlang va <b>«Tasdiqlash»</b> ni bosing — shundan keyingina agent ulardan foydalanadi. «[Tekshiring: …]» qatorlari agentga berilmaydi.</div> : null}
        <div className="ans-list">{items.map(k => {
          const draft = !k.active && /^Yozishmalardan/.test(k.author || '');
          return (
            <div className={`panel${k.active || draft ? '' : ' off'}`} key={k.id}><div className="panel-head"><h2>{k.title}</h2>{k.active ? <span className="pill ok">faol</span> : draft ? <span className="pill acc">Qoralama · tasdiq kutmoqda</span> : <span className="pill">o‘chirilgan</span>}
              <span className="muted" style={{ marginLeft: 'auto' }}>{k.author || '—'} · <span className="mono">{fmtDT(k.updated_at)}</span></span>{canEdit && draft ? <button className="btn sm primary" type="button" onClick={e => approve(k, e.currentTarget)}>Tasdiqlash</button> : null}{canEdit ? <button className="btn sm ghost" type="button" onClick={() => editKn(k)}>Tahrirlash</button> : null}</div>
              <div className="kn-body">{k.body.split('\n').map((l, i) => <Fragment key={i}>{i ? '\n' : ''}{/^\s*\[tekshiring/i.test(l) ? <span className="kn-check">{l}</span> : l}</Fragment>)}</div></div>
          );
        })}{items.length ? null : <div className="panel muted">Hali bo‘lim yo‘q — yuqoridagi tugmalardan birini bosib boshlang.</div>}</div>
      </>
    );
  }

  /* ---------- mahsulot kartalari ---------- */
  const r = prod;
  const ask = async () => {
    const q = askQ.trim(); if (!q) return;
    setAskOut({ loading: true }); setAskBusy(true);
    const res = await api<AskResp>('/api/catalog/ask', { q }).catch(err => ({ ok: false, why: (err as Error).message } as AskResp));
    setAskBusy(false); setAskOut({ res });
  };
  const verify = async (p: Product) => { await api(`/api/products/${p.id}/verify`, { on: p.status !== 'verified' }).catch(fail); refresh(); };
  const photoWeb = async (p: Product) => {
    setPhotoBusy(p.id);
    const res = await api<{ ok: boolean; source?: string; why?: string }>(`/api/products/${p.id}/photo/web`, {}).catch(err => ({ ok: false, why: (err as Error).message } as { ok: boolean; source?: string; why?: string }));
    setPhotoBusy(null);
    toast(res.ok ? `Rasm topildi: ${res.source ? new URL(res.source).hostname : ''}` : `Topilmadi: ${res.why || ''}`);
    refresh();
  };
  const photoDel = async (p: Product) => {
    if (!confirm('Rasmni olib tashlaysizmi? (noto‘g‘ri bo‘lsa)')) return;
    await api(`/api/products/${p.id}/photo/remove`, {}).catch(fail);
    toast('Rasm olib tashlandi'); refresh();
  };
  const photoUp = (p: Product) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/jpeg,image/png';
    inp.onchange = async () => {
      const file = inp.files?.[0]; if (!file) return;
      toast('Rasm yuklanmoqda…');
      try {
        const data = await shrinkImage(file);
        const res = await api<{ ok: boolean; why?: string }>(`/api/products/${p.id}/photo`, { data });
        if (!res.ok) return toast(res.why || 'Yuklanmadi');
        toast('Rasm saqlandi — AI endi shu rasmni mijozga yubora oladi');
        refresh();
      } catch (err) { fail(err); }
    };
    inp.click();
  };
  const editProduct = async (id?: number) => {
    let p: Partial<Product> = { sources: [] };
    if (id != null) { try { p = (await api<{ item: Product }>(`/api/products/${id}`)).item; } catch (e) { return fail(e); } }
    const ed = id != null;
    openModal({
      content: <ProductForm p={p} ed={ed} />,
      onSubmit: async d => {
        await api('/api/products', { ...d, id: p.id, sources: String(d.sources || '').split('\n').map(s => s.trim()).filter(Boolean) });
        toast(ed ? 'Saqlandi (mazmun o‘zgargan bo‘lsa — qayta tasdiqlang)' : 'Karta qo‘shildi'); refresh();
      }
    });
  };

  return (
    <>
      {tabs()}
      <p className="lead">Agent narx va qoldiqni faqat BILLZ’dan, xususiyat va moslikni faqat shu kartalardan oladi. <b>Tasdiqlanmagan</b> karta bo‘yicha agent moslik va’da qilmaydi — sotuvchiga uzatadi. Mazmun o‘zgarsa, tasdiq qaytadan kerak bo‘ladi.</p>
      <div className="panel"><div className="panel-head"><h2>Sotuvchi savoli</h2><span className="muted">Katalog agenti ichki javob beradi — manbasi bilan. Mijozga yuborilmaydi</span></div>
        <div className="row-actions"><input id="askQ" type="text" style={{ flex: 1, minWidth: 220 }} placeholder="Masalan: Sennheiser EW 112P G4 ni Canon R50 ga ulasa bo‘ladimi?" value={askQ} onChange={e => setAskQ(e.target.value)} />
          <button className="btn primary" type="button" id="askBtn" disabled={askBusy} onClick={ask}>So‘rash</button></div>
        <div id="askOut" className="note" hidden={!askOut}>
          {askOut?.loading ? 'Katalog agenti javob tayyorlamoqda…' : askOut?.res?.ok
            ? <>{(askOut.res.text || '').split('\n').map((l, i) => <Fragment key={i}>{i ? <br /> : null}{l}</Fragment>)}{askOut.res.sources?.length ? <><br /><span className="muted" style={{ fontSize: 12 }}>Manba: {askOut.res.sources.join(' · ')}</span></> : null}</>
            : askOut?.res ? <span className="muted">Javob bo‘lmadi: {askOut.res.why || 'xato'}</span> : null}
        </div></div>
      <div className="row-actions filters prod-filters"><label className="search" style={{ flex: 1, minWidth: 220, maxWidth: 420 }}><span><Icon name="search" /></span><input id="prodQ" type="search" value={qInput} onChange={e => setQInput(e.target.value)} placeholder="Model, brend, toifa yoki shtrixkod" /></label>
        <label className="field" style={{ minWidth: 190 }}><span className="sr-only">Holat</span><Select id="pfStatus" aria-label="Karta holati bo‘yicha filtr" value={status} onChange={e => { setStatus(e.target.value); setLimit(60); }}>
          {[['all', 'Barcha kartalar'], ['queue', 'Tekshirish navbati'], ['draft', 'Tasdiqlanmagan'], ['verified', 'Tasdiqlangan']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></label>
        <label className="field" style={{ minWidth: 170 }}><span className="sr-only">Qoldiq</span><Select id="pfStock" aria-label="Qoldiq bo‘yicha filtr" value={stock} onChange={e => { setStock(e.target.value); setLimit(60); }}>
          {[['all', 'Hammasi'], ['store', 'Do‘konda bor'], ['warehouse', 'Faqat omborda'], ['none', 'Qoldiq yo‘q']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></label>
        <label className="field" style={{ minWidth: 190 }}><span className="sr-only">Filial</span><Select id="pfBranch" aria-label="Filial bo‘yicha filtr" value={branch} onChange={e => { setBranch(e.target.value); setLimit(60); }}><option value="">Barcha filiallar</option>
          {branches.map(b => <option key={b.id} value={b.name}>{b.name}{b.kind === 'ombor' ? ' (ombor)' : ''}</option>)}</Select></label>
        {canEdit ? <button className="btn primary" type="button" data-pnew onClick={() => editProduct()}>Yangi karta</button> : null}</div>
      {r ? <>
        <div className="muted prod-count" style={{ fontSize: 13 }}>{r.total} ta tovar{r.total > r.items.length ? ` · ${r.items.length} tasi ko‘rsatilgan` : ''} · tasdiqlangan karta: <b style={{ color: 'var(--ink)' }}>{r.verified}</b> / 60 (qabul sinovi Q3){status === 'queue' ? ' · navbat: omborda bor, tasdiqlanmagan, 90 kunda ko‘p sotilgani oldin' : ''}</div>
        <div className="prod-list">{r.items.length ? r.items.map(p => (
          <article className="prod" key={p.id}>
            <div className="meta"><span className={`pill ${p.status === 'verified' ? 'ok' : 'warn'}`}>{p.status === 'verified' ? 'tasdiqlangan' : 'tasdiqlanmagan'}</span><span className="pill">{p.category || 'toifa yo‘q'}</span></div>
            <h3>{p.name}</h3>
            <div className="mono" style={{ fontSize: 13 }}>{p.billz.price != null ? money(p.billz.price) : <span className="muted">narx yo‘q</span>}{' '}
              <span className="muted" style={{ fontFamily: 'var(--f-body)' }}> · {p.billz.source}{p.billz.stale ? ' · eskirgan' : ''}</span></div>
            <div className="chips" style={{ alignItems: 'center' }}><StockLine b={p.billz} />{p.sold90 ? <span className="muted" style={{ fontSize: 12 }}>· 90 kunda {p.sold90} ta sotilgan</span> : null}</div>
            {p.has_photo ? /* eslint-disable-next-line @next/next/no-img-element */ <img className="prod-img" src={`/api/products/${p.id}/photo`} alt={p.name} loading="lazy" /> : null}
            {p.specs ? <p>{p.specs}</p> : null}
            {p.compat ? <p><b style={{ color: 'var(--ink)' }}>Moslik:</b> {p.compat}</p> : null}
            {p.limits ? <p><b style={{ color: 'var(--ink)' }}>Cheklov:</b> {p.limits}</p> : null}
            {canEdit ? <div className="row-actions"><button className="btn sm" type="button" onClick={() => editProduct(p.id)}>Tahrirlash</button>
              <button className={`btn sm ${p.status === 'verified' ? '' : 'primary'}`} type="button" onClick={() => verify(p)}>{p.status === 'verified' ? 'Tasdiqni olish' : 'Tasdiqlash'}</button>
              <button className="btn sm" type="button" onClick={() => photoUp(p)}>{p.has_photo ? 'Rasmni almashtirish' : 'Rasm yuklash'}</button>
              {p.has_photo ? <button className="btn sm ghost" type="button" onClick={() => photoDel(p)}>Rasmni olib tashlash</button> : <button className="btn sm ai" type="button" disabled={photoBusy === p.id} onClick={() => photoWeb(p)}>{photoBusy === p.id ? 'Qidirilmoqda… (10–30 s)' : 'Internetdan topish'}</button>}
              <span className="muted" style={{ fontSize: 12 }}>{p.has_photo ? `Rasm: ${p.photo_from || ''} — AI mijozga yubora oladi` : 'Rasm yo‘q — mijoz so‘rasa AI rasmiy saytdan qidiradi'}</span></div> : null}
          </article>
        )) : <div className="muted">Bu filtr bo‘yicha tovar yo‘q.</div>}</div>
        {r.total > r.items.length ? <div className="row-actions" style={{ justifyContent: 'center' }}><button className="btn" type="button" id="pfMore" onClick={() => setLimit(l => l + 60)}>Yana ko‘rsatish ({Math.min(60, r.total - r.items.length)})</button></div> : null}
      </> : null}
    </>
  );
}
