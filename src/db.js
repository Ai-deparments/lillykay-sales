import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

mkdirSync(config.dataDir, { recursive: true });
export const db = new DatabaseSync(process.env.DB_FILE || join(config.dataDir, 'sales.db'));
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');

/* Migratsiyalar: PRAGMA user_version bo‘yicha, faqat oldinga. */
const MIGRATIONS = [
`
CREATE TABLE branches (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, active INTEGER NOT NULL DEFAULT 1,
  work_days TEXT, note TEXT
);
CREATE TABLE users (
  id INTEGER PRIMARY KEY, login TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','rahbar','filial','sotuvchi')),
  branch_id INTEGER REFERENCES branches(id), phone TEXT,
  tg_user_id INTEGER UNIQUE, tg_chat_id INTEGER,
  pass_hash TEXT, active INTEGER NOT NULL DEFAULT 1, backup_user_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE sessions (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE tg_links (code TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL);

/* Kanal akkauntlari: Telegram Business ulanishi, Instagram, demo */
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY, channel TEXT NOT NULL CHECK (channel IN ('tg','ig','demo')),
  ext_id TEXT NOT NULL, name TEXT NOT NULL, tg_owner_id INTEGER, owner_user_id INTEGER REFERENCES users(id),
  branch_id INTEGER REFERENCES branches(id), can_reply INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1,
  mode TEXT NOT NULL DEFAULT 'kechiksa' CHECK (mode IN ('doim','kechiksa','ochiq')),
  rollout TEXT NOT NULL DEFAULT 'kuzatish' CHECK (rollout IN ('kuzatish','tasdiq','avto')),
  is_demo INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
  UNIQUE (channel, ext_id)
);

CREATE TABLE customers (
  id INTEGER PRIMARY KEY, name TEXT, phone TEXT, billz_id TEXT UNIQUE,
  verified_at INTEGER, verified_how TEXT, lang TEXT,
  consent_at INTEGER, optout_at INTEGER, bot_chat_id INTEGER UNIQUE,
  is_demo INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);

CREATE TABLE conversations (
  id INTEGER PRIMARY KEY, account_id INTEGER NOT NULL REFERENCES accounts(id),
  ext_chat_id TEXT NOT NULL, ext_user_id TEXT, handle TEXT, display_name TEXT,
  customer_id INTEGER REFERENCES customers(id), branch_id INTEGER REFERENCES branches(id), owner_user_id INTEGER REFERENCES users(id),
  mode TEXT NOT NULL DEFAULT 'inherit' CHECK (mode IN ('inherit','doim','kechiksa','ochiq')),
  taken_by INTEGER REFERENCES users(id), taken_at INTEGER,
  stage INTEGER NOT NULL DEFAULT 0, lost_reason TEXT, lost_evidence TEXT,
  heat TEXT CHECK (heat IN ('sovuq','iliq','issiq')), heat_why TEXT, heat_by TEXT,
  asked TEXT, budget TEXT, purpose TEXT, lang TEXT, next_step TEXT, note TEXT,
  source TEXT, source_note TEXT,
  big_order INTEGER NOT NULL DEFAULT 0, big_order_json TEXT, big_accepted_by INTEGER, big_notified_at INTEGER, big_escalated_at INTEGER,
  pending_since INTEGER, ai_due_at INTEGER,
  last_client_at INTEGER, last_seller_at INTEGER, last_ai_at INTEGER, last_msg_at INTEGER, window_until INTEGER,
  followup_count INTEGER NOT NULL DEFAULT 0, remind_at INTEGER, remind_note TEXT,
  typing_until INTEGER,
  is_demo INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
  UNIQUE (account_id, ext_chat_id)
);
CREATE INDEX conv_due ON conversations(ai_due_at) WHERE ai_due_at IS NOT NULL;
CREATE INDEX conv_last ON conversations(last_msg_at DESC);

CREATE TABLE messages (
  id INTEGER PRIMARY KEY, conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  author TEXT NOT NULL CHECK (author IN ('client','seller','ai','system')),
  user_id INTEGER REFERENCES users(id), text TEXT NOT NULL DEFAULT '', ext_msg_id TEXT, meta TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (conversation_id, ext_msg_id)
);
CREATE INDEX msg_conv ON messages(conversation_id, created_at);

/* AI qoralamalari: preparing → ready → sending → sent | cancelled | failed | superseded */
CREATE TABLE drafts (
  id INTEGER PRIMARY KEY, conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  batch INTEGER NOT NULL, status TEXT NOT NULL, text TEXT, sources TEXT, card TEXT, tools TEXT,
  reason TEXT, model TEXT, created_at INTEGER NOT NULL, decided_at INTEGER, decided_by TEXT,
  rating TEXT, rated_by TEXT
);
CREATE INDEX drafts_conv ON drafts(conversation_id, id DESC);

/* Katalog (bilim bazasi) — narx va qoldiq BILLZ'dan, xususiyat va moslik tekshirilgan manbadan */
CREATE TABLE products (
  id INTEGER PRIMARY KEY, sku TEXT UNIQUE, billz_id TEXT UNIQUE, name TEXT NOT NULL, brand TEXT, category TEXT,
  price INTEGER, stock_json TEXT, stock_synced_at INTEGER,
  specs TEXT, kit TEXT, compat TEXT, limits TEXT, sources TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','verified')),
  verified_at INTEGER, verified_by TEXT, is_demo INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
);

CREATE TABLE purchases (
  id INTEGER PRIMARY KEY, receipt TEXT NOT NULL, line INTEGER NOT NULL, customer_id INTEGER REFERENCES customers(id),
  product_id INTEGER REFERENCES products(id), product_name TEXT, qty INTEGER NOT NULL DEFAULT 1, amount INTEGER NOT NULL,
  branch_id INTEGER REFERENCES branches(id), seller_name TEXT, sold_at INTEGER NOT NULL, returned_at INTEGER,
  is_demo INTEGER NOT NULL DEFAULT 0, UNIQUE (receipt, line)
);
CREATE TABLE cashback (customer_id INTEGER PRIMARY KEY REFERENCES customers(id), amount INTEGER NOT NULL, synced_at INTEGER NOT NULL);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL, conversation_id INTEGER REFERENCES conversations(id), customer_id INTEGER REFERENCES customers(id),
  user_id INTEGER REFERENCES users(id), title TEXT NOT NULL, body TEXT, due_at INTEGER,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')), result TEXT,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL, done_at INTEGER, dedup_key TEXT UNIQUE
);

CREATE TABLE settings (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at INTEGER, updated_by TEXT);
CREATE TABLE changes (id INTEGER PRIMARY KEY, at INTEGER NOT NULL, who TEXT NOT NULL, what TEXT NOT NULL);

CREATE TABLE audit (
  id INTEGER PRIMARY KEY, at INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('ai','staff','sys')),
  actor TEXT NOT NULL, action TEXT NOT NULL, object TEXT, data_used TEXT, result TEXT
);
CREATE INDEX audit_at ON audit(at DESC);

CREATE TABLE integrations (name TEXT PRIMARY KEY, state TEXT NOT NULL, detail TEXT, checked_at INTEGER);
CREATE TABLE kv (k TEXT PRIMARY KEY, v TEXT);
`,
`
/* 2-bosqich: Chaqnoq (qayta sotuv, kampaniya) va Obyektiv (reja, fakt, prognoz) */
ALTER TABLE purchases ADD COLUMN branch_name TEXT;
ALTER TABLE purchases ADD COLUMN category TEXT;
ALTER TABLE tasks ADD COLUMN meta TEXT;

/* «X ni olgan mijozga Y mos» — sabab bilan. Rahbar/katalog mas’uli yuritadi. */
CREATE TABLE resale_rules (
  id INTEGER PRIMARY KEY, bought_product_id INTEGER REFERENCES products(id), bought_match TEXT,
  suggest_product_id INTEGER NOT NULL REFERENCES products(id), reason TEXT NOT NULL,
  min_days INTEGER NOT NULL DEFAULT 7, max_days INTEGER NOT NULL DEFAULT 365, active INTEGER NOT NULL DEFAULT 1,
  is_demo INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
);

CREATE TABLE campaigns (
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id), title TEXT NOT NULL, message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','running','paused','done')),
  daily_limit INTEGER NOT NULL DEFAULT 60, min_stock INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL, started_at INTEGER, approved_by TEXT, is_demo INTEGER NOT NULL DEFAULT 0
);
/* Idempotentlik: kampaniya + mijoz kaliti — qayta ishga tushirish takror xabar yubormaydi */
CREATE TABLE campaign_sends (
  id INTEGER PRIMARY KEY, campaign_id INTEGER NOT NULL REFERENCES campaigns(id), customer_id INTEGER NOT NULL REFERENCES customers(id),
  send_key TEXT NOT NULL UNIQUE, channel TEXT NOT NULL CHECK (channel IN ('bot','task')), status TEXT NOT NULL,
  reason TEXT, error TEXT, created_at INTEGER NOT NULL, sent_at INTEGER, replied_at INTEGER, purchased_at INTEGER
);
CREATE INDEX csend_cust ON campaign_sends(customer_id, sent_at);

CREATE TABLE plans (
  id INTEGER PRIMARY KEY, period TEXT NOT NULL, scope TEXT NOT NULL CHECK (scope IN ('company','branch','user')), scope_key TEXT NOT NULL,
  revenue INTEGER, checks INTEGER, version INTEGER NOT NULL, status TEXT NOT NULL CHECK (status IN ('suggested','approved')),
  basis TEXT, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE (period, scope, scope_key, version)
);

CREATE TABLE insights (
  id INTEGER PRIMARY KEY, at INTEGER NOT NULL, audience TEXT NOT NULL, user_id INTEGER, title TEXT NOT NULL,
  metric TEXT, period TEXT, cause TEXT, evidence TEXT, hypothesis INTEGER NOT NULL DEFAULT 1, advice TEXT, owner TEXT, source TEXT
);
`,
`
/* 3-bosqich: BILLZ jonli sinxron (docs.billz.io) va javob ishonchliligi */
ALTER TABLE branches ADD COLUMN billz_shop_id TEXT;
CREATE UNIQUE INDEX branches_billz ON branches(billz_shop_id) WHERE billz_shop_id IS NOT NULL;
ALTER TABLE products ADD COLUMN barcode TEXT;
ALTER TABLE products ADD COLUMN price_json TEXT;
ALTER TABLE products ADD COLUMN billz_seen_at INTEGER;
ALTER TABLE customers ADD COLUMN phones TEXT;
ALTER TABLE customers ADD COLUMN billz_ext_id TEXT;
ALTER TABLE customers ADD COLUMN synced_at INTEGER;
CREATE INDEX customers_phone ON customers(phone);
CREATE INDEX customers_ext ON customers(billz_ext_id);
/* kind: sale | return. Qaytarish — alohida qator (sold_at = qaytarish vaqti, returned_at ham shu), sotuv qatori o‘zgarmaydi */
ALTER TABLE purchases ADD COLUMN kind TEXT NOT NULL DEFAULT 'sale';
ALTER TABLE purchases ADD COLUMN sku TEXT;
CREATE INDEX purchases_sold ON purchases(sold_at);
CREATE INDEX purchases_cust ON purchases(customer_id, sold_at);
/* Qoralama qaysi xabargacha ko‘rgan: yuborish paytida yangi savol kelgan bo‘lsa — u javobsiz qolmaydi */
ALTER TABLE drafts ADD COLUMN upto_msg_id INTEGER;
CREATE INDEX drafts_open ON drafts(status) WHERE status IN ('preparing','sending','unknown');
`,
`
/* 4-bosqich: BILLZ tranzaksiya turi (Продажа / Возврат / Обмен) — almashtirish cheki sotuv cheklari soniga kirmaydi (BILLZ orders_count bilan teng) */
ALTER TABLE purchases ADD COLUMN order_type TEXT;
`,
`
/* 5-bosqich: filial turi — do‘kon yoki ombor (qoldiq alohida ko‘rsatiladi va filtrlanadi) */
ALTER TABLE branches ADD COLUMN kind TEXT NOT NULL DEFAULT 'dokon' CHECK (kind IN ('dokon','ombor'));
UPDATE branches SET kind='ombor' WHERE name LIKE '%sklad%' OR name LIKE '%ombor%' OR name LIKE '%warehouse%'
  OR name LIKE '%склад%' OR name LIKE '%Склад%' OR name LIKE '%СКЛАД%';
`,
`
/* 6-bosqich: qayta sotuv qoidasi tovar turi darajasida (xaridlar tarixidan tavsiya). suggest_product_id — namuna; har kuni
   shu turdagi do‘konda bor va eng ko‘p sotilgan model tanlanadi. evidence — tarixdan dalil (JSON). */
ALTER TABLE resale_rules ADD COLUMN bought_category TEXT;
ALTER TABLE resale_rules ADD COLUMN suggest_category TEXT;
ALTER TABLE resale_rules ADD COLUMN evidence TEXT;
`,
`
/* 7-bosqich: yangi tovar kirimi — tovar katalogda birinchi marta qachon ko‘ringani (BILLZ sinxroni yozadi).
   Mavjud tovarlar uchun NULL: ular «yangi kirim» hisoblanmaydi. */
ALTER TABLE products ADD COLUMN first_seen_at INTEGER;
CREATE INDEX products_first_seen ON products(first_seen_at) WHERE first_seen_at IS NOT NULL;
`,
`
/* 8-bosqich: smena va ish kunlari. dow — 7 belgi, dushanbadan yakshanbagacha ('1111110' = Du–Sha).
   Xodim: vazifa va bildirishnoma avval smenadagi sotuvchiga; filial: ish kunlari solishtirishda hisobga olinadi. */
ALTER TABLE users ADD COLUMN shift_dow TEXT;
ALTER TABLE users ADD COLUMN shift_from TEXT;
ALTER TABLE users ADD COLUMN shift_to TEXT;
ALTER TABLE branches ADD COLUMN work_dow TEXT;
ALTER TABLE branches ADD COLUMN open_from TEXT;
ALTER TABLE branches ADD COLUMN open_to TEXT;
`,
`
/* 9-bosqich: xulosa qaysi filialga tegishli — filial rahbari boshqa filialning xulosasini ko‘rmaydi */
ALTER TABLE insights ADD COLUMN branch_id INTEGER;
`,
`
/* 10-bosqich: tovar rasmi — BILLZ'dagi surat (main_image_url) yoki panelda qo'lda qo'yilgani.
   Mijozga yuborilganda rasm serverdan (keshdan) yuboriladi: tashqi havola eskirsa ham ishlaydi. */
ALTER TABLE products ADD COLUMN image_url TEXT;
`,
`
/* 11-bosqich: agentni o‘qitish (Sotuvchi agent usuli). answers — rahbar tasdiqlagan savol-javoblar: agent shu savolga
   (yoki mazmunan o‘xshashiga) aynan shu mazmunda javob beradi, ular umumiy bilimdan ustun. knowledge — do‘kon ma’lumoti
   (kafolat, yetkazish, to‘lov, keshbek, manzil va h.k.). conversations.phone — mijoz suhbatda bergan raqam (tasdiqlanmagan). */
CREATE TABLE answers (
  id INTEGER PRIMARY KEY, question TEXT NOT NULL, answer TEXT NOT NULL, author TEXT, source TEXT NOT NULL DEFAULT 'panel',
  active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, updated_at INTEGER
);
CREATE TABLE knowledge (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, author TEXT, active INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL
);
ALTER TABLE conversations ADD COLUMN phone TEXT;
`,
`
/* v12: eski yozishmalar arxivi. archived=1 — Telegram eksportidan yuklangan, hozir faol bo‘lmagan suhbat (navbatda emas,
   ko‘rsatkichlarga kirmaydi). Mijoz qayta yozsa — 0. style_pairs — mijoz savoli → Photobuy javobi juftlari (FTS5):
   AI o‘xshash savolga do‘kon qanday javob berganini ko‘radi (uslub va yondashuv; narx — faqat BILLZ’dan). */
ALTER TABLE conversations ADD COLUMN archived INTEGER NOT NULL DEFAULT 0;
CREATE INDEX conv_archived ON conversations(archived, last_msg_at);
CREATE VIRTUAL TABLE style_pairs USING fts5(q, a UNINDEXED, conv_id UNINDEXED, at UNINDEXED, tokenize="unicode61 remove_diacritics 2 tokenchars '‘’ʻʼ'''");
`,
`
/* v14: AI javobiga tovar rasmi biriktiriladi (mijoz «rasmini tashlang» desa). Rasm qoralama bilan birga yuboriladi —
   sotuvchi oldin javob bersa yoki qoralama bekor qilinsa, rasm ham ketmaydi. */
ALTER TABLE drafts ADD COLUMN photo_product_id INTEGER;
`,
`
/* v15: sotuvchiga AI maslahati — doskada mijoz kartasi uchun (mijozga yuborilmaydi) */
ALTER TABLE conversations ADD COLUMN advice TEXT;
ALTER TABLE conversations ADD COLUMN advice_at INTEGER;
`,
`
/* v16: tovar rasmi manbasi — internetdan olingan bo‘lsa rasmiy sahifa havolasi (panelda ko‘rsatiladi, noto‘g‘ri bo‘lsa o‘chiriladi) */
ALTER TABLE products ADD COLUMN image_source TEXT;
`,
`
/* v17: har kuni qayta qo‘shilgan bir xil xulosalar — har ko‘rsatkich va filial/sotuvchi uchun faqat eng so‘nggisi qoladi */
DELETE FROM insights WHERE id NOT IN (SELECT max(id) FROM insights GROUP BY metric, audience, COALESCE(branch_id,0), COALESCE(user_id,0));
`,
`
/* Bir javobda 3 tagacha tovar rasmi (mijoz «rasmlarini ko‘rsating» desa variantlar albom bo‘lib ketadi): JSON massiv */
ALTER TABLE drafts ADD COLUMN photo_ids TEXT;
`,
`
/* AI agentni kanal (akkaunt) bo‘yicha yoqish/to‘xtatish: 0 — AI umuman ishlamaydi (qoralama ham, ta’qib ham yo‘q), suhbatni sotuvchi olib boradi */
ALTER TABLE accounts ADD COLUMN ai_enabled INTEGER NOT NULL DEFAULT 1;
`,
`
/* Boshliq agent: AI sotuvchilarga navbat bilan topshiriq beradi (rasm, to‘lov, buyurtma, javob).
   Qabul qilinmasa yoki muddatida bajarilmasa — keyingi sotuvchiga o‘tadi. Har qadam assignment_events’da: sotuvchilar nazorati shundan hisoblanadi. */
ALTER TABLE users ADD COLUMN tg_username TEXT;
CREATE TABLE assignments (
  id INTEGER PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued','offered','accepted','escalated','done','failed','cancelled')),
  user_id INTEGER REFERENCES users(id),
  tried TEXT NOT NULL DEFAULT '[]',
  attempts INTEGER NOT NULL DEFAULT 0,
  offered_at INTEGER, accepted_at INTEGER, done_at INTEGER, done_how TEXT,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX assignments_open ON assignments(status, conversation_id);
CREATE TABLE assignment_events (
  id INTEGER PRIMARY KEY,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id),
  user_id INTEGER REFERENCES users(id),
  event TEXT NOT NULL CHECK (event IN ('offered','accepted','missed','late','done','escalated')),
  ms INTEGER,
  at INTEGER NOT NULL
);
CREATE INDEX assignment_events_user ON assignment_events(user_id, at);
`,
`
/* Topshiriq boshliq nomidan — Photobuy Business akkauntidan. Telegram: Business akkaunt faqat oxirgi 24 soatda unga yozgan odamga yoza oladi,
   shuning uchun sotuvchi ish boshida akkauntga yozadi (biz_seen_at) — bu «ishda» belgisi ham. active_at — oxirgi faollik («online» taxmini). */
ALTER TABLE users ADD COLUMN biz_conn TEXT;
ALTER TABLE users ADD COLUMN biz_seen_at INTEGER;
ALTER TABLE users ADD COLUMN active_at INTEGER;
ALTER TABLE assignments ADD COLUMN urgent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE assignments ADD COLUMN via TEXT;
ALTER TABLE assignments ADD COLUMN msg_id INTEGER;
`,
`
/* Boshliq agent sotuvchi bilan gaplashadi: yozishma (staff_messages) va sotuvchi profilidagi izohlar (staff_notes: rad etdi, o‘tkazib yubordi,
   kechikdi, kunlik xulosa, AI kuzatuvi). «declined» — sotuvchi topshiriqni rad etdi (reytingga ta’sir qiladi). */
CREATE TABLE staff_messages (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  dir TEXT NOT NULL CHECK (dir IN ('in','out')),
  text TEXT NOT NULL,
  via TEXT,
  assignment_id INTEGER REFERENCES assignments(id),
  created_at INTEGER NOT NULL
);
CREATE INDEX staff_messages_user ON staff_messages(user_id, created_at);
CREATE TABLE staff_notes (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  assignment_id INTEGER REFERENCES assignments(id),
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX staff_notes_user ON staff_notes(user_id, created_at);
CREATE TABLE assignment_events_v2 (
  id INTEGER PRIMARY KEY,
  assignment_id INTEGER NOT NULL REFERENCES assignments(id),
  user_id INTEGER REFERENCES users(id),
  event TEXT NOT NULL CHECK (event IN ('offered','accepted','missed','late','done','escalated','declined')),
  ms INTEGER,
  at INTEGER NOT NULL
);
INSERT INTO assignment_events_v2(id,assignment_id,user_id,event,ms,at) SELECT id,assignment_id,user_id,event,ms,at FROM assignment_events;
DROP TABLE assignment_events;
ALTER TABLE assignment_events_v2 RENAME TO assignment_events;
CREATE INDEX assignment_events_user ON assignment_events(user_id, at);
`,
`
/* Xodimni ro‘yxatdan o‘chirish: tarix (yozishma, topshiriq, hisobot) joyida qoladi —
   xodim ro‘yxatda ko‘rinmaydi, panelga kira olmaydi, topshiriq olmaydi. */
ALTER TABLE users ADD COLUMN deleted_at INTEGER;
`,
`
/* Taklif havolasi: rahbar havola yaratadi, xodim o‘zi parol qo‘yadi va o‘ziga berilgan rolda kiradi.
   Havola bir marta ishlaydi (used_at) va muddati o‘tadi (expires_at) — parol hech kimning qo‘lidan o‘tmaydi. */
CREATE TABLE invites (
  id INTEGER PRIMARY KEY, token TEXT NOT NULL UNIQUE,
  login TEXT NOT NULL, name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','rahbar','filial','sotuvchi')),
  branch_id INTEGER REFERENCES branches(id), phone TEXT,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
  used_at INTEGER, user_id INTEGER REFERENCES users(id)
);
CREATE INDEX invites_open ON invites(used_at, expires_at);
`,
`
/* Taklif turi: 'new' — yangi xodim hisobini ochadi; 'reset' — mavjud xodim parolini almashtiradi (user_id — kimniki) */
ALTER TABLE invites ADD COLUMN kind TEXT NOT NULL DEFAULT 'new';
`,
`
/* AI sarfi: har so‘rovdan keyin yoziladi (javobdagi usageMetadata). Kun va model bo‘yicha yig‘iladi —
   panelda qancha token ketgani, qancha pul bo‘lgani va balansdan qancha qolgani shundan ko‘rsatiladi. */
CREATE TABLE ai_usage (
  day TEXT NOT NULL, model TEXT NOT NULL,
  calls INTEGER NOT NULL DEFAULT 0, in_tok INTEGER NOT NULL DEFAULT 0,
  out_tok INTEGER NOT NULL DEFAULT 0, cached_tok INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, model)
);
`,
`
/* Keshbek boti: «Start» bosgan mijozlar. Raqam faqat Telegram tugmasi orqali olinadi (o‘z raqami bo‘lishi shart).
   blocked_at — botni bloklagan yoki /stop bosgan: reklama yuborilmaydi. */
CREATE TABLE cb_subs (
  chat_id INTEGER PRIMARY KEY,
  customer_id INTEGER REFERENCES customers(id),
  name TEXT, username TEXT, phone TEXT,
  joined_at INTEGER NOT NULL, last_at INTEGER, blocked_at INTEGER,
  checks INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX cb_subs_live ON cb_subs(blocked_at);

/* Paneldan yuborilgan reklamalar va ularning natijasi */
CREATE TABLE broadcasts (
  id INTEGER PRIMARY KEY,
  text TEXT, photo TEXT, link_url TEXT, link_text TEXT,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
  started_at INTEGER, done_at INTEGER,
  total INTEGER NOT NULL DEFAULT 0, sent INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0, blocked INTEGER NOT NULL DEFAULT 0
);
`,
`
/* Reklama filtri (JSON: keshbek summasi dan/gacha, faqat tanilgan mijozlar) — kimga yuborilgani tarixda ko‘rinsin */
ALTER TABLE broadcasts ADD COLUMN filter TEXT;
`,
`
/* AI sarfi Google hisobiga mos bo‘lsin (2026-10-09): ovoz tokenlari alohida narxda (3.1-flash-lite: $0.50 / 1M, matn $0.25),
   kesh saqlash — «token·soat» (kesh yaratilganda: tokenlar × TTL soati, $1.00 / 1M token·soat). Ilgari ikkalasi ham hisoblanmagan. */
ALTER TABLE ai_usage ADD COLUMN audio_tok INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai_usage ADD COLUMN cache_th REAL NOT NULL DEFAULT 0;
`,
`
/* Mijozning profil rasmi (Telegram / Instagram) — data/avatars/<suhbat id>. avatar_at — oxirgi urinish (rasm bo‘lmasa ham),
   avatar_v — rasm saqlangan vaqt (havolada versiya: yangilansa brauzer eskisini ko‘rsatmaydi); NULL — rasm yo‘q, bosh harflar. */
ALTER TABLE conversations ADD COLUMN avatar_at INTEGER;
ALTER TABLE conversations ADD COLUMN avatar_v INTEGER;
`,
`
/* Mijoz ovozli javobni xohlaydimi: 'ha' — o'zi so'ragan yoki ovozda yozishyapti, 'yoq' — matnda so'ragan,
   NULL — hali noma'lum (unda ovozli xabar yuborgan bo'lsa javob ham ovozda ketadi). AI suhbatdan bilib qo'yadi. */
ALTER TABLE conversations ADD COLUMN voice_pref TEXT;
`,
`
/* Sun HighTech (2026-11-06): «Qayta sotuv», «Buyurtmalar», «Vazifalar», «Reja va tahlil» bo‘limlari olib tashlandi —
   ularning jadvallari va ular qo‘ygan vazifalar ham. Suhbatlar, bilim bazasi, AI agent va xodimlar qoladi. */
DROP TABLE IF EXISTS campaign_sends;
DROP TABLE IF EXISTS campaigns;
DROP TABLE IF EXISTS resale_rules;
DROP TABLE IF EXISTS plans;
DROP TABLE IF EXISTS insights;
DELETE FROM tasks WHERE kind IN ('resale','campaign','campaign_reply','arrival');
`,
`
/* Odoo CRM nusxasi (faqat o‘qish, services/odoo.js). Vaqtlar — epoch ms (UTC). */
CREATE TABLE odoo_teams (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE odoo_stages (id INTEGER PRIMARY KEY, name TEXT NOT NULL, sequence INTEGER NOT NULL DEFAULT 0, is_won INTEGER NOT NULL DEFAULT 0);
CREATE TABLE odoo_users (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE odoo_lost_reasons (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE odoo_sources (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE odoo_leads (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, stage_id INTEGER, team_id INTEGER, user_id INTEGER, source_id INTEGER, lost_reason_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1, probability REAL NOT NULL DEFAULT 0, expected_revenue INTEGER NOT NULL DEFAULT 0, tags TEXT,
  created_at INTEGER, opened_at INTEGER, stage_at INTEGER, closed_at INTEGER, updated_at INTEGER
);
CREATE INDEX odoo_leads_stage ON odoo_leads(stage_id, active);
CREATE INDEX odoo_leads_user ON odoo_leads(user_id);
CREATE INDEX odoo_leads_created ON odoo_leads(created_at);
/* Bosqich o‘tishlari (Odoo mail.tracking.value): lid, qaysi bosqichdan qaysiga, qachon, kim */
CREATE TABLE odoo_stage_log (id INTEGER PRIMARY KEY, lead_id INTEGER NOT NULL, from_stage INTEGER, to_stage INTEGER, at INTEGER NOT NULL, author TEXT);
CREATE INDEX odoo_stage_log_lead ON odoo_stage_log(lead_id, at);
/* Menejer izohlari va xatlar lid bo‘yicha (uchrashuvdan keyin nima yozilgan) */
CREATE TABLE odoo_messages (id INTEGER PRIMARY KEY, lead_id INTEGER NOT NULL, at INTEGER NOT NULL, author TEXT, kind TEXT, body TEXT NOT NULL);
CREATE INDEX odoo_messages_lead ON odoo_messages(lead_id, at);
`,
`
/* Bosqich tarixi ikki manbadan: Odoo tracking (odoo_id, faqat administrator ko‘radi) va o‘zimizniki (sinxronlar orasidagi farq).
   source: odoo | sync | snapshot (birinchi sinxron — hozirgi bosqichga kirish vaqti). */
DROP TABLE IF EXISTS odoo_stage_log;
CREATE TABLE odoo_stage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, odoo_id INTEGER UNIQUE, lead_id INTEGER NOT NULL, from_stage INTEGER, to_stage INTEGER,
  at INTEGER NOT NULL, author TEXT, source TEXT NOT NULL DEFAULT 'sync'
);
CREATE INDEX odoo_stage_log_lead ON odoo_stage_log(lead_id, at);
CREATE INDEX odoo_stage_log_at ON odoo_stage_log(at);
`,
`
/* Nazorat 24 soat: panel xodimi ↔ Odoo foydalanuvchisi bog‘lami va yuborilgan ogohlantirishlar (lid + daraja — bir marta) */
ALTER TABLE users ADD COLUMN odoo_user_id INTEGER;
CREATE TABLE nazorat_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, lead_id INTEGER NOT NULL, level INTEGER NOT NULL, sent_at INTEGER NOT NULL,
  to_user_id INTEGER, delivered INTEGER NOT NULL DEFAULT 0, UNIQUE (lead_id, level)
);
`,
`
/* Lid kartasi uchun: mijoz, kontakt, telefon, email, shahar (Odoo crm.lead). Keyingi sinxron hammasini qayta o‘qiydi. */
ALTER TABLE odoo_leads ADD COLUMN partner TEXT;
ALTER TABLE odoo_leads ADD COLUMN contact TEXT;
ALTER TABLE odoo_leads ADD COLUMN phone TEXT;
ALTER TABLE odoo_leads ADD COLUMN email TEXT;
ALTER TABLE odoo_leads ADD COLUMN city TEXT;
DELETE FROM kv WHERE k IN ('odoo_wm_leads','odoo_sync_at');
`,
`
/* Bitta Odoo foydalanuvchisi — faqat bitta (o‘chirilmagan) xodimga. Kod tekshiradi, indeks kafolatlaydi. */
CREATE UNIQUE INDEX users_odoo_user ON users(odoo_user_id) WHERE odoo_user_id IS NOT NULL AND deleted_at IS NULL;
`,
`
/* Odoo menejerini panelga taklif qilish: telefon Odoo’dan (login bo‘ladi), taklif qabul qilinganda hisob shu Odoo foydalanuvchisiga bog‘lanadi */
ALTER TABLE odoo_users ADD COLUMN phone TEXT;
ALTER TABLE invites ADD COLUMN odoo_user_id INTEGER;
`
];

export function migrate() {
  const cur = db.prepare('PRAGMA user_version').get().user_version;
  for (let i = cur; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try { db.exec(MIGRATIONS[i]); db.exec(`PRAGMA user_version=${i + 1}`); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
}

/* Sinxron tranzaksiya: DatabaseSync bitta jarayonda — BEGIN IMMEDIATE ichidagi tekshiruv va yozuv atomar */
export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { try { db.exec('ROLLBACK'); } catch {} throw e; }
}

export const one = (sql, ...a) => db.prepare(sql).get(...a);
export const all = (sql, ...a) => db.prepare(sql).all(...a);
export const run = (sql, ...a) => db.prepare(sql).run(...a);

export const kvGet = (k, d = null) => one('SELECT v FROM kv WHERE k=?', k)?.v ?? d;
export const kvSet = (k, v) => run('INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v', k, String(v));
