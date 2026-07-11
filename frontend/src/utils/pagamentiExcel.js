import * as XLSX from 'xlsx'

function sanitizeSheetName(name) {
  const cleaned = String(name || 'Foglio')
    .replace(/[\\/*?:[\]]/g, ' ')
    .trim()
  return (cleaned || 'Foglio').slice(0, 31)
}

function sanitizeFilename(name) {
  return (
    String(name || 'pagamenti_fornitori')
      .replace(/[<>:"/\\|?*]+/g, '_')
      .trim() || 'pagamenti_fornitori'
  )
}

function normalizeExportCell(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number') return value
  const text = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const date = new Date(text)
    if (!Number.isNaN(date.getTime())) return date
  }
  return text
}

function normalizeImportCell(value) {
  if (value == null || value === '') return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString()
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return value ? 'VERO' : 'FALSO'
  const text = String(value).trim()
  return text || null
}

function rowsForExport(rows) {
  return (rows || []).map((row) => {
    const cells = Array.isArray(row) ? row : []
    const maxLen = Math.max(cells.length, 1)
    return Array.from({ length: maxLen }, (_, index) => normalizeExportCell(cells[index]))
  })
}

function rowsFromImport(rows) {
  return (rows || []).map((row) => {
    if (!Array.isArray(row)) return []
    return row.map((cell) => normalizeImportCell(cell))
  })
}

export function downloadWorkbookAsExcel(workbook) {
  const book = XLSX.utils.book_new()
  for (const sheet of workbook.sheets || []) {
    const worksheet = XLSX.utils.aoa_to_sheet(rowsForExport(sheet.rows))
    XLSX.utils.book_append_sheet(book, worksheet, sanitizeSheetName(sheet.name))
  }
  const filename = `${sanitizeFilename(workbook.title)}.xlsx`
  XLSX.writeFile(book, filename)
}

export async function parseExcelFileToWorkbook(file) {
  if (!file) throw new Error('Nessun file selezionato')
  const lower = String(file.name || '').toLowerCase()
  if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls')) {
    throw new Error('Seleziona un file Excel (.xlsx o .xls)')
  }
  const buffer = await file.arrayBuffer()
  const parsed = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheets = parsed.SheetNames.map((name) => {
    const worksheet = parsed.Sheets[name]
    const rows = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: null,
      raw: true,
    })
    return {
      name: String(name).trim() || 'Foglio',
      rows: rowsFromImport(rows),
    }
  })
  if (!sheets.length) throw new Error('Il file Excel non contiene fogli')
  const title = String(file.name || '')
    .replace(/\.(xlsx|xls)$/i, '')
    .trim()
  return {
    title: title || 'FILE FORNITORI',
    sheets,
  }
}
