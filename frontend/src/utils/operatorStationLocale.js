import {
  DEFAULT_PRIMA_NOTA_STAFF_LOCALE_LINKS,
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
