import { dbGet, dbPut, CACHE_STORE } from '../offline/offlineDb'

export const STAFF_MEMBERS_BY_LOCALE_STORAGE_KEY = 'staffMembersByLocale'
const IDB_CACHE_KEY = 'local:staffMembersByLocale'

function localeKey(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('it')
}

function emptyStore() {
  return {}
}

function parseStore(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyStore()
  return value
}

function readLocalStorageStore() {
  try {
    const raw = window.localStorage.getItem(STAFF_MEMBERS_BY_LOCALE_STORAGE_KEY)
    if (!raw) return emptyStore()
    return parseStore(JSON.parse(raw))
  } catch {
    return emptyStore()
  }
}

function mergeLocaleStores(...stores) {
  const out = {}
  for (const store of stores) {
    if (!store || typeof store !== 'object') continue
    for (const [name, pack] of Object.entries(store)) {
      if (!name || !pack) continue
      const prev = out[name]
      if (!prev) {
        out[name] = pack
        continue
      }
      const prevTs = Date.parse(prev.saved_at || '') || 0
      const nextTs = Date.parse(pack.saved_at || '') || 0
      out[name] = nextTs >= prevTs ? pack : prev
    }
  }
  return out
}

function findStoreKeyByLocaleName(store, localeName) {
  const target = localeKey(localeName)
  if (!target) return ''
  for (const key of Object.keys(store || {})) {
    if (localeKey(key) === target) return key
  }
  return ''
}

async function readIndexedDbStore() {
  try {
    const row = await dbGet(CACHE_STORE, IDB_CACHE_KEY)
    return parseStore(row?.data)
  } catch {
    return emptyStore()
  }
}

/** Legge i locali salvati unendo localStorage e IndexedDB (PWA e browser sullo stesso dispositivo). */
export async function readStaffLocaleStore() {
  const fromLs = readLocalStorageStore()
  const fromIdb = await readIndexedDbStore()
  const merged = mergeLocaleStores(fromLs, fromIdb)

  const mergedJson = JSON.stringify(merged)
  if (mergedJson !== JSON.stringify(fromLs) || mergedJson !== JSON.stringify(fromIdb)) {
    await writeStaffLocaleStore(merged)
  }
  return merged
}

/** Rimuove un locale dall'archivio locale (browser / PWA). */
export async function removeStaffLocaleFromStore(localeName) {
  const name = String(localeName || '').trim()
  if (!name) return false
  const store = await readStaffLocaleStore()
  const matchedKey = findStoreKeyByLocaleName(store, name)
  if (!matchedKey) return false
  delete store[matchedKey]
  await writeStaffLocaleStore(store)
  return true
}

/** Salva su localStorage e IndexedDB per compatibilità browser + app installata. */
export async function writeStaffLocaleStore(store) {
  const data = parseStore(store)
  try {
    window.localStorage.setItem(STAFF_MEMBERS_BY_LOCALE_STORAGE_KEY, JSON.stringify(data))
  } catch {
    // quota o modalità privata
  }
  try {
    await dbPut(CACHE_STORE, { key: IDB_CACHE_KEY, data, updatedAt: Date.now() })
  } catch {
    // IndexedDB non disponibile
  }
}
