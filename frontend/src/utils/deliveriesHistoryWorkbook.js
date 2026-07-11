export const DELIVERIES_HISTORY_WORKBOOK_TITLE = 'Storico consegne'

export const DELIVERIES_HISTORY_WORKBOOK_COLUMNS = [
  { id: 'row', label: '#', numeric: true, width: 44, sticky: 'left' },
  { id: 'delivery_date', label: 'Data', width: 110 },
  { id: 'ddt_number', label: 'DDT', width: 100 },
  { id: 'supplier_name', label: 'Fornitore', width: 180, emphasis: true },
  { id: 'product_description', label: 'Prodotto', width: 200 },
  { id: 'unloading_signed_by', label: 'Firma scarico', width: 130 },
  { id: 'weight_kg', label: 'Peso (kg)', numeric: true, width: 90 },
  { id: 'pieces', label: 'Pezzi', numeric: true, width: 72 },
  { id: 'quantity', label: 'Quantità', width: 120 },
  { id: 'unit_price', label: 'Prezzo unit.', numeric: true, width: 110 },
  { id: 'list_unit_price', label: 'Listino', numeric: true, width: 100 },
  { id: 'price_diff_vs_list', label: 'Diff.', numeric: true, width: 90 },
  { id: 'imponibile', label: 'Imponibile', numeric: true, width: 110 },
  { id: 'vat_percent', label: 'IVA %', numeric: true, width: 72 },
  { id: 'vat_amount', label: 'IVA', numeric: true, width: 90 },
  { id: 'total', label: 'Totale', numeric: true, width: 110 },
  { id: 'destination', label: 'Destinazione', width: 150 },
  { id: 'document_note', label: 'Note doc.', width: 180 },
  { id: 'anomaly_note', label: 'Anomalie', width: 160 },
]

function formatDate(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString('it-IT')
}

function formatAmount(value) {
  if (value == null || value === '') return ''
  const n = Number(value)
  if (Number.isNaN(n)) return ''
  return n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function text(value) {
  if (value == null || value === '') return ''
  return String(value)
}

export function splitDeliveryNote(note) {
  const raw = String(note || '').trim()
  if (!raw) return { destination: '', documentNote: '' }
  const m = raw.match(/^Destinazione\s+scarico:\s*(.+)$/im)
  const destination = m ? String(m[1] || '').trim() : ''
  if (!destination) return { destination: '', documentNote: raw }
  const lines = raw.split(/\r?\n/)
  let skipping = true
  const rest = []
  for (const ln of lines) {
    const t = ln.trim()
    if (skipping && /^Destinazione\s+scarico:/i.test(t)) continue
    if (skipping && t === '') continue
    skipping = false
    rest.push(ln)
  }
  return { destination, documentNote: rest.join('\n').trim() }
}

function qtyCell(d) {
  const w = d.weight_kg != null && Number(d.weight_kg) > 0
  const p = d.pieces != null && Number(d.pieces) > 0
  if (w && p) return `${Number(d.weight_kg)} kg + ${d.pieces} pz`
  if (w) return `${Number(d.weight_kg)} kg`
  if (p) return `${d.pieces} pz`
  return ''
}

function formatDiff(value) {
  if (value == null || value === '') return ''
  const n = Number(value)
  if (Number.isNaN(n)) return ''
  const prefix = n > 0 ? '+' : ''
  return `${prefix}${formatAmount(n)}`
}

/**
 * @param {Record<string, unknown>} delivery
 * @param {{ id: string }} column
 * @param {{ rowIndex?: number }} ctx
 */
export function deliveryHistoryWorkbookCellValue(delivery, column, ctx = {}) {
  const { rowIndex = 0 } = ctx
  const parsed = splitDeliveryNote(delivery.note)
  switch (column.id) {
    case 'row':
      return String(rowIndex + 1)
    case 'delivery_date':
      return formatDate(delivery.delivery_date)
    case 'ddt_number':
      return text(delivery.ddt_number)
    case 'supplier_name':
      return text(delivery.supplier_name || delivery.supplier_id)
    case 'product_description':
      return text(delivery.product_description)
    case 'unloading_signed_by':
      return text(delivery.unloading_signed_by)
    case 'weight_kg':
      return delivery.weight_kg != null && Number(delivery.weight_kg) > 0 ? formatAmount(delivery.weight_kg) : ''
    case 'pieces':
      return delivery.pieces != null && Number(delivery.pieces) > 0 ? String(delivery.pieces) : ''
    case 'quantity':
      return qtyCell(delivery)
    case 'unit_price':
      return formatAmount(delivery.unit_price)
    case 'list_unit_price':
      return delivery.list_unit_price != null ? formatAmount(delivery.list_unit_price) : ''
    case 'price_diff_vs_list':
      return formatDiff(delivery.price_diff_vs_list)
    case 'imponibile':
      return formatAmount(delivery.imponibile)
    case 'vat_percent':
      return delivery.vat_percent != null ? formatAmount(delivery.vat_percent) : ''
    case 'vat_amount':
      return formatAmount(delivery.vat_amount)
    case 'total':
      return formatAmount(delivery.total)
    case 'destination':
      return parsed.destination
    case 'document_note':
      return parsed.documentNote
    case 'anomaly_note':
      return text(delivery.anomaly_note)
    default:
      return ''
  }
}

export function deliveryHistoryWorkbookTotals(deliveries) {
  const list = Array.isArray(deliveries) ? deliveries : []
  const sum = (key) => list.reduce((acc, d) => acc + (Number(d[key]) || 0), 0)
  return {
    count: list.length,
    imponibile: formatAmount(sum('imponibile')),
    vat_amount: formatAmount(sum('vat_amount')),
    total: formatAmount(sum('total')),
  }
}

export function deliveryHistoryWorkbookTotalsLabel(columnId, totals) {
  if (columnId === 'supplier_name') return `TOTALI (${totals.count})`
  if (columnId === 'imponibile') return totals.imponibile
  if (columnId === 'vat_amount') return totals.vat_amount
  if (columnId === 'total') return totals.total
  return ''
}

export function deliveryHistoryDiffTone(delivery) {
  const diff = delivery?.price_diff_vs_list
  if (diff == null || diff === '') return ''
  const n = Number(diff)
  if (Number.isNaN(n) || n === 0) return ''
  return n > 0 ? 'workbook-cell-alert' : 'workbook-cell-yes'
}
