import { apiFetch, apiUrl, API_BASE_URL } from './api'

export async function fetchInvoices(params = {}) {
  const searchParams = new URLSearchParams()
  if (params.supplier_id) searchParams.append('supplier_id', String(params.supplier_id))
  if (params.due_filter) searchParams.append('due_filter', params.due_filter)
  if (params.include_ignored) searchParams.append('include_ignored', 'true')
  const query = searchParams.toString()
  const path = query ? `/invoices?${query}` : '/invoices'
  return apiFetch(path)
}

export async function fetchInvoicesAnalyticsSummary() {
  return apiFetch('/invoices/analytics/summary')
}

export async function createInvoice(formData) {
  const response = await fetch(apiUrl('/invoices'), {
    method: 'POST',
    body: formData,
  })
  if (!response.ok) {
    throw new Error('Errore nel salvataggio fattura')
  }
  return response.json()
}

export async function updateInvoice(id, formData) {
  const response = await fetch(apiUrl(`/invoices/${id}`), {
    method: 'PUT',
    body: formData,
  })
  if (!response.ok) {
    throw new Error("Errore nell'aggiornamento fattura")
  }
  return response.json()
}

export async function deleteInvoice(id) {
  const response = await fetch(apiUrl(`/invoices/${id}`), {
    method: 'DELETE',
  })
  if (!response.ok) {
    throw new Error("Errore nell'eliminazione fattura")
  }
}

export async function markInvoicePaid(id) {
  const response = await fetch(apiUrl(`/invoices/${id}/mark-paid`), {
    method: 'POST',
  })
  if (!response.ok) {
    throw new Error('Errore nel saldo fattura')
  }
  return response.json()
}

export async function setInvoiceIgnored(id, ignored) {
  const response = await fetch(
    apiUrl(`/invoices/${id}/ignore?ignored=${ignored ? 'true' : 'false'}`),
    { method: 'POST' },
  )
  if (!response.ok) {
    throw new Error('Errore aggiornamento scadenziario')
  }
  return response.json()
}

export function getInvoicesExportUrl(supplierId) {
  const params = new URLSearchParams()
  if (supplierId) params.append('supplier_id', String(supplierId))
  const q = params.toString()
  return `${API_BASE_URL}/invoices/export/csv${q ? '?' + q : ''}`
}

export async function postSdiReceiveXml(file, messageId = '') {
  const xmlText = await file.text()
  const headers = { 'Content-Type': 'application/xml; charset=utf-8' }
  if (messageId) headers['X-SDI-Message-Id'] = messageId
  const response = await fetch(apiUrl('/sdi/receive'), {
    method: 'POST',
    body: xmlText,
    headers,
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || 'Errore import XML SDI')
  }
  const ct = response.headers.get('content-type') || ''
  if (ct.includes('application/json')) return response.json()
  return { ok: true }
}

export async function fetchSdiStatus() {
  return apiFetch('/sdi/status')
}

export async function fetchSdiReceivedInvoices(params = {}) {
  const search = new URLSearchParams()
  if (params.days) search.append('days', String(params.days))
  const query = search.toString()
  const path = query ? `/sdi/invoices/received?${query}` : '/sdi/invoices/received'
  return apiFetch(path)
}

export function getSdiInvoiceDownloadUrl(invoiceId) {
  return apiUrl(`/sdi/invoices/${invoiceId}/download`)
}

export async function assignSdiInvoiceSection(invoiceId, section) {
  const search = new URLSearchParams({
    invoice_id: String(invoiceId),
    section: String(section),
  })
  return apiFetch(`/sdi/invoices/assign?${search.toString()}`, { method: 'POST' })
}

