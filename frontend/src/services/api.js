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

function looksLikeHtml(text) {
  const t = String(text || '').trim().slice(0, 200).toLowerCase()
  return t.startsWith('<!doctype') || t.startsWith('<html') || (t.startsWith('<') && t.includes('<head'))
}

/** Garantisce un array (evita .map is not a function se l’API risponde male). */
export function asArray(value, label = 'risposta') {
  if (Array.isArray(value)) return value
  if (value == null) return []
  if (typeof value === 'object' && Array.isArray(value.items)) return value.items
  if (typeof value === 'object' && Array.isArray(value.data)) return value.data
  console.warn(`API ${label}: atteso array, ricevuto`, typeof value, value)
  return []
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

  if (contentType.includes('text/html') || looksLikeHtml(text)) {
    console.warn(
      '[API] Risposta HTML al posto di JSON per',
      path,
      '— verifica proxy Nginx: location ^~ /api/ { proxy_pass http://127.0.0.1:8000/; }',
    )
    return null
  }

  const trimmed = text.trim()
  if (!trimmed) {
    return null
  }

  if (contentType.includes('application/json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      throw new Error(`Risposta non è JSON valido (${path})`)
    }
  }

  return text
}
