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

export function fetchStaffPayrollMonths() {
  return apiFetch('/staff/payroll-months')
}

export function fetchStaffPayrollMonth(id) {
  return apiFetch(`/staff/payroll-months/${id}`)
}

export function createStaffPayrollMonth(data) {
  return apiFetch('/staff/payroll-months', { method: 'POST', body: JSON.stringify(data) })
}

export function updateStaffPayrollMonth(id, data) {
  return apiFetch(`/staff/payroll-months/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

export function deleteStaffPayrollMonth(id) {
  return apiFetch(`/staff/payroll-months/${id}`, { method: 'DELETE' })
}

export function fetchStaffLocalePacks() {
  return apiFetch('/staff/locale-packs')
}

export function fetchStaffLocalePack(localeName) {
  const q = new URLSearchParams({ name: String(localeName || '').trim() })
  return apiFetch(`/staff/locale-packs/detail?${q}`)
}

export function upsertStaffLocalePack(localeName, members) {
  return apiFetch('/staff/locale-packs', {
    method: 'PUT',
    body: JSON.stringify({ locale_name: String(localeName || '').trim(), members }),
  })
}

export function fetchStaffBackups(section) {
  const q = new URLSearchParams({ section: String(section || '').trim() })
  return apiFetch(`/staff/backups?${q}`)
}

export function fetchStaffBackupDetail(section, key) {
  const q = new URLSearchParams({
    section: String(section || '').trim(),
    key: String(key || '').trim(),
  })
  return apiFetch(`/staff/backups/detail?${q}`)
}

export function upsertStaffBackup(section, key, payload) {
  return apiFetch('/staff/backups', {
    method: 'PUT',
    body: JSON.stringify({
      section: String(section || '').trim(),
      backup_key: String(key || '').trim(),
      payload,
    }),
  })
}
