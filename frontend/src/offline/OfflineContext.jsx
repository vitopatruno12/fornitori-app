import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { initOfflineDb } from './offlineDb'
import { getQueueCount } from './offlineQueue'
import { flushOfflineQueue, isOfflineSyncing } from './offlineSync'
import { isOnline, subscribeOfflineStatus } from './offlineStatus'

const OfflineContext = createContext({
  online: true,
  queueCount: 0,
  syncing: false,
  refreshQueueCount: () => {},
  syncNow: async () => ({ synced: 0, failed: 0 }),
})

export function OfflineProvider({ children }) {
  const [online, setOnline] = useState(() => isOnline())
  const [queueCount, setQueueCount] = useState(0)
  const [syncing, setSyncing] = useState(false)

  const refreshQueueCount = useCallback(async () => {
    try {
      const n = await getQueueCount()
      setQueueCount(n)
    } catch {
      setQueueCount(0)
    }
  }, [])

  const syncNow = useCallback(async () => {
    if (!isOnline()) return { synced: 0, failed: 0 }
    setSyncing(true)
    try {
      const result = await flushOfflineQueue()
      await refreshQueueCount()
      return result
    } finally {
      setSyncing(false)
    }
  }, [refreshQueueCount])

  useEffect(() => {
    let cancelled = false
    initOfflineDb()
      .then(() => refreshQueueCount())
      .catch(() => {})

    const unsub = subscribeOfflineStatus((snap) => {
      if (!cancelled) setOnline(snap.online)
    })

    const onQueued = () => void refreshQueueCount()
    const onSynced = () => void refreshQueueCount()
    const onOnline = () => {
      void syncNow()
    }

    window.addEventListener('atlas-offline-queued', onQueued)
    window.addEventListener('atlas-offline-sync-complete', onSynced)
    window.addEventListener('atlas-offline-item-synced', onSynced)
    window.addEventListener('online', onOnline)

    if (isOnline()) {
      void syncNow()
    }

    const poll = window.setInterval(() => {
      if (isOfflineSyncing()) setSyncing(true)
      else setSyncing(false)
    }, 400)

    return () => {
      cancelled = true
      unsub()
      window.removeEventListener('atlas-offline-queued', onQueued)
      window.removeEventListener('atlas-offline-sync-complete', onSynced)
      window.removeEventListener('atlas-offline-item-synced', onSynced)
      window.removeEventListener('online', onOnline)
      window.clearInterval(poll)
    }
  }, [refreshQueueCount, syncNow])

  const value = useMemo(
    () => ({ online, queueCount, syncing, refreshQueueCount, syncNow }),
    [online, queueCount, syncing, refreshQueueCount, syncNow],
  )

  return <OfflineContext.Provider value={value}>{children}</OfflineContext.Provider>
}

export function useOffline() {
  return useContext(OfflineContext)
}
