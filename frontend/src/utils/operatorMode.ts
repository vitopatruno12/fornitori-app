/** Percorso pubblico: solo Nuovo ordine. */
export const OPERATOR_ORDER_PATH = '/operatore-ordine'

/** Percorso pubblico: Nuova consegna + Storico consegne (navigazione interna). */
export const OPERATOR_DELIVERY_PATH = '/operatore-consegne'
export const OPERATOR_DELIVERY_HISTORY_SUFFIX = '/storico'

/** Percorso pubblico: Prima Nota di cassa (per locale / attività). */
export const OPERATOR_PRIMA_NOTA_PATH = '/operatore-prima-nota'

/** Postazione operativa: Personale, Ordini e Prima Nota in un solo link (PWA). */
export const OPERATOR_STATION_PATH = '/operatore-postazione'

const OPERATOR_STATION_LOCK_KEY = 'atlasOperatorStation'
const OPERATOR_ENTRY_POINT_KEY = 'atlasEntryPoint'

export type OperatorDeliveryView = 'new-delivery' | 'history' | 'magazzino'
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

import { ensureHttpsUrl } from './urlSecurity'

export { ensureHttpsUrl }

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

export function isOperatorOrderMode(): boolean {
  if (typeof window === 'undefined') return false
  if (pathMatches(OPERATOR_ORDER_PATH)) return true
  if (hashMatches('operatore-ordine')) return true
  return queryMatches('operatore-ordine')
}

export function isOperatorDeliveryMode(): boolean {
  if (typeof window === 'undefined') return false
  if (pathMatches(OPERATOR_DELIVERY_PATH)) return true
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
  if (pathMatches(OPERATOR_STATION_PATH)) return true
  if (hashMatches('operatore-postazione')) return true
  return queryMatches('operatore-postazione')
}

export function isOperatorStationLocked(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return sessionStorage.getItem(OPERATOR_STATION_LOCK_KEY) === '1'
  } catch {
    return false
  }
}

export function shouldOpenOperatorStation(): boolean {
  if (isOperatorStationLocked()) return true
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(OPERATOR_ENTRY_POINT_KEY) === 'station'
  } catch {
    return false
  }
}

export function setOperatorStationLock(active: boolean): void {
  if (typeof window === 'undefined') return
  try {
    if (active) {
      sessionStorage.setItem(OPERATOR_STATION_LOCK_KEY, '1')
      localStorage.setItem(OPERATOR_ENTRY_POINT_KEY, 'station')
    } else {
      sessionStorage.removeItem(OPERATOR_STATION_LOCK_KEY)
      localStorage.removeItem(OPERATOR_ENTRY_POINT_KEY)
    }
  } catch {
    // ignore
  }
}

export function markOperatorStationEntryPoint(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(OPERATOR_ENTRY_POINT_KEY, 'station')
  } catch {
    // ignore
  }
}

const STATION_SECTION_BY_VIEW: Record<Exclude<OperatorStationView, 'overview'>, string> = {
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
  panoramica: 'overview',
  overview: 'overview',
  dashboard: 'overview',
}

export function getOperatorStationView(): OperatorStationView {
  if (typeof window === 'undefined') return 'orders'
  const q = new URLSearchParams(window.location.search)
  const raw = String(q.get('sezione') || '').trim().toLowerCase()
  if (raw && STATION_VIEW_ALIASES[raw]) return STATION_VIEW_ALIASES[raw]
  return 'overview'
}

export function getOperatorDeliveryView(): OperatorDeliveryView {
  if (typeof window === 'undefined') return 'new-delivery'
  const path = normalizePathname()
  const hash = normalizeHash()
  if (
    path.endsWith(`${OPERATOR_DELIVERY_PATH}${OPERATOR_DELIVERY_HISTORY_SUFFIX}`) ||
    hash === 'operatore-consegne/storico' ||
    hash.startsWith('operatore-consegne/storico?')
  ) {
    return 'history'
  }
  const q = new URLSearchParams(window.location.search)
  if (q.get('pagina') === 'storico') return 'history'
  if (q.get('pagina') === 'magazzino') return 'magazzino'
  return 'new-delivery'
}

export function getOperatorOrderPublicUrl(): string {
  return buildPublicUrl(OPERATOR_ORDER_PATH)
}

/** Un solo link da condividere: apre Nuova consegna e Storico (schede in pagina). */
export function getOperatorDeliveryPublicUrl(): string {
  return buildPublicUrl(OPERATOR_DELIVERY_PATH)
}

export function getOperatorPrimaNotaPublicUrl(): string {
  return buildPublicUrl(OPERATOR_PRIMA_NOTA_PATH)
}

export function getOperatorStationPublicUrl(view: OperatorStationView = 'overview'): string {
  const base = buildPublicUrl(OPERATOR_STATION_PATH)
  if (view === 'overview') return base
  const section = STATION_SECTION_BY_VIEW[view]
  const sep = base.includes('?') ? '&' : '?'
  return `${base}${sep}sezione=${section}`
}

/** Aggiorna l’URL (senza ricaricare) quando l’operatore cambia sezione. */
export function syncOperatorStationViewInUrl(view: OperatorStationView): void {
  if (typeof window === 'undefined') return
  const url = getOperatorStationPublicUrl(view)
  window.history.replaceState(null, '', url)
}

/** Aggiorna l’URL (senza ricaricare) quando l’operatore cambia scheda; resta sullo stesso percorso base. */
export function syncOperatorDeliveryViewInUrl(view: OperatorDeliveryView): void {
  if (typeof window === 'undefined') return
  const base = getOperatorDeliveryPublicUrl()
  const url = ensureHttpsUrl(
    view === 'history' ? `${base}?pagina=storico` : view === 'magazzino' ? `${base}?pagina=magazzino` : base,
  )
  window.history.replaceState(null, '', url)
}
