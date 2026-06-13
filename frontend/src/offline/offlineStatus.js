const listeners = new Set()

function notify() {
  for (const fn of listeners) {
    try {
      fn(getOfflineSnapshot())
    } catch {
      // ignore
    }
  }
}

export function isOnline() {
  return typeof navigator !== 'undefined' ? navigator.onLine : true
}

export function getOfflineSnapshot() {
  return { online: isOnline() }
}

export function subscribeOfflineStatus(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', notify)
  window.addEventListener('offline', notify)
}
