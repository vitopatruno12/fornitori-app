"""
Parser completo FatturaPA per import Atlas (namespace-agnostic).

Conserva i valori dell'XML (riga / riepilogo IVA / totale documento)
senza ricalcolare arbitrariamente gli importi.
"""
from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional

import xml.etree.ElementTree as ET

from .xml_parser import _parse_iso_date, _text_or_empty


def _dec(raw: Any) -> Optional[Decimal]:
  if raw is None:
    return None
  s = str(raw).strip().replace(",", ".")
  if not s:
    return None
  try:
    return Decimal(s)
  except (InvalidOperation, ValueError):
    return None


def _dec_or_zero(raw: Any) -> Decimal:
  return _dec(raw) or Decimal("0")


def _as_list(nodes: List[ET.Element]) -> List[ET.Element]:
  return list(nodes or [])


def _find_all(root: ET.Element, path: str) -> List[ET.Element]:
  return list(root.findall(path))


def parse_fatturapa_document(xml_text: str) -> Dict[str, Any]:
  """
  Estrae fornitore, cliente, documento, righe e riepilogo IVA.
  Solleva ValueError se l'XML non è FatturaPA.
  """
  if not xml_text or "<FatturaElettronica" not in xml_text:
    raise ValueError("XML non valido o non FatturaPA")
  try:
    root = ET.fromstring(xml_text)
  except Exception as e:
    raise ValueError("XML non parsabile") from e

  # Cedente / fornitore
  supplier_vat = _text_or_empty(
    root.findtext(".//{*}CedentePrestatore/{*}DatiAnagrafici/{*}IdFiscaleIVA/{*}IdCodice")
  )
  supplier_cf = _text_or_empty(
    root.findtext(".//{*}CedentePrestatore/{*}DatiAnagrafici/{*}CodiceFiscale")
  )
  supplier_name = _text_or_empty(
    root.findtext(".//{*}CedentePrestatore/{*}DatiAnagrafici/{*}Anagrafica/{*}Denominazione")
  )
  if not supplier_name:
    nome = _text_or_empty(root.findtext(".//{*}CedentePrestatore/{*}DatiAnagrafici/{*}Anagrafica/{*}Nome"))
    cognome = _text_or_empty(root.findtext(".//{*}CedentePrestatore/{*}DatiAnagrafici/{*}Anagrafica/{*}Cognome"))
    supplier_name = " ".join(p for p in (nome, cognome) if p)

  # Cessionario / cliente
  customer_vat = _text_or_empty(
    root.findtext(".//{*}CessionarioCommittente/{*}DatiAnagrafici/{*}IdFiscaleIVA/{*}IdCodice")
  )
  customer_name = _text_or_empty(
    root.findtext(".//{*}CessionarioCommittente/{*}DatiAnagrafici/{*}Anagrafica/{*}Denominazione")
  )

  # Documento
  doc_type = _text_or_empty(
    root.findtext(".//{*}FatturaElettronicaBody/{*}DatiGenerali/{*}DatiGeneraliDocumento/{*}TipoDocumento")
  )
  number = _text_or_empty(
    root.findtext(".//{*}FatturaElettronicaBody/{*}DatiGenerali/{*}DatiGeneraliDocumento/{*}Numero")
  )
  date_raw = root.findtext(".//{*}FatturaElettronicaBody/{*}DatiGenerali/{*}DatiGeneraliDocumento/{*}Data")
  invoice_date = _parse_iso_date(date_raw)
  currency = _text_or_empty(
    root.findtext(".//{*}FatturaElettronicaBody/{*}DatiGenerali/{*}DatiGeneraliDocumento/{*}Divisa")
  ) or "EUR"
  total = _dec(root.findtext(".//{*}FatturaElettronicaBody/{*}DatiGenerali/{*}DatiGeneraliDocumento/{*}ImportoTotaleDocumento"))

  # Righe (valori XML grezzi)
  lines: List[Dict[str, Any]] = []
  for node in _find_all(root, ".//{*}FatturaElettronicaBody/{*}DatiBeniServizi/{*}DettaglioLinee"):
    line_no = int(_text_or_empty(node.findtext("{*}NumeroLinea") or node.findtext(".//{*}NumeroLinea")) or "0")
    lines.append(
      {
        "lineNumber": line_no,
        "description": _text_or_empty(node.findtext("{*}Descrizione") or node.findtext(".//{*}Descrizione")),
        "quantity": _dec(node.findtext("{*}Quantita") or node.findtext(".//{*}Quantita")),
        "unitPrice": _dec(node.findtext("{*}PrezzoUnitario") or node.findtext(".//{*}PrezzoUnitario")),
        "lineTotal": _dec(node.findtext("{*}PrezzoTotale") or node.findtext(".//{*}PrezzoTotale")),
        "vatRate": _dec(node.findtext("{*}AliquotaIVA") or node.findtext(".//{*}AliquotaIVA")),
      }
    )
  lines.sort(key=lambda x: x["lineNumber"] or 0)

  # Riepilogo IVA (fonte di verità per imponibile/IVA)
  vat_summary: List[Dict[str, Any]] = []
  taxable_amount = Decimal("0")
  vat_amount = Decimal("0")
  for node in _find_all(root, ".//{*}FatturaElettronicaBody/{*}DatiBeniServizi/{*}DatiRiepilogo"):
    imponibile = _dec_or_zero(node.findtext("{*}ImponibileImporto") or node.findtext(".//{*}ImponibileImporto"))
    iva = _dec_or_zero(node.findtext("{*}Imposta") or node.findtext(".//{*}Imposta"))
    aliquota = _dec(node.findtext("{*}AliquotaIVA") or node.findtext(".//{*}AliquotaIVA"))
    vat_summary.append(
      {
        "vatRate": aliquota,
        "taxableAmount": imponibile,
        "vatAmount": iva,
      }
    )
    taxable_amount += imponibile
    vat_amount += iva

  if not number:
    raise ValueError("Numero fattura mancante nell'XML")
  if invoice_date is None:
    raise ValueError("Data fattura mancante o non valida nell'XML")
  if not supplier_vat and not supplier_cf:
    raise ValueError("P.IVA / CF fornitore mancante nell'XML")

  return {
    "supplier": {
      "vat": supplier_vat or None,
      "fiscalCode": supplier_cf or None,
      "name": supplier_name or None,
    },
    "customer": {
      "vat": customer_vat or None,
      "name": customer_name or None,
    },
    "document": {
      "type": doc_type or None,
      "number": number,
      "date": invoice_date,
      "currency": currency,
      "total": total,
    },
    "lines": lines,
    "vatSummary": vat_summary,
    "taxableAmount": taxable_amount,
    "vatAmount": vat_amount,
  }
