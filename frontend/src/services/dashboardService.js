import { apiFetch } from './api'

export async function fetchDashboardSummary() {
  return apiFetch('/dashboard/summary')
}
