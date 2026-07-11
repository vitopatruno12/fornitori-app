import { formatSupplierLocales } from './supplierLocales.js'

export const SUPPLIER_WORKBOOK_TITLE = 'Anagrafica fornitori'

/** Colonne foglio Excel anagrafica fornitori. */
export const SUPPLIER_WORKBOOK_COLUMNS = [
  { id: 'row', label: '#', numeric: true, width: 44, sticky: 'left' },
  { id: 'name', label: 'Ragione sociale', width: 210, emphasis: true },
  { id: 'vat_number', label: 'P.IVA', width: 130 },
  { id: 'fiscal_code', label: 'Codice fiscale', width: 150 },
  { id: 'email', label: 'Email', width: 190 },
  { id: 'phone', label: 'Telefono', width: 120 },
  { id: 'contact_person', label: 'Referente', width: 140 },
  { id: 'city', label: 'Città', width: 120 },
  { id: 'address', label: 'Indirizzo', width: 180 },
  { id: 'country', label: 'Nazione', width: 100 },
  { id: 'iban', label: 'IBAN', width: 240, mono: true },
  { id: 'payment_terms', label: 'Condizioni pagamento', width: 170 },
  { id: 'merchandise_category', label: 'Categoria merceologica', width: 150 },
  { id: 'price_list_label', label: 'Listino', width: 140 },
  { id: 'listino_righe', label: 'Righe listino', numeric: true, width: 100 },
  { id: 'locales', label: 'Locali', width: 150 },
  { id: 'notes', label: 'Note', width: 180 },
  { id: 'is_active', label: 'Attivo', width: 72 },
  { id: 'is_expired', label: 'Scaduto', width: 72 },
  { id: 'totale_fatture', label: 'Tot. fatture', numeric: true, width: 120 },
  { id: 'totale_da_pagare', label: 'Da pagare', numeric: true, width: 110 },
  { id: 'saldo_aperto', label: 'Saldo aperto', numeric: true, width: 120 },
  { id: 'ultima_consegna', label: 'Ult. consegna', width: 130 },
  { id: 'ultima_fattura', label: 'Ult. fattura', width: 130 },
  { id: 'scadenze_aperte', label: 'Scad. aperte', numeric: true, width: 100 },
  { id: 'created_at', label: 'Inserito il', width: 130 },
]

function formatEuro(n) {
  if (n == null || Number.isNaN(Number(n))) return ''
  return Number(n).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDateTime(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function yesNo(value) {
  return value ? 'Sì' : 'No'
}

function text(value) {
  if (value == null || value === '') return ''
  return String(value)
}

/**
 * @param {Record<string, unknown>} supplier
 * @param {{ id: string }} column
 * @param {{ rowIndex: number, localeOptions?: { id: string, label: string }[] }} ctx
 */
export function supplierWorkbookCellValue(supplier, column, ctx = {}) {
  const { rowIndex = 0, localeOptions = [] } = ctx
  switch (column.id) {
    case 'row':
      return String(rowIndex + 1)
    case 'name':
      return text(supplier.name)
    case 'vat_number':
      return text(supplier.vat_number)
    case 'fiscal_code':
      return text(supplier.fiscal_code)
    case 'email':
      return text(supplier.email)
    case 'phone':
      return text(supplier.phone)
    case 'contact_person':
      return text(supplier.contact_person)
    case 'city':
      return text(supplier.city)
    case 'address':
      return text(supplier.address)
    case 'country':
      return text(supplier.country)
    case 'iban':
      return text(supplier.iban)
    case 'payment_terms':
      return text(supplier.payment_terms)
    case 'merchandise_category':
      return text(supplier.merchandise_category)
    case 'price_list_label':
      return text(supplier.price_list_label)
    case 'listino_righe':
      return supplier.listino_righe > 0 ? String(supplier.listino_righe) : ''
    case 'locales':
      return formatSupplierLocales(supplier.locales, localeOptions)
    case 'notes':
      return text(supplier.notes)
    case 'is_active':
      return yesNo(supplier.is_active)
    case 'is_expired':
      return yesNo(supplier.is_expired)
    case 'totale_fatture':
      return formatEuro(supplier.totale_fatture)
    case 'totale_da_pagare':
      return formatEuro(supplier.totale_da_pagare)
    case 'saldo_aperto':
      return formatEuro(supplier.saldo_aperto)
    case 'ultima_consegna':
      return formatDateTime(supplier.ultima_consegna)
    case 'ultima_fattura':
      return formatDateTime(supplier.ultima_fattura)
    case 'scadenze_aperte':
      return supplier.scadenze_aperte > 0 ? String(supplier.scadenze_aperte) : ''
    case 'created_at':
      return formatDateTime(supplier.created_at)
    default:
      return ''
  }
}

/** Totali numerici in fondo al foglio. */
export function supplierWorkbookTotals(suppliers) {
  const list = Array.isArray(suppliers) ? suppliers : []
  const sum = (key) => list.reduce((acc, s) => acc + (Number(s[key]) || 0), 0)
  return {
    totale_fatture: formatEuro(sum('totale_fatture')),
    totale_da_pagare: formatEuro(sum('totale_da_pagare')),
    saldo_aperto: formatEuro(sum('saldo_aperto')),
    scadenze_aperte: String(sum('scadenze_aperte')),
    listino_righe: String(sum('listino_righe')),
    count: list.length,
  }
}

export function supplierWorkbookTotalsLabel(columnId, totals) {
  if (columnId === 'name') return `TOTALI (${totals.count})`
  if (columnId === 'totale_fatture') return totals.totale_fatture
  if (columnId === 'totale_da_pagare') return totals.totale_da_pagare
  if (columnId === 'saldo_aperto') return totals.saldo_aperto
  if (columnId === 'scadenze_aperte') return totals.scadenze_aperte
  if (columnId === 'listino_righe') return totals.listino_righe
  return ''
}
