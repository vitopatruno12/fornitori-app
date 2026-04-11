import { apiFetch, API_BASE_URL } from './api'

export async function createSupplierOrder(payload) {
  return apiFetch('/supplier-orders', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function updateSupplierOrder(id, payload) {
  return apiFetch(`/supplier-orders/${id}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
}

export async function deleteSupplierOrder(id) {
  return apiFetch(`/supplier-orders/${id}`, {
    method: 'DELETE',
  })
}

export async function fetchSupplierOrders({ supplierId, dateFrom, dateTo, status, limit } = {}) {
  const q = new URLSearchParams()
  if (supplierId) q.set('supplier_id', String(supplierId))
  if (dateFrom) q.set('date_from', dateFrom)
  if (dateTo) q.set('date_to', dateTo)
  if (status === 'pending' || status === 'sent') q.set('status', status)
  if (limit) q.set('limit', String(limit))
  const qs = q.toString()
  return apiFetch(`/supplier-orders${qs ? `?${qs}` : ''}`)
}

/** URL assoluto per scaricare il PDF ordine (apri in nuova scheda o link). */
export function supplierOrderPdfUrl(orderId) {
  return `${API_BASE_URL}/supplier-orders/${orderId}/pdf`
}

export async function fetchSupplierOrder(id) {
  return apiFetch(`/supplier-orders/${id}`)
}
