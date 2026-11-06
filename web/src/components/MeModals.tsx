'use client';
import { api } from '@/lib/api';
import { Icon } from './ui';
import { useState } from 'react';
import type { AppCtx } from './AppContext';
import { PRESETS, loadChatStyle, saveChatStyle } from '@/lib/chatStyle';
import type { ChatStyle } from '@/lib/chatStyle';

const ROLE: Record<string, string> = { admin: 'Administrator', rahbar: 'Sotuv rahbari', filial: 'Filial rahbari', sotuvchi: 'Sotuvchi' };

/** «Telegram ulash»: shaxsiy bildirishnoma havolasi (app.js #btnTg) */
export async function openTelegramModal(app: AppCtx): Promise<void> {
  const { boot, openModal, fail } = app;
  const r = await api<{ link?: string }>(`/api/users/${boot.me.id}/tglink`, {}).catch(fail);
  if (!r) return;
  openModal({
    content: <>
      <h2>Telegram bildirishnomalari</h2>
      {boot.me.tg_linked ? <div className="banner ai">Telegram allaqachon ulangan. Qayta ulasangiz, yangi chat ishlatiladi.</div> : null}
      {r.link
        ? <><p className="lead" style={{ fontSize: '13.5px' }}>Havolani telefoningizda oching va <b>Start</b> bosing (1 soat amal qiladi):</p>
            <a className="pw-box" style={{ fontSize: 13, display: 'block', wordBreak: 'break-all' }} href={r.link} target="_blank" rel="noopener">{r.link}</a></>
        : <div className="banner warn">Bot hali ulanmagan — administrator bot tokenini kiritishi kerak.</div>}
    </>
  });
}

/** «Parol» (app.js #btnPw) */
export function openPasswordModal(app: AppCtx): void {
  app.openModal({
    content: <>
      <h2>Parolni o‘zgartirish</h2>
      <label className="field"><span>Joriy parol</span><input type="password" name="current" id="pw_cur" autoComplete="current-password" required /></label>
      <label className="field"><span>Yangi parol (kamida 8 belgi)</span><input type="password" name="password" id="pw_new" autoComplete="new-password" minLength={8} required /></label>
    </>,
    onSubmit: async d => { await api('/api/me/password', { current: d.current, password: d.password }); app.toast('Parol o‘zgardi'); }
  });
}

/** Telefonda chap ustun yashirinadi — shu tugmalar «Men» oynasida bo‘ladi (app.js #btnMe) */
export function openMeModal(app: AppCtx, h: { logout: () => void }): void {
  const me = app.boot.me;
  const pick = (fn: () => void) => () => { app.closeModal(); fn(); };
  app.openModal({
    content: <>
      <h2>{me.name}</h2>
      <p className="lead" style={{ fontSize: '13.5px' }}>{ROLE[me.role]}{me.tg_linked ? ' · Telegram ulangan' : ' · Telegram ulanmagan'}</p>
      <button className="btn install-btn install-rail" type="button" data-me="app" data-install><Icon name="download" />Ilovani yuklab olish</button>
      <div className="row-actions">
        <button className="btn" type="button" data-me="tg" onClick={pick(() => { void openTelegramModal(app); })}>Telegram ulash</button>
        <button className="btn" type="button" data-me="pw" onClick={pick(() => openPasswordModal(app))}>Parol</button>
        <a className="btn ghost" href="/yoriqnoma">Yo‘riqnoma</a>
        <button className="btn ghost" type="button" data-me="out" onClick={pick(h.logout)}>Chiqish</button>
      </div>
    </>
  });
}

/* «Chat ko‘rinishi»: xabar ranglari, chegara va burchak — xodim o‘zi sozlaydi, darhol qo‘llanadi (faqat shu brauzerda) */
function ChatStyleForm() {
  const [st, setSt] = useState<ChatStyle>(loadChatStyle);
  const upd = (patch: ChatStyle) => { const n = { ...st, ...patch }; setSt(n); saveChatStyle(n); };
  const pick = (s: ChatStyle) => { setSt(s); saveChatStyle(s); };
  const dark = typeof document !== 'undefined' && document.documentElement.dataset.theme === 'dark';
  const DEF = dark ? { me: '#4a3410', client: '#1b1b23', meBorder: '#8a5d16', clientBorder: '#2e2e3a' } : { me: '#ffe9c9', client: '#ffffff', meBorder: '#f1c47e', clientBorder: '#dcdce8' };
  const col = (label: string, key: 'me' | 'client' | 'meBorder' | 'clientBorder') => (
    <label className="cs-color"><span>{label}</span><input type="color" value={st[key] || DEF[key]} onChange={e => upd({ [key]: e.target.value })} /></label>
  );
  return (
    <>
      <h2>Chat ko‘rinishi</h2>
      <div className="cs-preview" aria-hidden="true">
        <div className="msg c"><div className="txt">Salom! Narxi qancha?</div><div className="msg-meta"><span className="mono">10:21</span></div></div>
        <div className="msg s"><div className="txt">Assalomu alaykum, hozir aytaman.</div><div className="msg-meta"><span className="mono">10:22</span></div></div>
      </div>
      <div className="cs-presets">{PRESETS.map(p => <button key={p.name} type="button" className="chip" onClick={() => pick(p.s)}><i style={{ background: p.s.me, borderColor: p.s.meBorder }} />{p.name}</button>)}</div>
      <div className="cs-grid">
        {col('Mening xabarim', 'me')}{col('Mijoz xabari', 'client')}
        {col('Mening chegaram', 'meBorder')}{col('Mijoz chegarasi', 'clientBorder')}
      </div>
      <label className="cs-range"><span>Chegara qalinligi: <b>{st.borderW ?? 1} px</b></span><input type="range" min={0} max={3} step={1} value={st.borderW ?? 1} onChange={e => upd({ borderW: Number(e.target.value) })} /></label>
      <label className="cs-range"><span>Burchaklar: <b>{st.radius ?? 14} px</b></span><input type="range" min={4} max={24} step={2} value={st.radius ?? 14} onChange={e => upd({ radius: Number(e.target.value) })} /></label>
      <div className="row-actions"><button className="btn ghost" type="button" onClick={() => pick({})}>Asl holiga qaytarish</button></div>
    </>
  );
}
export function openChatStyleModal(app: AppCtx): void { app.openModal({ content: <ChatStyleForm /> }); }
