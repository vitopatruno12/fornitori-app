export const OPERATOR_LINKS_COLUMNS = [
  { id: 'row', label: '#', numeric: true, width: 44, sticky: 'left' },
  { id: 'role', label: 'Ruolo', width: 170, emphasis: true },
  { id: 'sede', label: 'Sede', width: 200, emphasis: true },
  { id: 'description', label: 'A cosa serve', width: 380 },
  { id: 'url', label: 'Indirizzo', width: 340, mono: true },
]

function text(value) {
  if (value == null || value === '') return ''
  return String(value)
}

/**
 * @param {Record<string, unknown>} row
 * @param {{ id: string, mono?: boolean }} column
 * @param {{ rowIndex?: number }} ctx
 */
export function operatorLinkCellValue(row, column, ctx = {}) {
  const { rowIndex = 0 } = ctx
  switch (column.id) {
    case 'row':
      return String(rowIndex + 1)
    case 'role':
      return text(row.role)
    case 'sede':
      return text(row.sede)
    case 'description':
      return text(row.description)
    case 'url':
      return text(row.url)
    default:
      return ''
  }
}
