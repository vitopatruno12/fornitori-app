import { apiFetch, apiUrl, API_BASE_URL } from './api'

export async function fetchInvoices(params = {}) {
  const searchParams = new URLSearchParams()
  if (params.supplier_id) searchParams.append('supplier_id', String(params.supplier_id))
  if (params.due_filter) searchParams.append('due_filter', params.due_filter)
  if (params.include_ignored) searchParams.append('include_ignored', 'true')
  if (params.company) searchParams.append('company', String(params.company))
  const query = searchParams.toString()
  const path = query ? `/invoices?${query}` : '/invoices'
  return apiFetch(path)
}

export async function fetchInvoice(id) {
  return apiFetch(`/invoices/${id}`)
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

/** Import XML FatturaPA → fatture passive Atlas (senza SdI). */
export async function importInvoiceXml(file) {
  const formData = new FormData()
  formData.append('file', file)
  const response = await fetch(apiUrl('/invoices/import-xml'), {
    method: 'POST',
    body: formData,
  })
  if (!response.ok) {
    let detail = 'Errore import XML'
    try {
      const data = await response.json()
      detail = data?.detail || detail
    } catch {
      const text = await response.text().catch(() => '')
      if (text) detail = text
    }
    throw new Error(typeof detail === 'string' ? detail : 'Errore import XML')
  }
  return response.json()
}

export async function fetchIncomingInvoices(limit = 100) {
  return apiFetch(`/invoices/incoming?limit=${limit}`)
}

export async function fetchIncomingInvoice(id) {
  return apiFetch(`/invoices/incoming/${id}`)
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
  if (params.company) search.append('company', String(params.company))
  const query = search.toString()
  const path = query ? `/sdi/invoices/received?${query}` : '/sdi/invoices/received'
  return apiFetch(path)
}

export async function fetchSdiCompanies() {
  return apiFetch('/sdi/companies')
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

