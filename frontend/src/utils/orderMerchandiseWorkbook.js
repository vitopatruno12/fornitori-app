export const ORDER_MERCHANDISE_WORKBOOK_TITLE = 'Merce ordine'

export const ORDER_MERCHANDISE_COLUMNS = [
  { id: 'row', label: '#', numeric: true, width: 44, sticky: 'left' },
  { id: 'product_description', label: 'Merce', width: 220, emphasis: true },
  { id: 'listino', label: 'Listino (€/u)', numeric: true, width: 110 },
  { id: 'pieces', label: 'Pz', numeric: true, width: 72 },
  { id: 'weight_kg', label: 'Kg', numeric: true, width: 80 },
  { id: 'volume_liters', label: 'Litri', numeric: true, width: 80 },
  { id: 'note', label: 'Note', width: 180 },
]

function formatQty(value) {
  if (value === '' || value == null) return ''
  const n = Number(value)
  if (Number.isNaN(n)) return String(value)
  if (Number.isInteger(n)) return String(n)
  return n.toLocaleString('it-IT', { maximumFractionDigits: 3 })
}

function formatEur(value) {
  if (value == null || Number.isNaN(Number(value))) return ''
  return Number(value).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function text(value) {
  if (value == null || value === '') return ''
  return String(value)
}

export function listPriceForDescription(priceList, description) {
  const d = (description || '').trim()
  if (!d || !Array.isArray(priceList)) return null
  const key = d.toLowerCase()
  const row = priceList.find((x) => (x.product_description || '').trim().toLowerCase() === key)
  return row != null ? Number(row.unit_price) : null
}

export function orderMerchandiseListinoMeta(priceList, description) {
  const d = (description || '').trim()
  if (!d) {
    return {
      text: '',
      title: 'Scrivi il prodotto: qui compare il prezzo unitario dal prezzario se c’è una voce uguale.',
    }
  }
  const p = listPriceForDescription(priceList, d)
  if (p == null || Number.isNaN(p)) {
    return {
      text: '',
      title:
        'Nessuna voce nel prezzario con questa descrizione. In Nuova consegna → Prezzario aggiungi la merce e il prezzo, oppure usa la stessa scritta del listino (anche maiuscole diverse).',
    }
  }
  const formatted = formatEur(p)
  return {
    text: formatted,
    title: `Prezzo unitario dal prezzario fornitore (${formatted} € / cad.). Riferimento per confronto in consegna.`,
  }
}

/**
 * @param {Record<string, unknown>} row
 * @param {{ id: string }} column
 * @param {{ rowIndex?: number, listinoText?: string }} ctx
 */
export function orderMerchandiseCellValue(row, column, ctx = {}) {
  const { rowIndex = 0, listinoText = '' } = ctx
  switch (column.id) {
    case 'row':
      return String(rowIndex + 1)
    case 'product_description':
      return text(row.product_description)
    case 'listino':
      return listinoText
    case 'pieces':
      return formatQty(row.pieces)
    case 'weight_kg':
      return formatQty(row.weight_kg)
    case 'volume_liters':
      return formatQty(row.volume_liters)
    case 'note':
      return text(row.note) || '—'
    default:
      return ''
  }
}

export function orderMerchandiseTotals(rows) {
  const list = Array.isArray(rows) ? rows : []
  let totalPieces = 0
  let totalKg = 0
  let totalLiters = 0
  for (const row of list) {
    const p = row.pieces === '' || row.pieces == null ? null : Number(row.pieces)
    if (p != null && !Number.isNaN(p) && p > 0) totalPieces += p
    const w = row.weight_kg === '' || row.weight_kg == null ? null : Number(row.weight_kg)
    if (w != null && !Number.isNaN(w) && w > 0) totalKg += w
    const l = row.volume_liters === '' || row.volume_liters == null ? null : Number(row.volume_liters)
    if (l != null && !Number.isNaN(l) && l > 0) totalLiters += l
  }
  return {
    count: list.length,
    pieces: totalPieces > 0 ? formatQty(totalPieces) : '',
    weight_kg: totalKg > 0 ? formatQty(totalKg) : '',
    volume_liters: totalLiters > 0 ? formatQty(totalLiters) : '',
  }
}

export function orderMerchandiseTotalsLabel(columnId, totals) {
  if (columnId === 'product_description') return `TOTALI (${totals.count})`
  if (columnId === 'pieces') return totals.pieces
  if (columnId === 'weight_kg') return totals.weight_kg
  if (columnId === 'volume_liters') return totals.volume_liters
  return ''
}

export function orderMerchandiseDupTone(isDuplicate) {
  return isDuplicate ? 'workbook-cell-alert' : ''
}
