import { apiFetch } from './api'

export async function fetchManagerInsights() {
  return apiFetch('/ai/manager/insights')
}
