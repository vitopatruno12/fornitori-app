# Deploy del backend `fornitori-app` su server Ubuntu

Runbook per il deploy in produzione su un VPS Linux Ubuntu (22.04 o 24.04 LTS).

## Architettura risultante

```
Browser
  │  HTTPS
  ▼
Vercel (frontend statico)
  │  fetch API
  ▼  HTTPS
Tuo VPS Ubuntu
  ├── Caddy   (porta 80/443, HTTPS Let's Encrypt automatico)
  │     │
  │     ▼  reverse proxy localhost
  ├── uvicorn (porta 8000, gestito da systemd unit fornitori-api)
  │
  └── PostgreSQL 16 (porta 5432, solo localhost)
```

## Prerequisiti

1. Server Ubuntu 22.04 o 24.04 LTS con accesso `sudo` (idealmente accesso root via SSH).
2. Un dominio puntato all'IP del server con un record A. Esempio: `api.tuosito.it -> 1.2.3.4`. Il certificato HTTPS viene rilasciato sul nome di dominio: senza dominio, niente HTTPS pulito.
3. Backup recente del database in formato `pg_dump -F p` (file `.sql`), trasferito sul server in una posizione qualsiasi (es. `/root/backup_fornitori.sql`).

## File in questa cartella

| File | Cosa fa |
|---|---|
| `install-server.sh` | Bootstrap del server: installa OS deps, Postgres 16, Caddy, crea utente di sistema e database. Da eseguire UNA volta sola. |
| `deploy-app.sh` | Clona/aggiorna il repo, crea venv Python, installa requirements, installa systemd unit. Idempotente, lo lanci a ogni release. |
| `fornitori-api.service` | Systemd unit per uvicorn. Copiato automaticamente da `deploy-app.sh`. |
| `Caddyfile` | Reverse proxy + HTTPS. DA EDITARE col tuo dominio. |
| `env.production.example` | Template `.env` produzione. Copialo in `backend/.env` ed edita. |
| `restore-db.sh` | Importa un dump SQL nel database. |
| `backup-db.sh` | Dump giornaliero compresso + rotazione. Da agganciare a cron. |

## Primo deploy da zero

### Step 1 — Connessione e bootstrap

```bash
# Dal tuo PC
ssh root@TUO_IP_SERVER

# Una volta dentro:
apt-get update && apt-get install -y git
git clone https://github.com/vitopatruno12/fornitori-app.git /tmp/fornitori-clone
bash /tmp/fornitori-clone/deploy/install-server.sh
```

Lo script installa tutto e ti stampa alla fine le credenziali del DB.
Annotale (sono anche in `/root/fornitori_db_credentials.txt`).

### Step 2 — Deploy del codice

```bash
bash /tmp/fornitori-clone/deploy/deploy-app.sh
```

Lo script clona il repo in `/opt/fornitori-app`, crea il venv Python e installa systemd unit.
Crea anche `backend/.env` da template.

### Step 3 — Configura `.env`

```bash
cat /root/fornitori_db_credentials.txt   # copia il valore di DATABASE_URL
nano /opt/fornitori-app/backend/.env
```

Devi compilare almeno:
- `DATABASE_URL` (incolla dal file delle credenziali)
- `CORS_ORIGINS` (URL del tuo frontend Vercel)

Salva, poi:

```bash
systemctl restart fornitori-api
curl -sf https://www.atlass.it/api/health

### Frontend Vercel / Netlify (Mixed Content)

Imposta **solo**:

- `VITE_API_BASE_URL` = `/api` (consigliato, stesso dominio HTTPS)
- oppure `https://www.atlass.it/api` (mai `http://`)

**Non** usare `http://www.atlass.it` né `https://www.atlass.it` senza `/api`: le chiamate finirebbero su `/suppliers` (pagina SPA) e il browser blocca HTTP da HTTPS.

Dopo aver corretto le variabili: **Redeploy** con cache pulita.
# atteso: {"status":"ok"}
```

### Step 4 — Importa il backup DB

Trasferisci il file dal tuo PC (PowerShell):

```powershell
scp E:\backup_fornitori.sql root@TUO_IP_SERVER:/root/backup_fornitori.sql
```

Sul server:

```bash
bash /opt/fornitori-app/deploy/restore-db.sh /root/backup_fornitori.sql
systemctl restart fornitori-api
```

### Step 5 — Configura Caddy con il tuo dominio

```bash
cp /opt/fornitori-app/deploy/Caddyfile /etc/caddy/Caddyfile
nano /etc/caddy/Caddyfile   # sostituisci api.tuosito.it col TUO dominio
systemctl reload caddy
journalctl -u caddy -n 30 --no-pager
```

Caddy contatta Let's Encrypt e prende il certificato (10-30 secondi). Poi prova:

```bash
curl https://api.tuosito.it/health
# atteso: {"status":"ok"}
```

### Step 6 — Aggancia il frontend Vercel

Su Vercel, **Settings → Environment Variables** del progetto frontend:

- `VITE_API_BASE_URL=https://api.tuosito.it`

Poi **Deployments → Redeploy** dell'ultimo deploy production.

Apri il frontend nel browser: la dashboard deve caricare i dati. Fatto.

### Step 7 — Backup automatico giornaliero

```bash
install -m 755 /opt/fornitori-app/deploy/backup-db.sh /usr/local/sbin/fornitori-backup
echo "30 3 * * * root /usr/local/sbin/fornitori-backup >> /var/log/fornitori-backup.log 2>&1" \
    > /etc/cron.d/fornitori-backup
chmod 644 /etc/cron.d/fornitori-backup
systemctl restart cron
```

Ogni notte alle 03:30 viene creato un dump compresso in `/opt/fornitori-app/backups`.
Vengono mantenuti gli ultimi 14 dump.

> Consigliato: copia periodicamente i backup OFFSITE (S3, Backblaze, rsync su altro server, NAS in ufficio).

## Operazioni quotidiane

### Vedere i log del backend in tempo reale

```bash
journalctl -u fornitori-api -f
```

### Restart manuale

```bash
systemctl restart fornitori-api
```

### Aggiornare l'app dopo un push su `main`

```bash
sudo bash /opt/fornitori-app/deploy/deploy-app.sh
```

Lo script fa `git pull`, aggiorna le dipendenze e riavvia il servizio.

### Stato del servizio

```bash
systemctl status fornitori-api
systemctl status caddy
systemctl status postgresql
```

### Test rapido API

```bash
curl https://api.tuosito.it/health
curl https://api.tuosito.it/dashboard/summary | head -c 200
```

## Ripristino da disastro

Server compromesso o reinstallato? Procedura:

1. Reinstalla Ubuntu pulito.
2. `bash install-server.sh` → riprende le credenziali nuove.
3. `bash deploy-app.sh` → ricarica il codice dal repo.
4. Trasferisci l'ultimo dump (dal NAS / S3 / dove lo tieni offsite).
5. `bash restore-db.sh /percorso/ultimo_backup.sql`
6. Edita `Caddyfile` col dominio, ricarica Caddy.

Tempo totale: ~15 minuti dato che tutto è scriptato.

## Sicurezza minima

Il bootstrap già fa:
- Firewall UFW: solo 22, 80, 443 esposte.
- Postgres in ascolto SOLO su localhost (non raggiungibile da internet).
- File `.env` con permessi 600 (solo proprietario).
- Servizio backend in unit systemd con hardening (NoNewPrivileges, ProtectSystem, ecc.).
- Backup giornaliero locale.

Ulteriori passi consigliati (manuali, opzionali):
- Disabilita login `root` via SSH, usa utente sudoer + chiave SSH.
- Installa `fail2ban` (già installato dallo script) e abilitalo per SSH.
- Crea snapshot periodici del VPS lato fornitore (Hetzner/Aruba/OVH).
- Monitoraggio uptime esterno: UptimeRobot/Better Uptime (free).

## Alternativa: nginx invece di Caddy

Se preferisci nginx + certbot:

```bash
apt-get install -y nginx certbot python3-certbot-nginx
# Config in /etc/nginx/sites-available/fornitori (esempio nel file Caddyfile, vedi commenti)
ln -s /etc/nginx/sites-available/fornitori /etc/nginx/sites-enabled/fornitori
nginx -t && systemctl reload nginx
certbot --nginx -d api.tuosito.it
```

Il resto resta uguale (systemd unit, env, ecc.).
