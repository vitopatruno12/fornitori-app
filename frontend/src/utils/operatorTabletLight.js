/**
 * Modalità light per postazioni operative su tablet / touch.
 * Usa viewport stretto o puntatore coarse (tablet Android tipici 10").
 */
import { useEffect, useState } from 'react'

const QUERY = '(max-width: 1100px), (pointer: coarse)'

export function getOperatorTabletLightMatch() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia(QUERY).matches
  } catch {
    return false
  }
}

/** Hook: true su tablet / touch / schermi ≤1100px. */
export function useOperatorTabletLight() {
  const [light, setLight] = useState(() => getOperatorTabletLightMatch())

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined
    const mq = window.matchMedia(QUERY)
    const sync = () => setLight(Boolean(mq.matches))
    sync()
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', sync)
      return () => mq.removeEventListener('change', sync)
    }
    mq.addListener(sync)
    return () => mq.removeListener(sync)
  }, [])

  return light
}
