import { apiFetch } from './api'
import { apiUrl } from './apiBase'
import { formatApiError, parseApiJson } from '../offline/offlineApiHelpers'

function qs(params = {}) {
  const sp = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v == null || v === '' || v === 'all') return
    sp.set(k, String(v))
  })
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export async function fetchAnalyticsSnapshot({ modelId, months = 3 } = {}) {
  return apiFetch(`/analytics/snapshot${qs({ model_id: modelId, months })}`)
}

export async function fetchAnalyticsOverview({ modelId, months = 3 } = {}) {
  return apiFetch(`/analytics/overview${qs({ model_id: modelId, months })}`)
}

export async function fetchAnalyticsDaily({ modelId, days = 30 } = {}) {
  return apiFetch(`/analytics/daily${qs({ model_id: modelId, days })}`)
}

export async function fetchAnalyticsWeekly({ modelId, weeks = 12 } = {}) {
  return apiFetch(`/analytics/weekly${qs({ model_id: modelId, weeks })}`)
}

export async function fetchAnalyticsMonthly({ modelId, months = 6 } = {}) {
  return apiFetch(`/analytics/monthly${qs({ model_id: modelId, months })}`)
}

export async function fetchAnalyticsHourly({ modelId, months = 3 } = {}) {
  return apiFetch(`/analytics/hourly${qs({ model_id: modelId, months })}`)
}

export async function fetchAnalyticsStaffing({ modelId, months = 3 } = {}) {
  return apiFetch(`/analytics/staffing${qs({ model_id: modelId, months })}`)
}

export async function fetchPosReceiptStats() {
  return apiFetch('/pos-receipts/stats')
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
