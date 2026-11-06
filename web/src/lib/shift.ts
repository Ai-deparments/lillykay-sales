/* Smena: hafta kunlari (Du…Ya) va ish vaqti. Bo‘sh — cheklov yo‘q */
export const DOWN = ['Du', 'Se', 'Cho', 'Pa', 'Ju', 'Sha', 'Ya'];
/** Forma maydonlaridan (`pre0`…`pre6` belgilangan checkboxlar) "1010101" satrini yig‘adi */
export const dowFrom = (d: Record<string, unknown>, pre: string): string => DOWN.map((_, i) => d[`${pre}${i}`] ? '1' : '0').join('');
export const shiftText = (x: { shift_dow?: string | null; shift_from?: string | null; shift_to?: string | null }): string => {
  const days = !x.shift_dow || x.shift_dow === '1111111' ? 'har kuni' : DOWN.filter((_, i) => x.shift_dow![i] === '1').join(' ');
  return x.shift_from && x.shift_to ? `${days} ${x.shift_from}–${x.shift_to}` : days;
};
