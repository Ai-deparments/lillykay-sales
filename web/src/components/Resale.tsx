'use client';
import { useCallback, useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { api } from '@/lib/api';
import { cash, fmtDT, money, telHref } from '@/lib/format';
import { Icon } from './ui';
import { useApp } from './AppContext';
import { Select } from './Select';

/* QAYTA SOTUV (Chaqnoq) */
/* eslint-disable @typescript-eslint/no-explicit-any */
type Tab = 'list' | 'camp' | 'rules';
const RESULTS = ['Bog‘lanildi', 'Taklif berildi', 'Xarid', 'Rad etdi', 'Keyinroq'];
const CAMP_ST: Record<string, string> = { draft: 'qoralama', running: 'ishlamoqda', paused: 'to‘xtatilgan', done: 'yakunlangan' };

interface ResaleTask { id: number; status: string; kind: string; due_at: number; customer_name?: string; bot_chat_id?: unknown; user_name?: string; phone?: string; body?: string; conv_id?: number; meta?: any }
interface Campaign { id: number; title: string; is_demo?: boolean; product_name: string; daily_limit: number; status: string; stats: { sent: number; failed: number; task: number; replied: number; purchased: number } }
interface Arrival { id: number; name: string; category?: string; first_seen_at: number; stock_store: number; stock_warehouse: number; price: number | null; verified: boolean; campaign?: { status: string } | null }
interface Pick { id: number; name: string; stock?: number }
interface Suggest { id?: number; name: string }
interface StarterRule { bought_category: string; suggest_category: string; reason: string; min_days: number; max_days: number; support: number; buyers: number; share: number; suggest?: Suggest | null }
interface SugRule { bought_category: string; suggest_category: string; support: number; buyers: number; share: number; lift: number; median_days: number; min_days: number; max_days: number; suggest?: Suggest | null }

/* Sotuvchi uchun tayyor taklif matni (nusxalab Telegram yoki SMS’da yuboradi) — faqat BILLZ ma’lumotidan, narx eskirgan bo‘lsa yozilmaydi */
function offerText(t: ResaleTask): string {
  const m = t.meta || {}, p = m.purchase || {}, s = m.suggest || {};
  const price = s.price != null && !s.stale ? `, narxi ${money(s.price)}` : '';
  const cb = m.cashback?.amount > 0 ? `\nKeshbekingizda ${cash(m.cashback.amount)} bor — shu xaridda ishlatsangiz bo‘ladi.` : '';
  return `Assalomu alaykum! Sun HighTech’dan yozyapmiz.${p.item ? ` Bizdan ${p.item} olgan edingiz — rahmat!` : ''}\n`
    + `${m.reason ? m.reason.replace(/[.\s]+$/, '') + '. ' : ''}Hozir do‘konimizda ${s.name || 'yangi tovar'} bor${price}.${cb}\nQiziqsangiz, javob yozing — batafsil aytib beramiz.`;
}
const catTxt = (c: string): string => String(c).replaceAll('|', ' / ');
const ev = (x: any): string => `${x.support} / ${x.buyers} mijoz (${String(x.share).replace('.', ',')}%) · tasodifiydan ×${String(x.lift).replace('.', ',')} · odatda ${x.median_days} kundan keyin`;

function SegmentModal({ id, onChanged }: { id: number; onChanged: () => void }) {
  const { boot, isLead, closeModal, toast, fail } = useApp();
  const [data, setData] = useState<{ seg: any; c: Campaign | undefined } | null>(null);
  useEffect(() => {
    Promise.all([api(`/api/campaigns/${id}/segment`), api<{ items: Campaign[] }>('/api/campaigns')])
      .then(([seg, list]) => setData({ seg, c: list.items.find(x => x.id === id) }))
      .catch(e => { fail(e); closeModal(); });
  }, [id, fail, closeModal]);
  if (!data || !data.c) return null;
  const { seg, c } = data, ex = seg.excluded;
  const row = (l: string, n: number, minus?: boolean) => (
    <div className={`f-row ${minus ? 'minus' : ''}`}><span className="lab"><span>{minus ? '− ' : ''}{l}</span><span className="fbar" style={{ width: `${seg.total ? Math.max(2, n / seg.total * 100) : 0}%` }}></span></span><span className="n">{minus ? '−' : ''}{n}</span></div>
  );
  const ok = seg.bot + seg.task + seg.no_consent;
  const setStatus = async (status: string) => {
    await api(`/api/campaigns/${id}/status`, { status }).catch(fail);
    closeModal();
    toast(status === 'running' ? `Boshlandi — ${boot.settings.campaign_from}–${boot.settings.campaign_to} oralig‘ida, kuniga ${c.daily_limit} tagacha` : 'To‘xtatildi');
    onChanged();
  };
  return (
    <>
      <h2>{c.title}</h2>
      <div className="funnel">{row('Qoidalar bo‘yicha mos xaridorlar', seg.total)}{row('Xaridni qaytargan', ex.qaytargan, true)}{row('Allaqachon olgan', ex.allaqachon_olgan, true)}{row('Xabardan voz kechgan', ex.voz_kechgan, true)}{row('Qoldiq yo‘q', ex.qoldiq_yoq, true)}{row('30 kunlik chastota to‘lgan', seg.freq, true)}
        <div className="f-row total"><span className="lab"><span>Mos mijozlar</span></span><span className="n">{ok}</span></div></div>
      <div className="split"><div className="go"><span className="lbl">Avtomatik (bot)</span><span className="big mono">{seg.bot}</span>ulangan va rozilik bergan</div>
        <div><span className="lbl">Yuborilmaydi</span><span className="big mono">{seg.no_consent}</span>botda, lekin rozilik yo‘q</div>
        <div><span className="lbl">Sotuvchi vazifasi</span><span className="big mono">{seg.task}</span>faqat telefon — raqam Telegram chat emas</div></div>
      {seg.preview ? <div className="preview"><div className="chips"><span className="pill acc">Sabab: {seg.reason}</span></div><div className="txt">{seg.preview}</div></div> : null}
      <div className="row-actions" style={{ justifyContent: 'flex-end' }}><button className="btn ghost" type="button" data-close>Yopish</button>
        {isLead ? (c.status === 'running' ? <button className="btn" type="button" onClick={() => setStatus('paused')}>To‘xtatish</button>
          : <button className="btn primary" type="button" onClick={() => setStatus('running')}>{c.status === 'draft' ? 'Tasdiqlash va boshlash' : 'Davom ettirish'}</button>) : null}</div>
    </>
  );
}

function ListTab({ active, rev, reload, setTab }: { active: boolean; rev: number; reload: () => void; setTab: (t: Tab) => void }) {
  const { boot, isLead, clockNow, toast, fail } = useApp();
  const [r, setR] = useState<{ items: ResaleTask[]; overdue: number; rules: number } | null>(null);
  useEffect(() => {
    if (!active) return;
    let dead = false;
    api('/api/resale').then(x => { if (!dead) setR(x); }).catch(fail);
    return () => { dead = true; };
  }, [active, rev, fail]);
  if (!r) return null;
  const open = r.items.filter(t => t.status === 'open'), done = r.items.filter(t => t.status !== 'open');

  const copyOffer = async (e: MouseEvent<HTMLButtonElement>, t: ResaleTask) => {
    const btn = e.currentTarget;
    try { await navigator.clipboard.writeText(offerText(t)); toast('Taklif matni nusxalandi — Telegram yoki SMS’ga qo‘ying'); }
    catch { btn.closest('.task')?.querySelector('.offer')?.setAttribute('open', ''); toast('Nusxalab bo‘lmadi — matnni pastdan belgilab oling'); }
  };
  const result = async (t: ResaleTask, res: string) => { await api(`/api/tasks/${t.id}/done`, { result: res }).catch(fail); toast(`Qayd etildi: ${res}`); reload(); };
  const run = async () => {
    const x = await api('/api/resale/run', {}).catch(fail);
    if (x) toast(`Ro‘yxat: ${x.created} ta yangi vazifa${x.deferred ? `, yana ${x.deferred} tasi keyingi kunlarga (kunlik cheklov)` : ''}`);
    reload();
  };

  return (
    <>
      <div className="strip"><div className="s"><span className="n">{open.length}</span><span className="l">ochiq vazifa</span></div>
        <div className="s"><span className="n">{done.length}</span><span className="l">natija qayd etildi (24 soat)</span></div>
        {r.overdue ? <div className="s warn"><span className="n">{r.overdue}</span><span className="l">muddati o‘tgan — rahbarga ko‘rinadi</span></div> : null}
        {isLead ? <span className="row-actions" style={{ marginLeft: 'auto' }}><a className="btn ghost" href="/api/export/qayta-sotuv.csv">CSV</a><button className="btn" type="button" id="runResale" onClick={run}>Ro‘yxatni hozir tuzish</button></span> : null}</div>
      <details className="lead-fold"><summary>Bu ro‘yxat qanday tuziladi?</summary><p className="lead">Qayta sotuv agenti har kuni {String(boot.settings.resale_time)} da BILLZ xaridlaridan ro‘yxat tuzadi. Qaytargan, allaqachon olgan, voz kechgan va oxirgi {String(boot.settings.resale_quiet_days)} kunda bog‘lanilgan mijozlar chiqariladi. Bot va sotuvchi vazifasi bitta aloqa jadvalidan boshqariladi.</p></details>
      {!open.length && r.rules === 0 ? <div className="plan-cta"><div><b>Ro‘yxat bo‘sh, chunki birorta qayta sotuv qoidasi yoqilmagan.</b> Qoida — «kamera olganga obyektiv taklif qilinsin» kabi. Qoidalar bo‘limida 11 ta tayyor qoida bor: «Hammasini qo‘shish» bosilsa, ertadan har kuni sotuvchilarga kimga nima taklif qilish ro‘yxati chiqadi.</div>
        {isLead ? <div className="row-actions"><button className="btn sm primary" type="button" onClick={() => setTab('rules')}>Qoidalarni ko‘rish</button></div> : null}</div> : null}
      <div className="tasks">{open.length ? open.map(t => {
        const m = t.meta || {};
        return (
          <article className={`task ${t.due_at < clockNow() ? 'overdue' : ''}`} key={t.id}>
            <header className="task-head"><b>{t.customer_name || 'Mijoz'}</b>{t.bot_chat_id ? <span className="pill ok">botga ulangan</span> : <span className="pill">faqat telefon</span>}
              <span className={`pill ${t.kind === 'campaign_reply' ? 'ai' : t.kind === 'campaign' ? 'acc' : ''}`}>{t.kind === 'resale' ? 'Qayta sotuv' : t.kind === 'campaign' ? 'Kampaniya' : 'Kampaniyaga javob'}</span>
              <span className="task-meta">{t.user_name || 'biriktirilmagan'} · muddat {fmtDT(t.due_at)}{t.phone ? ' · ' + t.phone : ''}</span></header>
            {m.purchase ? <div className="task-grid">
              <div><span className="lbl">So‘nggi xarid</span><span>{m.purchase.item}</span><span className="src-note">{m.purchase.date}{m.purchase.branch ? ' · ' + m.purchase.branch : ''} · <span className="mono">{money(m.purchase.amount)}</span></span></div>
              <div><span className="lbl">Keshbek</span>{m.cashback ? <><span className="mono">{cash(m.cashback.amount)}</span><span className="src-note">BILLZ · {fmtDT(m.cashback.synced_at)}</span></> : <span className="muted">Ma’lumot yetarli emas</span>}</div>
              <div><span className="lbl">Taklif sababi</span><span>{m.reason}</span></div>
              <div><span className="lbl">Tavsiya</span><span>{m.suggest?.name || ''}</span><span className="src-note mono">{m.suggest?.price != null && !m.suggest.stale ? money(m.suggest.price) : 'narx aniqlanadi'} · qoldiq {m.suggest?.stock ?? '—'}</span></div>
            </div> : <div style={{ fontSize: 13 }}>{t.body || ''}</div>}
            <div className="task-bar">
              <div className="task-go">
                {t.phone ? <a className="btn sm primary" href={telHref(t.phone)}><Icon name="phone" />Qo‘ng‘iroq</a> : null}
                {t.conv_id ? <a className="btn sm" href={`#suhbat/${t.conv_id}`}><Icon name="chat" />Suhbat</a> : null}
                {m.purchase ? <button className="btn sm" type="button" onClick={e => copyOffer(e, t)}>Taklifni nusxalash</button> : null}
              </div>
              <div className="task-res" role="group" aria-label="Natija">{RESULTS.map(x => <button className="btn sm ghost" type="button" key={x} onClick={() => result(t, x)}>{x}</button>)}</div>
            </div>
            {m.purchase ? <details className="offer"><summary>Tayyor taklif matni</summary><p>{offerText(t)}</p></details> : null}
          </article>
        );
      }) : <div className="note">Bugun ochiq vazifa yo‘q.</div>}</div>
    </>
  );
}

function CampTab({ active, rev, reload }: { active: boolean; rev: number; reload: () => void }) {
  const { isLead, boot, openModal, setCatalogSeed, navigate, toast, fail } = useApp();
  const [r, setR] = useState<{ items: Campaign[] } | null>(null);
  const [arr, setArr] = useState<Arrival[]>([]);
  useEffect(() => {
    if (!active) return;
    let dead = false;
    (async () => {
      const c = await api<{ items: Campaign[] }>('/api/campaigns');
      const a = isLead ? await api<{ items: Arrival[] }>('/api/arrivals').catch(() => ({ items: [] as Arrival[] })) : { items: [] as Arrival[] };
      if (!dead) { setR(c); setArr(a.items); }
    })().catch(fail);
    return () => { dead = true; };
  }, [active, rev, isLead, fail]);

  const showSegment = useCallback((id: number) => openModal({ bare: true, content: <SegmentModal id={id} onChanged={reload} /> }), [openModal, reload]);

  const newCamp = async (prodId?: number) => {
    const prods = (await api<{ items: Pick[] }>('/api/pick/products').catch(fail))?.items;
    if (!prods) return;
    openModal({
      content: <><h2>Yangi kampaniya</h2><div className="form-grid">
        <label className="field wide"><span>Yangi kelgan mahsulot</span><Select name="product_id" id="c_prod" defaultValue={prodId}>{prods.map(p => <option key={p.id} value={p.id}>{p.name}{p.stock ? '' : ' (qoldiq yo‘q)'}</option>)}</Select></label>
        <label className="field"><span>Nomi</span><input name="title" id="c_title" placeholder="Yangi kirim: …" /></label>
        <label className="field"><span>Kuniga limit</span><input type="number" name="daily_limit" id="c_lim" defaultValue={String(boot.settings.campaign_daily_limit)} /></label>
        <label className="field wide"><span>Xabar (bo‘sh qoldirsangiz — namuna). O‘rinbosarlar: {'{ism} {xarid} {mahsulot} {narx}'}</span><textarea name="message" id="c_msg"></textarea></label></div>
        <div className="note">Agent chegirma o‘ylab chiqarmaydi. Narx BILLZ’dan olinadi; eskirgan bo‘lsa «narxini sotuvchi aytadi» deb yoziladi.</div></>,
      onSubmit: async dd => {
        const x = await api('/api/campaigns', { ...dd, product_id: Number(dd.product_id) });
        toast('Kampaniya qoralamasi yaratildi'); reload();
        if (x.id) setTimeout(() => showSegment(x.id), 50);
      }
    });
  };
  if (!r) return null;
  return (
    <>
      {arr.length ? <div className="panel"><div className="panel-head"><h2>Yangi kirim · 14 kun</h2><span className="muted">BILLZ katalogida yangi paydo bo‘lgan va qoldig‘i bor tovarlar. Kampaniya avtomatik ochilmaydi</span></div>
        <div className="tbl"><table><thead><tr><th>Tovar</th><th>Kelgan</th><th className="n">Do‘kon / ombor</th><th className="n">Narx</th><th>Karta</th><th></th></tr></thead><tbody>
          {arr.slice(0, 25).map(p => (
            <tr key={p.id}><td>{p.name}<br /><span className="muted" style={{ fontSize: 12 }}>{p.category || ''}</span></td>
              <td className="mono">{fmtDT(p.first_seen_at).slice(0, 5)}</td><td className="n mono">{p.stock_store} / {p.stock_warehouse}</td><td className="n mono">{p.price != null ? money(p.price) : '—'}</td>
              <td>{p.verified ? <span className="pill ok">tasdiqlangan</span> : <button className="btn sm ghost" type="button" onClick={() => { setCatalogSeed({ q: p.name.split(' — ')[0], status: 'all' }); navigate('#katalog'); }}>Kartani to‘ldirish</button>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{p.campaign ? <span className="pill">kampaniya: {CAMP_ST[p.campaign.status]}</span> : <button className="btn sm primary" type="button" onClick={() => newCamp(p.id)}>Kampaniya ochish</button>}</td></tr>
          ))}
        </tbody></table></div></div> : null}
      <p className="lead">Yangi tovar kelganda mos mijozlarga xabar. Avtomatik xabar faqat Sun HighTech botiga ulangan va rozilik bergan mijozga ketadi; qolganlarga sotuvchi vazifasi. Kampaniya + mijoz kaliti qayta ishga tushirishda takror xabarni to‘xtatadi. «O‘qildi» ko‘rsatilmaydi — platforma bermaydi.</p>
      {isLead ? <div className="row-actions"><button className="btn primary" type="button" id="newCamp" onClick={() => newCamp()}>Yangi kampaniya</button></div> : null}
      <div className="tbl"><table><thead><tr><th>Kampaniya</th><th>Holat</th><th className="n">Yuborildi</th><th className="n">Xato</th><th className="n">Vazifa</th><th className="n">Javob</th><th className="n">Xarid</th><th></th></tr></thead><tbody>
        {r.items.length ? r.items.map(c => (
          <tr key={c.id}><td><b>{c.title}</b>{c.is_demo ? <> <span className="demo-tag">demo</span></> : null}<br /><span className="muted">{c.product_name} · kuniga {c.daily_limit}</span></td>
            <td><span className={`pill ${c.status === 'running' ? 'ok' : c.status === 'paused' ? 'warn' : ''}`}>{CAMP_ST[c.status]}</span></td>
            <td className="n">{c.stats.sent}</td><td className="n">{c.stats.failed}</td><td className="n">{c.stats.task}</td><td className="n">{c.stats.replied}</td><td className="n">{c.stats.purchased}</td>
            <td><button className="btn sm" type="button" onClick={() => showSegment(c.id)}>Kimga boradi</button></td></tr>
        )) : <tr><td colSpan={8} className="muted">Kampaniya yo‘q</td></tr>}
      </tbody></table></div>
    </>
  );
}

function RulesTab({ active, rev, reload }: { active: boolean; rev: number; reload: () => void }) {
  const { boot, openModal, toast, fail } = useApp();
  const canEdit = boot.me.role !== 'sotuvchi';
  const [d, setD] = useState<{ items: any[]; sug: SugRule[]; start: StarterRule[]; total: number | null } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!active) return;
    let dead = false;
    (async () => {
      const [r, sg] = await Promise.all([api('/api/rules'), canEdit ? api('/api/rules/suggest').catch(() => null) : null]);
      if (!dead) { setD({ items: r.items, sug: sg?.items || [], start: sg?.starter || [], total: sg ? sg.total_customers : null }); setBusy(false); }
    })().catch(fail);
    return () => { dead = true; };
  }, [active, rev, canEdit, fail]);
  if (!d) return null;
  const { sug: RULE_SUG, start: RULE_START } = d;
  const evid = (x: StarterRule) => ({ source: 'tajriba', support: x.support, buyers: x.buyers, share: x.share });

  const newRule = async () => {
    const prods = (await api<{ items: Pick[] }>('/api/pick/products').catch(fail))?.items;
    if (!prods) return;
    const opts = prods.map(p => <option key={p.id} value={p.id}>{p.name}{p.stock ? '' : ' (qoldiq yo‘q)'}</option>);
    openModal({
      content: <><h2>Qayta sotuv qoidasi</h2><div className="form-grid">
        <label className="field"><span>Olgan mahsulot</span><Select name="bought_product_id" id="r_b">{opts}</Select></label>
        <label className="field"><span>Taklif qilinadigan</span><Select name="suggest_product_id" id="r_s">{opts}</Select></label>
        <label className="field wide"><span>Sabab (mijozga tushunarli)</span><input name="reason" id="r_reason" required placeholder="Korpus olgan — obyektiv xaridi yo‘q" /></label>
        <label className="field"><span>Xariddan kamida (kun)</span><input type="number" name="min_days" id="r_min" defaultValue="7" /></label>
        <label className="field"><span>Ko‘pi bilan (kun)</span><input type="number" name="max_days" id="r_max" defaultValue="365" /></label></div></>,
      onSubmit: async dd => { await api('/api/rules', { ...dd, bought_product_id: Number(dd.bought_product_id), suggest_product_id: Number(dd.suggest_product_id) }); toast('Qoida saqlandi'); reload(); }
    });
  };
  const startAll = async () => {
    const list = RULE_START.filter(x => x.suggest);
    if (!confirm(`${list.length} ta qoida qo‘shilsinmi? Ertadan har kuni sotuvchilarga qayta sotuv vazifalari chiqadi (mijozga avtomatik xabar ketmaydi — sotuvchi o‘zi bog‘lanadi).`)) return;
    setBusy(true);
    let n = 0;
    for (const x of list) {
      const r = await api('/api/rules', { reason: x.reason, min_days: x.min_days, max_days: x.max_days, bought_category: x.bought_category, suggest_category: x.suggest_category,
        suggest_product_id: x.suggest?.id || null, starter: true, evidence: { source: 'tajriba', support: x.support, buyers: x.buyers, share: x.share } }).catch(() => null);
      if (r?.ok !== false) n++;
    }
    toast(`${n} ta qoida qo‘shildi — ertangi ro‘yxatdan ishlaydi`); reload();
  };
  const rejStart = async (x: StarterRule) => { await api('/api/rules/reject', { a: x.bought_category, b: x.suggest_category }).catch(fail); toast('Yashirildi'); reload(); };
  const addStart = (x: StarterRule) => openModal({
    content: <><h2>Qoida: {catTxt(x.bought_category)} → {catTxt(x.suggest_category)}</h2>
      <div className="note">Tarixda: {x.support} / {x.buyers} mijoz. Bugun taklif: {x.suggest?.name || 'qoldiq yo‘q'} — har kuni shu turdagi do‘konda bor model tanlanadi. Sotuvchi mijoz texnikasiga mosligini tekshiradi.</div>
      <div className="form-grid"><label className="field wide"><span>Sabab (mijozga tushunarli)</span><input name="reason" id="st_reason" required defaultValue={x.reason} /></label>
        <label className="field"><span>Xariddan kamida (kun)</span><input type="number" name="min_days" id="st_min" defaultValue={x.min_days} /></label>
        <label className="field"><span>Ko‘pi bilan (kun)</span><input type="number" name="max_days" id="st_max" defaultValue={x.max_days} /></label></div></>,
    onSubmit: async dd => { await api('/api/rules', { ...dd, bought_category: x.bought_category, suggest_category: x.suggest_category, suggest_product_id: x.suggest?.id || null, starter: true, evidence: evid(x) }); toast('Qoida qo‘shildi — ertangi ro‘yxatdan ishlaydi'); reload(); }
  });
  const rejSug = async (x: SugRule) => { await api('/api/rules/reject', { a: x.bought_category, b: x.suggest_category }).catch(fail); toast('Tavsiya yashirildi'); reload(); };
  const addSug = (x: SugRule) => openModal({
    content: <><h2>Qoida: tur bo‘yicha</h2>
      <div className="note">{x.bought_category} → {x.suggest_category} · {x.support} / {x.buyers} mijoz ({String(x.share).replace('.', ',')}%), tasodifiydan ×{String(x.lift).replace('.', ',')}, odatda {x.median_days} kundan keyin. Bugun taklif: {x.suggest?.name || 'qoldiq yo‘q'}.</div>
      <div className="form-grid"><label className="field wide"><span>Sabab (mijozga tushunarli — nima uchun kerakligini yozing)</span><input name="reason" id="rs_reason" required defaultValue={`${x.bought_category} olganlar ko‘pincha keyin ${x.suggest_category} ham oladi`} /></label>
        <label className="field"><span>Xariddan kamida (kun)</span><input type="number" name="min_days" id="rs_min" defaultValue={x.min_days} /></label>
        <label className="field"><span>Ko‘pi bilan (kun)</span><input type="number" name="max_days" id="rs_max" defaultValue={x.max_days} /></label></div></>,
    onSubmit: async dd => { await api('/api/rules', { ...dd, bought_category: x.bought_category, suggest_category: x.suggest_category, suggest_product_id: x.suggest?.id || null,
      evidence: { support: x.support, buyers: x.buyers, share: x.share, lift: x.lift, median_days: x.median_days } }); toast('Qoida qo‘shildi — ertangi ro‘yxatdan ishlaydi'); reload(); }
  });

  return (
    <>
      <p className="lead">Qoida: «X ni olgan mijozga Y mos, chunki …». Sabab mijozga ham, sotuvchiga ham tushunarli bo‘lishi kerak. Tur bo‘yicha qoidada taklif har kuni shu turdagi do‘konda bor va eng ko‘p sotilgan modeldan tanlanadi.</p>
      {canEdit ? <div className="row-actions"><button className="btn primary" type="button" id="newRule" onClick={newRule}>Qoida qo‘shish</button></div> : null}
      {canEdit && d.total != null ? <div className="note">Xaridlar tarixi (BILLZ, 12 oy): {d.total} mijozdan tur-juftliklar tekshirildi; tasodifiy moslikni ajratish uchun statistik filtr (ko‘p taqqoslash tuzatmasi bilan). Mijozlarning ko‘pchiligi bir martalik xaridor — shuning uchun ishonchli tavsiya kam. Pastdagi boshlang‘ich qoidalar foto do‘kon tajribasiga asoslangan; qaysi biri ishlashini vazifa natijalari ko‘rsatadi.</div> : null}
      {RULE_START.length ? <div className="panel"><div className="panel-head"><h2>Boshlang‘ich qoidalar</h2><span className="muted">Foto-video do‘kon tajribasi, Photobuy turlariga moslangan. Tasdiqlaganingiz ertangi ro‘yxatdan ishlaydi</span>
        {canEdit ? <button className="btn sm primary" type="button" id="startAll" style={{ marginLeft: 'auto' }} disabled={busy} onClick={startAll}>Hammasini qo‘shish ({RULE_START.filter(x => x.suggest).length})</button> : null}</div>
        <div className="tbl"><table><thead><tr><th>Olgan (tur)</th><th>Taklif (tur)</th><th>Sabab</th><th>Tarixda</th><th>Bugun taklif</th><th></th></tr></thead><tbody>
          {RULE_START.map((x, i) => (
            <tr key={i}><td>{catTxt(x.bought_category)}</td><td>{catTxt(x.suggest_category)}</td><td style={{ fontSize: 13 }}>{x.reason}</td>
              <td className="muted" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{x.support} / {x.buyers} mijoz</td>
              <td>{x.suggest ? x.suggest.name : <span className="pill warn">qoldiq yo‘q</span>}</td>
              <td style={{ whiteSpace: 'nowrap' }}><button className="btn sm primary" type="button" onClick={() => addStart(x)}>Qo‘shish</button> <button className="btn sm ghost" type="button" onClick={() => rejStart(x)}>Kerak emas</button></td></tr>
          ))}
        </tbody></table></div></div> : null}
      {RULE_SUG.length ? <div className="panel"><div className="panel-head"><h2>Xaridlar tarixidan tavsiyalar</h2><span className="muted">Statistik filtrdan o‘tganlar · A turini olgandan keyin 1–180 kunda B turini olganlar. Hech biri avtomatik yoqilmaydi</span></div>
        <div className="tbl"><table><thead><tr><th>Olgan (tur)</th><th>Keyin oladi (tur)</th><th>Dalil</th><th>Bugun taklif</th><th></th></tr></thead><tbody>
          {RULE_SUG.map((x, i) => (
            <tr key={i}><td>{x.bought_category}</td><td>{x.suggest_category}</td><td className="muted" style={{ fontSize: 12.5 }}>{ev(x)}</td>
              <td>{x.suggest ? x.suggest.name : <span className="pill warn">qoldiq yo‘q</span>}</td>
              <td style={{ whiteSpace: 'nowrap' }}><button className="btn sm primary" type="button" onClick={() => addSug(x)}>Qo‘shish</button> <button className="btn sm ghost" type="button" onClick={() => rejSug(x)}>Rad etish</button></td></tr>
          ))}
        </tbody></table></div></div> : null}
      <div className="tbl"><table><thead><tr><th>Olgan</th><th>Taklif</th><th>Sabab</th><th className="n">Kun oralig‘i</th><th>Holat</th></tr></thead><tbody>
        {d.items.length ? d.items.map((x, i) => (
          <tr key={i}><td>{x.bought_category ? <><span className="pill">tur</span> {x.bought_category}</> : (x.bought_name || x.bought_match)}</td>
            <td>{x.suggest_category ? <><span className="pill">tur</span> {x.suggest_category}<br /><span className="muted" style={{ fontSize: 12 }}>bugun: {x.today || 'qoldiq yo‘q'}</span></> : x.suggest_name}</td>
            <td>{x.reason}{x.evidence ? <><br /><span className="muted" style={{ fontSize: 12 }}>{x.evidence.source === 'tajriba' ? `tajriba asosida · tarixda ${x.evidence.support} / ${x.evidence.buyers} mijoz` : ev(x.evidence)}</span></> : null}</td>
            <td className="n">{x.min_days}–{x.max_days}</td><td>{x.active ? <span className="pill ok">faol</span> : <span className="pill">o‘chiq</span>}</td></tr>
        )) : <tr><td colSpan={5} className="muted">Qoida yo‘q</td></tr>}
      </tbody></table></div>
    </>
  );
}

export function Resale({ active }: { active: boolean }) {
  const [tab, setTab] = useState<Tab>('list');
  const [rev, setRev] = useState(0);
  const reload = useCallback(() => setRev(v => v + 1), []);
  const tabs: [Tab, string][] = [['list', 'Bugungi ro‘yxat'], ['camp', 'Kampaniyalar'], ['rules', 'Qoidalar']];
  return (
    <>
      <div className="tabs" role="tablist">{tabs.map(([k, l]) => <button type="button" role="tab" key={k} aria-selected={tab === k} data-rtab={k} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'list' ? <ListTab active={active} rev={rev} reload={reload} setTab={setTab} /> : tab === 'camp' ? <CampTab active={active} rev={rev} reload={reload} /> : <RulesTab active={active} rev={rev} reload={reload} />}
    </>
  );
}
