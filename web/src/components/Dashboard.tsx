'use client';
import { useEffect, useState } from 'react';
import { api, isUnauthorized } from '@/lib/api';
import type { Boot } from '@/lib/types';
import { AppProvider } from './AppContext';
import { Shell } from './Shell';

/* Panel kirishi: /api/bootstrap 401 qaytarsa api() o‘zi /login ga yo‘naltiradi. Boshqa xatoda — qayta urinish tugmasi. */
export function Dashboard() {
  const [boot, setBoot] = useState<Boot | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setFailed(false);
    api<Boot>('/api/bootstrap').then(b => { if (live) setBoot(b); }).catch(e => { if (live && !isUnauthorized(e)) setFailed(true); });
    return () => { live = false; };
  }, [attempt]);

  if (boot) return <AppProvider initialBoot={boot}><Shell /></AppProvider>;
  if (failed) {
    return (
      <div className="login-wrap"><div className="login">
        <h1>Aloqa yo‘q</h1>
        <p className="login-sub">Internetni tekshirib, qayta urinib ko‘ring.</p>
        <button className="btn primary" type="button" onClick={() => setAttempt(a => a + 1)} style={{ justifyContent: 'center' }}>Qayta urinish</button>
      </div></div>
    );
  }
  return null;
}
