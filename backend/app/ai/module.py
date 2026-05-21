"""Registrazione modulo AI sull'app FastAPI (analogo a AiModule in Nest)."""

from fastapi import FastAPI

from .controller import router


def register_ai_module(app: FastAPI) -> None:
    app.include_router(router)
