'use client';
import { useEffect, useState } from 'react';
import { Icon } from './ui';

/* Ko‘rinish: tizim / yorug‘ / qorong‘i. Tanlov brauzerda saqlanadi (pb_theme) va sahifa chizilgunga qadar /theme.js qo‘yadi. */
const THEMES: [string, string, string][] = [['auto', 'Tizim bo‘yicha', 'tizim'], ['light', 'Yorug‘', 'quyosh'], ['dark', 'Qorong‘i', 'oy']];
const getTheme = (): string => { try { return localStorage.getItem('pb_theme') || 'auto'; } catch { return 'auto'; } };
function applyTheme(v: string): void {
  try { localStorage.setItem('pb_theme', v); } catch { /* private rejim */ }
  if (v === 'light' || v === 'dark') document.documentElement.dataset.theme = v;
  else document.documentElement.dataset.theme = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeButton({ compact = false }: { compact?: boolean }) {
  const [theme, setTheme] = useState('auto');
  useEffect(() => { setTheme(getTheme()); }, []);
  const [, label, icon] = THEMES.find(t => t[0] === theme) || THEMES[0];
  const next = () => {
    const i = THEMES.findIndex(t => t[0] === getTheme());
    const v = THEMES[(i + 1) % THEMES.length][0];
    applyTheme(v);
    setTheme(v);
  };
  return <button className={compact ? 'theme-chip' : 'btn sm'} type="button" id="btnTheme" title={`Ko‘rinish: ${label} — o‘zgartirish uchun bosing`} aria-label={`Ko‘rinish: ${label}. O‘zgartirish uchun bosing`} onClick={next}><Icon name={icon} />{compact ? null : label}</button>;
}
