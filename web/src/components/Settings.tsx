'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '@/lib/api';
import { fmtDT } from '@/lib/format';
import { Brand } from './ui';
import { useApp } from './AppContext';
import { MODE_L, ROLL_L } from './Agent';
import { Select } from './Select';

/* eslint-disable @typescript-eslint/no-explicit-any */
interface SettingsResp { settings: Record<string, any>; changes: { at: number; who: string; what: string }[] }
interface ReadyItem { title: string; detail?: string; state: string; who: string; gap: string }
interface Readiness { ready: number; total: number; items: ReadyItem[] }

const INTL: [string, string][] = [['telegram', 'Telegram'], ['billz', 'BILLZ'], ['ai', 'AI'], ['instagram', 'Instagram'], ['backup', 'Zaxira nusxa']];
const STATE_L: Record<string, string> = { ok: 'tayyor', wait: 'kutilmoqda' };

/* AI kaliti oynasi: tekshiruv holati #aikMsg da ko‘rsatiladi (app.js dagidek) */
function AiKeyForm() {
  return (
    <>
      <h2>AI kaliti — Gemini</h2>
      <p className="muted" style={{ margin: 0 }}>Google AI Studio (aistudio.google.com → «Get API key») yoki Vertex AI kaliti. Kalit avval tekshiriladi, ishlasa saqlanadi va darhol ishga tushadi. Keyin qayta ko‘rsatilmaydi.</p>
      <p className="muted" style={{ margin: 0 }}>Billing ulangan (pullik) loyiha kaliti bo‘lsin — bepul tarifda Google yuborilgan ma’lumotdan o‘z mahsulotlarini yaxshilashda foydalanishi mumkin.</p>
      <label className="field"><span>Gemini API kaliti</span><input name="key" id="aik" type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} required /></label>
      <div id="aikMsg" className="muted" role="status"></div>
    </>
  );
}

export function Settings({ active }: { active: boolean }) {
  const { boot: b, isLead, reloadBoot, toast, fail, openModal } = useApp();
  const [r, setR] = useState<SettingsResp | null>(null);
  const [rd, setRd] = useState<Readiness | null>(null);
  const [ver, setVer] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const botLink = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const nb = await reloadBoot();
      const res = await api<SettingsResp>('/api/settings');
      const lead = ['admin', 'rahbar'].includes(nb.me.role);
      const ready = lead ? await api<Readiness>('/api/readiness').catch(() => null) : null;
      setR(res); setRd(ready); setVer(v => v + 1);
    } catch (e) { fail(e); }
  }, [reloadBoot, fail]);
  useEffect(() => { if (active) load(); }, [active, load]);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!r) return null;
  const s = r.settings;

  const saveAcc = async (id: number, body: Record<string, unknown>) => { await api(`/api/accounts/${id}`, body).catch(fail); toast('Saqlandi'); };
  const demoOff = async () => { if (!confirm('Demo akkaunt, katalog namunasi va demo suhbatlar o‘chiriladi. Davom etasizmi?')) return; await api('/api/demo/remove', {}); toast('Demo o‘chirildi'); load(); };
  const demoOn = async () => { await api('/api/demo/seed', {}); toast('Demo yuklandi'); load(); };
  const copyBot = async () => {
    const el = botLink.current!; el.select();
    try { await navigator.clipboard.writeText(el.value); toast('Havola nusxalandi'); } catch { toast('Havolani qo‘lda nusxalang'); }
  };
  const aiKey = () => openModal({
    content: <AiKeyForm />,
    onSubmit: async d => {
      const msg = document.getElementById('aikMsg')!, btn = document.querySelector<HTMLButtonElement>('#mForm [type=submit]')!;
      msg.textContent = 'Tekshirilmoqda… (10–30 soniya)'; btn.disabled = true;
      const res = await api<{ ok: boolean; why?: string; model?: string; redraft?: number }>('/api/ai-key', { key: d.key }).catch(err => ({ ok: false, why: (err as Error).message } as { ok: boolean; why?: string; model?: string; redraft?: number }));
      btn.disabled = false;
      if (!res.ok) { msg.textContent = res.why || 'Kalit ishlamadi'; return true; }
      toast(`AI ulandi: ${res.model}${res.redraft ? ` — ${res.redraft} ta kutayotgan suhbatga javob tayyorlanmoqda` : ''}`, 'ai');
      load();
    }
  });
  const billzSync = async () => {
    setSyncing(true);
    const res = await api<{ busy?: boolean }>('/api/billz/sync', {}).catch(fail);
    if (res) toast(res.busy ? 'BILLZ: sinxron allaqachon ketmoqda' : 'BILLZ: sinxron boshlandi — natija shu qatorda va jurnalda ko‘rinadi');
    timer.current = setTimeout(() => { setSyncing(false); load(); }, 4000);
  };
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const d: Record<string, any> = Object.fromEntries(new FormData(e.currentTarget).entries());
    d.night_autoreply = d.night_autoreply === 'true';
    const res = await api<{ changed?: unknown[] }>('/api/settings', d).catch(fail);
    if (!res) return;
    toast(res.changed?.length ? `Saqlandi: ${res.changed.length} ta o‘zgarish` : 'O‘zgarish yo‘q'); load();
  };
  const num = (label: string, name: string, id: string, min: number, max?: number) => (
    <label className="field"><span>{label}</span><input type="number" min={min} max={max} name={name} id={id} defaultValue={s[name]} /></label>
  );

  return (
    <>
      {rd ? <div className="panel"><div className="panel-head"><h2>Ishga tushirish tayyorligi</h2>
        <span className={`pill ${rd.ready === rd.total ? 'ok' : 'warn'}`}>{rd.ready} / {rd.total} tayyor</span>
        <span className="muted" style={{ marginLeft: 'auto' }}>Jonli holat — qo‘lda belgilanmaydi</span></div>
        <div className="tbl"><table><thead><tr><th></th><th>Nima</th><th>Holat</th><th>Kim</th><th>Bo‘lmasa</th></tr></thead><tbody>
          {rd.items.map((x, i) => (
            <tr key={i}><td><span className={`state-dot ${x.state === 'ok' ? 'ok' : 'pending'}`}></span></td>
              <td><b>{x.title}</b><div className="muted" style={{ fontSize: 12.5 }}>{x.detail || ''}</div></td>
              <td><span className={`pill ${x.state === 'ok' ? 'ok' : 'warn'}`}>{STATE_L[x.state]}</span></td>
              <td className="muted">{x.who}</td><td className="muted" style={{ fontSize: 12.5 }}>{x.state === 'ok' ? '—' : x.gap}</td></tr>
          ))}
        </tbody></table></div></div> : null}
      <div className="int-list">{INTL.map(([k, l]) => {
        const x = b.integrations[k] || { state: 'off' };
        return (
          <div className="int" key={k}><b><span className={`state-dot ${x.state}`}></span>{l}</b><span className="muted">{x.detail || x.state}</span>
            {k === 'billz' && x.state !== 'demo' ? <button className="btn sm" type="button" id="billzSync" disabled={syncing} onClick={billzSync}>{syncing ? 'Sinxronlanmoqda…' : 'Hozir sinxronlash'}</button> : null}
            {k === 'ai' && isLead ? <button className={`btn sm ${x.state === 'ok' ? '' : 'primary'}`} type="button" id="aiKeyBtn" onClick={aiKey}>{x.state === 'ok' ? 'Kalitni almashtirish' : 'Gemini kalitini kiritish'}</button> : null}
          </div>
        );
      })}</div>
      {b.bot ? <div className="panel"><div className="panel-head"><h2>Mijozni botga ulash</h2><span className="muted">Keshbek va yangi tovar xabarlari faqat botga ulangan va rozilik bergan mijozga boradi</span></div>
        <div className="row-actions"><input className="mono" id="botLink" ref={botLink} readOnly value={`https://t.me/${b.bot}?start=keshbek`} style={{ flex: 1, minWidth: 240 }} />
          <button className="btn sm" type="button" id="copyBot" onClick={copyBot}>Nusxalash</button></div>
        <p className="lead" style={{ fontSize: 13 }}>Kassada: «Keshbekingizni Telegram’da ko‘rish uchun shu havolaga kiring va raqamingizni ulashing». Havoladan QR kod yasab, kassa oynasiga yoki chek shabloniga qo‘ying. Mijoz botni ochib «Raqamni ulashish» tugmasini bosadi — tizim uni BILLZ bilan solishtiradi.</p></div> : null}
      <div className="panel">
        <div className="panel-head"><h2>Akkauntlar</h2><span className="muted">AI yoqish/to‘xtatish, bosqich va avtojavob — <a href="#agent">AI agent</a> sahifasida. Yangi ulangan akkaunt «Kuzatish» bosqichida boshlanadi.</span></div>
        {b.accounts.length ? b.accounts.map(a => (
          <div className="set-row" key={a.id}>
            <div className="set-name"><Brand ch={a.channel} /><div>{a.name} {a.is_demo ? <span className="demo-tag">demo</span> : null}<div className="set-sub">{a.channel === 'tg' ? (a.can_reply ? 'Javob huquqi bor' : 'Javob huquqi YO‘Q — Telegram Business sozlamasida bering') : a.channel === 'demo' ? 'Tashqariga hech narsa yubormaydi' : ''}</div></div></div>
            <div className="row-actions"><span className={`pill ${a.ai_enabled ? 'ai' : 'bad'}`}>AI: {a.ai_enabled ? `${ROLL_L[a.rollout]} · ${MODE_L[a.mode]}` : 'to‘xtatilgan'}</span><a className="btn sm" href="#agent">Boshqarish</a></div>
            <div className="row-actions"><label className="field" style={{ minWidth: 140 }}><span>Filial</span>
              <Select key={`b${a.id}-${a.branch_id}`} data-accbranch={a.id} defaultValue={a.branch_id ?? ''} onChange={e => saveAcc(a.id, { branch_id: Number(e.target.value) || null })}><option value="">—</option>{b.branches.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></label>
              <label className="field" style={{ minWidth: 140 }}><span>Mas’ul</span>
                <Select key={`o${a.id}-${a.owner_user_id}`} data-accowner={a.id} defaultValue={a.owner_user_id ?? ''} onChange={e => saveAcc(a.id, { owner_user_id: Number(e.target.value) || null })}><option value="">—</option>{b.users.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></label></div>
          </div>
        )) : <div className="banner warn"><div><b>Hali akkaunt ulanmagan.</b> Sotuvchi Telegram’da: Sozlamalar → Telegram Business → Chat-botlar → <b>@{b.bot || 'sotuv_boti'}</b> ni qo‘shadi va «Xabarlarga javob berish» huquqini beradi (Telegram Premium kerak).</div></div>}
      </div>
      <form className="panel" id="setForm" key={ver} onSubmit={submit}>
        <div className="panel-head"><h2>Qoidalar</h2><span className="tag-test">Sinov qiymatlari · ish boshida tasdiqlanadi</span></div>
        <div className="form-grid">
          {num('Kechikish chegarasi T (soniya)', 'T_seconds', 's_T', 15, 3600)}
          <label className="field"><span>Tungi avtojavob</span><Select name="night_autoreply" id="s_night" defaultValue={s.night_autoreply ? 'true' : 'false'}><option value="true">yoqilgan</option><option value="false">o‘chiq</option></Select></label>
          <label className="field"><span>Ish vaqti boshlanishi</span><input type="time" name="work_from" id="s_wf" defaultValue={s.work_from} /></label>
          <label className="field"><span>Ish vaqti tugashi</span><input type="time" name="work_to" id="s_wt" defaultValue={s.work_to} /></label>
          <label className="field"><span>Ertalabki topshirish</span><input type="time" name="morning_handover" id="s_mh" defaultValue={s.morning_handover} /></label>
          {num('Kichik buyurtma — maksimal kutish (daq)', 'small_max_wait_minutes', 's_sw', 1)}
          {num('Katta buyurtma: pozitsiyalar ≥', 'big_positions', 's_bp', 1)}
          {num('Katta buyurtma: dona ≥', 'big_qty', 's_bq', 1)}
          {num('Katta buyurtma: toifalar ≥', 'big_categories', 's_bc', 1)}
          {num('Katta buyurtma: summa ≥ (0 — hisobga olinmaydi)', 'big_amount', 's_ba2', 0)}
          {num('Qabul qilinmasa zaxiraga (daq)', 'big_accept_minutes', 's_ba', 1)}
          {num('1-ta’qib (AI) — soatdan keyin', 'followup_first_hours', 's_f1', 1)}
          {num('2-ta’qib (sotuvchi vazifasi) — kundan keyin', 'followup_second_days', 's_f2', 1)}
          {num('Qayta sotuv: kuniga ko‘pi bilan (vazifa)', 'resale_daily_limit', 's_rdl', 0, 500)}
          <label className="field"><span>Hisob valyutasi (BILLZ summalari)</span><Select name="currency" id="s_cur" defaultValue={s.currency === 'USD' ? 'USD' : 'UZS'}><option value="UZS">so‘m (UZS)</option><option value="USD">dollar (USD)</option></Select></label>
        </div>
        <div className="row-actions"><button className="btn primary" type="submit">Saqlash</button></div>
      </form>
      <div className="grid-2e">
        <div className="panel"><div className="panel-head"><h2>O‘zgarishlar jurnali</h2></div>
          <div className="chlog">{r.changes.length ? r.changes.map((c, i) => <div key={i}><span className="mono muted">{fmtDT(c.at)}</span><span>{c.who} · {c.what}</span></div>) : <span className="muted">Hali o‘zgarish yo‘q</span>}</div></div>
        <div className="panel"><div className="panel-head"><h2>Demo ma’lumot</h2></div>
          <p className="lead" style={{ fontSize: 13 }}>Demo akkaunt tashqariga hech narsa yubormaydi: taymer, «O‘zim olaman» va AI javobini xavfsiz sinash uchun. Haqiqiy ishga o‘tishda o‘chiring.</p>
          <div className="row-actions">{b.demo ? <button className="btn" type="button" id="demoOff" onClick={demoOff}>Demo ma’lumotni o‘chirish</button> : <button className="btn" type="button" id="demoOn" onClick={demoOn}>Demo ma’lumotni yuklash</button>}</div></div>
      </div>
    </>
  );
}
