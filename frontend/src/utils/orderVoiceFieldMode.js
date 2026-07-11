import { matchSupplierByName } from './orderAiApply.js'

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

function todayIso() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDaysIso(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

const MONTH_WORDS = {
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
}

const WEEKDAY_WORDS = {
  lunedi: 1,
  martedi: 2,
  mercoledi: 3,
  giovedi: 4,
  venerdi: 5,
  sabato: 6,
  domenica: 0,
}

function isoFromParts(day, month, year) {
  const y = year || new Date().getFullYear()
  const m = String(month).padStart(2, '0')
  const d = String(day).padStart(2, '0')
  const iso = `${y}-${m}-${d}`
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return ''
  const dt = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(dt.getTime())) return ''
  return iso
}

function parseWeekdayToken(t) {
  const lo = norm(t)
  for (const [word, target] of Object.entries(WEEKDAY_WORDS)) {
    if (!lo.includes(word)) continue
    const now = new Date()
    const cur = now.getDay()
    let add = (target - cur + 7) % 7
    if (add === 0 || /prossim/.test(lo)) add = add === 0 ? 7 : add
    if (/prossim/.test(lo) && add < 7) {
      /* mantieni add calcolato */
    }
    return addDaysIso(add)
  }
  return ''
}

/** Converte dettato in YYYY-MM-DD per input type=date. */
export function parseDateToken(tok) {
  const raw = String(tok || '').trim()
  if (!raw) return ''
  const t = norm(raw)
  if (t === 'oggi') return todayIso()
  if (t === 'domani') return addDaysIso(1)
  if (t === 'dopodomani') return addDaysIso(2)

  const wd = parseWeekdayToken(raw)
  if (wd) return wd

  const mIt = raw.match(
    /(\d{1,2})\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+(\d{4}))?/i,
  )
  if (mIt) {
    const mo = MONTH_WORDS[norm(mIt[2])]
    if (mo) return isoFromParts(Number(mIt[1]), mo, mIt[3] ? Number(mIt[3]) : undefined)
  }

  const m = raw.match(/(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?/)
  if (m) {
    let y = m[3] ? String(m[3]) : String(new Date().getFullYear())
    if (y.length === 2) y = `20${y}`
    return isoFromParts(Number(m[1]), Number(m[2]), Number(y))
  }

  const mIso = raw.match(/\b(\d{4})-(\d{2})-(\d{2})\b/)
  if (mIso) return mIso[0]

  return ''
}

/** Definizione campi ordine richiamabili a voce (ordine = priorità match). */
export const ORDER_VOICE_FIELD_DEFS = [
  { id: 'new_row', label: 'Nuova riga prodotto', keys: ['nuova riga', 'riga nuova', 'aggiungi riga', 'altra riga'] },
  { id: 'supplier', label: 'Fornitore', keys: ['fornitore', 'ditta', 'fornitore ordine'] },
  {
    id: 'expected_delivery_date',
    label: 'Consegna prevista',
    keys: [
      'consegna prevista',
      'data di consegna',
      'data consegna',
      'giorno di consegna',
      'giorno consegna',
      'data consegna prevista',
      'prevista consegna',
      'consegna previsto',
      'consegna',
    ],
  },
  { id: 'order_date', label: 'Data ordine', keys: ['data ordine', 'data dell ordine'] },
  {
    id: 'delivery_location',
    label: 'Destinazione scarico',
    keys: ['destinazione', 'destinazione scarico', 'scarico', 'spedizione', 'luogo consegna'],
  },
  { id: 'order_signed_by', label: 'Firma ordine', keys: ['firma ordine', 'firmatario ordine', 'chi ordina', 'ordinato da'] },
  { id: 'unloading_signed_by', label: 'Firma scarico', keys: ['firma scarico', 'scarico firmato', 'firma scarico merce'] },
  { id: 'vat_percent', label: 'IVA %', keys: ['iva', 'percentuale iva', 'aliquota iva'] },
  { id: 'order_note', label: 'Note ordine', keys: ['note ordine', 'nota ordine', 'note per fornitore'] },
  { id: 'order_note_internal', label: 'Note interne', keys: ['note interne', 'nota interna'] },
  { id: 'product_description', label: 'Prodotto', keys: ['prodotto', 'merce', 'descrizione', 'articolo', 'nome prodotto'], row: true },
  { id: 'pieces', label: 'Pezzi', keys: ['pezzi', 'pezzo', 'quantita', 'quantità', 'numero pezzi', 'pz'], row: true },
  { id: 'weight_kg', label: 'Kg', keys: ['kg', 'kilo', 'chilogrammi', 'peso', 'quanti kg'], row: true },
  { id: 'volume_liters', label: 'Litri', keys: ['litri', 'litro', 'lt', 'volume', 'quanti litri'], row: true },
  { id: 'line_note', label: 'Nota riga', keys: ['nota riga', 'note riga', 'note prodotto', 'nota prodotto'], row: true },
]

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function allFieldKeysSorted() {
  const pairs = []
  for (const def of ORDER_VOICE_FIELD_DEFS) {
    for (const key of def.keys) {
      pairs.push({ def, key, len: norm(key).length })
    }
  }
  pairs.sort((a, b) => b.len - a.len)
  return pairs
}

const FIELD_KEYS_SORTED = allFieldKeysSorted()

/** Riconosce «campo prodotto …» o «prodotto: arance». */
function detectFieldAndValue(text) {
  const raw = String(text || '').trim()
  if (!raw) return null
  const lo = norm(raw)

  for (const { def, key } of FIELD_KEYS_SORTED) {
    const k = escapeRe(norm(key))
    const re = new RegExp(
      `^(?:campo\\s+)?${k}(?:\\s+(?:è|e|il|la))?\\s*(?:[,:]\\s*|\\s+)(.+)$`,
      'i',
    )
    const m = raw.match(re)
    if (m && m[1].trim()) {
      return { fieldId: def.id, label: def.label, value: m[1].trim(), switchOnly: false }
    }
    const reOnly = new RegExp(`^(?:campo\\s+)?${k}\\s*[.:]?\\s*$`, 'i')
    if (reOnly.test(lo) || lo === norm(key)) {
      return { fieldId: def.id, label: def.label, value: null, switchOnly: true }
    }
  }
  return null
}

/**
 * @param {string} text - dettato
 * @param {string|null} activeFieldId - campo scelto al turno precedente
 */
export function parseOrderVoiceUtterance(text, activeFieldId) {
  const t = String(text || '').trim()
  if (!t) {
    return { fieldId: null, label: null, value: null, switchOnly: false, empty: true }
  }

  const det = detectFieldAndValue(t)
  if (det) return { ...det, empty: false }

  for (const { def, key } of FIELD_KEYS_SORTED) {
    const nk = norm(key)
    if (norm(t) === nk || norm(t) === `campo ${nk}`) {
      return { fieldId: def.id, label: def.label, value: null, switchOnly: true, empty: false }
    }
  }

  if (
    activeFieldId === 'expected_delivery_date' ||
    activeFieldId === 'order_date'
  ) {
    const iso = parseDateToken(t)
    if (iso) {
      const def = ORDER_VOICE_FIELD_DEFS.find((d) => d.id === activeFieldId)
      return {
        fieldId: activeFieldId,
        label: def?.label || activeFieldId,
        value: iso,
        switchOnly: false,
        empty: false,
      }
    }
  }

  if (activeFieldId) {
    const def = ORDER_VOICE_FIELD_DEFS.find((d) => d.id === activeFieldId)
    return {
      fieldId: activeFieldId,
      label: def?.label || activeFieldId,
      value: t,
      switchOnly: false,
      empty: false,
    }
  }

  return { fieldId: null, label: null, value: t, switchOnly: false, empty: false, needsFullParse: true }
}

export function resolveVoiceRowIndex(rows, preferredIndex) {
  const list = rows || []
  if (preferredIndex >= 0 && preferredIndex < list.length) return preferredIndex
  const emptyIdx = list.findIndex((r) => !String(r.product_description || '').trim())
  if (emptyIdx >= 0) return emptyIdx
  return Math.max(0, list.length - 1)
}

function extractNumber(val) {
  const m = String(val || '').match(/(\d+(?:[.,]\d+)?)/)
  if (!m) return null
  const n = Number(m[1].replace(',', '.'))
  return Number.isNaN(n) ? null : n
}

/**
 * Applica valore al campo; ritorna messaggio per feedback UI.
 */
export function applyOrderVoiceField(parseResult, ctx) {
  const {
    suppliers = [],
    rows = [],
    setRows,
    setSupplierId,
    setOrderDate,
    setExpectedDeliveryDate,
    setDeliveryLocation,
    setOrderSignedBy,
    setUnloadingSignedBy,
    setVatPercent,
    setOrderNote,
    setOrderNoteInternal,
    voiceRowIndex,
    setVoiceRowIndex,
    addRow,
  } = ctx

  const { fieldId, value, switchOnly } = parseResult || {}
  if (!fieldId) return { ok: false, message: 'Dì prima il campo (es. «prodotto», «pezzi», «fornitore»).' }

  const def = ORDER_VOICE_FIELD_DEFS.find((d) => d.id === fieldId)
  const label = def?.label || fieldId

  if (switchOnly || value == null || String(value).trim() === '') {
    return { ok: true, message: `Campo attivo: ${label}`, fieldId, switchOnly: true }
  }

  const val = String(value).trim()

  if (fieldId === 'new_row') {
    let newIndex = rows.length
    setRows?.((prev) => {
      newIndex = prev.length
      return [...prev, { product_description: '', pieces: '', weight_kg: '', volume_liters: '', note: '' }]
    })
    setVoiceRowIndex?.(newIndex)
    return {
      ok: true,
      message: `Riga ${newIndex + 1} pronta — dì «prodotto» e il nome`,
      fieldId: 'product_description',
      rowIndex: newIndex,
    }
  }

  if (fieldId === 'supplier') {
    const hit = matchSupplierByName(suppliers, val)
    if (hit) {
      setSupplierId?.(String(hit.id))
      return { ok: true, message: `Fornitore: ${hit.name}`, fieldId }
    }
    return { ok: false, message: `Fornitore «${val}» non trovato in anagrafica`, fieldId }
  }

  if (fieldId === 'order_date' || fieldId === 'expected_delivery_date') {
    const iso = parseDateToken(val)
    if (!iso) {
      return {
        ok: false,
        message: `Data non riconosciuta («${val}»). Prova: domani, 25/05/2026, 25 maggio, venerdì.`,
        fieldId,
      }
    }
    if (fieldId === 'order_date') setOrderDate?.(iso)
    else setExpectedDeliveryDate?.(iso)
    return { ok: true, message: `${label}: ${iso}`, fieldId, focusId: 'order-expected-delivery-date' }
  }

  if (fieldId === 'delivery_location') {
    setDeliveryLocation?.(val)
    return { ok: true, message: `${label}: ${val}`, fieldId }
  }

  if (fieldId === 'order_signed_by') {
    setOrderSignedBy?.(val)
    return { ok: true, message: `${label}: ${val}`, fieldId }
  }

  if (fieldId === 'unloading_signed_by') {
    setUnloadingSignedBy?.(val)
    return { ok: true, message: `${label}: ${val}`, fieldId }
  }

  if (fieldId === 'vat_percent') {
    const n = extractNumber(val)
    if (n != null) setVatPercent?.(String(n))
    else setVatPercent?.(val)
    return { ok: true, message: `${label}: ${n != null ? n : val}`, fieldId }
  }

  if (fieldId === 'order_note') {
    setOrderNote?.(val)
    return { ok: true, message: `${label} aggiornate`, fieldId }
  }

  if (fieldId === 'order_note_internal') {
    setOrderNoteInternal?.(val)
    return { ok: true, message: `${label} aggiornate`, fieldId }
  }

  const rowFields = ['product_description', 'pieces', 'weight_kg', 'volume_liters', 'line_note']
  if (rowFields.includes(fieldId)) {
    const rowKey = fieldId === 'line_note' ? 'note' : fieldId
    let outIndex = resolveVoiceRowIndex(rows, voiceRowIndex)
    let outMessage = ''

    setRows?.((prev) => {
      let rowIndex = resolveVoiceRowIndex(prev, voiceRowIndex)
      let list = prev

      if (fieldId === 'product_description') {
        const filled = String(prev[rowIndex]?.product_description || '').trim()
        if (filled && norm(filled) !== norm(val)) {
          list = [...prev, { product_description: '', pieces: '', weight_kg: '', note: '' }]
          rowIndex = list.length - 1
        }
      }

      const next = list.map((r, i) => {
        if (i !== rowIndex) return r
        if (rowKey === 'pieces' || rowKey === 'weight_kg' || rowKey === 'volume_liters') {
          const n = extractNumber(val)
          const v =
            n != null ? String(rowKey === 'pieces' ? Math.round(n) : n) : val
          return { ...r, [rowKey]: v }
        }
        return { ...r, [rowKey]: val }
      })

      outIndex = rowIndex
      outMessage = `${label} (riga ${rowIndex + 1}): ${val}`
      return next
    })

    setVoiceRowIndex?.(outIndex)
    const focusId =
      rowKey === 'note'
        ? `order-line-note-${outIndex}`
        : rowKey === 'product_description'
          ? `order-line-prod-${outIndex}`
          : rowKey === 'pieces'
            ? `order-line-pcs-${outIndex}`
            : rowKey === 'volume_liters'
              ? `order-line-lit-${outIndex}`
              : `order-line-kg-${outIndex}`

    return {
      ok: true,
      message: outMessage,
      fieldId,
      rowIndex: outIndex,
      focusId,
    }
  }

  return { ok: false, message: 'Campo non gestito', fieldId }
}

export function getOrderFieldLabel(fieldId) {
  return ORDER_VOICE_FIELD_DEFS.find((d) => d.id === fieldId)?.label || fieldId || ''
}
