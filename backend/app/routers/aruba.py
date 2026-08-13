"""
DEPRECATED — client intermediario Aruba disabilitato.

Il modulo Fatture usa il canale SDI / Agenzia Entrate (`app.routers.sdi`).
Questo modulo non è montato in main.py.
"""

raise ImportError(
  "Il router Aruba è stato disabilitato. Usa app.routers.sdi (Agenzia Entrate / SDI)."
)
