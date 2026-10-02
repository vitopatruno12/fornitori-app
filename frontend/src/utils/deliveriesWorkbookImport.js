/**
 * Import scarichi da Excel/ODS verso storico consegne.
 * Colonne attese (flessibili): Data, DDT, Fornitore, Prodotto, Peso, Pezzi, Prezzo, IVA, Destinazione, Note, …
 */

function cellText(value) {
  if (value == null || value === '') return ''
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const dd = String(value.getDate()).padStart(2, '0')
    const mm = String(value.getMonth() + 1).padStart(2, '0')
    const yyyy = value.getFullYear()
    return `${yyyy}-${mm}-${dd}`
  }
  return String(value).trim()
}

function normalizeHeader(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
}

const HEADER_ALIASES = {
  delivery_date: ['data', 'dataconsegna', 'datedelivery', 'deliverydate', 'datareg'],
  ddt_number: ['ddt', 'numeroddt', 'niddt', 'nddt', 'documento', 'ndocumento'],
  supplier_name: ['fornitore', 'supplier', 'emittente', 'ragionesociale', 'nome'],
  product_description: ['prodotto', 'descrizione', 'merce', 'articolo', 'product', 'denominazione'],
  weight_kg: ['peso', 'pesokg', 'kg', 'weight', 'pesoinkg'],
  pieces: ['pezzi', 'cassette', 'colli', 'qty', 'quantita', 'pieces', 'npezzi', 'numcassette', 'numcassetta', 'ncassette', 'ncassetta'],
  unit_price: ['prezzo', 'prezzounit', 'prezzounitario', 'unitprice', 'prezzoeuro', 'prezzoe'],
  vat_percent: ['iva', 'ivapercent', 'aliquotaiva', 'vat', 'vatpercent'],
  destination: ['destinazione', 'luogoscarico', 'destination', 'localita'],
  document_note: ['note', 'notedoc', 'notadocumento', 'documentnote', 'nota', 'noteriga', 'notes', 'osservazioni', 'osservazione', 'commento', 'commenti', 'annotazioni', 'annotazione'],
  anomaly_note: ['anomalie', 'noteanomalie', 'anomaly', 'anomalynote'],
  unloading_signed_by: ['firmascarico', 'firma', 'firmatario', 'unloading', 'chiscari'],
}

function mapHeaderIndex(headerRow) {
  const index = {}
  ;(headerRow || []).forEach((cell, i) => {
    const key = normalizeHeader(cell)
    if (!key) return
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.some((a) => normalizeHeader(a) === key) && index[field] == null) {
        index[field] = i
      }
    }
  })
  return index
}

function findHeaderRow(rows) {
  let best = { score: 0, index: -1, map: {} }
  const limit = Math.min(rows.length, 40)
  for (let i = 0; i < limit; i += 1) {
    const map = mapHeaderIndex(rows[i] || [])
    const score = Object.keys(map).length
    if (score > best.score) best = { score, index: i, map }
  }
  return best.score >= 2 ? best : null
}

function parseExcelDate(value) {
  if (value == null || value === '') return ''
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const dd = String(value.getDate()).padStart(2, '0')
    const mm = String(value.getMonth() + 1).padStart(2, '0')
    return `${value.getFullYear()}-${mm}-${dd}`
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Excel serial date
    const epoch = Date.UTC(1899, 11, 30)
    const ms = epoch + Math.round(value) * 86400000
    const d = new Date(ms)
    if (!Number.isNaN(d.getTime())) {
      const dd = String(d.getUTCDate()).padStart(2, '0')
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
      return `${d.getUTCFullYear()}-${mm}-${dd}`
    }
  }
  const raw = String(value).trim()
  const it = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/)
  if (it) {
    let y = Number(it[3])
    if (y < 100) y += 2000
    const mm = String(Number(it[2])).padStart(2, '0')
    const dd = String(Number(it[1])).padStart(2, '0')
    return `${y}-${mm}-${dd}`
  }
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  return ''
}

function parseNumber(value) {
  if (value == null || value === '') return null
  if (typeof value === 'number' && Number.isFinite(value)) return value
  let s = String(value).trim().replace(/\s/g, '').replace(/€/g, '')
  if (!s) return null
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.')
    else s = s.replace(/,/g, '')
  } else if (s.includes(',')) {
    s = s.replace(',', '.')
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function rowFingerprint(row) {
  return [
    String(row.supplier_name || '').trim().toLowerCase(),
    String(row.ddt_number || '').trim().toLowerCase(),
    String(row.delivery_date || ''),
    String(row.product_description || '').trim().toLowerCase(),
    String(row.weight_kg ?? ''),
    String(row.pieces ?? ''),
    String(row.unit_price ?? ''),
  ].join('|')
}

function ddtKey(row) {
  const supplier = String(row.supplier_name || '').trim().toLowerCase()
  const ddt = String(row.ddt_number || '').trim().toLowerCase()
  if (!supplier || !ddt) return ''
  return `${supplier}::${ddt}`
}

/**
 * Deduplica: toglie righe identiche e DDT ripetuti nello stesso file
 * (tiene solo il primo blocco continuo fornitore+DDT).
 */
export function dedupeDeliveryImportRows(rows) {
  const list = Array.isArray(rows) ? rows : []
  const cleaned = []
  const seenExact = new Set()
  const closedDdt = new Set()
  let activeDdt = ''
  let removedExact = 0
  let removedDdt = 0

  for (const row of list) {
    const fp = rowFingerprint(row)
    if (seenExact.has(fp)) {
      removedExact += 1
      continue
    }
    const key = ddtKey(row)
    if (key) {
      if (closedDdt.has(key)) {
        removedDdt += 1
        continue
      }
      if (activeDdt && activeDdt !== key) {
        closedDdt.add(activeDdt)
        if (closedDdt.has(key)) {
          removedDdt += 1
          continue
        }
      }
      activeDdt = key
    }
    seenExact.add(fp)
    cleaned.push(row)
  }

  return {
    rows: cleaned,
    removedExact,
    removedDdt,
  }
}

function linesFromSheetRows(rows) {
  const header = findHeaderRow(rows)
  if (!header) return []
  const { index, map } = header
  const out = []
  for (let r = index + 1; r < rows.length; r += 1) {
    const line = rows[r] || []
    const get = (field) => (map[field] != null ? line[map[field]] : '')
    const product = cellText(get('product_description'))
    const supplier = cellText(get('supplier_name'))
    const ddt = cellText(get('ddt_number'))
    if (!product && !supplier && !ddt) continue
    const weight = parseNumber(get('weight_kg'))
    const piecesRaw = parseNumber(get('pieces'))
    const price = parseNumber(get('unit_price'))
    const vat = parseNumber(get('vat_percent'))
    out.push({
      delivery_date: parseExcelDate(get('delivery_date')) || '',
      ddt_number: ddt,
      supplier_name: supplier,
      product_description: product,
      weight_kg: weight,
      pieces: piecesRaw != null ? Math.round(piecesRaw) : null,
      unit_price: price != null ? price : 0,
      vat_percent: vat != null ? vat : 23,
      destination: cellText(get('destination')),
      document_note: cellText(get('document_note')),
      anomaly_note: cellText(get('anomaly_note')),
      unloading_signed_by: cellText(get('unloading_signed_by')),
    })
  }
  return out
}

/** Legge .xlsx / .xls / .ods → righe consegna (già senza duplicati esatti / DDT ripetuti). */
export async function readDeliveriesWorkbook(arrayBuffer) {
  const loaded = await import('xlsx')
  const XLSX = loaded.read ? loaded : loaded.default
  const workbook = XLSX.read(arrayBuffer, { type: 'array', cellDates: true })
  let best = []
  for (const name of workbook.SheetNames || []) {
    const sheet = workbook.Sheets[name]
    if (!sheet) continue
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '', cellDates: true })
    const lines = linesFromSheetRows(rows)
    if (lines.length > best.length) best = lines
  }
  const deduped = dedupeDeliveryImportRows(best)
  return {
    rows: deduped.rows,
    removedExact: deduped.removedExact,
    removedDdt: deduped.removedDdt,
    rawCount: best.length,
  }
}

export const DELIVERIES_IMPORT_PREVIEW_COLUMNS = [
  { id: 'delivery_date', label: 'Data', width: 10, fluid: true },
  { id: 'ddt_number', label: 'DDT', width: 10, fluid: true, emphasis: true },
  { id: 'supplier_name', label: 'Fornitore', width: 16, fluid: true },
  { id: 'product_description', label: 'Prodotto', width: 18, fluid: true },
  { id: 'weight_kg', label: 'Peso', width: 8, fluid: true, numeric: true },
  { id: 'pieces', label: 'numero.cassette(n)', width: 8, fluid: true, numeric: true },
  { id: 'unit_price', label: 'Prezzo', width: 9, fluid: true, numeric: true },
  { id: 'destination', label: 'Destinazione', width: 12, fluid: true },
  { id: 'document_note', label: 'Note', width: 16, fluid: true },
]

export function deliveryImportPreviewCellValue(row, col) {
  const v = row?.[col.id]
  if (v == null || v === '') return '—'
  if (col.numeric) {
    const n = Number(v)
    if (!Number.isFinite(n)) return String(v)
    return n.toLocaleString('it-IT', { maximumFractionDigits: 2 })
  }
  return String(v)
}
