"""Modulo AI (equivalente Nest: module / service / controller) con Gemini."""

from .module import register_ai_module
from .controller import router

__all__ = ["register_ai_module", "router"]
