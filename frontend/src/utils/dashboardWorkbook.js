export const DASHBOARD_PENDING_ORDERS_TITLE = 'Ordini in sospeso: consegna prevista superata'

export const DASHBOARD_PENDING_ORDERS_COLUMNS = [
  { id: 'row', label: '#', numeric: true, width: 44, sticky: 'left' },
  { id: 'order_number', label: 'N.', width: 72 },
  { id: 'supplier_name', label: 'Fornitore', width: 180, emphasis: true },
  { id: 'order_date', label: 'Data ordine', width: 110 },
  { id: 'expected_delivery_date', label: 'Consegna prev.', width: 120 },
  { id: 'merchandise_summary', label: 'Merce', width: 260 },
]

export const DASHBOARD_MOVEMENTS_TITLE = 'Ultimi movimenti cassa'

export const DASHBOARD_MOVEMENTS_COLUMNS = [
  { id: 'row', label: '#', numeric: true, width: 44, sticky: 'left' },
  { id: 'entry_date', label: 'Data', width: 140 },
  {
    id: 'type',
    label: 'Tipo',
    width: 88,
    tone: (row) => (row.type === 'entrata' ? 'workbook-cell-yes' : row.type === 'uscita' ? 'workbook-cell-alert' : ''),
  },
  { id: 'amount', label: 'Importo', numeric: true, width: 110 },
  { id: 'description', label: 'Descrizione', width: 220, emphasis: true },
  { id: 'conto', label: 'Conto', width: 120 },
]

export const DASHBOARD_DELIVERIES_TITLE = 'Consegne recenti'

export const DASHBOARD_DELIVERIES_COLUMNS = [
  { id: 'row', label: '#', numeric: true, width: 44, sticky: 'left' },
  { id: 'delivery_date', label: 'Data', width: 110 },
  { id: 'supplier_name', label: 'Fornitore', width: 180, emphasis: true },
  { id: 'product_description', label: 'Merce', width: 220 },
  { id: 'total', label: 'Tot.', numeric: true, width: 110 },
]

export const DASHBOARD_OVERDUE_INVOICES_TITLE = 'Fatture scadute (dettaglio)'

export const DASHBOARD_OVERDUE_INVOICES_COLUMNS = [
  { id: 'row', label: '#', numeric: true, width: 44, sticky: 'left' },
  { id: 'supplier_name', label: 'Fornitore', width: 180, emphasis: true },
  { id: 'invoice_number', label: 'N. fattura', width: 120 },
  { id: 'due_date', label: 'Scadenza', width: 110 },
  { id: 'residual', label: 'Residuo', numeric: true, width: 110 },
]

export const DASHBOARD_PRICE_INCREASE_TITLE = 'Fornitori con aumento prezzi'

export const DASHBOARD_PRICE_INCREASE_COLUMNS = [
  { id: 'row', label: '#', numeric: true, width: 44, sticky: 'left' },
  { id: 'supplier_name', label: 'Fornitore', width: 160, emphasis: true },
  { id: 'product_description', label: 'Prodotto', width: 200 },
  { id: 'previous_unit_price', label: 'Prima', numeric: true, width: 100 },
  { id: 'latest_unit_price', label: 'Ultima', numeric: true, width: 100 },
  { id: 'latest_date', label: 'Ultima consegna', width: 120 },
]

export const DASHBOARD_MONTHLY_FLOW_TITLE = 'Entrate vs uscite mese per mese'

export const DASHBOARD_MONTHLY_FLOW_COLUMNS = [
  { id: 'row', label: '#', numeric: true, width: 44, sticky: 'left' },
  { id: 'month_label', label: 'Mese', width: 120, emphasis: true },
  { id: 'entrate', label: 'Entrate', numeric: true, width: 110 },
  { id: 'uscite', label: 'Uscite', numeric: true, width: 110 },
  { id: 'saldo', label: 'Saldo', numeric: true, width: 110 },
]

export const DASHBOARD_BREAKDOWN_TITLE = 'Ripartizione costi'

export const DASHBOARD_BREAKDOWN_COLUMNS = [
  { id: 'row', label: '#', numeric: true, width: 44, sticky: 'left' },
  { id: 'label', label: 'Voce', width: 220, emphasis: true },
  { id: 'amount', label: 'Importo', numeric: true, width: 120 },
]

function formatEur(value) {
  if (value == null || value === '') return ''
  const n = Number(value)
  if (Number.isNaN(n)) return ''
  return n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatSignedEur(value, sign = '') {
  const formatted = formatEur(value)
  if (!formatted) return ''
  return `${sign}${formatted}`
}

function formatDateTime(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })
}

function formatDate(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString('it-IT')
}

function text(value) {
  if (value == null || value === '') return ''
  return String(value)
}

function movementTypeLabel(type) {
  if (type === 'entrata') return 'Entrata'
  if (type === 'uscita') return 'Uscita'
  return text(type)
}

export function dashboardPendingOrderCellValue(row, column, ctx = {}) {
  const { rowIndex = 0 } = ctx
  switch (column.id) {
    case 'row':
      return String(rowIndex + 1)
    case 'order_number':
      return row.sequence_number != null ? `#${row.sequence_number}` : `#${row.id}`
    case 'supplier_name':
      return text(row.supplier_name)
    case 'order_date':
      return formatDate(row.order_date)
    case 'expected_delivery_date':
      return formatDate(row.expected_delivery_date)
    case 'merchandise_summary':
      return text(row.merchandise_summary) || '—'
    default:
      return ''
  }
}

export function dashboardPendingOrdersTotalsLabel(columnId, count) {
  if (columnId === 'supplier_name') return `TOTALI (${count})`
  return ''
}

export function dashboardMovementCellValue(row, column, ctx = {}) {
  const { rowIndex = 0 } = ctx
  switch (column.id) {
    case 'row':
      return String(rowIndex + 1)
    case 'entry_date':
      return formatDateTime(row.entry_date)
    case 'type':
      return movementTypeLabel(row.type)
    case 'amount':
      return formatSignedEur(row.amount, row.type === 'entrata' ? '+' : row.type === 'uscita' ? '−' : '')
    case 'description':
      return text(row.description) || '—'
    case 'conto':
      return text(row.conto) || '—'
    default:
      return ''
  }
}

export function dashboardMovementsTotals(rows) {
  const list = Array.isArray(rows) ? rows : []
  let entrate = 0
  let uscite = 0
  for (const row of list) {
    const n = Number(row.amount) || 0
    if (row.type === 'entrata') entrate += n
    else if (row.type === 'uscita') uscite += n
  }
  return {
    count: list.length,
    entrate: entrate > 0 ? formatEur(entrate) : '',
    uscite: uscite > 0 ? formatEur(uscite) : '',
  }
}

export function dashboardMovementsTotalsLabel(columnId, totals) {
  if (columnId === 'description') return `TOTALI (${totals.count})`
  if (columnId === 'amount' && totals.entrate && totals.uscite) return `${totals.entrate} / ${totals.uscite}`
  if (columnId === 'amount') return totals.entrate || totals.uscite
  return ''
}

export function dashboardDeliveryCellValue(row, column, ctx = {}) {
  const { rowIndex = 0 } = ctx
  switch (column.id) {
    case 'row':
      return String(rowIndex + 1)
    case 'delivery_date':
      return formatDate(row.delivery_date)
    case 'supplier_name':
      return text(row.supplier_name)
    case 'product_description':
      return text(row.product_description) || '—'
    case 'total':
      return formatEur(row.total)
    default:
      return ''
  }
}

export function dashboardDeliveriesTotals(rows) {
  const list = Array.isArray(rows) ? rows : []
  const total = list.reduce((sum, row) => sum + (Number(row.total) || 0), 0)
  return {
    count: list.length,
    total: total > 0 ? formatEur(total) : '',
  }
}

export function dashboardDeliveriesTotalsLabel(columnId, totals) {
  if (columnId === 'supplier_name') return `TOTALI (${totals.count})`
  if (columnId === 'total') return totals.total
  return ''
}

export function dashboardOverdueInvoiceCellValue(row, column, ctx = {}) {
  const { rowIndex = 0 } = ctx
  switch (column.id) {
    case 'row':
      return String(rowIndex + 1)
    case 'supplier_name':
      return text(row.supplier_name)
    case 'invoice_number':
      return text(row.invoice_number)
    case 'due_date':
      return formatDate(row.due_date)
    case 'residual':
      return formatEur(row.residual)
    default:
      return ''
  }
}

export function dashboardOverdueInvoicesTotals(rows) {
  const list = Array.isArray(rows) ? rows : []
  const total = list.reduce((sum, row) => sum + (Number(row.residual) || 0), 0)
  return {
    count: list.length,
    residual: total > 0 ? formatEur(total) : '',
  }
}

export function dashboardOverdueInvoicesTotalsLabel(columnId, totals) {
  if (columnId === 'supplier_name') return `TOTALI (${totals.count})`
  if (columnId === 'residual') return totals.residual
  return ''
}

export function dashboardPriceIncreaseCellValue(row, column, ctx = {}) {
  const { rowIndex = 0 } = ctx
  switch (column.id) {
    case 'row':
      return String(rowIndex + 1)
    case 'supplier_name':
      return text(row.supplier_name)
    case 'product_description':
      return text(row.product_description)
    case 'previous_unit_price':
      return formatEur(row.previous_unit_price)
    case 'latest_unit_price':
      return formatEur(row.latest_unit_price)
    case 'latest_date':
      return formatDate(row.latest_date)
    default:
      return ''
  }
}

export function dashboardPriceIncreaseTotalsLabel(columnId, count) {
  if (columnId === 'supplier_name') return `TOTALI (${count})`
  return ''
}

export function dashboardMonthlyFlowCellValue(row, column, ctx = {}) {
  const { rowIndex = 0 } = ctx
  const entrate = Number(row.entrate) || 0
  const uscite = Number(row.uscite) || 0
  switch (column.id) {
    case 'row':
      return String(rowIndex + 1)
    case 'month_label':
      return text(row.month_label)
    case 'entrate':
      return entrate > 0 ? formatEur(entrate) : ''
    case 'uscite':
      return uscite > 0 ? formatEur(uscite) : ''
    case 'saldo':
      return formatEur(entrate - uscite)
    default:
      return ''
  }
}

export function dashboardMonthlyFlowTotals(rows) {
  const list = Array.isArray(rows) ? rows : []
  const entrate = list.reduce((sum, row) => sum + (Number(row.entrate) || 0), 0)
  const uscite = list.reduce((sum, row) => sum + (Number(row.uscite) || 0), 0)
  return {
    count: list.length,
    entrate: entrate > 0 ? formatEur(entrate) : '',
    uscite: uscite > 0 ? formatEur(uscite) : '',
    saldo: formatEur(entrate - uscite),
  }
}

export function dashboardMonthlyFlowTotalsLabel(columnId, totals) {
  if (columnId === 'month_label') return `TOTALI (${totals.count})`
  if (columnId === 'entrate') return totals.entrate
  if (columnId === 'uscite') return totals.uscite
  if (columnId === 'saldo') return totals.saldo
  return ''
}

export function dashboardBreakdownCellValue(row, column, ctx = {}) {
  const { rowIndex = 0 } = ctx
  switch (column.id) {
    case 'row':
      return String(rowIndex + 1)
    case 'label':
      return text(row.label)
    case 'amount':
      return formatEur(row.amount)
    default:
      return ''
  }
}

export function dashboardBreakdownTotals(rows) {
  const list = Array.isArray(rows) ? rows : []
  const total = list.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
  return {
    count: list.length,
    amount: total > 0 ? formatEur(total) : '',
  }
}

export function dashboardBreakdownTotalsLabel(columnId, totals) {
  if (columnId === 'label') return `TOTALI (${totals.count})`
  if (columnId === 'amount') return totals.amount
  return ''
}
