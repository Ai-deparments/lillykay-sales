/* Mijozlar doskasi (Tasks) va chat ko‘rinishi (ChatPreview) o‘rtasidagi umumiy holat: app.js dagi `B`, `moveCard`, `adviceFor`.
   Modul darajasida — ikkala komponent ham bir xil ro‘yxatni ko‘radi va o‘zgarishda qayta chiziladi. */
import { api } from '@/lib/api';
import { clockNow } from '@/lib/format';
import type { Heat } from '@/lib/types';

export const LOST_COL = 6;

export interface BoardItem {
  id: number; name: string; phone?: string | null; heat?: Heat | null; last_at?: number | null; asked?: string | null; budget?: string | null;
  waiting?: boolean; next_step?: string | null; stage: number; lost?: string | null; advice?: string | null; advice_at?: number | null;
  [k: string]: unknown;
}
export interface BoardData { items: BoardItem[]; stages: string[]; focus: number[] }

let board: BoardData | null = null;
const subs = new Set<() => void>();
export const boardBus = {
  get data(): BoardData | null { return board; },
  set(b: BoardData | null): void { board = b; boardBus.notify(); },
  find(id: number): BoardItem | undefined { return board?.items.find(x => x.id === id); },
  subscribe(fn: () => void): () => void { subs.add(fn); return () => { subs.delete(fn); }; },
  notify(): void { subs.forEach(f => f()); }
};

interface Notifier { toast: (t: string, k?: '' | 'ok' | 'ai' | 'bad') => void; fail: (e: unknown) => void }

/* Bosqichni o‘zgartirish (sudrash yoki ro‘yxatdan): xarid — chek bilan, yo‘qotish — sabab va dalil bilan */
export async function moveCard(id: number, col: number, n: Notifier): Promise<void> {
  const it = boardBus.find(id);
  let body: Record<string, unknown>;
  if (col === LOST_COL) {
    const reason = prompt('Yo‘qotish sababi (narx / mavjud emas / kech javob / raqobatchidan oldi / boshqa):', it?.lost || '');
    if (!reason) return boardBus.notify();
    const evidence = prompt('Dalil (mijoz nima degan):', '');
    if (!evidence) return boardBus.notify();
    body = { lost: reason, lost_evidence: evidence };
  } else {
    if (col === 5 && !confirm('Xarid tasdiqlandimi? (chek yoki BILLZ’da sotuv bor)')) return boardBus.notify();
    body = { stage: col, ...(col === 5 ? { confirm_purchase: true } : {}), ...(it?.lost ? { lost: null } : {}) };
  }
  const r = await api(`/api/conversations/${id}/card`, body).catch(n.fail);
  if (!r) return boardBus.notify();
  if (it) { if (col === LOST_COL) it.lost = body.lost as string; else { it.stage = col; it.lost = null; } }
  n.toast('Bosqich o‘zgardi');
  boardBus.notify();
}

/** AI maslahat so‘rash; muvaffaqiyatda doskadagi kartaga yozadi va natijani qaytaradi */
export async function fetchAdvice(id: number, n: Notifier): Promise<string | null> {
  const r = await api(`/api/conversations/${id}/advice`, {}).catch((e: Error) => ({ ok: false, why: e.message, advice: '' }));
  if (!r.ok) { n.toast(r.why || 'AI maslahat bermadi'); return null; }
  const it = boardBus.find(id); if (it) { it.advice = r.advice; it.advice_at = clockNow(); }
  return r.advice as string;
}
