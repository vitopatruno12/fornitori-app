import { apiFetch } from './api'

export async function fetchWhatsAppStatus() {
  return apiFetch('/whatsapp/status')
}

export async function sendWhatsAppText({ phone, message, name } = {}) {
  return apiFetch('/whatsapp/send', {
    method: 'POST',
    body: JSON.stringify({
      phone: String(phone || '').trim(),
      message: String(message || '').trim(),
      name: String(name || '').trim() || undefined,
    }),
  })
}

export async function sendWhatsAppMany(messages) {
  return apiFetch('/whatsapp/send-many', {
    method: 'POST',
    body: JSON.stringify({ messages: Array.isArray(messages) ? messages : [] }),
  })
}
