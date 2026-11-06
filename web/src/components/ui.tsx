'use client';
import { useState } from 'react';
import { initials } from '@/lib/format';

/* Ikonlar (app.js dagi IC / svg / BRAND / brand / chBadge) */
export const IC: Record<string, string> = {
  chat: '<path d="M4 5.5h16v11H10l-4.5 3.5v-3.5H4z"/>',
  more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
  broom: '<path d="M14 3l7 7M11.5 5.5l7 7M8 9l7 7-4.5 4.5a2 2 0 0 1-2.8 0L3.5 16.3a2 2 0 0 1 0-2.8z"/>',
  trash: '<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v6M14 11v6"/>',
  quyosh: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"/>',
  oy: '<path d="M20 13.5A8 8 0 0 1 10.5 4a8 8 0 1 0 9.5 9.5z"/>',
  tizim: '<rect x="3" y="5" width="18" height="12" rx="2"/><path d="M9 20.5h6M12 17v3.5"/>',
  refresh: '<path d="M19.5 9A8 8 0 0 0 5 7.2M4.5 3.5v4h4M4.5 15A8 8 0 0 0 19 16.8M19.5 20.5v-4h-4"/>',
  book: '<path d="M5 4.5h10.5a2 2 0 0 1 2 2V20H7a2 2 0 0 1-2-2z"/><path d="M5 18a2 2 0 0 1 2-2h10.5M9 8.5h5"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c.8-3.4 3.2-5 6-5s5.2 1.6 6 5M16 5a3 3 0 0 1 0 6M18 15c1.5.6 2.6 2.2 3 5"/>',
  log: '<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/>',
  tg: '<path d="M20.5 4.5 3.5 11.2l5.6 1.9 2 6 3.1-3.9 4.6 3.4z"/><path d="m9.1 13.1 8.2-5.6"/>',
  ig: '<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r=".6"/>',
  demo: '<rect x="4" y="4" width="16" height="16" rx="3" stroke-dasharray="3 2.5"/><path d="M9 12h6"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>',
  phone: '<path d="M6.5 3.5h3l1.5 4-2 1.3a10 10 0 0 0 6.2 6.2l1.3-2 4 1.5v3a2 2 0 0 1-2 2A16 16 0 0 1 4.5 5.5a2 2 0 0 1 2-2z"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  card: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.6-1.6 1.7-2.4 3-2.4s2.4.8 3 2.4M14 10h4M14 13h3"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  spark: '<path d="M13 2.5 5.5 13.5h6L10.5 21.5 18.5 10h-6z"/>',
  chart: '<path d="M4 20h16M7 20v-6M12 20V6M17 20v-9"/>',
  aperture: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5 16 12M19.36 7.75 14 15.46M19.36 16.25 10 15.46M12 20.5 8 12M4.64 16.25 10 8.54M4.64 7.75 14 8.54"/>',
  send: '<path d="M4.5 12h14M13 6.5l5.5 5.5-5.5 5.5"/>'
};

/** Chiziqli ikona: `<svg class="ic">` */
export function Icon({ name }: { name: string }) {
  return <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: IC[name] || '' }} />;
}

/* Haqiqiy rangli kanal belgilari: Telegram — ko‘k doira oq samolyot bilan (Simple Icons, CC0), Instagram — rangli kvadratda oq kamera */
export const BRAND: Record<string, string> = {
  tg: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#229ED9" d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>',
  ig: '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" aria-hidden="true"><rect x="4.5" y="4.5" width="15" height="15" rx="4.5"/><circle cx="12" cy="12" r="3.4"/><circle cx="16.6" cy="7.4" r="1" fill="#fff" stroke="none"/></svg>'
};

/** Kanal belgisi: tg/ig — rangli, boshqasi (demo) — oddiy chiziqli ikona (app.js `brand`) */
export function Brand({ ch }: { ch: string }) {
  return BRAND[ch] ? <span className={`brand-ic b-${ch}`} dangerouslySetInnerHTML={{ __html: BRAND[ch] }} /> : <Icon name={ch} />;
}

/** Mijoz rasmi burchagidagi kichik kanal belgisi (app.js `chBadge`) */
export function ChBadge({ ch }: { ch: string }) {
  return BRAND[ch] ? <span className="ch ch-brand"><Brand ch={ch} /></span> : <span className="ch"><Icon name={ch} /></span>;
}

/** Profil rasmi (Telegram/Instagram) bosh harflar ustida; yuklanmasa o‘chiriladi va bosh harflar ko‘rinadi */
export function AvaImg({ src }: { src?: string | null }) {
  const [bad, setBad] = useState(false);
  if (!src || bad) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="ava-img" src={src} alt="" loading="lazy" decoding="async" onError={() => setBad(true)} />;
}

/** `<span class="avatar {className}">BH [rasm] [kanal belgisi]</span>` — suhbatlar ro‘yxati, suhbat sarlavhasi, mijoz kartasi */
export function Avatar({ name, src, ch, className = '', id, ariaHidden }: { name?: string | null; src?: string | null; ch?: string; className?: string; id?: string; ariaHidden?: boolean }) {
  return <span className={`avatar ${className}`.trim()} id={id} aria-hidden={ariaHidden ? true : undefined}>{initials(name)}<AvaImg src={src} />{ch ? <ChBadge ch={ch} /> : null}</span>;
}
