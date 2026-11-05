import { apiFetch } from './api'

function slotQuery(date, fascia) {
  const params = new URLSearchParams({ date: String(date || ''), fascia: String(fascia || '') })
  return `/gazza-sala?${params.toString()}`
}

export function fetchGazzaSala(date, fascia) {
  return apiFetch(slotQuery(date, fascia), { cache: 'no-store' })
}

export function saveGazzaSalaRow(date, fascia, row) {
  return apiFetch('/gazza-sala/tavolo', {
    method: 'PUT',
    body: JSON.stringify({ date, fascia, row }),
  })
}

export function markGazzaSalaPaid(date, fascia, tableId) {
  return apiFetch('/gazza-sala/pagato', {
    method: 'POST',
    body: JSON.stringify({ date, fascia, table_id: tableId }),
  })
}

export function resetGazzaSala(date, fascia) {
  return apiFetch('/gazza-sala/azzera', {
    method: 'POST',
    body: JSON.stringify({ date, fascia }),
  })
}

export function importGazzaSala(date, fascia, tables, history) {
  return apiFetch('/gazza-sala/importa', {
    method: 'POST',
    body: JSON.stringify({ date, fascia, tables, history }),
  })
}
