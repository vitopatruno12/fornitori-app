import { apiFetch, apiUrl } from './api'

function appendActivity(searchParams, activity) {
  if (activity) searchParams.append('activity', activity)
}

function appendAccessCode(searchParams, accessCode) {
  const code = String(accessCode || '').replace(/\D/g, '')
  if (code.length === 6) searchParams.append('code', code)
}

function appendActivityAndCode(searchParams, activity, accessCode) {
  appendActivity(searchParams, activity)
  appendAccessCode(searchParams, accessCode)
}

export async function fetchCashEntry(id) {
  return apiFetch(`/cash/entries/${id}`)
}

export async function fetchPrimaNotaLinkOptions() {
  return apiFetch('/cash/link-options')
}

export async function fetchPrimaNotaLocalePacks() {
  return apiFetch('/cash/locale-packs')
}

export async function fetchPrimaNotaLocalePack(activitySlug, accessCode) {
  const slug = encodeURIComponent(String(activitySlug || '').trim())
  const code = String(accessCode || '').replace(/\D/g, '')
  const q = code.length === 6 ? `?code=${encodeURIComponent(code)}` : ''
  return apiFetch(`/cash/locale-packs/${slug}${q}`)
}

export async function upsertPrimaNotaLocalePack(activitySlug, label, accessCode, options = {}) {
  const body = {
    activity_slug: String(activitySlug || '').trim(),
    label: label ? String(label).trim() : null,
  }
  const code = String(accessCode || '').replace(/\D/g, '')
  if (code.length === 6) body.access_code = code
  if (options.regenerateAccessCode) body.regenerate_access_code = true
  return apiFetch('/cash/locale-packs', {
    method: 'PUT',
    body: JSON.stringify(body),
  })
}

export async function deletePrimaNotaLocalePack(activitySlug, accessCode) {
  const slug = encodeURIComponent(String(activitySlug || '').trim())
  const code = String(accessCode || '').replace(/\D/g, '')
  const q = code.length === 6 ? `?code=${encodeURIComponent(code)}` : ''
  await apiFetch(`/cash/locale-packs/${slug}${q}`, { method: 'DELETE' })
}

export async function fetchEntries(params = {}) {
  const searchParams = new URLSearchParams()
  if (params.date_from) searchParams.append('date_from', params.date_from)
  if (params.date_to) searchParams.append('date_to', params.date_to)
  appendActivityAndCode(searchParams, params.activity, params.access_code)
  const query = searchParams.toString()
  const path = query ? `/cash/entries?${query}` : '/cash/entries'
  return apiFetch(path)
}

export async function createEntry(data, accessCode) {
  const searchParams = new URLSearchParams()
  appendAccessCode(searchParams, accessCode)
  const q = searchParams.toString()
  return apiFetch(`/cash/entries${q ? `?${q}` : ''}`, {
    method: 'POST',
    body: JSON.stringify({
      ...data,
      entry_date: data.entry_date.endsWith('Z') || data.entry_date.includes('T') ? data.entry_date : `${data.entry_date}T12:00:00`,
    }),
  })
}


export async function updateEntry(id, data, accessCode) {
  const searchParams = new URLSearchParams()
  appendAccessCode(searchParams, accessCode)
  const q = searchParams.toString()
  return apiFetch(`/cash/entries/${id}${q ? `?${q}` : ''}`, {
    method: 'PUT',
    body: JSON.stringify({
      ...data,
      entry_date: data.entry_date.endsWith('Z') || data.entry_date.includes('T') ? data.entry_date : `${data.entry_date}T12:00:00`,
    }),
  })
}


export async function deleteEntry(id, accessCode) {
  const searchParams = new URLSearchParams()
  appendAccessCode(searchParams, accessCode)
  const q = searchParams.toString()
  await apiFetch(`/cash/entries/${id}${q ? `?${q}` : ''}`, { method: 'DELETE' })
}

export async function deleteEntriesForDay(dateStr, activity, accessCode) {
  const params = new URLSearchParams({ date_str: dateStr })
  appendActivityAndCode(params, activity, accessCode)
  await apiFetch(`/cash/entries/day?${params.toString()}`, { method: 'DELETE' })
}

export async function deleteEntriesForRange(dateFrom, dateTo, activity, accessCode) {
  const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo })
  appendActivityAndCode(params, activity, accessCode)
  await apiFetch(`/cash/entries/range?${params.toString()}`, { method: 'DELETE' })
}


export async function fetchDailySummary(dateStr, activity, accessCode) {
  const params = new URLSearchParams({ date_str: dateStr })
  appendActivityAndCode(params, activity, accessCode)
  return apiFetch(`/cash/summary?${params.toString()}`)
}

export function getExportUrl(dateFrom, dateTo, activity, accessCode) {
  const params = new URLSearchParams()
  if (dateFrom) params.append('date_from', dateFrom)
  if (dateTo) params.append('date_to', dateTo)
  appendActivityAndCode(params, activity, accessCode)
  const q = params.toString()
  return apiUrl(`/cash/export/csv${q ? '?' + q : ''}`)
}
