import { apiFetch, apiUrl, asArray } from './api'
import { formatApiError, parseApiJson } from '../offline/offlineApiHelpers'
import { getCachedResponse, isCacheableGetPath, setCachedResponse } from '../offline/offlineCache'
import { isOnline } from '../offline/offlineStatus'

/** Fetch senza cache browser: dati condivisi tra PC. */
const SYNC_FETCH = { cache: 'no-store' }

export function fetchStaffMembers() {
  return apiFetch('/staff/members')
}

export function createStaffMember(data) {
  return apiFetch('/staff/members', { method: 'POST', body: JSON.stringify(data) })
}

export function updateStaffMember(id, data) {
  return apiFetch(`/staff/members/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

function staffMemberDeleteQuery(localeName, accessCode) {
  const q = new URLSearchParams()
  const locale = String(localeName || '').trim()
  const code = String(accessCode || '').replace(/\D/g, '')
  if (locale) q.set('name', locale)
  if (code.length === 6) q.set('code', code)
  const suffix = q.toString()
  return suffix ? `?${suffix}` : ''
}

export function deleteStaffMember(id, localeName, accessCode) {
  return apiFetch(`/staff/members/${id}${staffMemberDeleteQuery(localeName, accessCode)}`, { method: 'DELETE' })
}

/** Elimina tutti i dipendenti e le voci di pianificazione collegate. */
export function deleteAllStaffMembers(localeName, accessCode) {
  return apiFetch(`/staff/members/bulk${staffMemberDeleteQuery(localeName, accessCode)}`, { method: 'DELETE' })
}

export function fetchStaffShifts(from, to) {
  const q = new URLSearchParams({ from, to })
  return apiFetch(`/staff/shifts?${q}`, SYNC_FETCH)
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

export async function fetchStaffLocalePacks() {
  const data = await apiFetch('/staff/locale-packs', SYNC_FETCH)
  return asArray(data, 'staff/locale-packs')
}

export function fetchStaffLocalePack(localeName, accessCode) {
  const q = new URLSearchParams({ name: String(localeName || '').trim() })
  const code = String(accessCode || '').replace(/\D/g, '')
  if (code.length === 6) q.set('code', code)
  return apiFetch(`/staff/locale-packs/detail?${q}`, SYNC_FETCH)
}

export function upsertStaffLocalePack(localeName, members, accessCode, options = {}) {
  const body = {
    locale_name: String(localeName || '').trim(),
    members,
  }
  const code = String(accessCode || '').replace(/\D/g, '')
  if (code.length === 6) body.access_code = code
  if (options.regenerateAccessCode) body.regenerate_access_code = true
  return apiFetch('/staff/locale-packs', {
    ...SYNC_FETCH,
    method: 'PUT',
    body: JSON.stringify(body),
  }).then((result) => {
    if (result?.__offline) {
      throw new Error('Sei offline: i dati verranno inviati al server quando torna la connessione.')
    }
    return result
  })
}

export function deleteStaffLocalePack(localeName, accessCode) {
  const q = new URLSearchParams({ name: String(localeName || '').trim() })
  const code = String(accessCode || '').replace(/\D/g, '')
  if (code.length === 6) q.set('code', code)
  return apiFetch(`/staff/locale-packs?${q}`, { ...SYNC_FETCH, method: 'DELETE' })
}

export async function fetchStaffBackups(section) {
  const q = new URLSearchParams({ section: String(section || '').trim() })
  const data = await apiFetch(`/staff/backups?${q}`, SYNC_FETCH)
  return asArray(data, 'staff/backups')
}

/** Backup assente sul server → null (404 atteso, non è un errore). */
export async function fetchStaffBackupDetail(section, key) {
  const q = new URLSearchParams({
    section: String(section || '').trim(),
    key: String(key || '').trim(),
  })
  const path = `/staff/backups/detail?${q}`

  if (!isOnline()) {
    const cached = await getCachedResponse(path)
    return cached ?? null
  }

  const response = await fetch(apiUrl(path), { cache: 'no-store' })
  if (response.status === 404) return null
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(formatApiError(response.status, text))
  }

  const text = await response.text().catch(() => '')
  const contentType = response.headers.get('content-type') || ''
  const data = parseApiJson(text, path, contentType)

  if (isCacheableGetPath(path)) {
    try {
      await setCachedResponse(path, data)
    } catch {
      // quota IndexedDB
    }
  }

  return data
}

export function upsertStaffBackup(section, key, payload) {
  return apiFetch('/staff/backups', {
    ...SYNC_FETCH,
    method: 'PUT',
    body: JSON.stringify({
      section: String(section || '').trim(),
      backup_key: String(key || '').trim(),
      payload,
    }),
  }).then((result) => {
    if (result?.__offline) {
      throw new Error('Sei offline: il backup verrà inviato al server quando torna la connessione.')
    }
    return result
  })
}
