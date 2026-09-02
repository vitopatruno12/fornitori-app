import { getOperatorStationActivitySlug, operatorStationLocaleKeysEqual } from './operatorStationLocale.js'
import { STAFF_LOCALE_SLUG_TOKENS, staffLocaleCompareKey } from './primaNotaStaffLocaleLink.js'

const SESSION_BY_STATION_KEY = 'atlasOperatorStaffSessionByStation'

function readAll() {
  try {
    const raw = sessionStorage.getItem(SESSION_BY_STATION_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function writeAll(data) {
  try {
    sessionStorage.setItem(SESSION_BY_STATION_KEY, JSON.stringify(data))
  } catch {
    // ignore
  }
}

/** Sessione «locale personale aperto» per postazione operativa (separata dal gestionale). */
export function readOperatorStationStaffSession(stationId) {
  const key = String(stationId || '').trim().toLowerCase()
  if (!key) return { open: false, localeKey: '' }
  const entry = readAll()[key]
  if (!entry?.open) return { open: false, localeKey: '' }
  return {
    open: true,
    localeKey: String(entry.localeKey || '').trim().toLocaleLowerCase('it'),
  }
}

function operatorStationLocaleKeysMatch(stationId, sessionLocaleKey, localeName) {
  const target = staffLocaleCompareKey(localeName)
  if (!target) return false
  if (sessionLocaleKey === target) return true
  if (target.includes(sessionLocaleKey) || sessionLocaleKey.includes(target)) return true
  const slug = getOperatorStationActivitySlug(stationId)
  const tokens = STAFF_LOCALE_SLUG_TOKENS[slug] || []
  return tokens.length > 0 && tokens.every((token) => target.includes(token) && sessionLocaleKey.includes(token))
}

export function isOperatorStationStaffSessionOpen(stationId, localeName = '') {
  const session = readOperatorStationStaffSession(stationId)
  if (!session.open) return false
  const name = String(localeName || '').trim()
  if (!name) return true
  return operatorStationLocaleKeysMatch(stationId, session.localeKey, name)
}

export function setOperatorStationStaffSession(stationId, localeName, open) {
  const stationKey = String(stationId || '').trim().toLowerCase()
  if (!stationKey) return
  const all = readAll()
  if (open) {
    const localeKey = staffLocaleCompareKey(localeName)
    if (!localeKey) return
    all[stationKey] = { open: true, localeKey }
  } else if (all[stationKey]) {
    delete all[stationKey]
  }
  writeAll(all)
}

/** Chiude le sessioni personale di altre postazioni (evita dati «altopiano» tra sedi). */
export function closeOtherOperatorStationStaffSessions(currentStationId) {
  const current = String(currentStationId || '').trim().toLowerCase()
  if (!current) return
  const all = readAll()
  let changed = false
  for (const key of Object.keys(all)) {
    if (key !== current) {
      delete all[key]
      changed = true
    }
  }
  if (changed) writeAll(all)
}

export function operatorStationStaffSessionMatches(stationId, localeName) {
  const session = readOperatorStationStaffSession(stationId)
  if (!session.open) return false
  const target = String(localeName || '')
    .trim()
    .toLocaleLowerCase('it')
    .replace(/[\s_-]+/g, '')
  return Boolean(target) && operatorStationLocaleKeysEqual(session.localeKey, target)
}
