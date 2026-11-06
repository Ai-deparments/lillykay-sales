/* dropdown.js (Sardorning dropdown kiti) uchun tiplar. Dvigatel paketsiz, freymvorksiz — React ichida components/Select.tsx orqali ishlatiladi. */
export interface DDOption { value: string; label: string; desc?: string; group?: string; disabled?: boolean; keywords?: string; color?: string }
export interface DDConfig {
  options?: DDOption[]; value?: string | string[] | null; multi?: boolean; search?: boolean; label?: string;
  placeholder?: string; searchPlaceholder?: string; variant?: string; sheet?: boolean; limit?: number;
  /** panel position:fixed — modal/overflow ichida kesilmaydi (Photobuy o‘zgarishi) */
  float?: boolean; floatPad?: number;
  onChange?: (value: string | string[] | null) => void;
}
export interface Dropdown {
  el: HTMLElement;
  readonly value: string | string[] | null;
  set(v: string | string[] | null): void;
  setOptions(options: DDOption[]): void;
  open(): void;
  close(): void;
}
export function dropdown(host: HTMLElement, cfg?: DDConfig): Dropdown;
export function norm(s: unknown): string;
