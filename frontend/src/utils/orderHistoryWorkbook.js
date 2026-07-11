export const ORDER_HISTORY_WORKBOOK_TITLE = 'Storico ordini'

export const ORDER_HISTORY_COLUMNS = [
  { id: 'row', label: '#', numeric: true, width: 44, sticky: 'left' },
  { id: 'order_date', label: 'Data', width: 100 },
  { id: 'sequence_number', label: 'N.', numeric: true, width: 56, emphasis: true },
  { id: 'expected_delivery_date', label: 'Consegna prev.', width: 110 },
  { id: 'order_signed_by', label: 'Firma ordine', width: 120 },
  { id: 'supplier_name', label: 'Fornitore', width: 160 },
  { id: 'merchandise_summary', label: 'Descrizione merce', width: 320, emphasis: true },
  { id: 'status', label: 'Stato', width: 96, tone: (row) => orderHistoryStatusTone(row.status) },
]

function formatDateIt(iso) {
  if (!iso) return ''
  const [y, m, day] = String(iso).slice(0, 10).split('-')
  if (!y || !m || !day) return String(iso)
  return `${day}/${m}/${y}`
}

function text(value) {
  if (value == null || value === '') return ''
  return String(value)
}

export function orderDisplayNum(order) {
  if (!order || typeof order !== 'object') return ''
  const n = order.sequence_number
  if (n != null && n !== '' && Number.isFinite(Number(n))) return String(n)
  return String(order.id ?? '')
}

export function orderHistoryStatusLabel(status) {
  if (status === 'sent') return 'Inviato'
  return 'In sospeso'
}

export function orderHistoryStatusTone(status) {
  if (status === 'sent') return 'workbook-cell-yes'
  if (status === 'pending') return 'workbook-cell-warning'
  return ''
}

/**
 * @param {Record<string, unknown>} order
 * @param {{ id: string }} column
 * @param {{ rowIndex?: number, supplierLabel?: string }} ctx
 */
export function orderHistoryCellValue(order, column, ctx = {}) {
  const { rowIndex = 0, supplierLabel = '' } = ctx
  switch (column.id) {
    case 'row':
      return String(rowIndex + 1)
    case 'order_date':
      return formatDateIt(order.order_date)
    case 'sequence_number':
      return orderDisplayNum(order)
    case 'expected_delivery_date':
      return order.expected_delivery_date ? formatDateIt(order.expected_delivery_date) : '—'
    case 'order_signed_by':
      return text(order.order_signed_by) || '—'
    case 'supplier_name':
      return text(order.supplier_name) || supplierLabel || '—'
    case 'merchandise_summary':
      return text(order.merchandise_summary) || '—'
    case 'status':
      return orderHistoryStatusLabel(order.status)
    default:
      return ''
  }
}
