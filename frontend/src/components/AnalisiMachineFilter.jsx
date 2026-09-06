import React from 'react'
import {
  VNE_MACHINE_OPTIONS,
  readStoredAnalisiMachine,
  vneMachineLabel,
  writeStoredAnalisiMachine,
} from '../constants/vneMachines.js'
import {
  isManiPastaModel,
  readStoredManiPastaView,
  writeStoredManiPastaView,
} from '../constants/maniPastaLocations.js'

export function useAnalisiMachineFilter() {
  const [modelId, setModelIdState] = React.useState(() => readStoredAnalisiMachine())
  const [maniViewId, setManiViewIdState] = React.useState(() => readStoredManiPastaView())

  const setModelId = React.useCallback((next) => {
    setModelIdState(next)
    writeStoredAnalisiMachine(next)
  }, [])

  const setManiViewId = React.useCallback((next) => {
    setManiViewIdState(next)
    writeStoredManiPastaView(next)
  }, [])

  // Zanardelli non è più sottofilter: Mani = sempre Via Abba
  const location = isManiPastaModel(modelId) ? 'via_abba' : undefined
  const machineLabel = vneMachineLabel(modelId)

  return {
    modelId,
    setModelId,
    maniViewId,
    setManiViewId,
    location,
    machineLabel,
  }
}

export function AnalisiMachineSelect({ value, onChange, disabled = false, id = 'analisi-machine-select' }) {
  return (
    <div className="analisi-machine-filter">
      <label htmlFor={id}>Locale / macchina</label>
      <select
        id={id}
        className="form-control analisi-machine-filter-select"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {VNE_MACHINE_OPTIONS.map((machine) => (
          <option key={machine.id} value={machine.id}>
            {machine.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function AnalisiTrendToolbar({
  modelId,
  onModelChange,
  onRefresh,
  refreshing = false,
  loading = false,
  selectId,
}) {
  const busy = refreshing || loading
  return (
    <aside className="analisi-hero-tools" aria-label="Filtri analisi">
      <AnalisiMachineSelect
        id={selectId}
        value={modelId}
        onChange={onModelChange}
        disabled={busy}
      />
      <button type="button" className="btn btn-primary btn-sm" onClick={onRefresh} disabled={busy}>
        {busy ? 'Aggiorno…' : 'Aggiorna ora'}
      </button>
    </aside>
  )
}

export { vneMachineLabel }
