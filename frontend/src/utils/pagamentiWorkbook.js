export const MONTHLY_HEADERS = [
  'Tipo documento',
  'Numero fattura / Documento',
  'Data emissione',
  'Identificativo fornitore',
  'Denominazione',
  'Imponibile',
  'Imposta ',
  'PAGARE (AVERE)',
  ' PAGATO (DARE)',
  'TOTALE FORNITORE',
  'DATA PAGAMENTO',
  'acquisto attrezzature',
]

const MONTH_ORDER = [
  'GENNAIO',
  'FEBBRAIO',
  'MARZO',
  'APRILE',
  'MAGGIO',
  'GIUGNO',
  'LUGLIO',
  'AGOSTO',
  'SETTEMBRE',
  'OTTOBRE',
  'NOVEMBRE',
  'DICEMBRE',
]

export const SPECIAL_SHEETS = new Set(['TOTALI', 'DELEGHE F24', 'VERSAMENTO CONTANTI'])

/** Fogli del file Excel di partenza (non eliminabili). */
export const DEFAULT_WORKBOOK_SHEET_NAMES = new Set([
  'GENNAIO',
  'FEBBRAIO',
  'MARZO',
  'APRILE',
  'MAGGIO',
  'GIUGNO',
  'TOTALI',
  'DELEGHE F24',
  'VERSAMENTO CONTANTI',
])

/** Mesi italiani noti (per suggerire nomi nuovi fogli). */
export const MONTHLY_SHEETS = new Set(MONTH_ORDER)

export function round2(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || Math.abs(n) < 0.0005) return null
  return Math.round(n * 100) / 100
}

export function num(value) {
  if (value == null || value === '') return 0
  if (typeof value === 'number') return value
  const parsed = Number(String(value).replace(/\./g, '').replace(',', '.'))
  return Number.isNaN(parsed) ? 0 : parsed
}

export function padRow(row, len = 12) {
  const out = [...(row || [])]
  while (out.length < len) out.push(null)
  return out
}

export function rowHasContent(row) {
  return (row || []).some((cell) => cell != null && cell !== '')
}

export function isSubtotalRow(row) {
  const cells = padRow(row)
  const hasTotal = cells[9] != null && cells[9] !== ''
  const hasInvoiceData = cells.slice(0, 9).some((cell) => cell != null && cell !== '')
  return hasTotal && !hasInvoiceData
}

export function isMonthlyFooterRow(row) {
  return padRow(row)[6] === 'TOTALE'
}

export function isMonthlySheet(sheetName) {
  return !SPECIAL_SHEETS.has(sheetName)
}

export function isSpecialSheet(sheetName) {
  return SPECIAL_SHEETS.has(sheetName)
}

export function stripExcelQuotes(value) {
  const text = String(value ?? '').trim()
  if (text.startsWith("'") && text.endsWith("'")) return text.slice(1, -1)
  return text
}

export function formatCellDisplay(value) {
  if (value == null || value === '') return ''
  if (typeof value === 'number') {
    if (Number.isInteger(value)) return value.toLocaleString('it-IT')
    return value.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  const text = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) {
    const date = new Date(text)
    if (!Number.isNaN(date.getTime())) return date.toLocaleDateString('it-IT')
  }
  return stripExcelQuotes(text)
}

function parseDateInput(raw) {
  const text = String(raw || '').trim()
  if (!text) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) {
    const date = new Date(text.length === 10 ? `${text}T12:00:00` : text)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  const match = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)
  if (match) {
    const day = Number(match[1])
    const month = Number(match[2])
    let year = Number(match[3])
    if (year < 100) year += 2000
    const date = new Date(year, month - 1, day, 12)
    if (!Number.isNaN(date.getTime())) return date.toISOString()
  }
  return text
}

export function parseCellInput(raw, colIndex, sheetName) {
  const text = String(raw ?? '').trim()
  if (!text) return null
  if (isNumericColumn(colIndex, sheetName)) {
    const parsed = num(text)
    return parsed === 0 && text !== '0' && text !== '0,00' ? text : round2(parsed)
  }
  if (isDateColumn(colIndex, sheetName)) return parseDateInput(text)
  return text
}

export function isNumericColumn(colIndex, sheetName) {
  if (sheetName === 'TOTALI') return colIndex >= 1 && colIndex <= 8
  if (sheetName === 'DELEGHE F24') return colIndex >= 2 && colIndex <= 4
  if (sheetName === 'VERSAMENTO CONTANTI') return colIndex === 2
  return colIndex >= 5 && colIndex <= 11
}

export function isDateColumn(colIndex, sheetName) {
  if (sheetName === 'DELEGHE F24') return colIndex === 1
  if (sheetName === 'VERSAMENTO CONTANTI') return colIndex === 1
  if (isMonthlySheet(sheetName)) return colIndex === 2 || colIndex === 10
  return false
}

export function classifyRow(row, rowIndex, sheetName) {
  if (!rowHasContent(row)) return 'empty'
  if (sheetName === 'TOTALI' && rowIndex === 0) return 'header'
  if (sheetName === 'DELEGHE F24') {
    if (rowIndex === 1) return 'title'
    if (rowIndex === 3) return 'header'
    if (rowIndex >= 4 && rowHasContent(row)) return 'data'
    return 'empty'
  }
  if (sheetName === 'VERSAMENTO CONTANTI') {
    if (rowIndex === 3) return 'header'
    if (String(row[0] || '').toUpperCase() === 'TOTALE') return 'totals'
    if (rowIndex >= 4 && rowHasContent(row)) return 'data'
    return 'empty'
  }
  if (rowIndex === 0) return 'header'
  if (isMonthlyFooterRow(row)) return 'totals'
  if (isSubtotalRow(row)) return 'subtotal'
  return 'data'
}

export function sheetColumnCount(sheet) {
  const max = Math.max(...sheet.rows.map((row) => row.length), 0)
  if (sheet.name === 'TOTALI') return Math.max(max, 9)
  if (sheet.name === 'DELEGHE F24') return Math.max(max, 5)
  if (sheet.name === 'VERSAMENTO CONTANTI') return Math.max(max, 3)
  return Math.max(max, MONTHLY_HEADERS.length)
}

export function minSheetColumnCount(sheetName) {
  if (sheetName === 'TOTALI') return 9
  if (sheetName === 'DELEGHE F24') return 5
  if (sheetName === 'VERSAMENTO CONTANTI') return 3
  return MONTHLY_HEADERS.length
}

export function canDeleteWorkbookColumn(sheet, colIndex = null) {
  if (!sheet) return false
  const count = sheetColumnCount(sheet)
  if (count <= minSheetColumnCount(sheet.name)) return false
  const target = colIndex == null ? count - 1 : colIndex
  return target === count - 1 && target >= 0
}

export function removeWorkbookColumn(workbook, sheetName, colIndex = null) {
  const sheet = (workbook.sheets || []).find((item) => item.name === sheetName)
  if (!sheet) throw new Error('Foglio non trovato')
  const count = sheetColumnCount(sheet)
  const index = colIndex == null ? count - 1 : colIndex
  if (!canDeleteWorkbookColumn(sheet, index)) {
    throw new Error('Puoi eliminare solo l\'ultima colonna del foglio, fino alla struttura minima.')
  }
  const sheets = (workbook.sheets || []).map((item) => {
    if (item.name !== sheetName) return item
    const rows = item.rows.map((row) => {
      const copy = [...padRow(row, count)]
      copy.splice(index, 1)
      return copy
    })
    return { ...item, rows }
  })
  const highlights = normalizeWorkbookHighlights(workbook.highlights)
  const sheetHl = highlights[sheetName]
  if (sheetHl) {
    highlights[sheetName] = shiftHighlightsAfterColumnDelete(sheetHl, index)
    if (isEmptySheetHighlights(highlights[sheetName])) delete highlights[sheetName]
  }
  return recalculateWorkbook({ ...workbook, sheets, highlights })
}

export const PAGAMENTI_HIGHLIGHT_COLORS = [
  { id: 'green', label: 'Verde', className: 'pagamenti-hl-green' },
  { id: 'red', label: 'Rosso', className: 'pagamenti-hl-red' },
  { id: 'yellow', label: 'Giallo', className: 'pagamenti-hl-yellow' },
  { id: 'blue', label: 'Blu', className: 'pagamenti-hl-blue' },
]

export function normalizeWorkbookHighlights(highlights) {
  if (!highlights || typeof highlights !== 'object') return {}
  return { ...highlights }
}

function isEmptySheetHighlights(sheetHl) {
  if (!sheetHl) return true
  return (
    !Object.keys(sheetHl.cells || {}).length &&
    !Object.keys(sheetHl.rows || {}).length &&
    !Object.keys(sheetHl.cols || {}).length
  )
}

function shiftHighlightsAfterColumnDelete(sheetHl, deletedColIndex) {
  const cells = {}
  Object.entries(sheetHl.cells || {}).forEach(([key, color]) => {
    const [row, col] = key.split(':').map(Number)
    if (col === deletedColIndex) return
    if (col > deletedColIndex) cells[`${row}:${col - 1}`] = color
    else cells[key] = color
  })
  const cols = {}
  Object.entries(sheetHl.cols || {}).forEach(([colKey, color]) => {
    const col = Number(colKey)
    if (col === deletedColIndex) return
    if (col > deletedColIndex) cols[String(col - 1)] = color
    else cols[colKey] = color
  })
  return { cells, rows: { ...(sheetHl.rows || {}) }, cols }
}

export function getSheetHighlights(workbook, sheetName) {
  const sheet = normalizeWorkbookHighlights(workbook.highlights)[sheetName]
  if (!sheet) return { cells: {}, rows: {}, cols: {} }
  return {
    cells: { ...(sheet.cells || {}) },
    rows: { ...(sheet.rows || {}) },
    cols: { ...(sheet.cols || {}) },
  }
}

export function resolveHighlightClass(highlights, sheetRowIndex, colIndex) {
  const cellKey = `${sheetRowIndex}:${colIndex}`
  const rowKey = String(sheetRowIndex)
  const colKey = String(colIndex)
  const color = highlights.cells[cellKey] || highlights.rows[rowKey] || highlights.cols[colKey]
  if (!color) return ''
  return PAGAMENTI_HIGHLIGHT_COLORS.find((item) => item.id === color)?.className || ''
}

export function applyWorkbookHighlight(workbook, sheetName, scope, sheetRowIndex, colIndex, color) {
  const highlights = normalizeWorkbookHighlights(workbook.highlights)
  const sheetHl = getSheetHighlights(workbook, sheetName)
  const cellKey = `${sheetRowIndex}:${colIndex}`
  const rowKey = String(sheetRowIndex)
  const colKey = String(colIndex)

  if (!color) {
    if (scope === 'cell') delete sheetHl.cells[cellKey]
    else if (scope === 'row') delete sheetHl.rows[rowKey]
    else if (scope === 'col') delete sheetHl.cols[colKey]
  } else if (scope === 'cell') {
    sheetHl.cells[cellKey] = color
  } else if (scope === 'row') {
    sheetHl.rows[rowKey] = color
  } else if (scope === 'col') {
    sheetHl.cols[colKey] = color
  }

  if (isEmptySheetHighlights(sheetHl)) delete highlights[sheetName]
  else highlights[sheetName] = sheetHl

  return { ...workbook, highlights }
}

export function sheetHeaders(sheet) {
  if (sheet.name === 'TOTALI') return sheet.rows[0] || []
  if (sheet.name === 'DELEGHE F24') return sheet.rows[3] || []
  if (sheet.name === 'VERSAMENTO CONTANTI') return sheet.rows[3] || []
  return MONTHLY_HEADERS
}

export function bodyRowOffset(sheetName) {
  if (sheetName === 'TOTALI') return 1
  if (sheetName === 'DELEGHE F24' || sheetName === 'VERSAMENTO CONTANTI') return 4
  return 1
}

function isDataInvoiceRow(row, rowIndex) {
  if (rowIndex === 0) return false
  if (!rowHasContent(row)) return false
  if (isSubtotalRow(row) || isMonthlyFooterRow(row)) return false
  return true
}

export function recalculateMonthlySheet(rows) {
  const out = rows.map((row) => padRow(row))

  for (let i = 0; i < out.length; i += 1) {
    if (!isSubtotalRow(out[i])) continue
    let sumH = 0
    let sumI = 0
    let blockHasH = false
    for (let j = i - 1; j >= 1; j -= 1) {
      if (isSubtotalRow(out[j]) || isMonthlyFooterRow(out[j])) break
      if (!isDataInvoiceRow(out[j], j)) continue
      const h = num(out[j][7])
      const invoiceI = num(out[j][8])
      if (h) blockHasH = true
      sumH += h
      sumI += invoiceI
    }
    out[i][9] = blockHasH ? round2(sumH + sumI) : round2(sumI)
  }

  const footerIndex = out.findIndex(isMonthlyFooterRow)
  if (footerIndex >= 0) {
    let sumH = 0
    let sumI = 0
    let sumL = 0
    for (let i = 1; i < footerIndex; i += 1) {
      if (isSubtotalRow(out[i]) || !rowHasContent(out[i])) continue
      sumH += num(out[i][7])
      sumI += num(out[i][8])
      sumL += num(out[i][11])
    }
    out[footerIndex][7] = round2(sumH)
    out[footerIndex][8] = round2(sumI)
    out[footerIndex][11] = round2(sumL)
  }

  return out
}

function getMonthlyFooterTotals(rows) {
  const footer = rows.find(isMonthlyFooterRow)
  if (!footer) return { pagare: null, pagato: null }
  return { pagare: footer[7], pagato: footer[8] }
}

export function recalculateDelegheSheet(rows) {
  const out = rows.map((row) => padRow(row, 5))
  for (let i = 4; i < out.length; i += 1) {
    if (!rowHasContent(out[i])) continue
    const total = num(out[i][2])
    const paid = num(out[i][3])
    if (total || paid) out[i][4] = round2(total - paid)
  }
  return out
}

export function recalculateVersamentoSheet(rows) {
  const out = rows.map((row) => padRow(row, 3))
  let sum = 0
  for (let i = 4; i < out.length; i += 1) {
    if (String(out[i][0] || '').toUpperCase() === 'TOTALE') {
      out[i][2] = round2(sum) ?? 0
      continue
    }
    if (rowHasContent(out[i])) sum += num(out[i][2])
  }
  return out
}

export function syncTotaliSheet(sheets) {
  return sheets.map((sheet) => {
    if (sheet.name !== 'TOTALI') return sheet
    const rows = sheet.rows.map((row) => [...padRow(row, 9)])
    for (let i = 1; i < rows.length; i += 1) {
      const monthName = String(rows[i][0] || '')
        .trim()
        .toUpperCase()
      if (!monthName) continue
      const monthSheet = sheets.find((item) => item.name.toUpperCase() === monthName)
      if (!monthSheet || isSpecialSheet(monthSheet.name)) continue
      const { pagare, pagato } = getMonthlyFooterTotals(monthSheet.rows)
      rows[i][1] = pagare
      rows[i][2] = pagato
      rows[i][3] = round2(num(pagare) + num(pagato))
    }
    return { ...sheet, rows }
  })
}

export function recalculateWorkbook(workbook) {
  let sheets = (workbook.sheets || []).map((sheet) => {
    if (isMonthlySheet(sheet.name)) {
      return { ...sheet, rows: recalculateMonthlySheet(sheet.rows) }
    }
    if (sheet.name === 'DELEGHE F24') {
      return { ...sheet, rows: recalculateDelegheSheet(sheet.rows) }
    }
    if (sheet.name === 'VERSAMENTO CONTANTI') {
      return { ...sheet, rows: recalculateVersamentoSheet(sheet.rows) }
    }
    return sheet
  })
  sheets = syncTotaliSheet(sheets)
  return { ...workbook, sheets }
}

export function isCellEditable(kind, colIndex, sheetName) {
  if (kind === 'header' || kind === 'title' || kind === 'subtotal') return false
  if (kind === 'totals') {
    if (sheetName === 'VERSAMENTO CONTANTI') return colIndex !== 2
    if (isMonthlySheet(sheetName)) return ![7, 8, 11].includes(colIndex)
    if (sheetName === 'TOTALI') return ![1, 2, 3].includes(colIndex)
    return true
  }
  if (sheetName === 'DELEGHE F24' && colIndex === 4) return false
  return true
}

export function addMonthlyInvoiceRow(workbook, sheetName) {
  const sheets = workbook.sheets.map((sheet) => {
    if (sheet.name !== sheetName) return sheet
    const rows = sheet.rows.map((row) => padRow(row))
    const footerIndex = rows.findIndex(isMonthlyFooterRow)
    const insertAt = footerIndex >= 0 ? footerIndex : rows.length
    rows.splice(insertAt, 0, padRow([]))
    if (footerIndex < 0 && !rows.some(isMonthlyFooterRow)) {
      const footer = padRow([])
      footer[6] = 'TOTALE'
      rows.push(footer)
    }
    return { ...sheet, rows }
  })
  return recalculateWorkbook({ ...workbook, sheets })
}

export function addSubtotalRow(workbook, sheetName) {
  const sheets = workbook.sheets.map((sheet) => {
    if (sheet.name !== sheetName) return sheet
    const rows = sheet.rows.map((row) => padRow(row))
    const footerIndex = rows.findIndex(isMonthlyFooterRow)
    const insertAt = footerIndex >= 0 ? footerIndex : rows.length
    const subtotal = padRow([])
    subtotal[9] = 0
    rows.splice(insertAt, 0, subtotal)
    return { ...sheet, rows }
  })
  return recalculateWorkbook({ ...workbook, sheets })
}

export function ensureMonthlyFooter(workbook) {
  const sheets = workbook.sheets.map((sheet) => {
    if (!isMonthlySheet(sheet.name)) return sheet
    if (sheet.rows.some(isMonthlyFooterRow)) return sheet
    const rows = [...sheet.rows.map((row) => padRow(row)), padRow([null, null, null, null, null, null, 'TOTALE'])]
    return { ...sheet, rows }
  })
  return recalculateWorkbook({ ...workbook, sheets })
}

export function formatUpdatedAt(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('it-IT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function normalizeSheetName(name) {
  return String(name || '')
    .trim()
    .toUpperCase()
    .replace(/[\\/*?:[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 31)
}

export function suggestNewSheetName(sheets) {
  const names = new Set((sheets || []).map((sheet) => normalizeSheetName(sheet.name)))
  for (const month of MONTH_ORDER) {
    if (!names.has(month)) return month
  }
  let index = 1
  while (names.has(`FOGLIO${index}`)) index += 1
  return `FOGLIO${index}`
}

export function createMonthlySheetTemplate(name) {
  const sheetName = normalizeSheetName(name)
  if (!sheetName) throw new Error('Inserisci un nome per il foglio')
  const footer = padRow([])
  footer[6] = 'TOTALE'
  return {
    name: sheetName,
    rows: [
      [...MONTHLY_HEADERS],
      padRow([]),
      padRow([]),
      padRow([]),
      footer,
    ],
  }
}

export function addWorkbookSheet(workbook, sheetName) {
  const name = normalizeSheetName(sheetName)
  if (!name) throw new Error('Inserisci un nome per il foglio')
  if (isSpecialSheet(name)) {
    throw new Error(`Il nome "${name}" è riservato. Scegli un altro nome.`)
  }
  if ((workbook.sheets || []).some((sheet) => normalizeSheetName(sheet.name) === name)) {
    throw new Error(`Esiste già un foglio "${name}"`)
  }
  const newSheet = createMonthlySheetTemplate(name)
  const sheets = [...(workbook.sheets || [])]
  const totaliIndex = sheets.findIndex((sheet) => sheet.name === 'TOTALI')
  if (totaliIndex >= 0) sheets.splice(totaliIndex, 0, newSheet)
  else sheets.push(newSheet)
  return recalculateWorkbook({ ...workbook, sheets })
}

export function canDeleteWorkbookSheet(sheetName) {
  const name = normalizeSheetName(sheetName)
  if (!name) return false
  if (isSpecialSheet(name)) return false
  if (DEFAULT_WORKBOOK_SHEET_NAMES.has(name)) return false
  return true
}

export function removeWorkbookSheet(workbook, sheetName) {
  const name = normalizeSheetName(sheetName)
  if (!canDeleteWorkbookSheet(name)) {
    throw new Error(`Il foglio "${name}" è protetto e non può essere eliminato`)
  }
  const sheets = (workbook.sheets || []).filter((sheet) => normalizeSheetName(sheet.name) !== name)
  if (sheets.length === (workbook.sheets || []).length) {
    throw new Error('Foglio non trovato')
  }
  return recalculateWorkbook({ ...workbook, sheets })
}

export { MONTH_ORDER }
