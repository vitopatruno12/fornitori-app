import logging
import os
from typing import Any, Dict, Optional

from .json_utils import parse_json_response

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
        return parse_json_response(resp.text or "")
    except Exception as exc:
        logger.warning("Gemini generate_json failed: %s", exc)
        return None
