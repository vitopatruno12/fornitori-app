import { normalizeApiBase, secureAbsoluteUrl } from '../utils/urlSecurity'

/** Base URL API (env VITE_API_BASE_URL; in produzione preferire /api su HTTPS). */
export const API_BASE_URL = normalizeApiBase(import.meta.env.VITE_API_BASE_URL)

export function apiUrl(path) {
  const p = String(path || '')
  const q = p.startsWith('/') ? p : `/${p}`
  const base = API_BASE_URL
  if (base.startsWith('/')) {
    return `${base}${q}`
  }
  return secureAbsoluteUrl(`${base}${q}`)
}

/** Estrae messaggio leggibile da risposte FastAPI (detail string o elenco errori validazione). */
function formatApiError(status, text) {
  const raw = (text || '').trim()
  try {
    const j = JSON.parse(raw)
    if (typeof j.detail === 'string') return `${status}: ${j.detail}`
    if (Array.isArray(j.detail)) {
      const parts = j.detail.map((d) => {
        if (typeof d === 'string') return d
        if (d?.msg) return d.msg
        return JSON.stringify(d)
      })
      return `${status}: ${parts.join(' — ')}`
    }
    if (j.detail != null) return `${status}: ${JSON.stringify(j.detail)}`
  } catch {
    /* non JSON */
  }
  return raw ? `API error ${status}: ${raw}` : `API error ${status}`
}

export async function apiFetch(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(formatApiError(response.status, text))
  }

  const text = await response.text().catch(() => '')
  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const trimmed = text.trim()
    if (!trimmed) {
      return null
    }
    try {
      return JSON.parse(trimmed)
    } catch {
      return text
    }
  }

  return text
}
