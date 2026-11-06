#!/usr/bin/env bash
# Photobuy sotuv — Contabo serverida birinchi marta tayyorlash (root, idempotent, Docker).
#   bash /opt/sales/app/deploy/docker/setup-docker.sh <domen>
# Serverdagi boshqa tizimlarga tegmaydi: Odoo, turkishbaby-shop, tg-bot-api, marketolog
# konteynerlari va ularning nginx saytlari o'zgarmaydi. Faqat yangi fayllar qo'shiladi.
set -euo pipefail
DOMAIN="${1:?domen kerak, masalan: sotuv.62-171-139-200.sslip.io}"
APP=/opt/sales/app

echo "== Boshqa konteynerlar (oldin)"; docker ps --format '{{.Names}} {{.Status}}'
echo "== RAM"; free -h | sed -n 1,2p

# 1) papkalar. /opt/sales/data — konteynerdagi node (uid 1000) yozadi
install -d -m 755 /opt/sales
install -d -o 1000 -g 1000 -m 750 /opt/sales/data
if [ ! -f /opt/sales/.env ]; then
  umask 077
  cat > /opt/sales/.env <<EOF
PUBLIC_URL=https://$DOMAIN
SECURE=1
BIZ_TZ=Asia/Tashkent
# Kalitlar kelmaguncha xavfsiz rejim: demo ma'lumot, botlar o'chirilgan
DEMO_DATA=1
TG_DISABLED=1
IG_DISABLED=1
EOF
  echo "== /opt/sales/.env yaratildi (demo rejim)"
else
  echo "== /opt/sales/.env bor — tegilmadi"
fi
chmod 600 /opt/sales/.env

# 2) nginx: faqat yangi snippet va yangi sayt fayli
cat > /etc/nginx/snippets/sales-proxy.conf <<'EOF'
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
# proxy_read_timeout har bir location'da alohida beriladi (nginx takror direktivaga ruxsat bermaydi)
EOF
sed "s/__DOMAIN__/$DOMAIN/" "$APP/deploy/nginx-sales.conf" > /etc/nginx/sites-available/sales.conf
ln -sf /etc/nginx/sites-available/sales.conf /etc/nginx/sites-enabled/sales.conf
nginx -t && systemctl reload nginx
echo "== nginx: sales.conf qo'shildi, boshqa saytlar tekshiruvdan o'tdi"

# 3) konteynerlar
cd "$APP/deploy/docker"
docker compose up -d --build
sleep 5

# 4) kunlik zaxira (host cron -> konteyner ichida)
cat > /etc/cron.d/sales-backup <<'EOF'
# Photobuy sotuv — har kuni UTC 21:30 (Toshkent 02:30) baza zaxirasi, 14 kun saqlanadi
30 21 * * * root docker exec sales-api node --disable-warning=ExperimentalWarning scripts/backup.js >> /var/log/sales-backup.log 2>&1
EOF
chmod 644 /etc/cron.d/sales-backup

# 5) tekshiruv
echo "== health"
curl -s -o /dev/null -w "api  %{http_code}\n" http://127.0.0.1:8200/api/health || true
curl -s -o /dev/null -w "panel %{http_code}\n" http://127.0.0.1:3000/login || true

# 6) HTTPS
if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  command -v certbot >/dev/null && certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
    --register-unsafely-without-email --redirect || echo "!! Sertifikat olinmadi — HTTP ishlaydi"
fi

echo "== Boshqa konteynerlar (keyin)"; docker ps --format '{{.Names}} {{.Status}}'
echo "Tayyor: https://$DOMAIN"
