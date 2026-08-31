export const MANI_PASTA_MODEL_ID = 'model-2'

export const MANI_PASTA_VIEW_OPTIONS = [
  { id: 'combined', label: 'Totale (entrambe le sedi)' },
  { id: 'via_zanardelli', label: 'Via Zanardelli (VNE)' },
  { id: 'via_abba', label: 'Via Abba (scontrini)' },
]

export function isManiPastaModel(modelId) {
  return modelId === MANI_PASTA_MODEL_ID
}

export function maniPastaViewLabel(viewId) {
  return MANI_PASTA_VIEW_OPTIONS.find((o) => o.id === viewId)?.label || String(viewId || '')
}

export function maniPastaLocationParam(viewId) {
  if (!viewId || viewId === 'combined') return undefined
  return viewId
}

const STORAGE_KEY = 'analisi:maniPastaView'

export function readStoredManiPastaView() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (MANI_PASTA_VIEW_OPTIONS.some((o) => o.id === raw)) return raw
  } catch {
    /* ignore */
  }
  return 'combined'
}

export function writeStoredManiPastaView(viewId) {
  if (!MANI_PASTA_VIEW_OPTIONS.some((o) => o.id === viewId)) return
  try {
    sessionStorage.setItem(STORAGE_KEY, viewId)
  } catch {
    /* ignore */
  }
}
