/** Locali predefiniti (slug salvato in DB su cash_entries.activity). */
export const DEFAULT_PRIMA_NOTA_LOCALES = [
  { id: 'risacca', label: 'Risacca', builtin: true },
  { id: 'via_lattea', label: 'La Via Lattea', builtin: true },
  { id: 'via_abba', label: 'Mediazione Via Abba', builtin: true },
  { id: 'via_zanardelli', label: 'Mediazione Via Zanardelli', builtin: true },
]

export const DEFAULT_PRIMA_NOTA_ACTIVITY = 'risacca'
export const PRIMA_NOTA_LOCALES_STORAGE_KEY = 'primaNotaLocalesCustom'
export const PRIMA_NOTA_LOCALES_HIDDEN_KEY = 'primaNotaLocalesHidden'

/** @deprecated usa DEFAULT_PRIMA_NOTA_LOCALES */
export const PRIMA_NOTA_ACTIVITIES = DEFAULT_PRIMA_NOTA_LOCALES.map(({ id, label }) => ({ id, label }))

export const LEGACY_PRIMA_NOTA_ACTIVITY_MAP = {
  mediazione: 'via_abba',
}

export function slugifyLocaleLabel(label) {
  const base = String(label || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32)
  return base || 'locale'
}

export function isValidLocaleSlug(id) {
  return /^[a-z0-9_]{1,32}$/.test(String(id || ''))
}

function readHiddenLocaleIds() {
  try {
    const raw = localStorage.getItem(PRIMA_NOTA_LOCALES_HIDDEN_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((id) => String(id || '').trim().toLowerCase()).filter(isValidLocaleSlug)
  } catch {
    return []
  }
}

function writeHiddenLocaleIds(ids) {
  const unique = [...new Set((ids || []).map((id) => String(id || '').trim().toLowerCase()).filter(isValidLocaleSlug))]
  localStorage.setItem(PRIMA_NOTA_LOCALES_HIDDEN_KEY, JSON.stringify(unique))
}

export function loadPrimaNotaLocales() {
  const hidden = new Set(readHiddenLocaleIds())
  const defaults = DEFAULT_PRIMA_NOTA_LOCALES.filter((l) => !hidden.has(l.id)).map((l) => ({ ...l }))
  try {
    const raw = localStorage.getItem(PRIMA_NOTA_LOCALES_STORAGE_KEY)
    if (!raw) return defaults
    const saved = JSON.parse(raw)
    if (!Array.isArray(saved)) return defaults
    const defaultIds = new Set(DEFAULT_PRIMA_NOTA_LOCALES.map((d) => d.id))
    const customs = saved
      .filter((l) => l && l.id && l.label && !defaultIds.has(l.id) && !hidden.has(l.id) && isValidLocaleSlug(l.id))
      .map((l) => ({ id: l.id, label: String(l.label).trim(), builtin: false }))
    return [...defaults, ...customs]
  } catch {
    return defaults
  }
}

export function persistCustomLocales(locales) {
  const customs = locales
    .filter((l) => !l.builtin)
    .map(({ id, label }) => ({ id, label }))
  localStorage.setItem(PRIMA_NOTA_LOCALES_STORAGE_KEY, JSON.stringify(customs))
}

/** Rimuove un registro dall’elenco (personalizzato o predefinito nascosto su questo browser). */
export function removeLocaleById(localeId) {
  const id = String(localeId || '').trim().toLowerCase()
  if (!id) return loadPrimaNotaLocales()
  const all = loadPrimaNotaLocales()
  const target = all.find((l) => String(l.id).toLowerCase() === id)
  if (!target) return all

  if (target.builtin || DEFAULT_PRIMA_NOTA_LOCALES.some((d) => d.id === id)) {
    const hidden = readHiddenLocaleIds()
    if (!hidden.includes(id)) writeHiddenLocaleIds([...hidden, id])
  } else {
    const nextCustoms = all.filter((l) => !l.builtin && String(l.id).toLowerCase() !== id)
    persistCustomLocales(nextCustoms)
  }
  return loadPrimaNotaLocales()
}

/** Ripristina un registro predefinito nascosto su questo browser. */
export function restoreHiddenLocaleById(localeId) {
  const id = String(localeId || '').trim().toLowerCase()
  if (!id) return loadPrimaNotaLocales()
  writeHiddenLocaleIds(readHiddenLocaleIds().filter((x) => x !== id))
  return loadPrimaNotaLocales()
}

/** @deprecated usa removeLocaleById */
export function removeCustomLocaleById(localeId) {
  return removeLocaleById(localeId)
}

export function listCustomPrimaNotaLocales(locales = null) {
  const list = locales || loadPrimaNotaLocales()
  return list.filter((l) => !l.builtin)
}

export function normalizePrimaNotaActivity(id, locales = null) {
  if (!id) return DEFAULT_PRIMA_NOTA_ACTIVITY
  const list = locales || loadPrimaNotaLocales()
  if (list.some((l) => l.id === id)) return id
  if (LEGACY_PRIMA_NOTA_ACTIVITY_MAP[id]) return LEGACY_PRIMA_NOTA_ACTIVITY_MAP[id]
  if (isValidLocaleSlug(id)) return id
  return DEFAULT_PRIMA_NOTA_ACTIVITY
}

export function localeLabel(id, locales = null) {
  const normalized = normalizePrimaNotaActivity(id, locales)
  const list = locales || loadPrimaNotaLocales()
  const hit = list.find((l) => l.id === normalized)
  return hit ? hit.label : normalized || '—'
}

/** @deprecated usa localeLabel */
export function primaNotaActivityLabel(id, locales = null) {
  return localeLabel(id, locales)
}
