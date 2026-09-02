const STORAGE_KEY = 'primaNotaLocaleAccessCodes'

/** Codice ritirato — riscritto in 910689 (Via Lattea). */
const RETIRED_ACCESS_CODES = {
  via_lattea: '050408',
}
const CURRENT_ACCESS_CODES = {
  via_lattea: '910689',
}

function normalizeStoredCode(activitySlug, code) {
  const slug = String(activitySlug || '').trim().toLowerCase()
  const digits = String(code || '').replace(/\D/g, '')
  if (digits.length !== 6) return ''
  if (RETIRED_ACCESS_CODES[slug] && digits === RETIRED_ACCESS_CODES[slug]) {
    return CURRENT_ACCESS_CODES[slug] || digits
  }
  return digits
}

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeStore(store) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // ignore
  }
}

export function readStoredPrimaNotaAccessCode(activitySlug) {
  const slug = String(activitySlug || '').trim().toLowerCase()
  if (!slug) return ''
  const store = readStore()
  const code = normalizeStoredCode(slug, store[slug])
  return code.length === 6 ? code : ''
}

export function saveStoredPrimaNotaAccessCode(activitySlug, accessCode) {
  const slug = String(activitySlug || '').trim().toLowerCase()
  const code = String(accessCode || '').replace(/\D/g, '')
  if (!slug || code.length !== 6) return
  const store = readStore()
  store[slug] = normalizeStoredCode(slug, code) || code
  writeStore(store)
}

export function clearStoredPrimaNotaAccessCode(activitySlug) {
  const slug = String(activitySlug || '').trim().toLowerCase()
  if (!slug) return
  const store = readStore()
  delete store[slug]
  writeStore(store)
}

export function listStoredPrimaNotaAccessSlugs() {
  const store = readStore()
  return Object.keys(store).filter((slug) => String(store[slug] || '').replace(/\D/g, '').length === 6)
}
