/** Destinazioni scarico / spedizione comuni (ordini e consegne). */
export const DELIVERY_LOCATION_OPTIONS = [
  { value: '', label: 'Non specificata' },
  { value: 'Via Abba', label: 'Via Abba' },
  { value: 'Via Zanardelli', label: 'Via Zanardelli' },
  { value: 'Santa Caterina bar', label: 'Santa Caterina bar' },
]

/** Se il valore salvato non è nel menu (dati vecchi), mostra comunque un’opzione coerente. */
export function deliveryLocationOptionsWithCurrent(current) {
  const c = (current || '').trim()
  const base = [...DELIVERY_LOCATION_OPTIONS]
  if (!c) return base
  if (base.some((o) => o.value === c)) return base
  return [base[0], { value: c, label: c }, ...base.slice(1)]
}
