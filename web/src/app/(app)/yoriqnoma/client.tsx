'use client';
import { useEffect } from 'react';

/* Yo‘riqnoma faqat kirgan xodimlar uchun (eski server kirmaganni /login ga yo‘naltirardi): sessiya yo‘q bo‘lsa /login */
export function AuthGate() {
  useEffect(() => {
    fetch('/api/bootstrap').then(r => { if (r.status === 401) location.href = '/login'; }).catch(() => {});
  }, []);
  return null;
}

/* Chop etish tugmasi (eski yoriqnoma.js) */
export function PrintButton() {
  return <button className="btn sm ghost" type="button" id="btnPrint" onClick={() => window.print()}>Chop etish</button>;
}
