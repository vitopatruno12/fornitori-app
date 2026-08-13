"""
Parser FatturaPA: XML → dati strutturati.

Non salva nulla sul database: solo estrazione e normalizzazione.
"""
from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, List, Optional
from xml.etree import ElementTree as ET


class InvoiceParser:
  """Converte XML FatturaPA in un dict strutturato (namespace-agnostic)."""

  NS = {
    "p": "http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2",
  }

  def parse(self, xml_content: str) -> dict:
    if not xml_content or not str(xml_content).strip():
      raise ValueError("XML vuoto")
    if "<FatturaElettronica" not in xml_content:
      raise ValueError("XML non valido o non FatturaPA")

    try:
      root = ET.fromstring(xml_content)
    except ET.ParseError as e:
      raise ValueError("XML non parsabile") from e

    header = self._find(root, "FatturaElettronicaHeader")
    body = self._find(root, "FatturaElettronicaBody")
    if header is None or body is None:
      raise ValueError("XML FatturaPA non valido")

    supplier = self._find(header, "CedentePrestatore")
    customer = self._find(header, "CessionarioCommittente")
    document = self._find(body, "DatiGenerali/DatiGeneraliDocumento")
    if document is None:
      raise ValueError("Dati documento mancanti")

    supplier_vat = self._text(supplier, "DatiAnagrafici/IdFiscaleIVA/IdCodice")
    supplier_cf = self._text(supplier, "DatiAnagrafici/CodiceFiscale")
    supplier_name = self._text(supplier, "DatiAnagrafici/Anagrafica/Denominazione")
    if not supplier_name:
      nome = self._text(supplier, "DatiAnagrafici/Anagrafica/Nome") or ""
      cognome = self._text(supplier, "DatiAnagrafici/Anagrafica/Cognome") or ""
      supplier_name = " ".join(p for p in (nome, cognome) if p) or None

    customer_vat = self._text(customer, "DatiAnagrafici/IdFiscaleIVA/IdCodice")
    customer_name = self._text(customer, "DatiAnagrafici/Anagrafica/Denominazione")

    doc_date = self._parse_date(self._text(document, "Data"))
    if doc_date is None:
      raise ValueError("Data fattura mancante o non valida")

    number = self._text(document, "Numero")
    if not number:
      raise ValueError("Numero fattura mancante")

    total_raw = self._text(document, "ImportoTotaleDocumento")
    lines = self._parse_lines(body)
    vat_summary = self._parse_vat_summary(body)

    taxable = sum((row["taxable_amount"] for row in vat_summary), Decimal("0"))
    vat_amount = sum((row["vat_amount"] for row in vat_summary), Decimal("0"))
    total_amount = self._decimal(total_raw)
    if total_amount is None:
      total_amount = taxable + vat_amount

    return {
      "document": {
        "type": self._text(document, "TipoDocumento"),
        "number": number,
        "date": doc_date,
        "currency": self._text(document, "Divisa") or "EUR",
        "total_amount": total_amount,
      },
      "supplier": {
        "vat": supplier_vat,
        "fiscal_code": supplier_cf,
        "name": supplier_name,
      },
      "customer": {
        "vat": customer_vat,
        "name": customer_name,
      },
      "lines": lines,
      "vat_summary": vat_summary,
      "taxable_amount": taxable,
      "vat_amount": vat_amount,
    }

  def _parse_lines(self, body: ET.Element) -> List[Dict[str, Any]]:
    beni = self._find(body, "DatiBeniServizi")
    if beni is None:
      return []
    out: List[Dict[str, Any]] = []
    for node in self._findall(beni, "DettaglioLinee"):
      line_no_raw = self._text(node, "NumeroLinea") or "0"
      try:
        line_number = int(line_no_raw)
      except ValueError:
        line_number = 0
      out.append(
        {
          "line_number": line_number,
          "description": self._text(node, "Descrizione"),
          "quantity": self._decimal(self._text(node, "Quantita")),
          "unit_price": self._decimal(self._text(node, "PrezzoUnitario")),
          "line_total": self._decimal(self._text(node, "PrezzoTotale")),
          "vat_rate": self._decimal(self._text(node, "AliquotaIVA")),
        }
      )
    out.sort(key=lambda x: x["line_number"] or 0)
    return out

  def _parse_vat_summary(self, body: ET.Element) -> List[Dict[str, Any]]:
    beni = self._find(body, "DatiBeniServizi")
    if beni is None:
      return []
    out: List[Dict[str, Any]] = []
    for node in self._findall(beni, "DatiRiepilogo"):
      out.append(
        {
          "vat_rate": self._decimal(self._text(node, "AliquotaIVA")),
          "taxable_amount": self._decimal(self._text(node, "ImponibileImporto")) or Decimal("0"),
          "vat_amount": self._decimal(self._text(node, "Imposta")) or Decimal("0"),
        }
      )
    return out

  def _find(self, element: Optional[ET.Element], path: str) -> Optional[ET.Element]:
    if element is None:
      return None
    # 1) con namespace p:
    ns_path = "/".join(f"p:{part}" for part in path.split("/"))
    node = element.find(ns_path, self.NS)
    if node is not None:
      return node
    # 2) senza namespace
    node = element.find(path)
    if node is not None:
      return node
    # 3) wildcard namespace (FatturaPA con default xmlns)
    wild = "/".join(f"{{*}}{part}" for part in path.split("/"))
    return element.find(wild)

  def _findall(self, element: Optional[ET.Element], path: str) -> List[ET.Element]:
    if element is None:
      return []
    ns_path = "/".join(f"p:{part}" for part in path.split("/"))
    nodes = list(element.findall(ns_path, self.NS))
    if nodes:
      return nodes
    nodes = list(element.findall(path))
    if nodes:
      return nodes
    wild = "/".join(f"{{*}}{part}" for part in path.split("/"))
    return list(element.findall(wild))

  def _text(self, element: Optional[ET.Element], path: str) -> Optional[str]:
    node = self._find(element, path)
    if node is None or node.text is None:
      return None
    value = node.text.strip()
    return value or None

  @staticmethod
  def _decimal(raw: Optional[str]) -> Optional[Decimal]:
    if raw is None or not str(raw).strip():
      return None
    s = str(raw).strip().replace(",", ".")
    try:
      return Decimal(s)
    except (InvalidOperation, ValueError):
      return None

  @staticmethod
  def _parse_date(raw: Optional[str]) -> Optional[date]:
    if not raw:
      return None
    s = str(raw).strip()
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
      try:
        return date.fromisoformat(s[:10])
      except ValueError:
        return None
    for fmt in ("%d/%m/%Y", "%d-%m-%Y"):
      try:
        return datetime.strptime(s[:10], fmt).date()
      except ValueError:
        continue
    return None
