export const VNE_OPERATIONS_WORKBOOK_TITLE = 'Operazioni VNE'

export const VNE_OPERATIONS_COLUMNS = [
  { id: 'row', label: '#', numeric: true, width: 5, sticky: 'left', fluid: true },
  { id: 'when_text', label: 'Data inizio', width: 16, fluid: true },
  { id: 'operation_type', label: 'Tipo operazione', width: 22, emphasis: true, fluid: true },
  { id: 'end_when_text', label: 'Data fine', width: 16, fluid: true },
  { id: 'executed_by', label: 'Utente', width: 16, fluid: true },
  { id: 'value_eur', label: 'Valore (€)', numeric: true, width: 12, fluid: true },
  { id: 'comment', label: 'Commento', width: 13, multiline: true, fluid: true },
]

export const VNE_CLOSINGS_WORKBOOK_TITLE = 'Chiusure di cassa VNE'

export const VNE_CLOSINGS_COLUMNS = [
  { id: 'row', label: '#', numeric: true, width: 5, sticky: 'left', fluid: true },
  { id: 'when_text', label: 'Data inizio', width: 16, fluid: true },
  { id: 'end_when_text', label: 'Data fine', width: 16, fluid: true },
  { id: 'operator', label: 'Operatore', width: 14, emphasis: true, fluid: true },
  { id: 'total_eur', label: 'Totale (€)', numeric: true, width: 12, fluid: true },
  { id: 'raw_block', label: 'Dettaglio', width: 37, multiline: true, fluid: true },
]

export const VNE_KEY_VALUE_WORKBOOK_TITLE = 'Dettaglio VNE'

export const VNE_KEY_VALUE_COLUMNS = [
  { id: 'row', label: '#', numeric: true, width: 5, sticky: 'left', fluid: true },
  { id: 'section', label: 'Sezione', width: 16, emphasis: true, fluid: true },
  { id: 'attribute', label: 'Attributo', width: 24, fluid: true },
  { id: 'value', label: 'Valore', width: 55, fluid: true, multiline: true },
]

const SECTION_LABELS = {
  monete: 'Monete',
  banconote: 'Banconote',
  pagamenti: 'Pagamenti',
  pagamento_manuale: 'Pagamento manuale',
  rimborso: 'Rimborso',
  riepilogo: 'Riepilogo',
  prelievi: 'Prelievi',
}

export function vneSectionLabel(key) {
  return SECTION_LABELS[key] || key
}

function formatEur(value) {
  if (value == null || Number.isNaN(Number(value))) return ''
  return Number(value).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function text(value) {
  if (value == null || value === '') return ''
  return String(value)
}

function statusMoneteDettaglio(status) {
  if (Array.isArray(status?.monete_dettaglio) && status.monete_dettaglio.length > 0) {
    return status.monete_dettaglio
  }
  if (Array.isArray(status?.hopper?.monete) && status.hopper.monete.length > 0) {
    return status.hopper.monete
  }
  return []
}

/**
 * @param {Record<string, unknown>} row
 * @param {{ id: string }} column
 * @param {{ rowIndex?: number }} ctx
 */
export function vneOperationCellValue(row, column, ctx = {}) {
  const { rowIndex = 0 } = ctx
  switch (column.id) {
    case 'row':
      return String(rowIndex + 1)
    case 'when_text':
      return text(row.when_text)
    case 'end_when_text':
      return text(row.end_when_text || row.when_text)
    case 'operation_type':
      return text(row.operation_type)
    case 'value_eur':
      return row.value_eur != null ? formatEur(row.value_eur) : ''
    case 'comment':
      return text(row.comment)
    case 'executed_by':
      return text(row.executed_by)
    default:
      return ''
  }
}

export function vneOperationsTotals(rows) {
  const list = Array.isArray(rows) ? rows : []
  const total = list.reduce((sum, row) => sum + (Number(row.value_eur) || 0), 0)
  return {
    count: list.length,
    value_eur: total > 0 ? formatEur(total) : '',
  }
}

export function vneOperationsTotalsLabel(columnId, totals) {
  if (columnId === 'operation_type') return `TOTALI (${totals.count})`
  if (columnId === 'value_eur') return totals.value_eur
  return ''
}

/**
 * @param {Record<string, unknown>} row
 * @param {{ id: string }} column
 * @param {{ rowIndex?: number }} ctx
 */
export function vneClosingCellValue(row, column, ctx = {}) {
  const { rowIndex = 0 } = ctx
  switch (column.id) {
    case 'row':
      return String(rowIndex + 1)
    case 'when_text':
      return text(row.when_text)
    case 'end_when_text':
      return text(row.end_when_text || row.when_text)
    case 'operator':
      return text(row.operator)
    case 'total_eur':
      return row.total_eur != null ? formatEur(row.total_eur) : ''
    case 'raw_block':
      return text(row.raw_block)
    default:
      return ''
  }
}

export function vneClosingsTotals(rows) {
  const list = Array.isArray(rows) ? rows : []
  const total = list.reduce((sum, row) => sum + (Number(row.total_eur) || 0), 0)
  return {
    count: list.length,
    total_eur: total > 0 ? formatEur(total) : '',
  }
}

export function vneClosingsTotalsLabel(columnId, totals) {
  if (columnId === 'operator') return `TOTALI (${totals.count})`
  if (columnId === 'total_eur') return totals.total_eur
  if (columnId === 'when_text') return 'TOTALI'
  return ''
}

/**
 * @param {Record<string, unknown>} row
 * @param {{ id: string }} column
 * @param {{ rowIndex?: number }} ctx
 */
export function vneKeyValueCellValue(row, column, ctx = {}) {
  const { rowIndex = 0 } = ctx
  switch (column.id) {
    case 'row':
      return String(rowIndex + 1)
    case 'section':
      return text(row.section)
    case 'attribute':
      return text(row.attribute)
    case 'value':
      return text(row.value)
    default:
      return ''
  }
}

export function vneKeyValueTotalsLabel(columnId, count) {
  if (columnId === 'section') return `TOTALI (${count})`
  return ''
}

export function flattenVneContabilitaRows(contabilita) {
  const rows = []
  for (const [sectionKey, items] of Object.entries(contabilita?.sections || {})) {
    const section = vneSectionLabel(sectionKey)
    const list = Array.isArray(items) ? items : []
    if (list.length === 0) {
      rows.push({ section, attribute: '—', value: '—' })
      continue
    }
    for (const item of list) {
      rows.push({
        section,
        attribute: item.label || '—',
        value:
          item.value_eur != null
            ? `${formatEur(item.value_eur)} €`
            : text(item.raw_value) || '—',
      })
    }
  }
  return rows
}

export function flattenVneStatusRows(status) {
  if (!status) return []
  const rows = []
  const push = (section, attribute, value) => {
    rows.push({
      section,
      attribute,
      value: value == null || value === '' ? '—' : String(value),
    })
  }

  push('Stato', 'Titolo', status.title || 'Stato')

  push('Accettatore JCM', 'Presente', status.accettatore?.presente)
  push('Accettatore JCM', 'Errore', status.accettatore?.errore)
  push('Accettatore JCM', 'Firmware', status.accettatore?.firmware)

  if (status.cassette?.length) {
    for (const c of status.cassette) {
      push(
        'Cassette',
        `Cassetta ${c.cassetta}`,
        `presente ${c.presente}, taglio ${c.taglio_eur} € — ${c.banconote} banconote — ${c.totale_eur} €`,
      )
    }
  } else {
    push('Cassette', 'Dettaglio', 'Nessuna cassetta rilevata')
  }

  push('Contenuto stacker', 'Totale stacker', status.contenuto_stacker_eur != null ? `${formatEur(status.contenuto_stacker_eur)} €` : '—')
  if (status.stacker_banconote?.length) {
    for (const b of status.stacker_banconote) {
      push('Contenuto stacker', `${b.taglio_eur} €`, `${b.quantita} banconote`)
    }
  } else {
    push('Contenuto stacker', 'Dettaglio banconote', 'Nessun dettaglio stacker')
  }

  push('Hopper', 'Smart Hopper 1', status.hopper?.smart_hopper_1_eur != null ? `${status.hopper.smart_hopper_1_eur} €` : '—')
  push('Hopper', 'Firmware hopper', status.hopper?.firmware)

  const moneteDettaglio = statusMoneteDettaglio(status)
  if (moneteDettaglio.length) {
    for (const m of moneteDettaglio) {
      push('Quantità monete', `${m.taglio_eur} €`, `${m.quantita} monete`)
    }
  } else {
    push('Quantità monete', 'Dettaglio', 'Nessun dettaglio monete')
  }

  if (status.hopper?.units?.length) {
    for (const u of status.hopper.units) {
      push(
        'Hopper unità',
        `Hopper ${u.hopper}`,
        `Presente ${u.presente} — Errore ${u.errore} — Vuoto ${u.vuoto} — Pieno ${u.pieno}`,
      )
    }
  } else {
    push('Hopper unità', 'Dettaglio', 'Nessun hopper rilevato')
  }

  push('Riepilogo', 'Totale cassa', status.totale_cassa_eur != null ? `${formatEur(status.totale_cassa_eur)} €` : '—')
  push('Riepilogo', 'Banconote', status.banconote_eur != null ? `${formatEur(status.banconote_eur)} €` : '—')
  push('Riepilogo', 'Monete', status.monete_eur != null ? `${formatEur(status.monete_eur)} €` : '—')
  push('Riepilogo', 'Totale', status.totale_eur != null ? `${formatEur(status.totale_eur)} €` : '—')
  push('Aggiornamento', 'Ultimo aggiornamento', status.updated_at_text)

  return rows
}
