export const PRICE_LIST_WORKBOOK_TITLE = 'Prezzario fornitore'

export const PRICE_LIST_WORKBOOK_COLUMNS = [
  { id: 'row', label: '#', numeric: true, width: 44, sticky: 'left' },
  { id: 'product_description', label: 'Tipo merce', width: 280, emphasis: true },
  { id: 'unit_price', label: 'Prezzo unit. (€)', numeric: true, width: 130 },
]

function formatAmount(value) {
  if (value == null || value === '') return ''
  const n = Number(value)
  if (Number.isNaN(n)) return ''
  return n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function priceListWorkbookCellValue(item, column, ctx = {}) {
  const { rowIndex = 0 } = ctx
  switch (column.id) {
    case 'row':
      return String(rowIndex + 1)
    case 'product_description':
      return String(item.product_description || '')
    case 'unit_price':
      return formatAmount(item.unit_price)
    default:
      return ''
  }
}

export function priceListWorkbookTotals(items) {
  const list = Array.isArray(items) ? items : []
  const prices = list.map((x) => Number(x.unit_price)).filter((n) => Number.isFinite(n))
  const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0
  return {
    count: list.length,
    avg: formatAmount(avg),
  }
}

export function priceListWorkbookTotalsLabel(columnId, totals) {
  if (columnId === 'product_description') return `TOTALI (${totals.count})`
  if (columnId === 'unit_price') return totals.count ? `Media ${totals.avg}` : ''
  return ''
}
