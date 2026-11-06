#!/usr/bin/env node
/*
  Photobuy’ning eski Telegram yozishmalaridan (2023-11 … 2026-09, 44 ming sotuvchi xabari) olingan do‘kon ma’lumoti — QORALAMA.
  Asos: sotuvchi eng ko‘p takrorlagan tayyor javoblar (yetkazish shabloni 300+ marta, Uzum Nasiya 70+ marta, ish vaqti, manzil, kafolat).
  Agent qoralamani ishlatmaydi — rahbar panelda (Katalog → Do‘kon ma’lumoti) tekshirib «Tasdiqlash» bosadi.
  Bor bo‘lim ustidan yozilmaydi.

    sudo -u sales env ENV_FILE=/opt/sales/.env node scripts/bilim-yozishmadan.js
*/
import { db, one, run } from '../src/db.js';
import { audit } from '../src/core/audit.js';

const DRAFTS = [
  ['Manzillar va ish vaqti', `Do‘kon: Toshkent, Yunusobod, Bog‘iravon 55. Yandex xaritada «photobuy» deb yozilsa chiqadi.
Ish vaqti: har kuni 09:00–20:00, yakshanba — 18:00 gacha.
[Tekshiring: boshqa filial yoki ko‘rgazma zali bormi? Bayram kunlari ish tartibi?]`],
  ['Yetkazib berish', `Toshkent bo‘ylab — shu kunning o‘zida (Yandex orqali). Viloyatlarga — BTS pochta orqali, 1–2 kunda yetib boradi.
Yetkazish uchun mijozdan olinadi: ism, telefon raqami, manzil (yoki lokatsiya).
Pochta orqali jo‘natishda to‘lov oldindan qilinadi.
[Tekshiring: yetkazish narxi. 2025-yilda «1 000 000 so‘m va undan qimmat tovarlarga bepul» deb yozilgan, 2026-yilgi shablonda bu shart yo‘q, ayrim suhbatlarda «BTS pochta bepul» deyilgan — hozirgi qoidani aniq yozing.]`],
  ['Muddatli to‘lov', `Bo‘lib to‘lash — Uzum Nasiya orqali, 25 mln so‘mgacha, 6 yoki 12 oyga.
Tartibi: mijoz Uzum Nasiya ilovasini yuklab oladi, ro‘yxatdan o‘tib limit oladi. Biz QR-kod beramiz — skaner qilinsa Photobuy do‘koni chiqadi, belgilangan summani kiritib, 6 yoki 12 oyni tanlab rasmiylashtiradi.
Nasiyada narx naqd narxdan biroz qimmatroq bo‘ladi — Uzum do‘kondan ham foiz oladi.
[Tekshiring: nasiya narxi naqddan necha foiz qimmat? Uzum Nasiyadan boshqa bo‘lib to‘lash usuli bormi?]`],
  ['To‘lov usullari', `Masofadan xarid: mijoz kartaga oldindan to‘lov qiladi va chekni (skrinshot) yuboradi — shundan keyin tovar jo‘natiladi.
Karta raqamini agent yubormaydi — to‘lov bosqichida suhbat sotuvchiga o‘tadi.
[Tekshiring: do‘konda naqd, terminal (Uzcard, Humo, Visa), Click yoki Payme qabul qilinadimi? Dollar narx qaysi kurs bilan so‘mga o‘giriladi?]`],
  ['Kafolat', `Original mahsulotlarga 1 yil kafolat (DJI kabi brendlarda — 1 yillik rasmiy kafolat).
Nosozlik bo‘lsa: mahsulot qutisi bilan olib kelinadi, usta tekshiradi — nosozlikka qarab tuzatib beriladi yoki almashtiriladi.
[Tekshiring: kafolat hamma tovarga birdek 1 yilmi? Chek yoki kafolat taloni talab qilinadimi?]`],
  ['Qaytarish va almashtirish', `Zavod nosozligi bo‘lsa — usta tekshirgandan keyin almashtirib beriladi yoki tuzatiladi (qutisi bilan olib kelinadi).
Ishlatilgan yoki shikastlangan tovar qaytarib olinmaydi.
[Tekshiring: necha kun ichida almashtirish mumkin? Pul qaytariladigan holatlar bormi?]`]
];

let added = 0;
for (const [title, body] of DRAFTS) {
  if (one('SELECT 1 FROM knowledge WHERE lower(title)=lower(?)', title)) { console.log(`  bor, tegilmadi: ${title}`); continue; }
  run(`INSERT INTO knowledge(title,body,author,active,updated_at) VALUES(?,?,?,0,?)`, title, body, 'Yozishmalardan (tekshirilmagan)', Date.now());
  added++; console.log(`  qoralama qo‘shildi: ${title}`);
}
if (added) audit('sys', 'Tizim', `Yozishmalardan ${added} ta do‘kon ma’lumoti qoralamasi tayyorlandi`, { result: 'Rahbar tasdig‘ini kutmoqda' });
console.log(`\n${added} ta qoralama. Panel → Katalog → Do‘kon ma’lumoti → «Tasdiqlash».`);
db.close();
