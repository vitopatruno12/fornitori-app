import { apiFetch } from './api'

export async function fetchCustomers() {
  return apiFetch('/customers/')
}
