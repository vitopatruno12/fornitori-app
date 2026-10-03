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

const MONTH_INDEX = {
  gennaio: 1,
  febbraio: 2,
  marzo: 3,
  aprile: 4,
  maggio: 5,
  giugno: 6,
  luglio: 7,
  agosto: 8,
  settembre: 9,
  ottobre: 10,
  novembre: 11,
  dicembre: 12,
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  mag: 5,
  may: 5,
  giu: 6,
  jun: 6,
  june: 6,
  lug: 7,
  jul: 7,
  july: 7,
  ago: 8,
  aug: 8,
  august: 8,
  set: 9,
  sep: 9,
  september: 9,
  ott: 10,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dic: 12,
  dec: 12,
  december: 12,
}

function headerField(label) {
  const key = foldHeader(label)
  if (!key) return ''
  if (key === 'totali' || key === 'totale') return ''
  if (key === 'anno' || key === 'year' || key === 'esercizio') return 'year'
  if (key === 'mese' || key === 'month' || key === 'periodo') return 'month'
  if (key.includes('note')) return ''
  if (key.includes('completo') || key.includes('stipendio tot')) return ''
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
    const money = fields.filter((f) => f && f !== 'name' && f !== 'year' && f !== 'month')
    const period = fields.includes('year') || fields.includes('month')
    if (!money.length && !period) continue
    return { index: i, fields }
  }
  return null
}

function isTotalRow(name) {
  const key = foldHeader(name)
  return key === 'totali' || key === 'totale' || key.startsWith('totale ')
}

function parseYear(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getFullYear()
  if (typeof value === 'number' && Number.isFinite(value)) {
    const n = Math.trunc(value)
    if (n >= 2000 && n <= 2100) return n
    return 0
  }
  const s = String(value || '').trim()
  const m = s.match(/(20\d{2})/)
  return m ? Number(m[1]) : 0
}

function parseMonth(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getMonth() + 1
  if (typeof value === 'number' && Number.isFinite(value)) {
    const n = Math.trunc(value)
    if (n >= 1 && n <= 12) return n
    return 0
  }
  const key = foldHeader(value)
  if (!key) return 0
  if (MONTH_INDEX[key]) return MONTH_INDEX[key]
  const m = key.match(/^(\d{1,2})$/)
  if (m) {
    const n = Number(m[1])
    return n >= 1 && n <= 12 ? n : 0
  }
  return 0
}

function toYearMonth(yearValue, monthValue) {
  const y = parseYear(yearValue)
  const m = parseMonth(monthValue)
  if (!y || !m) return ''
  return `${y}-${String(m).padStart(2, '0')}`
}

const POSITIONAL_FIELDS = ['name', 'busta', 'fuori', 'tfr_attuale', 'acconto_tfr', 'nuovo_tfr', 'tfr_anticipato']

function rowToLine(cells, fields) {
  const partial = {}
  fields.forEach((field, col) => {
    if (!field || field === 'nuovo_tfr') return
    if (field === 'name') partial.name = String(cells[col] ?? '').trim()
    else if (field === 'year' || field === 'month') partial[field] = cells[col]
    else partial[field] = parseImportedMoney(cells[col])
  })
  if (!partial.name || isTotalRow(partial.name)) return null
  return partial
}

function mergeImportedLines(list) {
  const byKey = new Map()
  for (const row of list) {
    const name = String(row?.name || '').trim()
    if (!name) continue
    const key = name.toLocaleLowerCase('it')
    const prev = byKey.get(key)
    if (!prev) {
      byKey.set(key, {
        name,
        busta: Number(row.busta) || 0,
        fuori: Number(row.fuori) || 0,
        tfr_attuale: Number(row.tfr_attuale) || 0,
        acconto_tfr: Number(row.acconto_tfr) || 0,
        tfr_anticipato: Number(row.tfr_anticipato) || 0,
      })
      continue
    }
    prev.busta += Number(row.busta) || 0
    prev.fuori += Number(row.fuori) || 0
    prev.tfr_attuale += Number(row.tfr_attuale) || 0
    prev.acconto_tfr += Number(row.acconto_tfr) || 0
    prev.tfr_anticipato += Number(row.tfr_anticipato) || 0
  }
  return [...byKey.values()].map((row) => ({
    ...row,
    busta: Math.round(row.busta * 100) / 100,
    fuori: Math.round(row.fuori * 100) / 100,
    tfr_attuale: Math.round(row.tfr_attuale * 100) / 100,
    acconto_tfr: Math.round(row.acconto_tfr * 100) / 100,
    tfr_anticipato: Math.round(row.tfr_anticipato * 100) / 100,
  }))
}

function linesFromPosition(rows) {
  const out = []
  for (const raw of rows) {
    const cells = Array.isArray(raw) ? raw : []
    const name = String(cells[0] ?? '').trim()
    if (!name || isTotalRow(name) || headerField(name) === 'name') continue
    const hasAmount = cells.slice(1, 8).some((cell) => String(cell ?? '').trim() !== '')
    if (!hasAmount) continue
    const line = rowToLine(cells, POSITIONAL_FIELDS)
    if (line) out.push(line)
  }
  return mergeImportedLines(out)
}

function parseSheetMonths(rows) {
  const header = findHeader(rows)
  if (!header) return { lines: linesFromPosition(rows), months: [] }
  const hasPeriod = header.fields.includes('year') && header.fields.includes('month')
  const groups = new Map()
  const flat = []
  for (let i = header.index + 1; i < rows.length; i += 1) {
    const cells = Array.isArray(rows[i]) ? rows[i] : []
    const line = rowToLine(cells, header.fields)
    if (!line) continue
    const ym = hasPeriod ? toYearMonth(line.year, line.month) : ''
    const { year: _y, month: _m, ...rest } = line
    if (ym) {
      const y = Number(ym.slice(0, 4))
      if (y < 2024 || y > 2026) continue
      if (!groups.has(ym)) groups.set(ym, [])
      groups.get(ym).push(rest)
    } else {
      flat.push(rest)
    }
  }
  const months = [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([yearMonth, lines]) => ({
      yearMonth,
      lines: mergeImportedLines(lines),
    }))
    .filter((m) => m.lines.length)
  return {
    months,
    lines: months.length ? months.flatMap((m) => m.lines) : mergeImportedLines(flat),
  }
}

/** Righe di un foglio (matrice) → voci stipendi. */
export function linesFromSheetRows(rows) {
  return parseSheetMonths(rows).lines
}

export function monthsFromSheetRows(rows) {
  return parseSheetMonths(rows).months
}

/** Legge .xlsx, .xls o .ods. Se c’è Anno/Mese, divide in mesi 2024–2026. */
export async function readStipendiWorkbook(arrayBuffer) {
  const loaded = await import('xlsx')
  const XLSX = loaded.read ? loaded : loaded.default
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true })
  let best = { months: [], lines: [] }
  for (const name of workbook.SheetNames || []) {
    const sheet = workbook.Sheets[name]
    if (!sheet) continue
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' })
    const parsed = parseSheetMonths(rows)
    const score = parsed.months.length ? parsed.months.length * 1000 + parsed.months.reduce((n, m) => n + m.lines.length, 0) : parsed.lines.length
    const bestScore = best.months.length ? best.months.length * 1000 + best.months.reduce((n, m) => n + m.lines.length, 0) : best.lines.length
    if (score > bestScore) best = parsed
  }
  return best
}
