/** Percorso pubblico: solo Nuovo ordine. */
export const OPERATOR_ORDER_PATH = '/operatore-ordine'

/** Percorso pubblico: Nuova consegna + Storico consegne (navigazione interna). */
export const OPERATOR_DELIVERY_PATH = '/operatore-consegne'
export const OPERATOR_DELIVERY_HISTORY_SUFFIX = '/storico'

/** Percorso pubblico: Prima Nota di cassa (per locale / attività). */
export const OPERATOR_PRIMA_NOTA_PATH = '/operatore-prima-nota'

export type OperatorDeliveryView = 'new-delivery' | 'history'

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

/** Aggiorna l’URL (senza ricaricare) quando l’operatore cambia scheda; resta sullo stesso percorso base. */
export function syncOperatorDeliveryViewInUrl(view: OperatorDeliveryView): void {
  if (typeof window === 'undefined') return
  const base = getOperatorDeliveryPublicUrl()
  const url = ensureHttpsUrl(view === 'history' ? `${base}?pagina=storico` : base)
  window.history.replaceState(null, '', url)
}
