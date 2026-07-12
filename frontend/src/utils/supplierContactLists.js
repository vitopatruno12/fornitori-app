import { ORDER_QUICK_PRODUCTS } from '../constants/orderQuickProducts.js'

export const SUPPLIER_MERCHANDISE_CATEGORY_OPTIONS = ORDER_QUICK_PRODUCTS.map((item) => item.label)

export function emptyContactItem(value = '') {
  return { value: String(value || '').trim(), enabled: true }
}

export function parseContactListJson(raw) {
  if (!raw) return []
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => ({
        value: String(item?.value ?? '').trim(),
        enabled: item?.enabled !== false,
      }))
      .filter((item) => item.value)
  } catch {
    return []
  }
}

export function parseContactListFromSupplier(supplier, jsonField, scalarField) {
  const fromJson = parseContactListJson(supplier?.[jsonField])
  if (fromJson.length) return fromJson
  const single = String(supplier?.[scalarField] || '').trim()
  return single ? [emptyContactItem(single)] : [emptyContactItem()]
}

export function serializeContactList(items) {
  const list = (Array.isArray(items) ? items : [])
    .map((item) => ({
      value: String(item?.value ?? '').trim(),
      enabled: item?.enabled !== false,
    }))
    .filter((item) => item.value)
  return list.length ? JSON.stringify(list) : null
}

export function primaryContactValue(items) {
  const list = Array.isArray(items) ? items : []
  const enabled = list.filter((item) => item.enabled !== false && String(item.value || '').trim())
  if (enabled.length) return String(enabled[0].value).trim()
  const any = list.find((item) => String(item.value || '').trim())
  return any ? String(any.value).trim() : ''
}

export function formatContactListDisplay(rawJson, fallbackSingle = '') {
  const fromJson = parseContactListJson(rawJson).filter((item) => item.enabled !== false)
  if (fromJson.length) return fromJson.map((item) => item.value).join(', ')
  return String(fallbackSingle || '').trim()
}

export function parseMerchandiseCategoriesFromSupplier(supplier) {
  const fromJson = parseMerchandiseCategoriesJson(supplier?.merchandise_categories_json)
  if (fromJson.length) return fromJson
  const legacy = String(supplier?.merchandise_category || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  return legacy
}

export function parseMerchandiseCategoriesJson(raw) {
  if (!raw) return []
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(parsed)) return []
    return parsed.map((item) => String(item || '').trim()).filter(Boolean)
  } catch {
    return []
  }
}

export function serializeMerchandiseCategories(categories) {
  const list = (Array.isArray(categories) ? categories : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
  const unique = [...new Set(list)]
  return unique.length ? JSON.stringify(unique) : null
}

export function buildSupplierMultiContactPayload({ phones, emails, cities, merchandiseCategories }) {
  const cats = (Array.isArray(merchandiseCategories) ? merchandiseCategories : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
  const uniqueCats = [...new Set(cats)]
  return {
    phone: primaryContactValue(phones) || undefined,
    email: primaryContactValue(emails) || undefined,
    city: primaryContactValue(cities) || undefined,
    phones_json: serializeContactList(phones),
    emails_json: serializeContactList(emails),
    cities_json: serializeContactList(cities),
    merchandise_categories_json: serializeMerchandiseCategories(uniqueCats),
    merchandise_category: uniqueCats.length ? uniqueCats.join(', ') : undefined,
  }
}

export function mergeContactValue(items, setItems, value) {
  const next = String(value || '').trim()
  if (!next) return
  setItems((prev) => {
    const list = Array.isArray(prev) && prev.length ? [...prev] : [emptyContactItem()]
    const idx = list.findIndex((item) => !String(item.value || '').trim())
    if (idx >= 0) {
      list[idx] = { ...list[idx], value: next, enabled: true }
      return list
    }
    if (list.some((item) => String(item.value || '').trim() === next)) return list
    return [...list, emptyContactItem(next)]
  })
}
