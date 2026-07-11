export const OPERATOR_LINKS_COLUMNS = [
  { id: 'row', label: '#', numeric: true, width: 44, sticky: 'left' },
  { id: 'section', label: 'Sezione', width: 150, emphasis: true },
  { id: 'label', label: 'Link', width: 180, emphasis: true },
  { id: 'description', label: 'A cosa serve', width: 420 },
  { id: 'url', label: 'Indirizzo', width: 360, mono: true },
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
    case 'section':
      return text(row.section)
    case 'label':
      return text(row.label)
    case 'description':
      return text(row.description)
    case 'url':
      return text(row.url)
    default:
      return ''
  }
}
