function normalizeApiBase(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return 'http://localhost:8000'
  return s.replace(/\/+$/, '')
}

/** Base URL API: nessuno slash finale (evita //path e 404 su alcuni proxy). */
export const API_BASE_URL = normalizeApiBase(import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000')

export function apiUrl(path) {
  const p = String(path || '')
  const q = p.startsWith('/') ? p : `/${p}`
  return `${API_BASE_URL}${q}`
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

  const contentType = response.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    return response.json()
  }

  return response.text()
}
