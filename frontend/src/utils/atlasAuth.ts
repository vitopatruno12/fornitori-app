/** Credenziali login gestionale ATLAS (home grande). */
const ATLAS_MAIN_LOGIN_USER = (import.meta.env.VITE_ATLAS_LOGIN_USER || 'michele.giliberti@gmail.com').trim()
const ATLAS_MAIN_LOGIN_PASSWORD = (import.meta.env.VITE_ATLAS_LOGIN_PASSWORD || 'andiamo').trim()

/** Credenziali login satelliti / postazione operativa. */
const ATLAS_OPERATOR_LOGIN_USER = (import.meta.env.VITE_OPERATOR_LOGIN_USER || 'lemaniinpasta.abba42@gmail.com').trim()
const ATLAS_OPERATOR_LOGIN_PASSWORD = (import.meta.env.VITE_OPERATOR_LOGIN_PASSWORD || 'brunetti').trim()

function normalizeCredentials(username: string, password: string) {
  const u = String(username || '').trim()
  const p = String(password || '').trim()
  return { u, p }
}

export function validateAtlasMainLogin(username: string, password: string): boolean {
  const { u, p } = normalizeCredentials(username, password)
  return u === ATLAS_MAIN_LOGIN_USER && p === ATLAS_MAIN_LOGIN_PASSWORD
}

export function validateAtlasOperatorLogin(username: string, password: string): boolean {
  const { u, p } = normalizeCredentials(username, password)
  return u === ATLAS_OPERATOR_LOGIN_USER && p === ATLAS_OPERATOR_LOGIN_PASSWORD
}
