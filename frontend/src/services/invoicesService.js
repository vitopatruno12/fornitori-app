import { apiFetch, API_BASE_URL } from './api'

export async function fetchInvoices(params = {}) {
  const searchParams = new URLSearchParams()
  if (params.supplier_id) searchParams.append('supplier_id', String(params.supplier_id))
  if (params.due_filter) searchParams.append('due_filter', params.due_filter)
  if (params.include_ignored) searchParams.append('include_ignored', 'true')
  const query = searchParams.toString()
  const path = query ? `/invoices?${query}` : '/invoices'
  return apiFetch(path)
}

export async function createInvoice(formData) {
  const response = await fetch(`${API_BASE_URL}/invoices`, {
    method: 'POST',
    body: formData,
  })
  if (!response.ok) {
    throw new Error('Errore nel salvataggio fattura')
  }
  return response.json()
}

export async function updateInvoice(id, formData) {
  const response = await fetch(`${API_BASE_URL}/invoices/${id}`, {
    method: 'PUT',
    body: formData,
  })
  if (!response.ok) {
    throw new Error('Errore nell\'aggiornamento fattura')
  }
  return response.json()
}

export async function deleteInvoice(id) {
  const response = await fetch(`${API_BASE_URL}/invoices/${id}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    throw new Error('Errore nell\'eliminazione fattura')
  }
}

export async function markInvoicePaid(id) {
  const response = await fetch(`${API_BASE_URL}/invoices/${id}/mark-paid`, {
    method: 'POST',
  })
  if (!response.ok) {
    throw new Error('Errore nel saldo fattura')
  }
  return response.json()
}

export async function setInvoiceIgnored(id, ignored) {
  const response = await fetch(`${API_BASE_URL}/invoices/${id}/ignore?ignored=${ignored ? 'true' : 'false'}`, {
    method: 'POST',
  })
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

