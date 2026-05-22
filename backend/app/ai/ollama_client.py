"""Client Ollama locale (sostituto gratuito di Gemini)."""

import logging
import os
from typing import Any, Dict, Optional

import requests

from .json_utils import parse_json_response

logger = logging.getLogger(__name__)

DEFAULT_GENERATE_URL = "http://localhost:11434/api/generate"
DEFAULT_MODEL = "llama3.2:3b"


def is_configured() -> bool:
    """Ollama attivo se AI_PROVIDER non è 'gemini' e non disabilitato esplicitamente."""
    provider = os.getenv("AI_PROVIDER", "ollama").strip().lower()
    if provider == "gemini":
        return False
    if provider in ("off", "none", "heuristics"):
        return False
    if os.getenv("OLLAMA_DISABLED", "").strip().lower() in ("1", "true", "yes"):
        return False
    return True


def staff_timeout_sec() -> float:
    return float(os.getenv("OLLAMA_STAFF_TIMEOUT_SEC", "45"))


def default_timeout_sec() -> float:
    return float(os.getenv("OLLAMA_TIMEOUT_SEC", "90"))


def ask_ollama(prompt: str, *, timeout_sec: float | None = None) -> str:
    """Chiamata singola a Ollama /api/generate."""
    url = os.getenv("OLLAMA_URL", DEFAULT_GENERATE_URL).strip() or DEFAULT_GENERATE_URL
    model = os.getenv("OLLAMA_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL
    timeout = timeout_sec if timeout_sec is not None else default_timeout_sec()
    num_predict = int(os.getenv("OLLAMA_NUM_PREDICT", "384"))

    response = requests.post(
        url,
        json={
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "num_predict": num_predict,
                "temperature": 0.1,
            },
        },
        timeout=timeout,
    )
    response.raise_for_status()
    data = response.json()
    return str(data.get("response") or "").strip()


def generate_json(
    system_instruction: str,
    user_text: str,
    *,
    timeout_sec: float | None = None,
) -> Optional[Dict[str, Any]]:
    """Come Gemini: system + user → JSON parsato."""
    if not is_configured():
        return None
    prompt = (
        f"{system_instruction.strip()}\n\n{user_text.strip()}\n\n"
        "Rispondi SOLO con un oggetto JSON valido, senza testo prima o dopo."
    )
    try:
        raw = ask_ollama(prompt, timeout_sec=timeout_sec)
        return parse_json_response(raw)
    except requests.RequestException as exc:
        logger.warning("Ollama non raggiungibile: %s", exc)
        return None
    except Exception as exc:
        logger.warning("Ollama generate_json failed: %s", exc)
        return None


def parse_command(user_input: str) -> Optional[Dict[str, Any]]:
    """Compatibilità con bozza Atlas AI → JSON."""
    prompt = f"""
Sei Atlas AI.

Converti il comando utente in JSON.

Rispondi SOLO JSON.

Comando:
{user_input}
"""
    return generate_json("", prompt)
