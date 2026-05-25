import { expandRawOrderLines, mapOrderLinesToRows } from './orderLinesNormalize.js'

export const emptyOrderRow = () => ({
  product_description: '',
  pieces: '',
  weight_kg: '',
  note: '',
})

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

/** Toglie il nome fornitore dalla descrizione prodotto (voce / AI). */
export function stripSupplierFromProductDescription(desc, supplierName) {
  let d = String(desc || '').trim()
  const sn = String(supplierName || '').trim()
  if (!d || !sn) return d
  if (norm(d) === norm(sn)) return ''
  const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const frag = sn.split(/\s+/).filter(Boolean).map(esc).join('\\s+')
  if (frag) {
    d = d.replace(new RegExp(`^${frag}(?:\\s+(?:s\\.?r\\.?l\\.?|s\\.?p\\.?a\\.?))?\\s+`, 'i'), '').trim()
    d = d.replace(new RegExp(`\\s+${frag}$`, 'i'), '').trim()
  }
  const supWords = sn.split(/\s+/).filter(Boolean)
  const dWords = d.split(/\s+/)
  let n = 0
  for (let i = 0; i < supWords.length && i < dWords.length; i++) {
    if (norm(supWords[i]) === norm(dWords[i])) n = i + 1
    else break
  }
  if (n > 0) {
    const rest = dWords.slice(n).join(' ').trim()
    if (rest.length >= 2) d = rest
  }
  return d
}

/** Allinea fornitore anche se il nome non è identico (es. "Rossi" vs "Rossi S.r.l."). */
export function matchSupplierByName(suppliers, supplierName) {
  const target = norm(supplierName)
  if (!target || !Array.isArray(suppliers)) return null
  const exact = suppliers.find((s) => norm(s.name) === target)
  if (exact) return exact
  const contained = suppliers.find((s) => {
    const n = norm(s.name)
    return n && (n.includes(target) || target.includes(n))
  })
  if (contained) return contained
  const words = target.split(/\s+/).filter((w) => w.length > 2)
  if (!words.length) return null
  let best = null
  let bestScore = 0
  for (const s of suppliers) {
    const n = norm(s.name)
    if (!n) continue
    const hits = words.filter((w) => n.includes(w)).length
    const score = hits / words.length
    if (score > bestScore && score >= 0.5) {
      bestScore = score
      best = s
    }
  }
  return best
}

export function extractOrderLinesFromResponse(r) {
  if (!r || typeof r !== 'object') return []
  const candidates = []
  for (const key of ['suggested_lines', 'lines', 'items', 'products', 'righe']) {
    if (Array.isArray(r[key])) candidates.push(...r[key])
  }
  const sf = r.suggested_fields
  if (sf && typeof sf === 'object') {
    for (const key of ['lines', 'items', 'products', 'righe']) {
      if (Array.isArray(sf[key])) candidates.push(...sf[key])
    }
  }
  return candidates
}

export function rowHasProduct(row) {
  if (!row) return false
  return Boolean(
    String(row.product_description || '').trim() ||
      (row.pieces !== '' && row.pieces != null) ||
      (row.weight_kg !== '' && row.weight_kg != null),
  )
}

function rowsEquivalent(a, b) {
  const da = norm(a.product_description)
  const db = norm(b.product_description)
  const pa = String(a.pieces ?? '').trim()
  const pb = String(b.pieces ?? '').trim()
  const wa = String(a.weight_kg ?? '').trim()
  const wb = String(b.weight_kg ?? '').trim()
  return da === db && pa === pb && wa === wb
}

/**
 * Ogni prodotto = una riga: mantiene righe già compilate e aggiunge le nuove in fondo.
 */
export function mergeOrderProductRows(existingRows, incomingRows) {
  const filled = (existingRows || []).filter(rowHasProduct)
  const merged = [...filled]
  let added = 0
  for (const row of incomingRows || []) {
    if (!rowHasProduct(row)) continue
    if (merged.some((r) => rowsEquivalent(r, row))) continue
    merged.push(row)
    added += 1
  }
  return [...merged, emptyOrderRow()]
}

/**
 * Applica risposta AI al form ordine.
 * @returns {{ applied: string[], warnings: string[], hasLines: boolean, hasSupplier: boolean }}
 */
export function applyOrderAiResponse(r, suppliers, actions) {
  const f = r?.suggested_fields || {}
  const rawLines = expandRawOrderLines(extractOrderLinesFromResponse(r))
  const applied = []
  const warnings = Array.isArray(r?.warnings) ? [...r.warnings] : []

  if (f.supplier_name) {
    const matched = matchSupplierByName(suppliers, f.supplier_name)
    if (matched) {
      actions.setSupplierId(String(matched.id))
      applied.push(`Fornitore: ${matched.name}`)
    } else {
      warnings.push(`Fornitore «${f.supplier_name}» non trovato in elenco: selezionalo manualmente`)
    }
  }
  if (f.order_date) {
    actions.setOrderDate(String(f.order_date).slice(0, 10))
    applied.push(`Data ordine`)
  }
  if (f.expected_delivery_date) {
    actions.setExpectedDeliveryDate(String(f.expected_delivery_date).slice(0, 10))
    applied.push(`Consegna prevista`)
  }
  if (f.delivery_location) {
    actions.setDeliveryLocation(String(f.delivery_location))
    applied.push(`Destinazione`)
  }
  if (f.order_signed_by) {
    actions.setOrderSignedBy(String(f.order_signed_by))
    applied.push(`Firma ordine`)
  }
  if (f.unloading_signed_by) {
    actions.setUnloadingSignedBy(String(f.unloading_signed_by))
    applied.push(`Firma scarico`)
  }
  if (f.vat_percent != null) {
    actions.setVatPercent(String(f.vat_percent))
    applied.push(`IVA`)
  }
  if (f.note) {
    actions.setOrderNote(String(f.note))
    applied.push('Note')
  }

  const matchedSupplier = f.supplier_name
    ? matchSupplierByName(suppliers, f.supplier_name)
    : null
  const supplierLabel = matchedSupplier?.name || f.supplier_name || ''
  const incoming = mapOrderLinesToRows(rawLines)
    .map((row) => {
      if (!supplierLabel) return row
      const desc = stripSupplierFromProductDescription(row.product_description, supplierLabel)
      return { ...row, product_description: desc }
    })
    .filter(rowHasProduct)
  if (incoming.length && typeof actions.setRows === 'function') {
    let added = incoming.length
    actions.setRows((prev) => {
      const before = (prev || []).filter(rowHasProduct).length
      const merged = mergeOrderProductRows(prev, incoming)
      added = merged.filter(rowHasProduct).length - before
      return merged
    })
    applied.push(
      added === 1 ? '1 riga prodotto aggiunta' : `${added || incoming.length} righe prodotto aggiunte`,
    )
  }

  return {
    applied,
    warnings,
    hasLines: incoming.length > 0,
    hasSupplier: Boolean(f.supplier_name && matchSupplierByName(suppliers, f.supplier_name)),
  }
}
