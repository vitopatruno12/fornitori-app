#!/usr/bin/env bash
#
# install-server.sh
# Bootstrap iniziale di un server Ubuntu (22.04 / 24.04) per fornitori-app backend.
#
# Cosa fa:
#  - Aggiorna OS
#  - Installa: Postgres 16, Python 3.12, Caddy, git, build-essential
#  - Crea utente di sistema "fornitori" (no shell login)
#  - Crea database e role fornitori_user
#  - Configura firewall UFW (apre 22, 80, 443)
#  - NON clona il repo: lo fai con deploy-app.sh
#
# Uso (come root o con sudo):
#   sudo bash install-server.sh
#
# Variabili modificabili sotto:

set -euo pipefail

DB_NAME="${DB_NAME:-fornitori_db}"
DB_USER="${DB_USER:-fornitori_user}"
DB_PASS="${DB_PASS:-$(openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 24)}"
APP_USER="${APP_USER:-fornitori}"
APP_DIR="${APP_DIR:-/opt/fornitori-app}"

log() { printf "\n\033[1;32m==> %s\033[0m\n" "$*"; }
warn() { printf "\n\033[1;33m[!] %s\033[0m\n" "$*"; }

if [[ $EUID -ne 0 ]]; then
   echo "Devi essere root (usa: sudo bash $0)"
   exit 1
fi

. /etc/os-release
if [[ "$ID" != "ubuntu" ]]; then
   warn "Script testato su Ubuntu. Sei su: $ID $VERSION_ID. Procedo lo stesso..."
fi

log "Aggiornamento pacchetti di sistema"
apt-get update -y
apt-get upgrade -y

log "Installazione pacchetti base"
apt-get install -y \
    ca-certificates curl gnupg lsb-release \
    git build-essential pkg-config \
    ufw fail2ban \
    python3.12 python3.12-venv python3.12-dev \
    libpq-dev

log "Installazione PostgreSQL 16"
if ! command -v psql >/dev/null 2>&1; then
    install -d /usr/share/postgresql-common/pgdg
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
        | gpg --dearmor -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] \
https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
        > /etc/apt/sources.list.d/pgdg.list
    apt-get update -y
    apt-get install -y postgresql-16
fi

systemctl enable --now postgresql

log "Installazione Caddy"
if ! command -v caddy >/dev/null 2>&1; then
    apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
        | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
        | tee /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -y
    apt-get install -y caddy
fi

systemctl enable --now caddy

log "Configurazione firewall UFW"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment 'SSH'
ufw allow 80/tcp  comment 'HTTP'
ufw allow 443/tcp comment 'HTTPS'
ufw --force enable

log "Creazione utente di sistema $APP_USER"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
    useradd --system --shell /usr/sbin/nologin --home "$APP_DIR" --create-home "$APP_USER"
fi

log "Cartella applicazione $APP_DIR"
install -d -o "$APP_USER" -g "$APP_USER" -m 755 "$APP_DIR"
install -d -o "$APP_USER" -g "$APP_USER" -m 755 "$APP_DIR/backups"

log "Creazione database e ruolo Postgres"
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$DB_USER') THEN
    CREATE ROLE $DB_USER LOGIN PASSWORD '$DB_PASS';
  ELSE
    ALTER ROLE $DB_USER WITH LOGIN PASSWORD '$DB_PASS';
  END IF;
END
\$\$;

SELECT 'CREATE DATABASE $DB_NAME OWNER $DB_USER'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DB_NAME')\gexec
SQL

log "Scrittura credenziali in /root/fornitori_db_credentials.txt (leggi e poi cancella)"
cat > /root/fornitori_db_credentials.txt <<EOF
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASS=$DB_PASS
DATABASE_URL=postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME
EOF
chmod 600 /root/fornitori_db_credentials.txt

log "Installazione completata"
cat <<EOF

================================================================
  STATO INIZIALE
================================================================
  OS:        $(. /etc/os-release; echo "$PRETTY_NAME")
  Python:    $(python3.12 --version)
  Postgres:  $(sudo -u postgres psql -tAc 'SELECT version()' | head -1)
  Caddy:     $(caddy version)
  Firewall:  attivo (22/80/443 aperte)

  App user:  $APP_USER
  App dir:   $APP_DIR
  DB URL:    salvato in /root/fornitori_db_credentials.txt

  PROSSIMI PASSI:
  1) cat /root/fornitori_db_credentials.txt   # copia DATABASE_URL
  2) Esegui: bash $APP_DIR/deploy/deploy-app.sh
  3) Importa backup DB: bash $APP_DIR/deploy/restore-db.sh /percorso/backup.sql
  4) Configura Caddyfile col tuo dominio: nano /etc/caddy/Caddyfile
================================================================
EOF
