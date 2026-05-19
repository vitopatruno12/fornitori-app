/** Locali predefiniti (slug salvato in DB su cash_entries.activity). */
export const DEFAULT_PRIMA_NOTA_LOCALES = [
  { id: 'risacca', label: 'Risacca', builtin: true },
  { id: 'via_lattea', label: 'La Via Lattea', builtin: true },
  { id: 'via_abba', label: 'Mediazione Via Abba', builtin: true },
  { id: 'via_zanardelli', label: 'Mediazione Via Zanardelli', builtin: true },
]

export const DEFAULT_PRIMA_NOTA_ACTIVITY = 'risacca'
export const PRIMA_NOTA_LOCALES_STORAGE_KEY = 'primaNotaLocalesCustom'

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

export function loadPrimaNotaLocales() {
  const defaults = DEFAULT_PRIMA_NOTA_LOCALES.map((l) => ({ ...l }))
  try {
    const raw = localStorage.getItem(PRIMA_NOTA_LOCALES_STORAGE_KEY)
    if (!raw) return defaults
    const saved = JSON.parse(raw)
    if (!Array.isArray(saved)) return defaults
    const defaultIds = new Set(defaults.map((d) => d.id))
    const customs = saved
      .filter((l) => l && l.id && l.label && !defaultIds.has(l.id) && isValidLocaleSlug(l.id))
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
