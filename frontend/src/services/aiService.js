import { apiFetch } from './api'

export async function suggestSupplierFields(text, existingData = {}) {
  return apiFetch('/ai/suppliers/suggest', {
    method: 'POST',
    body: JSON.stringify({
      text,
      existing_data: existingData,
    }),
  })
}

export async function suggestPrimaNota(text, context = {}) {
  return apiFetch('/ai/prima-nota/suggest', {
    method: 'POST',
    body: JSON.stringify({
      text,
      context,
    }),
  })
}

export async function suggestInvoiceFields(text, existingData = {}) {
  return apiFetch('/ai/invoices/suggest', {
    method: 'POST',
    body: JSON.stringify({
      text,
      existing_data: existingData,
    }),
  })
}

export async function suggestOrderLines(text) {
  return apiFetch('/ai/orders/suggest', {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
}

export async function checkAiAnomalies(entityType, payload, history = {}) {
  return apiFetch('/ai/anomalies/check', {
    method: 'POST',
    body: JSON.stringify({
      entity_type: entityType,
      payload,
      history,
    }),
  })
}

export async function askAi(question, module = '', context = {}) {
  return apiFetch('/ai/ask', {
    method: 'POST',
    body: JSON.stringify({
      question,
      module,
      context,
    }),
  })
}

