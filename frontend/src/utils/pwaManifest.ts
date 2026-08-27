import {
  entryPointToStationId,
  getLockedOperatorStationId,
  getOperatorStationBasePath,
  isOperatorDeliveryMode,
  isOperatorStationMode,
  OPERATOR_DELIVERY_PATH,
  OPERATOR_STATION_PATH,
  resolveOperatorStationIdFromPath,
  stationIdToEntryPoint,
  type OperatorStationId,
} from './operatorMode.ts'

const OPERATOR_MANIFEST_BY_STATION: Record<OperatorStationId, string> = {
  abba: '/manifest-operator.webmanifest',
  zanardelli: '/manifest-operator-zanardelli.webmanifest',
  lattea: '/manifest-operator-lattea.webmanifest',
}

const CARRIER_MANIFEST_HREF = '/manifest-carrier.webmanifest'
const PWA_LAUNCH_KEY = 'atlasPwaLaunchTarget'

export type PwaLaunchTarget = 'station' | 'station-zanardelli' | 'station-lattea' | 'carrier'

function stationIdToPwaTarget(stationId: OperatorStationId): PwaLaunchTarget {
  return stationIdToEntryPoint(stationId) as PwaLaunchTarget
}

/** Preferenza di avvio PWA: postazione operativa (non si cancella al logout). */
export function markOperatorPwaLaunchPreferred(stationId: OperatorStationId = 'abba'): void {
  try {
    localStorage.setItem(PWA_LAUNCH_KEY, stationIdToPwaTarget(stationId))
  } catch {
    /* ignore */
  }
}

/** Preferenza di avvio PWA: postazione trasportatore. */
export function markCarrierPwaLaunchPreferred(): void {
  try {
    localStorage.setItem(PWA_LAUNCH_KEY, 'carrier')
  } catch {
    /* ignore */
  }
}

export function clearOperatorPwaLaunchPreferred(): void {
  try {
    localStorage.removeItem(PWA_LAUNCH_KEY)
  } catch {
    /* ignore */
  }
}

export function prefersOperatorPwaLaunch(): boolean {
  try {
    return entryPointToStationId(localStorage.getItem(PWA_LAUNCH_KEY)) != null
  } catch {
    return false
  }
}

export function preferredOperatorStationId(): OperatorStationId {
  try {
    return entryPointToStationId(localStorage.getItem(PWA_LAUNCH_KEY)) || getLockedOperatorStationId()
  } catch {
    return 'abba'
  }
}

export function prefersCarrierPwaLaunch(): boolean {
  try {
    return localStorage.getItem(PWA_LAUNCH_KEY) === 'carrier'
  } catch {
    return false
  }
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true
    // iOS Safari
    return Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  } catch {
    return false
  }
}

function setManifestHref(href: string): void {
  let link = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null
  if (!link) {
    link = document.createElement('link')
    link.rel = 'manifest'
    document.head.appendChild(link)
  }
  const current = link.getAttribute('href') || ''
  if (!current.includes(href.replace(/^\//, '')) && !link.href.endsWith(href)) {
    link.setAttribute('href', href)
  }
}

/**
 * Sul link postazione operativa / trasportatore punta il manifest PWA al start_url corretto,
 * così «Installa app» non apre il gestionale grande.
 */
export function applyContextPwaManifest(): void {
  if (typeof document === 'undefined') return

  if (isOperatorDeliveryMode()) {
    setManifestHref(CARRIER_MANIFEST_HREF)
    document.title = document.title.includes('trasportatore') || document.title.includes('consegne')
      ? document.title
      : 'ATLAS — Postazione trasportatore'
    const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]')
    if (appleTitle) appleTitle.setAttribute('content', 'ATLAS Consegne')
    markCarrierPwaLaunchPreferred()
    return
  }

  if (isOperatorStationMode()) {
    const stationId = resolveOperatorStationIdFromPath() || 'abba'
    setManifestHref(OPERATOR_MANIFEST_BY_STATION[stationId])
    document.title = document.title.includes('postazione') ? document.title : 'ATLAS — Postazione operativa'
    const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]')
    if (appleTitle) appleTitle.setAttribute('content', 'ATLAS Postazione')
    markOperatorPwaLaunchPreferred(stationId)
  }
}

/** Se la PWA installata riparte da / ma è la postazione, manda al path sede corretto. */
export function shouldRedirectStandaloneToOperatorStation(pathname: string): boolean {
  if (!isStandaloneDisplay()) return false
  const path = (pathname || '/').replace(/\/$/, '') || '/'
  if (resolveOperatorStationIdFromPath(path)) return false
  if (path === OPERATOR_STATION_PATH || path.endsWith(OPERATOR_STATION_PATH)) return false
  if (path !== '/' && path !== '') return false
  return prefersOperatorPwaLaunch() || isOperatorStationMode()
}

export function getStandaloneOperatorStationPath(): string {
  return getOperatorStationBasePath(preferredOperatorStationId())
}

/** Se la PWA installata riparte da / ma è la postazione trasportatore, manda a /operatore-consegne. */
export function shouldRedirectStandaloneToCarrierDelivery(pathname: string): boolean {
  if (!isStandaloneDisplay()) return false
  const path = (pathname || '/').replace(/\/$/, '') || '/'
  if (path === OPERATOR_DELIVERY_PATH || path.startsWith(`${OPERATOR_DELIVERY_PATH}/`)) return false
  if (path !== '/' && path !== '') return false
  return prefersCarrierPwaLaunch() || isOperatorDeliveryMode()
}
