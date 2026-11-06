#!/usr/bin/env bash
# Mac'dan serverga yangilash: Node API → /opt/sales/app, Next.js panel → /opt/sales/ui. data/ va .env tegmaydi.
#   bash deploy/deploy.sh [root@81.85.51.93]
set -euo pipefail
HOST="${1:-root@81.85.51.93}"
cd "$(dirname "$0")/.."
if ! node --test test/ >/dev/null; then echo "TESTLAR O‘TMADI — deploy to‘xtatildi (node --test test/ bilan ko‘ring)"; exit 1; fi
echo "testlar: OK"
# Panel: yig‘ish Mac’da (serverda RAM kam), tayyor standalone papka yuboriladi
(cd web && npm ci --silent && npx tsc --noEmit && BACKEND_URL=http://127.0.0.1:8200 npm run build)
echo "panel yig‘ildi: OK"
rsync -az --delete --exclude data --exclude .env --exclude .git --exclude node_modules --exclude web ./ "$HOST:/opt/sales/app/"
ssh "$HOST" 'install -d -o root -g sales -m 750 /opt/sales/ui'
rsync -az --delete web/.next/standalone/ "$HOST:/opt/sales/ui/"
ssh "$HOST" 'chown -R root:sales /opt/sales/app /opt/sales/ui && chmod -R g+rX,o-rwx /opt/sales/app /opt/sales/ui && systemctl restart sales-web sales-ui && sleep 3 && systemctl is-active sales-web sales-ui && curl -s -o /dev/null -w "api %{http_code}\n" http://127.0.0.1:8200/api/health && curl -s -o /dev/null -w "panel %{http_code}\n" http://127.0.0.1:3000/login && echo "Nova: $(systemctl is-active claude-nova)"'
