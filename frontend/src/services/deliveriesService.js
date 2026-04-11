import { apiFetch, API_BASE_URL } from './api'

export async function createDelivery(data) {
  return apiFetch('/deliveries', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export async function createDeliveryBatch(data) {
  return apiFetch('/deliveries/batch', {
    method: 'POST',
    body: JSON.stringify({
      ...data,
      delivery_date: data.delivery_date && !data.delivery_date.includes('T')
        ? `${data.delivery_date}T00:00:00`
        : data.delivery_date,
    }),
  })
}

export async function fetchDeliveries(params = {}) {
  const searchParams = new URLSearchParams()
  if (params.supplier_id) searchParams.append('supplier_id', String(params.supplier_id))
  if (params.date_from) searchParams.append('date_from', params.date_from)
  if (params.date_to) searchParams.append('date_to', params.date_to)
  if (params.product_query) searchParams.append('product_query', params.product_query)

  const query = searchParams.toString()
  const path = query ? `/deliveries?${query}` : '/deliveries'
  return apiFetch(path)
}

export async function fetchPriceAnalytics({ supplier_id, product_description }) {
  const q = new URLSearchParams({
    supplier_id: String(supplier_id),
    product_description: product_description.trim(),
  })
  return apiFetch(`/deliveries/price-analytics?${q}`)
}

export async function deleteAllDeliveries() {
  const res = await fetch(`${API_BASE_URL}/deliveries/all`, { method: 'DELETE' })
  if (!res.ok) {
    throw new Error('Errore nell\'eliminazione dello storico scarichi')
  }
}

