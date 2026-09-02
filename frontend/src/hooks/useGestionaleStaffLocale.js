import { useCallback, useEffect, useState } from 'react'
import {
  gestionaleLocaleNamesEqual,
  listGestionaleStaffLocaleNames,
  readGestionaleStaffLocale,
  writeGestionaleStaffLocale,
} from '../utils/gestionaleStaffLocale.js'

export function useGestionaleStaffLocale(enabled = true) {
  const [localeNames, setLocaleNames] = useState([])
  const [localeName, setLocaleNameState] = useState(() => (enabled ? readGestionaleStaffLocale() : ''))
  const [loadingLocales, setLoadingLocales] = useState(Boolean(enabled))

  const refreshLocaleNames = useCallback(async () => {
    if (!enabled) {
      setLocaleNames([])
      setLoadingLocales(false)
      return []
    }
    setLoadingLocales(true)
    try {
      const names = await listGestionaleStaffLocaleNames()
      setLocaleNames(names)
      const stored = readGestionaleStaffLocale()
      if (stored && names.some((n) => gestionaleLocaleNamesEqual(n, stored))) {
        setLocaleNameState(stored)
      } else if (names.length === 1) {
        setLocaleNameState(names[0])
        writeGestionaleStaffLocale(names[0])
      } else if (stored && !names.some((n) => gestionaleLocaleNamesEqual(n, stored))) {
        setLocaleNameState('')
        writeGestionaleStaffLocale('')
      }
      return names
    } finally {
      setLoadingLocales(false)
    }
  }, [enabled])

  useEffect(() => {
    void refreshLocaleNames()
  }, [refreshLocaleNames])

  const setLocaleName = useCallback((name) => {
    const next = String(name || '').trim()
    writeGestionaleStaffLocale(next)
    setLocaleNameState(next)
  }, [])

  return {
    localeNames,
    localeName,
    setLocaleName,
    loadingLocales,
    refreshLocaleNames,
  }
}
