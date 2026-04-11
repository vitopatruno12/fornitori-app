from decimal import Decimal


def calculate_vat(imponibile: Decimal, vat_percent: Decimal) -> tuple[Decimal, Decimal]:
  """
  Ritorna (iva_importo, totale).
  """
  iva = (imponibile * vat_percent / Decimal("100")).quantize(Decimal("0.01"))
  totale = (imponibile + iva).quantize(Decimal("0.01"))
  return iva, totale
