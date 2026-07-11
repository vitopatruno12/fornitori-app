export const VNE_MACHINES_WORKBOOK_TITLE = 'Stato macchine VNE'

export const VNE_MACHINES_COLUMNS = [
  { id: 'row', label: '#', numeric: true, width: 5, sticky: 'left', fluid: true },
  { id: 'machine_name', label: 'Nome macchina', width: 14, emphasis: true, fluid: true },
  { id: 'model_code', label: 'Modello', width: 12, mono: true, fluid: true },
  { id: 'sala', label: 'Sala', width: 12, fluid: true },
  { id: 'city', label: 'Città', width: 10, fluid: true },
  { id: 'region', label: 'Regione', width: 10, fluid: true },
  { id: 'alarm', label: 'Allarme', width: 14, fluid: true },
  { id: 'levels', label: 'Livelli', width: 18, multiline: true, fluid: true },
  { id: 'online', label: 'Online', width: 9, fluid: true },
]

function text(value) {
  if (value == null || value === '') return '—'
  return String(value)
}

/**
 * @param {Record<string, unknown>} row
 * @param {{ id: string }} column
 * @param {{ rowIndex?: number }} ctx
 */
export function vneMachineCellValue(row, column, ctx = {}) {
  const { rowIndex = 0 } = ctx
  switch (column.id) {
    case 'row':
      return String(rowIndex + 1)
    case 'machine_name':
      return text(row.machine_name)
    case 'model_code':
      return text(row.model_code)
    case 'sala':
      return text(row.sala)
    case 'city':
      return text(row.city)
    case 'region':
      return text(row.region)
    case 'alarm':
      return text(row.alarm)
    case 'levels':
      return text(row.levels)
    case 'online':
      return text(row.online)
    default:
      return ''
  }
}

export function vneMachineCellTone(row, column) {
  if (column.id === 'online') {
    const value = String(row.online || '').toLowerCase()
    if (value === 'online') return 'workbook-cell-yes'
    if (value === 'offline') return 'workbook-cell-alert'
  }
  if (column.id === 'alarm') {
    const value = String(row.alarm || '').toLowerCase()
    if (value === 'ok') return 'workbook-cell-yes'
    if (value && value !== '—') return 'workbook-cell-warning'
  }
  return ''
}

export function vneMachinesTotalsLabel(columnId, rows) {
  const list = Array.isArray(rows) ? rows : []
  if (columnId === 'machine_name') return `TOTALI (${list.length})`
  if (columnId === 'online') {
    const online = list.filter((row) => String(row.online || '').toLowerCase() === 'online').length
    return `${online} online`
  }
  return ''
}
