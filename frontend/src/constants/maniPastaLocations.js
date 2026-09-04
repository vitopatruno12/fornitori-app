export const MANI_PASTA_MODEL_ID = 'model-2'

/** @deprecated Zanardelli è scheda dedicata (model-4); non più nel menu Mani. */
export const MANI_PASTA_VIEW_OPTIONS = [{ id: 'via_abba', label: 'Via Abba' }]

export function isManiPastaModel(modelId) {
  return modelId === MANI_PASTA_MODEL_ID
}

export function maniPastaViewLabel(viewId) {
  return MANI_PASTA_VIEW_OPTIONS.find((o) => o.id === viewId)?.label || 'Mani in Pasta (Via Abba)'
}

export function maniPastaLocationParam(viewId) {
  // Sempre Abba: Zanardelli non è più sottofilter di Mani
  void viewId
  return 'via_abba'
}

const STORAGE_KEY = 'analisi:maniPastaView'

export function readStoredManiPastaView() {
  return 'via_abba'
}

export function writeStoredManiPastaView(viewId) {
  void viewId
  try {
    sessionStorage.setItem(STORAGE_KEY, 'via_abba')
  } catch {
    /* ignore */
  }
}
