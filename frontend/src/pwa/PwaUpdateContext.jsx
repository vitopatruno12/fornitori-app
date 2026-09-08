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
const PENDING_UPDATES_KEY = 'atlasPwaPendingUpdates:v1'
const APPLY_FAILSAFE_MS = 4000

const PwaUpdateContext = createContext(null)

function readPendingUpdatesMeta() {
  if (typeof window === 'undefined') return { count: 0, builds: [] }
  try {
    const raw = localStorage.getItem(PENDING_UPDATES_KEY)
    if (!raw) return { count: 0, builds: [] }
    const data = JSON.parse(raw)
    const builds = Array.isArray(data?.builds)
      ? data.builds.map((b) => String(b || '').trim()).filter(Boolean)
      : []
    const count = Math.max(0, Number(data?.count) || builds.length || 0)
    return { count, builds }
  } catch {
    return { count: 0, builds: [] }
  }
}

function writePendingUpdatesMeta(meta) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(PENDING_UPDATES_KEY, JSON.stringify(meta))
  } catch {
    // ignore
  }
}

function clearPendingUpdatesMeta() {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(PENDING_UPDATES_KEY)
  } catch {
    // ignore
  }
}

/** Conta deploy distinti non ancora installati (badge 1, 2, 3…). */
function registerPendingUpdate(buildId, setUpdateReady, setUpdateCount) {
  const build = String(buildId || '').trim()
  let meta = readPendingUpdatesMeta()
  if (meta.count < 1) {
    meta = { count: 1, builds: build ? [build] : [] }
  } else if (build && !meta.builds.includes(build)) {
    meta = { count: meta.count + 1, builds: [...meta.builds, build] }
  }
  writePendingUpdatesMeta(meta)
  setUpdateCount(meta.count)
  setUpdateReady(true)
}

function clearPendingUpdateState(setUpdateReady, setUpdateCount) {
  clearPendingUpdatesMeta()
  setUpdateCount(0)
  setUpdateReady(false)
}

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

async function fetchUpdateAvailability(scope) {
  try {
    const remote = await fetchRemoteSectionVersions()
    return {
      available: updateAvailableForScope(scope, remote),
      build: String(remote?.build || '').trim(),
      ok: true,
    }
  } catch {
    // Errore di rete / file mancante: non toccare badge/contatore
    return { available: false, build: '', ok: false }
  }
}

async function probeRemoteVersions(
  setUpdateReady,
  setUpdateCount,
  pendingScopeRef,
  skipProbeRef,
  verifiedAtRef,
) {
  if (skipProbeRef?.current) return 'skip'
  if (verifiedAtRef?.current && Date.now() - verifiedAtRef.current < VERIFIED_COOLDOWN_MS) {
    return 'skip'
  }
  const scope = detectPwaUpdateScope()
  const { available, build, ok } = await fetchUpdateAvailability(scope)
  if (!ok) return 'skip'
  if (available) {
    pendingScopeRef.current = scope
    registerPendingUpdate(build, setUpdateReady, setUpdateCount)
    return 'ready'
  }
  verifiedAtRef.current = Date.now()
  clearPendingUpdateState(setUpdateReady, setUpdateCount)
  return 'none'
}

async function probeWaitingWorker(
  reg,
  setUpdateReady,
  setUpdateCount,
  pendingScopeRef,
  skipProbeRef,
  verifiedAtRef,
) {
  if (skipProbeRef?.current) return 'skip'
  if (!reg?.waiting) return 'none'
  const scope = detectPwaUpdateScope()
  const { available, build, ok } = await fetchUpdateAvailability(scope)
  if (!ok) return 'skip'
  if (available) {
    pendingScopeRef.current = scope
    registerPendingUpdate(build, setUpdateReady, setUpdateCount)
    return 'ready'
  }
  verifiedAtRef.current = Date.now()
  clearPendingUpdateState(setUpdateReady, setUpdateCount)
  return 'none'
}

export function PwaUpdateProvider({ children }) {
  const initialPending = readPendingUpdatesMeta()
  const [updateReady, setUpdateReady] = useState(initialPending.count > 0)
  const [updateCount, setUpdateCount] = useState(initialPending.count)
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
        clearPendingUpdateState(setUpdateReady, setUpdateCount)
        setApplying(false)
      })
    } else if (!import.meta.env.DEV) {
      void fetchRemoteSectionVersions().then((remote) => {
        const running = getRunningBuildId()
        if (running && remote.build && running === remote.build) {
          storeInstalledVersions(remote)
          verifiedAtRef.current = Date.now()
          clearPendingUpdateState(setUpdateReady, setUpdateCount)
        }
      })
    }

    const updateSW = registerSW({
      immediate: true,
      async onNeedRefresh() {
        const scope = detectPwaUpdateScope()
        const { available, build, ok } = await fetchUpdateAvailability(scope)
        if (!ok) return
        if (available) {
          pendingScopeRef.current = scope
          registerPendingUpdate(build, setUpdateReady, setUpdateCount)
        } else {
          verifiedAtRef.current = Date.now()
          clearPendingUpdateState(setUpdateReady, setUpdateCount)
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
            setUpdateCount,
            pendingScopeRef,
            skipVersionProbeRef,
            verifiedAtRef,
          )
          if (waiting !== 'ready') {
            await probeRemoteVersions(
              setUpdateReady,
              setUpdateCount,
              pendingScopeRef,
              skipVersionProbeRef,
              verifiedAtRef,
            )
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
        await probeRemoteVersions(
          setUpdateReady,
          setUpdateCount,
          pendingScopeRef,
          skipVersionProbeRef,
          verifiedAtRef,
        )
        return
      }
      if (forceServiceWorkerCheck) {
        await reg.update()
      }
      const waiting = await probeWaitingWorker(
        reg,
        setUpdateReady,
        setUpdateCount,
        pendingScopeRef,
        skipVersionProbeRef,
        verifiedAtRef,
      )
      if (waiting !== 'ready') {
        await probeRemoteVersions(
          setUpdateReady,
          setUpdateCount,
          pendingScopeRef,
          skipVersionProbeRef,
          verifiedAtRef,
        )
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
      let result = 'none'
      const reg = registrationRef.current || (await navigator.serviceWorker.getRegistration())
      if (reg) {
        registrationRef.current = reg
        await reg.update()
        const waiting = await probeWaitingWorker(
          reg,
          setUpdateReady,
          setUpdateCount,
          pendingScopeRef,
          skipVersionProbeRef,
          verifiedAtRef,
        )
        if (waiting === 'ready') {
          result = 'ready'
        } else {
          result = await probeRemoteVersions(
            setUpdateReady,
            setUpdateCount,
            pendingScopeRef,
            skipVersionProbeRef,
            verifiedAtRef,
          )
        }
      } else {
        result = await probeRemoteVersions(
          setUpdateReady,
          setUpdateCount,
          pendingScopeRef,
          skipVersionProbeRef,
          verifiedAtRef,
        )
      }
      if (result === 'none') {
        verifiedAtRef.current = Date.now()
        clearPendingUpdateState(setUpdateReady, setUpdateCount)
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
    clearPendingUpdateState(setUpdateReady, setUpdateCount)

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
      updateCount,
      checking,
      applying,
      checkForUpdate,
      applyUpdate,
    }),
    [swSupported, updateReady, updateCount, checking, applying, checkForUpdate, applyUpdate],
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
