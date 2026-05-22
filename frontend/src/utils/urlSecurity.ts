/** Host del sito gestionale: API same-origin sotto /api (non la root SPA). */
const FRONTEND_APP_HOSTS = new Set(['www.atlass.it', 'atlass.it'])

/** Converte http→https (tranne localhost). */
export function ensureHttpsUrl(url: string): string {
  const raw = String(url || '').trim()
  if (!raw) return raw
  try {
    const u = new URL(raw)
    const host = u.hostname.toLowerCase()
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
    if (u.protocol === 'http:' && !isLocal) {
      u.protocol = 'https:'
    }
    return u.href
  } catch {
    return raw.replace(/^http:\/\//i, 'https://')
  }
}

/**
 * Normalizza VITE_API_BASE_URL:
 * - vuoto → /api (proxy HTTPS same-origin)
 * - http://www.atlass.it → https://www.atlass.it/api
 * - https://www.atlass.it → https://www.atlass.it/api
 */
export function normalizeApiBase(raw: unknown): string {
  let s = String(raw ?? '').trim()
  if (!s) return '/api'

  if (s.startsWith('/')) {
    const rel = s.replace(/\/+$/, '') || '/api'
    return rel === '/' ? '/api' : rel
  }

  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`)
    const host = u.hostname.toLowerCase()
    const isLocal = host === 'localhost' || host === '127.0.0.1'
    if (u.protocol === 'http:' && !isLocal) {
      u.protocol = 'https:'
    }
    let path = (u.pathname || '/').replace(/\/+$/, '')
    if (FRONTEND_APP_HOSTS.has(host) && (!path || path === '/')) {
      path = '/api'
    }
    u.pathname = path || '/api'
    return `${u.origin}${u.pathname}`.replace(/\/+$/, '') || '/api'
  } catch {
    return '/api'
  }
}

/** URL assoluta per fetch/download: sempre https fuori da localhost. */
export function secureAbsoluteUrl(url: string): string {
  const raw = String(url || '').trim()
  if (!raw) return raw
  if (raw.startsWith('/')) return raw
  return ensureHttpsUrl(raw)
}
