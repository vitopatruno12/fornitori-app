import { apiFetch, apiUrl, asArray } from './api'

export async function fetchSuppliers() {
  const data = await apiFetch('/suppliers')
  return asArray(data, 'fornitori')
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
  const res = await fetch(apiUrl(`/suppliers/${id}`), { method: 'DELETE' })
  if (!res.ok) throw new Error('Errore eliminazione fornitore')
}

export async function deleteAllSuppliers() {
  return apiFetch('/suppliers/all', { method: 'DELETE' })
}

