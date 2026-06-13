#!/usr/bin/env bash
#
# deploy-app.sh
# Clona/aggiorna il codice e installa le dipendenze Python.
# Da eseguire DOPO install-server.sh.
#
# Idempotente: puoi lanciarlo ogni volta che fai un release.
#
# Uso (come root o con sudo):
#   sudo bash deploy-app.sh [REPO_URL] [BRANCH]
# Default: repo public GitHub, branch main

set -euo pipefail

REPO_URL="${1:-https://github.com/vitopatruno12/fornitori-app.git}"
BRANCH="${2:-main}"
APP_DIR="${APP_DIR:-/opt/fornitori-app}"

log() { printf "\n\033[1;32m==> %s\033[0m\n" "$*"; }

resolve_venv_dir() {
    if [[ -n "${VENV_DIR:-}" ]]; then
        echo "$VENV_DIR"
        return
    fi
    if [[ -d "$APP_DIR/backend/venv" ]]; then
        echo "$APP_DIR/backend/venv"
        return
    fi
    if [[ -d "$APP_DIR/backend/.venv" ]]; then
        echo "$APP_DIR/backend/.venv"
        return
    fi
    echo "$APP_DIR/backend/venv"
}

resolve_app_user() {
    if [[ -n "${APP_USER:-}" ]] && id "$APP_USER" &>/dev/null; then
        echo "$APP_USER"
        return
    fi
    if id fornitori &>/dev/null; then
        echo fornitori
        return
    fi
    if [[ -n "${SUDO_USER:-}" ]] && id "$SUDO_USER" &>/dev/null; then
        echo "$SUDO_USER"
        return
    fi
    if [[ -d "$APP_DIR" ]]; then
        stat -c '%U' "$APP_DIR" 2>/dev/null || true
        return
    fi
    echo root
}

APP_USER="$(resolve_app_user)"
APP_GROUP="$(id -gn "$APP_USER" 2>/dev/null || echo "$APP_USER")"
VENV_DIR="$(resolve_venv_dir)"
log "Utente deploy: $APP_USER:$APP_GROUP (APP_DIR=$APP_DIR, VENV=$VENV_DIR)"

if [[ $EUID -ne 0 ]]; then
   echo "Devi essere root (usa: sudo bash $0)"
   exit 1
fi

if [[ ! -d "$APP_DIR/.git" ]]; then
    log "Primo clone del repo in $APP_DIR"
    rm -rf "$APP_DIR/_tmp_clone"
    git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR/_tmp_clone"
    shopt -s dotglob
    mv "$APP_DIR/_tmp_clone"/* "$APP_DIR"/
    rm -rf "$APP_DIR/_tmp_clone"
    shopt -u dotglob
else
    log "Aggiornamento repo (git pull)"
    git -C "$APP_DIR" fetch origin
    git -C "$APP_DIR" checkout "$BRANCH"
    git -C "$APP_DIR" pull --ff-only origin "$BRANCH"
fi

if id "$APP_USER" &>/dev/null; then
    chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"
else
    log "Salto chown: utente $APP_USER non trovato"
fi

log "Creazione/aggiornamento virtualenv Python"
PY_BOOT="$(command -v python3.12 || command -v python3)"
if [[ ! -d "$VENV_DIR" ]]; then
    if [[ "$(id -un)" == "$APP_USER" ]]; then
        "$PY_BOOT" -m venv "$VENV_DIR"
    else
        sudo -u "$APP_USER" "$PY_BOOT" -m venv "$VENV_DIR"
    fi
fi
if [[ "$(id -un)" == "$APP_USER" ]]; then
    "$VENV_DIR/bin/pip" install --upgrade pip wheel
    "$VENV_DIR/bin/pip" install -r "$APP_DIR/backend/requirements.txt"
else
    sudo -u "$APP_USER" "$VENV_DIR/bin/pip" install --upgrade pip wheel
    sudo -u "$APP_USER" "$VENV_DIR/bin/pip" install -r "$APP_DIR/backend/requirements.txt"
fi

log "Directory scrivibili per systemd (ReadWritePaths)"
mkdir -p "$APP_DIR/backend/app/uploads" "$APP_DIR/backups"
if id "$APP_USER" &>/dev/null; then
    chown -R "$APP_USER:$APP_GROUP" "$APP_DIR/backend/app/uploads" "$APP_DIR/backups"
fi

log "Verifica file .env produzione"
ENV_FILE="$APP_DIR/backend/.env"
if [[ ! -f "$ENV_FILE" ]]; then
    log "Creo .env da template (DEVI EDITARLO PRIMA DI AVVIARE)"
    cp "$APP_DIR/deploy/env.production.example" "$ENV_FILE"
    chown "$APP_USER:$APP_USER" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    echo
    echo "================================================================"
    echo "  ATTENZIONE: configura $ENV_FILE prima del primo avvio."
    echo "  Suggerimento: prendi DATABASE_URL da /root/fornitori_db_credentials.txt"
    echo "    cat /root/fornitori_db_credentials.txt"
    echo "    nano $ENV_FILE"
    echo "================================================================"
fi

log "Verifica import app (preflight)"
if ! sudo -u "$APP_USER" bash -c "cd '$APP_DIR/backend' && '$VENV_DIR/bin/python' -c 'from app.main import app; print(\"import OK\")'" 2>&1; then
    echo
    echo "================================================================"
    echo "  ERRORE: l'app non si importa. Correggi prima di avviare systemd."
    echo "  Prova manualmente:"
    echo "    cd $APP_DIR/backend"
    echo "    sudo -u $APP_USER $VENV_DIR/bin/python -c 'from app.main import app'"
    echo "================================================================"
    exit 1
fi

port_8000_pid() {
    ss -tlnp "sport = :8000" 2>/dev/null | grep -oP 'pid=\K[0-9]+' | head -1 || true
}

port_8000_managed_by_pm2() {
    local pid
    pid="$(port_8000_pid)"
    [[ -n "$pid" && -r "/proc/$pid/cgroup" ]] && grep -q 'pm2' "/proc/$pid/cgroup"
}

free_api_port() {
    local port=8000
    systemctl stop fornitori-api 2>/dev/null || true
    systemctl reset-failed fornitori-api 2>/dev/null || true
    systemctl stop atlas.service 2>/dev/null || true
    sleep 1
    if port_8000_managed_by_pm2; then
        echo
        echo "================================================================"
        echo "  Porta 8000 gestita da PM2 (pm2-mic04.service), non da fornitori-api."
        echo "  PM2 riavvia uvicorn dopo ogni kill — va rimosso da PM2:"
        echo "    pm2 list"
        echo "    pm2 delete <nome|id>    # processo uvicorn su :8000"
        echo "    pm2 save"
        echo "  Poi rilancia: sudo APP_DIR=$APP_DIR bash deploy/deploy-app.sh"
        echo "================================================================"
        exit 1
    fi
    if command -v ss &>/dev/null && ss -tln "sport = :$port" 2>/dev/null | grep -q ":$port"; then
        log "Porta $port occupata — termino processo uvicorn orfano"
        if command -v fuser &>/dev/null; then
            fuser -k "${port}/tcp" 2>/dev/null || true
        elif command -v lsof &>/dev/null; then
            local pids
            pids="$(lsof -ti ":$port" 2>/dev/null || true)"
            if [[ -n "$pids" ]]; then
                kill $pids 2>/dev/null || true
            fi
        fi
        sleep 2
        if ss -tln "sport = :$port" 2>/dev/null | grep -q ":$port"; then
            log "Porta $port ancora occupata — kill -9"
            fuser -k -9 "${port}/tcp" 2>/dev/null || true
            sleep 1
        fi
    fi
}

log "Installazione systemd unit fornitori-api"
sed -e "s|/opt/fornitori-app/backend/venv|$VENV_DIR|g" \
    -e "s|/opt/fornitori-app/backend/.venv|$VENV_DIR|g" \
    -e "s|/opt/fornitori-app|$APP_DIR|g" \
    -e "s|^User=fornitori|User=$APP_USER|" \
    -e "s|^Group=fornitori|Group=$APP_GROUP|" \
    "$APP_DIR/deploy/fornitori-api.service" > /etc/systemd/system/fornitori-api.service
chmod 644 /etc/systemd/system/fornitori-api.service
systemctl daemon-reload
systemctl enable fornitori-api
free_api_port

if [[ -f "$APP_DIR/deploy/backup-atlas.sh" ]]; then
    log "Backup completo applicazione prima del restart API"
    APP_DIR="$APP_DIR" BACKUP_DIR="$APP_DIR/backups" bash "$APP_DIR/deploy/backup-atlas.sh" || {
        log "Backup completo fallito — deploy continua (git pull e restart non cancellano i dati)"
    }
elif [[ -f "$APP_DIR/deploy/backup-db.sh" ]] && systemctl is-active --quiet postgresql 2>/dev/null; then
    log "Backup automatico database prima del restart API (i dati restano intatti)"
    BACKUP_DIR="$APP_DIR/backups" DB_NAME="${DB_NAME:-fornitori_db}" bash "$APP_DIR/deploy/backup-db.sh" || {
        log "Backup fallito — deploy continua (git pull e restart non cancellano il DB)"
    }
fi

if systemctl is-active --quiet fornitori-api; then
    log "Restart fornitori-api"
    systemctl restart fornitori-api
else
    log "Avvio fornitori-api (potrebbe fallire se .env non configurato)"
    systemctl start fornitori-api || true
fi

sleep 2
log "Stato del servizio"
systemctl --no-pager --full status fornitori-api | head -20 || true

if ! systemctl is-active --quiet fornitori-api; then
    echo
    log "Ultimi log fornitori-api (diagnostica)"
    journalctl -u fornitori-api -n 40 --no-pager || true
fi

echo
echo "================================================================"
echo "  Log live:   journalctl -u fornitori-api -f"
echo "  Health:     curl -sf https://www.atlass.it/api/health"
echo "  Restart:    systemctl restart fornitori-api"
echo "================================================================"
