#!/usr/bin/env bash
# Maxfiy kalitlarni SERVERDA kiritish (chatga yozilmaydi). Foydalanuvchi o‘zi ishga tushiradi:
#   ssh -t root@SERVER 'bash /opt/sales/app/deploy/sozla.sh'            — hammasi
#   ssh -t root@SERVER 'bash /opt/sales/app/deploy/sozla.sh anthropic'  — faqat bitta: bot | anthropic | gemini | billz | instagram | demo
# Bo‘sh qoldirilgan qiymat — o‘zgarmaydi. Kalit tekshiruvdan o‘tmasa — saqlanmaydi.
# Kalitlar curl’ga buyruq qatori orqali EMAS, stdin orqali beriladi: `ps` ro‘yxatida (serverdagi boshqa foydalanuvchilarga) ko‘rinmaydi.
set -euo pipefail
ENV=/opt/sales/.env
ONLY="${1:-all}"
[ -f "$ENV" ] || { echo "$ENV yo‘q — avval setup.sh"; exit 1; }

setkey() { # setkey KEY VALUE
  local k="$1" v="$2" tmp; tmp=$(mktemp)
  grep -v "^$k=" "$ENV" > "$tmp" || true
  printf '%s=%s\n' "$k" "$v" >> "$tmp"
  cat "$tmp" > "$ENV"; rm -f "$tmp"
}
ask() { local p="$1" v; read -r -s -p "$p: " v; echo >&2; printf '%s' "$v" | tr -d '[:space:]'; }
want() { [ "$ONLY" = all ] || [ "$ONLY" = "$1" ]; }
changed=0

echo "Photobuy sotuv — kalitlar. Bo‘sh qoldirsangiz (Enter), o‘zgarmaydi. Yozganingiz ekranda ko‘rinmaydi."

if want bot; then
  echo; echo "MUHIM: @photobuy_ai_bot (Nova) tokenini KIRITMANG — sotuv uchun alohida bot."
  T=$(ask "1) Sotuv boti tokeni (BotFather)")
  if [ -n "$T" ]; then
    U=$(printf 'url = "https://api.telegram.org/bot%s/getMe"\n' "$T" | curl -s -K - | python3 -c 'import sys,json; d=json.load(sys.stdin); print(d["result"]["username"] if d.get("ok") else "")' 2>/dev/null || true)
    if [ -z "$U" ]; then echo "   Token ishlamadi — saqlanmadi."
    elif [ "$(echo "$U" | tr 'A-Z' 'a-z')" = "photobuy_ai_bot" ]; then echo "   @$U — bu Nova boti! Saqlanmadi."
    else setkey TG_BOT_TOKEN "$T"; changed=1; echo "   Saqlandi: @$U"; fi
  fi
fi

if want anthropic; then
  echo
  A=$(ask "2) Anthropic API kaliti (sk-ant-api...)")
  if [ -n "$A" ]; then
    case "$A" in sk-ant-*) ;; *) echo "   sk-ant- bilan boshlanmaydi — saqlanmadi."; A="";; esac
    if [ -n "$A" ]; then
      code=$(printf 'url = "https://api.anthropic.com/v1/models"\nheader = "x-api-key: %s"\nheader = "anthropic-version: 2023-06-01"\noutput = "/dev/null"\nwrite-out = "%%{http_code}"\n' "$A" | curl -s -K - || echo 000)
      if [ "$code" = 200 ]; then setkey ANTHROPIC_API_KEY "$A"; changed=1; echo "   Kalit tekshirildi va saqlandi (${#A} belgi)."
      else echo "   Kalit ishlamadi (HTTP $code, ${#A} belgi) — saqlanmadi. To‘liq nusxalanganini tekshiring."; fi
    fi
  fi
fi

if want gemini; then
  echo
  echo "   Gemini: Google AI Studio (aistudio.google.com) yoki Vertex AI kaliti. Mijoz yozishmalari uchun billing ulangan (pullik) loyiha kaliti bo‘lsin —"
  echo "   bepul tarifda Google yuborilgan ma’lumotdan o‘z mahsulotlarini yaxshilashda foydalanishi mumkin."
  G=$(ask "2b) Gemini API kaliti")
  if [ -n "$G" ]; then
    R=$(printf '%s' "$G" | node /opt/sales/app/scripts/gemini-sozla.js) || R=""
    if [ -n "$R" ]; then
      read -r GE GM GF <<< "$R"; [ "$GF" = "-" ] && GF=""
      setkey GEMINI_API_KEY "$G"; setkey GEMINI_ENDPOINT "$GE"; setkey GEMINI_MODEL "$GM"; setkey GEMINI_FALLBACKS "$GF"; setkey AI_PROVIDER gemini; changed=1
      echo "   Kalit tekshirildi va saqlandi (${#G} belgi). AI: $GM — mijoz bilan yozishish, rasm va ovozli xabarlar."
    else echo "   Kalit ishlamadi — saqlanmadi (${#G} belgi). Sababi yuqorida."; fi
  fi
fi

if want billz; then
  echo
  B=$(ask "3) BILLZ secret token")
  if [ -n "$B" ]; then
    case "$B" in sk-ant-*) echo "   Bu Anthropic kalitiga o‘xshaydi — BILLZ sifatida saqlanmadi.";;
      *)
        # Rasmiy tekshiruv: POST /v1/auth/login (docs.billz.io). Kalit JSON’ga python orqali, stdin bilan
        code=$(printf '%s' "$B" | python3 -c 'import sys,json; print(json.dumps({"secret_token": sys.stdin.read()}))' \
          | curl -s -o /dev/null -w "%{http_code}" -X POST https://api-admin.billz.ai/v1/auth/login -H 'content-type: application/json' --data-binary @- || echo 000)
        if [ "$code" = 200 ]; then setkey BILLZ_SECRET_TOKEN "$B"; changed=1; echo "   BILLZ kaliti tekshirildi va saqlandi (${#B} belgi). Sinxron bir daqiqada boshlanadi."
        elif [ "$code" = 401 ] || [ "$code" = 403 ]; then echo "   BILLZ kalitni qabul qilmadi (HTTP $code) — saqlanmadi. BILLZ → Настройки → Настройки компании → Ключи интеграции dan yangi kalit oling."
        else echo "   BILLZ bilan bog‘lanib bo‘lmadi (HTTP $code) — saqlanmadi, birozdan keyin qayta urinib ko‘ring."; fi;;
    esac
  fi
fi

if want instagram; then
  echo; echo "Instagram Direct (Meta). Kerak: Meta ilovasi, Instagram Professional akkaunt, veb-huk manzili https://<domen>/webhook/instagram"
  IGT=$(ask "5) Instagram token (uzoq muddatli)")
  if [ -n "$IGT" ]; then
    read -r -p "   Instagram akkaunt ID (IG_USER_ID): " IGU; IGU=$(printf '%s' "$IGU" | tr -d '[:space:]')
    IGS=$(ask "   Meta ilovasining App Secret")
    BASE=$(grep -m1 '^IG_API_BASE=' "$ENV" | cut -d= -f2-); BASE=${BASE:-https://graph.instagram.com/v23.0}
    # Tokenni tekshirish: profil o‘qiladi (token buyruq qatoriga tushmaydi — stdin orqali)
    OUT=$(printf 'url = "%s/me?fields=user_id,username"\nheader = "Authorization: Bearer %s"\n' "$BASE" "$IGT" | curl -s -K - || true)
    NAME=$(printf '%s' "$OUT" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("username",""))' 2>/dev/null || true)
    if [ -z "$NAME" ]; then echo "   Token ishlamadi — saqlanmadi. Javob: $(printf '%s' "$OUT" | head -c 160)"
    elif [ -z "$IGU" ] || [ -z "$IGS" ]; then echo "   IG_USER_ID yoki App Secret bo‘sh — saqlanmadi."
    else
      VER=$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 24)
      setkey IG_TOKEN "$IGT"; setkey IG_USER_ID "$IGU"; setkey IG_APP_SECRET "$IGS"; setkey IG_VERIFY_TOKEN "$VER"; changed=1
      echo "   Saqlandi: @$NAME"
      echo "   Meta veb-hukida ishlating — Callback URL: $(grep -m1 '^PUBLIC_URL=' "$ENV" | cut -d= -f2-)/webhook/instagram"
      echo "   Verify token (Meta’ga kiritiladi): $VER"
    fi
  fi
fi

if want demo; then
  echo
  read -r -p "4) Demo ma’lumot: 1 = yoqilgan, 0 = o‘chiq [Enter — o‘zgarmasin]: " D
  D=$(printf '%s' "$D" | tr -d '[:space:]')
  case "$D" in "") ;; 0|1) setkey DEMO_DATA "$D"; changed=1; echo "   DEMO_DATA=$D";; *) echo "   Faqat 1 yoki 0 — o‘zgarmadi. (Bu yerga kalit kiritmang.)";; esac
fi

# Ikki xil joylashtirish: systemd (sales foydalanuvchisi) yoki Docker (konteyner, root o'qiydi)
if id sales >/dev/null 2>&1; then chown root:sales "$ENV"; chmod 640 "$ENV"; else chown root:root "$ENV"; chmod 600 "$ENV"; fi
if [ "$changed" = 1 ]; then
  if systemctl is-enabled sales-web >/dev/null 2>&1; then
    systemctl restart sales-web; sleep 2; echo; echo "sales-web: $(systemctl is-active sales-web)"
  elif [ -f /opt/sales/app/deploy/docker/docker-compose.yml ]; then
    (cd /opt/sales/app/deploy/docker && docker compose up -d --force-recreate api >/dev/null 2>&1)
    sleep 6; echo; echo "sales-api: $(docker inspect -f '{{.State.Status}}' sales-api)"
  fi
fi
systemctl is-active claude-nova >/dev/null 2>&1 && echo "Nova: $(systemctl is-active claude-nova)" || true
