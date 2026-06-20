import {
  isOperatorDeliveryMode,
  isOperatorOrderMode,
  isOperatorPrimaNotaMode,
  isOperatorStationMode,
} from './operatorMode.ts'

export type PwaUpdateScope = 'full' | 'station' | 'order' | 'delivery' | 'prima-nota'

const STORAGE_PREFIX = 'atlasSectionVersion:'

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

export async function fetchRemoteSectionVersions(): Promise<Record<string, string>> {
  if (typeof window === 'undefined') return {}
  const base = (import.meta.env.BASE_URL || '/').replace(/\/?$/, '/')
  const url = `${base}section-versions.json?ts=${Date.now()}`
  const res = await fetch(url, { cache: 'no-store' })
  if (!res.ok) return {}
  const data = await res.json()
  return data?.scopes && typeof data.scopes === 'object' ? data.scopes : {}
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
