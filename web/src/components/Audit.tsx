'use client';
import { useCallback, useEffect, useState } from 'react';
import { api, isUnauthorized } from '@/lib/api';
import { fmtDT } from '@/lib/format';
import { useApp } from '@/components/AppContext';

interface AuditRow { at: number; kind: string; actor: string; action: string; object?: string | null; data_used?: string | null; result?: string | null }
const CLS: Record<string, string> = { ai: 'pill ai', staff: 'pill acc', sys: 'pill' };

export function Audit({ active }: { active: boolean }) {
  const { fail } = useApp();
  const [kind, setKind] = useState('all');
  const [items, setItems] = useState<AuditRow[] | null>(null);
  const load = useCallback(async () => {
    try { setItems((await api<{ items: AuditRow[] }>(`/api/audit?kind=${kind}`)).items); } catch (e) { if (!isUnauthorized(e)) fail(e); }
  }, [kind, fail]);
  useEffect(() => { if (active) void load(); }, [active, load]);
  if (!items) return null;
  return (
    <>
      <p className="lead">Har bir avtomatik amal: vaqt, bajaruvchi, amal, ishlatilgan ma’lumot va natija. Qayta ishga tushirish takror xabar yaratmaydi — bu ham shu yerda ko‘rinadi.</p>
      <div className="row-actions"><div className="chips">{([['all', 'Hammasi'], ['ai', 'AI agentlar'], ['staff', 'Xodimlar'], ['sys', 'Tizim va integratsiya']] as [string, string][]).map(([k, l]) => (
        <button key={k} className="chip" type="button" data-j={k} aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>))}</div>
        <span style={{ marginLeft: 'auto' }} className="row-actions"><a className="btn sm ghost" href="/api/export/audit.csv">Jurnal CSV</a><a className="btn sm ghost" href="/api/export/suhbatlar.csv">Suhbatlar CSV</a></span></div>
      <div className="panel" style={{ padding: '6px 8px' }}><div className="tbl"><table><thead><tr><th>Vaqt</th><th>Bajaruvchi</th><th>Amal</th><th>Ma’lumot</th><th>Natija</th></tr></thead><tbody>
        {items.map((a, i) => (
          <tr key={i}><td className="mono">{fmtDT(a.at)}</td><td><span className={CLS[a.kind]}>{a.actor}</span></td>
            <td>{a.action}{a.object?.startsWith('conv:') ? <> <a className="linkish" href={`#suhbat/${a.object.slice(5)}`}>suhbat</a></> : null}</td>
            <td className="muted">{a.data_used || ''}</td><td>{a.result || ''}</td></tr>))}
      </tbody></table></div></div>
    </>
  );
}
