import { isOnline } from './offlineStatus'

export const OFFLINE_AI_MSG =
  'Gemini e AI vocale sono in pausa finché non torna la connessione internet.'

export const OFFLINE_UPLOAD_MSG =
  'Upload file disponibile solo con connessione internet.'

export function assertOnlineForAi() {
  if (!isOnline()) {
    throw new Error(OFFLINE_AI_MSG)
  }
}

export function assertOnlineForUpload() {
  if (!isOnline()) {
    throw new Error(OFFLINE_UPLOAD_MSG)
  }
}

export function isOfflineBlockedFeature() {
  return !isOnline()
}
