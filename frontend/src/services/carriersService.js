import { apiFetch } from './api'

export function fetchCarriers(activeOnly = false) {
  const q = activeOnly ? '?active_only=true' : ''
  return apiFetch(`/carriers${q}`)
}

export function fetchCarrier(id) {
  return apiFetch(`/carriers/${id}`)
}

export function createCarrier(data) {
  return apiFetch('/carriers', { method: 'POST', body: JSON.stringify(data) })
}

export function updateCarrier(id, data) {
  return apiFetch(`/carriers/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

export function deleteCarrier(id) {
  return apiFetch(`/carriers/${id}`, { method: 'DELETE' })
}

export function setCarrierInService(id, value = true) {
  return apiFetch(`/carriers/${id}/in-service?value=${value ? 'true' : 'false'}`, { method: 'POST' })
}

export function createCarrierMaintenance(carrierId, data) {
  return apiFetch(`/carriers/${carrierId}/maintenance`, { method: 'POST', body: JSON.stringify(data) })
}

export function deleteCarrierMaintenance(logId) {
  return apiFetch(`/carriers/maintenance/${logId}`, { method: 'DELETE' })
}

export function createCarrierFuel(carrierId, data) {
  return apiFetch(`/carriers/${carrierId}/fuel-expenses`, { method: 'POST', body: JSON.stringify(data) })
}

export function deleteCarrierFuel(expenseId) {
  return apiFetch(`/carriers/fuel-expenses/${expenseId}`, { method: 'DELETE' })
}

export function createCarrierOtherExpense(carrierId, data) {
  return apiFetch(`/carriers/${carrierId}/other-expenses`, { method: 'POST', body: JSON.stringify(data) })
}

export function deleteCarrierOtherExpense(expenseId) {
  return apiFetch(`/carriers/other-expenses/${expenseId}`, { method: 'DELETE' })
}
