/** Codice numerico a 6 cifre per accesso al locale (zona personale). */

export function normalizeLocaleAccessCode(value) {
  const digits = String(value || '').replace(/\D/g, '')
  return digits.length === 6 ? digits : ''
}

export function isValidLocaleAccessCode(value) {
  return /^\d{6}$/.test(normalizeLocaleAccessCode(value))
}

export function verifyLocaleAccessCode(expected, provided) {
  const exp = normalizeLocaleAccessCode(expected)
  const got = normalizeLocaleAccessCode(provided)
  if (!exp) return isValidLocaleAccessCode(got)
  return exp === got
}

export function generateLocaleAccessCode() {
  const n = Math.floor(Math.random() * 1_000_000)
  return String(n).padStart(6, '0')
}
