import { invalidateOperatorStationMembersCache } from './operatorStaffReportData.js'
import {
  getOperatorStationActivitySlug,
  getOperatorStationStaffLocaleName,
  operatorStationLocaleNameMatches,
} from './operatorStationLocale.js'
import {
  closeOtherOperatorStationStaffSessions,
  isOperatorStationStaffSessionOpen,
  readOperatorStationStaffSession,
  setOperatorStationStaffSession,
} from './operatorStationStaffSession.js'
import { staffLocaleCompareKey } from './primaNotaStaffLocaleLink.js'
import { readStaffLocaleStore, writeStaffLocaleStore } from './staffLocaleStore.js'

/**
 * Pulisce cache PWA/browser della postazione:
 * - chiude sessioni di altre sedi
 * - invalida cache dipendenti
 * - su Via Lattea rimuove pack locali ambigui (nome Lattea/Mucche + Mani/Abba)
 * - chiude la sessione se era aperta su un locale non della sede
 */
export async function sanitizeOperatorStationStaffStore(stationId) {
  const station = String(stationId || '').trim().toLowerCase()
  if (!station) return { removedKeys: [], linkedLocale: '' }

  closeOtherOperatorStationStaffSessions(station)
  invalidateOperatorStationMembersCache(station)

  const store = await readStaffLocaleStore()
  const names = Object.keys(store || {})
  const linkedLocale = getOperatorStationStaffLocaleName(station, names)
  const slug = getOperatorStationActivitySlug(station)
  const removedKeys = []

  const session = readOperatorStationStaffSession(station)
  if (session.open && linkedLocale && !isOperatorStationStaffSessionOpen(station, linkedLocale)) {
    setOperatorStationStaffSession(station, session.localeKey || linkedLocale, false)
  }

  if (slug === 'via_lattea') {
    for (const key of names) {
      const keyNorm = staffLocaleCompareKey(key)
      const belongsHere = operatorStationLocaleNameMatches(station, key, names)
      if (
        !belongsHere &&
        (keyNorm.includes('lattea') || keyNorm.includes('mucche')) &&
        (keyNorm.includes('mani') ||
          keyNorm.includes('pasta') ||
          keyNorm.includes('abba') ||
          keyNorm.includes('mediazione'))
      ) {
        delete store[key]
        removedKeys.push(key)
      }
    }
  }

  await writeStaffLocaleStore(store)
  return { removedKeys, linkedLocale }
}

/** Dopo Accedi: sovrascrive il pack locale della sede con quello server. */
export async function replaceOperatorLocalePackInStore(localeName, pack) {
  const name = String(localeName || '').trim()
  if (!name || !pack || typeof pack !== 'object') return false
  const store = await readStaffLocaleStore()
  const target = staffLocaleCompareKey(name)
  let saveKey = name
  for (const key of Object.keys(store || {})) {
    if (staffLocaleCompareKey(key) === target) {
      saveKey = key
      break
    }
  }
  store[saveKey] = {
    ...(store[saveKey] && typeof store[saveKey] === 'object' ? store[saveKey] : {}),
    ...pack,
    saved_at: pack.saved_at || new Date().toISOString(),
    members: Array.isArray(pack.members) ? pack.members : [],
  }
  await writeStaffLocaleStore(store)
  return true
}
