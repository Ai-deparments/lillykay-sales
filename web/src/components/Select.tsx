'use client';
import { useEffect, useRef } from 'react';
import type { SelectHTMLAttributes } from 'react';
import { dropdown } from '@/lib/dropdown';
import type { DDOption, Dropdown } from '@/lib/dropdown';

/* Brauzerning oddiy <select> o‘rniga — «command» uslubidagi custom dropdown (lib/dropdown.js, dropdown.css).
   Ichida haqiqiy <select> (yashirin) qoladi: React `value`/`defaultValue`/`onChange`, FormData (name) va id'lar o‘zgarmaydi.
   Foydalanuvchi tanlasa — yashirin select'ga yoziladi va bubbling 'change' yuboriladi, shuning uchun mavjud onChange ishlayveradi.
   Har renderdan keyin variantlar va qiymat select'dan qayta o‘qiladi (React select'ni boshqarishda davom etadi). */
const readOptions = (sel: HTMLSelectElement): DDOption[] =>
  Array.from(sel.options).map(o => ({ value: o.value, label: (o.textContent || '').trim() || '—', disabled: o.disabled }));

export function Select({ className, style, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  const selRef = useRef<HTMLSelectElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const ddRef = useRef<Dropdown | null>(null);

  useEffect(() => {
    const sel = selRef.current, host = hostRef.current;
    if (!sel || !host) return;
    const opts = readOptions(sel);
    const dd = dropdown(host, {
      variant: 'command', float: true, floatPad: 8, options: opts, value: sel.value, search: opts.length > 8,
      onChange: v => {
        sel.value = String(v ?? '');
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        dd.set(sel.value);   // React controlled select qiymatni qaytarib qo‘ygan bo‘lishi mumkin — ko‘rinish shunga mos bo‘lsin
      },
    });
    ddRef.current = dd;
    return () => { ddRef.current = null; dd.close(); host.replaceChildren(); };
  }, []);

  /* Har renderdan keyin: variantlar, qiymat, nomi (ARIA) va o‘chirilgan holat select'dan olinadi */
  useEffect(() => {
    const sel = selRef.current, dd = ddRef.current, host = hostRef.current;
    if (!sel || !dd || !host) return;
    dd.setOptions(readOptions(sel));
    dd.set(sel.value);
    const trig = host.querySelector<HTMLButtonElement>('.dd-trigger');
    if (trig) {
      trig.disabled = sel.disabled;
      const name = sel.getAttribute('aria-label') || sel.closest('label')?.querySelector('span')?.textContent || '';
      if (name) trig.setAttribute('aria-label', name.trim());
    }
  });

  return (
    <span className={`dd-wrap${className ? ` ${className}` : ''}`} style={style}>
      <select ref={selRef} {...rest} hidden>{children}</select>
      <div ref={hostRef} className="dd-host" />
    </span>
  );
}
