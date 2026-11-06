#!/usr/bin/env bash
# Photobuy sotuv — serverni birinchi marta tayyorlash (root, idempotent).
#   bash /opt/sales/app/deploy/setup.sh <domen>
# Nova'ga tegmaydi: claude-nova.service, /home/claude va claude crontab'i o‘zgarmaydi.
set -euo pipefail
DOMAIN="${1:?domen kerak, masalan: sotuv.81-85-51-93.sslip.io}"
APP=/opt/sales/app

echo "== Nova holati (oldin)"; systemctl is-active claude-nova || true
echo "== RAM"; free -h | sed -n 1,2p

# 1) foydalanuvchi va papkalar
id sales >/dev/null 2>&1 || useradd --system --home-dir /opt/sales --shell /usr/sbin/nologin sales
install -d -o sales -g sales -m 750 /opt/sales/data
install -d -o root -g sales -m 750 /opt/sales
chown -R root:sales "$APP"; chmod -R g+rX,o-rwx "$APP"
if [ ! -f /opt/sales/.env ]; then
  umask 077
  cat > /opt/sales/.env <<EOF
HOST=127.0.0.1
PORT=8200
PUBLIC_URL=https://$DOMAIN
SECURE=1
DATA_DIR=/opt/sales/data
DEMO_DATA=1
EOF
fi
chown root:sales /opt/sales/.env; chmod 640 /opt/sales/.env

# 2) node
NODE="$(command -v node)"
case "$NODE" in /root/*|/home/*) echo "Node $NODE — sales foydalanuvchisi ko‘ra olmaydi. /usr/bin/node kerak."; exit 1;; esac
"$NODE" -e "require('node:sqlite')" 2>/dev/null || { echo "Node $("$NODE" -v) da node:sqlite yo‘q (>=22.13 kerak)"; exit 1; }

# 3) nginx + certbot (faqat yo‘q bo‘lsa)
if ! command -v nginx >/dev/null; then
  avail=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
  echo "== bo‘sh RAM: ${avail} MB"; [ "$avail" -gt 300 ] || { echo "RAM juda kam — to‘xtatildi"; exit 1; }
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx certbot python3-certbot-nginx
fi
cat > /etc/nginx/snippets/sales-proxy.conf <<'EOF'
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_read_timeout 90s;
EOF
sed "s/__DOMAIN__/$DOMAIN/" "$APP/deploy/nginx-sales.conf" > /etc/nginx/sites-available/sales.conf
ln -sf /etc/nginx/sites-available/sales.conf /etc/nginx/sites-enabled/sales.conf
[ -e /etc/nginx/sites-enabled/default ] && rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl enable --now nginx && systemctl reload nginx

# 4) systemd
install -d -o root -g sales -m 750 /opt/sales/ui
for u in sales-web.service sales-ui.service sales-backup.service; do sed "s#__NODE__#$NODE#" "$APP/deploy/$u" > /etc/systemd/system/$u; done
cp "$APP/deploy/sales-backup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now sales-web.service sales-backup.timer
sleep 2; systemctl is-active sales-web
# Panel (Next.js) birinchi deploy.sh dan keyin ishga tushadi (/opt/sales/ui hali bo‘sh)
systemctl enable sales-ui.service

# 5) HTTPS (Let's Encrypt)
if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect || echo "!! Sertifikat olinmadi — HTTP ishlaydi, keyinroq qayta urinib ko‘ring"
fi

echo "== Nova holati (keyin)"; systemctl is-active claude-nova || true
echo "Tayyor: https://$DOMAIN"
