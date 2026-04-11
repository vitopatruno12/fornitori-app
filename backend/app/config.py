import os
from pathlib import Path

from dotenv import load_dotenv

# Carica backend/.env anche se la working directory non è la cartella backend.
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
_ENV_FILE = _BACKEND_ROOT / ".env"
# override=False: su Render (e simili) le variabili del dashboard non vengono
# sovrascritte da un .env di sviluppo con localhost.
load_dotenv(_ENV_FILE, override=False)

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/fornitori_db",
)
