const CONTO_NON_FISCALE = 'NON_FISCALE'
const CONTO_POS = 'POS'
const CONTO_REFILL = 'REFILL'

export const PRIMA_NOTA_MOVEMENTS_WORKBOOK_TITLE = 'Movimenti cassa'

export const PRIMA_NOTA_MOVEMENTS_COLUMNS = [
  { id: 'row', label: '#', numeric: true, width: 44, sticky: 'left' },
  { id: 'entry_date', label: 'Data', width: 130 },
  { id: 'description', label: 'Operazioni', width: 260, emphasis: true },
  { id: 'entrata', label: 'Cassa entrata', numeric: true, width: 110 },
  { id: 'uscita', label: 'Cassa uscita', numeric: true, width: 110 },
  { id: 'fiscale', label: 'Fiscale', numeric: true, width: 100 },
  { id: 'non_fiscale', label: 'NC', numeric: true, width: 110 },
  { id: 'pos', label: 'POS', numeric: true, width: 90 },
  { id: 'refill', label: 'Refill', numeric: true, width: 90 },
  { id: 'incasso', label: 'Totale', numeric: true, width: 110, tone: (row) => movementIncassoTone(row) },
  { id: 'cassa_mattina', label: 'Saldo attuale cassa', numeric: true, width: 130 },
  { id: 'cassa_sera', label: 'Cassa finale', numeric: true, width: 110 },
  { id: 'note', label: 'Note', width: 180 },
]

function formatDate(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString('it-IT')
}

function formatTime(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
}

function formatAmount(value) {
  if (value == null) return ''
  const n = Number(value)
  if (Number.isNaN(n)) return ''
  return n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatAmountClean(value) {
  const n = Number(value || 0)
  if (!Number.isFinite(n) || Math.abs(n) < 0.005) return ''
  return formatAmount(n)
}

function isNonFiscaleEntry(entry) {
  return entry?.conto === CONTO_NON_FISCALE
}

function isPosEntry(entry) {
  return entry?.conto === CONTO_POS
}

function isRefillEntry(entry) {
  return entry?.conto === CONTO_REFILL
}

export function isExtraCassaMovement(entry) {
  return isPosEntry(entry) || isRefillEntry(entry)
}

function movementDescription(entry) {
  let text = String(entry.description || '').trim()
  if (entry.riferimento_documento) {
    text = text ? `${text} · ${entry.riferimento_documento}` : String(entry.riferimento_documento)
  }
  if (isNonFiscaleEntry(entry)) text = text ? `${text} [NC]` : '[NC]'
  else if (isPosEntry(entry)) text = text ? `${text} [POS]` : '[POS]'
  else if (isRefillEntry(entry)) text = text ? `${text} [Refill]` : '[Refill]'
  return text
}

export function movementIncassoTone(entry) {
  if (isExtraCassaMovement(entry)) return 'workbook-cell-muted'
  if (entry?.type === 'entrata') return 'workbook-cell-yes'
  if (entry?.type === 'uscita') return 'workbook-cell-alert'
  return ''
}

/**
 * @param {Record<string, unknown>} entry
 * @param {{ id: string }} column
 * @param {{ rowIndex?: number }} ctx
 */
export function primaNotaMovementCellValue(entry, column, ctx = {}) {
  const { rowIndex = 0 } = ctx
  switch (column.id) {
    case 'row':
      return String(rowIndex + 1)
    case 'entry_date': {
      const date = formatDate(entry.entry_date)
      const time = formatTime(entry.entry_date)
      return time ? `${date} ${time}` : date
    }
    case 'description':
      return movementDescription(entry)
    case 'entrata':
      return entry.entrata > 0 ? formatAmount(entry.entrata) : ''
    case 'uscita':
      return entry.uscita > 0 ? formatAmount(entry.uscita) : ''
    case 'fiscale':
      return entry.affectsSaldo ? formatAmountClean(entry.totaleMovimento) : ''
    case 'non_fiscale':
      return formatAmountClean(entry.nonFiscale)
    case 'pos':
      return formatAmountClean(entry.pos)
    case 'refill':
      return formatAmountClean(entry.refill)
    case 'incasso':
      return formatAmount(entry.incasso)
    case 'cassa_mattina':
      return formatAmount(entry.cassaMattina)
    case 'cassa_sera':
      return formatAmount(entry.cassaSera)
    case 'note':
      return String(entry.note || '')
    default:
      return ''
  }
}

export function primaNotaMovementTotalsLabel(columnId, totals) {
  if (columnId === 'description') return `TOTALI (${totals.count})`
  if (columnId === 'entrata') return formatAmount(totals.entrata)
  if (columnId === 'uscita') return formatAmount(totals.uscita)
  if (columnId === 'fiscale') return formatAmount(totals.fiscale)
  if (columnId === 'non_fiscale') return formatAmount(totals.nonFiscale)
  if (columnId === 'pos') return formatAmount(totals.pos)
  if (columnId === 'refill') return formatAmount(totals.refill)
  if (columnId === 'incasso') return formatAmount(totals.incasso)
  return ''
}
