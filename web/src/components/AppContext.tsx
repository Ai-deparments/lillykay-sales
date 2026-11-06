'use client';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, MouseEvent, ReactNode } from 'react';
import { api, errorText } from '@/lib/api';
import { clockNow as clockNowFn, setClockOffset, setCurrency } from '@/lib/format';
import { useHash } from '@/lib/hooks';
import type { Boot, ModalSpec, ToastKind } from '@/lib/types';

/** Bilim bazasiga o‘tishda qidiruv va holat filtri (Qayta sotuv → «Kartani to‘ldirish») */
export interface CatalogSeed { q: string; status: string }

export interface AppCtx {
  boot: Boot;
  /** `/api/bootstrap` ni qayta o‘qiydi (Sozlamalar/Xodimlar sahifalari ochilganda va o‘zgarishdan keyin) */
  reloadBoot: () => Promise<Boot>;
  /** rol admin yoki rahbar */
  isLead: boolean;
  /** Server soatiga tuzatilgan hozirgi vaqt (ms) */
  clockNow: () => number;
  /** API javobidagi `now` bilan soat farqini yangilash (app.js: `S.offset = r.now - Date.now()`) */
  syncClock: (serverNow: number) => void;
  toast: (text: string, kind?: ToastKind) => void;
  /** API xatosini toast qilib ko‘rsatadi — `.catch(fail)` uchun */
  fail: (e: unknown) => void;
  openModal: (spec: ModalSpec) => void;
  closeModal: () => void;
  /** `location.hash` ("#suhbat/12", "#katalog"; yo‘q bo‘lsa "") */
  hash: string;
  /** Joriy bo‘lim kaliti (suhbatlar, vazifalar, ...) */
  route: string;
  navigate: (hash: string) => void;
  badges: { wait: number };
  setBadge: (k: 'wait', n: number) => void;
  catalogSeed: CatalogSeed | null;
  setCatalogSeed: (s: CatalogSeed | null) => void;
}

const Ctx = createContext<AppCtx | null>(null);
export function useApp(): AppCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp: AppProvider tashqarisida');
  return c;
}

export const SCREENS: Record<string, [string, string]> = {
  suhbatlar: ['Suhbatlar', 'Telegram va Instagram — bitta navbat'],
  katalog: ['Bilim bazasi', 'Mahsulot kartalari — agent faqat shu yerdan gapiradi'],
  agent: ['AI agent', 'Kanal bo‘yicha yoqish, to‘xtatish va bosqichlar'],
  xodimlar: ['Xodimlar va filiallar', 'Rollar, Telegram bildirishnomalari'],
  jurnal: ['Audit jurnali', 'Har bir avtomatik amal']
};
/** Faqat rahbar/admin ko‘radigan bo‘limlar */
export const LEAD_ONLY = ['agent', 'xodimlar'];

/** app.js `route()`: hash → bo‘lim kaliti (`#suhbat/12` → suhbatlar; noma’lum → suhbatlar) */
export function routeOf(hash: string): string {
  const h = (hash || '#suhbatlar').slice(1);
  return h.startsWith('suhbat/') ? 'suhbatlar' : (SCREENS[h] ? h : 'suhbatlar');
}

interface ToastItem { id: number; text: string; kind: string }
interface ModalState { id: number; spec: ModalSpec }

export function AppProvider({ initialBoot, children }: { initialBoot: Boot; children: ReactNode }) {
  const [boot, setBoot] = useState<Boot>(initialBoot);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [modal, setModal] = useState<ModalState | null>(null);
  const [badges, setBadges] = useState({ wait: 0 });
  const [catalogSeed, setCatalogSeed] = useState<CatalogSeed | null>(null);
  const hash = useHash();
  const seq = useRef(0);
  const modalId = useRef(0);

  // Valyuta va soat — modul darajasida (format.ts); render paytida o‘rnatiladi, shuning uchun bolalar yangi qiymatni ko‘radi
  setCurrency(boot.settings?.currency);
  const syncClock = useCallback((serverNow: number) => setClockOffset(serverNow), []);
  const firstBoot = useRef(true);
  if (firstBoot.current) { firstBoot.current = false; setClockOffset(initialBoot.now); }

  const reloadBoot = useCallback(async () => {
    const b = await api<Boot>('/api/bootstrap');
    setClockOffset(b.now);
    setCurrency(b.settings?.currency);
    setBoot(b);
    return b;
  }, []);

  const isLead = ['admin', 'rahbar'].includes(boot.me.role);
  useEffect(() => { document.body.dataset.role = isLead ? 'lead' : 'seller'; }, [isLead]);

  const toast = useCallback((text: string, kind: ToastKind = '') => {
    const id = ++seq.current;
    setToasts(t => [...t, { id, text, kind }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 5000);
  }, []);
  const fail = useCallback((e: unknown) => { toast(errorText(e)); }, [toast]);

  const openModal = useCallback((spec: ModalSpec) => { setModal({ id: ++modalId.current, spec }); }, []);
  const closeModal = useCallback(() => setModal(null), []);

  const navigate = useCallback((h: string) => { location.hash = h; }, []);
  const setBadge = useCallback((k: 'wait', n: number) => setBadges(b => (b[k] === n ? b : { ...b, [k]: n })), []);

  const value = useMemo<AppCtx>(() => ({
    boot, reloadBoot, isLead, clockNow: clockNowFn, syncClock, toast, fail, openModal, closeModal, hash, route: routeOf(hash), navigate,
    badges, setBadge, catalogSeed, setCatalogSeed
  }), [boot, reloadBoot, isLead, syncClock, toast, fail, openModal, closeModal, hash, navigate, badges, setBadge, catalogSeed]);

  /* Modal: tashqariga yoki [data-close] ga bosilsa yopiladi; forma yuborilganda FormData → onSubmit */
  const onBack = (e: MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t === e.currentTarget || t.closest('[data-close]')) setModal(null);
  };
  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!modal) return;
    const { id, spec } = modal;
    if (!spec.onSubmit) { setModal(null); return; }
    const data = Object.fromEntries([...new FormData(e.currentTarget).entries()].map(([k, v]) => [k, typeof v === 'string' ? v : v.name])) as Record<string, string>;
    try {
      const keep = await spec.onSubmit(data);
      // onSubmit ichida boshqa oyna ochilgan bo‘lsa (masalan, «Havola tayyor») — uni yopmaymiz
      if (!keep && modalId.current === id) setModal(null);
    } catch (err) { fail(err); }
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <div id="modalRoot">
        {modal && (modal.spec.bare
          ? <div className="modal-back" onClick={onBack}><div className={`modal${modal.spec.wide ? ' wide' : ''}`}>{modal.spec.content}</div></div>
          : <div className="modal-back" onClick={onBack}>
              <form className={`modal${modal.spec.wide ? ' wide' : ''}`} id="mForm" key={modal.id} onSubmit={onSubmit} ref={f => { if (f && !f.dataset.focused) { f.dataset.focused = '1'; (f.querySelector('input, textarea, select') as HTMLElement | null)?.focus(); } }}>
                {modal.spec.content}
                <div className="row-actions" style={{ justifyContent: 'flex-end' }}>
                  {modal.spec.onSubmit
                    ? <><button className="btn ghost" type="button" data-close>Bekor</button><button className="btn primary" type="submit">Saqlash</button></>
                    : <button className="btn primary" type="button" data-close>Yopish</button>}
                </div>
              </form>
            </div>)}
      </div>
      <div className="toasts" id="toasts" aria-live="polite">
        {toasts.map(t => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
      </div>
    </Ctx.Provider>
  );
}
