import { apiFetch } from './api'

export function fetchStaffMembers() {
  return apiFetch('/staff/members')
}

export function createStaffMember(data) {
  return apiFetch('/staff/members', { method: 'POST', body: JSON.stringify(data) })
}

export function updateStaffMember(id, data) {
  return apiFetch(`/staff/members/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

export function deleteStaffMember(id) {
  return apiFetch(`/staff/members/${id}`, { method: 'DELETE' })
}

/** Elimina tutti i dipendenti e le voci di pianificazione collegate. */
export function deleteAllStaffMembers() {
  return apiFetch('/staff/members/bulk', { method: 'DELETE' })
}

export function fetchStaffShifts(from, to) {
  const q = new URLSearchParams({ from, to })
  return apiFetch(`/staff/shifts?${q}`)
}

export function createStaffShift(data) {
  return apiFetch('/staff/shifts', { method: 'POST', body: JSON.stringify(data) })
}

export function updateStaffShift(id, data) {
  return apiFetch(`/staff/shifts/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

export function deleteStaffShift(id) {
  return apiFetch(`/staff/shifts/${id}`, { method: 'DELETE' })
}

/** Elimina tutte le voci di pianificazione nell'intervallo (es. settimana corrente). */
export function deleteStaffShiftsBulk(from, to) {
  const q = new URLSearchParams({ from, to })
  return apiFetch(`/staff/shifts/bulk?${q}`, { method: 'DELETE' })
}
