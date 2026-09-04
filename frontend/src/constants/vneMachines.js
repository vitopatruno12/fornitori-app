export const VNE_MACHINE_OPTIONS = [
  { id: 'model-1', label: 'La Risacca' },
  { id: 'model-2', label: 'Mani in Pasta (Via Abba)' },
  { id: 'model-3', label: 'Le Mucche Volanti (Via Lattea)' },
  { id: 'model-4', label: 'Mani in Pasta (Via Zanardelli)' },
  { id: 'model-5', label: 'Gazza Ladra' },
]

/** Solo macchine VNE reali (semaforo / collegamento portale). */
export const VNE_CONNECTED_MACHINE_IDS = ['model-1', 'model-2', 'model-3']

export const ZANARDELLI_MODEL_ID = 'model-4'
export const GAZZA_LADRA_MODEL_ID = 'model-5'

export function isVneMachineId(value) {
  return VNE_MACHINE_OPTIONS.some((m) => m.id === value)
}

export function isGazzaLadraModel(modelId) {
  return modelId === GAZZA_LADRA_MODEL_ID
}

export function isZanardelliModel(modelId) {
  return modelId === ZANARDELLI_MODEL_ID
}

export function vneMachineLabel(modelId) {
  return VNE_MACHINE_OPTIONS.find((m) => m.id === modelId)?.label || String(modelId || '')
}

const STORAGE_KEY = 'analisi:selectedMachine'

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
