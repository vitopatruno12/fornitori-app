/** Credenziali login ATLAS (build-time via VITE_ATLAS_LOGIN_*). */
const ATLAS_LOGIN_USER = (import.meta.env.VITE_ATLAS_LOGIN_USER || 'lemaniinpasta.abba42@gmail.com').trim()
const ATLAS_LOGIN_PASSWORD = (import.meta.env.VITE_ATLAS_LOGIN_PASSWORD || 'brunetti').trim()

export function validateAtlasLogin(username: string, password: string): boolean {
  const u = String(username || '').trim()
  const p = String(password || '').trim()
  return u === ATLAS_LOGIN_USER && p === ATLAS_LOGIN_PASSWORD
}
