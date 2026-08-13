"""
Server SOAP locale SdICoop — RicezioneFatture
  - RiceviFatture (ufficiale; alias RiceviFattura)
  - NotificaDecorrenzaTermini

Solo protocollo davanti a sdi_ingest_service (nessun accreditamento / HTTPS).
"""
from __future__ import annotations

import base64
import logging
import re
from pathlib import Path
from typing import Any, Dict, Optional, Tuple
from xml.etree import ElementTree as ET

from sqlalchemy.orm import Session

from ...services.sdi_ingest_service import ingest_fatturapa_bytes

logger = logging.getLogger("app.sdi.soap")

NS_TYPES = "http://www.fatturapa.gov.it/sdi/ws/ricezione/v1.0/types"
NS_SOAP = "http://schemas.xmlsoap.org/soap/envelope/"
NS_WSDL = "http://www.fatturapa.gov.it/sdi/ws/ricezione/v1.0"

SOAP_ACTION_RICEVI = "http://www.fatturapa.it/RicezioneFatture/RiceviFattureSdI"
SOAP_ACTION_DT = "http://www.fatturapa.it/RicezioneFatture/NotificaDecorrenzaTermini"

WSDL_DIR = Path(__file__).resolve().parent / "wsdl"
NOTIFICATIONS_DIR = Path(__file__).resolve().parent.parent.parent / "uploads" / "sdi" / "notifications"


def _local(tag: str) -> str:
  if "}" in tag:
    return tag.rsplit("}", 1)[-1]
  return tag


def _find_child(parent: Optional[ET.Element], name: str) -> Optional[ET.Element]:
  if parent is None:
    return None
  for child in list(parent):
    if _local(child.tag) == name:
      return child
  return None


def _text(parent: Optional[ET.Element], name: str) -> Optional[str]:
  node = _find_child(parent, name)
  if node is None or node.text is None:
    return None
  value = node.text.strip()
  return value or None


def _b64(parent: Optional[ET.Element], name: str) -> bytes:
  raw = _text(parent, name)
  if not raw:
    raise ValueError(f"Campo {name} mancante o vuoto")
  try:
    return base64.b64decode(raw, validate=False)
  except Exception as exc:  # pylint: disable=broad-except
    raise ValueError(f"Campo {name} non è base64 valido") from exc


def _detect_operation(soap_action: Optional[str], body: ET.Element) -> str:
  action = (soap_action or "").strip().strip('"')
  if "NotificaDecorrenzaTermini" in action:
    return "NotificaDecorrenzaTermini"
  if "RiceviFatture" in action or "RiceviFattura" in action:
    return "RiceviFatture"

  # fallback: primo elemento nel Body
  for child in list(body):
    local = _local(child.tag)
    if local in {"fileSdIConMetadati", "RiceviFatture", "RiceviFattura"}:
      return "RiceviFatture"
    if local in {"fileSdI", "notificaDecorrenzaTermini", "NotificaDecorrenzaTermini"}:
      # fileSdI senza metadati = DT (o notifica generica one-way)
      if local == "fileSdI":
        # se ha solo Identificativo/Nome/File e SoapAction assente, DT
        return "NotificaDecorrenzaTermini"
      return "NotificaDecorrenzaTermini"
  raise ValueError("Operazione SOAP non riconosciuta")


def _soap_fault(code: str, message: str) -> str:
  safe = (
    message.replace("&", "&amp;")
    .replace("<", "&lt;")
    .replace(">", "&gt;")
    .replace('"', "&quot;")
  )
  return f"""<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="{NS_SOAP}">
  <soapenv:Body>
    <soapenv:Fault>
      <faultcode>{code}</faultcode>
      <faultstring>{safe}</faultstring>
    </soapenv:Fault>
  </soapenv:Body>
</soapenv:Envelope>
"""


def _soap_ricevi_response(esito: str = "ER01") -> str:
  return f"""<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="{NS_SOAP}" xmlns:types="{NS_TYPES}">
  <soapenv:Body>
    <types:rispostaRiceviFatture>
      <types:Esito>{esito}</types:Esito>
    </types:rispostaRiceviFatture>
  </soapenv:Body>
</soapenv:Envelope>
"""


def _soap_empty_ok() -> str:
  return f"""<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="{NS_SOAP}">
  <soapenv:Body/>
</soapenv:Envelope>
"""


def handle_ricevi_fatture(db: Session, payload_el: ET.Element) -> Tuple[str, Dict[str, Any]]:
  """
  fileSdIConMetadati → ingest → ER01.
  Metadati: salvati su disco (fase metadati completa = step successivo).
  """
  # payload può essere fileSdIConMetadati stesso
  root = payload_el
  if _local(payload_el.tag) not in {"fileSdIConMetadati"}:
    nested = _find_child(payload_el, "fileSdIConMetadati")
    if nested is not None:
      root = nested

  identificativo = _text(root, "IdentificativoSdI")
  nome_file = _text(root, "NomeFile") or "fattura.xml"
  file_bytes = _b64(root, "File")
  nome_meta = _text(root, "NomeFileMetadati")
  meta_bytes = None
  try:
    meta_bytes = _b64(root, "Metadati")
  except ValueError:
    meta_bytes = None

  if meta_bytes and nome_meta:
    NOTIFICATIONS_DIR.mkdir(parents=True, exist_ok=True)
    safe_meta = re.sub(r"[^\w.\-]+", "_", nome_meta)[:80]
    meta_path = NOTIFICATIONS_DIR / f"{identificativo or 'na'}_{safe_meta}"
    meta_path.write_bytes(meta_bytes)

  result = ingest_fatturapa_bytes(
    db,
    file_bytes,
    sdi_message_id=str(identificativo) if identificativo else None,
    filename=nome_file,
    source="soap",
  )
  result["operazione"] = "RiceviFatture"
  result["identificativo_sdi"] = identificativo
  result["nome_file"] = nome_file
  result["nome_file_metadati"] = nome_meta
  return _soap_ricevi_response("ER01"), result


def handle_notifica_decorrenza_termini(db: Session, payload_el: ET.Element) -> Tuple[str, Dict[str, Any]]:
  """
  One-way: archivia notifica DT localmente.
  (Collegamento completo a SdiInvoice = step notifiche.)
  """
  root = payload_el
  if _local(payload_el.tag) not in {"fileSdI", "notificaDecorrenzaTermini"}:
    nested = _find_child(payload_el, "fileSdI") or _find_child(payload_el, "notificaDecorrenzaTermini")
    if nested is not None:
      root = nested

  identificativo = _text(root, "IdentificativoSdI")
  nome_file = _text(root, "NomeFile") or "DT.xml"
  file_bytes = _b64(root, "File")

  NOTIFICATIONS_DIR.mkdir(parents=True, exist_ok=True)
  safe_name = re.sub(r"[^\w.\-]+", "_", nome_file)[:80]
  dest = NOTIFICATIONS_DIR / f"DT_{identificativo or 'na'}_{safe_name}"
  dest.write_bytes(file_bytes)

  # touch: se esiste SdiInvoice con stesso IdentificativoSdI, aggiorna status
  if identificativo:
    from ...models.sdi_invoice import SdiInvoice

    row = (
      db.query(SdiInvoice)
      .filter(SdiInvoice.sdi_message_id == str(identificativo))
      .order_by(SdiInvoice.id.desc())
      .first()
    )
    if row:
      row.pipeline_status = "decorrenza_termini"
      db.commit()

  info = {
    "operazione": "NotificaDecorrenzaTermini",
    "identificativo_sdi": identificativo,
    "nome_file": nome_file,
    "stored_path": str(dest.relative_to(NOTIFICATIONS_DIR.parent.parent)).replace("\\", "/"),
    "ok": True,
  }
  return _soap_empty_ok(), info


def process_soap_request(
  db: Session,
  raw_xml: bytes | str,
  soap_action: Optional[str] = None,
) -> Tuple[str, int, Dict[str, Any]]:
  """
  Returns (soap_xml_response, http_status, debug_info).
  """
  try:
    if isinstance(raw_xml, bytes):
      text = raw_xml.decode("utf-8", errors="replace")
    else:
      text = raw_xml
    if not text.strip():
      return _soap_fault("soapenv:Client", "Envelope SOAP vuoto"), 400, {"ok": False}

    root = ET.fromstring(text)
    body = None
    for el in root.iter():
      if _local(el.tag) == "Body":
        body = el
        break
    if body is None or len(list(body)) == 0:
      return _soap_fault("soapenv:Client", "SOAP Body mancante"), 400, {"ok": False}

    payload = list(body)[0]
    op = _detect_operation(soap_action, body)

    if op == "RiceviFatture":
      soap_out, info = handle_ricevi_fatture(db, payload)
      return soap_out, 200, info

    if op == "NotificaDecorrenzaTermini":
      soap_out, info = handle_notifica_decorrenza_termini(db, payload)
      return soap_out, 200, info

    return _soap_fault("soapenv:Client", f"Operazione non supportata: {op}"), 400, {"ok": False}
  except ValueError as exc:
    logger.warning("SOAP RicezioneFatture client error: %s", exc)
    return _soap_fault("soapenv:Client", str(exc)), 400, {"ok": False, "error": str(exc)}
  except Exception as exc:  # pylint: disable=broad-except
    logger.exception("SOAP RicezioneFatture server error")
    return _soap_fault("soapenv:Server", "Errore interno RicezioneFatture"), 500, {
      "ok": False,
      "error": str(exc),
    }


def local_wsdl_xml(endpoint_url: str) -> str:
  """WSDL minimale con location puntata all'endpoint Atlas locale."""
  return f"""<?xml version="1.0" encoding="UTF-8"?>
<wsdl:definitions
  xmlns:wsdl="http://schemas.xmlsoap.org/wsdl/"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:soapbind="http://schemas.xmlsoap.org/wsdl/soap/"
  xmlns:types="{NS_TYPES}"
  xmlns:tns="{NS_WSDL}"
  targetNamespace="{NS_WSDL}">

  <wsdl:types>
    <xsd:schema>
      <xsd:import namespace="{NS_TYPES}" schemaLocation="RicezioneTypes_v1.0.xsd"/>
    </xsd:schema>
  </wsdl:types>

  <wsdl:message name="richiestaRiceviFatture_Msg">
    <wsdl:part name="parametersIn" element="types:fileSdIConMetadati"/>
  </wsdl:message>
  <wsdl:message name="rispostaRiceviFatture_Msg">
    <wsdl:part name="parametersOut" element="types:rispostaRiceviFatture"/>
  </wsdl:message>
  <wsdl:message name="notificaRicezioneFatture_Msg">
    <wsdl:part name="parametersNotifica" element="types:fileSdI"/>
  </wsdl:message>

  <wsdl:portType name="RicezioneFatture">
    <wsdl:operation name="RiceviFatture">
      <wsdl:input message="tns:richiestaRiceviFatture_Msg"/>
      <wsdl:output message="tns:rispostaRiceviFatture_Msg"/>
    </wsdl:operation>
    <wsdl:operation name="NotificaDecorrenzaTermini">
      <wsdl:input message="tns:notificaRicezioneFatture_Msg"/>
    </wsdl:operation>
  </wsdl:portType>

  <wsdl:binding name="RicezioneFatture_binding" type="tns:RicezioneFatture">
    <soapbind:binding style="document" transport="http://schemas.xmlsoap.org/soap/http"/>
    <wsdl:operation name="RiceviFatture">
      <soapbind:operation soapAction="{SOAP_ACTION_RICEVI}"/>
      <wsdl:input><soapbind:body use="literal"/></wsdl:input>
      <wsdl:output><soapbind:body use="literal"/></wsdl:output>
    </wsdl:operation>
    <wsdl:operation name="NotificaDecorrenzaTermini">
      <soapbind:operation soapAction="{SOAP_ACTION_DT}"/>
      <wsdl:input><soapbind:body use="literal"/></wsdl:input>
    </wsdl:operation>
  </wsdl:binding>

  <wsdl:service name="RicezioneFatture_service">
    <wsdl:port name="RicezioneFatture_port" binding="tns:RicezioneFatture_binding">
      <soapbind:address location="{endpoint_url}"/>
    </wsdl:port>
  </wsdl:service>
</wsdl:definitions>
"""
