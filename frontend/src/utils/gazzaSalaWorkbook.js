/**
 * Gazza Ladra — modello sala Excel (15 tavoli).
 * UI: intestazione verde, righe dati bianche, riga totali gialla.
 */

export const GAZZA_SALA_TABLE_COUNT = 15
export const GAZZA_SALA_WORKBOOK_TITLE = 'Gazza Ladra · Sala 15 tavoli'

export const GAZZA_SALA_FASCE = [
  { id: 'pranzo', label: 'Pranzo' },
  { id: 'cena', label: 'Cena' },
]

export const GAZZA_SALA_STATUS_OPTIONS = [
  { value: 'libero', label: 'Libero' },
  { value: 'occupato', label: 'Occupato' },
  { value: 'conto', label: 'Conto' },
  { value: 'pagato', label: 'Pagato' },
  { value: 'chiuso', label: 'Chiuso' },
]

export const GAZZA_SALA_PAYMENT_OPTIONS = [
  { value: '', label: '—' },
  { value: 'contanti', label: 'Contanti' },
  { value: 'carta', label: 'Carta' },
  { value: 'misto', label: 'Misto' },
  { value: 'altro', label: 'Altro' },
]

/** @typedef {'yellow'|'green'|''} HeaderTone */

/**
 * @type {Array<{
 *   id: string,
 *   label: string,
 *   width: number,
 *   numeric?: boolean,
 *   sticky?: 'left',
 *   emphasis?: boolean,
 *   editable?: boolean,
 *   readonly?: boolean,
 *   inputType?: 'text'|'number'|'select',
 *   options?: Array<{value: string, label: string}>,
 *   headerTone?: HeaderTone,
 *   step?: string,
 * }>}
 */
export const GAZZA_SALA_COLUMNS = [
  {
    id: 'table_id',
    label: 'ID tavolo',
    width: 6,
    fluid: true,
    sticky: 'left',
    emphasis: true,
    readonly: true,
  },
  {
    id: 'status',
    label: 'Stato',
    width: 10,
    fluid: true,
    editable: true,
    inputType: 'select',
    options: GAZZA_SALA_STATUS_OPTIONS,
  },
  {
    id: 'clients',
    label: 'N. clienti',
    width: 7,
    fluid: true,
    numeric: true,
    editable: true,
    inputType: 'number',
    step: '1',
  },
  {
    id: 'menu',
    label: 'Menu',
    width: 14,
    fluid: true,
    editable: true,
    inputType: 'text',
  },
  {
    id: 'invoice_number',
    label: 'Fattura numero',
    width: 11,
    fluid: true,
    editable: true,
    inputType: 'text',
  },
  {
    id: 'waiter',
    label: 'Cameriere',
    width: 11,
    fluid: true,
    editable: true,
    inputType: 'text',
  },
  {
    id: 'note',
    label: 'Note',
    width: 17,
    fluid: true,
    editable: true,
    inputType: 'text',
  },
  {
    id: 'payment_type',
    label: 'Metodo pagamento',
    width: 12,
    fluid: true,
    editable: true,
    inputType: 'select',
    options: GAZZA_SALA_PAYMENT_OPTIONS,
  },
  {
    id: 'paid',
    label: 'Conto totale pagato €',
    width: 12,
    fluid: true,
    numeric: true,
    editable: true,
    inputType: 'number',
    step: '0.01',
  },
]

export function headerToneClass(tone) {
  if (tone === 'yellow') return 'pagamenti-hl-yellow'
  if (tone === 'green') return 'pagamenti-hl-green'
  return ''
}

function emptyTableRow(tableId) {
  return {
    table_id: tableId,
    status: 'libero',
    clients: '',
    menu: '',
    invoice_number: '',
    payment_type: '',
    paid: '',
    waiter: '',
    note: '',
  }
}

/** 15 righe fisse (tavoli 1–15). */
export function createEmptyGazzaSalaRows() {
  return Array.from({ length: GAZZA_SALA_TABLE_COUNT }, (_, i) => emptyTableRow(i + 1))
}

/**
 * Unisce dati salvati con i 15 tavoli (mantiene ID 1–15).
 * Migra fogli vecchi: bill → invoice_number, residual ignorato.
 * @param {unknown} saved
 */
export function normalizeGazzaSalaRows(saved) {
  const byId = new Map()
  if (Array.isArray(saved)) {
    for (const row of saved) {
      const id = Number(row?.table_id)
      if (!Number.isFinite(id) || id < 1 || id > GAZZA_SALA_TABLE_COUNT) continue
      const invoice =
        row.invoice_number != null && String(row.invoice_number).trim() !== ''
          ? String(row.invoice_number)
          : row.bill != null && String(row.bill).trim() !== ''
            ? String(row.bill)
            : ''
      byId.set(id, {
        ...emptyTableRow(id),
        status: row.status || 'libero',
        clients: row.clients != null && row.clients !== '' ? String(row.clients) : '',
        menu: row.menu != null ? String(row.menu) : '',
        invoice_number: invoice,
        payment_type: row.payment_type != null ? String(row.payment_type) : '',
        paid: row.paid != null && row.paid !== '' ? String(row.paid) : '',
        waiter: row.waiter != null ? String(row.waiter) : '',
        note: row.note != null ? String(row.note) : '',
      })
    }
  }
  return createEmptyGazzaSalaRows().map((base) => byId.get(base.table_id) || base)
}

function num(value) {
  if (value == null || value === '') return 0
  const n = Number(String(value).replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

function formatEur(value) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) return ''
  return Number(value).toLocaleString('it-IT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function statusLabel(value) {
  return GAZZA_SALA_STATUS_OPTIONS.find((o) => o.value === value)?.label || value || ''
}

function paymentLabel(value) {
  return GAZZA_SALA_PAYMENT_OPTIONS.find((o) => o.value === value)?.label || value || ''
}

/**
 * @param {Record<string, unknown>} row
 * @param {{ id: string }} column
 */
export function gazzaSalaCellDisplay(row, column) {
  switch (column.id) {
    case 'table_id':
      return String(row.table_id ?? '')
    case 'status':
      return statusLabel(row.status)
    case 'clients':
      return row.clients === '' || row.clients == null ? '' : String(row.clients)
    case 'menu':
      return row.menu != null ? String(row.menu) : ''
    case 'invoice_number':
      return row.invoice_number != null ? String(row.invoice_number) : ''
    case 'payment_type':
      return paymentLabel(row.payment_type)
    case 'paid':
      return row.paid === '' || row.paid == null ? '' : String(row.paid)
    case 'waiter':
      return row.waiter != null ? String(row.waiter) : ''
    case 'note':
      return row.note != null ? String(row.note) : ''
    default:
      return ''
  }
}

export function gazzaSalaTotals(rows) {
  const list = Array.isArray(rows) ? rows : []
  const clients = list.reduce((s, r) => s + num(r.clients), 0)
  const paid = list.reduce((s, r) => s + num(r.paid), 0)
  const invoices = list.filter(
    (r) => r.invoice_number != null && String(r.invoice_number).trim() !== '',
  ).length
  const occupied = list.filter((r) => r.status && r.status !== 'libero').length
  return {
    count: list.length,
    occupied,
    clients,
    paid,
    invoices,
  }
}

export function gazzaSalaTotalsLabel(columnId, totals) {
  if (columnId === 'table_id') return `TOT (${totals.count})`
  if (columnId === 'status') return `${totals.occupied} attivi`
  if (columnId === 'clients') return String(totals.clients || '')
  if (columnId === 'invoice_number') return totals.invoices ? String(totals.invoices) : ''
  if (columnId === 'paid') return formatEur(totals.paid)
  return ''
}

/** @deprecated residuo rimosso dalla griglia */
export function gazzaSalaResidual() {
  return null
}

/** @deprecated */
export function residualToneClass() {
  return ''
}

/** Chiave localStorage per data + fascia. */
export function gazzaSalaStorageKey(date, fascia) {
  return `gazza_sala_tables:${date}:${fascia}`
}

/**
 * Foglio Excel (AOA) per export.
 * @param {Array<Record<string, unknown>>} rows
 * @param {{ date: string, fascia: string }} meta
 */
export function gazzaSalaRowsToAoa(rows, meta) {
  const headers = GAZZA_SALA_COLUMNS.map((c) => c.label)
  const body = normalizeGazzaSalaRows(rows).map((row) =>
    GAZZA_SALA_COLUMNS.map((col) => {
      if (col.id === 'status') return statusLabel(row.status)
      if (col.id === 'payment_type') return paymentLabel(row.payment_type) || null
      if (col.id === 'clients' || col.id === 'paid') {
        const v = num(row[col.id])
        return row[col.id] === '' || row[col.id] == null ? null : v
      }
      const text = row[col.id]
      return text == null || text === '' ? null : text
    }),
  )
  const totals = gazzaSalaTotals(rows)
  const totRow = GAZZA_SALA_COLUMNS.map((col) => {
    const label = gazzaSalaTotalsLabel(col.id, totals)
    if (col.id === 'paid') return totals.paid || null
    if (col.id === 'clients') return totals.clients || null
    if (col.id === 'invoice_number') return totals.invoices || null
    return label || null
  })
  return [
    [`Gazza Ladra — Sala`, meta.date || '', meta.fascia === 'cena' ? 'Cena' : 'Pranzo'],
    [],
    headers,
    ...body,
    totRow,
  ]
}
