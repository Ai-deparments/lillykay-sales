#!/usr/bin/env bash
# Kompyuterdan Contabo serverga joylash/yangilash (rsync shart emas — tar+ssh).
#   bash deploy/docker/joylash.sh
# data/ va .env tegilmaydi. Konteynerlar qaytadan yig'iladi va ko'tariladi.
set -euo pipefail
HOST="${HOST:-root@62.171.139.200}"
KEY="${KEY:-$HOME/.ssh/contabo}"
cd "$(dirname "$0")/../.."

echo "== fayllar yuborilmoqda -> $HOST:/opt/sales/app"
ssh -i "$KEY" "$HOST" 'install -d -m 755 /opt/sales/app'
tar czf - \
  --exclude=.git --exclude=data --exclude=backups --exclude=node_modules \
  --exclude=web/node_modules --exclude=web/.next --exclude='*.env' --exclude=.env \
  --exclude='*.db' --exclude='*.db-shm' --exclude='*.db-wal' --exclude='*.log' \
  . | ssh -i "$KEY" "$HOST" 'tar xzf - -C /opt/sales/app'

echo "== konteynerlar yig'ilmoqda"
ssh -i "$KEY" "$HOST" 'cd /opt/sales/app/deploy/docker && docker compose up -d --build && sleep 6 && docker compose ps'

echo "== tekshiruv"
ssh -i "$KEY" "$HOST" 'curl -s -o /dev/null -w "api   %{http_code}\n" http://127.0.0.1:8200/api/health; curl -s -o /dev/null -w "panel %{http_code}\n" http://127.0.0.1:3000/login; echo "Odoo: $(docker inspect -f "{{.State.Status}}" odoo-app)"'
