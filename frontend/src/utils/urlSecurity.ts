/** Host del sito gestionale: API same-origin sotto /api (non la root SPA). */
const FRONTEND_APP_HOSTS = new Set(['www.atlass.it', 'atlass.it'])

/** Path API backend (senza prefisso /api = rischio HTML dalla SPA). */
const API_RESOURCE_PATH =
  /^\/(suppliers|invoices|deliveries|cash|dashboard|ai|staff|price-list|supplier-orders|support-technicians|vne|health|reference|customers|attachments|sdi|banca)(\/|$)/

export function isLocalDevHost(hostname: string): boolean {
  const host = String(hostname || '').toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
}

/** FastAPI in locale è sempre HTTP: evita https://127.0.0.1:8000 (ERR_SSL_PROTOCOL_ERROR). */
export function ensureLocalDevHttp(url: string): string {
  const raw = String(url || '').trim()
  if (!raw || raw.startsWith('/')) return raw
  try {
    const u = new URL(raw)
    if (isLocalDevHost(u.hostname) && u.protocol === 'https:') {
      u.protocol = 'http:'
    }
    return u.href
  } catch {
    return raw
  }
}

/** Converte http→https (tranne localhost). */
export function ensureHttpsUrl(url: string): string {
  const raw = String(url || '').trim()
  if (!raw) return raw
  try {
    const u = new URL(raw)
    if (isLocalDevHost(u.hostname)) {
      if (u.protocol === 'https:') u.protocol = 'http:'
      return u.href
    }
    if (u.protocol === 'http:') {
      u.protocol = 'https:'
    }
    return u.href
  } catch {
    if (/^https:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(raw)) {
      return raw.replace(/^https:/i, 'http:')
    }
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
    const isLocal = isLocalDevHost(host)
    if (isLocal) {
      u.protocol = 'http:'
    } else if (u.protocol === 'http:') {
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

/**
 * Garantisce che le chiamate API su atlass.it usino /api/… e non /suppliers (pagina React).
 */
export function ensureApiRequestUrl(url: string): string {
  const raw = String(url || '').trim()
  if (!raw) return raw
  try {
    const base =
      typeof window !== 'undefined' ? window.location.href : 'https://www.atlass.it/'
    const u = new URL(raw, base)
    const host = u.hostname.toLowerCase()
    const onApp =
      FRONTEND_APP_HOSTS.has(host) || isLocalDevHost(host)
    if (!onApp) return raw
    let path = u.pathname || '/'
    if (!path.startsWith('/api/') && API_RESOURCE_PATH.test(path)) {
      u.pathname = `/api${path}`
    }
    if (u.pathname.startsWith('/api/')) {
      return u.pathname + u.search
    }
    if (raw.startsWith('/')) return u.pathname + u.search
    return u.href
  } catch {
    return raw
  }
}
