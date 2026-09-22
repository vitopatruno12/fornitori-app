import { apiFetch } from './api'

/** Chiavi file fornitori per società (allineate al backend). */
export const PAGAMENTI_WORKBOOKS = [
  { key: 'mediazione_2026', label: 'File fornitori Mediazione', title: 'FILE FORNITORI_MEDIAZIONE_2026' },
  { key: 'via_lattea_2026', label: 'File fornitori Via Lattea', title: 'FILE FORNITORI_VIA_LATTEA_2026' },
  { key: 'risacca_2026', label: 'File fornitori Risacca', title: 'FILE FORNITORI_RISACCA_2026' },
  { key: 'pg_2026', label: 'File fornitori PG', title: 'FILE FORNITORI_PG_2026' },
]

export const DEFAULT_WORKBOOK_KEY = 'mediazione_2026'
const STORAGE_KEY = 'atlasPagamentiWorkbook:v1'

/** @deprecated usa DEFAULT_WORKBOOK_KEY */
export const WORKBOOK_KEY = DEFAULT_WORKBOOK_KEY

export function readPagamentiWorkbookKey() {
  try {
    const raw = String(sessionStorage.getItem(STORAGE_KEY) || '').trim()
    // Vecchio default Risacca → apri Mediazione (il foglio storico appartiene lì)
    if (raw === 'risacca_2026') {
      sessionStorage.setItem(STORAGE_KEY, DEFAULT_WORKBOOK_KEY)
      return DEFAULT_WORKBOOK_KEY
    }
    if (PAGAMENTI_WORKBOOKS.some((w) => w.key === raw)) return raw
  } catch {
    // ignore
  }
  return DEFAULT_WORKBOOK_KEY
}

export function writePagamentiWorkbookKey(workbookKey) {
  try {
    const key = String(workbookKey || '').trim()
    if (!key) sessionStorage.removeItem(STORAGE_KEY)
    else sessionStorage.setItem(STORAGE_KEY, key)
  } catch {
    // ignore
  }
}

export function workbookLabel(workbookKey) {
  const hit = PAGAMENTI_WORKBOOKS.find((w) => w.key === workbookKey)
  return hit?.label || workbookKey || '—'
}

export async function fetchPagamentiWorkbookCatalog() {
  return apiFetch('/supplier-payments/workbooks')
}

export async function fetchSupplierPaymentsWorkbook(workbookKey = readPagamentiWorkbookKey()) {
  const q = new URLSearchParams({ workbook_key: workbookKey })
  return apiFetch(`/supplier-payments/workbook?${q}`)
}

export async function saveSupplierPaymentsWorkbook(payload, workbookKey = readPagamentiWorkbookKey()) {
  return apiFetch('/supplier-payments/workbook', {
    method: 'PUT',
    body: JSON.stringify({
      workbook_key: workbookKey,
      ...payload,
    }),
  })
}

export async function fetchPagamentiWatchAgent() {
  return apiFetch('/supplier-payments/watch-agent')
}

export async function runPagamentiWatchAgent({ force = false } = {}) {
  const q = new URLSearchParams({ force: force ? 'true' : 'false' })
  return apiFetch(`/supplier-payments/watch-agent/run?${q}`, { method: 'POST' })
}
