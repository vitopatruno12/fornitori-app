import {
  ensureApiRequestUrl,
  ensureLocalDevHttp,
  normalizeApiBase,
  secureAbsoluteUrl,
} from '../utils/urlSecurity'

/** Base URL API (env VITE_API_BASE_URL; in produzione preferire /api su HTTPS). */
export const API_BASE_URL = normalizeApiBase(import.meta.env.VITE_API_BASE_URL)

export function apiUrl(path) {
  const p = String(path || '')
  const q = p.startsWith('/') ? p : `/${p}`
  const base = API_BASE_URL
  let url
  if (base.startsWith('/')) {
    url = `${base}${q}`
  } else {
    url = ensureLocalDevHttp(secureAbsoluteUrl(`${base}${q}`))
  }
  return ensureApiRequestUrl(url)
}
