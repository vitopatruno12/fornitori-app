import { apiFetch, apiUrl } from './api'

export async function fetchBancaDashboard() {
  return apiFetch('/banca/dashboard')
}

export async function fetchBancaAccounts() {
  return apiFetch('/banca/accounts')
}

export async function createBancaAccount(payload) {
  return apiFetch('/banca/accounts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function connectBancaAccount(id) {
  return apiFetch(`/banca/accounts/${id}/connect`, { method: 'POST' })
}

export async function confirmBancaConnectOtp(id, otp) {
  return apiFetch(`/banca/accounts/${id}/connect-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ otp: String(otp || '') }),
  })
}

export async function fetchBancaConnectProfile() {
  return apiFetch('/banca/connect-profile')
}

export async function startEnableBankingAuth(accountId, payload = {}) {
  return apiFetch(`/banca/accounts/${accountId}/enable-banking/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      aspsp_name: payload.aspsp_name || undefined,
      aspsp_country: payload.aspsp_country || undefined,
      psu_type: payload.psu_type || 'personal',
    }),
  })
}

export async function syncEnableBankingAccount(id) {
  return apiFetch(`/banca/accounts/${id}/enable-banking/sync`, { method: 'POST' })
}

export async function fetchEnableBankingStatus() {
  return apiFetch('/banca/enable-banking/status')
}

export async function disconnectBancaAccount(id) {
  return apiFetch(`/banca/accounts/${id}/disconnect`, { method: 'POST' })
}

export async function deleteBancaAccount(id) {
  return apiFetch(`/banca/accounts/${id}/delete`, { method: 'POST' })
}

export async function syncBancaAccount(id) {
  return apiFetch(`/banca/accounts/${id}/sync`, { method: 'POST' })
}

export async function importBanMovements(accountId, movements) {
  return apiFetch(`/banca/accounts/${accountId}/import-ban`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ movements: Array.isArray(movements) ? movements : [] }),
  })
}

export async function fetchBancaMovimenti(params = {}) {
  const search = new URLSearchParams()
  if (params.account_id) search.append('account_id', String(params.account_id))
  if (params.date_from) search.append('date_from', params.date_from)
  if (params.date_to) search.append('date_to', params.date_to)
  if (params.category) search.append('category', params.category)
  if (params.counterparty) search.append('counterparty', params.counterparty)
  const q = search.toString()
  return apiFetch(q ? `/banca/movimenti?${q}` : '/banca/movimenti')
}

export async function fetchBancaRiconciliazione() {
  return apiFetch('/banca/riconciliazione')
}

export async function postBancaRiconcilia(movementId, { invoice_id = null, status = 'matched' } = {}) {
  return apiFetch(`/banca/movimenti/${movementId}/riconcilia`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ invoice_id, status }),
  })
}

export function bancaApiUrl(path) {
  return apiUrl(path)
}
