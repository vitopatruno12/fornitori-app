# Aggiunge Enable Banking + profilo BPPB al .env di produzione SENZA cancellare il resto.
# Uso sul server (dopo aver caricato i file in /tmp):
#   sudo bash /tmp/apply-enable-banking-secrets.sh
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/fornitori-app}"
ENV_FILE="$APP_DIR/backend/.env"
KEYS_DIR="$APP_DIR/backend/keys"
PEM_SRC="${PEM_SRC:-/tmp/3e9be5df-1371-4fe0-8724-e47ffb14d328.pem}"
FRAG_SRC="${FRAG_SRC:-/tmp/enable-banking.env.fragment}"
PEM_NAME="3e9be5df-1371-4fe0-8724-e47ffb14d328.pem"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERRORE: manca $ENV_FILE"
  exit 1
fi
if [[ ! -f "$PEM_SRC" ]]; then
  echo "ERRORE: manca PEM $PEM_SRC"
  exit 1
fi
if [[ ! -f "$FRAG_SRC" ]]; then
  echo "ERRORE: manca fragment $FRAG_SRC"
  exit 1
fi

mkdir -p "$KEYS_DIR"
install -m 600 "$PEM_SRC" "$KEYS_DIR/$PEM_NAME"
chown root:root "$KEYS_DIR/$PEM_NAME" 2>/dev/null || true

# Rimuove chiavi precedenti Enable Banking / BANK_* del profilo (le riscriviamo)
cp -a "$ENV_FILE" "$ENV_FILE.bak.$(date +%Y%m%d%H%M%S)"
tmp="$(mktemp)"
grep -vE '^(BANK_NAME|BANK_IBAN|BANK_ACCOUNT_NUMBER|BANK_USERNAME|BANK_PASSWORD|BANK_OTP_DEBUG|ENABLE_BANKING_)=|^# --- Banca BPPB|^# --- Enable Banking' "$ENV_FILE" > "$tmp" || true
printf '\n' >> "$tmp"
cat "$FRAG_SRC" >> "$tmp"
mv "$tmp" "$ENV_FILE"
chmod 600 "$ENV_FILE"

# Migration colonne Enable Banking (se possibile)
if [[ -f "$APP_DIR/backend/migrations/20260826_enable_banking.sql" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  if command -v psql >/dev/null 2>&1 && [[ -n "${DATABASE_URL:-}" ]]; then
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$APP_DIR/backend/migrations/20260826_enable_banking.sql" || \
      echo "AVVISO: migration SQL fallita (esegui a mano come owner tabella)"
  fi
fi

# PyJWT se manca
VENV="$APP_DIR/backend/venv"
[[ -x "$APP_DIR/backend/.venv/bin/pip" ]] && VENV="$APP_DIR/backend/.venv"
if [[ -x "$VENV/bin/pip" ]]; then
  "$VENV/bin/pip" install -q 'PyJWT[crypto]>=2.8.0' || true
fi

systemctl restart fornitori-api 2>/dev/null || systemctl restart atlas-api 2>/dev/null || true
sleep 1
curl -sf https://www.atlass.it/api/banca/enable-banking/status | head -c 400 || true
echo
echo "OK: PEM in $KEYS_DIR/$PEM_NAME"
echo "OK: variabili aggiunte a $ENV_FILE (backup .bak.* creato)"
echo "Verifica: curl -s https://www.atlass.it/api/banca/enable-banking/status"
