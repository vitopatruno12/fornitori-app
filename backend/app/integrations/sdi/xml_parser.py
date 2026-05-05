"""
Estrazione campi da XML FatturaPA (namespace-agnostic).
Allineato ai path usati in app/routers/aruba.py per destinazione e codice destinatario.
"""
from __future__ import annotations

import re
import xml.etree.ElementTree as ET
from datetime import date, datetime
from typing import Any, Dict, Optional, Tuple


def _parse_iso_date(raw: Optional[str]) -> Optional[date]:
    if not raw or not str(raw).strip():
        return None
    s = str(raw).strip()
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        try:
            return date.fromisoformat(s[:10])
        except ValueError:
            return None
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        try:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            return None
    for fmt in ("%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(s[:10], fmt).date()
        except ValueError:
            continue
    return None


def _destination_from_root(root: ET.Element) -> str:
    indirizzo = root.findtext(".//{*}CessionarioCommittente/{*}Sede/{*}Indirizzo") or ""
    numero = root.findtext(".//{*}CessionarioCommittente/{*}Sede/{*}NumeroCivico") or ""
    comune = root.findtext(".//{*}CessionarioCommittente/{*}Sede/{*}Comune") or ""
    provincia = root.findtext(".//{*}CessionarioCommittente/{*}Sede/{*}Provincia") or ""
    cap = root.findtext(".//{*}CessionarioCommittente/{*}Sede/{*}CAP") or ""
    parts = [p.strip() for p in [indirizzo, numero, cap, comune, provincia] if p and p.strip()]
    return ", ".join(parts)


def _supplier_from_root(root: ET.Element) -> Tuple[str, str]:
    codice = root.findtext(".//{*}CedentePrestatore/{*}DatiAnagrafici/{*}IdFiscaleIVA/{*}IdCodice")
    vat = str(codice).strip() if codice and str(codice).strip() else ""
    if not vat:
        cf = root.findtext(".//{*}CedentePrestatore/{*}DatiAnagrafici/{*}CodiceFiscale")
        vat = (cf or "").strip()
    denom = root.findtext(".//{*}CedentePrestatore/{*}DatiAnagrafici/{*}Anagrafica/{*}Denominazione")
    name = str(denom).strip() if denom and str(denom).strip() else ""
    if not name:
        nome = root.findtext(".//{*}CedentePrestatore/{*}DatiAnagrafici/{*}Anagrafica/{*}Nome") or ""
        cognome = root.findtext(".//{*}CedentePrestatore/{*}DatiAnagrafici/{*}Anagrafica/{*}Cognome") or ""
        parts = [p.strip() for p in (nome, cognome) if p and p.strip()]
        name = " ".join(parts)
    return vat, name


def _invoice_meta_from_root(root: ET.Element) -> Tuple[str, Optional[date]]:
    numero = root.findtext(".//{*}FatturaElettronicaBody/{*}DatiGenerali/{*}DatiGeneraliDocumento/{*}Numero")
    data_raw = root.findtext(".//{*}FatturaElettronicaBody/{*}DatiGenerali/{*}DatiGeneraliDocumento/{*}Data")
    inv_num = (numero or "").strip()
    inv_date = _parse_iso_date(data_raw)
    return inv_num, inv_date


def parse_fatturapa(xml_text: str) -> Dict[str, Any]:
    """
    Restituisce campi normalizzati per DB/classificazione.
    Solleva ValueError se l'XML non è una FatturaPA riconoscibile.
    """
    if not xml_text or "<FatturaElettronica" not in xml_text:
        raise ValueError("XML non valido o non FatturaPA")
    try:
        root = ET.fromstring(xml_text)
    except Exception as e:
        raise ValueError("XML non parsabile") from e

    receiver_code = (root.findtext(".//{*}DatiTrasmissione/{*}CodiceDestinatario") or "").strip()
    vat, supplier_name = _supplier_from_root(root)
    inv_num, inv_date = _invoice_meta_from_root(root)

    return {
        "destination": _destination_from_root(root),
        "receiver_code": receiver_code,
        "supplier_vat": vat,
        "supplier_name": supplier_name,
        "invoice_number": inv_num,
        "invoice_date": inv_date,
    }
