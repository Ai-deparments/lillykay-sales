'use client';
import type { Integration } from '@/lib/types';
import { useApp } from './AppContext';
import { Brand } from './ui';

/* Yuqori o‘ngdagi integratsiya holati (app.js renderTopStatus) */
export function TopStatus() {
  const { boot } = useApp();
  const i = boot.integrations;
  const st = (x: Integration) => x.state === 'ok' ? '' : x.state === 'demo' || x.state === 'pending' ? 'warn' : 'bad';
  return (
    <span id="topStatus">
      {i.instagram ? <span className="status-chip" title={i.instagram.detail}><span className={`dot ${st(i.instagram)}`.trim()} /><Brand ch="ig" />Instagram</span> : null}
      <span className="status-chip" title={i.ai.detail}><span className={`dot ${st(i.ai)}`.trim()} />AI</span>
      {boot.demo ? <span className="demo-chip">Demo ma’lumot yoqilgan</span> : null}
    </span>
  );
}
