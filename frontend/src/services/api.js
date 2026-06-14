import { API_BASE_URL, apiUrl } from './apiBase'
import { getCachedResponse, isCacheableGetPath, setCachedResponse } from '../offline/offlineCache'
import { isOnline } from '../offline/offlineStatus'
import { queueMutationAndRespond } from '../offline/offlineSync'
import { formatApiError, looksLikeHtml, parseApiJson } from '../offline/offlineApiHelpers'

export { API_BASE_URL, apiUrl } from './apiBase'

/** Estrae messaggio leggibile da risposte FastAPI (detail string o elenco errori validazione). */
export { formatApiError } from '../offline/offlineApiHelpers'

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
  const method = String(options.method || 'GET').toUpperCase()

  if (!isOnline()) {
    if (method === 'GET') {
      const cached = await getCachedResponse(path)
      if (cached != null) return cached
      throw new Error(
        'Sei offline: dati non in cache. Apri la sezione con internet almeno una volta, poi potrai consultarli offline.',
      )
    }
    return queueMutationAndRespond(path, options)
  }

  const response = await fetch(apiUrl(path), {
    cache: options.cache,
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
      '[API] Risposta HTML al posto di JSON.',
      { path, url: apiUrl(path), status: response.status },
      '— Sul server: location ^~ /api/ { proxy_pass http://127.0.0.1:8000/; proxy_set_header X-Forwarded-Proto https; }',
    )
    throw new Error(
      `API non raggiungibile (${path}): il server ha restituito HTML invece di JSON. Verifica proxy /api su Nginx/Caddy e riavvia fornitori-api.`,
    )
  }

  const data = parseApiJson(text, path, contentType)

  if (method === 'GET' && isCacheableGetPath(path)) {
    try {
      await setCachedResponse(path, data)
    } catch {
      // quota IndexedDB
    }
  }

  return data
}
