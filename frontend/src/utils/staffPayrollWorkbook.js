export const STAFF_PAYROLL_WORKBOOK_TITLE = 'Ore lavorate e costo'

export const STAFF_PAYROLL_COLUMNS = [
  { id: 'row', label: '#', numeric: true, width: 44, sticky: 'left' },
  { id: 'name', label: 'Dipendente', width: 180, emphasis: true },
  { id: 'hours', label: 'Ore lavorate', numeric: true, width: 110, editable: true },
  { id: 'hourly_rate', label: 'Prezzo / ora (€)', numeric: true, width: 120, editable: true },
  { id: 'importo', label: 'Importo', numeric: true, width: 110 },
]

function formatHours(h) {
  if (h == null || !Number.isFinite(h) || h <= 0) return ''
  if (Math.abs(h - Math.round(h)) < 0.001) return String(Math.round(h))
  return h.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function formatEur(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  return n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function text(value) {
  if (value == null || value === '') return ''
  return String(value)
}

/**
 * @param {Record<string, unknown>} row
 * @param {{ id: string }} column
 * @param {{ rowIndex?: number, importo?: number | null }} ctx
 */
export function staffPayrollCellValue(row, column, ctx = {}) {
  const { rowIndex = 0, importo = null } = ctx
  const member = row.member || row
  switch (column.id) {
    case 'row':
      return String(rowIndex + 1)
    case 'name':
      return text(member.name)
    case 'hours':
      return formatHours(row.ore ?? row.computedOre)
    case 'hourly_rate':
      return member.hourly_rate != null ? formatEur(member.hourly_rate) : ''
    case 'importo':
      return importo != null && Number.isFinite(Number(importo)) ? formatEur(importo) : ''
    default:
      return ''
  }
}

export function staffPayrollTotals(rows, importoMap = {}) {
  const list = Array.isArray(rows) ? rows : []
  const totalImporto = list.reduce((sum, row) => {
    const id = row.member?.id
    const v = id != null ? importoMap[id] : undefined
    return sum + (Number(v) || 0)
  }, 0)
  const totalHours = list.reduce((sum, row) => sum + (Number(row.ore ?? row.computedOre) || 0), 0)
  return {
    count: list.length,
    hours: formatHours(totalHours),
    importo: totalImporto > 0 ? formatEur(totalImporto) : '',
  }
}

export function staffPayrollTotalsLabel(columnId, totals) {
  if (columnId === 'name') return `TOTALI (${totals.count})`
  if (columnId === 'hours') return totals.hours
  if (columnId === 'importo') return totals.importo
  return ''
}
