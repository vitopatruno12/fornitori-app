/** Collegamento slug Prima Nota → nome locale in Personale (codice zona condiviso). */

export const DEFAULT_PRIMA_NOTA_STAFF_LOCALE_LINKS = {
  risacca: 'Bar-momento',
  via_zanardelli: 'La mediazione via zanardelli',
  via_abba: 'Mediazione via abba',
  via_lattea: 'La Via Lattea',
}

/** Token distintivi per trovare il nome locale salvato sul server (es. *_zanardelli_19). */
export const STAFF_LOCALE_SLUG_TOKENS = {
  via_zanardelli: ['zanardelli'],
  via_abba: ['abba'],
  via_lattea: ['lattea'],
  risacca: ['risacca', 'momento'],
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
  const key = staffLocaleCompareKey(preferredName)
  if (!key) return ''
  for (const name of availableNames) {
    if (staffLocaleCompareKey(name) === key) return String(name)
  }
  const slug = String(activitySlug || '').trim().toLowerCase()
  const tokens = STAFF_LOCALE_SLUG_TOKENS[slug] || []
  if (tokens.length) {
    for (const name of availableNames) {
      const nameKey = staffLocaleCompareKey(name)
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
