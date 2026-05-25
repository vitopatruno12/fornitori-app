"""Client Ollama locale (chat API + JSON mode per estrazione strutturata)."""

import logging
import os
from typing import Any, Dict, Optional

import requests

from .json_utils import parse_json_response

logger = logging.getLogger(__name__)

DEFAULT_GENERATE_URL = "http://localhost:11434/api/generate"
DEFAULT_CHAT_URL = "http://localhost:11434/api/chat"
DEFAULT_MODEL = "qwen2.5:7b"


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


def _use_chat_api() -> bool:
    return os.getenv("OLLAMA_USE_CHAT", "1").strip().lower() not in ("0", "false", "no")


def _json_format_enabled() -> bool:
    return os.getenv("OLLAMA_JSON_FORMAT", "1").strip().lower() not in ("0", "false", "no")


def _model_name() -> str:
    return os.getenv("OLLAMA_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL


def _generate_url() -> str:
    return os.getenv("OLLAMA_URL", DEFAULT_GENERATE_URL).strip() or DEFAULT_GENERATE_URL


def _chat_url() -> str:
    explicit = os.getenv("OLLAMA_CHAT_URL", "").strip()
    if explicit:
        return explicit
    gen = _generate_url()
    if "/api/generate" in gen:
        return gen.replace("/api/generate", "/api/chat")
    if gen.endswith("/api/chat"):
        return gen
    base = gen.rstrip("/").rsplit("/api/", 1)[0]
    return f"{base}/api/chat"


def staff_timeout_sec() -> float:
    return float(os.getenv("OLLAMA_STAFF_TIMEOUT_SEC", "45"))


def order_timeout_sec() -> float:
    return float(os.getenv("OLLAMA_ORDER_TIMEOUT_SEC", "45"))


def order_num_predict() -> int:
    return int(os.getenv("OLLAMA_ORDER_NUM_PREDICT", "512"))


def supplier_num_predict() -> int:
    return int(os.getenv("OLLAMA_SUPPLIER_NUM_PREDICT", "220"))


def supplier_timeout_sec() -> float:
    return float(os.getenv("OLLAMA_SUPPLIER_TIMEOUT_SEC", "6"))


def default_timeout_sec() -> float:
    return float(os.getenv("OLLAMA_TIMEOUT_SEC", "90"))


def default_num_predict() -> int:
    return int(os.getenv("OLLAMA_NUM_PREDICT", "384"))


def _ollama_options(num_predict: int) -> Dict[str, Any]:
    temp = float(os.getenv("OLLAMA_TEMPERATURE", "0.05"))
    return {
        "num_predict": num_predict,
        "temperature": temp,
        "top_p": float(os.getenv("OLLAMA_TOP_P", "0.9")),
    }


def _post_ollama(url: str, body: Dict[str, Any], timeout: float) -> Dict[str, Any]:
    response = requests.post(url, json=body, timeout=timeout)
    response.raise_for_status()
    return response.json()


def ask_ollama_chat(
    system_instruction: str,
    user_text: str,
    *,
    timeout_sec: float | None = None,
    num_predict: int | None = None,
) -> str:
    """API /api/chat: system + user (migliore per seguire le sezioni del form)."""
    timeout = timeout_sec if timeout_sec is not None else default_timeout_sec()
    np = num_predict if num_predict is not None else default_num_predict()
    body: Dict[str, Any] = {
        "model": _model_name(),
        "messages": [
            {"role": "system", "content": (system_instruction or "").strip()},
            {"role": "user", "content": (user_text or "").strip()},
        ],
        "stream": False,
        "options": _ollama_options(np),
    }
    if _json_format_enabled():
        body["format"] = "json"
    data = _post_ollama(_chat_url(), body, timeout)
    msg = data.get("message") or {}
    return str(msg.get("content") or "").strip()


def ask_ollama(
    prompt: str,
    *,
    timeout_sec: float | None = None,
    num_predict: int | None = None,
) -> str:
    """API /api/generate (fallback)."""
    timeout = timeout_sec if timeout_sec is not None else default_timeout_sec()
    np = num_predict if num_predict is not None else default_num_predict()
    body: Dict[str, Any] = {
        "model": _model_name(),
        "prompt": prompt,
        "stream": False,
        "options": _ollama_options(np),
    }
    if _json_format_enabled():
        body["format"] = "json"
    data = _post_ollama(_generate_url(), body, timeout)
    return str(data.get("response") or "").strip()


def generate_json(
    system_instruction: str,
    user_text: str,
    *,
    timeout_sec: float | None = None,
    num_predict: int | None = None,
) -> Optional[Dict[str, Any]]:
    """System + user → JSON; chat API e format=json se supportati dal modello."""
    if not is_configured():
        return None
    user_tail = (
        f"{user_text.strip()}\n\n"
        "Rispondi SOLO con un oggetto JSON valido. "
        "Ogni dato nella sezione/campo corretto. Nessun testo fuori dal JSON."
    )
    try:
        if _use_chat_api():
            raw = ask_ollama_chat(
                system_instruction,
                user_tail,
                timeout_sec=timeout_sec,
                num_predict=num_predict,
            )
        else:
            prompt = f"{system_instruction.strip()}\n\n{user_tail}"
            raw = ask_ollama(prompt, timeout_sec=timeout_sec, num_predict=num_predict)
        data = parse_json_response(raw)
        if data:
            return data
        logger.warning("Ollama: JSON non parsato, primi 200 char: %s", (raw or "")[:200])
        return None
    except requests.RequestException as exc:
        logger.warning("Ollama non raggiungibile: %s", exc)
        return None
    except Exception as exc:
        logger.warning("Ollama generate_json failed: %s", exc)
        return None


def parse_command(user_input: str) -> Optional[Dict[str, Any]]:
    """Compatibilità con bozza Atlas AI → JSON."""
    return generate_json(
        "Converti il comando utente in JSON operativo per gestionale ATLAS.",
        f"Comando:\n{user_input}",
    )
