import { apiUrl } from '../services/apiBase'
import { formatApiError, looksLikeHtml, parseApiJson } from './offlineApiHelpers'
import { patchCachedListsForCreate } from './offlineCache'
import {
  enqueueOfflineMutation,
  getPendingQueueItems,
  markQueueItemFailed,
  markQueueItemSynced,
} from './offlineQueue'

let syncing = false

export function isOfflineSyncing() {
  return syncing
}

function buildOptimisticResponse(path, method, bodyText, queueId) {
  let body = {}
  if (bodyText) {
    try {
      body = JSON.parse(bodyText)
    } catch {
      body = {}
    }
  }
  const tempId = -Math.abs(Date.now())
  const now = new Date().toISOString()
  const base = {
    __offline: true,
    __queueId: queueId,
    id: tempId,
    created_at: now,
  }
  if (method === 'POST') {
    if (path.startsWith('/cash/entries')) {
      return {
        ...base,
        entry_date: body.entry_date || now,
        type: body.type || 'entrata',
        amount: body.amount ?? 0,
        description: body.description || '',
        note: body.note ?? null,
        conto: body.conto ?? null,
        riferimento_documento: body.riferimento_documento ?? null,
        supplier_id: body.supplier_id ?? null,
        invoice_id: body.invoice_id ?? null,
        delivery_id: body.delivery_id ?? null,
        customer_id: body.customer_id ?? null,
        account_id: body.account_id ?? null,
        payment_method_id: body.payment_method_id ?? null,
        category_id: body.category_id ?? null,
        activity: body.activity ?? null,
        saldo_progressivo: 0,
      }
    }
    if (path.startsWith('/staff/shifts')) {
      return {
        ...base,
        staff_member_id: body.staff_member_id,
        work_date: body.work_date,
        time_start: body.time_start ?? null,
        time_end: body.time_end ?? null,
        entry_kind: body.entry_kind || 'shift',
        notes: body.notes ?? null,
      }
    }
    if (path.startsWith('/staff/members')) {
      return {
        ...base,
        name: body.name || 'Dipendente',
        first_name: body.first_name ?? null,
        last_name: body.last_name ?? null,
        email: body.email ?? null,
        phone: body.phone ?? null,
        city: body.city ?? null,
        birth_date: body.birth_date ?? null,
        hourly_rate: body.hourly_rate ?? null,
        is_active: body.is_active !== false,
        sort_order: body.sort_order ?? 0,
      }
    }
    if (path.startsWith('/supplier-orders')) {
      return {
        ...base,
        ...body,
        status: body.status || 'pending',
        order_date: body.order_date || now.slice(0, 10),
      }
    }
    return { ...base, ...body }
  }
  if (method === 'PUT' || method === 'PATCH') {
    const idMatch = path.match(/\/(\d+)(?:\?|$)/)
    return { ...base, id: idMatch ? Number(idMatch[1]) : tempId, ...body }
  }
  if (method === 'DELETE') {
    return { __offline: true, __queueId: queueId, ok: true }
  }
  return { __offline: true, __queueId: queueId }
}

export async function flushOfflineQueue() {
  if (syncing) return { synced: 0, failed: 0 }
  const items = await getPendingQueueItems()
  if (!items.length) return { synced: 0, failed: 0 }

  syncing = true
  let synced = 0
  let failed = 0
  try {
    for (const item of items) {
      try {
        const response = await fetch(apiUrl(item.path), {
          method: item.method,
          headers: {
            'Content-Type': 'application/json',
            ...(item.headers || {}),
          },
          body: item.body,
        })
        if (!response.ok) {
          const text = await response.text().catch(() => '')
          throw new Error(formatApiError(response.status, text))
        }
        await response.text().catch(() => '')
        await markQueueItemSynced(item.id)
        synced += 1
        window.dispatchEvent(
          new CustomEvent('atlas-offline-item-synced', { detail: { path: item.path, label: item.label } }),
        )
      } catch (err) {
        await markQueueItemFailed(item.id, err?.message || 'Sync fallita')
        failed += 1
        break
      }
    }
    if (synced > 0) {
      window.dispatchEvent(new CustomEvent('atlas-offline-sync-complete', { detail: { synced, failed } }))
      window.dispatchEvent(new CustomEvent('atlas-refresh-data', { detail: { synced, failed } }))
    }
  } finally {
    syncing = false
  }
  return { synced, failed }
}

export async function queueMutationAndRespond(path, options = {}) {
  const method = String(options.method || 'POST').toUpperCase()
  const body = options.body ?? null
  const headers = { ...(options.headers || {}) }
  const item = await enqueueOfflineMutation({ path, method, body, headers })
  const optimistic = buildOptimisticResponse(path, method, body, item.id)
  if (method === 'POST' && optimistic?.id != null) {
    await patchCachedListsForCreate(path, optimistic)
  }
  window.dispatchEvent(
    new CustomEvent('atlas-offline-queued', { detail: { path, method, label: item.label, queueId: item.id } }),
  )
  return optimistic
}

export { parseApiJson }
