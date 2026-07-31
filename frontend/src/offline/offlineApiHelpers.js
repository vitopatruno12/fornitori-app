/** Helper condivisi tra api.js e offlineSync (evita import circolari). */

export function formatApiError(status, text) {
  const raw = (text || '').trim()
  if (looksLikeHtml(raw) || /bad gateway/i.test(raw) || /gateway time-?out/i.test(raw)) {
    if (status === 502) {
      return '502: Gateway non raggiungibile (API o portale VNE non rispondono). Riprova o riavvia fornitori-api.'
    }
    if (status === 504) {
      return '504: Timeout gateway (richiesta VNE troppo lenta). Riprova tra qualche secondo.'
    }
  }
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
    // ignore
  }
  if (!raw) {
    if (status === 502) {
      return '502: Gateway non raggiungibile (API o portale VNE non rispondono). Riprova o riavvia fornitori-api.'
    }
    if (status === 504) {
      return '504: Timeout gateway (richiesta VNE troppo lenta). Riprova tra qualche secondo.'
    }
  }
  return raw ? `API error ${status}: ${raw}` : `API error ${status}`
}

export function looksLikeHtml(text) {
  const t = String(text || '').trim().slice(0, 200).toLowerCase()
  return t.startsWith('<!doctype') || t.startsWith('<html') || (t.startsWith('<') && t.includes('<head'))
}

export function parseApiJson(text, path, contentType) {
  const trimmed = (text || '').trim()
  if (!trimmed) return null
  if (contentType.includes('application/json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.parse(trimmed)
    } catch {
      throw new Error(`Risposta non è JSON valido (${path})`)
    }
  }
  return text
}
