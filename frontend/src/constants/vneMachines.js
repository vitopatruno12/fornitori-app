export const VNE_MACHINE_OPTIONS = [
  { id: 'model-1', label: 'La Risacca' },
  { id: 'model-2', label: 'Mani in Pasta' },
  { id: 'model-3', label: 'Le Mucche Volanti' },
]

const STORAGE_KEY = 'analisi:selectedMachine'

export function isVneMachineId(value) {
  return VNE_MACHINE_OPTIONS.some((m) => m.id === value)
}

export function vneMachineLabel(modelId) {
  return VNE_MACHINE_OPTIONS.find((m) => m.id === modelId)?.label || String(modelId || '')
}

export function readStoredAnalisiMachine() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (isVneMachineId(raw)) return raw
  } catch {
    /* ignore */
  }
  return VNE_MACHINE_OPTIONS[0].id
}

export function writeStoredAnalisiMachine(modelId) {
  if (!isVneMachineId(modelId)) return
  try {
    sessionStorage.setItem(STORAGE_KEY, modelId)
  } catch {
    /* ignore */
  }
}
