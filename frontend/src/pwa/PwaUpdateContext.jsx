import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'
import {
  detectPwaUpdateScope,
  fetchRemoteSectionVersions,
  updateAvailableForScope,
  storeInstalledVersions,
} from '../utils/pwaUpdateScope.ts'

const CHECK_INTERVAL_MS = 30 * 60 * 1000
const PENDING_INSTALL_KEY = 'atlasPwaPendingInstall:v2'

const PwaUpdateContext = createContext(null)

async function shouldPromptUpdateForScope(scope) {
  try {
    const remote = await fetchRemoteSectionVersions()
    return updateAvailableForScope(scope, remote)
  } catch {
    return true
  }
}

async function probeRemoteVersions(setUpdateReady, pendingScopeRef) {
  const scope = detectPwaUpdateScope()
  const relevant = await shouldPromptUpdateForScope(scope)
  if (relevant) {
    pendingScopeRef.current = scope
    setUpdateReady(true)
    return true
  }
  return false
}

async function probeWaitingWorker(reg, setUpdateReady, pendingScopeRef) {
  if (!reg?.waiting) return false
  return probeRemoteVersions(setUpdateReady, pendingScopeRef)
}

export function PwaUpdateProvider({ children }) {
  const [updateReady, setUpdateReady] = useState(false)
  const [checking, setChecking] = useState(false)
  const [applying, setApplying] = useState(false)
  const updateSWRef = useRef(null)
  const registrationRef = useRef(null)
  const pendingScopeRef = useRef(null)
  const swSupported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator

  const markVersionsInstalled = useCallback(async () => {
    try {
      const remote = await fetchRemoteSectionVersions()
      storeInstalledVersions(remote)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    if (!swSupported) return undefined

    try {
      if (sessionStorage.getItem(PENDING_INSTALL_KEY) === '1') {
        sessionStorage.removeItem(PENDING_INSTALL_KEY)
        void markVersionsInstalled()
      }
    } catch {
      // ignore
    }

    const updateSW = registerSW({
      immediate: true,
      async onNeedRefresh() {
        const scope = detectPwaUpdateScope()
        const relevant = await shouldPromptUpdateForScope(scope)
        if (relevant) {
          pendingScopeRef.current = scope
          setUpdateReady(true)
        }
      },
      onOfflineReady() {
        // cache pronta per offline
      },
      onRegistered(registration) {
        registrationRef.current = registration || null
        void (async () => {
          const waiting = await probeWaitingWorker(registration, setUpdateReady, pendingScopeRef)
          if (!waiting) {
            await probeRemoteVersions(setUpdateReady, pendingScopeRef)
          }
        })()
      },
      onRegisterError() {
        registrationRef.current = null
      },
    })
    updateSWRef.current = updateSW

    return undefined
  }, [swSupported, markVersionsInstalled])

  useEffect(() => {
    if (!swSupported) return undefined

    const tick = async () => {
      const reg = registrationRef.current
      if (!reg) {
        await probeRemoteVersions(setUpdateReady, pendingScopeRef)
        return
      }
      await reg.update()
      const waiting = await probeWaitingWorker(reg, setUpdateReady, pendingScopeRef)
      if (!waiting) {
        await probeRemoteVersions(setUpdateReady, pendingScopeRef)
      }
    }

    void tick()
    const intervalId = window.setInterval(() => void tick(), CHECK_INTERVAL_MS)

    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick()
    }
    const onFocus = () => void tick()

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
      let found = false
      const reg = registrationRef.current || (await navigator.serviceWorker.getRegistration())
      if (reg) {
        registrationRef.current = reg
        await reg.update()
        const waiting = await probeWaitingWorker(reg, setUpdateReady, pendingScopeRef)
        if (waiting) {
          found = true
        } else {
          found = await probeRemoteVersions(setUpdateReady, pendingScopeRef)
        }
      } else {
        found = await probeRemoteVersions(setUpdateReady, pendingScopeRef)
      }
      if (!found) {
        setUpdateReady(false)
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
    try {
      sessionStorage.setItem(PENDING_INSTALL_KEY, '1')
    } catch {
      // ignore
    }
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
