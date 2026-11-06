import type { Heat, Mode, Rollout } from '@/lib/types';

export interface DraftLite { status?: string; [k: string]: unknown }

/** /api/conversations ro‘yxat elementi */
export interface Conv {
  id: number; name: string; handle?: string | null; channel: string; avatar?: string | null;
  last_text: string; last_at: number; last_author?: 'client' | 'seller' | 'ai' | string; last_user_id?: number | null;
  pending_since?: number | null; ai_due_at?: number | null; draft?: DraftLite | null; overdue?: boolean; wait_min?: number;
  big_order?: unknown; big_accepted?: unknown; taken_by?: string | null; owner?: string | null; is_demo?: unknown;
  heat?: Heat | null; remind_at?: number | null; branch?: string | null; account?: string | null;
}

export interface ConvList { items: Conv[]; now: number; archived_total?: number; more?: boolean }

export interface Draft {
  id: number; status: string; batch?: number | null; reason?: string | null; text: string; sources: string[]; rating?: string | null; created_at?: number;
  photos?: { id: number; name: string }[];
}

export interface MsgMeta { reply_to?: number; reply_ext?: string; offline?: boolean; imported?: boolean; tag?: string; edited_at?: number; deleted_at?: number; original?: string; media?: { kind: string; name?: string } }
export interface Msg { id: number; ext_msg_id?: string | null; author: 'client' | 'seller' | 'ai' | 'system'; text: string; created_at: number; user_name?: string | null; meta?: MsgMeta }

export interface Purchase { item: string; qty: number; amount: number; date: string; branch?: string; returned?: number | string }

export interface ConvFull {
  id: number; name: string; handle?: string | null; avatar?: string | null; archived?: unknown; is_demo?: unknown; branch?: string | null; owner?: string | null;
  pending_since?: number | null; ai_due_at?: number | null; taken_by?: string | null; mode?: Mode | 'inherit' | null;
  heat?: Heat | null; heat_by?: string | null; heat_why?: string | null; stage: number; lost_reason?: string | null; lost_evidence?: string | null;
  big_order?: unknown; big_accepted?: unknown; big_order_json?: string | null; created_at: number; source?: string | null; source_note?: string | null;
  asked?: string | null; budget?: string | null; purpose?: string | null; lang?: string | null; next_step?: string | null; note?: string | null;
  remind_at?: number | null; remind_note?: string | null;
}

export interface ConvDetail {
  now: number; conv: ConvFull;
  account: { name: string; channel: string; mode: Mode; is_demo?: unknown; can_reply?: unknown };
  effective: { mode: Mode; rollout: Rollout; T: number; night?: boolean; ai?: boolean; channel_open?: boolean };
  drafts: Draft[]; messages: Msg[]; messages_total: number;
  tasks: { id: number; title: string; body?: string | null }[];
  customer: {
    verified?: boolean; billz_id?: string | number; verified_how?: string | null;
    cashback?: { amount: number; source: string; synced_at: string; stale?: boolean } | null; purchases: Purchase[];
  };
}

export interface PickProduct { id: number; name: string; has_photo?: boolean }
