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

export { WORKBOOK_KEY }
