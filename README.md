# Photobuy sotuv markazi

Telegram (va keyin Instagram) suhbatlari, 2 ta AI agent va veb-panel. Tashqi paketlarsiz: Node ≥ 22.13 (`node:sqlite`).

| Agent | Fayl | Vazifa |
|---|---|---|
| Fokus | `src/agents/fokus.js` | Mijozga javob, ehtiyoj, katta ro‘yxat signali, sotuvchiga uzatish, eslatma, ta’qib matni |
| Katalog | `src/agents/katalog.js` | Mahsulot kartasi qoralamasi (ishlab chiqaruvchi manbasi, sana bilan) — xodim tasdiqlaydi |

Avtojavob yadrosi — `src/services/inbox.js` (3 rejim, T taymer, «O‘zim olaman», atomar yuborish, kuzatish → tasdiq → avtomatik bosqichlari). Q1 qabul sinovi: `npm test`.

## Server (bir marta)
```bash
rsync -az --exclude data --exclude .env --exclude .git ./ root@SERVER:/opt/sales/app/
ssh root@SERVER 'bash /opt/sales/app/deploy/setup.sh sotuv.81-85-51-93.sslip.io'
ssh -t root@SERVER 'bash /opt/sales/app/deploy/sozla.sh'        # bot tokeni, Anthropic kaliti, BILLZ — chatga yozilmaydi
ssh -t root@SERVER 'cd /opt/sales/app && sudo -u sales env ENV_FILE=/opt/sales/.env node scripts/user.js <login> rahbar "Ism"'
```
Yangilash: `bash deploy/deploy.sh root@SERVER` (testlar → rsync → restart → health).

## Tekshiruv skriptlari (serverda, faqat o‘qish)
```bash
# BILLZ ulanishi va javob tuzilmasi (mijoz ma’lumoti chiqmaydi)
sudo -u sales env ENV_FILE=/opt/sales/.env node scripts/billz-probe.js
# Q6 nazorat: tizim sof savdosi ↔ BILLZ umumiy hisoboti (kun, davr)
sudo -u sales env ENV_FILE=/opt/sales/.env node scripts/billz-check.js 2026-09-19 2026-08-01 2026-08-31
# Q3: AI javoblari sinovi → data/ai-sinov-<sana>.md (Anthropic kaliti kerak; mijozga hech narsa yuborilmaydi)
sudo -u sales env ENV_FILE=/opt/sales/.env node scripts/ai-sinov.js --limit 60
# Katalog kartalarini to‘ldirish (navbat bo‘yicha, qoralama sifatida; --yes bo‘lmasa faqat ro‘yxat ko‘rsatadi — pullik)
sudo -u sales env ENV_FILE=/opt/sales/.env node scripts/katalog-toldir.js --limit 20 --yes
```

## Xavfsizlik
- `sales-web.service`: `User=sales`, `ProtectHome=yes` (Nova — `/home/claude` ko‘rinmaydi), faqat `/opt/sales/data` ga yozadi, `MemoryHigh=800M`, `MemoryMax=1200M`.
- Ilova faqat `127.0.0.1:8200`; tashqariga nginx (80/443).
- `@photobuy_ai_bot` (Nova) tokeni qabul qilinmaydi — `sozla.sh` ham, ilova ham rad etadi.
- Kalitlar faqat `/opt/sales/.env` (640, root:sales).
- Zaxira: `sales-backup.timer` har kuni, 14 kun.

## Ilova (PWA)
Panelni kompyuter yoki telefonga alohida ilova qilib o‘rnatish: chap paneldagi (telefonda — tepadagi) va kirish sahifasidagi «Ilovani yuklab olish» tugmasi.
- Fayllar: `public/manifest.webmanifest`, `public/sw.js` (hech narsa keshlamaydi — faqat internet yo‘qligida sahifa), `public/pwa.js` (o‘rnatish tugmasi va yo‘riqnoma), `public/icon-*.png`, `public/apple-touch-icon.png`.
- Telefonga o‘rnatilgan ilovada panel kompyuterdagidek 1280 px ko‘rinishda ochiladi (ekranga sig‘adigan holatda, barmoq bilan kattalashtiriladi); oddiy brauzerda telefon ko‘rinishi qoladi.
- Sayt yangilansa ilova ham o‘zi yangilanadi — alohida chiqarish (do‘kon) kerak emas.

## Instagram Direct (Meta)
Veb-huk manzili: `https://<domen>/webhook/instagram` (GET — tasdiq, POST — hodisalar; har so‘rov `X-Hub-Signature-256` bilan tekshiriladi).
`.env`: `IG_TOKEN`, `IG_USER_ID`, `IG_APP_SECRET`, `IG_VERIFY_TOKEN` (ixtiyoriy: `IG_API_BASE`, `IG_DISABLED=1`).
Kalitlar `deploy/sozla.sh instagram` orqali serverda kiritiladi.

## Muhit o‘zgaruvchilari
`TG_BOT_TOKEN`, `ANTHROPIC_API_KEY`, `AI_MODEL` (default `claude-opus-5`), `AI_EFFORT` (default `medium`), `BILLZ_SECRET_TOKEN`, `DEMO_DATA`, `PUBLIC_URL`, `SECURE`, `DATA_DIR`.
