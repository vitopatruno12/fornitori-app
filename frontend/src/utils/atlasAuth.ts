/** Credenziali login gestionale ATLAS (home grande). */
const ATLAS_MAIN_LOGIN_USER = (import.meta.env.VITE_ATLAS_LOGIN_USER || 'michele.giliberti@gmail.com').trim()
const ATLAS_MAIN_LOGIN_PASSWORD = (import.meta.env.VITE_ATLAS_LOGIN_PASSWORD || 'andiamo').trim()

/** Credenziali login postazione operativa (/operatore-postazione). */
const ATLAS_OPERATOR_LOGIN_USER = (import.meta.env.VITE_OPERATOR_LOGIN_USER || 'lemaniinpasta.abba42@gmail.com').trim()
const ATLAS_OPERATOR_LOGIN_PASSWORD = (import.meta.env.VITE_OPERATOR_LOGIN_PASSWORD || 'brunetti').trim()

/** Credenziali login postazione trasportatore (/operatore-consegne). */
const ATLAS_CARRIER_LOGIN_USER = (import.meta.env.VITE_CARRIER_LOGIN_USER || 'simone.colapietro90@gmail.com').trim()
const ATLAS_CARRIER_LOGIN_PASSWORD = (import.meta.env.VITE_CARRIER_LOGIN_PASSWORD || 'SimoC90@tL4s5!#').trim()

function normalizeCredentials(username: string, password: string) {
  const u = String(username || '')
    .trim()
    .toLocaleLowerCase('it')
  const p = String(password || '').trim()
  return { u, p }
}

export function validateAtlasMainLogin(username: string, password: string): boolean {
  const { u, p } = normalizeCredentials(username, password)
  return u === ATLAS_MAIN_LOGIN_USER.toLocaleLowerCase('it') && p === ATLAS_MAIN_LOGIN_PASSWORD
}

export function validateAtlasOperatorLogin(username: string, password: string): boolean {
  const { u, p } = normalizeCredentials(username, password)
  return u === ATLAS_OPERATOR_LOGIN_USER.toLocaleLowerCase('it') && p === ATLAS_OPERATOR_LOGIN_PASSWORD
}

export function validateAtlasCarrierLogin(username: string, password: string): boolean {
  const { u, p } = normalizeCredentials(username, password)
  return u === ATLAS_CARRIER_LOGIN_USER.toLocaleLowerCase('it') && p === ATLAS_CARRIER_LOGIN_PASSWORD
}

/** True se l’utente ha digitato le credenziali della postazione operativa. */
export function looksLikeOperatorCredentials(username: string, password: string): boolean {
  return validateAtlasOperatorLogin(username, password)
}

/** True se l’utente ha digitato le credenziali della postazione trasportatore. */
export function looksLikeCarrierCredentials(username: string, password: string): boolean {
  return validateAtlasCarrierLogin(username, password)
}

export type OperatorAuthMode = 'operator' | 'carrier'

export function validateOperatorAuthMode(mode: OperatorAuthMode, username: string, password: string): boolean {
  return mode === 'carrier' ? validateAtlasCarrierLogin(username, password) : validateAtlasOperatorLogin(username, password)
}
