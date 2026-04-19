import { apiFetch } from './api'

export function fetchSupportTechnicians() {
  return apiFetch('/support-technicians')
}

export function createSupportTechnician(data) {
  return apiFetch('/support-technicians', { method: 'POST', body: JSON.stringify(data) })
}

export function updateSupportTechnician(id, data) {
  return apiFetch(`/support-technicians/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

export function deleteSupportTechnician(id) {
  return apiFetch(`/support-technicians/${id}`, { method: 'DELETE' })
}

export function deleteAllSupportTechnicians() {
  return apiFetch('/support-technicians/bulk', { method: 'DELETE' })
}

export function seedSupportDefaults() {
  return apiFetch('/support-technicians/seed-defaults', { method: 'POST' })
}

export function fetchSupportActivities(from, to, technicianId) {
  const q = new URLSearchParams({ from, to })
  if (technicianId) q.set('technician_id', String(technicianId))
  return apiFetch(`/support-technicians/activities?${q}`)
}

export function createSupportActivity(data) {
  return apiFetch('/support-technicians/activities', { method: 'POST', body: JSON.stringify(data) })
}

export function updateSupportActivity(id, data) {
  return apiFetch(`/support-technicians/activities/${id}`, { method: 'PUT', body: JSON.stringify(data) })
}

export function deleteSupportActivity(id) {
  return apiFetch(`/support-technicians/activities/${id}`, { method: 'DELETE' })
}

/** URL WhatsApp (prefisso 39 per numeri IT). */
export function supportWhatsappUrl(phoneDigits) {
  const d = String(phoneDigits || '').replace(/\D/g, '')
  if (!d) return null
  let n = d
  if (!n.startsWith('39')) n = `39${n}`
  return `https://wa.me/${n}`
}
