import { localeLabel, normalizePrimaNotaActivity } from '../constants/primaNotaLocales'

export function parseSupplierLocales(value) {
  if (!value) return []
  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => normalizePrimaNotaActivity(id))
}

export function serializeSupplierLocales(ids) {
  const unique = [...new Set((ids || []).map((id) => normalizePrimaNotaActivity(id)).filter(Boolean))]
  return unique.length ? unique.join(',') : undefined
}

export function formatSupplierLocales(value, locales = null) {
  const ids = parseSupplierLocales(value)
  if (!ids.length) return '—'
  return ids.map((id) => localeLabel(id, locales)).join(', ')
}
