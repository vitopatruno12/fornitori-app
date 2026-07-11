export const DELIVERY_ITEMS_WORKBOOK_TITLE = 'Prodotti consegnati'

export const DELIVERY_ITEMS_WORKBOOK_COLUMNS = [
  { id: 'row', label: '#', numeric: true, width: 44, sticky: 'left', readonly: true },
  { id: 'product_description', label: 'Prodotto', width: 200, emphasis: true },
  { id: 'weight_kg', label: 'Peso (kg)', numeric: true, width: 100 },
  { id: 'pieces', label: 'Pezzi', numeric: true, width: 80 },
  { id: 'unit_price', label: 'Prezzo unit. €', numeric: true, width: 120 },
  { id: 'line_total', label: 'Tot. riga (imp.)', numeric: true, width: 120, readonly: true },
  { id: 'list_price', label: 'Listino €', numeric: true, width: 100, readonly: true },
  { id: 'price_diff', label: 'Diff. listino', numeric: true, width: 110, readonly: true },
  { id: 'note', label: 'Note', width: 160 },
  { id: 'destination', label: 'Destinazione', width: 160, readonly: true },
  { id: 'anomaly_note', label: 'Note anomalie', width: 160 },
]

function formatAmount(value) {
  if (value == null || value === '' || value === '—') return ''
  const n = Number(value)
  if (Number.isNaN(n)) return String(value)
  return n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function deliveryItemLineImponibile(item) {
  const w = Number(item.weight_kg) || 0
  const p = Number(item.pieces) || 0
  const up = Number(item.unit_price) || 0
  if (w > 0) return w * up
  if (p > 0) return p * up
  return 0
}

export function deliveryItemLineImponibileDisplay(item) {
  const v = deliveryItemLineImponibile(item)
  return v > 0 ? formatAmount(v) : ''
}

export function deliveryItemDiffTone(diff) {
  if (diff == null || diff === '' || diff === '—') return ''
  const n = Number(diff)
  if (Number.isNaN(n) || n === 0) return ''
  return n > 0 ? 'workbook-cell-alert' : 'workbook-cell-yes'
}

export function deliveryItemDiffDisplay(diff) {
  if (diff == null || diff === '' || diff === '—') return ''
  const n = Number(diff)
  if (Number.isNaN(n)) return ''
  const prefix = n > 0 ? '+' : ''
  return `${prefix}${formatAmount(n)}`
}

export function deliveryItemsWorkbookTotals(items) {
  const list = Array.isArray(items) ? items : []
  const total = list.reduce((acc, item) => acc + deliveryItemLineImponibile(item), 0)
  return {
    count: list.length,
    lineTotal: formatAmount(total),
  }
}

export function deliveryItemsWorkbookTotalsLabel(columnId, totals) {
  if (columnId === 'product_description') return `TOTALI (${totals.count})`
  if (columnId === 'line_total') return totals.lineTotal
  return ''
}

/**
 * Valore cella readonly calcolata.
 * @param {Record<string, string>} item
 * @param {{ id: string }} column
 * @param {{ rowIndex: number, listPrice?: number|null, diff?: string|null, destination?: string }} ctx
 */
export function deliveryItemReadonlyCellValue(item, column, ctx = {}) {
  const { rowIndex = 0, listPrice = null, diff = null, destination = '' } = ctx
  switch (column.id) {
    case 'row':
      return String(rowIndex + 1)
    case 'line_total':
      return deliveryItemLineImponibileDisplay(item)
    case 'list_price':
      return listPrice != null ? formatAmount(listPrice) : ''
    case 'price_diff':
      return deliveryItemDiffDisplay(diff)
    case 'destination':
      return destination
    default:
      return ''
  }
}
