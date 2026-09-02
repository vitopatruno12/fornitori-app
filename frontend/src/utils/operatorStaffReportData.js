import { fetchStaffLocalePack, fetchStaffMembers } from '../services/staffService.js'
import { getOperatorStationStaffLocaleName } from './operatorStationLocale.js'
import { readStaffLocaleStore } from './staffLocaleStore.js'

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

/** Carica solo i dipendenti del locale collegato alla postazione operativa. */
export async function resolveOperatorStationMembers(stationId) {
  const localeName = getOperatorStationStaffLocaleName(stationId, [])
  if (!localeName) {
    const all = await fetchStaffMembers()
    const members = Array.isArray(all) ? all : []
    return { members, memberIds: members.map((m) => m.id).filter((id) => id != null), localeName: '' }
  }

  const store = await readStaffLocaleStore()
  const storedPack = findStoredLocalePack(store, localeName)
  const code = storedPack?.access_code || ''

  const [packResult, allRaw] = await Promise.all([
    fetchStaffLocalePack(localeName, code).catch(() => null),
    fetchStaffMembers(),
  ])

  let packMembers = []
  if (packResult && Array.isArray(packResult.members)) {
    packMembers = packResult.members
  } else {
    packMembers = Array.isArray(storedPack?.members) ? storedPack.members : []
  }

  const packNameKeys = new Set(packMembers.map((m) => memberNameKey(m.name)).filter(Boolean))
  const all = Array.isArray(allRaw) ? allRaw : []
  const members = packNameKeys.size
    ? all.filter((m) => packNameKeys.has(memberNameKey(m.name)))
    : all
  const memberIds = members.map((m) => m.id).filter((id) => id != null)
  return { members, memberIds, localeName }
}
