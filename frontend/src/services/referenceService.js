import { apiFetch } from './api'

export async function fetchAccounts() {
  return apiFetch('/reference/accounts')
}

export async function fetchPaymentMethods() {
  return apiFetch('/reference/payment-methods')
}

export async function fetchCategories() {
  return apiFetch('/reference/categories')
}
