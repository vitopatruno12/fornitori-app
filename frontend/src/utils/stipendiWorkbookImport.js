function foldHeader(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function parseImportedMoney(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.round(Math.abs(raw) * 100) / 100
  }
  const s = String(raw ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(/€/g, '')
    .replace(/^\((.*)\)$/, '$1')
  if (!s || s === '-' || s === '—') return 0
  const negative = s.startsWith('-')
  const body = negative ? s.slice(1) : s
  let n
  if (body.includes(',')) n = Number(body.replace(/\./g, '').replace(',', '.'))
  else n = Number(body)
  if (!Number.isFinite(n)) return 0
  return Math.round(Math.abs(n) * 100) / 100
}

function headerField(label) {
  const key = foldHeader(label)
  if (!key) return ''
  if (key === 'totali' || key === 'totale') return ''
  if (/(nominativ|dipendent|cognome|nome e cognome)/.test(key) || key === 'nome') return 'name'
  if (key.includes('anticip') || key.includes('sottrat')) return 'tfr_anticipato'
  if (key.includes('nuovo') && key.includes('tfr')) return 'nuovo_tfr'
  if (key.includes('acconto')) return 'acconto_tfr'
  if (key.includes('tfr') && key.includes('attual')) return 'tfr_attuale'
  if (key === 'tfr') return 'tfr_attuale'
  if (key.includes('fuori')) return 'fuori'
  if (key.includes('busta') && !key.includes('totale')) return 'busta'
  return ''
}

function findHeader(rows) {
  const limit = Math.min(rows.length, 20)
  for (let i = 0; i < limit; i += 1) {
    const cells = Array.isArray(rows[i]) ? rows[i] : []
    const fields = cells.map(headerField)
    if (!fields.includes('name')) continue
    const money = fields.filter((f) => f && f !== 'name')
    if (!money.length) continue
    return { index: i, fields }
  }
  return null
}

function isTotalRow(name) {
  const key = foldHeader(name)
  return key === 'totali' || key === 'totale' || key.startsWith('totale ')
}

/** Righe di un foglio (matrice) → voci stipendi. */
export function linesFromSheetRows(rows) {
  const header = findHeader(rows)
  if (!header) return []
  const out = []
  for (let i = header.index + 1; i < rows.length; i += 1) {
    const cells = Array.isArray(rows[i]) ? rows[i] : []
    const partial = {}
    header.fields.forEach((field, col) => {
      if (!field || field === 'nuovo_tfr') return
      if (field === 'name') partial.name = String(cells[col] ?? '').trim()
      else partial[field] = parseImportedMoney(cells[col])
    })
    if (!partial.name || isTotalRow(partial.name)) continue
    out.push(partial)
  }
  return out
}

function sheetScore(rows) {
  return linesFromSheetRows(rows).length
}

/** Legge .xlsx, .xls o .ods e restituisce le voci da mettere in tabella. */
export async function readStipendiWorkbook(arrayBuffer) {
  const loaded = await import('xlsx')
  const XLSX = loaded.read ? loaded : loaded.default
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: false })
  let best = []
  for (const name of workbook.SheetNames || []) {
    const sheet = workbook.Sheets[name]
    if (!sheet) continue
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' })
    const lines = linesFromSheetRows(rows)
    if (lines.length > best.length) best = lines
  }
  return best
}
