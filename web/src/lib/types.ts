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

/* ---------- Tahlil (rahbar sahifasi): GET /api/tahlil?period=today|7|30 · POST /api/tahlil/xulosa ---------- */
export type TahlilPeriod = 'today' | '7' | '30';
export type TahlilManagerStatus = 'yaxshi' | 'ortacha' | 'etibor' | 'none';
/** Bugungi ko‘rsatkichni kecha (`prev`) va 7 kun o‘rtachasi (`avg7`) bilan solishtirish */
export interface TahlilCmp { prev: number; avg7: number }
export interface TahlilToday {
  new: number; taken: number; won: number; won_amount: number; lost: number;
  lost_top_reason: { name: string; n: number } | null;
  cmp: { new: TahlilCmp; taken: TahlilCmp; won: TahlilCmp; won_amount: TahlilCmp; lost: TahlilCmp };
}
export interface TahlilSeriesPoint { date: string; in: number; won: number }
/** `avg_days` null — bosqichda o‘tish tarixi yo‘q */
export interface TahlilStage { id: number; name: string; now: number; stuck: number; lost: number; avg_days: number | null; is_bottleneck: boolean }
export interface TahlilSource { id: number; name: string; in: number; won: number; conv: number }
export interface TahlilManager {
  user_id: number | null; name: string; taken: number; on_time_pct: number | null; won: number; won_amount: number; lost_pct: number;
  silent_leads: number; status: TahlilManagerStatus;
}
export interface TahlilAi {
  conversations: number; ai_replied: number; ai_replied_pct: number; avg_reply_sec: number | null; phones: number; phones_pct: number;
  handoffs: number; handoffs_unanswered: number;
}
/** AI xulosasi: `text` null — hali tuzilmagan; `stale` — raqamlar o‘zgargan, qayta tuzish kerak */
export interface TahlilXulosa { text: string[] | null; at: number | null; model: string | null; stale: boolean }
export interface TahlilData {
  period: TahlilPeriod; team: { id: number; name: string } | null; updated_at: number; odoo_synced_at: number | null;
  today: TahlilToday; series: TahlilSeriesPoint[]; series_total: { in: number; won: number; conv: number; prev_conv: number };
  stages: TahlilStage[]; stages_note: string; sources: TahlilSource[]; managers: TahlilManager[]; ai: TahlilAi; xulosa: TahlilXulosa;
}

/* ---------- AI yordamchi (GET/POST/DELETE /api/yordamchi) ---------- */
export type YordamchiRole = 'user' | 'ai';
/** Tarixdagi bitta xabar; `tools` — AI javobi uchun ishlatilgan ma’lumot manbalari (faqat POST javobida keladi, UI da saqlanadi) */
export interface YordamchiMsg { role: YordamchiRole; text: string; at: number; tools?: string[] }
/** GET /api/yordamchi → oxirgi 40 ta xabar */
export interface YordamchiHistory { messages: YordamchiMsg[] }
/** POST /api/yordamchi { text } → AI javobi */
export interface YordamchiReply { reply: string; tools: string[]; at: number }

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
