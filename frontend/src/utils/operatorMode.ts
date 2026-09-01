import type { OperatorStationId } from './atlasAuth'
import { ensureHttpsUrl } from './urlSecurity'

export type { OperatorStationId }
export { ensureHttpsUrl }

/** Percorso pubblico: solo Nuovo ordine. */
export const OPERATOR_ORDER_PATH = '/operatore-ordine'

/** Percorso pubblico: Nuova consegna + Storico consegne (navigazione interna). */
export const OPERATOR_DELIVERY_PATH = '/operatore-consegne'
export const OPERATOR_DELIVERY_HISTORY_SUFFIX = '/storico'

/** Percorso pubblico: Prima Nota di cassa (per locale / attività). */
export const OPERATOR_PRIMA_NOTA_PATH = '/operatore-prima-nota'

/** Postazione operativa Abba 42. */
export const OPERATOR_STATION_PATH = '/operatore-postazione'
/** Postazione operativa Zanardelli 19. */
export const OPERATOR_STATION_ZANARDELLI_PATH = '/operatore-postazione-zanardelli'
/** Postazione operativa Via Lattea. */
export const OPERATOR_STATION_LATTEA_PATH = '/operatore-postazione-lattea'

export const OPERATOR_STATION_PATHS: Record<OperatorStationId, string> = {
  abba: OPERATOR_STATION_PATH,
  zanardelli: OPERATOR_STATION_ZANARDELLI_PATH,
  lattea: OPERATOR_STATION_LATTEA_PATH,
}

const OPERATOR_STATION_LOCK_KEY = 'atlasOperatorStation'
const OPERATOR_STATION_ID_KEY = 'atlasOperatorStationId'
const OPERATOR_ENTRY_POINT_KEY = 'atlasEntryPoint'

export type OperatorDeliveryView =
  | 'overview'
  | 'suppliers'
  | 'new-delivery'
  | 'history'
  | 'magazzino'
  | 'trasportatori'
  | 'fatturazione'
  | 'prima-nota'

/** Sotto-percorso fatture nella postazione trasportatore (resta autenticato carrier). */
export const OPERATOR_DELIVERY_FATTURE_PATH = `${OPERATOR_DELIVERY_PATH}/fatture`

export type OperatorStationView =
  | 'overview'
  | 'suppliers'
  | 'orders'
  | 'delivery'
  | 'delivery-history'
  | 'magazzino'
  | 'staff'
  | 'staff-report'
  | 'stipendi'
  | 'prima-nota'
  | 'trasportatori'
  | 'fatture'
  | 'support-tech'

/** Origine pubblica per link satelliti (sempre https in produzione se VITE_PUBLIC_APP_URL è impostato). */
export function getPublicAppOrigin(): string {
  const fromEnv = String(import.meta.env.VITE_PUBLIC_APP_URL || '').trim().replace(/\/+$/, '')
  if (fromEnv) {
    const withProto = /^https?:\/\//i.test(fromEnv) ? fromEnv : `https://${fromEnv}`
    return ensureHttpsUrl(withProto).replace(/\/+$/, '')
  }
  if (typeof window === 'undefined') return ''
  let origin = window.location.origin
  const host = window.location.hostname.toLowerCase()
  const isLocal = host === 'localhost' || host === '127.0.0.1'
  if (origin.startsWith('http://') && !isLocal) {
    origin = `https://${origin.slice(7)}`
  }
  return origin
}

function normalizePathname(): string {
  if (typeof window === 'undefined') return '/'
  return (window.location.pathname || '/').replace(/\/$/, '') || '/'
}

function normalizeHash(): string {
  if (typeof window === 'undefined') return ''
  return (window.location.hash || '').replace(/^#\/?/, '')
}

function buildPublicUrl(pathSegment: string): string {
  const origin = getPublicAppOrigin()
  if (!origin) return pathSegment
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
  const path = `${base}${pathSegment}`.replace(/\/{2,}/g, '/')
  const full = `${origin}${path.startsWith('/') ? path : `/${path}`}`
  return ensureHttpsUrl(full)
}

function pathMatches(segment: string): boolean {
  const path = normalizePathname()
  return path === segment || path.endsWith(segment)
}

function hashMatches(segment: string): boolean {
  const hash = normalizeHash()
  return hash === segment || hash.startsWith(`${segment}?`) || hash.startsWith(`${segment}/`)
}

function queryMatches(value: string): boolean {
  if (typeof window === 'undefined') return false
  return new URLSearchParams(window.location.search).get('modalita') === value
}

export function getOperatorStationBasePath(stationId: OperatorStationId = 'abba'): string {
  return OPERATOR_STATION_PATHS[stationId] || OPERATOR_STATION_PATH
}

export function getOperatorStationFatturePath(stationId: OperatorStationId = 'abba'): string {
  return `${getOperatorStationBasePath(stationId)}/fatture`
}

export function resolveOperatorStationIdFromPath(pathname?: string): OperatorStationId | null {
  const path = (pathname || normalizePathname()).replace(/\/$/, '') || '/'
  if (path === OPERATOR_STATION_ZANARDELLI_PATH || path.startsWith(`${OPERATOR_STATION_ZANARDELLI_PATH}/`)) {
    return 'zanardelli'
  }
  if (path === OPERATOR_STATION_LATTEA_PATH || path.startsWith(`${OPERATOR_STATION_LATTEA_PATH}/`)) {
    return 'lattea'
  }
  if (path === OPERATOR_STATION_PATH || path.startsWith(`${OPERATOR_STATION_PATH}/`)) {
    return 'abba'
  }
  return null
}

export function entryPointToStationId(raw: string | null | undefined): OperatorStationId | null {
  const value = String(raw || '')
    .trim()
    .toLowerCase()
  if (value === 'station' || value === 'station-abba') return 'abba'
  if (value === 'station-zanardelli') return 'zanardelli'
  if (value === 'station-lattea') return 'lattea'
  return null
}

export function stationIdToEntryPoint(stationId: OperatorStationId): string {
  if (stationId === 'zanardelli') return 'station-zanardelli'
  if (stationId === 'lattea') return 'station-lattea'
  return 'station'
}

export function isOperatorOrderMode(): boolean {
  if (typeof window === 'undefined') return false
  if (pathMatches(OPERATOR_ORDER_PATH)) return true
  if (hashMatches('operatore-ordine')) return true
  return queryMatches('operatore-ordine')
}

export function isOperatorDeliveryMode(): boolean {
  if (typeof window === 'undefined') return false
  const path = normalizePathname()
  if (path === OPERATOR_DELIVERY_PATH || path.startsWith(`${OPERATOR_DELIVERY_PATH}/`)) return true
  if (hashMatches('operatore-consegne')) return true
  return queryMatches('operatore-consegne')
}

export function isOperatorPrimaNotaMode(): boolean {
  if (typeof window === 'undefined') return false
  if (pathMatches(OPERATOR_PRIMA_NOTA_PATH)) return true
  if (hashMatches('operatore-prima-nota')) return true
  return queryMatches('operatore-prima-nota')
}

export function isOperatorStationMode(): boolean {
  if (typeof window === 'undefined') return false
  if (resolveOperatorStationIdFromPath()) return true
  if (hashMatches('operatore-postazione')) return true
  if (hashMatches('operatore-postazione-zanardelli')) return true
  if (hashMatches('operatore-postazione-lattea')) return true
  return (
    queryMatches('operatore-postazione') ||
    queryMatches('operatore-postazione-zanardelli') ||
    queryMatches('operatore-postazione-lattea')
  )
}

export function isOperatorStationLocked(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return sessionStorage.getItem(OPERATOR_STATION_LOCK_KEY) === '1'
  } catch {
    return false
  }
}

export function getLockedOperatorStationId(): OperatorStationId {
  if (typeof window === 'undefined') return 'abba'
  try {
    const fromSession = entryPointToStationId(sessionStorage.getItem(OPERATOR_STATION_ID_KEY))
    if (fromSession) return fromSession
    const fromEntry = entryPointToStationId(localStorage.getItem(OPERATOR_ENTRY_POINT_KEY))
    if (fromEntry) return fromEntry
  } catch {
    // ignore
  }
  return 'abba'
}

export function shouldOpenOperatorStation(): boolean {
  if (isOperatorStationLocked()) return true
  if (typeof window === 'undefined') return false
  try {
    return entryPointToStationId(localStorage.getItem(OPERATOR_ENTRY_POINT_KEY)) != null
  } catch {
    return false
  }
}

export function setOperatorStationLock(active: boolean, stationId: OperatorStationId = 'abba'): void {
  if (typeof window === 'undefined') return
  try {
    if (active) {
      sessionStorage.setItem(OPERATOR_STATION_LOCK_KEY, '1')
      sessionStorage.setItem(OPERATOR_STATION_ID_KEY, stationId)
      // Preferenza PWA permanente: non va cancellata al logout, altrimenti
      // l'app installata riparte sul gestionale grande (credenziali michele).
      localStorage.setItem(OPERATOR_ENTRY_POINT_KEY, stationIdToEntryPoint(stationId))
    } else {
      sessionStorage.removeItem(OPERATOR_STATION_LOCK_KEY)
      sessionStorage.removeItem(OPERATOR_STATION_ID_KEY)
      // Non rimuovere OPERATOR_ENTRY_POINT_KEY: serve alla PWA chiusa/riaperta.
    }
  } catch {
    // ignore
  }
}

export function markOperatorStationEntryPoint(stationId: OperatorStationId = 'abba'): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(OPERATOR_ENTRY_POINT_KEY, stationIdToEntryPoint(stationId))
    sessionStorage.setItem(OPERATOR_STATION_ID_KEY, stationId)
  } catch {
    // ignore
  }
}

const STATION_SECTION_BY_VIEW: Record<Exclude<OperatorStationView, 'overview' | 'fatture'>, string> = {
  suppliers: 'fornitori',
  orders: 'ordini',
  delivery: 'consegna',
  'delivery-history': 'storico-consegne',
  magazzino: 'magazzino',
  staff: 'personale',
  'staff-report': 'report-personale',
  stipendi: 'stipendi',
  'prima-nota': 'prima-nota',
  trasportatori: 'trasportatori',
  'support-tech': 'assistenza-tecnici',
}

const STATION_VIEW_ALIASES: Record<string, OperatorStationView> = {
  personale: 'staff',
  staff: 'staff',
  fornitori: 'suppliers',
  suppliers: 'suppliers',
  fornitore: 'suppliers',
  ordini: 'orders',
  orders: 'orders',
  ordine: 'orders',
  consegna: 'delivery',
  'nuova-consegna': 'delivery',
  delivery: 'delivery',
  storico: 'delivery-history',
  'storico-consegne': 'delivery-history',
  history: 'delivery-history',
  magazzino: 'magazzino',
  'report-personale': 'staff-report',
  report: 'staff-report',
  stipendi: 'stipendi',
  'prima-nota': 'prima-nota',
  primanota: 'prima-nota',
  cassa: 'prima-nota',
  trasportatori: 'trasportatori',
  trasportatore: 'trasportatori',
  corrieri: 'trasportatori',
  fatture: 'fatture',
  fatturazione: 'fatture',
  'fatture-fornitori': 'fatture',
  'assistenza-tecnici': 'support-tech',
  'support-tech': 'support-tech',
  tecnici: 'support-tech',
  assistenza: 'support-tech',
  panoramica: 'overview',
  overview: 'overview',
  dashboard: 'overview',
}

export function getOperatorStationView(stationId: OperatorStationId = 'abba'): OperatorStationView {
  if (typeof window === 'undefined') return 'orders'
  const fatturePath = getOperatorStationFatturePath(stationId)
  const path = normalizePathname()
  if (path === fatturePath || path.startsWith(`${fatturePath}/`)) return 'fatture'
  const q = new URLSearchParams(window.location.search)
  const raw = String(q.get('sezione') || '').trim().toLowerCase()
  if (raw && STATION_VIEW_ALIASES[raw]) return STATION_VIEW_ALIASES[raw]
  return 'overview'
}

const DELIVERY_VIEW_BY_PAGINA: Record<string, OperatorDeliveryView> = {
  panoramica: 'overview',
  overview: 'overview',
  fornitori: 'suppliers',
  suppliers: 'suppliers',
  consegna: 'new-delivery',
  'nuova-consegna': 'new-delivery',
  delivery: 'new-delivery',
  storico: 'history',
  history: 'history',
  'storico-consegne': 'history',
  magazzino: 'magazzino',
  trasportatori: 'trasportatori',
  trasportatore: 'trasportatori',
  corrieri: 'trasportatori',
  fatturazione: 'fatturazione',
  fatture: 'fatturazione',
  'prima-nota': 'prima-nota',
  primanota: 'prima-nota',
}

const DELIVERY_PAGINA_BY_VIEW: Record<OperatorDeliveryView, string | null> = {
  overview: null,
  suppliers: 'fornitori',
  'new-delivery': 'consegna',
  history: 'storico',
  magazzino: 'magazzino',
  trasportatori: 'trasportatori',
  fatturazione: null,
  'prima-nota': 'prima-nota',
}

export function getOperatorDeliveryView(): OperatorDeliveryView {
  if (typeof window === 'undefined') return 'overview'
  const path = normalizePathname()
  const hash = normalizeHash()
  if (path === OPERATOR_DELIVERY_FATTURE_PATH || path.startsWith(`${OPERATOR_DELIVERY_FATTURE_PATH}/`)) {
    return 'fatturazione'
  }
  if (
    path.endsWith(`${OPERATOR_DELIVERY_PATH}${OPERATOR_DELIVERY_HISTORY_SUFFIX}`) ||
    hash === 'operatore-consegne/storico' ||
    hash.startsWith('operatore-consegne/storico?')
  ) {
    return 'history'
  }
  const q = new URLSearchParams(window.location.search)
  const raw = String(q.get('pagina') || q.get('sezione') || '')
    .trim()
    .toLowerCase()
  if (raw && DELIVERY_VIEW_BY_PAGINA[raw]) return DELIVERY_VIEW_BY_PAGINA[raw]
  return 'overview'
}

export function getOperatorOrderPublicUrl(): string {
  return buildPublicUrl(OPERATOR_ORDER_PATH)
}

/** Link postazione trasportatore (panoramica / fornitori / consegne). */
export function getOperatorDeliveryPublicUrl(view: OperatorDeliveryView = 'overview'): string {
  if (view === 'fatturazione') return buildPublicUrl(OPERATOR_DELIVERY_FATTURE_PATH)
  const base = buildPublicUrl(OPERATOR_DELIVERY_PATH)
  const pagina = DELIVERY_PAGINA_BY_VIEW[view]
  if (!pagina) return base
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}pagina=${pagina}`
}

/** Path relativo per React Router sulla postazione trasportatore. */
export function getOperatorDeliveryRouterPath(view: OperatorDeliveryView = 'overview'): string {
  if (view === 'fatturazione') return OPERATOR_DELIVERY_FATTURE_PATH
  const pagina = DELIVERY_PAGINA_BY_VIEW[view]
  if (!pagina) return OPERATOR_DELIVERY_PATH
  return `${OPERATOR_DELIVERY_PATH}?pagina=${pagina}`
}

export function getOperatorPrimaNotaPublicUrl(): string {
  return buildPublicUrl(OPERATOR_PRIMA_NOTA_PATH)
}

export function getOperatorStationPublicUrl(
  view: OperatorStationView = 'overview',
  stationId: OperatorStationId = 'abba',
): string {
  const basePath = getOperatorStationBasePath(stationId)
  if (view === 'fatture') return buildPublicUrl(getOperatorStationFatturePath(stationId))
  const base = buildPublicUrl(basePath)
  if (view === 'overview') return base
  const section = STATION_SECTION_BY_VIEW[view]
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}sezione=${section}`
}

/** Path relativo per React Router (non URL assoluta https://…). */
export function getOperatorStationRouterPath(
  view: OperatorStationView = 'overview',
  stationId: OperatorStationId = 'abba',
): string {
  const basePath = getOperatorStationBasePath(stationId)
  if (view === 'fatture') return getOperatorStationFatturePath(stationId)
  if (view === 'overview') return basePath
  const section = STATION_SECTION_BY_VIEW[view]
  return `${basePath}?sezione=${section}`
}

/** Aggiorna l’URL (senza ricaricare) quando l’operatore cambia sezione. */
export function syncOperatorStationViewInUrl(
  view: OperatorStationView,
  stationId: OperatorStationId = 'abba',
): void {
  if (typeof window === 'undefined') return
  const url = getOperatorStationPublicUrl(view, stationId)
  window.history.replaceState(null, '', url)
}

/** Aggiorna l’URL (senza ricaricare) quando l’operatore cambia scheda; resta sullo stesso percorso base. */
export function syncOperatorDeliveryViewInUrl(view: OperatorDeliveryView): void {
  if (typeof window === 'undefined') return
  const url = ensureHttpsUrl(getOperatorDeliveryPublicUrl(view))
  window.history.replaceState(null, '', url)
}
