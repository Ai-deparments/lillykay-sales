#!/usr/bin/env bash
# Biolife sotuv — serverni birinchi marta tayyorlash (root, idempotent).
# Cloudflare Tunnel varianti: ochiq port, sertifikat va certbot KERAK EMAS.
#
#   bash /opt/sales/app/deploy/setup-cloudflare.sh sotuv.biolife-ai.uz
#
# Farqi (asl setup.sh dan):
#   * certbot yo'q — HTTPS ni Cloudflare beradi
#   * nginx faqat 127.0.0.1:8080 da tinglaydi (tashqariga ochiq emas)
#   * cloudflared tunnel shu 8080 ga yo'naltiriladi (ingress qoidasi Cloudflare panelida)
#
# Nova, Imir va Rustam'ga tegmaydi: claude-* servislari va /home/claude o'zgarmaydi.
set -euo pipefail

DOMAIN="${1:?domen kerak, masalan: sotuv.biolife-ai.uz}"
APP=/opt/sales/app
PORT_NGINX=8080

echo "== Jonli agentlar holati (oldin)"
for s in claude-nova claude-biolife claude-kreator; do
  printf '   %-16s %s\n' "$s" "$(systemctl is-active $s 2>/dev/null || echo yo\'q)"
done
echo "== Xotira"; free -h | sed -n 2p

# 1) foydalanuvchi va papkalar
id sales >/dev/null 2>&1 || useradd --system --home-dir /opt/sales --shell /usr/sbin/nologin sales
install -d -o root -g sales -m 750 /opt/sales
install -d -o sales -g sales -m 750 /opt/sales/data
install -d -o root  -g sales -m 750 /opt/sales/ui
chown -R root:sales "$APP"; chmod -R g+rX,o-rwx "$APP"

# 2) sozlamalar fayli (bir marta yaratiladi, keyin qo'lda to'ldiriladi)
if [ ! -f /opt/sales/.env ]; then
  umask 077
  cat > /opt/sales/.env <<EOF
HOST=127.0.0.1
PORT=8200
PUBLIC_URL=https://$DOMAIN
SECURE=1
DATA_DIR=/opt/sales/data

# Biolife: Telegram orqali sotuv YO'Q — faqat Instagram
TG_DISABLED=1

# Biolife BILLZ ishlatmaydi — sotuv bazasi ulanmagan
# BILLZ_SECRET_TOKEN=

# Demo ma'lumot o'chiq — haqiqiy ish rejimi
DEMO_DATA=0

# Instagram (anora.drink va juze.uz) — sozla.sh orqali kiritiladi
# IG_APP_SECRET=
# IG_VERIFY_TOKEN=

# AI (4 agent uchun) — sozla.sh orqali kiritiladi
# ANTHROPIC_API_KEY=
AI_MODEL=claude-opus-5
AI_EFFORT=medium
EOF
fi
chown root:sales /opt/sales/.env; chmod 640 /opt/sales/.env

# 3) node tekshiruvi (sales foydalanuvchisi ko'ra olishi shart)
NODE="$(command -v node)"
case "$NODE" in /root/*|/home/*) echo "Node $NODE — sales foydalanuvchisi ko'ra olmaydi."; exit 1;; esac
"$NODE" -e "require('node:sqlite')" 2>/dev/null || { echo "Node $("$NODE" -v) da node:sqlite yo'q (>=22.13 kerak)"; exit 1; }
echo "== Node: $NODE $("$NODE" -v)"

# 4) nginx — faqat ichki marshrutlovchi (tashqariga ochiq emas)
if ! command -v nginx >/dev/null; then
  avail=$(awk '/MemAvailable/ {print int($2/1024)}' /proc/meminfo)
  echo "== bo'sh RAM: ${avail} MB"; [ "$avail" -gt 300 ] || { echo "RAM juda kam — to'xtatildi"; exit 1; }
  DEBIAN_FRONTEND=noninteractive apt-get update -qq
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nginx
fi

cat > /etc/nginx/snippets/sales-proxy.conf <<'EOF'
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto https;
proxy_read_timeout 90s;
EOF

cat > /etc/nginx/sites-available/sales.conf <<EOF
# Biolife sotuv — faqat ichki. Tashqi dunyo Cloudflare Tunnel orqali keladi.
server {
    listen 127.0.0.1:$PORT_NGINX;
    server_name $DOMAIN;
    client_max_body_size 25m;

    # Kirish (brute-force dan himoya uchun alohida)
    location = /api/login {
        include snippets/sales-proxy.conf;
        proxy_pass http://127.0.0.1:8200;
    }
    location /api/ {
        include snippets/sales-proxy.conf;
        proxy_pass http://127.0.0.1:8200;
    }
    # Instagram veb-huki
    location /webhook/ {
        include snippets/sales-proxy.conf;
        proxy_pass http://127.0.0.1:8200;
    }
    # Panel (Next.js)
    location / {
        include snippets/sales-proxy.conf;
        proxy_pass http://127.0.0.1:3000;
    }
}
EOF
ln -sf /etc/nginx/sites-available/sales.conf /etc/nginx/sites-enabled/sales.conf
[ -e /etc/nginx/sites-enabled/default ] && rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl enable --now nginx && systemctl reload nginx

# 5) systemd servislari
for u in sales-web.service sales-ui.service sales-backup.service; do
  sed "s#__NODE__#$NODE#" "$APP/deploy/$u" > /etc/systemd/system/$u
done
cp "$APP/deploy/sales-backup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now sales-web.service sales-backup.timer
sleep 2
echo "== sales-web: $(systemctl is-active sales-web)"
# Panel /opt/sales/ui ga qurilgandan keyin yoqiladi
systemctl enable sales-ui.service >/dev/null 2>&1 || true

echo "== Jonli agentlar holati (keyin)"
for s in claude-nova claude-biolife claude-kreator; do
  printf '   %-16s %s\n' "$s" "$(systemctl is-active $s 2>/dev/null || echo yo\'q)"
done

cat <<EOF

Tayyor. Ichki manzil: http://127.0.0.1:$PORT_NGINX

Keyingi qadam — Cloudflare panelida tunnelga ingress qoidasi qo'shish:
    $DOMAIN  ->  http://localhost:$PORT_NGINX
(Zero Trust -> Networks -> Tunnels -> tunnelni tanlang -> Public Hostname -> Add)
EOF
