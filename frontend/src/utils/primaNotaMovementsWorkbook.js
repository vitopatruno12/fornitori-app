const CONTO_NON_FISCALE = 'NON_FISCALE'
const CONTO_POS = 'POS'
const CONTO_FATTURE_EMESSE = 'FATTURE_EMESSE'
const CONTO_CONTANTI = 'CONTANTI'
const CONTO_REFILL = 'REFILL'
const CONTO_STACKER_SVUOTAMENTO = 'SVUOTAMENTO_STACKER'
const CONTO_VERSAMENTO_BANCA = 'VERSAMENTO_BANCA'
const CONTO_MOVIMENTO_CASSETTO = 'MOVIMENTO_CASSETTO'

export const PRIMA_NOTA_MOVEMENTS_WORKBOOK_TITLE = 'Movimenti cassa'

export const PRIMA_NOTA_MOVEMENTS_COLUMNS = [
  { id: 'row', label: '#', numeric: true, width: 44, sticky: 'left' },
  { id: 'registro', label: 'Registro', width: 120, sticky: 'left' },
  { id: 'entry_date', label: 'Data', width: 110 },
  { id: 'description', label: 'Operazioni', width: 240, emphasis: true },
  { id: 'entrata', label: 'Cassa entrata', numeric: true, width: 110 },
  { id: 'uscita', label: 'Cassa uscita', numeric: true, width: 110 },
  { id: 'fiscale_ent', label: 'Fiscale ent', numeric: true, width: 100 },
  { id: 'fiscale_usc', label: 'Fiscale usc', numeric: true, width: 100 },
  { id: 'non_fiscale_ent', label: 'NC ent', numeric: true, width: 90 },
  { id: 'non_fiscale_usc', label: 'NC usc', numeric: true, width: 90 },
  { id: 'pos', label: 'POS', numeric: true, width: 90 },
  { id: 'fatture_emesse', label: 'Fatture emesse', numeric: true, width: 120 },
  { id: 'refill', label: 'Refill', numeric: true, width: 90 },
  { id: 'stacker_svuotamento', label: 'Stacker', numeric: true, width: 90 },
  { id: 'incasso', label: 'Totale', numeric: true, width: 110, tone: (row) => movementIncassoTone(row) },
  { id: 'cassa_mattina', label: 'Cassa iniziale', numeric: true, width: 120 },
  { id: 'cassa_sera', label: 'Saldo cassa progressivo', numeric: true, width: 150 },
  { id: 'versamento_banca', label: 'Versamento banca', numeric: true, width: 130 },
  { id: 'movimento_cassetto', label: 'Cassetto', numeric: true, width: 110 },
]

function formatDate(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString('it-IT')
}

function formatTime(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
}

function formatAmount(value) {
  if (value == null) return ''
  const n = Number(value)
  if (Number.isNaN(n)) return ''
  return n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatAmountClean(value) {
  const n = Number(value || 0)
  if (!Number.isFinite(n) || Math.abs(n) < 0.005) return ''
  return formatAmount(n)
}

export function isAutoPrimaNotaEntry(entry) {
  const note = String(entry?.note || '')
  const desc = String(entry?.description || '')
  return note.includes('[auto-chiusura]') || /\(\s*A\s*\)/.test(desc)
}

function formatFlowAmount(value, entry) {
  const formatted = formatAmountClean(value)
  if (!formatted) return ''
  return isAutoPrimaNotaEntry(entry) ? `${formatted} (A)` : formatted
}

function isNonFiscaleEntry(entry) {
  return entry?.conto === CONTO_NON_FISCALE
}

function isPosEntry(entry) {
  return entry?.conto === CONTO_POS
}

function isFattureEmesseEntry(entry) {
  return entry?.conto === CONTO_FATTURE_EMESSE
}

function isContantiEntry(entry) {
  return entry?.conto === CONTO_CONTANTI
}

function isRefillEntry(entry) {
  return entry?.conto === CONTO_REFILL
}

function isStackerSvuotamentoEntry(entry) {
  return entry?.conto === CONTO_STACKER_SVUOTAMENTO
}

function isVersamentoBancaEntry(entry) {
  return entry?.conto === CONTO_VERSAMENTO_BANCA
}

function isMovimentoCassettoEntry(entry) {
  return entry?.conto === CONTO_MOVIMENTO_CASSETTO
}

export function isExtraCassaMovement(entry) {
  return isPosEntry(entry) || isRefillEntry(entry) || isFattureEmesseEntry(entry)
}

function movementDescription(entry) {
  let text = String(entry.description || '').trim()
  if (entry.riferimento_documento) {
    text = text ? `${text} · ${entry.riferimento_documento}` : String(entry.riferimento_documento)
  }
  if (isNonFiscaleEntry(entry)) text = text ? `${text} [NC]` : '[NC]'
  else if (isPosEntry(entry)) text = text ? `${text} [POS]` : '[POS]'
  else if (isFattureEmesseEntry(entry)) text = text ? `${text} [Fatture emesse]` : '[Fatture emesse]'
  else if (isContantiEntry(entry)) text = text ? `${text} [Contanti]` : '[Contanti]'
  else if (isRefillEntry(entry)) text = text ? `${text} [Refill]` : '[Refill]'
  else if (isStackerSvuotamentoEntry(entry)) text = text ? `${text} [Stacker]` : '[Stacker]'
  else if (isVersamentoBancaEntry(entry)) text = text ? `${text} [Banca]` : '[Banca]'
  else if (isMovimentoCassettoEntry(entry)) text = text ? `${text} [Cassetto]` : '[Cassetto]'
  return text
}

const SEARCH_NOISE = new Set(['euro', 'eur', '€', 'e', 'di', 'da', 'del', 'della', 'con'])

function parseSearchAmount(token) {
  const raw = String(token || '').trim().replace(/\s/g, '')
  if (!raw) return null
  if (!/^\d{1,6}([.,]\d{1,2})?$/.test(raw)) return null
  const n = Number(raw.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function entrySearchAmounts(entry) {
  return [
    entry?.amount,
    entry?.entrata,
    entry?.uscita,
    entry?.fiscaleEntrata,
    entry?.fiscaleUscita,
    entry?.nonFiscaleEntrata,
    entry?.nonFiscaleUscita,
    entry?.pos,
    entry?.fattureEmesse,
    entry?.contanti,
    entry?.refill,
    entry?.stackerSvuotamento,
    entry?.versamentoBanca,
    entry?.movimentoCassetto,
    entry?.incasso,
  ].map((value) => Number(value || 0)).filter((n) => Number.isFinite(n) && Math.abs(n) >= 0.005)
}

function entrySearchText(entry) {
  return [
    entry?.description,
    entry?.riferimento_documento,
    entry?.note,
    entry?.registroLabel,
    entry?.activity,
    entry?.conto,
    entry?.type,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

/** Cerca un articolo/operazione: testo + importo (es. "latte 25"). Tutti i token devono matchare. */
export function primaNotaMovementMatchesSearch(entry, query) {
  const q = String(query || '').trim().toLowerCase().replace(/€/g, ' ')
  if (!q) return true
  const tokens = q
    .split(/[\s;+/]+/)
    .map((t) => t.trim())
    .filter((t) => t && !SEARCH_NOISE.has(t))
  if (!tokens.length) return true
  const text = entrySearchText(entry)
  const amounts = entrySearchAmounts(entry)
  return tokens.every((token) => {
    if (text.includes(token)) return true
    const n = parseSearchAmount(token)
    if (n == null) return false
    return amounts.some((amount) => Math.abs(amount - n) < 0.015)
  })
}

export function movementIncassoTone(entry) {
  if (isExtraCassaMovement(entry)) return 'workbook-cell-muted'
  if (isStackerSvuotamentoEntry(entry) || isVersamentoBancaEntry(entry)) return 'workbook-cell-alert'
  if (entry?.type === 'entrata') return 'workbook-cell-yes'
  if (entry?.type === 'uscita') return 'workbook-cell-alert'
  return ''
}

/**
 * @param {Record<string, unknown>} entry
 * @param {{ id: string }} column
 * @param {{ rowIndex?: number }} ctx
 */
export function primaNotaMovementCellValue(entry, column, ctx = {}) {
  const { rowIndex = 0 } = ctx
  switch (column.id) {
    case 'row':
      return String(rowIndex + 1)
    case 'registro':
      return String(entry.registroLabel || entry.activity || '').trim() || '—'
    case 'entry_date': {
      const date = formatDate(entry.entry_date)
      const time = formatTime(entry.entry_date)
      return time ? `${date} ${time}` : date
    }
    case 'description':
      return movementDescription(entry)
    case 'entrata':
      return entry.entrata > 0 ? formatFlowAmount(entry.entrata, entry) : ''
    case 'uscita':
      return entry.uscita > 0 ? formatFlowAmount(entry.uscita, entry) : ''
    case 'fiscale_ent':
      return formatFlowAmount(entry.fiscaleEntrata, entry)
    case 'fiscale_usc':
      return formatFlowAmount(entry.fiscaleUscita, entry)
    case 'non_fiscale_ent':
      return formatFlowAmount(entry.nonFiscaleEntrata, entry)
    case 'non_fiscale_usc':
      return formatFlowAmount(entry.nonFiscaleUscita, entry)
    case 'pos':
      return formatFlowAmount(entry.pos, entry)
    case 'fatture_emesse':
      return formatFlowAmount(entry.fattureEmesse, entry)
    case 'refill':
      return formatFlowAmount(entry.refill, entry)
    case 'stacker_svuotamento':
      return formatFlowAmount(entry.stackerSvuotamento, entry)
    case 'incasso':
      return formatFlowAmount(entry.incasso, entry) || formatAmount(entry.incasso)
    case 'cassa_mattina':
      return formatAmount(entry.cassaMattina)
    case 'cassa_sera':
      return formatAmount(entry.cassaSera)
    case 'versamento_banca':
      return formatFlowAmount(entry.versamentoBanca, entry)
    case 'movimento_cassetto':
      return formatFlowAmount(entry.movimentoCassetto, entry)
    default:
      return ''
  }
}

export function primaNotaMovementTotalsLabel(columnId, totals) {
  if (columnId === 'registro') return ''
  if (columnId === 'description') return `TOTALI (${totals.count})`
  if (columnId === 'entrata') return formatAmount(totals.entrata)
  if (columnId === 'uscita') return formatAmount(totals.uscita)
  if (columnId === 'fiscale_ent') return formatAmount(totals.fiscaleEntrata)
  if (columnId === 'fiscale_usc') return formatAmount(totals.fiscaleUscita)
  if (columnId === 'non_fiscale_ent') return formatAmount(totals.nonFiscaleEntrata)
  if (columnId === 'non_fiscale_usc') return formatAmount(totals.nonFiscaleUscita)
  if (columnId === 'pos') return formatAmount(totals.pos)
  if (columnId === 'fatture_emesse') return formatAmount(totals.fattureEmesse)
  if (columnId === 'refill') return formatAmount(totals.refill)
  if (columnId === 'stacker_svuotamento') return formatAmount(totals.stackerSvuotamento)
  if (columnId === 'versamento_banca') return formatAmount(totals.versamentoBanca)
  if (columnId === 'movimento_cassetto') return formatAmount(totals.movimentoCassetto)
  if (columnId === 'incasso') return formatAmount(totals.incasso)
  return ''
}
