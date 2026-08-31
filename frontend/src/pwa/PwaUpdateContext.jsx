import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { registerSW } from 'virtual:pwa-register'
import {
  detectPwaUpdateScope,
  fetchRemoteSectionVersions,
  updateAvailableForScope,
  storeInstalledVersions,
  getRunningBuildId,
} from '../utils/pwaUpdateScope.ts'

const CHECK_INTERVAL_MS = 30 * 60 * 1000
const VERIFIED_COOLDOWN_MS = 10 * 60 * 1000
const PENDING_INSTALL_KEY = 'atlasPwaPendingInstall:v3'
const APPLY_FAILSAFE_MS = 4000

const PwaUpdateContext = createContext(null)

function waitForWaitingWorker(reg, timeoutMs = 2000) {
  if (!reg || reg.waiting) return Promise.resolve()
  return new Promise((resolve) => {
    const installing = reg.installing
    if (!installing) {
      resolve()
      return
    }
    const done = () => {
      installing.removeEventListener('statechange', onStateChange)
      resolve()
    }
    const onStateChange = () => {
      if (installing.state === 'installed' || reg.waiting) done()
    }
    installing.addEventListener('statechange', onStateChange)
    window.setTimeout(done, timeoutMs)
  })
}

async function clearWorkboxCaches() {
  if (typeof caches === 'undefined') return
  try {
    const keys = await caches.keys()
    await Promise.all(keys.map((key) => caches.delete(key)))
  } catch {
    // ignore
  }
}

function hardReloadPage() {
  const url = new URL(window.location.href)
  url.searchParams.set('_atlas_u', String(Date.now()))
  window.location.replace(url.toString())
}

async function shouldPromptUpdateForScope(scope) {
  try {
    const remote = await fetchRemoteSectionVersions()
    return updateAvailableForScope(scope, remote)
  } catch {
    // Errore di rete / file mancante: non mostrare badge falso
    return false
  }
}

async function probeRemoteVersions(setUpdateReady, pendingScopeRef, skipProbeRef, verifiedAtRef) {
  if (skipProbeRef?.current) return false
  if (verifiedAtRef?.current && Date.now() - verifiedAtRef.current < VERIFIED_COOLDOWN_MS) {
    return false
  }
  const scope = detectPwaUpdateScope()
  const relevant = await shouldPromptUpdateForScope(scope)
  if (relevant) {
    pendingScopeRef.current = scope
    setUpdateReady(true)
    return true
  }
  verifiedAtRef.current = Date.now()
  setUpdateReady(false)
  return false
}

async function probeWaitingWorker(reg, setUpdateReady, pendingScopeRef, skipProbeRef, verifiedAtRef) {
  if (skipProbeRef?.current) return false
  if (!reg?.waiting) return false
  const scope = detectPwaUpdateScope()
  const relevant = await shouldPromptUpdateForScope(scope)
  if (relevant) {
    pendingScopeRef.current = scope
    setUpdateReady(true)
    return true
  }
  verifiedAtRef.current = Date.now()
  setUpdateReady(false)
  return false
}

export function PwaUpdateProvider({ children }) {
  const [updateReady, setUpdateReady] = useState(false)
  const [checking, setChecking] = useState(false)
  const [applying, setApplying] = useState(false)
  const updateSWRef = useRef(null)
  const registrationRef = useRef(null)
  const pendingScopeRef = useRef(null)
  const skipVersionProbeRef = useRef(false)
  const verifiedAtRef = useRef(0)
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

    setApplying(false)

    try {
      if (sessionStorage.getItem(PENDING_INSTALL_KEY) === '1') {
        skipVersionProbeRef.current = true
        sessionStorage.removeItem(PENDING_INSTALL_KEY)
      }
    } catch {
      // ignore
    }

    if (skipVersionProbeRef.current) {
      void markVersionsInstalled().finally(() => {
        skipVersionProbeRef.current = false
        verifiedAtRef.current = Date.now()
        setUpdateReady(false)
        setApplying(false)
      })
    } else if (!import.meta.env.DEV) {
      void fetchRemoteSectionVersions().then((remote) => {
        const running = getRunningBuildId()
        if (running && remote.build && running === remote.build) {
          storeInstalledVersions(remote)
          verifiedAtRef.current = Date.now()
          setUpdateReady(false)
        }
      })
    }

    const updateSW = registerSW({
      immediate: true,
      async onNeedRefresh() {
        const scope = detectPwaUpdateScope()
        const relevant = await shouldPromptUpdateForScope(scope)
        if (relevant) {
          pendingScopeRef.current = scope
          setUpdateReady(true)
        } else {
          verifiedAtRef.current = Date.now()
          setUpdateReady(false)
        }
      },
      onOfflineReady() {
        // cache pronta per offline
      },
      onRegistered(registration) {
        registrationRef.current = registration || null
        if (skipVersionProbeRef.current) return
        void (async () => {
          const waiting = await probeWaitingWorker(
            registration,
            setUpdateReady,
            pendingScopeRef,
            skipVersionProbeRef,
            verifiedAtRef,
          )
          if (!waiting) {
            await probeRemoteVersions(setUpdateReady, pendingScopeRef, skipVersionProbeRef, verifiedAtRef)
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

    const tick = async ({ forceServiceWorkerCheck = false } = {}) => {
      if (skipVersionProbeRef.current) return
      const reg = registrationRef.current
      if (!reg) {
        await probeRemoteVersions(setUpdateReady, pendingScopeRef, skipVersionProbeRef, verifiedAtRef)
        return
      }
      if (forceServiceWorkerCheck) {
        await reg.update()
      }
      const waiting = await probeWaitingWorker(
        reg,
        setUpdateReady,
        pendingScopeRef,
        skipVersionProbeRef,
        verifiedAtRef,
      )
      if (!waiting) {
        await probeRemoteVersions(setUpdateReady, pendingScopeRef, skipVersionProbeRef, verifiedAtRef)
      }
    }

    void tick({ forceServiceWorkerCheck: true })
    const intervalId = window.setInterval(
      () => void tick({ forceServiceWorkerCheck: true }),
      CHECK_INTERVAL_MS,
    )

    const onVisible = () => {
      if (document.visibilityState === 'visible') void tick({ forceServiceWorkerCheck: false })
    }
    const onFocus = () => void tick({ forceServiceWorkerCheck: false })

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
    verifiedAtRef.current = 0
    setChecking(true)
    try {
      let found = false
      const reg = registrationRef.current || (await navigator.serviceWorker.getRegistration())
      if (reg) {
        registrationRef.current = reg
        await reg.update()
        const waiting = await probeWaitingWorker(
          reg,
          setUpdateReady,
          pendingScopeRef,
          skipVersionProbeRef,
          verifiedAtRef,
        )
        if (waiting) {
          found = true
        } else {
          found = await probeRemoteVersions(
            setUpdateReady,
            pendingScopeRef,
            skipVersionProbeRef,
            verifiedAtRef,
          )
        }
      } else {
        found = await probeRemoteVersions(
          setUpdateReady,
          pendingScopeRef,
          skipVersionProbeRef,
          verifiedAtRef,
        )
      }
      if (!found) {
        verifiedAtRef.current = Date.now()
        setUpdateReady(false)
      }
    } finally {
      window.setTimeout(() => setChecking(false), 450)
    }
  }, [swSupported])

  const applyUpdate = useCallback(async () => {
    if (!swSupported) {
      hardReloadPage()
      return
    }

    setApplying(true)
    setUpdateReady(false)

    const failsafeId = window.setTimeout(() => {
      setApplying(false)
    }, APPLY_FAILSAFE_MS)

    try {
      sessionStorage.setItem(PENDING_INSTALL_KEY, '1')
    } catch {
      // ignore
    }

    try {
      const reg = registrationRef.current || (await navigator.serviceWorker.getRegistration())
      registrationRef.current = reg || null

      if (reg) {
        await reg.update()
        await waitForWaitingWorker(reg)
      }

      const fn = updateSWRef.current
      if (reg?.waiting && typeof fn === 'function') {
        fn(true)
        window.setTimeout(() => {
          window.clearTimeout(failsafeId)
          hardReloadPage()
        }, 400)
        return
      }

      await clearWorkboxCaches()
      await markVersionsInstalled()
      verifiedAtRef.current = Date.now()
      window.clearTimeout(failsafeId)
      hardReloadPage()
    } catch {
      window.clearTimeout(failsafeId)
      setApplying(false)
      hardReloadPage()
    }
  }, [swSupported, markVersionsInstalled])

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
