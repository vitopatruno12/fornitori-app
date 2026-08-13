from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from hashlib import sha256
from xml.etree import ElementTree as ET

from sqlalchemy.orm import Session

from ..models.electronic_invoice import ElectronicInvoice, IncomingInvoice, IncomingInvoiceLine
from ..models.supplier import Supplier


NS = {
    "p": "http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2"
}


class ElectronicInvoiceImportService:

    def __init__(self, db: Session):
        self.db = db

    def import_xml(
        self,
        xml_content: str,
        filename: str | None = None,
    ):
        # ---------------------------------------------------------
        # 1. HASH SHA-256
        # ---------------------------------------------------------

        document_hash = sha256(
            xml_content.encode("utf-8")
        ).hexdigest()

        existing = (
            self.db.query(ElectronicInvoice)
            .filter(
                ElectronicInvoice.document_hash == document_hash
            )
            .first()
        )

        if existing:
            return {
                "status": "DUPLICATE",
                "electronic_invoice_id": existing.id,
            }

        # ---------------------------------------------------------
        # 2. PARSE XML
        # ---------------------------------------------------------

        root = ET.fromstring(xml_content)

        header = self._find(
            root,
            "FatturaElettronicaHeader",
        )

        body = self._find(
            root,
            "FatturaElettronicaBody",
        )

        if header is None or body is None:
            raise ValueError(
                "XML FatturaPA non valido"
            )

        # ---------------------------------------------------------
        # 3. FORNITORE
        # ---------------------------------------------------------

        cedente = self._find(
            header,
            "CedentePrestatore",
        )

        if cedente is None:
            raise ValueError(
                "CedentePrestatore mancante"
            )

        supplier_vat = self._find_text(
            cedente,
            "DatiAnagrafici/"
            "IdFiscaleIVA/"
            "IdCodice",
        )

        supplier_name = self._find_text(
            cedente,
            "DatiAnagrafici/"
            "Anagrafica/"
            "Denominazione",
        )

        supplier_fiscal_code = self._find_text(
            cedente,
            "DatiAnagrafici/"
            "CodiceFiscale",
        )

        # ---------------------------------------------------------
        # 4. CLIENTE
        # ---------------------------------------------------------

        cessionario = self._find(
            header,
            "CessionarioCommittente",
        )

        customer_vat = self._find_text(
            cessionario,
            "DatiAnagrafici/"
            "IdFiscaleIVA/"
            "IdCodice",
        )

        # ---------------------------------------------------------
        # 5. DATI DOCUMENTO
        # ---------------------------------------------------------

        document = self._find(
            body,
            "DatiGenerali/"
            "DatiGeneraliDocumento",
        )

        if document is None:
            raise ValueError(
                "DatiGeneraliDocumento mancante"
            )

        document_type = self._find_text(
            document,
            "TipoDocumento",
        )

        invoice_number = self._find_text(
            document,
            "Numero",
        )

        invoice_date_raw = self._find_text(
            document,
            "Data",
        )

        currency = self._find_text(
            document,
            "Divisa",
        ) or "EUR"

        total_raw = self._find_text(
            document,
            "ImportoTotaleDocumento",
        )
        if not total_raw:
            raise ValueError("ImportoTotaleDocumento mancante")

        total_amount = Decimal(total_raw)

        if not invoice_date_raw:
            raise ValueError("Data fattura mancante")

        invoice_date = datetime.strptime(
            invoice_date_raw,
            "%Y-%m-%d",
        ).date()

        # ---------------------------------------------------------
        # 6. RIEPILOGO IVA
        # ---------------------------------------------------------

        vat_summary = self._findall(
            body,
            "DatiBeniServizi/"
            "DatiRiepilogo",
        )

        taxable_amount = Decimal("0")
        vat_amount = Decimal("0")

        for summary in vat_summary:

            taxable = self._find_text(
                summary,
                "ImponibileImporto",
            )

            vat = self._find_text(
                summary,
                "Imposta",
            )

            if taxable:
                taxable_amount += Decimal(taxable)

            if vat:
                vat_amount += Decimal(vat)

        # ---------------------------------------------------------
        # 7. CERCA FORNITORE
        # ---------------------------------------------------------

        supplier = None

        if supplier_vat:
            supplier = (
                self.db.query(Supplier)
                .filter(
                    Supplier.vat_number == supplier_vat
                )
                .first()
            )
            # match anche con prefisso IT / solo cifre
            if supplier is None:
                digits = "".join(c for c in supplier_vat if c.isdigit())
                if digits:
                    for row in self.db.query(Supplier).filter(Supplier.vat_number.isnot(None)).all():
                        row_digits = "".join(c for c in (row.vat_number or "") if c.isdigit())
                        if row_digits == digits:
                            supplier = row
                            break

        # supplier_name / fiscal_code disponibili per passi futuri (anagrafica)
        _ = (supplier_name, supplier_fiscal_code)

        # ---------------------------------------------------------
        # 8. SALVA ELECTRONIC INVOICE
        # ---------------------------------------------------------

        electronic_invoice = ElectronicInvoice(
            filename=filename,
            xml_content=xml_content,
            document_hash=document_hash,
            document_type=document_type,
            invoice_number=invoice_number,
            invoice_date=invoice_date,
            currency=currency,
            supplier_vat=supplier_vat,
            customer_vat=customer_vat,
            total_amount=total_amount,
            taxable_amount=taxable_amount,
            vat_amount=vat_amount,
            status="PARSED",
        )

        self.db.add(electronic_invoice)
        self.db.flush()

        # ---------------------------------------------------------
        # 9. SALVA INCOMING INVOICE
        # ---------------------------------------------------------

        if not invoice_number:
            raise ValueError("Numero fattura mancante")

        incoming_invoice = IncomingInvoice(
            electronic_invoice_id=electronic_invoice.id,
            supplier_id=supplier.id if supplier else None,
            invoice_number=invoice_number,
            invoice_date=datetime.combine(
                invoice_date,
                datetime.min.time(),
            ),
            taxable_amount=taxable_amount,
            vat_amount=vat_amount,
            total_amount=total_amount,
            currency=currency,
            status="IMPORTED",
        )

        self.db.add(incoming_invoice)
        self.db.flush()

        # ---------------------------------------------------------
        # 10. RIGHE
        # ---------------------------------------------------------

        lines = self._findall(
            body,
            "DatiBeniServizi/"
            "DettaglioLinee",
        )

        for line in lines:

            line_number = self._find_text(
                line,
                "NumeroLinea",
            )

            description = self._find_text(
                line,
                "Descrizione",
            )

            quantity = self._decimal_or_none(
                self._find_text(
                    line,
                    "Quantita",
                )
            )

            unit_price = self._decimal_or_none(
                self._find_text(
                    line,
                    "PrezzoUnitario",
                )
            )

            line_total = self._decimal_or_none(
                self._find_text(
                    line,
                    "PrezzoTotale",
                )
            )

            vat_rate = self._decimal_or_none(
                self._find_text(
                    line,
                    "AliquotaIVA",
                )
            )

            invoice_line = IncomingInvoiceLine(
                invoice_id=incoming_invoice.id,
                line_number=int(line_number or 0),
                description=description,
                quantity=quantity,
                unit_price=unit_price,
                line_total=line_total,
                vat_rate=vat_rate,
            )

            self.db.add(invoice_line)

        # ---------------------------------------------------------
        # 11. COMMIT
        # ---------------------------------------------------------

        self.db.commit()

        self.db.refresh(incoming_invoice)

        return {
            "status": "IMPORTED",
            "electronic_invoice_id": electronic_invoice.id,
            "incoming_invoice_id": incoming_invoice.id,
            "supplier_found": supplier is not None,
            "supplier_id": supplier.id if supplier else None,
            "invoice_number": invoice_number,
            "invoice_date": str(invoice_date),
            "total_amount": str(total_amount),
        }

    def create_atlas_invoice_from_incoming(self, incoming_id: int):
        """Delega al metodo comune in InvoiceImportService (unica logica Invoice/InvoiceRow)."""
        from .invoice_import_service import InvoiceImportService

        return InvoiceImportService(self.db).create_atlas_invoice_from_incoming(incoming_id)

    @classmethod
    def _ns_path(cls, path: str) -> str:
        return "/".join(f"p:{part}" for part in path.split("/"))

    @classmethod
    def _wild_path(cls, path: str) -> str:
        return "/".join(f"{{*}}{part}" for part in path.split("/"))

    @classmethod
    def _find(cls, element, path: str):
        if element is None:
            return None
        node = element.find(cls._ns_path(path), NS)
        if node is not None:
            return node
        node = element.find(path)
        if node is not None:
            return node
        return element.find(cls._wild_path(path))

    @classmethod
    def _findall(cls, element, path: str):
        if element is None:
            return []
        nodes = list(element.findall(cls._ns_path(path), NS))
        if nodes:
            return nodes
        nodes = list(element.findall(path))
        if nodes:
            return nodes
        return list(element.findall(cls._wild_path(path)))

    @classmethod
    def _find_text(
        cls,
        element,
        path: str,
    ):
        node = cls._find(element, path)

        if node is None:
            return None

        if node.text is None:
            return None

        return node.text.strip()

    @staticmethod
    def _decimal_or_none(value):
        if value in (None, ""):
            return None

        return Decimal(value)
