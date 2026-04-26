import { apiFetch } from './api'

export function fetchVneModels() {
  return apiFetch('/vne/models')
}

export function fetchVneModelStatus(modelId) {
  return apiFetch(`/vne/models/${encodeURIComponent(modelId)}/status`)
}

export function fetchVneOperationFilters(modelId) {
  return apiFetch(`/vne/models/${encodeURIComponent(modelId)}/operations/filters`)
}

export function queryVneOperations(modelId, payload) {
  return apiFetch(`/vne/models/${encodeURIComponent(modelId)}/operations/query`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  })
}

export function fetchVneCashClosingFilters(modelId) {
  return apiFetch(`/vne/models/${encodeURIComponent(modelId)}/cash-closings/filters`)
}

export function queryVneCashClosings(modelId, payload) {
  return apiFetch(`/vne/models/${encodeURIComponent(modelId)}/cash-closings/query`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  })
}

export function fetchVneContabilita(modelId) {
  return apiFetch(`/vne/models/${encodeURIComponent(modelId)}/contabilita`)
}
