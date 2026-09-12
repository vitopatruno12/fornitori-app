import { staffLocaleCompareKey } from './primaNotaStaffLocaleLink.js'

const STAFF_LOCALE_SESSION_KEY = 'staffLocaleSessionOpen'

export function readStaffLocaleSessionOpenKeys() {
  try {
    const raw = sessionStorage.getItem(STAFF_LOCALE_SESSION_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((k) => String(k || '').trim().toLocaleLowerCase('it')).filter(Boolean)
  } catch {
    return []
  }
}

export function writeStaffLocaleSessionOpenKeys(keys) {
  try {
    const unique = [
      ...new Set((keys || []).map((k) => String(k || '').trim().toLocaleLowerCase('it')).filter(Boolean)),
    ]
    sessionStorage.setItem(STAFF_LOCALE_SESSION_KEY, JSON.stringify(unique))
  } catch {
    // ignore
  }
}

export function isGestionaleStaffLocaleSessionOpen(localeName) {
  const key = staffLocaleCompareKey(localeName)
  if (!key) return false
  return readStaffLocaleSessionOpenKeys().includes(key)
}

export function setGestionaleStaffLocaleSessionOpen(localeName, open) {
  const key = staffLocaleCompareKey(localeName)
  if (!key) return
  const prev = new Set(readStaffLocaleSessionOpenKeys())
  if (open) prev.add(key)
  else prev.delete(key)
  writeStaffLocaleSessionOpenKeys([...prev])
}

/** Chiude tutte le sessioni aperte tranne eventualmente quella indicata. */
export function closeOtherGestionaleStaffLocaleSessions(keepLocaleName = '') {
  const keep = staffLocaleCompareKey(keepLocaleName)
  if (!keep) {
    writeStaffLocaleSessionOpenKeys([])
    return
  }
  writeStaffLocaleSessionOpenKeys([keep])
}
