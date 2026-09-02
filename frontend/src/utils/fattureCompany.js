import { apiFetch } from '../services/api.js'
import { getOperatorStationActivitySlug } from './operatorStationLocale.js'
import {
  getLockedOperatorStationId,
  isOperatorDeliveryMode,
  isOperatorStationMode,
  resolveOperatorStationIdFromPath,
} from './operatorMode.ts'

const STORAGE_KEY = 'atlasFattureCompany:v1'

export const FATTURE_COMPANY_ORDER = ['mediazione', 'via_lattea', 'risacca', 'pg']

export const FATTURE_COMPANY_LABELS = {
  mediazione: 'Mediazione',
  via_lattea: 'Via Lattea',
  risacca: 'Risacca',
  pg: 'PG',
}

/** Slug attività postazione → società SDI (registro fatture locale). */
const ACTIVITY_SLUG_TO_SDI_COMPANY = {
  via_abba: 'mediazione',
  via_zanardelli: 'mediazione',
  mediazione: 'mediazione',
  via_lattea: 'via_lattea',
  risacca: 'risacca',
  pg: 'pg',
}

/** Società → attività Prima Nota / centri di costo collegati. */
export const COMPANY_TO_ACTIVITIES = {
  mediazione: ['via_abba', 'via_zanardelli', 'mediazione'],
  via_lattea: ['via_lattea'],
  risacca: ['risacca'],
  pg: ['pg'],
}

export const ACTIVITY_LABELS = {
  via_abba: 'Via Abba',
  via_zanardelli: 'Via Zanardelli',
  mediazione: 'Mediazione',
  via_lattea: 'Via Lattea',
  risacca: 'Risacca',
  pg: 'PG',
}

export function isGestionaleFattureContext(fattureBase = '/fatture') {
  return String(fattureBase || '/fatture').replace(/\/+$/, '') === '/fatture'
}

/** Società SDI fissa per postazione operativa (nessun menu a tendina). */
export function stationIdToFattureCompany(stationId) {
  const slug = getOperatorStationActivitySlug(stationId)
  return ACTIVITY_SLUG_TO_SDI_COMPANY[slug] || ''
}

export function resolveEmbeddedFattureCompany() {
  if (typeof window === 'undefined') return ''
  if (isOperatorStationMode()) {
    const stationId = resolveOperatorStationIdFromPath() || getLockedOperatorStationId()
    return stationIdToFattureCompany(stationId)
  }
  if (isOperatorDeliveryMode()) {
    return 'risacca'
  }
  return ''
}

export function readFattureCompany() {
  try {
    return String(sessionStorage.getItem(STORAGE_KEY) || '').trim()
  } catch {
    return ''
  }
}

export function writeFattureCompany(companyId) {
  try {
    const value = String(companyId || '').trim()
    if (!value) sessionStorage.removeItem(STORAGE_KEY)
    else sessionStorage.setItem(STORAGE_KEY, value)
  } catch {
    // ignore
  }
}

export async function fetchFattureCompanies() {
  const data = await apiFetch('/sdi/companies')
  const rows = Array.isArray(data?.companies) ? data.companies : []
  return rows.filter((row) => row?.id && FATTURE_COMPANY_LABELS[row.id])
}

export function companyLabel(companyId) {
  const id = String(companyId || '').trim()
  return FATTURE_COMPANY_LABELS[id] || id || '—'
}

export function activityLabel(activity) {
  const id = String(activity || '').trim().toLowerCase()
  return ACTIVITY_LABELS[id] || id || '—'
}

export function companyFromActivity(activity) {
  const id = String(activity || '').trim().toLowerCase()
  return ACTIVITY_SLUG_TO_SDI_COMPANY[id] || ''
}

/** Attività Prima Nota da caricare per una società (mastrini / registri). */
export function activitiesForCompany(companyId) {
  const id = String(companyId || '').trim().toLowerCase()
  if (id === 'non_classificata') return []
  return COMPANY_TO_ACTIVITIES[id] ? [...COMPANY_TO_ACTIVITIES[id]] : []
}
