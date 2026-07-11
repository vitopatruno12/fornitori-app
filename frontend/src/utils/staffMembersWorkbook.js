export const STAFF_MEMBERS_WORKBOOK_TITLE = 'Elenco dipendenti'

export const STAFF_MEMBERS_COLUMNS = [
  { id: 'row', label: '#', numeric: true, width: 44, sticky: 'left' },
  { id: 'name', label: 'Nome (piano)', width: 180, emphasis: true },
  { id: 'email', label: 'Email', width: 200 },
  { id: 'phone', label: 'Telefono', width: 130 },
  { id: 'city', label: 'Città', width: 120 },
  { id: 'order', label: 'Ordine', numeric: true, width: 72 },
  { id: 'is_active', label: 'Attivo', width: 72 },
]

function text(value) {
  if (value == null || value === '') return ''
  return String(value)
}

function yesNo(value) {
  return value ? 'Sì' : 'No'
}

/**
 * @param {Record<string, unknown>} member
 * @param {{ id: string }} column
 * @param {{ rowIndex?: number }} ctx
 */
export function staffMemberCellValue(member, column, ctx = {}) {
  const { rowIndex = 0 } = ctx
  switch (column.id) {
    case 'row':
      return String(rowIndex + 1)
    case 'name':
      return text(member.name)
    case 'email':
      return text(member.email)
    case 'phone':
      return text(member.phone)
    case 'city':
      return text(member.city)
    case 'order':
      return String(rowIndex + 1)
    case 'is_active':
      return yesNo(member.is_active)
    default:
      return ''
  }
}

export function staffMembersTotalsLabel(columnId, count) {
  if (columnId === 'name') return `TOTALI (${count})`
  return ''
}
