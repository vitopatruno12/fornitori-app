import {
  isOperatorDeliveryMode,
  isOperatorOrderMode,
  isOperatorPrimaNotaMode,
  isOperatorStationMode,
} from './operatorMode.ts'

export type PwaUpdateScope = 'full' | 'station' | 'order' | 'delivery' | 'prima-nota'

const STORAGE_PREFIX = 'atlasSectionVersion:v3:'
const BUILD_KEY = 'atlasAppBuildId:v3'

export type SectionVersionsPayload = {
  build?: string
  generatedAt?: string
  scopes?: Record<string, string>
}

export function detectPwaUpdateScope(): PwaUpdateScope {
  if (isOperatorStationMode()) return 'station'
  if (isOperatorOrderMode()) return 'order'
  if (isOperatorDeliveryMode()) return 'delivery'
  if (isOperatorPrimaNotaMode()) return 'prima-nota'
  return 'full'
}

/** Build id del bundle JS attualmente in esecuzione (non localStorage). */
export function getRunningBuildId(): string {
  try {
    return typeof __ATLAS_BUILD_ID__ !== 'undefined' ? String(__ATLAS_BUILD_ID__ || '').trim() : ''
  } catch {
    return ''
  }
}

export function getRunningScopeHash(scope: PwaUpdateScope): string {
  try {
    const scopes =
      typeof __ATLAS_SCOPE_HASHES__ !== 'undefined' && __ATLAS_SCOPE_HASHES__
        ? __ATLAS_SCOPE_HASHES__
        : {}
    return String(scopes[scope] || '').trim()
  } catch {
    return ''
  }
}

export function readStoredSectionVersion(scope: PwaUpdateScope): string {
  if (typeof window === 'undefined') return ''
  try {
    return localStorage.getItem(`${STORAGE_PREFIX}${scope}`) || ''
  } catch {
    return ''
  }
}

export function readStoredBuildId(): string {
  if (typeof window === 'undefined') return ''
  try {
    return localStorage.getItem(BUILD_KEY) || ''
  } catch {
    return ''
  }
}

export function storeSectionVersions(scopes: Record<string, string>): void {
  if (typeof window === 'undefined') return
  try {
    for (const [scope, hash] of Object.entries(scopes)) {
      if (hash) localStorage.setItem(`${STORAGE_PREFIX}${scope}`, hash)
    }
  } catch {
    // ignore
  }
}

export function storeInstalledVersions(payload: SectionVersionsPayload): void {
  const build = String(payload?.build || '').trim()
  if (build) {
    try {
      localStorage.setItem(BUILD_KEY, build)
    } catch {
      // ignore
    }
  }
  if (payload?.scopes && typeof payload.scopes === 'object') {
    storeSectionVersions(payload.scopes)
  }
}

export async function fetchRemoteSectionVersions(): Promise<SectionVersionsPayload> {
  if (typeof window === 'undefined') return {}
  const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')
  const url = `${base}section-versions.json?ts=${Date.now()}`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) return {}
  const data = await res.json()
  if (!data || typeof data !== 'object') return {}
  return {
    build: typeof data.build === 'string' ? data.build : '',
    generatedAt: typeof data.generatedAt === 'string' ? data.generatedAt : '',
    scopes: data.scopes && typeof data.scopes === 'object' ? data.scopes : {},
  }
}

export function scopeHashChanged(
  scope: PwaUpdateScope,
  remoteScopes: Record<string, string>,
): boolean {
  const remote = String(remoteScopes[scope] || '').trim()
  if (!remote) return false

  const running = getRunningScopeHash(scope)
  if (running) return running !== remote

  const local = readStoredSectionVersion(scope)
  if (local) return local !== remote

  // Nessun hash locale: non forzare badge (evita falsi positivi al primo avvio)
  return false
}

/** True se il server ha un deploy più recente per l’ambito corrente. */
export function updateAvailableForScope(
  scope: PwaUpdateScope,
  payload: SectionVersionsPayload,
): boolean {
  if (import.meta.env.DEV) return false

  const remoteBuild = String(payload?.build || '').trim()
  const runningBuild = getRunningBuildId()
  const scopes = payload?.scopes || {}

  if (!remoteBuild) return false

  if (runningBuild && runningBuild !== 'dev') {
    if (runningBuild === remoteBuild) return false
    // Tutte le PWA ATLAS condividono lo stesso bundle/sw.js: se il build globale
    // è cambiato, anche postazione operativa e satelliti devono poter aggiornarsi.
    return true
  }

  const storedBuild = readStoredBuildId()
  if (storedBuild === remoteBuild) return false
  if (!storedBuild) return scopeHashChanged(scope, scopes)
  return scopeHashChanged(scope, scopes)
}
