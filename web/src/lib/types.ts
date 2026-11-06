/* Umumiy tiplar (/api/bootstrap va butun panel uchun). Bo‘limga xos javob tiplari — o‘sha bo‘lim komponenti faylida. */

export type Role = 'admin' | 'rahbar' | 'filial' | 'sotuvchi';
export type Channel = 'tg' | 'ig' | 'demo';
export type Mode = 'doim' | 'kechiksa' | 'ochiq';
export type Rollout = 'kuzatish' | 'tasdiq' | 'avto';
export type Heat = 'sovuq' | 'iliq' | 'issiq';
export type ToastKind = '' | 'ok' | 'ai' | 'bad';

export interface Me { id: number; name: string; login?: string; role: Role; tg_linked?: boolean; branch_id?: number | null; [k: string]: unknown }

export interface Account {
  id: number; channel: Channel; name: string; mode: Mode; rollout: Rollout; ai_enabled: number | boolean; can_reply: number | boolean;
  enabled: number | boolean; is_demo: number | boolean; branch_id: number | null; owner_user_id: number | null;
}

export interface Branch {
  id: number; name: string; kind?: 'dokon' | 'ombor'; work_dow?: string; open_from?: string; open_to?: string; note?: string; active?: number; [k: string]: unknown;
}

export interface UserLite { id: number; name: string; role: Role; branch_id: number | null }

export interface Integration { state: string; detail?: string; [k: string]: unknown }
export interface Integrations { telegram: Integration; billz: Integration; ai: Integration; instagram?: Integration; backup: Integration; [k: string]: Integration | undefined }

/** /api/settings va bootstrap.settings — qiymatlar bo‘limlarda ishlatiladi; to‘liq ro‘yxat backend shartnomasida */
export interface Settings {
  currency?: 'UZS' | 'USD'; T_seconds: number; night_autoreply: boolean; work_from: string; work_to: string; morning_handover: string;
  small_max_wait_minutes: number; big_positions: number; big_qty: number; big_categories: number; big_amount: number; big_accept_minutes: number;
  followup_first_hours: number; followup_second_days: number; resale_daily_limit: number; resale_time: string; resale_quiet_days: number;
  campaign_daily_limit: number; campaign_from: string; campaign_to: string; report_time: string;
  [k: string]: unknown;
}

export interface Boot {
  me: Me; now: number; settings: Settings; stages: string[]; accounts: Account[]; branches: Branch[]; users: UserLite[];
  integrations: Integrations; demo: boolean; bot: string | null; period?: string;
}

/** Modal oynasi tavsifi (app.js dagi `modal(html, onSubmit, after)` o‘rniga) */
export interface ModalSpec {
  /** Oyna ichidagi tarkib (<h2>, maydonlar). Inputlar `name` bilan, nazoratsiz (defaultValue) — FormData orqali o‘qiladi */
  content: React.ReactNode;
  /** Berilsa — [Bekor][Saqlash] tugmalari; `true` qaytarsa oyna ochiq qoladi. Berilmasa — faqat [Yopish]. Xato bo‘lsa `fail` ko‘rsatiladi */
  onSubmit?: (data: Record<string, string>) => Promise<boolean | void> | boolean | void;
  /** `.modal.wide` */
  wide?: boolean;
  /** `<div class="modal">` (forma va tugmalarsiz) — tarkib o‘z tugmalarini beradi; yopish uchun `data-close` atributi ishlaydi */
  bare?: boolean;
}
