/** Percorso pubblico: solo Nuovo ordine. */
export const OPERATOR_ORDER_PATH = '/operatore-ordine'

/** Percorso pubblico: Nuova consegna + Storico consegne (navigazione interna). */
export const OPERATOR_DELIVERY_PATH = '/operatore-consegne'
export const OPERATOR_DELIVERY_HISTORY_SUFFIX = '/storico'

export type OperatorDeliveryView = 'new-delivery' | 'history'

function normalizePathname(): string {
  if (typeof window === 'undefined') return '/'
  return (window.location.pathname || '/').replace(/\/$/, '') || '/'
}

function normalizeHash(): string {
  if (typeof window === 'undefined') return ''
  return (window.location.hash || '').replace(/^#\/?/, '')
}

function buildPublicUrl(pathSegment: string): string {
  if (typeof window === 'undefined') return pathSegment
  const base = (import.meta.env.BASE_URL || '/').replace(/\/$/, '')
  const path = `${base}${pathSegment}`.replace(/\/{2,}/g, '/')
  return `${window.location.origin}${path.startsWith('/') ? path : `/${path}`}`
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

/** Un solo link da conmotione: apre Nuova consegna e Storico (schede in pagina). */
export function getOperatorDeliveryPublicUrl(): string {
  return buildPublicUrl(OPERATOR_DELIVERY_PATH)
}

/** Aggiorna l’URL (senza ricaricare) quando l’operatore cambia scheda; resta sullo stesso percorso base. */
export function syncOperatorDeliveryViewInUrl(view: OperatorDeliveryView): void {
  if (typeof window === 'undefined') return
  const base = getOperatorDeliveryPublicUrl()
  const url = view === 'history' ? `${base}?pagina=storico` : base
  window.history.replaceState(null, '', url)
}
