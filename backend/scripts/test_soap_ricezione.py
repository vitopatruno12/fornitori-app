"""Smoke test locale: SOAP RiceviFatture → bridge Atlas + NotificaDecorrenzaTermini."""
from __future__ import annotations

import base64
from pathlib import Path
from xml.etree import ElementTree as ET

from app.database import SessionLocal
from app.integrations.sdi.soap_ricezione import (
  SOAP_ACTION_DT,
  SOAP_ACTION_RICEVI,
  local_wsdl_xml,
  process_soap_request,
)
from app.main import _ensure_electronic_invoices_tables, _ensure_sdi_electronic_invoice_link
from app.models.electronic_invoice import ElectronicInvoice, IncomingInvoice
from app.models.invoice import Invoice
from app.models.invoice_row import InvoiceRow
from app.models.sdi_invoice import SdiInvoice

_ensure_electronic_invoices_tables()
_ensure_sdi_electronic_invoice_link()

ROOT = Path(__file__).resolve().parents[1]
xml_bytes = (ROOT / "fixtures" / "ITCRRMNL89P27E506Z_SOAP87.xml").read_bytes()
meta = (
  b'<?xml version="1.0" encoding="UTF-8"?>'
  b"<MetadatiInvioFile>"
  b"<IdentificativoSdI>900000000087</IdentificativoSdI>"
  b"<NomeFile>IT04726300751_00003.xml</NomeFile>"
  b"</MetadatiInvioFile>"
)
b64_file = base64.b64encode(xml_bytes).decode("ascii")
b64_meta = base64.b64encode(meta).decode("ascii")

envelope = f"""<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:types="http://www.fatturapa.gov.it/sdi/ws/ricezione/v1.0/types">
  <soapenv:Header/>
  <soapenv:Body>
    <types:fileSdIConMetadati>
      <types:IdentificativoSdI>900000000087</types:IdentificativoSdI>
      <types:NomeFile>IT04726300751_00003.xml</types:NomeFile>
      <types:File>{b64_file}</types:File>
      <types:NomeFileMetadati>IT04726300751_00003_MT_001.xml</types:NomeFileMetadati>
      <types:Metadati>{b64_meta}</types:Metadati>
    </types:fileSdIConMetadati>
  </soapenv:Body>
</soapenv:Envelope>
"""

db = SessionLocal()
try:
  soap_out, status, info = process_soap_request(db, envelope, soap_action=SOAP_ACTION_RICEVI)
  print("HTTP", status)
  print(
    "INFO",
    {
      k: info.get(k)
      for k in [
        "operazione",
        "ok",
        "duplicate",
        "id",
        "electronic_invoice_id",
        "identificativo_sdi",
        "nome_file",
      ]
    },
  )
  esito = None
  for el in ET.fromstring(soap_out).iter():
    if el.tag.endswith("Esito"):
      esito = el.text
  print("Esito", esito)
  assert status == 200 and esito == "ER01"
  assert info.get("electronic_invoice_id")
  assert info.get("id")

  sdi = db.query(SdiInvoice).filter(SdiInvoice.id == info["id"]).one()
  ei = db.query(ElectronicInvoice).filter(ElectronicInvoice.id == info["electronic_invoice_id"]).one()
  inc = db.query(IncomingInvoice).filter(IncomingInvoice.electronic_invoice_id == ei.id).one()
  inv = db.query(Invoice).filter(Invoice.id == inc.atlas_invoice_id).one()
  rows = db.query(InvoiceRow).filter(InvoiceRow.invoice_id == inv.id).all()
  print(
    "CHAIN",
    {
      "status": inc.status,
      "sdi_invoice_id": sdi.id,
      "sdi_message_id": sdi.sdi_message_id,
      "source": sdi.source,
      "electronic_invoice_id": ei.id,
      "incoming_invoice_id": inc.id,
      "atlas_invoice_id": inv.id,
      "invoice_number": inv.invoice_number,
      "rows": len(rows),
    },
  )
  assert sdi.sdi_message_id == "900000000087"
  assert sdi.source == "soap"
  assert str(inv.invoice_number) == "87"
  assert len(rows) == 1
  assert inc.status == "REGISTERED"

  dt_body = base64.b64encode(
    b"<NotificaDecorrenzaTermini><IdentificativoSdI>900000000087</IdentificativoSdI></NotificaDecorrenzaTermini>"
  ).decode()
  dt_env = f"""<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:types="http://www.fatturapa.gov.it/sdi/ws/ricezione/v1.0/types">
  <soapenv:Body>
    <types:fileSdI>
      <types:IdentificativoSdI>900000000087</types:IdentificativoSdI>
      <types:NomeFile>IT04726300751_00003_DT_001.xml</types:NomeFile>
      <types:File>{dt_body}</types:File>
    </types:fileSdI>
  </soapenv:Body>
</soapenv:Envelope>
"""
  soap2, st2, info2 = process_soap_request(db, dt_env, soap_action=SOAP_ACTION_DT)
  print("DT", st2, info2.get("operazione"), info2.get("ok"))
  db.refresh(sdi)
  print("pipeline_after_DT", sdi.pipeline_status)
  assert st2 == 200 and info2.get("operazione") == "NotificaDecorrenzaTermini"
  assert sdi.pipeline_status == "decorrenza_termini"
  assert "RiceviFatture" in local_wsdl_xml("http://localhost:8000/sdi/soap/RicezioneFatture")
  print("SOAP_TEST_PASSED")
finally:
  db.close()
