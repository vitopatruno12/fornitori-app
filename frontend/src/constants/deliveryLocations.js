/** Destinazioni scarico / spedizione comuni (ordini e consegne). */
export const DELIVERY_LOCATION_OPTIONS = [
  { value: '', label: 'Non specificata' },
  { value: 'Magazzino', label: 'Magazzino' },
  { value: 'Via Zardelli Mani in Pasta', label: 'Via Zardelli Mani in Pasta' },
  { value: 'Via Abba Mani in Pasta', label: 'Via Abba Mani in Pasta' },
  { value: 'Via Birago Mani in Pasta', label: 'Via Birago Mani in Pasta' },
  { value: 'Bar Momento Mucche Volanti', label: 'Bar Momento Mucche Volanti' },
]

/** Se il valore salvato non è nel menu (dati vecchi), mostra comunque un’opzione coerente. */
export function deliveryLocationOptionsWithCurrent(current) {
  const c = (current || '').trim()
  const base = [...DELIVERY_LOCATION_OPTIONS]
  if (!c) return base
  if (base.some((o) => o.value === c)) return base
  return [base[0], { value: c, label: c }, ...base.slice(1)]
}
