import { apiFetch, apiUrl } from './api'

/** Tutte le chiamate AI passano da FastAPI (/api/ai → Ollama). */
async function aiFetch(path, options = {}) {
  const p = path.startsWith('/') ? path : `/${path}`
  const url = apiUrl(p)
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) }
  const res = await fetch(url, { ...options, headers })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Errore API AI ${res.status}`)
  }
  if (res.status === 204) return null
  return res.json()
}

const SUPPLIER_AI_TIMEOUT_MS = 8000

export async function suggestSupplierFields(text, existingData = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SUPPLIER_AI_TIMEOUT_MS)
  try {
    return await aiFetch('/ai/suppliers/suggest', {
      method: 'POST',
      body: JSON.stringify({ text, existing_data: existingData }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

export async function suggestPrimaNota(text, context = {}) {
  return aiFetch('/ai/prima-nota/suggest', {
    method: 'POST',
    body: JSON.stringify({ text, context }),
  })
}

export async function suggestInvoiceFields(text, existingData = {}) {
  return aiFetch('/ai/invoices/suggest', {
    method: 'POST',
    body: JSON.stringify({ text, existing_data: existingData }),
  })
}

export async function suggestOrderLines(text) {
  return aiFetch('/ai/orders/suggest', {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}

export async function suggestOrderFull(text, supplierNames = []) {
  return aiFetch('/ai/orders/suggest-full', {
    method: 'POST',
    body: JSON.stringify({ text, supplier_names: supplierNames }),
  })
}

async function staffShiftViaBase(path, body, signal) {
  const p = path.startsWith('/') ? path : `/${path}`
  const url = apiUrl(p)
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(text || `Errore API AI ${res.status}`)
  }
  return res.json()
}

export async function suggestStaffShift(text, memberNames = [], context = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60000)
  const body = { text, member_names: memberNames, context }
  try {
    const primary = await aiFetch('/ai/staff/shift-suggest', {
      method: 'POST',
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const shifts = primary?.suggested_shifts
    const hasShifts = Array.isArray(shifts) && shifts.length > 0
    const sf = primary?.suggested_fields
    const hasFields = sf && typeof sf === 'object' && (sf.staff_member_name || sf.time_start)
    if (primary?.quota_exceeded && !hasShifts && !hasFields) {
      try {
        const fallback = await staffShiftViaBase('/ai/staff/shift-suggest', body, controller.signal)
        if (fallback?.local_fallback || (Array.isArray(fallback?.suggested_shifts) && fallback.suggested_shifts.length)) {
          return fallback
        }
      } catch {
        /* frontend heuristic in StaffPage */
      }
    }
    return primary
  } finally {
    clearTimeout(timer)
  }
}

export async function checkAiAnomalies(entityType, payload, history = {}) {
  return aiFetch('/ai/anomalies/check', {
    method: 'POST',
    body: JSON.stringify({ entity_type: entityType, payload, history }),
  })
}

export async function askAi(question, module = '', context = {}) {
  return aiFetch('/ai/ask', {
    method: 'POST',
    body: JSON.stringify({ question, module, context }),
  })
}
