"""Probe EasyRetail Firebird GDB for SCONTRINI-related field names."""
from __future__ import annotations

import re
import tempfile
from pathlib import Path

raw = Path(tempfile.gettempdir(), "easyretail_sample.gdb").read_bytes()

fields = re.findall(rb"SCONTRINI[\x00-\x20]+([A-Z][A-Z0-9_]{2,40})", raw)
print("fields near SCONTRINI", len(fields))
for f in sorted({x.decode() for x in fields}):
    print(" ", f)

print("--- term counts ---")
for term in [
    b"DATAORA",
    b"DATAMOVIMENTO",
    b"ORAMOVIMENTO",
    b"TOTALEVENDITA",
    b"TOTALENETTO",
    b"TOTALEIVATO",
    b"NUMEROTICKET",
    b"NUMEROSCONTRINO",
    b"CODICECASSA",
    b"CODICEPOSTAZIONE",
    b"CODICEPOS",
    b"ANNULLATO",
    b"FLAGANNULLATO",
    b"LOGICDELETE",
    b"IMPORTO",
    b"TOTALE",
]:
    print(term.decode(), raw.count(term))

i = raw.find(b"NUMEROSCONTRINO")
print("--- NUMEROSCONTRINO context ---")
print(raw[max(0, i - 120) : i + 240])
