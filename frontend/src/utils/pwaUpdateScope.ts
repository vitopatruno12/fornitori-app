import {
  isOperatorDeliveryMode,
  isOperatorOrderMode,
  isOperatorPrimaNotaMode,
  isOperatorStationMode,
} from './operatorMode.ts'

export type PwaUpdateScope = 'full' | 'station' | 'order' | 'delivery' | 'prima-nota'

const STORAGE_PREFIX = 'atlasSectionVersion:v2:'
const BUILD_KEY = 'atlasAppBuildId:v2'

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
  const remote = String(remoteScopes[scope] || '')
  if (!remote) return true
  const local = readStoredSectionVersion(scope)
  if (!local) return true
  return local !== remote
}

/** True se c’è un deploy più recente rilevante per l’ambito corrente (postazione, prima nota, ecc.). */
export function updateAvailableForScope(
  scope: PwaUpdateScope,
  payload: SectionVersionsPayload,
): boolean {
  const build = String(payload?.build || '').trim()
  const storedBuild = readStoredBuildId()
  const scopes = payload?.scopes || {}

  if (!build) {
    return scopeHashChanged(scope, scopes)
  }
  if (!storedBuild) {
    return true
  }
  if (build === storedBuild) {
    return false
  }
  return scopeHashChanged(scope, scopes)
}
