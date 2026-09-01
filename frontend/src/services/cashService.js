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

export async function fetchRangeSummary(dateFrom, dateTo, activity, accessCode) {
  const params = new URLSearchParams({ date_from: dateFrom, date_to: dateTo })
  appendActivityAndCode(params, activity, accessCode)
  try {
    return await apiFetch(`/cash/summary/range?${params.toString()}`)
  } catch (err) {
    return fetchRangeSummaryFallback(dateFrom, dateTo, activity, accessCode, err)
  }
}

function enumerateIsoDays(from, to) {
  const start = from <= to ? from : to
  const end = from <= to ? to : from
  const days = []
  const cursor = new Date(`${start}T12:00:00`)
  const limit = new Date(`${end}T12:00:00`)
  while (cursor <= limit && days.length <= 62) {
    const y = cursor.getFullYear()
    const m = String(cursor.getMonth() + 1).padStart(2, '0')
    const d = String(cursor.getDate()).padStart(2, '0')
    days.push(`${y}-${m}-${d}`)
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

async function fetchRangeSummaryFallback(dateFrom, dateTo, activity, accessCode, originalError) {
  const from = dateFrom <= dateTo ? dateFrom : dateTo
  const to = dateFrom <= dateTo ? dateTo : dateFrom
  const days = enumerateIsoDays(from, to)
  if (!days.length) throw originalError
  try {
    const parts = await Promise.all(days.map((day) => fetchDailySummary(day, activity, accessCode)))
    const totals = parts.reduce(
      (acc, part) => {
        acc.totale_entrate += num(part?.totale_entrate)
        acc.totale_uscite += num(part?.totale_uscite)
        acc.saldo_giornaliero += num(part?.saldo_giornaliero)
        acc.totale_fiscale += num(part?.totale_fiscale)
        acc.totale_non_fiscale += num(part?.totale_non_fiscale)
        acc.totale_pos += num(part?.totale_pos)
        acc.totale_refill += num(part?.totale_refill)
        acc.totale_stacker_svuotamento += num(part?.totale_stacker_svuotamento)
        acc.totale_vendita += num(part?.totale_vendita)
        return acc
      },
      {
        totale_entrate: 0,
        totale_uscite: 0,
        saldo_giornaliero: 0,
        totale_fiscale: 0,
        totale_non_fiscale: 0,
        totale_pos: 0,
        totale_refill: 0,
        totale_stacker_svuotamento: 0,
        totale_vendita: 0,
      },
    )
    const last = parts[parts.length - 1] || {}
    return {
      date_from: from,
      date_to: to,
      ...totals,
      saldo_cumulativo: num(last.saldo_cumulativo),
    }
  } catch {
    throw originalError
  }
}

export function getExportUrl(dateFrom, dateTo, activity, accessCode) {
  const params = new URLSearchParams()
  if (dateFrom) params.append('date_from', dateFrom)
  if (dateTo) params.append('date_to', dateTo)
  appendActivityAndCode(params, activity, accessCode)
  const q = params.toString()
  return apiUrl(`/cash/export/csv${q ? '?' + q : ''}`)
}
