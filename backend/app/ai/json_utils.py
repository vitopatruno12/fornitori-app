"""Parsing risposte JSON dall'LLM (Ollama / Gemini)."""

import json
import logging
import re
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


def extract_json_object_text(raw: str) -> Optional[str]:
    """Estrae il primo oggetto JSON {...} da testo con spiegazioni attorno."""
    text = (raw or "").strip()
    start = text.find("{")
    if start < 0:
        return None
    depth = 0
    in_str = False
    escape = False
    quote = ""
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if escape:
                escape = False
                continue
            if ch == "\\":
                escape = True
                continue
            if ch == quote:
                in_str = False
            continue
        if ch in ('"', "'"):
            in_str = True
            quote = ch
            continue
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start : i + 1]
    return None


def parse_json_response(raw: str) -> Optional[Dict[str, Any]]:
    text = (raw or "").strip()
    if not text:
        return None
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.I)
    text = re.sub(r"\s*```\s*$", "", text)
    for candidate in (text, extract_json_object_text(text)):
        if not candidate:
            continue
        try:
            data = json.loads(candidate)
            return data if isinstance(data, dict) else None
        except json.JSONDecodeError:
            continue
    logger.warning("AI: risposta non JSON valida")
    return None
