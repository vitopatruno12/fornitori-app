#!/usr/bin/env bash
#
# aggiorna-tutto.sh — Un solo comando per installare TUTTI gli aggiornamenti in coda.
#
# Fa: git pull (tutti i commit), build frontend, migrazioni DB, restart API.
# Non serve ripetere pull/build per ogni feature pushata.
#
# Uso sul server:
#   cd /var/www/app-fornitori/fornitori-app
#   sudo bash deploy/aggiorna-tutto.sh
#
# Opzioni:
#   SKIP_BACKUP=1  — salta il backup pre-deploy (più veloce)
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"

export APP_DIR
export RESTART_API="${RESTART_API:-1}"
export BRANCH="${BRANCH:-main}"
export SKIP_BACKUP="${SKIP_BACKUP:-0}"

echo "================================================================"
echo "  ATLAS — pacchetto unico di aggiornamento"
echo "  Installa tutti i commit in coda su origin/$BRANCH"
echo "  APP_DIR=$APP_DIR  RESTART_API=$RESTART_API"
echo "================================================================"

exec bash "$SCRIPT_DIR/release-safe.sh"
