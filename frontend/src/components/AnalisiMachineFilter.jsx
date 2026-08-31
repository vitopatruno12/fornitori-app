import React from 'react'
import {
  VNE_MACHINE_OPTIONS,
  readStoredAnalisiMachine,
  vneMachineLabel,
  writeStoredAnalisiMachine,
} from '../constants/vneMachines.js'
import {
  isManiPastaModel,
  MANI_PASTA_VIEW_OPTIONS,
  maniPastaLocationParam,
  maniPastaViewLabel,
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

  const location = isManiPastaModel(modelId) ? maniPastaLocationParam(maniViewId) : undefined
  const machineLabel = isManiPastaModel(modelId)
    ? maniPastaViewLabel(maniViewId).replace('Totale (entrambe le sedi)', 'Mani in Pasta')
    : vneMachineLabel(modelId)

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

export function ManiPastaViewSelect({ value, onChange, disabled = false, id = 'analisi-mani-view-select' }) {
  return (
    <div className="analisi-machine-filter analisi-mani-location-filter">
      <label htmlFor={id}>Mostra sede</label>
      <select
        id={id}
        className="form-control analisi-machine-filter-select"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {MANI_PASTA_VIEW_OPTIONS.map((opt) => (
          <option key={opt.id} value={opt.id}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function AnalisiTrendToolbar({
  modelId,
  onModelChange,
  maniViewId,
  onManiViewChange,
  onRefresh,
  refreshing = false,
  loading = false,
  selectId,
  maniSelectId,
}) {
  return (
    <div className="analisi-trend-toolbar">
      <AnalisiMachineSelect
        id={selectId}
        value={modelId}
        onChange={onModelChange}
        disabled={refreshing || loading}
      />
      {isManiPastaModel(modelId) ? (
        <ManiPastaViewSelect
          id={maniSelectId}
          value={maniViewId || 'combined'}
          onChange={onManiViewChange}
          disabled={refreshing || loading}
        />
      ) : null}
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        onClick={onRefresh}
        disabled={refreshing || loading}
      >
        {refreshing || loading ? 'Aggiorno…' : 'Aggiorna ora'}
      </button>
    </div>
  )
}

export { vneMachineLabel }
