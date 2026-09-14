import { apiFetch, apiUrl } from './api'

export async function fetchConservationCandidates({ company, periodFrom, periodTo, includeIssued = true } = {}) {
  const q = new URLSearchParams()
  if (company) q.set('company', company)
  if (periodFrom) q.set('period_from', periodFrom)
  if (periodTo) q.set('period_to', periodTo)
  q.set('include_issued', includeIssued ? 'true' : 'false')
  return apiFetch(`/conservazione/candidates?${q.toString()}`)
}

export async function fetchConservationPackages({ company, limit = 100 } = {}) {
  const q = new URLSearchParams()
  if (company) q.set('company', company)
  if (limit) q.set('limit', String(limit))
  return apiFetch(`/conservazione/packages?${q.toString()}`)
}

export async function createConservationPackage(body) {
  return apiFetch('/conservazione/packages', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function fetchConservationPackage(id) {
  return apiFetch(`/conservazione/packages/${id}`)
}

export async function buildConservationPackage(id) {
  return apiFetch(`/conservazione/packages/${id}/build`, { method: 'POST' })
}

export async function setConservationPackageStatus(id, status, note) {
  return apiFetch(`/conservazione/packages/${id}/status`, {
    method: 'POST',
    body: JSON.stringify({ status, note }),
  })
}

export async function deleteConservationPackage(id) {
  return apiFetch(`/conservazione/packages/${id}`, { method: 'DELETE' })
}

export function getConservationPackageDownloadUrl(id) {
  return apiUrl(`/conservazione/packages/${id}/download`)
}
