'use client';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { num, usd } from '@/lib/format';
import { Brand, Icon } from './ui';
import { useApp } from './AppContext';
import { AgentFlow } from './AgentFlow';

export const MODE_L: Record<string, string> = { doim: 'Doim', kechiksa: 'Kechiksa', ochiq: 'O‘chiq' };
export const ROLL_L: Record<string, string> = { kuzatish: 'Kuzatish', tasdiq: 'Tasdiq bilan', avto: 'Avtomatik' };
const CH_L: Record<string, string> = { tg: 'Telegram', ig: 'Instagram', demo: 'Demo' };
const ROLL_HINT: Record<string, string> = { kuzatish: 'AI qoralama yozadi — mijozga yuborilmaydi', tasdiq: 'Sotuvchi «Hozir yuborish» bossa yuboriladi', avto: 'Sotuvchi javob bermasa — AI o‘zi yuboradi' };
/* Google AI Studio’ning to‘lov sahifasi: haqiqiy sarf, qolgan balans va «Buy credits» */
const AISTUDIO_BILLING = 'https://aistudio.google.com/billing';

interface AgentAccount {
  id: number; channel: string; name: string; is_demo: number | boolean; ai_enabled: number | boolean; rollout: string; mode: string;
  can_reply: number | boolean; enabled: number | boolean; today: { client: number; sent: number; failed: number; waiting: number };
}
interface AgentResp {
  ai?: { state?: string; detail?: string }; settings: { T_seconds: number; night_autoreply: boolean; work_from: string; work_to: string }; accounts: AgentAccount[];
}
interface UsageResp {
  credits_out_at?: number | null; stop?: { why: string } | null; reserve?: number; topup?: { left: number } | null; per_reply?: number;
  low_stopped_at?: number | null; limits?: { day?: number; month?: number };
}

function UsagePanel({ x }: { x: UsageResp }) {
  const warn = x.credits_out_at ? <div className="banner warn"><div><b>Balans tugagan.</b> AI javob yoza olmayapti — Google AI Studio’da to‘ldiring.</div></div>
    : x.stop ? <div className="banner warn"><div><b>AI to‘xtatilgan</b> — {x.stop.why === 'day' ? 'kunlik' : x.stop.why === 'month' ? 'oylik' : 'balans'} chegarasi. Suhbatlar sotuvchilarga qolyapti.</div></div> : null;
  return (
    <div className={`panel${warn ? ' panel-warn' : ''}`}><div className="panel-head"><h2>AI hisobi</h2>
      <span className="ai-real" style={{ marginLeft: 'auto' }}><a className="btn primary" href={AISTUDIO_BILLING} target="_blank" rel="noopener"
        title="Google AI Studio: haqiqiy sarf va qolgan balans"><Icon name="chart" />Hisobni ko‘rish — Google AI Studio</a></span></div>{warn}</div>
  );
}

/* «To‘ldirdim» oynasi tarkibi: summa kiritilganda yangi balans jonli hisoblanadi */
function TopupForm({ cur }: { cur: UsageResp | null }) {
  const R = cur?.reserve ?? 5, prev = cur?.topup ? Math.max(0, cur.topup.left) : null, per = cur?.per_reply || 0;
  const [val, setVal] = useState('');
  const [exact, setExact] = useState(false);
  const leftOf = (n: number, ex: boolean) => ex || prev == null ? n : prev + n;
  const n = Number(String(val || '').replace(',', '.')) || 0, left = leftOf(n, exact);
  const use = Math.max(0, left - R), k = per ? Math.floor(use / per) : 0;
  return (
    <>
      <h2>Balansni to‘ldirdingizmi?</h2>
      <p className="lead" style={{ fontSize: 13, margin: 0 }}>Google AI Studio’da <b>qancha to‘ldirganingizni kiriting</b> — shunga qarab hisoblaymiz.{' '}
        {prev == null ? <>Birinchi marta kiritayotgan bo‘lsangiz, Google AI Studio’dagi <b>hozirgi balansni</b> yozing.</> : `Avvalgi qoldiq — ${usd(prev)} — ustiga qo‘shiladi.`}</p>
      <label className="field"><span>Summa, dollarda</span><input name="usd" id="tuUsd" type="number" min="0.01" step="0.01" inputMode="decimal" placeholder="masalan, 50" required value={val} onChange={e => setVal(e.target.value)} /></label>
      {prev == null ? null : <label className="tu-exact"><input type="checkbox" name="exact" id="tuExact" checked={exact} onChange={e => setExact(e.target.checked)} />Bu — Google’dagi umumiy balans (avvalgi qoldiq qo‘shilmasin)</label>}
      <div className="note" id="tuCalc" aria-live="polite">
        {!n ? <>Balansda <b>{usd(R)}</b> qolganda AI agent <b>o‘zi o‘chadi</b> — hisob hech qachon minusga kirmaydi.</>
          : left <= R ? <>Yangi balans <b>{usd(left)}</b> — bu {usd(R)} zaxiradan kam, AI ishlamaydi. Kattaroq summa to‘ldiring.</>
          : <>Yangi balans: <b>{usd(left)}</b>. AI uchun <b>{usd(use)}</b> ishlatiladi{k ? ` (taxminan ${num(k)} ta javob)` : ''}.{' '}
            <b>{usd(R)}</b> qolganda AI agent o‘zi o‘chadi — hisob minusga kirmaydi.</>}
      </div>
    </>
  );
}

export function Agent({ active }: { active: boolean }) {
  const { toast, fail, openModal } = useApp();
  const [r, setR] = useState<AgentResp | null>(null);
  const [use, setUse] = useState<UsageResp | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const a = await api<AgentResp>('/api/agent');
      const u = await api<UsageResp>('/api/ai-usage').catch(() => null);
      setR(a); setUse(u);
    } catch (e) { fail(e); }
  }, [fail]);
  useEffect(() => { if (active) load(); }, [active, load]);

  /* Quyidagi ikki oyna app.js da faqat eski (ishlatilmaydigan) batafsil panelda chaqirilardi; kerak bo‘lsa UsagePanel ga tugma ulanadi */
  const aiLimitModal = async () => {
    const cur = await api<UsageResp>('/api/ai-usage').catch(() => null);
    openModal({
      content: <>
        <h2>AI chegarasi</h2>
        <p className="lead" style={{ fontSize: 13 }}>Chegaraga yetganda AI so‘rov yubormaydi — suhbatlar sotuvchilarga qoladi va kutilmagan hisob chiqmaydi.
          Kunlik chegara yarim tunda, oylik chegara oy boshida o‘zi tiklanadi. <b>0</b> — chegara yo‘q.</p>
        <div className="grid-2">
          <label className="field"><span>Kuniga, dollarda</span><input name="day" type="number" min="0" step="0.5" defaultValue={cur?.limits?.day ?? 2} /></label>
          <label className="field"><span>Oyiga, dollarda</span><input name="month" type="number" min="0" step="5" defaultValue={cur?.limits?.month ?? 0} /></label>
        </div>
      </>,
      onSubmit: async d => {
        if (!await api('/api/ai-usage/limits', { day: d.day, month: d.month }).catch(fail)) return true;
        toast('Chegara saqlandi');
        load();
      }
    });
  };
  const topupModal = async () => {
    const cur = await api<UsageResp>('/api/ai-usage').catch(() => null);
    const R = cur?.reserve ?? 5, prev = cur?.topup ? Math.max(0, cur.topup.left) : null;
    const leftOf = (n: number, exact: boolean) => exact || prev == null ? n : prev + n;
    openModal({
      content: <TopupForm cur={cur} />,
      onSubmit: async d => {
        const n = Number(String(d.usd || '').replace(',', '.'));
        if (!(n > 0)) { toast('Summani raqam bilan yozing, masalan 50'); return true; }
        const left = leftOf(n, Boolean(d.exact));
        if (!await api('/api/ai-usage/topup', { usd: Math.round(left * 100) / 100 }).catch(fail)) return true;
        toast(cur?.low_stopped_at && left > R ? `Saqlandi — balans ${usd(left)}. AI to‘xtatilgan edi: pastda qayta yoqing.` : `Saqlandi — balans ${usd(left)}. ${usd(R)} qolganda AI o‘zi o‘chadi.`, 'ai');
        load();
      }
    });
  };

  void aiLimitModal; void topupModal;
  if (!r) return null;
  const ai = r.ai || {}, T = r.settings.T_seconds;
  const live = r.accounts.filter(a => !a.is_demo), anyOn = live.some(a => a.ai_enabled);
  const modeHint: Record<string, string> = { doim: 'Kutmasdan darhol javob', kechiksa: `Sotuvchi ${T} soniyada javob bermasa`, ochiq: 'AI o‘zi yubormaydi, faqat taklif yozadi' };
  const status = (a: AgentAccount) => !a.ai_enabled ? 'AI to‘xtatilgan — mijoz xabarlari keladi, javobni sotuvchi yozadi'
    : a.rollout === 'kuzatish' ? 'AI faqat qoralama yozadi, mijozga yubormaydi'
    : a.rollout === 'tasdiq' ? 'AI yozadi, sotuvchi tasdiqlasa yuboriladi'
    : a.mode === 'ochiq' ? 'Avtojavob o‘chiq — AI faqat taklif yozadi'
    : a.mode === 'doim' ? 'AI mijozga o‘zi, darhol javob beradi' : `AI mijozga o‘zi javob beradi — sotuvchi ${T} s ichida yozmasa`;
  const warn = (a: AgentAccount) => a.channel === 'tg' && !a.can_reply ? 'Telegram Business’da javob huquqi berilmagan' : !a.enabled ? 'Kanal o‘chirilgan' : '';

  const toggleAi = async (a: AgentAccount) => {
    const on = !a.ai_enabled;
    if (on && a.rollout === 'avto' && a.mode !== 'ochiq' && !confirm('AI shu kanalda mijozlarga o‘zi javob bera boshlaydi. Yoqasizmi?')) return;
    await api(`/api/accounts/${a.id}`, { ai_enabled: on ? 1 : 0 }).catch(fail);
    toast(on ? 'AI agent yoqildi' : 'AI agent to‘xtatildi', on ? 'ai' : undefined);
    load();
  };
  const setKey = async (a: AgentAccount, key: 'rollout' | 'mode', val: string) => {
    if (key === 'rollout' && val === 'avto' && !confirm('«Avtomatik» bosqichida AI mijozlarga o‘zi javob yuboradi. Davom etasizmi?')) return;
    await api(`/api/accounts/${a.id}`, { [key]: val }).catch(fail);
    toast('Saqlandi'); load();
  };
  const allSwitch = async () => {
    const on = !anyOn;
    if (!confirm(on ? 'Barcha kanallarda AI yoqiladi. Davom etasizmi?' : 'Barcha kanallarda AI to‘xtatiladi. Davom etasizmi?')) return;
    setBusy(true);
    try {
      const cur = await api<AgentResp>('/api/agent');
      for (const a of cur.accounts.filter(x => !x.is_demo && Boolean(x.ai_enabled) !== on)) await api(`/api/accounts/${a.id}`, { ai_enabled: on ? 1 : 0 }).catch(fail);
      toast(on ? 'AI hamma kanalda yoqildi' : 'AI hamma kanalda to‘xtatildi', on ? 'ai' : undefined);
    } catch (e) { fail(e); }
    setBusy(false);
    load();
  };
  const segs = (a: AgentAccount, key: 'rollout' | 'mode', opts: Record<string, string>) => (
    <div className="seg" role="group">{Object.entries(opts).map(([k, l]) => (
      <button type="button" key={k} data-acc={a.id} data-key={key} data-val={k} aria-pressed={a[key] === k} onClick={() => setKey(a, key, k)}>{l}</button>
    ))}</div>
  );

  // Tartib: avval agentlarni boshqarish (kanallar), keyin umumiy qoidalar, eng pastda AI sarfi va balans
  return (
    <>
      {active ? <AgentFlow /> : null}
      <div className="panel"><div className="panel-head"><h2>AI agent</h2>
        <span className={`pill ${ai.state === 'ok' ? 'ok' : 'warn'}`}>{ai.state === 'ok' ? 'AI ulangan' : 'AI ulanmagan'}</span>
        <span className="muted">{ai.detail || ''}</span>
        {live.length ? <button className={`btn sm ${anyOn ? 'danger' : 'primary'}`} type="button" id={anyOn ? 'agAllOff' : 'agAllOn'} style={{ marginLeft: 'auto' }} disabled={busy} onClick={allSwitch}>{anyOn ? 'Hammasini to‘xtatish' : 'Hammasini yoqish'}</button> : null}</div>
        <div className="panel-help">To‘xtatilgan kanalda mijoz xabarlari panelga kelaveradi, lekin AI javob ham, qoralama ham yozmaydi (AI xarajati yo‘q) — suhbatni sotuvchi olib boradi.</div></div>
      {r.accounts.length ? r.accounts.map(a => (
        <div className={`panel agent-card${a.ai_enabled ? '' : ' off'}`} key={a.id}>
          <div className="agent-top">
            <div className="set-name"><Brand ch={a.channel} /><div><b>{CH_L[a.channel] || a.channel}</b> · {a.name} {a.is_demo ? <span className="demo-tag">demo</span> : null}
              <div className="set-sub">{status(a)}{warn(a) ? <> · <span style={{ color: 'var(--bad)' }}>{warn(a)}</span></> : null}</div></div></div>
            <button type="button" className="switch" role="switch" aria-checked={Boolean(a.ai_enabled)} onClick={() => toggleAi(a)}><span></span>{a.ai_enabled ? 'Ishlayapti' : 'To‘xtatilgan'}</button>
          </div>
          {a.ai_enabled ? <div className="agent-opts">
            <div><div className="muted lbl">Bosqich</div>{segs(a, 'rollout', ROLL_L)}<div className="hint">{ROLL_HINT[a.rollout]}</div></div>
            <div><div className="muted lbl">Avtojavob (faqat «Avtomatik» bosqichida)</div>{segs(a, 'mode', MODE_L)}<div className="hint">{modeHint[a.mode]}</div></div>
          </div> : null}
          <div className="agent-stats"><span>Bugun mijoz xabari <b>{a.today.client}</b></span><span>AI yubordi <b>{a.today.sent}</b></span><span>AI xatosi <b>{a.today.failed}</b></span><span>Javob kutmoqda <b>{a.today.waiting}</b></span></div>
        </div>
      )) : <div className="banner warn"><div><b>Hali kanal ulanmagan.</b> Telegram yoki Instagram ulangach shu yerda chiqadi.</div></div>}
      <div className="panel"><div className="panel-head"><h2>Umumiy qoidalar</h2></div>
        <div className="set-list">
          <div className="set-row"><div className="set-name">Kechikish T</div><b className="mono">{T} s</b></div>
          <div className="set-row"><div className="set-name">Tungi avtojavob</div><span className={`pill ${r.settings.night_autoreply ? 'ok' : ''}`}>{r.settings.night_autoreply ? 'yoqilgan' : 'o‘chiq'}</span></div>
          <div className="set-row"><div className="set-name">Ish vaqti</div><b className="mono">{r.settings.work_from}–{r.settings.work_to}</b></div>
        </div></div>
      {use ? <UsagePanel x={use} /> : null}
    </>
  );
}
