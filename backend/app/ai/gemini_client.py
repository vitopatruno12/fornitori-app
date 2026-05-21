import json
import logging
import os
import re
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

_model = None


def is_configured() -> bool:
    return bool(os.getenv("GEMINI_API_KEY", "").strip())


def _get_model():
    global _model
    if not is_configured():
        return None
    if _model is None:
        import google.generativeai as genai

        genai.configure(api_key=os.getenv("GEMINI_API_KEY", "").strip())
        model_name = os.getenv("GEMINI_MODEL", "gemini-2.0-flash").strip()
        _model = genai.GenerativeModel(model_name)
    return _model


def _parse_json_response(raw: str) -> Optional[Dict[str, Any]]:
    text = (raw or "").strip()
    if not text:
        return None
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
    text = re.sub(r"\s*```\s*$", "", text)
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else None
    except json.JSONDecodeError:
        logger.warning("Gemini: risposta non JSON valida")
        return None


def generate_json(system_instruction: str, user_text: str) -> Optional[Dict[str, Any]]:
    """Chiamata Gemini con risposta JSON; None se non configurato o errore."""
    model = _get_model()
    if not model:
        return None
    try:
        resp = model.generate_content(
            [
                {"role": "user", "parts": [{"text": f"{system_instruction}\n\n{user_text}"}]},
            ],
            generation_config={
                "response_mime_type": "application/json",
                "temperature": 0.15,
            },
        )
        return _parse_json_response(resp.text or "")
    except Exception as exc:
        logger.warning("Gemini generate_json failed: %s", exc)
        return None
