import {
  DEFAULT_PRIMA_NOTA_STAFF_LOCALE_LINKS,
  STAFF_LOCALE_EXCLUDED_NAME_FRAGMENTS,
  STAFF_LOCALE_MATCH_CANDIDATES,
  STAFF_LOCALE_SLUG_TOKENS,
  matchStaffLocaleName,
  staffLocaleCompareKey,
} from './primaNotaStaffLocaleLink.js'

/** Slug Prima Nota collegato a ciascuna postazione operativa PWA. */
export const OPERATOR_STATION_ACTIVITY_SLUGS = {
  abba: 'via_abba',
  zanardelli: 'via_zanardelli',
  lattea: 'via_lattea',
}

export function getOperatorStationActivitySlug(stationId) {
  const key = String(stationId || '').trim().toLowerCase()
  return OPERATOR_STATION_ACTIVITY_SLUGS[key] || ''
}

/** Nome locale Personale predefinito per la postazione (es. «Mediazione via abba»). */
export function getOperatorStationStaffLocaleName(stationId, availableNames = []) {
  const slug = getOperatorStationActivitySlug(stationId)
  const preferred = DEFAULT_PRIMA_NOTA_STAFF_LOCALE_LINKS[slug] || ''
  if (!preferred) return ''
  return matchStaffLocaleName(preferred, availableNames, slug) || preferred
}

export function operatorStationLocaleKeysEqual(a, b) {
  return staffLocaleCompareKey(a) === staffLocaleCompareKey(b)
}

/**
 * True se il nome locale appartiene alla postazione (es. solo Mucche Volanti / La Via Lattea per lattea).
 * Non riusa matchStaffLocaleName con [linked, name] in lista: altrimenti qualsiasi nome
 * «matchava» Via Lattea e sulla PWA restavano i dipendenti Mani in Pasta.
 */
export function operatorStationLocaleNameMatches(stationId, localeName, availableNames = []) {
  const station = String(stationId || '').trim().toLowerCase()
  if (!station) return true
  const slug = getOperatorStationActivitySlug(stationId)
  const preferred = DEFAULT_PRIMA_NOTA_STAFF_LOCALE_LINKS[slug] || ''
  if (!preferred) return false

  const name = String(localeName || '').trim()
  if (!name) return false
  const nameKey = staffLocaleCompareKey(name)
  if (!nameKey) return false

  const excluded = STAFF_LOCALE_EXCLUDED_NAME_FRAGMENTS[slug] || []
  if (excluded.some((fragment) => nameKey.includes(fragment))) return false

  const linked = getOperatorStationStaffLocaleName(stationId, availableNames)
  if (linked && staffLocaleCompareKey(linked) === nameKey) return true
  if (staffLocaleCompareKey(preferred) === nameKey) return true

  const candidates = STAFF_LOCALE_MATCH_CANDIDATES[slug] || []
  if (candidates.some((c) => staffLocaleCompareKey(c) === nameKey)) return true

  const tokens = STAFF_LOCALE_SLUG_TOKENS[slug] || []
  if (tokens.length && tokens.every((token) => nameKey.includes(token))) return true
  if (slug === 'via_lattea' && nameKey.includes('lattea')) return true

  return false
}
