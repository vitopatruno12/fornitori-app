export const WAREHOUSE_MOVEMENTS_WORKBOOK_TITLE = 'Movimenti magazzino'

export const WAREHOUSE_MOVEMENTS_COLUMNS = [
  { id: 'row', label: '#', numeric: true, width: 44, sticky: 'left' },
  { id: 'movement_at', label: 'Data e ora', width: 140 },
  { id: 'movement_type', label: 'Tipo', width: 88 },
  { id: 'location', label: 'Sede', width: 140 },
  { id: 'product_description', label: 'Merce', width: 220, emphasis: true },
  { id: 'pieces', label: 'Pz', numeric: true, width: 72 },
  { id: 'weight_kg', label: 'Kg', numeric: true, width: 80 },
  { id: 'volume_liters', label: 'Litri', numeric: true, width: 80 },
  { id: 'merchandise_condition', label: 'Condizione', width: 120 },
  { id: 'operator_name', label: 'Operatore', width: 130 },
  { id: 'signature', label: 'Firma', width: 130 },
  { id: 'note', label: 'Note', width: 180 },
]

function formatDateTime(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatQty(value) {
  if (value === '' || value == null) return ''
  const n = Number(value)
  if (Number.isNaN(n)) return String(value)
  if (Number.isInteger(n)) return String(n)
  return n.toLocaleString('it-IT', { maximumFractionDigits: 3 })
}

function text(value) {
  if (value == null || value === '') return ''
  return String(value)
}

export function warehouseMovementTypeLabel(movementType) {
  return movementType === 'in' ? 'Entrata' : movementType === 'out' ? 'Uscita' : text(movementType)
}

export function warehouseMovementTypeTone(movementType) {
  if (movementType === 'in') return 'workbook-cell-yes'
  if (movementType === 'out') return 'workbook-cell-alert'
  return ''
}

/**
 * @param {Record<string, unknown>} row
 * @param {{ id: string }} column
 * @param {{ rowIndex?: number }} ctx
 */
export function warehouseMovementCellValue(row, column, ctx = {}) {
  const { rowIndex = 0 } = ctx
  switch (column.id) {
    case 'row':
      return String(rowIndex + 1)
    case 'movement_at':
      return formatDateTime(row.movement_at)
    case 'movement_type':
      return warehouseMovementTypeLabel(row.movement_type)
    case 'location':
      return text(row.location) || '—'
    case 'product_description':
      return text(row.product_description)
    case 'pieces':
      return formatQty(row.pieces)
    case 'weight_kg':
      return formatQty(row.weight_kg)
    case 'volume_liters':
      return formatQty(row.volume_liters)
    case 'merchandise_condition':
      return text(row.merchandise_condition) || '—'
    case 'operator_name':
      return text(row.operator_name)
    case 'signature':
      return text(row.signature)
    case 'note':
      return text(row.note) || '—'
    default:
      return ''
  }
}

export function warehouseMovementsTotals(movements) {
  const list = Array.isArray(movements) ? movements : []
  const sum = (key) => list.reduce((acc, row) => acc + (Number(row[key]) || 0), 0)
  const sumQty = (key) => {
    const n = sum(key)
    return n > 0 ? formatQty(n) : ''
  }
  return {
    count: list.length,
    pieces: sumQty('pieces'),
    weight_kg: sumQty('weight_kg'),
    volume_liters: sumQty('volume_liters'),
  }
}

export function warehouseMovementsTotalsLabel(columnId, totals) {
  if (columnId === 'product_description') return `TOTALI (${totals.count})`
  if (columnId === 'pieces') return totals.pieces
  if (columnId === 'weight_kg') return totals.weight_kg
  if (columnId === 'volume_liters') return totals.volume_liters
  return ''
}
