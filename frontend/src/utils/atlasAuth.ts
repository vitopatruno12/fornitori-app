/** Credenziali login gestionale ATLAS (home grande). */
const ATLAS_MAIN_LOGIN_USER = (import.meta.env.VITE_ATLAS_LOGIN_USER || 'michele.giliberti@gmail.com').trim()
const ATLAS_MAIN_LOGIN_PASSWORD = (import.meta.env.VITE_ATLAS_LOGIN_PASSWORD || 'andiamo').trim()

/** Credenziali login postazione Abba 42 (/operatore-postazione). */
const ATLAS_OPERATOR_LOGIN_USER = (import.meta.env.VITE_OPERATOR_LOGIN_USER || 'lemaniinpasta.abba42@gmail.com').trim()
const ATLAS_OPERATOR_LOGIN_PASSWORD = (import.meta.env.VITE_OPERATOR_LOGIN_PASSWORD || 'brunetti').trim()

/** Credenziali login postazione Zanardelli 19 (/operatore-postazione-zanardelli). */
const ATLAS_OPERATOR_ZANARDELLI_LOGIN_USER = (
  import.meta.env.VITE_OPERATOR_ZANARDELLI_LOGIN_USER || 'gretalavoro13@gmail.com'
).trim()
const ATLAS_OPERATOR_ZANARDELLI_LOGIN_PASSWORD = (
  import.meta.env.VITE_OPERATOR_ZANARDELLI_LOGIN_PASSWORD || 'zanardelli19'
).trim()

/** Credenziali login postazione Via Lattea (/operatore-postazione-lattea). */
const ATLAS_OPERATOR_LATTEA_LOGIN_USER = (
  import.meta.env.VITE_OPERATOR_LATTEA_LOGIN_USER || 'LemucheVolanti@gmail.com'
).trim()
const ATLAS_OPERATOR_LATTEA_LOGIN_PASSWORD = (
  import.meta.env.VITE_OPERATOR_LATTEA_LOGIN_PASSWORD || 'prosciuttocrudo'
).trim()

/** Credenziali login postazione trasportatore (/operatore-consegne). */
const ATLAS_CARRIER_LOGIN_USER = (import.meta.env.VITE_CARRIER_LOGIN_USER || 'simone.colapietro90@gmail.com').trim()
const ATLAS_CARRIER_LOGIN_PASSWORD = (import.meta.env.VITE_CARRIER_LOGIN_PASSWORD || 'SimoC90@tL4s5!#').trim()

export type OperatorStationId = 'abba' | 'zanardelli' | 'lattea'

export type OperatorAuthMode = 'operator' | 'operator-zanardelli' | 'operator-lattea' | 'carrier'

function normalizeCredentials(username: string, password: string) {
  const u = String(username || '')
    .trim()
    .toLocaleLowerCase('it')
  const p = String(password || '').trim()
  return { u, p }
}

function matchPair(username: string, password: string, expectedUser: string, expectedPassword: string): boolean {
  const { u, p } = normalizeCredentials(username, password)
  return u === expectedUser.toLocaleLowerCase('it') && p === expectedPassword
}

export function validateAtlasMainLogin(username: string, password: string): boolean {
  return matchPair(username, password, ATLAS_MAIN_LOGIN_USER, ATLAS_MAIN_LOGIN_PASSWORD)
}

export function validateAtlasOperatorLogin(username: string, password: string): boolean {
  return matchPair(username, password, ATLAS_OPERATOR_LOGIN_USER, ATLAS_OPERATOR_LOGIN_PASSWORD)
}

export function validateAtlasOperatorZanardelliLogin(username: string, password: string): boolean {
  return matchPair(
    username,
    password,
    ATLAS_OPERATOR_ZANARDELLI_LOGIN_USER,
    ATLAS_OPERATOR_ZANARDELLI_LOGIN_PASSWORD,
  )
}

export function validateAtlasOperatorLatteaLogin(username: string, password: string): boolean {
  return matchPair(username, password, ATLAS_OPERATOR_LATTEA_LOGIN_USER, ATLAS_OPERATOR_LATTEA_LOGIN_PASSWORD)
}

export function validateAtlasCarrierLogin(username: string, password: string): boolean {
  return matchPair(username, password, ATLAS_CARRIER_LOGIN_USER, ATLAS_CARRIER_LOGIN_PASSWORD)
}

export function stationIdToAuthMode(stationId: OperatorStationId): OperatorAuthMode {
  if (stationId === 'zanardelli') return 'operator-zanardelli'
  if (stationId === 'lattea') return 'operator-lattea'
  return 'operator'
}

/** Quale sede postazione corrisponde alle credenziali digitate (se riconosciute). */
export function matchOperatorStationCredentials(username: string, password: string): OperatorStationId | null {
  if (validateAtlasOperatorLogin(username, password)) return 'abba'
  if (validateAtlasOperatorZanardelliLogin(username, password)) return 'zanardelli'
  if (validateAtlasOperatorLatteaLogin(username, password)) return 'lattea'
  return null
}

/** True se l’utente ha digitato le credenziali di una qualsiasi postazione operativa. */
export function looksLikeOperatorCredentials(username: string, password: string): boolean {
  return matchOperatorStationCredentials(username, password) != null
}

/** True se l’utente ha digitato le credenziali della postazione trasportatore. */
export function looksLikeCarrierCredentials(username: string, password: string): boolean {
  return validateAtlasCarrierLogin(username, password)
}

export function validateOperatorAuthMode(mode: OperatorAuthMode, username: string, password: string): boolean {
  if (mode === 'carrier') return validateAtlasCarrierLogin(username, password)
  if (mode === 'operator-zanardelli') return validateAtlasOperatorZanardelliLogin(username, password)
  if (mode === 'operator-lattea') return validateAtlasOperatorLatteaLogin(username, password)
  return validateAtlasOperatorLogin(username, password)
}
