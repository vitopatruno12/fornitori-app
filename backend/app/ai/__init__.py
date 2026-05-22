"""Modulo AI (Ollama locale + euristiche; Gemini opzionale)."""

from .module import register_ai_module
from .controller import router

__all__ = ["register_ai_module", "router"]
