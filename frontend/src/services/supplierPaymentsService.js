import { apiFetch } from './api'

const WORKBOOK_KEY = 'risacca_2026'

export async function fetchSupplierPaymentsWorkbook(workbookKey = WORKBOOK_KEY) {
  const q = new URLSearchParams({ workbook_key: workbookKey })
  return apiFetch(`/supplier-payments/workbook?${q}`)
}

export async function saveSupplierPaymentsWorkbook(payload) {
  return apiFetch('/supplier-payments/workbook', {
    method: 'PUT',
    body: JSON.stringify({
      workbook_key: WORKBOOK_KEY,
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

export { WORKBOOK_KEY }
