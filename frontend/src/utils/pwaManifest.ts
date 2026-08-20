import {
  isOperatorDeliveryMode,
  isOperatorStationMode,
  OPERATOR_DELIVERY_PATH,
  OPERATOR_STATION_PATH,
} from './operatorMode.ts'

const OPERATOR_MANIFEST_HREF = '/manifest-operator.webmanifest'
const CARRIER_MANIFEST_HREF = '/manifest-carrier.webmanifest'
const PWA_LAUNCH_KEY = 'atlasPwaLaunchTarget'

export type PwaLaunchTarget = 'station' | 'carrier'

/** Preferenza di avvio PWA: postazione operativa (non si cancella al logout). */
export function markOperatorPwaLaunchPreferred(): void {
  try {
    localStorage.setItem(PWA_LAUNCH_KEY, 'station')
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
    return localStorage.getItem(PWA_LAUNCH_KEY) === 'station'
  } catch {
    return false
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
    setManifestHref(OPERATOR_MANIFEST_HREF)
    document.title = document.title.includes('postazione') ? document.title : 'ATLAS — Postazione operativa'
    const appleTitle = document.querySelector('meta[name="apple-mobile-web-app-title"]')
    if (appleTitle) appleTitle.setAttribute('content', 'ATLAS Postazione')
    markOperatorPwaLaunchPreferred()
  }
}

/** Se la PWA installata riparte da / ma è la postazione, manda a /operatore-postazione. */
export function shouldRedirectStandaloneToOperatorStation(pathname: string): boolean {
  if (!isStandaloneDisplay()) return false
  const path = (pathname || '/').replace(/\/$/, '') || '/'
  if (path === OPERATOR_STATION_PATH || path.endsWith(OPERATOR_STATION_PATH)) return false
  if (path !== '/' && path !== '') return false
  return prefersOperatorPwaLaunch() || isOperatorStationMode()
}

/** Se la PWA installata riparte da / ma è la postazione trasportatore, manda a /operatore-consegne. */
export function shouldRedirectStandaloneToCarrierDelivery(pathname: string): boolean {
  if (!isStandaloneDisplay()) return false
  const path = (pathname || '/').replace(/\/$/, '') || '/'
  if (path === OPERATOR_DELIVERY_PATH || path.startsWith(`${OPERATOR_DELIVERY_PATH}/`)) return false
  if (path !== '/' && path !== '') return false
  return prefersCarrierPwaLaunch() || isOperatorDeliveryMode()
}
