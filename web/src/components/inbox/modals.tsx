'use client';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from '@/components/AppContext';
import type { ConvFull, PickProduct } from './types';
import { Select } from '../Select';

export function TeachContent({ question, answer }: { question: string; answer: string }) {
  return (
    <>
      <h2>Agentni o‘rgatish</h2><p className="lead" style={{ fontSize: 13.5 }}>Mijoz shu savolni (yoki mazmunan o‘xshashini) bersa, agent endi siz yozgan mazmunda javob beradi. Narx va qoldiq baribir BILLZ’dan olinadi.</p>
      <label className="field"><span>Mijoz savoli</span><textarea name="question" id="t_q" required defaultValue={question}></textarea></label>
      <label className="field"><span>To‘g‘ri javob</span><textarea name="answer" id="t_a" required style={{ minHeight: 110 }} defaultValue={answer}></textarea></label>
    </>
  );
}

/** «Tovar rasmi» oynasi: nom bo‘yicha qidirish va mijozga yuborish */
export function PhotoPicker({ items, convId, onSent }: { items: PickProduct[]; convId: number; onSent: () => void }) {
  const { fail, toast, closeModal } = useApp();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState<number | null>(null);
  const t = q.trim().toLowerCase();
  const rows = items.filter(x => !t || x.name.toLowerCase().includes(t)).slice(0, 40);
  const send = async (id: number) => {
    setBusy(id);
    const r = await api<{ ok?: boolean; why?: string }>(`/api/conversations/${convId}/photo`, { product_id: id }).catch(fail);
    if (r?.ok) { closeModal(); toast('Rasm yuborildi'); onSent(); }
    else { setBusy(null); toast(r?.why || 'Yuborilmadi'); }
  };
  return (
    <>
      <h2>Mijozga tovar rasmini yuborish</h2>
      <label className="field"><span>Tovar</span><input id="phq" placeholder="Nom bo‘yicha qidiring" autoComplete="off" value={q} onChange={e => setQ(e.target.value)} /></label>
      <div className="tbl" style={{ maxHeight: 320, overflow: 'auto' }}><table><tbody id="phlist">
        {rows.length ? rows.map(x => (
          <tr key={x.id}><td><img src={`/api/products/${x.id}/photo`} alt="" style={{ width: 46, height: 46, objectFit: 'cover', borderRadius: 8 }} /></td>
            <td>{x.name}</td><td className="n"><button className="btn sm primary" type="button" data-sendphoto={x.id} disabled={busy === x.id} onClick={() => send(x.id)}>Yuborish</button></td></tr>
        )) : <tr><td className="muted">Topilmadi</td></tr>}
      </tbody></table></div>
    </>
  );
}

export function EditCardContent({ c }: { c: ConvFull }) {
  const f = (k: keyof ConvFull, l: string, ta?: boolean) => {
    const v = String(c[k] ?? '');
    return <label className={`field ${ta ? 'wide' : ''}`}><span>{l}</span>{ta ? <textarea name={k} id={`f_${k}`} defaultValue={v}></textarea> : <input name={k} id={`f_${k}`} defaultValue={v} />}</label>;
  };
  return (
    <>
      <h2>Suhbat kartasi</h2><div className="form-grid">
        {f('asked', 'So‘ralgan tovar')}{f('budget', 'Budjet')}{f('purpose', 'Maqsad')}
        <label className="field"><span>Manba</span><Select name="source" id="f_source" defaultValue={c.source || ''}>{['', 'tavsiya', 'reklama', 'organik', 'mavjud mijoz'].map(s => <option key={s} value={s}>{s || 'aniqlanmagan'}</option>)}</Select></label>
        {f('source_note', 'Manba izohi (masalan, kim tavsiya qildi)')}{f('next_step', 'Keyingi qadam')}
        {f('note', 'Eslatma', true)}</div>
    </>
  );
}
