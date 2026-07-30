import { apiFetch } from './api'

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
