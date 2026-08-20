import { isOperatorStationMode, OPERATOR_STATION_PATH } from './operatorMode.ts'

const OPERATOR_MANIFEST_HREF = '/manifest-operator.webmanifest'
const OPERATOR_PWA_LAUNCH_KEY = 'atlasPwaLaunchTarget'

/** Preferenza di avvio PWA: postazione operativa (non si cancella al logout). */
export function markOperatorPwaLaunchPreferred(): void {
  try {
    localStorage.setItem(OPERATOR_PWA_LAUNCH_KEY, 'station')
  } catch {
    /* ignore */
  }
}

export function clearOperatorPwaLaunchPreferred(): void {
  try {
    localStorage.removeItem(OPERATOR_PWA_LAUNCH_KEY)
  } catch {
    /* ignore */
  }
}

export function prefersOperatorPwaLaunch(): boolean {
  try {
    return localStorage.getItem(OPERATOR_PWA_LAUNCH_KEY) === 'station'
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

/**
 * Sul link postazione operativa punta il manifest PWA a start_url=/operatore-postazione,
 * così «Installa app» non apre più il gestionale grande (credenziali michele/andiamo).
 */
export function applyContextPwaManifest(): void {
  if (typeof document === 'undefined') return
  const useOperator = isOperatorStationMode()
  let link = document.querySelector('link[rel="manifest"]') as HTMLLinkElement | null
  if (!link) {
    link = document.createElement('link')
    link.rel = 'manifest'
    document.head.appendChild(link)
  }
  if (useOperator) {
    if (!link.href.endsWith(OPERATOR_MANIFEST_HREF) && !link.getAttribute('href')?.includes('manifest-operator')) {
      link.setAttribute('href', OPERATOR_MANIFEST_HREF)
    }
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
