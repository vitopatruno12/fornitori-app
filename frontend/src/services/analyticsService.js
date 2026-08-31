import { apiFetch } from './api'
import { apiUrl } from './apiBase'
import { formatApiError, parseApiJson } from '../offline/offlineApiHelpers'

function qs(params = {}) {
  const sp = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v == null || v === '' || v === 'all' || v === 'combined') return
    sp.set(k, String(v))
  })
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export async function fetchAnalyticsSnapshot({ modelId, months = 3, location } = {}) {
  return apiFetch(`/analytics/snapshot${qs({ model_id: modelId, months, location })}`)
}

export async function fetchAnalyticsOverview({ modelId, months = 3 } = {}) {
  return apiFetch(`/analytics/overview${qs({ model_id: modelId, months })}`)
}

export async function fetchAnalyticsDaily({ modelId, days = 30, location } = {}) {
  return apiFetch(`/analytics/daily${qs({ model_id: modelId, days, location })}`)
}

export async function fetchAnalyticsWeekly({ modelId, weeks = 12, location } = {}) {
  return apiFetch(`/analytics/weekly${qs({ model_id: modelId, weeks, location })}`)
}

export async function fetchAnalyticsMonthly({ modelId, months = 6, location } = {}) {
  return apiFetch(`/analytics/monthly${qs({ model_id: modelId, months, location })}`)
}

export async function fetchAnalyticsHourly({ modelId, months = 3, location } = {}) {
  return apiFetch(`/analytics/hourly${qs({ model_id: modelId, months, location })}`)
}

export async function fetchAnalyticsStaffing({ modelId, months = 3, location } = {}) {
  return apiFetch(`/analytics/staffing${qs({ model_id: modelId, months, location })}`)
}

export async function fetchPosReceiptStats() {
  return apiFetch('/pos-receipts/stats')
}

export async function fetchPosPaymentSummary({ dateFrom, dateTo, modelId } = {}) {
  return apiFetch(
    `/pos-receipts/payment-summary${qs({
      date_from: dateFrom,
      date_to: dateTo,
      model_id: modelId,
    })}`,
  )
}

export async function fetchPosReceiptSyncStatus() {
  return apiFetch('/pos-receipts/sync-status')
}

export async function triggerPosReceiptsGdbSync({ modelId, lookbackHours } = {}) {
  return apiFetch('/pos-receipts/sync-gdb', {
    method: 'POST',
    body: JSON.stringify({
      model_id: modelId || undefined,
      lookback_hours: lookbackHours || undefined,
    }),
  })
}

export async function importPosReceiptsCsv(file, { modelId } = {}) {
  const body = new FormData()
  body.append('file', file)
  if (modelId) body.append('model_id', modelId)
  const response = await fetch(apiUrl('/pos-receipts/import-csv'), {
    method: 'POST',
    body,
  })
  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const data = await parseApiJson(response)
      detail = formatApiError(data) || detail
    } catch {
      // ignore
    }
    throw new Error(detail)
  }
  return response.json()
}

export function posReceiptsTemplateUrl() {
  return apiUrl('/pos-receipts/template.csv')
}
