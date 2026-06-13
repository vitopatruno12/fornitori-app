const DB_NAME = 'atlas-offline-v1'
const DB_VERSION = 1
const QUEUE_STORE = 'queue'
const CACHE_STORE = 'cache'

let dbPromise = null

function openDb() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const q = db.createObjectStore(QUEUE_STORE, { keyPath: 'id' })
        q.createIndex('status', 'status', { unique: false })
        q.createIndex('createdAt', 'createdAt', { unique: false })
      }
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: 'key' })
      }
    }
  })
  return dbPromise
}

export async function initOfflineDb() {
  return openDb()
}

function tx(storeName, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, mode)
        const store = transaction.objectStore(storeName)
        let result
        try {
          result = fn(store)
        } catch (err) {
          reject(err)
          return
        }
        transaction.oncomplete = () => resolve(result)
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      }),
  )
}

export async function dbPut(storeName, value) {
  return tx(storeName, 'readwrite', (store) => store.put(value))
}

export async function dbGet(storeName, key) {
  return tx(storeName, 'readonly', (store) => {
    const req = store.get(key)
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
  })
}

export async function dbGetAll(storeName) {
  return tx(storeName, 'readonly', (store) => {
    const req = store.getAll()
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result || [])
      req.onerror = () => reject(req.error)
    })
  })
}

export async function dbDelete(storeName, key) {
  return tx(storeName, 'readwrite', (store) => store.delete(key))
}

export { QUEUE_STORE, CACHE_STORE }
