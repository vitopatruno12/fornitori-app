import { dbDelete, dbGet, dbGetAll, dbPut, CACHE_STORE } from './offlineDb'

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000

const CACHEABLE_PREFIXES = [
  '/dashboard/summary',
  '/cash/entries',
  '/cash/summary',
  '/cash/link-options',
  '/staff/members',
  '/staff/shifts',
  '/staff/payroll-months',
  '/supplier-orders',
  '/suppliers',
  '/deliveries',
  '/customers/',
  '/accounts',
  '/payment-methods',
  '/categories',
  '/reference',
]

export function isCacheableGetPath(path) {
  const p = String(path || '').split('?')[0]
  if (!p || p.startsWith('/ai/')) return false
  return CACHEABLE_PREFIXES.some((prefix) => p.startsWith(prefix) || p === prefix.replace(/\/$/, ''))
}

function cacheKey(path) {
  return String(path || '')
}

export async function getCachedResponse(path) {
  const row = await dbGet(CACHE_STORE, cacheKey(path))
  if (!row) return null
  if (Date.now() - Number(row.updatedAt || 0) > CACHE_TTL_MS) {
    await dbDelete(CACHE_STORE, cacheKey(path))
    return null
  }
  return row.data ?? null
}

/** Come getCachedResponse, con timestamp ultimo salvataggio (per avvisi offline). */
export async function getCachedResponseWithMeta(path) {
  const row = await dbGet(CACHE_STORE, cacheKey(path))
  if (!row) return null
  if (Date.now() - Number(row.updatedAt || 0) > CACHE_TTL_MS) {
    await dbDelete(CACHE_STORE, cacheKey(path))
    return null
  }
  return { data: row.data ?? null, updatedAt: row.updatedAt ?? null }
}

export async function setCachedResponse(path, data) {
  if (!isCacheableGetPath(path)) return
  await dbPut(CACHE_STORE, {
    key: cacheKey(path),
    data,
    updatedAt: Date.now(),
  })
}

export async function mergeOptimisticIntoCachedList(path, optimisticItem) {
  if (!path.includes('?')) return
  const existing = (await getCachedResponse(path)) || []
  if (!Array.isArray(existing)) return
  const next = [...existing, optimisticItem]
  await setCachedResponse(path, next)
}

/** Aggiorna liste in cache che contengono lo stesso path base (es. /cash/entries?...). */
export async function patchCachedListsForCreate(path, optimisticItem) {
  const base = String(path || '').split('?')[0]
  let item = optimisticItem
  if (base === '/staff/shifts' && item && !item.staff_member_name) {
    const members = await getCachedResponse('/staff/members')
    if (Array.isArray(members)) {
      const hit = members.find((m) => Number(m.id) === Number(item.staff_member_id))
      if (hit?.name) item = { ...item, staff_member_name: hit.name }
    }
  }
  if (item?.work_date && typeof item.work_date === 'string') {
    item = { ...item, work_date: item.work_date.slice(0, 10) }
  }
  const all = await dbGetAll(CACHE_STORE)
  for (const row of all) {
    const key = String(row.key || '')
    if (!key.startsWith(base)) continue
    const data = row.data
    if (!Array.isArray(data)) continue
    const exists = data.some((x) => x.id === item.id)
    if (exists) continue
    await dbPut(CACHE_STORE, {
      key,
      data: [...data, item],
      updatedAt: Date.now(),
    })
  }
}

export async function invalidateCachePrefix(prefix) {
  const all = await dbGetAll(CACHE_STORE)
  for (const row of all) {
    if (String(row.key || '').startsWith(prefix)) {
      await dbDelete(CACHE_STORE, row.key)
    }
  }
}
