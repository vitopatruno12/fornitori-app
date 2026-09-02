import { fetchStaffLocalePack, fetchStaffLocalePacks, fetchStaffMembers } from '../services/staffService.js'
import { findLocalePackInStore, memberNameKey, membersFromPackAndDb } from './operatorLocalePack.js'
import { staffLocaleCompareKey } from './primaNotaStaffLocaleLink.js'
import { readStaffLocaleStore } from './staffLocaleStore.js'

const STORAGE_KEY = 'atlasGestionaleStaffLocale:v1'

export function readGestionaleStaffLocale() {
  try {
    return String(sessionStorage.getItem(STORAGE_KEY) || '').trim()
  } catch {
    return ''
  }
}

export function writeGestionaleStaffLocale(localeName) {
  try {
    const value = String(localeName || '').trim()
    if (!value) sessionStorage.removeItem(STORAGE_KEY)
    else sessionStorage.setItem(STORAGE_KEY, value)
  } catch {
    // ignore
  }
}

export function gestionaleLocaleNamesEqual(a, b) {
  return staffLocaleCompareKey(a) === staffLocaleCompareKey(b)
}

export async function listGestionaleStaffLocaleNames() {
  const names = new Map()
  try {
    const summaries = await fetchStaffLocalePacks()
    for (const row of summaries) {
      const n = String(row?.locale_name || '').trim()
      if (!n) continue
      names.set(staffLocaleCompareKey(n), n)
    }
  } catch {
    // server assente
  }
  try {
    const store = await readStaffLocaleStore()
    for (const rawKey of Object.keys(store || {})) {
      const n = String(rawKey || '').trim()
      if (!n) continue
      names.set(staffLocaleCompareKey(n), n)
    }
  } catch {
    // ignore
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }))
}

export async function resolveGestionaleLocaleMembers(localeName) {
  const locale = String(localeName || '').trim()
  if (!locale) {
    return { members: [], memberIds: [], packNameKeys: new Set(), canonicalName: '' }
  }

  const store = await readStaffLocaleStore()
  const hit = findLocalePackInStore(store, locale, '')
  let packMembers = Array.isArray(hit?.pack?.members) ? hit.pack.members : []
  const canonicalName = hit?.canonicalName || locale

  if (!packMembers.length) {
    try {
      const remote = await fetchStaffLocalePack(canonicalName)
      if (Array.isArray(remote?.members) && remote.members.length) {
        packMembers = remote.members
      }
    } catch {
      // pack protetto o non disponibile
    }
  }

  let all = []
  try {
    const raw = await fetchStaffMembers()
    all = Array.isArray(raw) ? raw : []
  } catch {
    all = []
  }

  const members = membersFromPackAndDb(packMembers, all)
  const memberIds = members.map((m) => m.id).filter((id) => id != null)
  const packNameKeys = new Set(packMembers.map((m) => memberNameKey(m.name)).filter(Boolean))
  return { members, memberIds, packNameKeys, canonicalName }
}
