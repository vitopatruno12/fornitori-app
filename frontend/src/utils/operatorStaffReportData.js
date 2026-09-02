import { fetchStaffLocalePack, fetchStaffMembers, fetchStaffShifts } from '../services/staffService.js'
import { getOperatorStationActivitySlug, getOperatorStationStaffLocaleName } from './operatorStationLocale.js'
import {
  findLocalePackInStore,
  localePackFetchCandidates,
  memberNameKey,
  membersFromPackAndDb,
} from './operatorLocalePack.js'
import { isOperatorStationStaffSessionOpen } from './operatorStationStaffSession.js'
import { matchStaffLocaleName } from './primaNotaStaffLocaleLink.js'
import { isValidLocaleAccessCode, normalizeLocaleAccessCode } from './staffLocaleAccessCode.js'
import { readStaffLocaleStore, writeStaffLocaleStore } from './staffLocaleStore.js'

const MEMBERS_CACHE_MS = 10 * 60 * 1000
const MAX_MEMBER_IDS_IN_QUERY = 40
const membersCache = new Map()

function cacheKey(stationId, localeName) {
  return `${String(stationId || '').trim().toLowerCase()}::${memberNameKey(localeName)}`
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
  for (const key of [...membersCache.keys()]) {
    if ((prefix && key.startsWith(prefix)) || (localeName && key.endsWith(`::${memberNameKey(localeName)}`))) {
      membersCache.delete(key)
    }
  }
}

async function readStoredAccessCode(store, localeName, activitySlug = '') {
  const hit = findLocalePackInStore(store, localeName, activitySlug)
  return normalizeLocaleAccessCode(hit?.pack?.access_code)
}

async function fetchRemoteLocalePack(stationId, localeName, code) {
  const slug = getOperatorStationActivitySlug(stationId)
  const candidates = localePackFetchCandidates(localeName, slug)
  const seen = new Set()
  for (const name of candidates) {
    const key = memberNameKey(name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    try {
      const remote = await fetchStaffLocalePack(name, code)
      if (remote && Array.isArray(remote.members)) {
        return { canonicalName: name, remote }
      }
    } catch {
      // prova il nome successivo (es. Mucche Volanti / La Via Lattea)
    }
  }
  return null
}

async function resolvePackMembersForLocale(stationId, localeName) {
  const slug = getOperatorStationActivitySlug(stationId)
  const store = await readStaffLocaleStore()
  const availableNames = Object.keys(store || {})
  const canonicalName = matchStaffLocaleName(localeName, availableNames, slug) || localeName
  const localHit = findLocalePackInStore(store, canonicalName, slug)
  const localKey = localHit?.key || canonicalName
  // Non usare pack locali di altre sedi (es. Mani in Pasta sulla PWA Lattea)
  const { operatorStationLocaleNameMatches } = await import('./operatorStationLocale.js')
  const localAllowed = operatorStationLocaleNameMatches(stationId, localKey, availableNames)
  const localMembers =
    localAllowed && Array.isArray(localHit?.pack?.members) ? localHit.pack.members : []

  const code = await readStoredAccessCode(store, canonicalName, slug)
  if (isValidLocaleAccessCode(code) && isOperatorStationStaffSessionOpen(stationId, canonicalName)) {
    try {
      const remoteHit = await fetchRemoteLocalePack(stationId, canonicalName, code)
      if (remoteHit && Array.isArray(remoteHit.remote.members)) {
        const remoteMembers = remoteHit.remote.members
        const pack = {
          saved_at: remoteHit.remote.saved_at || new Date().toISOString(),
          members: remoteMembers,
          sections: Array.isArray(remoteHit.remote.sections) ? remoteHit.remote.sections : [],
          access_code: normalizeLocaleAccessCode(remoteHit.remote.access_code) || code,
        }
        const saveKey = localAllowed && localHit?.key ? localHit.key : remoteHit.canonicalName
        if (localHit?.key && localHit.key !== saveKey) delete store[localHit.key]
        store[saveKey] = pack
        await writeStaffLocaleStore(store)
        return { canonicalName: saveKey, packMembers: remoteMembers }
      }
    } catch {
      // fallback locale sotto
    }
  }

  if (localMembers.length) {
    return { canonicalName: localHit?.canonicalName || canonicalName, packMembers: localMembers }
  }
  return { canonicalName, packMembers: [] }
}

function resolveMembersFromPackAndDb(packMembers, allRaw, { operatorScoped = false } = {}) {
  const members = membersFromPackAndDb(packMembers, allRaw)
  if (!members.length && operatorScoped) {
    return { members: [], memberIds: [], packNameKeys: new Set() }
  }
  if (!members.length && !operatorScoped) {
    const all = Array.isArray(allRaw) ? allRaw : []
    return {
      members: all,
      memberIds: all.map((m) => m.id).filter((id) => id != null),
      packNameKeys: new Set(all.map((m) => memberNameKey(m.name)).filter(Boolean)),
    }
  }
  const packNameKeys = new Set((packMembers || []).map((m) => memberNameKey(m.name)).filter(Boolean))
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
