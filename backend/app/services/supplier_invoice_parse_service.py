from __future__ import annotations

import io
import re
from typing import Any, Dict, List, Tuple

from fastapi import HTTPException, UploadFile

from ..integrations.sdi.xml_parser import (
    extract_supplier_from_fatturapa,
    supplier_text_from_fields,
)
from . import ai_heuristics

MAX_INVOICE_UPLOAD_BYTES = 15 * 1024 * 1024


def _extract_pdf_text(content: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError as e:
        raise HTTPException(
            status_code=500,
            detail="Lettura PDF non disponibile sul server (pypdf mancante).",
        ) from e

    try:
        reader = PdfReader(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(status_code=400, detail="PDF non leggibile") from e

    chunks: List[str] = []
    for page in reader.pages:
        try:
            text = page.extract_text() or ""
        except Exception:
            text = ""
        if text.strip():
            chunks.append(text.strip())
    text = "\n".join(chunks).strip()
    if not text:
        raise HTTPException(
            status_code=400,
            detail="PDF senza testo estraibile. Prova il file XML FatturaPA oppure un PDF non scansionato.",
        )
    return text


def _decode_upload_text(content: bytes) -> str:
    for enc in ("utf-8", "utf-8-sig", "latin-1"):
        try:
            return content.decode(enc)
        except UnicodeDecodeError:
            continue
    return content.decode("utf-8", errors="replace")


def _find_xml_in_bytes(content: bytes) -> str | None:
    text = _decode_upload_text(content)
    if "<FatturaElettronica" in text:
        return text
    m = re.search(rb"<\?xml[\s\S]*<FatturaElettronica[\s\S]*</[\w:]*FatturaElettronica>", content)
    if m:
        return m.group(0).decode("utf-8", errors="replace")
    return None


def _merge_supplier_fields(structured: Dict[str, Any], text: str) -> Tuple[Dict[str, Any], List[str], List[str]]:
    invoice_meta = {
        k: structured.pop(k)
        for k in ("invoice_number", "invoice_date")
        if k in structured
    }
    heur = ai_heuristics.suggest_supplier_fields(text, structured)
    fields = dict(heur.get("suggested_fields") or {})
    for key, value in structured.items():
        if value is not None and str(value).strip():
            fields[key] = value
    fields = ai_heuristics._sanitize_supplier_suggested_fields(fields, text)
    if invoice_meta.get("invoice_number") and not fields.get("notes"):
        note = f"Da fattura n. {invoice_meta['invoice_number']}"
        if invoice_meta.get("invoice_date"):
            note += f" del {invoice_meta['invoice_date']}"
        fields["notes"] = note
    merged = {**structured, **fields}
    missing = [
        k
        for k in ["name", "vat_number", "iban", "email", "payment_terms"]
        if not str(merged.get(k) or "").strip()
    ]
    warnings = list(heur.get("warnings") or [])
    return fields, missing, warnings


async def parse_supplier_invoice_upload(file: UploadFile) -> Dict[str, Any]:
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="Nessun file selezionato")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="File vuoto")
    if len(content) > MAX_INVOICE_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail="File troppo grande (max 15 MB)")

    filename = (file.filename or "").lower()
    file_type = "unknown"
    source_text = ""
    structured: Dict[str, Any] = {}

    xml_text = None
    if filename.endswith((".xml", ".p7m")) or b"<FatturaElettronica" in content[:12000]:
        xml_text = _find_xml_in_bytes(content)
    if xml_text:
        try:
            structured = extract_supplier_from_fatturapa(xml_text)
            source_text = supplier_text_from_fields(structured)
            file_type = "xml"
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e)) from e
    elif filename.endswith(".pdf") or content[:4] == b"%PDF":
        source_text = _extract_pdf_text(content)
        file_type = "pdf"
    else:
        raise HTTPException(
            status_code=400,
            detail="Formato non supportato. Carica un file XML FatturaPA o un PDF fattura.",
        )

    invoice_number = structured.get("invoice_number")
    invoice_date = structured.get("invoice_date")
    fields, missing, warnings = _merge_supplier_fields(dict(structured), source_text)
    if not fields.get("name"):
        raise HTTPException(
            status_code=400,
            detail="Impossibile leggere il fornitore dalla fattura. Verifica il file o compila i campi manualmente.",
        )

    return {
        "suggested_fields": fields,
        "missing_fields": missing,
        "warnings": warnings,
        "source_text": source_text,
        "file_type": file_type,
        "invoice_number": invoice_number,
        "invoice_date": invoice_date,
        "confidence": 0.95 if file_type == "xml" else 0.8,
    }
