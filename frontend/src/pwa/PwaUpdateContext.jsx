import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'

const CHECK_INTERVAL_MS = 30 * 60 * 1000

const PwaUpdateContext = createContext(null)

export function PwaUpdateProvider({ children }) {
  const [updateReady, setUpdateReady] = useState(false)
  const [checking, setChecking] = useState(false)
  const [applying, setApplying] = useState(false)
  const updateSWRef = useRef(null)
  const registrationRef = useRef(null)
  const swSupported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator

  useEffect(() => {
    if (!swSupported) return undefined

    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        setUpdateReady(true)
      },
      onOfflineReady() {
        // cache pronta per offline
      },
      onRegistered(registration) {
        registrationRef.current = registration || null
      },
      onRegisterError() {
        registrationRef.current = null
      },
    })
    updateSWRef.current = updateSW

    return undefined
  }, [swSupported])

  useEffect(() => {
    if (!swSupported) return undefined

    const tick = () => {
      const reg = registrationRef.current
      if (reg) void reg.update()
    }

    const intervalId = window.setInterval(tick, CHECK_INTERVAL_MS)

    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    const onFocus = () => tick()

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)

    return () => {
      window.clearInterval(intervalId)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [swSupported])

  const checkForUpdate = useCallback(async () => {
    if (!swSupported) {
      window.location.reload()
      return
    }
    setChecking(true)
    try {
      const reg = registrationRef.current || (await navigator.serviceWorker.getRegistration())
      if (reg) {
        registrationRef.current = reg
        await reg.update()
      }
    } finally {
      window.setTimeout(() => setChecking(false), 450)
    }
  }, [swSupported])

  const applyUpdate = useCallback(() => {
    if (!swSupported) {
      window.location.reload()
      return
    }
    setApplying(true)
    const fn = updateSWRef.current
    if (typeof fn === 'function') {
      fn(true)
      return
    }
    window.location.reload()
  }, [swSupported])

  const value = useMemo(
    () => ({
      swSupported,
      updateReady,
      checking,
      applying,
      checkForUpdate,
      applyUpdate,
    }),
    [swSupported, updateReady, checking, applying, checkForUpdate, applyUpdate],
  )

  return <PwaUpdateContext.Provider value={value}>{children}</PwaUpdateContext.Provider>
}

export function usePwaUpdate() {
  const ctx = useContext(PwaUpdateContext)
  if (!ctx) {
    throw new Error('usePwaUpdate must be used within PwaUpdateProvider')
  }
  return ctx
}
