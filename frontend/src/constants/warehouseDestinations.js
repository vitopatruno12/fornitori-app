/** Sedi di destinazione per prelievi merce dal magazzino (uscita). */
export const WAREHOUSE_DESTINATION_OPTIONS = [
  { value: 'Via Zardelli Mani in Pasta', label: 'Via Zardelli Mani in Pasta' },
  { value: 'Via Abba Mani in Pasta', label: 'Via Abba Mani in Pasta' },
  { value: 'Via Birago Mani in Pasta', label: 'Via Birago Mani in Pasta' },
  { value: 'Bar Momento Mucche Volanti', label: 'Bar Momento Mucche Volanti' },
]

export const WAREHOUSE_SOURCE_LABEL = 'Magazzino'

/** Se il valore salvato non è nel menu (dati vecchi), mostra comunque un’opzione coerente. */
export function warehouseDestinationOptionsWithCurrent(current) {
  const c = (current || '').trim()
  const base = [...WAREHOUSE_DESTINATION_OPTIONS]
  if (!c) return base
  if (base.some((o) => o.value === c)) return base
  return [{ value: c, label: c }, ...base]
}
