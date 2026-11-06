/* Chat ko‘rinishi: har bir xodim o‘z xabarlari va mijoz xabarlari rangini, chegarasini va burchagini o‘zi tanlaydi.
   Tanlov shu brauzerda saqlanadi (pb_chat_style) va CSS o‘zgaruvchilari orqali qo‘llanadi (glass.css dagi .msg qoidalari). */
export interface ChatStyle { me?: string; client?: string; meBorder?: string; clientBorder?: string; borderW?: number; radius?: number }

const KEY = 'pb_chat_style';
export const PRESETS: { name: string; s: ChatStyle }[] = [
  { name: 'Quyosh', s: { me: '#ffe9c9', client: '#ffffff', meBorder: '#f1c47e', clientBorder: '#d9d9e6', borderW: 1 } },
  { name: 'Binafsha', s: { me: '#e4defb', client: '#ffffff', meBorder: '#b9a9f5', clientBorder: '#d9d9e6', borderW: 1 } },
  { name: 'Yashil', s: { me: '#d9f5e3', client: '#ffffff', meBorder: '#8fd6ab', clientBorder: '#d9d9e6', borderW: 1 } },
  { name: 'Ko‘k', s: { me: '#d9e8ff', client: '#ffffff', meBorder: '#93bcf5', clientBorder: '#d9d9e6', borderW: 1 } },
  { name: 'Kulrang', s: { me: '#e6e6ec', client: '#f7f7fa', meBorder: '#c9c9d6', clientBorder: '#dedee8', borderW: 1 } },
  { name: 'Qora', s: { me: '#2b2b36', client: '#1a1a22', meBorder: '#4a4a5c', clientBorder: '#34343f', borderW: 1 } }
];

export function loadChatStyle(): ChatStyle {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') as ChatStyle; } catch { return {}; }
}
export function saveChatStyle(s: ChatStyle): void {
  try { if (Object.keys(s).length) localStorage.setItem(KEY, JSON.stringify(s)); else localStorage.removeItem(KEY); } catch { /* private rejim */ }
  applyChatStyle(s);
}
/* Rangning yorqinligiga qarab matn rangi (och fonda qora, to‘q fonda oq) */
const ink = (hex: string) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return '';
  const n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#16142a' : '#f4f4f7';
};
export function applyChatStyle(s: ChatStyle = loadChatStyle()): void {
  const st = document.documentElement.style;
  const set = (k: string, v: string | undefined) => { if (v) st.setProperty(k, v); else st.removeProperty(k); };
  set('--cb-me', s.me); set('--cb-me-ink', s.me ? ink(s.me) : undefined);
  set('--cb-client', s.client); set('--cb-client-ink', s.client ? ink(s.client) : undefined);
  set('--cb-me-border', s.meBorder); set('--cb-client-border', s.clientBorder);
  set('--cb-border-w', s.borderW != null ? `${s.borderW}px` : undefined);
  set('--cb-radius', s.radius != null ? `${s.radius}px` : undefined);
}
