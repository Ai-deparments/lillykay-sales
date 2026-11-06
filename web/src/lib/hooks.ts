'use client';
import { useEffect, useRef, useState } from 'react';

/** `setInterval` — har renderda eng so‘nggi `fn` chaqiriladi; `ms === null` bo‘lsa to‘xtaydi */
export function useInterval(fn: () => void, ms: number | null): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (ms == null) return;
    const id = setInterval(() => ref.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}

/** Har `ms` da qayta chizish uchun hisoblagich (taymerlar: «AI · 1:24») */
export function useTick(ms = 1000): number {
  const [n, set] = useState(0);
  useInterval(() => set(x => x + 1), ms);
  return n;
}

/** `location.hash` (masalan "#suhbat/12"; bo‘sh bo‘lsa ""). SSR’da "" */
export function useHash(): string {
  const [h, set] = useState('');
  useEffect(() => {
    const on = () => set(location.hash);
    on();
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return h;
}

/** Qiymat o‘zgarmay `ms` turgandan keyin yangilanadi (qidiruv maydonlari) */
export function useDebounced<T>(value: T, ms: number): T {
  const [v, set] = useState(value);
  useEffect(() => { const id = setTimeout(() => set(value), ms); return () => clearTimeout(id); }, [value, ms]);
  return v;
}
