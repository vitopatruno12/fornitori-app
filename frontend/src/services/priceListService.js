import { apiFetch, API_BASE_URL } from './api'

export async function fetchPriceList(supplierId) {
  if (!supplierId) return []
  return apiFetch(`/price-list?supplier_id=${supplierId}`)
}

export async function addPriceListItem(data) {
  return apiFetch('/price-list', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function addPriceListBatch(data) {
  return apiFetch('/price-list/batch', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function deletePriceListItem(id) {
  const res = await fetch(`${API_BASE_URL}/price-list/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Errore eliminazione voce prezzario')
}
