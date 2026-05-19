import { apiFetch, API_BASE_URL } from './api'

function appendActivity(searchParams, activity) {
  if (activity) searchParams.append('activity', activity)
}

export async function fetchCashEntry(id) {
  return apiFetch(`/cash/entries/${id}`)
}

export async function fetchPrimaNotaLinkOptions() {
  return apiFetch('/cash/link-options')
}

export async function fetchEntries(params = {}) {
  const searchParams = new URLSearchParams()
  if (params.date_from) searchParams.append('date_from', params.date_from)
  if (params.date_to) searchParams.append('date_to', params.date_to)
  appendActivity(searchParams, params.activity)
  const query = searchParams.toString()
  const path = query ? `/cash/entries?${query}` : '/cash/entries'
  return apiFetch(path)
}

export async function createEntry(data) {
  return apiFetch('/cash/entries', {
    method: 'POST',
    body: JSON.stringify({
      ...data,
      entry_date: data.entry_date.endsWith('Z') || data.entry_date.includes('T') ? data.entry_date : `${data.entry_date}T12:00:00`,
    }),
  })
}


export async function updateEntry(id, data) {
  return apiFetch(`/cash/entries/${id}`, {
    method: 'PUT',
    body: JSON.stringify({
      ...data,
      entry_date: data.entry_date.endsWith('Z') || data.entry_date.includes('T') ? data.entry_date : `${data.entry_date}T12:00:00`,
    }),
  })
}


export async function deleteEntry(id) {
  const response = await fetch(`${API_BASE_URL}/cash/entries/${id}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    throw new Error('Errore nell\'eliminazione movimento')
  }
}

export async function deleteEntriesForDay(dateStr, activity) {
  const params = new URLSearchParams({ date_str: dateStr })
  appendActivity(params, activity)
  const response = await fetch(
    `${API_BASE_URL}/cash/entries/day?${params.toString()}`,
    { method: 'DELETE' },
  )
  if (!response.ok) {
    throw new Error('Errore nell\'eliminazione movimenti del giorno')
  }
}


export async function deleteEntriesForRange(dateFrom, dateTo, activity) {
  const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo })
  appendActivity(params, activity)
  const response = await fetch(
    `${API_BASE_URL}/cash/entries/range?${params.toString()}`,
    { method: 'DELETE' },
  )
  if (!response.ok) {
    throw new Error('Errore nell\'eliminazione movimenti dell\'intervallo')
  }
}


export async function fetchDailySummary(dateStr, activity) {
  const params = new URLSearchParams({ date_str: dateStr })
  appendActivity(params, activity)
  return apiFetch(`/cash/summary?${params.toString()}`)
}

export function getExportUrl(dateFrom, dateTo, activity) {
  const params = new URLSearchParams()
  if (dateFrom) params.append('date_from', dateFrom)
  if (dateTo) params.append('date_to', dateTo)
  appendActivity(params, activity)
  const q = params.toString()
  return `${API_BASE_URL}/cash/export/csv${q ? '?' + q : ''}`
}
