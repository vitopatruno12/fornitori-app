/**
 * Colonne semplici: attributi in testata, righe sotto per l'inserimento.
 */

export const CARRIER_MAINTENANCE_WORKBOOK_TITLE = 'Scheda manutenzione mezzo'
export const CARRIER_FUEL_WORKBOOK_TITLE = 'Spese carburante mezzo'
export const CARRIER_OTHER_WORKBOOK_TITLE = 'Altre spese sostenute mezzo'

export const CARRIER_MAINTENANCE_COLUMNS = [
  { id: 'service_date', label: 'Data', width: 140, inputType: 'date' },
  { id: 'description', label: 'Descrizione manutenzione', width: 320, emphasis: true },
  { id: 'odometer_km', label: 'Km', numeric: true, width: 110, inputType: 'number', step: '1' },
]

export const CARRIER_FUEL_COLUMNS = [
  { id: 'expense_date', label: 'Data', width: 140, inputType: 'date' },
  { id: 'liters', label: 'Quantità (litri)', numeric: true, width: 140, inputType: 'number', step: '0.01' },
  { id: 'amount_eur', label: 'Importo €', numeric: true, width: 130, inputType: 'number', step: '0.01' },
]

export const CARRIER_OTHER_COLUMNS = [
  { id: 'expense_date', label: 'Data', width: 140, inputType: 'date' },
  { id: 'description', label: 'Descrizione', width: 320, emphasis: true },
  { id: 'amount_eur', label: 'Importo €', numeric: true, width: 130, inputType: 'number', step: '0.01' },
]

function formatAmount(value) {
  if (value == null || value === '') return ''
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  return n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatInteger(value) {
  if (value == null || value === '') return ''
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  return String(Math.round(n))
}

function text(value) {
  if (value == null || value === '') return ''
  return String(value)
}

export function carrierMaintenanceCellValue(row, column) {
  switch (column.id) {
    case 'service_date':
      return text(row.service_date)
    case 'description':
      return text(row.description)
    case 'odometer_km':
      return formatInteger(row.odometer_km)
    default:
      return ''
  }
}

export function carrierFuelCellValue(row, column) {
  switch (column.id) {
    case 'expense_date':
      return text(row.expense_date)
    case 'liters':
      return formatAmount(row.liters)
    case 'amount_eur':
      return formatAmount(row.amount_eur)
    default:
      return ''
  }
}

export function carrierOtherCellValue(row, column) {
  switch (column.id) {
    case 'expense_date':
      return text(row.expense_date)
    case 'description':
      return text(row.description)
    case 'amount_eur':
      return formatAmount(row.amount_eur)
    default:
      return ''
  }
}
