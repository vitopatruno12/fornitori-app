/** Collegamento slug Prima Nota → nome locale in Personale (codice zona condiviso). */

export const DEFAULT_PRIMA_NOTA_STAFF_LOCALE_LINKS = {
  risacca: 'Bar-momento',
  via_zanardelli: 'La mediazione via zanardelli',
  via_abba: 'Mediazione via abba',
  via_lattea: 'Mucche Volanti',
}

/** Nomi alternativi accettati per il locale personale (es. «La Via Lattea» = Mucche Volanti). */
export const STAFF_LOCALE_MATCH_CANDIDATES = {
  via_lattea: ['Mucche Volanti', 'Le Mucche Volanti', 'La Via Lattea'],
}

/** Token distintivi per trovare il nome locale salvato sul server (es. *_zanardelli_19). */
export const STAFF_LOCALE_SLUG_TOKENS = {
  via_zanardelli: ['zanardelli'],
  via_abba: ['abba'],
  via_lattea: ['mucche', 'volanti'],
  risacca: ['risacca', 'momento'],
}

/** Frammenti da escludere nel match fuzzy (evita Mani in Pasta / altre sedi). */
export const STAFF_LOCALE_EXCLUDED_NAME_FRAGMENTS = {
  via_lattea: ['abba', 'zanardelli', 'maninpasta', 'maniinpasta', 'mediazione'],
}

export function staffLocaleCompareKey(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('it')
    .replace(/[\s_-]+/g, '')
}

export function getStaffLocaleLinkForActivity(activitySlug) {
  const slug = String(activitySlug || '').trim().toLowerCase()
  return DEFAULT_PRIMA_NOTA_STAFF_LOCALE_LINKS[slug] || ''
}

export function matchStaffLocaleName(preferredName, availableNames = [], activitySlug = '') {
  const slug = String(activitySlug || '').trim().toLowerCase()
  const candidates = STAFF_LOCALE_MATCH_CANDIDATES[slug] || [preferredName]
  const seen = new Set()
  for (const candidate of candidates) {
    const key = staffLocaleCompareKey(candidate)
    if (!key || seen.has(key)) continue
    seen.add(key)
    for (const name of availableNames) {
      if (staffLocaleCompareKey(name) === key) return String(name)
    }
  }
  const tokens = STAFF_LOCALE_SLUG_TOKENS[slug] || []
  const excluded = STAFF_LOCALE_EXCLUDED_NAME_FRAGMENTS[slug] || []
  if (tokens.length) {
    for (const name of availableNames) {
      const nameKey = staffLocaleCompareKey(name)
      if (excluded.some((fragment) => nameKey.includes(fragment))) continue
      if (tokens.every((token) => nameKey.includes(token))) return String(name)
    }
  }
  return String(preferredName || '').trim()
}

/** Nome canonico del locale Personale collegato (se esiste sul server). */
export function resolveStaffLocaleName(activitySlug, staffSummaries = []) {
  const preferred = getStaffLocaleLinkForActivity(activitySlug)
  if (!preferred) return ''
  const names = (staffSummaries || []).map((row) => row?.locale_name).filter(Boolean)
  return matchStaffLocaleName(preferred, names, activitySlug)
}

export function findStaffLocaleSummary(activitySlug, staffSummaries = []) {
  const resolved = resolveStaffLocaleName(activitySlug, staffSummaries)
  if (!resolved) return null
  const key = staffLocaleCompareKey(resolved)
  return (
    (staffSummaries || []).find((row) => staffLocaleCompareKey(row?.locale_name) === key) || null
  )
}

export function staffLocaleRequiresCode(activitySlug, staffSummaries = []) {
  const hit = findStaffLocaleSummary(activitySlug, staffSummaries)
  return Boolean(hit?.requires_access_code)
}

export function staffLocaleHint(activitySlug, staffSummaries = []) {
  const name = resolveStaffLocaleName(activitySlug, staffSummaries)
  return name || getStaffLocaleLinkForActivity(activitySlug)
}
