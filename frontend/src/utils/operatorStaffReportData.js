import { fetchStaffMembers, fetchStaffShifts } from '../services/staffService.js'
import { getOperatorStationStaffLocaleName } from './operatorStationLocale.js'
import { readStaffLocaleStore } from './staffLocaleStore.js'

const MEMBERS_CACHE_MS = 10 * 60 * 1000
const membersCache = new Map()

function memberNameKey(name) {
  return String(name || '').trim().toLocaleLowerCase('it')
}

function findStoredLocalePack(store, localeName) {
  const target = memberNameKey(localeName)
  for (const [key, pack] of Object.entries(store || {})) {
    if (memberNameKey(key) === target) return pack
  }
  return null
}

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
  const localeKey = memberNameKey(localeName)
  for (const key of [...membersCache.keys()]) {
    if ((prefix && key.startsWith(prefix)) || (localeKey && key.endsWith(`::${localeKey}`))) {
      membersCache.delete(key)
    }
  }
}

function packMembersFromStore(localeName) {
  return readStaffLocaleStore().then((store) => {
    const pack = findStoredLocalePack(store, localeName)
    return Array.isArray(pack?.members) ? pack.members : []
  })
}

function resolveMembersFromPackAndDb(packMembers, allRaw) {
  const packNameKeys = new Set(packMembers.map((m) => memberNameKey(m.name)).filter(Boolean))
  const all = Array.isArray(allRaw) ? allRaw : []
  const members = packNameKeys.size
    ? all.filter((m) => packNameKeys.has(memberNameKey(m.name)))
    : all
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

/** Precarica dipendenti del locale (es. all'apertura sessione postazione). */
export async function preloadOperatorStationMembers(stationId) {
  await resolveOperatorStationMembers(stationId)
}

/** Carica dipendenti del locale collegato alla postazione (con cache sessione). */
export async function resolveOperatorStationMembers(stationId) {
  const localeName = getOperatorStationStaffLocaleName(stationId, [])
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

  const [packMembers, allRaw] = await Promise.all([packMembersFromStore(localeName), fetchStaffMembers()])
  const resolved = resolveMembersFromPackAndDb(packMembers, allRaw)
  const payload = { ...resolved, localeName }
  writeMembersCache(stationId, localeName, payload)
  return payload
}

/** Carica turni filtrati per il locale della postazione operativa. */
export async function fetchOperatorStationShifts(stationId, from, to) {
  const { memberIds, packNameKeys } = await resolveOperatorStationMembers(stationId)
  const shiftOpts = memberIds.length ? { memberIds } : {}
  const shiftsRaw = await fetchStaffShifts(from, to, shiftOpts)
  return filterShiftsForOperatorLocale(shiftsRaw, { memberIds, packNameKeys })
}
