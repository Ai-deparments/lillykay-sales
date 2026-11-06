'use client';
import { useEffect, useRef, useState } from 'react';
import { BRAND, LOGO_SVG } from '@/lib/brand';
import type { ReactNode } from 'react';
import { api } from '@/lib/api';
import { initials } from '@/lib/format';
import { LEAD_ONLY, SCREENS, useApp } from './AppContext';
import { Icon } from './ui';
import { TopStatus } from './TopStatus';
import { ThemeButton } from './ThemeButton';
import { openChatStyleModal, openMeModal, openPasswordModal, openTelegramModal } from './MeModals';
import { applyChatStyle } from '@/lib/chatStyle';
import { Inbox } from './inbox/Inbox';
import { Catalog } from './Catalog';
import { Agent } from './Agent';
import { Users } from './Users';
import { Audit } from './Audit';

export const ROLE_L: Record<string, string> = { admin: 'Administrator', rahbar: 'Sotuv rahbari', filial: 'Filial rahbari', sotuvchi: 'Sotuvchi' };

function NavItem({ href, ic, route, children, className = '' }: { href: string; ic: string; route: string; children: ReactNode; className?: string }) {
  return <a className={`nav-item ${className}`.trim()} href={`#${href}`} data-ic={ic} aria-current={route === href ? 'page' : undefined}><Icon name={ic} />{children}</a>;
}

export function Shell() {
  const { boot, isLead, route, hash, navigate, badges } = useApp();
  const me = boot.me;

  // Rahbar bo‘limlariga sotuvchi kira olmaydi (app.js onRoute)
  useEffect(() => { if (LEAD_ONLY.includes(route) && !isLead) navigate('#suhbatlar'); }, [route, isLead, hash, navigate]);

  // Uzun tushuntirish matnlari (.lead) 2 qatorda yig‘iladi; bosilsa to‘liq ochiladi (modal ichidagilar doim to‘liq)
  useEffect(() => {
    const h = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest?.('p.lead') as HTMLElement | null;
      if (el && !el.closest('.modal')) el.classList.toggle('open');
    };
    document.addEventListener('click', h);
    return () => document.removeEventListener('click', h);
  }, []);

  // Xodimning chat ranglari (brauzerda saqlangan) — ilova ochilganda qo‘llanadi
  useEffect(() => { applyChatStyle(); }, []);

  // Profil menyusi: tashqariga bosilsa yoki Esc bosilsa yopiladi
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!profileOpen) return;
    const down = (e: MouseEvent) => { if (!profileRef.current?.contains(e.target as Node)) setProfileOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setProfileOpen(false); };
    document.addEventListener('mousedown', down); document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [profileOpen]);

  const [scr, sub] = SCREENS[route];
  const act = (k: string) => route === k;

  const app = useApp();
  const logout = async () => { await api('/api/logout', {}); location.href = '/login'; };

  return (
    <div className="app">
      <aside className="rail" aria-label="Asosiy menyu">
        <div className="brand">
          <div className="brand-mark sun" dangerouslySetInnerHTML={{ __html: LOGO_SVG }} />
          <div><div className="brand-name">{BRAND.name}</div><div className="brand-sub">{BRAND.sub}</div></div>
        </div>
        <nav className="nav">
          <div className="nav-group">
            <div className="nav-label">Ish joyi</div>
            <NavItem href="suhbatlar" ic="chat" route={route}>Suhbatlar<span className="nav-badge" id="badgeWait" hidden={!badges.wait}>{badges.wait || ''}</span></NavItem>
            <NavItem href="katalog" ic="book" route={route}>Bilim bazasi</NavItem>
            <NavItem href="jurnal" ic="log" route={route} className="seller-only">Audit jurnali</NavItem>
          </div>
          <div className="nav-group lead-only">
            <div className="nav-label">Boshqaruv</div>
            <NavItem href="agent" ic="spark" route={route}>AI agent</NavItem>
            <NavItem href="xodimlar" ic="users" route={route}>Xodimlar va filiallar</NavItem>
            <NavItem href="jurnal" ic="log" route={route}>Audit jurnali</NavItem>
          </div>
        </nav>
        <div className="rail-foot" ref={profileRef}>
          {profileOpen ? <div className="profile-menu" role="menu">
            <button className="pm-item" type="button" role="menuitem" data-install title="Panelni kompyuterga alohida ilova qilib o‘rnatish"><Icon name="download" />Ilovani yuklab olish</button>
            <button className="pm-item" type="button" role="menuitem" id="btnTg" onClick={() => { setProfileOpen(false); void openTelegramModal(app); }}><Icon name="tg" />Telegram ulash{me.tg_linked ? <span className="pm-ok">ulangan</span> : null}</button>
            <button className="pm-item" type="button" role="menuitem" id="btnChatStyle" onClick={() => { setProfileOpen(false); openChatStyleModal(app); }}><Icon name="spark" />Chat ko‘rinishi</button>
            <button className="pm-item" type="button" role="menuitem" id="btnPw" onClick={() => { setProfileOpen(false); openPasswordModal(app); }}><Icon name="sliders" />Parolni o‘zgartirish</button>
            <a className="pm-item" role="menuitem" href="/yoriqnoma"><Icon name="book" />Yo‘riqnoma</a>
            <div className="pm-sep" />
            <button className="pm-item danger" type="button" role="menuitem" id="btnLogout" onClick={logout}><Icon name="back" />Chiqish</button>
          </div> : null}
          <button className="profile-btn" type="button" id="meBox" aria-haspopup="menu" aria-expanded={profileOpen} onClick={() => setProfileOpen(v => !v)}>
            <span className="me-ava" aria-hidden="true">{initials(me.name)}</span>
            <span className="me-txt"><b>{me.name}</b><span>{ROLE_L[me.role]}</span></span>
            <svg className="pm-chev" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m7 15 5-5 5 5" /></svg>
          </button>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div><h1 id="scrTitle">{scr}</h1><div className="sub" id="scrSub">{sub}</div></div>
          <div className="top-right"><TopStatus /><ThemeButton compact /><button className="btn sm only-mobile install-btn" type="button" data-install aria-label="Ilovani yuklab olish"><span data-ic="download"><Icon name="download" /></span>Ilova</button><button className="btn sm only-mobile" type="button" id="btnMe" aria-label="Mening hisobim" onClick={() => openMeModal(app, { logout })}>Men</button></div>
        </header>
        <div className="screens">
          <section className="screen" id="s-suhbatlar" hidden={!act('suhbatlar')}><Inbox active={act('suhbatlar')} /></section>
          <section className="screen" id="s-katalog" hidden={!act('katalog')}><div className="page" id="catalogPage"><Catalog active={act('katalog')} /></div></section>
          <section className="screen" id="s-agent" hidden={!act('agent')}><div className="page" id="agentPage"><Agent active={act('agent')} /></div></section>
          <section className="screen" id="s-xodimlar" hidden={!act('xodimlar')}><div className="page" id="usersPage"><Users active={act('xodimlar')} /></div></section>
          <section className="screen" id="s-jurnal" hidden={!act('jurnal')}><div className="page" id="auditPage"><Audit active={act('jurnal')} /></div></section>
        </div>
      </main>
    </div>
  );
}
