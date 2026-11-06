'use client';
import { DOWN } from '@/lib/shift';

/** Hafta kunlari checkboxlari (app.js `dowBoxes`); `val` — "1111100" yoki bo‘sh (hammasi belgilangan) */
export function DowBoxes({ val, pre }: { val?: string | null; pre: string }) {
  return (
    <div className="chips" style={{ gap: 4 }}>
      {DOWN.map((d, i) => (
        <label className="chip" style={{ cursor: 'pointer' }} key={i}>
          <input type="checkbox" name={`${pre}${i}`} defaultChecked={!val || val[i] === '1'} style={{ marginInlineEnd: 4 }} />{d}
        </label>
      ))}
    </div>
  );
}
