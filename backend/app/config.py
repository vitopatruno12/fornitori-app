import os
from pathlib import Path

from dotenv import load_dotenv
from pydantic import BaseModel

# Carica sempre backend/.env (anche se uvicorn parte da un'altra cartella)
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
_ENV_FILE = _BACKEND_ROOT / ".env"
load_dotenv(_ENV_FILE, override=True)


class Settings(BaseModel):
    database_url: str = os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/fornitori_db")


settings = Settings()