import { apiFetch, API_BASE_URL } from './api'

export async function fetchSuppliers() {
  return apiFetch('/suppliers')
}

export async function createSupplier(data) {
  return apiFetch('/suppliers', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function updateSupplier(id, data) {
  return apiFetch(`/suppliers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  })
}

export async function deleteSupplier(id) {
  const res = await fetch(`${API_BASE_URL}/suppliers/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Errore eliminazione fornitore')
}

export async function deleteAllSuppliers() {
  return apiFetch('/suppliers/all', { method: 'DELETE' })
}

