import { fetchStaffLocalePack, fetchStaffMembers, fetchStaffShifts } from '../services/staffService.js'
import { getOperatorStationActivitySlug, getOperatorStationStaffLocaleName } from './operatorStationLocale.js'
import { isOperatorStationStaffSessionOpen } from './operatorStationStaffSession.js'
import { matchStaffLocaleName, staffLocaleCompareKey } from './primaNotaStaffLocaleLink.js'
import { isValidLocaleAccessCode, normalizeLocaleAccessCode } from './staffLocaleAccessCode.js'
import { readStaffLocaleStore, writeStaffLocaleStore } from './staffLocaleStore.js'

const MEMBERS_CACHE_MS = 10 * 60 * 1000
const MAX_MEMBER_IDS_IN_QUERY = 40
const membersCache = new Map()

function memberNameKey(name) {
  return String(name || '').trim().toLocaleLowerCase('it')
}

function findStoredLocalePackEntry(store, localeName) {
  const target = staffLocaleCompareKey(localeName)
  if (!target) return null
  for (const [key, pack] of Object.entries(store || {})) {
    if (staffLocaleCompareKey(key) === target) return { key, pack }
  }
  return null
}

function cacheKey(stationId, localeName) {
  return `${String(stationId || '').trim().toLowerCase()}::${staffLocaleCompareKey(localeName)}`
}

function readMembersCache(stationId, localeName) {
  const hit = membersCache.get(cacheKey(stationId, localeName))
  if (!hit) return null
  if (Date.now() - hit.fetchedAt > MEMBERS_CACHE_MS) {
    membersCache.delete(cacheKey(stationId, localeName))
    return null
  }
  return hit
}

function writeMembersCache(stationId, localeName, payload) {
  membersCache.set(cacheKey(stationId, localeName), {
    ...payload,
    fetchedAt: Date.now(),
  })
}

export function invalidateOperatorStationMembersCache(stationId = null, localeName = '') {
  if (!stationId && !localeName) {
    membersCache.clear()
    return
  }
  if (stationId && localeName) {
    membersCache.delete(cacheKey(stationId, localeName))
    return
  }
  const prefix = stationId ? `${String(stationId).trim().toLowerCase()}::` : ''
  const localeKey = staffLocaleCompareKey(localeName)
  for (const key of [...membersCache.keys()]) {
    if ((prefix && key.startsWith(prefix)) || (localeKey && key.endsWith(`::${localeKey}`))) {
      membersCache.delete(key)
    }
  }
}

async function readStoredAccessCode(store, localeName) {
  const hit = findStoredLocalePackEntry(store, localeName)
  return normalizeLocaleAccessCode(hit?.pack?.access_code)
}

async function resolvePackMembersForLocale(stationId, localeName) {
  const store = await readStaffLocaleStore()
  const availableNames = Object.keys(store || {})
  const slug = getOperatorStationActivitySlug(stationId)
  const canonicalName = matchStaffLocaleName(localeName, availableNames, slug) || localeName
  const localHit = findStoredLocalePackEntry(store, canonicalName)
  const localMembers = Array.isArray(localHit?.pack?.members) ? localHit.pack.members : []
  if (localMembers.length) return { canonicalName, packMembers: localMembers }

  const code = await readStoredAccessCode(store, canonicalName)
  if (!isValidLocaleAccessCode(code) || !isOperatorStationStaffSessionOpen(stationId, canonicalName)) {
    return { canonicalName, packMembers: [] }
  }

  try {
    const remote = await fetchStaffLocalePack(canonicalName, code)
    const remoteMembers = Array.isArray(remote?.members) ? remote.members : []
    if (!remoteMembers.length) return { canonicalName, packMembers: [] }

    const pack = {
      saved_at: remote.saved_at || new Date().toISOString(),
      members: remoteMembers,
      sections: Array.isArray(remote.sections) ? remote.sections : [],
      access_code: normalizeLocaleAccessCode(remote.access_code) || code,
    }
    const previousKey = localHit?.key || ''
    if (previousKey && previousKey !== canonicalName) delete store[previousKey]
    store[canonicalName] = pack
    await writeStaffLocaleStore(store)
    return { canonicalName, packMembers: remoteMembers }
  } catch {
    return { canonicalName, packMembers: [] }
  }
}

function resolveMembersFromPackAndDb(packMembers, allRaw, { operatorScoped = false } = {}) {
  const packNameKeys = new Set(packMembers.map((m) => memberNameKey(m.name)).filter(Boolean))
  const all = Array.isArray(allRaw) ? allRaw : []
  if (!packNameKeys.size) {
    if (operatorScoped) {
      return { members: [], memberIds: [], packNameKeys: new Set() }
    }
    return {
      members: all,
      memberIds: all.map((m) => m.id).filter((id) => id != null),
      packNameKeys: new Set(all.map((m) => memberNameKey(m.name)).filter(Boolean)),
    }
  }
  const members = all.filter((m) => packNameKeys.has(memberNameKey(m.name)))
  const memberIds = members.map((m) => m.id).filter((id) => id != null)
  return { members, memberIds, packNameKeys }
}

export function filterShiftsForOperatorLocale(shifts, { memberIds = [], packNameKeys = null } = {}) {
  const rows = Array.isArray(shifts) ? shifts : []
  const idSet = memberIds.length ? new Set(memberIds) : null
  const nameKeys = packNameKeys instanceof Set && packNameKeys.size ? packNameKeys : null
  if (!idSet && !nameKeys) return rows
  return rows.filter((shift) => {
    if (idSet && idSet.has(shift.staff_member_id)) return true
    if (nameKeys && nameKeys.has(memberNameKey(shift.staff_member_name))) return true
    return false
  })
}

async function fetchShiftsForOperatorMembers(from, to, memberIds, packNameKeys) {
  if (!memberIds.length) return []
  if (memberIds.length <= MAX_MEMBER_IDS_IN_QUERY) {
    const shiftsRaw = await fetchStaffShifts(from, to, { memberIds })
    return filterShiftsForOperatorLocale(shiftsRaw, { memberIds, packNameKeys })
  }
  const shiftsRaw = await fetchStaffShifts(from, to)
  return filterShiftsForOperatorLocale(shiftsRaw, { memberIds, packNameKeys })
}

/** Precarica dipendenti del locale (es. all'apertura sessione postazione). */
export async function preloadOperatorStationMembers(stationId) {
  await resolveOperatorStationMembers(stationId)
}

/** Carica dipendenti del locale collegato alla postazione (con cache sessione). */
export async function resolveOperatorStationMembers(stationId) {
  const store = await readStaffLocaleStore()
  const availableNames = Object.keys(store || {})
  const localeName = getOperatorStationStaffLocaleName(stationId, availableNames)
  const cached = readMembersCache(stationId, localeName)
  if (cached) {
    return {
      members: cached.members,
      memberIds: cached.memberIds,
      packNameKeys: cached.packNameKeys,
      localeName: cached.localeName,
    }
  }

  if (!localeName) {
    const all = await fetchStaffMembers()
    const members = Array.isArray(all) ? all : []
    const payload = {
      members,
      memberIds: members.map((m) => m.id).filter((id) => id != null),
      packNameKeys: new Set(members.map((m) => memberNameKey(m.name)).filter(Boolean)),
      localeName: '',
    }
    writeMembersCache(stationId, '', payload)
    return payload
  }

  const [{ canonicalName, packMembers }, allRaw] = await Promise.all([
    resolvePackMembersForLocale(stationId, localeName),
    fetchStaffMembers(),
  ])
  const resolved = resolveMembersFromPackAndDb(packMembers, allRaw, { operatorScoped: true })
  const payload = { ...resolved, localeName: canonicalName || localeName }
  writeMembersCache(stationId, localeName, payload)
  return payload
}

/** Carica turni filtrati per il locale della postazione operativa. */
export async function fetchOperatorStationShifts(stationId, from, to) {
  const { memberIds, packNameKeys } = await resolveOperatorStationMembers(stationId)
  return fetchShiftsForOperatorMembers(from, to, memberIds, packNameKeys)
}
