"""
Estrazione campi da XML FatturaPA (namespace-agnostic)
per destinazione e codice destinatario SDI.
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


def _receiver_vat_from_root(root: ET.Element) -> str:
    codice = root.findtext(
        ".//{*}CessionarioCommittente/{*}DatiAnagrafici/{*}IdFiscaleIVA/{*}IdCodice"
    )
    vat = str(codice).strip() if codice and str(codice).strip() else ""
    if not vat:
        cf = root.findtext(".//{*}CessionarioCommittente/{*}DatiAnagrafici/{*}CodiceFiscale")
        vat = (cf or "").strip()
    if vat and not vat.upper().startswith("IT") and len(vat) == 11 and vat.isdigit():
        vat = f"IT{vat}"
    return vat


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


def _text_or_empty(node: Optional[str]) -> str:
    return str(node).strip() if node and str(node).strip() else ""


def _payment_terms_from_root(root: ET.Element) -> str:
    cond = _text_or_empty(root.findtext(".//{*}DatiPagamento/{*}CondizioniPagamento"))
    modalita = _text_or_empty(root.findtext(".//{*}DatiPagamento/{*}DettaglioPagamento/{*}ModalitaPagamento"))
    scadenza = _text_or_empty(root.findtext(".//{*}DatiPagamento/{*}DettaglioPagamento/{*}DataScadenzaPagamento"))
    cond_map = {
        "TP01": "Pagamento a vista",
        "TP02": "Pagamento completo a data fissata",
        "TP03": "Anticipo + saldo",
    }
    mod_map = {
        "MP01": "Contanti",
        "MP05": "Bonifico",
        "MP08": "Carta di pagamento",
        "MP12": "RIBA",
        "MP19": "SEPA Direct Debit",
    }
    parts = []
    if cond in cond_map:
        parts.append(cond_map[cond])
    if modalita in mod_map:
        parts.append(mod_map[modalita])
    if scadenza:
        parts.append(f"scadenza {scadenza[:10]}")
    return " · ".join(parts)


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
    receiver_vat = _receiver_vat_from_root(root)
    vat, supplier_name = _supplier_from_root(root)
    inv_num, inv_date = _invoice_meta_from_root(root)

    return {
        "destination": _destination_from_root(root),
        "receiver_code": receiver_code,
        "receiver_vat": receiver_vat,
        "supplier_vat": vat,
        "supplier_name": supplier_name,
        "invoice_number": inv_num,
        "invoice_date": inv_date,
    }


def extract_supplier_from_fatturapa(xml_text: str) -> Dict[str, Any]:
    """
    Estrae i campi anagrafici del cedente/prestatore da XML FatturaPA.
    """
    parsed = parse_fatturapa(xml_text)
    try:
        root = ET.fromstring(xml_text)
    except Exception as e:
        raise ValueError("XML non parsabile") from e

    vat_code = _text_or_empty(root.findtext(".//{*}CedentePrestatore/{*}DatiAnagrafici/{*}IdFiscaleIVA/{*}IdCodice"))
    fiscal_code = _text_or_empty(root.findtext(".//{*}CedentePrestatore/{*}DatiAnagrafici/{*}CodiceFiscale"))
    email = _text_or_empty(root.findtext(".//{*}CedentePrestatore/{*}Contatti/{*}Email"))
    phone = _text_or_empty(root.findtext(".//{*}CedentePrestatore/{*}Contatti/{*}Telefono"))
    indirizzo = _text_or_empty(root.findtext(".//{*}CedentePrestatore/{*}Sede/{*}Indirizzo"))
    numero = _text_or_empty(root.findtext(".//{*}CedentePrestatore/{*}Sede/{*}NumeroCivico"))
    comune = _text_or_empty(root.findtext(".//{*}CedentePrestatore/{*}Sede/{*}Comune"))
    provincia = _text_or_empty(root.findtext(".//{*}CedentePrestatore/{*}Sede/{*}Provincia"))
    cap = _text_or_empty(root.findtext(".//{*}CedentePrestatore/{*}Sede/{*}CAP"))
    nazione = _text_or_empty(root.findtext(".//{*}CedentePrestatore/{*}Sede/{*}Nazione"))
    iban = _text_or_empty(root.findtext(".//{*}DatiPagamento/{*}DettaglioPagamento/{*}IBAN")).upper()

    address_parts = [p for p in [indirizzo, numero, cap, comune, provincia, nazione] if p]
    address = ", ".join(address_parts)

    vat_number = vat_code
    if vat_number and not vat_number.upper().startswith("IT") and len(vat_number) == 11 and vat_number.isdigit():
        vat_number = f"IT{vat_number}"

    name = parsed.get("supplier_name") or ""
    payment_terms = _payment_terms_from_root(root)

    notes_parts = []
    if parsed.get("invoice_number"):
        inv_date = parsed.get("invoice_date")
        date_str = inv_date.isoformat() if hasattr(inv_date, "isoformat") else str(inv_date or "")
        notes_parts.append(f"Da fattura n. {parsed['invoice_number']}" + (f" del {date_str}" if date_str else ""))
    if address:
        notes_parts.append(f"Indirizzo: {address}")

    out: Dict[str, Any] = {
        "name": name,
        "vat_number": vat_number or None,
        "fiscal_code": fiscal_code or None,
        "email": email or None,
        "phone": phone or None,
        "city": comune or None,
        "country": nazione or None,
        "address": address or None,
        "iban": iban or None,
        "payment_terms": payment_terms or None,
        "notes": " · ".join(notes_parts) if notes_parts else None,
    }
    if fiscal_code and vat_number and fiscal_code == vat_number:
        out["fiscal_code"] = fiscal_code if len(fiscal_code) == 16 else None

    return {
        **{k: v for k, v in out.items() if v},
        "invoice_number": parsed.get("invoice_number") or "",
        "invoice_date": parsed.get("invoice_date").isoformat() if parsed.get("invoice_date") else None,
    }


def supplier_text_from_fields(fields: Dict[str, Any]) -> str:
    """Testo lineare per euristiche AI / compilazione vocale."""
    lines = []
    mapping = [
        ("name", "Ragione sociale"),
        ("vat_number", "Partita IVA"),
        ("fiscal_code", "Codice fiscale"),
        ("email", "Email"),
        ("phone", "Telefono"),
        ("city", "Città"),
        ("address", "Indirizzo"),
        ("iban", "IBAN"),
        ("payment_terms", "Pagamento"),
        ("notes", "Note"),
    ]
    for key, label in mapping:
        val = fields.get(key)
        if val:
            lines.append(f"{label}: {val}")
    inv_no = fields.get("invoice_number")
    inv_dt = fields.get("invoice_date")
    if inv_no:
        lines.append(f"Fattura n. {inv_no}" + (f" del {inv_dt}" if inv_dt else ""))
    return "\n".join(lines)
