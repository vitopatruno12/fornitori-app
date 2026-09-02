import { getOperatorStationActivitySlug } from './operatorStationLocale.js'
import {
  STAFF_LOCALE_MATCH_CANDIDATES,
  matchStaffLocaleName,
  staffLocaleCompareKey,
} from './primaNotaStaffLocaleLink.js'
import { readStaffLocaleStore, writeStaffLocaleStore } from './staffLocaleStore.js'

export function memberNameKey(name) {
  return String(name || '').trim().toLocaleLowerCase('it')
}

export function findLocalePackInStore(store, localeName, activitySlug = '') {
  const names = Object.keys(store || {})
  const slug = String(activitySlug || '').trim().toLowerCase()
  const canonical = matchStaffLocaleName(localeName, names, slug) || String(localeName || '').trim()
  const target = staffLocaleCompareKey(canonical)
  if (!target) return null
  for (const [key, pack] of Object.entries(store || {})) {
    if (staffLocaleCompareKey(key) === target) return { key, pack, canonicalName: key }
  }
  return null
}

export function membersFromPackAndDb(packMembers, dbMembers) {
  const packRows = Array.isArray(packMembers) ? packMembers : []
  const packNameKeys = new Set(packRows.map((m) => memberNameKey(m.name)).filter(Boolean))
  const all = Array.isArray(dbMembers) ? dbMembers : []
  if (!packNameKeys.size) return []
  return all.filter((m) => packNameKeys.has(memberNameKey(m.name)))
}

export function localePackFetchCandidates(localeName, activitySlug = '') {
  const slug = String(activitySlug || '').trim().toLowerCase()
  const fromSlug = STAFF_LOCALE_MATCH_CANDIDATES[slug] || []
  const out = []
  const seen = new Set()
  for (const name of [...fromSlug, localeName]) {
    const trimmed = String(name || '').trim()
    if (!trimmed) continue
    const key = staffLocaleCompareKey(trimmed)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

export async function readOperatorLocalePackMembers(stationId, localeName) {
  const slug = getOperatorStationActivitySlug(stationId)
  const store = await readStaffLocaleStore()
  const hit = findLocalePackInStore(store, localeName, slug)
  return {
    canonicalName: hit?.canonicalName || matchStaffLocaleName(localeName, Object.keys(store || {}), slug) || localeName,
    packMembers: Array.isArray(hit?.pack?.members) ? hit.pack.members : [],
    storeKey: hit?.key || '',
    pack: hit?.pack || null,
  }
}

export async function writeOperatorLocalePackMembers(stationId, localeName, memberSnapshots, extras = {}) {
  const slug = getOperatorStationActivitySlug(stationId)
  const store = await readStaffLocaleStore()
  const hit = findLocalePackInStore(store, localeName, slug)
  const saveKey = hit?.key || matchStaffLocaleName(localeName, Object.keys(store || {}), slug) || String(localeName || '').trim()
  if (!saveKey) return ''
  const prev = hit?.pack && typeof hit.pack === 'object' ? hit.pack : {}
  store[saveKey] = {
    ...prev,
    saved_at: new Date().toISOString(),
    members: Array.isArray(memberSnapshots) ? memberSnapshots : [],
    sections: Array.isArray(extras.sections) ? extras.sections : Array.isArray(prev.sections) ? prev.sections : [],
    access_code: extras.access_code || prev.access_code || null,
    hidden_planning_sections: Array.isArray(extras.hidden_planning_sections)
      ? extras.hidden_planning_sections
      : Array.isArray(prev.hidden_planning_sections)
        ? prev.hidden_planning_sections
        : [],
  }
  await writeStaffLocaleStore(store)
  return saveKey
}
