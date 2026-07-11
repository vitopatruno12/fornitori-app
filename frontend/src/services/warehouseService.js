import { apiFetch } from './api'

export async function createWarehouseMovement(payload) {
  return apiFetch('/warehouse/movements', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export async function fetchWarehouseMovements({ movementType, location, dateFrom, dateTo, limit } = {}) {
  const q = new URLSearchParams()
  if (movementType === 'in' || movementType === 'out') q.set('movement_type', movementType)
  if (location) q.set('location', location)
  if (dateFrom) q.set('date_from', dateFrom)
  if (dateTo) q.set('date_to', dateTo)
  if (limit) q.set('limit', String(limit))
  const qs = q.toString()
  return apiFetch(`/warehouse/movements${qs ? `?${qs}` : ''}`)
}

export async function deleteWarehouseMovement(id) {
  return apiFetch(`/warehouse/movements/${id}`, { method: 'DELETE' })
}
