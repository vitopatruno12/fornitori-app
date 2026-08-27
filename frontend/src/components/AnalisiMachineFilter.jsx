import React from 'react'
import {
  VNE_MACHINE_OPTIONS,
  readStoredAnalisiMachine,
  vneMachineLabel,
  writeStoredAnalisiMachine,
} from '../constants/vneMachines.js'

export function useAnalisiMachineFilter() {
  const [modelId, setModelIdState] = React.useState(() => readStoredAnalisiMachine())

  const setModelId = React.useCallback((next) => {
    setModelIdState(next)
    writeStoredAnalisiMachine(next)
  }, [])

  return {
    modelId,
    setModelId,
    machineLabel: vneMachineLabel(modelId),
  }
}

export function AnalisiMachineSelect({ value, onChange, disabled = false, id = 'analisi-machine-select' }) {
  return (
    <div className="analisi-machine-filter">
      <label htmlFor={id}>Dati macchina VNE</label>
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
  return (
    <div className="analisi-trend-toolbar">
      <AnalisiMachineSelect
        id={selectId}
        value={modelId}
        onChange={onModelChange}
        disabled={refreshing || loading}
      />
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
