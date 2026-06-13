import { dbDelete, dbGetAll, dbPut, QUEUE_STORE } from './offlineDb'

export function queueLabelForPath(path, method) {
  const p = String(path || '')
  if (p.startsWith('/cash/entries')) return method === 'DELETE' ? 'Elimina movimento' : 'Prima Nota'
  if (p.startsWith('/staff/shifts')) return 'Turno personale'
  if (p.startsWith('/staff/members')) return 'Dipendente'
  if (p.startsWith('/staff/payroll-months')) return 'Mese stipendi'
  if (p.startsWith('/supplier-orders')) return 'Ordine fornitore'
  if (p.startsWith('/deliveries')) return 'Consegna'
  if (p.startsWith('/suppliers')) return 'Fornitore'
  if (p.startsWith('/invoices')) return 'Fattura'
  return `${method} ${p}`
}

function newQueueId() {
  return `q-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export async function enqueueOfflineMutation({ path, method, body, headers }) {
  const id = newQueueId()
  const item = {
    id,
    path,
    method: String(method || 'POST').toUpperCase(),
    body: body ?? null,
    headers: headers || {},
    createdAt: new Date().toISOString(),
    status: 'pending',
    label: queueLabelForPath(path, method),
    error: null,
  }
  await dbPut(QUEUE_STORE, item)
  return item
}

export async function getPendingQueueItems() {
  const all = await dbGetAll(QUEUE_STORE)
  return all
    .filter((x) => x.status === 'pending' || x.status === 'failed')
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
}

export async function getQueueCount() {
  const pending = await getPendingQueueItems()
  return pending.length
}

export async function markQueueItemSynced(id) {
  await dbDelete(QUEUE_STORE, id)
}

export async function markQueueItemFailed(id, error) {
  const all = await dbGetAll(QUEUE_STORE)
  const hit = all.find((x) => x.id === id)
  if (!hit) return
  await dbPut(QUEUE_STORE, { ...hit, status: 'failed', error: String(error || 'Errore sync') })
}

export async function clearFailedQueueItems() {
  const all = await dbGetAll(QUEUE_STORE)
  for (const item of all.filter((x) => x.status === 'failed')) {
    await dbDelete(QUEUE_STORE, item.id)
  }
}
