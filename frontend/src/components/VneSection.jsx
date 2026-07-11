import React, { useEffect, useMemo, useState } from 'react'
import VneWorkbookGrid from './VneWorkbookGrid.jsx'
import VneFilterWorkbook from './VneFilterWorkbook.jsx'
import {
  VNE_CLOSINGS_COLUMNS,
  VNE_CLOSINGS_WORKBOOK_TITLE,
  VNE_KEY_VALUE_COLUMNS,
  VNE_OPERATIONS_COLUMNS,
  VNE_OPERATIONS_WORKBOOK_TITLE,
  flattenVneContabilitaRows,
  flattenVneStatusRows,
  vneClosingCellValue,
  vneClosingsTotals,
  vneClosingsTotalsLabel,
  vneKeyValueCellValue,
  vneKeyValueTotalsLabel,
  vneOperationCellValue,
  vneOperationsTotals,
  vneOperationsTotalsLabel,
} from '../utils/vneWorkbook.js'
import {
  VNE_MACHINES_COLUMNS,
  VNE_MACHINES_WORKBOOK_TITLE,
  vneMachineCellTone,
  vneMachineCellValue,
  vneMachinesTotalsLabel,
} from '../utils/vneMachinesWorkbook.js'
import {
  fetchVneModels,
  fetchVneHealth,
  fetchVneModelStatus,
  fetchVneOperationFilters,
  queryVneOperations,
  fetchVneCashClosingFilters,
  queryVneCashClosings,
  fetchVneContabilita,
  fetchVneMachinesOverview,
} from '../services/vneService'

function localInputToVneDate(value) {
  const v = String(value || '').trim()
  if (!v) return null
  const [y, m, d] = v.split('-')
  if (!y || !m || !d) return null
  return `${d}-${m}-${y} 00:00`
}

function resolveModelDisplayName(modelId, models, machineRows, apiLabel) {
  const fromApi = String(apiLabel || '').trim()
  if (fromApi) return fromApi
  const id = String(modelId || '').trim()
  if (!id) return '—'
  const fromOverview = (Array.isArray(machineRows) ? machineRows : []).find((row) => row?.model_id === id)
  const overviewName = String(fromOverview?.machine_name || '').trim()
  if (overviewName) return overviewName
  const fromModels = (Array.isArray(models) ? models : []).find((model) => model?.id === id)
  const modelLabel = String(fromModels?.label || '').trim()
  if (modelLabel) return modelLabel
  return id
}

export default function VneSection({ embedded = false }) {
  const SECTION_HOME = 'home'
  const SECTION_MACCHINE = 'macchine'
  const SECTION_CONTABILITA = 'contabilita'
  const SECTION_STATO = 'stato'
  const SECTION_OPERAZIONI = 'operazioni'
  const SECTION_CHIUSURE = 'chiusure'
  const [models, setModels] = useState([])
  const [selectedId, setSelectedId] = useState('model-1')
  const [activeSection, setActiveSection] = useState(SECTION_STATO)
  const [status, setStatus] = useState(null)
  const [loadingModels, setLoadingModels] = useState(true)
  const [loadingStatus, setLoadingStatus] = useState(false)
  const [loadingOps, setLoadingOps] = useState(false)
  const [error, setError] = useState('')
  const [opsFilters, setOpsFilters] = useState({ operations: [], users: [] })
  const [opsRows, setOpsRows] = useState([])
  const [opsFrom, setOpsFrom] = useState('')
  const [opsTo, setOpsTo] = useState('')
  const [opsSelectedTypes, setOpsSelectedTypes] = useState([])
  const [opsSelectedUsers, setOpsSelectedUsers] = useState([])
  const [closingFilters, setClosingFilters] = useState({ operators: [] })
  const [closingRows, setClosingRows] = useState([])
  const [closingFrom, setClosingFrom] = useState('')
  const [closingTo, setClosingTo] = useState('')
  const [closingOperators, setClosingOperators] = useState([])
  const [loadingClosings, setLoadingClosings] = useState(false)
  const [contabilita, setContabilita] = useState(null)
  const [loadingContabilita, setLoadingContabilita] = useState(false)
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false)
  const [autoRefreshMs, setAutoRefreshMs] = useState(60000)
  const [opsAutoRefreshEnabled, setOpsAutoRefreshEnabled] = useState(false)
  const [closingsAutoRefreshEnabled, setClosingsAutoRefreshEnabled] = useState(false)
  const [modelConnectivity, setModelConnectivity] = useState({})
  const [healthWarning, setHealthWarning] = useState('')
  const [machineRows, setMachineRows] = useState([])
  const [loadingMachines, setLoadingMachines] = useState(false)
  const [machinesUpdatedAt, setMachinesUpdatedAt] = useState('')

  const selected = useMemo(() => models.find((m) => m.id === selectedId) || null, [models, selectedId])
  const selectedDisplayName = useMemo(
    () => resolveModelDisplayName(selectedId, models, machineRows),
    [selectedId, models, machineRows],
  )
  const contabilitaRows = useMemo(() => flattenVneContabilitaRows(contabilita), [contabilita])
  const statusRows = useMemo(() => flattenVneStatusRows(status), [status])
  const operationsTotals = useMemo(() => vneOperationsTotals(opsRows), [opsRows])
  const closingsTotals = useMemo(() => vneClosingsTotals(closingRows), [closingRows])
  const machineColumns = useMemo(
    () =>
      VNE_MACHINES_COLUMNS.map((col) =>
        col.id === 'online' || col.id === 'alarm'
          ? { ...col, tone: (row) => vneMachineCellTone(row, col) }
          : col,
      ),
    [],
  )

  useEffect(() => {
    let mounted = true
    ;(async () => {
      setLoadingModels(true)
      setError('')
      try {
        const data = await fetchVneModels()
        if (!mounted) return
        setModels(Array.isArray(data) ? data : [])
        if (Array.isArray(data) && data.length > 0 && !data.some((m) => m.id === selectedId)) {
          setSelectedId(data[0].id)
        }
      } catch (e) {
        if (!mounted) return
        setError(e?.message || 'Errore caricamento modelli VNE')
      } finally {
        if (mounted) setLoadingModels(false)
      }
      fetchVneHealth()
        .then((health) => {
          if (!mounted) return
          if (!health?.credentials_configured) {
            setHealthWarning(health?.credentials_message || 'Credenziali VNE mancanti')
          } else {
            setHealthWarning('')
          }
        })
        .catch(() => {
          if (!mounted) return
          setHealthWarning('')
        })
    })()
    return () => {
      mounted = false
    }
  }, [])

  async function loadStatus(mid) {
    setLoadingStatus(true)
    setError('')
    try {
      const data = await fetchVneModelStatus(mid)
      const excerpt = String(data?.raw_excerpt || '').toLowerCase()
      const hasStatusData = hasUsableStatusData(data)
      const blockedByPortal =
        excerpt.includes('impossibile accedere alla macchina') ||
        excerpt.includes('imposible acceder a la maquina')

      if (blockedByPortal && !hasStatusData) {
        setStatus(null)
        setModelConnectivity((prev) => ({ ...prev, [mid]: 'offline' }))
        setError(
          `VNE: impossibile accedere a ${resolveModelDisplayName(mid, models, machineRows, data?.model_label)}. Verifica disponibilità macchina/connessione sul portale remoto.`,
        )
        return
      }
      setStatus(data)
      setModelConnectivity((prev) => ({ ...prev, [mid]: hasStatusData ? 'online' : 'offline' }))
    } catch (e) {
      setStatus(null)
      setModelConnectivity((prev) => ({ ...prev, [mid]: 'offline' }))
      const machineName = resolveModelDisplayName(mid, models, machineRows)
      const msg = String(e?.message || '')
      if (msg.includes('504')) {
        setError(`VNE: timeout lettura stato per ${machineName} (richiesta troppo lenta). Riprova tra qualche secondo.`)
      } else if (msg.includes('macchina non accessibile') || msg.includes('impossibile accedere')) {
        setError(`VNE: impossibile accedere a ${machineName}. Verifica disponibilità macchina/connessione sul portale remoto.`)
      } else {
        setError(msg || `Errore lettura stato VNE per ${machineName}`)
      }
    } finally {
      setLoadingStatus(false)
    }
  }

  function hasUsableStatusData(data) {
    return Boolean(
      data?.totale_eur != null ||
      data?.banconote_eur != null ||
      data?.monete_eur != null ||
      data?.contenuto_stacker_eur != null ||
      data?.totale_cassa_eur != null ||
      data?.accettatore?.presente ||
      data?.accettatore?.firmware ||
      (Array.isArray(data?.cassette) && data.cassette.length > 0) ||
      (Array.isArray(data?.stacker_banconote) && data.stacker_banconote.length > 0) ||
      (Array.isArray(data?.monete_dettaglio) && data.monete_dettaglio.length > 0) ||
      data?.hopper?.smart_hopper_1_eur ||
      data?.hopper?.firmware ||
      (Array.isArray(data?.hopper?.monete) && data.hopper.monete.length > 0) ||
      (Array.isArray(data?.hopper?.units) && data.hopper.units.length > 0),
    )
  }

  async function loadOperationFilters(mid) {
    try {
      const data = await fetchVneOperationFilters(mid)
      setOpsFilters({
        operations: Array.isArray(data?.operations) ? data.operations : [],
        users: Array.isArray(data?.users) ? data.users : [],
      })
      setOpsSelectedTypes([])
      setOpsSelectedUsers([])
    } catch {
      setOpsFilters({ operations: [], users: [] })
    }
  }

  async function runOperationsQuery(mid) {
    setLoadingOps(true)
    setError('')
    try {
      const data = await queryVneOperations(mid, {
        init_day_date: localInputToVneDate(opsFrom),
        end_day_date: localInputToVneDate(opsTo),
        operations: opsSelectedTypes,
        users: opsSelectedUsers,
      })
      setOpsRows(Array.isArray(data?.rows) ? data.rows : [])
    } catch (e) {
      setOpsRows([])
      setError(e?.message || 'Errore lettura operazioni VNE')
    } finally {
      setLoadingOps(false)
    }
  }

  async function loadCashClosingFilters(mid) {
    try {
      const data = await fetchVneCashClosingFilters(mid)
      setClosingFilters({ operators: Array.isArray(data?.operators) ? data.operators : [] })
      setClosingOperators([])
    } catch {
      setClosingFilters({ operators: [] })
    }
  }

  async function runCashClosingQuery(mid) {
    setLoadingClosings(true)
    setError('')
    try {
      const data = await queryVneCashClosings(mid, {
        init_day_date: localInputToVneDate(closingFrom),
        end_day_date: localInputToVneDate(closingTo),
        operators: closingOperators,
      })
      setClosingRows(Array.isArray(data?.rows) ? data.rows : [])
    } catch (e) {
      setClosingRows([])
      setError(e?.message || 'Errore lettura chiusure VNE')
    } finally {
      setLoadingClosings(false)
    }
  }

  async function loadContabilita(mid) {
    setLoadingContabilita(true)
    setError('')
    try {
      const data = await fetchVneContabilita(mid)
      setContabilita(data || null)
    } catch (e) {
      setContabilita(null)
      setError(e?.message || 'Errore lettura contabilita VNE')
    } finally {
      setLoadingContabilita(false)
    }
  }

  async function loadMachinesOverview() {
    setLoadingMachines(true)
    setError('')
    try {
      const data = await fetchVneMachinesOverview()
      const rows = Array.isArray(data?.rows) ? data.rows : []
      setMachineRows(rows)
      setMachinesUpdatedAt(data?.updated_at || '')
      setModelConnectivity((prev) => {
        const next = { ...prev }
        for (const row of rows) {
          if (!row?.model_id) continue
          next[row.model_id] = String(row.online || '').toLowerCase() === 'online' ? 'online' : 'offline'
        }
        return next
      })
    } catch (e) {
      setMachineRows([])
      setError(e?.message || 'Errore lettura stato macchine VNE')
    } finally {
      setLoadingMachines(false)
    }
  }

  function openMachineFromOverview(row) {
    if (!row?.model_id) return
    setSelectedId(row.model_id)
    setActiveSection(SECTION_STATO)
  }

  useEffect(() => {
    if (!selectedId) return
    loadStatus(selectedId)
    setOpsRows([])
    setClosingRows([])
    setOpsFilters({ operations: [], users: [] })
    setClosingFilters({ operators: [] })
    setContabilita(null)
    setOpsAutoRefreshEnabled(false)
    setClosingsAutoRefreshEnabled(false)
    setActiveSection(SECTION_STATO)
  }, [selectedId])

  useEffect(() => {
    if (!selectedId || !selected) return
    if (activeSection === SECTION_MACCHINE) {
      loadMachinesOverview()
      return
    }
    if (activeSection === SECTION_CONTABILITA && selected.contabilita_url) {
      loadContabilita(selectedId)
      return
    }
    if (activeSection === SECTION_OPERAZIONI && selected.sel_operazioni_url) {
      loadOperationFilters(selectedId)
      return
    }
    if (activeSection === SECTION_CHIUSURE && selected.sel_chiusure_url) {
      loadCashClosingFilters(selectedId)
    }
  }, [activeSection, selectedId, selected])

  useEffect(() => {
    if (!selectedId || !autoRefreshEnabled) return undefined
    const tick = () => {
      loadStatus(selectedId)
      if (activeSection === SECTION_MACCHINE) loadMachinesOverview()
      if (opsAutoRefreshEnabled) runOperationsQuery(selectedId)
      if (closingsAutoRefreshEnabled) runCashClosingQuery(selectedId)
      if (activeSection === SECTION_CONTABILITA) loadContabilita(selectedId)
    }
    const timer = window.setInterval(tick, autoRefreshMs)
    return () => window.clearInterval(timer)
  }, [selectedId, autoRefreshEnabled, autoRefreshMs, opsAutoRefreshEnabled, closingsAutoRefreshEnabled, activeSection])

  useEffect(() => {
    if (!Array.isArray(models) || models.length === 0) return
    // Non bombardare il backend con verifiche parallele su tutti i modelli:
    // inizializziamo lo stato e verifichiamo il modello quando viene aperto.
    setModelConnectivity((prev) => {
      const next = { ...prev }
      for (const m of models) {
        if (!m?.id || !m?.configured) continue
        if (!next[m.id]) next[m.id] = 'offline'
      }
      return next
    })
  }, [models])

  return (
    <div className="vne-legacy-skin">
      {!embedded && (
        <>
          <h1 className="page-header">VNE Cassa Automatica</h1>
          <p style={{ color: 'var(--text-muted)', marginTop: '-0.35rem' }}>
            Sezione modelli VNE (3 slot). Il primo modello è collegato all&apos;endpoint stato remoto.
          </p>
        </>
      )}

      {error && <div className="alert alert-danger">{error}</div>}
      {healthWarning && <div className="alert alert-warning">{healthWarning}</div>}

      <section className="card vne-chiusure-style">
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.65rem' }}>
          <h2 className="page-subheader" style={{ margin: 0 }}>Sincronizzazione VNE</h2>
          <div className="btn-group" style={{ margin: 0 }}>
            <button
              type="button"
              className={autoRefreshEnabled ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
              onClick={() => setAutoRefreshEnabled((v) => !v)}
            >
              {autoRefreshEnabled ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
            </button>
            <select
              className="form-control"
              value={String(autoRefreshMs)}
              onChange={(e) => setAutoRefreshMs(Number(e.target.value))}
              style={{ minWidth: 110 }}
            >
              <option value="30000">30 sec</option>
              <option value="60000">60 sec</option>
              <option value="120000">120 sec</option>
            </select>
          </div>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: 0 }}>
          Quando attivo, aggiorna automaticamente lo stato; puoi includere anche Operazioni e Chiusure dopo una prima ricerca manuale.
        </p>
      </section>

      <section className="card">
        <h2 className="page-subheader" style={{ marginTop: 0 }}>Modelli VNE</h2>
        {loadingModels ? (
          <p className="loading">Caricamento modelli…</p>
        ) : (
          <div className="support-tech-grid">
            {models.map((m) => (
              <article key={m.id} className="support-tech-card">
                <div className="support-tech-card-head">
                  <h3 className="support-tech-name">{m.label}</h3>
                </div>
                <div style={{ marginBottom: '0.4rem' }}>
                  <span
                    style={{
                      display: 'inline-block',
                      padding: '0.2rem 0.55rem',
                      borderRadius: 999,
                      fontSize: '0.74rem',
                      fontWeight: 700,
                      letterSpacing: '0.02em',
                      background:
                        modelConnectivity[m.id] === 'online'
                          ? 'rgba(22, 163, 74, 0.16)'
                          : modelConnectivity[m.id] === 'offline'
                            ? 'rgba(220, 38, 38, 0.16)'
                            : 'rgba(100, 116, 139, 0.18)',
                      color:
                        modelConnectivity[m.id] === 'online'
                          ? '#166534'
                          : modelConnectivity[m.id] === 'offline'
                            ? '#991b1b'
                            : '#334155',
                      border:
                        modelConnectivity[m.id] === 'online'
                          ? '1px solid rgba(22, 163, 74, 0.35)'
                          : modelConnectivity[m.id] === 'offline'
                            ? '1px solid rgba(220, 38, 38, 0.35)'
                            : '1px solid rgba(100, 116, 139, 0.35)',
                    }}
                    title="Stato connessione stimato dal controllo endpoint stato"
                  >
                    {modelConnectivity[m.id] === 'online'
                      ? 'Online'
                      : modelConnectivity[m.id] === 'offline'
                        ? 'Offline'
                        : 'Verifica...'}
                  </span>
                </div>
                <div className="support-tech-actions">
                  <button
                    type="button"
                    className={selectedId === m.id ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
                    onClick={() => setSelectedId(m.id)}
                  >
                    {selectedId === m.id ? 'Attivo' : 'Apri modello'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="card vne-chiusure-style">
        <div className="vne-legacy-shell">
          <div className="vne-section-nav">
            <button type="button" className={activeSection === SECTION_HOME ? 'vne-nav-btn is-active' : 'vne-nav-btn'} onClick={() => setActiveSection(SECTION_HOME)}>
              Home
            </button>
            <button type="button" className={activeSection === SECTION_MACCHINE ? 'vne-nav-btn is-active' : 'vne-nav-btn'} onClick={() => setActiveSection(SECTION_MACCHINE)}>
              Stato macchine
            </button>
            <button type="button" className={activeSection === SECTION_CONTABILITA ? 'vne-nav-btn is-active' : 'vne-nav-btn'} onClick={() => setActiveSection(SECTION_CONTABILITA)}>
              Contabilita
            </button>
            <button type="button" className={activeSection === SECTION_STATO ? 'vne-nav-btn is-active' : 'vne-nav-btn'} onClick={() => setActiveSection(SECTION_STATO)}>
              Stato
            </button>
            <button type="button" className={activeSection === SECTION_OPERAZIONI ? 'vne-nav-btn is-active' : 'vne-nav-btn'} onClick={() => setActiveSection(SECTION_OPERAZIONI)}>
              Operazioni
            </button>
            <button type="button" className={activeSection === SECTION_CHIUSURE ? 'vne-nav-btn is-active' : 'vne-nav-btn'} onClick={() => setActiveSection(SECTION_CHIUSURE)}>
              Chiusure casse
            </button>
          </div>
          {activeSection === SECTION_HOME && (
            <p className="vne-chiusure-hint" style={{ marginTop: '0.45rem' }}>
              Macchina attiva: <strong>{selectedDisplayName}</strong>. Clicca una sezione per aprire la relativa scheda.
            </p>
          )}
        </div>
      </section>

      {activeSection === SECTION_MACCHINE && (
      <section className="card vne-chiusure-style vne-machines-style">
        <div className="vne-legacy-header">
          <h2 className="page-subheader" style={{ margin: 0 }}>Stato macchine</h2>
          <div className="vne-legacy-logo" aria-hidden />
        </div>
        <div className="vne-legacy-shell vne-machines-overview">
          <div className="vne-legacy-menu-row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setActiveSection(SECTION_HOME)}>
              Home
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => loadMachinesOverview()} disabled={loadingMachines}>
              {loadingMachines ? 'Aggiornamento…' : 'Aggiorna elenco'}
            </button>
          </div>
          {machinesUpdatedAt ? (
            <p className="vne-chiusure-hint" style={{ marginTop: '0.35rem' }}>
              Ultimo aggiornamento remoto · {machinesUpdatedAt}
            </p>
          ) : null}
          <VneWorkbookGrid
            title={VNE_MACHINES_WORKBOOK_TITLE}
            sheetLabel={
              loadingMachines
                ? 'Caricamento…'
                : machineRows.length > 0
                  ? `${machineRows.length} macchine`
                  : 'Nessuna macchina'
            }
            columns={machineColumns}
            rows={machineRows}
            cellValue={vneMachineCellValue}
            totalsLabel={(columnId) => vneMachinesTotalsLabel(columnId, machineRows)}
            totals={machineRows}
            gridClassName="vne-machines-grid"
            loading={loadingMachines}
            emptyMessage="Nessuna macchina VNE configurata."
            rowKey={(row) => row.model_id}
            onRowClick={openMachineFromOverview}
            getRowClassName={() => 'pn-row-click'}
            getCellTitle={(row, col) => (col.id === 'levels' || col.id === 'alarm' ? String(row[col.id] || '') : '')}
          />
          <p className="vne-chiusure-hint" style={{ marginTop: '0.55rem' }}>
            Clicca una riga per aprire lo <strong>Stato</strong> della macchina selezionata.
          </p>
        </div>
      </section>
      )}

      {activeSection === SECTION_CONTABILITA && (
      <section className="card vne-chiusure-style vne-contabilita-style">
        <div className="vne-legacy-header">
          <h2 className="page-subheader" style={{ margin: 0 }}>Contabilita</h2>
          <div className="vne-legacy-logo" aria-hidden />
        </div>
        <div className="vne-legacy-shell vne-contabilita-shell">
          <div className="vne-legacy-menu-row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setActiveSection(SECTION_HOME)}>
              Home
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => loadContabilita(selectedId)} disabled={loadingContabilita || !selectedId}>
              {loadingContabilita ? 'Aggiornamento…' : 'Aggiorna'}
            </button>
          </div>
          {!selected?.contabilita_url && (
            <p className="empty-state">Contabilita non configurata per questo modello.</p>
          )}
          {loadingContabilita && <p className="loading">Caricamento contabilita…</p>}
          {!selected?.contabilita_url ? null : !loadingContabilita && !contabilita && (
            <p className="empty-state">Nessun dato contabilita disponibile.</p>
          )}
          {!selected?.contabilita_url ? null : !loadingContabilita && contabilita && (
            <VneWorkbookGrid
              title="Contabilità"
              sheetLabel={`${contabilitaRows.length} righe · ${selectedDisplayName}`}
              columns={VNE_KEY_VALUE_COLUMNS}
              rows={contabilitaRows}
              cellValue={vneKeyValueCellValue}
              totalsLabel={vneKeyValueTotalsLabel}
              totals={contabilitaRows.length}
              gridClassName="vne-contabilita-grid"
              emptyMessage="Nessun dato contabilità disponibile."
            />
          )}
          {!loadingContabilita && contabilita?.updated_at_text && (
            <p className="vne-chiusure-hint" style={{ marginTop: '0.65rem' }}>
              V.N.E. Sistema di controllo remoto · {contabilita.updated_at_text}
            </p>
          )}
        </div>
      </section>
      )}

      {activeSection === SECTION_STATO && (
      <section className="card vne-chiusure-style vne-status-style">
        <div className="vne-legacy-header">
          <h2 className="page-subheader" style={{ margin: 0 }}>Stato</h2>
          <div className="vne-legacy-logo" aria-hidden />
        </div>
        <div className="vne-legacy-shell">
          <div className="vne-legacy-menu-row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setActiveSection(SECTION_HOME)}>
              Home
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => loadStatus(selectedId)} disabled={loadingStatus || !selectedId}>
              {loadingStatus ? 'Aggiornamento…' : 'Aggiorna'}
            </button>
          </div>
          <p className="vne-chiusure-hint" style={{ marginTop: '0.35rem' }}>
            Macchina: <strong>{selectedDisplayName}</strong>
          </p>
          {!status && !loadingStatus && <p className="empty-state">Nessun dato disponibile.</p>}
          {loadingStatus && <p className="loading">Lettura stato da VNE…</p>}

          {status && (
            <VneWorkbookGrid
              title={status.title || 'Stato'}
              sheetLabel={`${statusRows.length} attributi · ${selectedDisplayName}`}
              columns={VNE_KEY_VALUE_COLUMNS}
              rows={statusRows}
              cellValue={vneKeyValueCellValue}
              totalsLabel={vneKeyValueTotalsLabel}
              totals={statusRows.length}
              gridClassName="vne-status-grid"
              emptyMessage="Nessun dato stato disponibile."
            />
          )}
          {status?.updated_at_text && (
            <p className="vne-chiusure-hint" style={{ marginTop: '0.65rem' }}>
              V.N.E. Sistema di controllo remoto · {status.updated_at_text}
            </p>
          )}
        </div>
      </section>
      )}

      {activeSection === SECTION_OPERAZIONI && (
      <section className="card vne-chiusure-style vne-operations-style">
        <div className="vne-legacy-header">
          <h2 className="page-subheader" style={{ margin: 0 }}>Operazioni</h2>
          <div className="vne-legacy-logo" aria-hidden />
        </div>
        <div className="vne-legacy-shell">
          <VneFilterWorkbook
            title="Filtri operazioni"
            sheetLabel={`Macchina: ${selectedDisplayName} · formato dd-mm-yyyy hh:mm`}
            gridClassName="vne-operations-filter-grid"
            fields={[
              {
                id: 'from',
                label: 'Data inizio',
                width: 14,
                fluid: true,
                render: () => (
                  <input
                    type="date"
                    className="excel-cell vne-filter-input"
                    value={opsFrom}
                    onChange={(e) => setOpsFrom(e.target.value)}
                    aria-label="Data inizio"
                  />
                ),
              },
              {
                id: 'type',
                label: 'Tipo operazione',
                width: 22,
                fluid: true,
                render: () => (
                  <select
                    className="excel-cell vne-filter-input vne-filter-select"
                    multiple
                    value={opsSelectedTypes}
                    onChange={(e) => setOpsSelectedTypes(Array.from(e.target.selectedOptions).map((o) => o.value))}
                    aria-label="Tipo operazione"
                    disabled={opsFilters.operations.length === 0}
                  >
                    {opsFilters.operations.map((v) => (
                      <option key={v || 'blank-op'} value={v}>{v || '(vuoto)'}</option>
                    ))}
                  </select>
                ),
              },
              {
                id: 'to',
                label: 'Data fine',
                width: 14,
                fluid: true,
                render: () => (
                  <input
                    type="date"
                    className="excel-cell vne-filter-input"
                    value={opsTo}
                    onChange={(e) => setOpsTo(e.target.value)}
                    aria-label="Data fine"
                  />
                ),
              },
              {
                id: 'user',
                label: 'Utente',
                width: 16,
                fluid: true,
                render: () => (
                  <select
                    className="excel-cell vne-filter-input vne-filter-select"
                    multiple
                    value={opsSelectedUsers}
                    onChange={(e) => setOpsSelectedUsers(Array.from(e.target.selectedOptions).map((o) => o.value))}
                    aria-label="Utente"
                    disabled={opsFilters.users.length === 0}
                  >
                    {opsFilters.users.map((u) => (
                      <option key={u || 'blank-user'} value={u}>{u || '(vuoto)'}</option>
                    ))}
                  </select>
                ),
              },
              {
                id: 'home',
                label: 'Home',
                width: 10,
                fluid: true,
                action: true,
                render: () => (
                  <button type="button" className="btn btn-secondary btn-sm vne-filter-btn" onClick={() => setActiveSection(SECTION_HOME)}>
                    Home
                  </button>
                ),
              },
              {
                id: 'search',
                label: 'Cerca operazioni',
                width: 12,
                fluid: true,
                action: true,
                render: () => (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm vne-filter-btn"
                    onClick={() => runOperationsQuery(selectedId)}
                    disabled={loadingOps || !selectedId || !selected?.sel_operazioni_url}
                  >
                    {loadingOps ? 'Ricerca…' : 'Cerca operazioni'}
                  </button>
                ),
              },
              {
                id: 'auto',
                label: 'Auto OFF',
                width: 12,
                fluid: true,
                action: true,
                render: () => (
                  <button
                    type="button"
                    className={opsAutoRefreshEnabled ? 'btn btn-primary btn-sm vne-filter-btn' : 'btn btn-secondary btn-sm vne-filter-btn'}
                    onClick={() => setOpsAutoRefreshEnabled((v) => !v)}
                    disabled={!autoRefreshEnabled}
                    title={!autoRefreshEnabled ? 'Attiva prima auto-refresh globale' : 'Aggiorna automaticamente questa tabella ai prossimi tick'}
                  >
                    {opsAutoRefreshEnabled ? 'Auto ON' : 'Auto OFF'}
                  </button>
                ),
              },
            ]}
          />
          {!selected?.sel_operazioni_url && (
            <p className="empty-state">Operazioni non configurate per questo modello.</p>
          )}
          {(loadingOps || opsRows.length > 0 || selected?.sel_operazioni_url) && (
            <VneWorkbookGrid
              title={VNE_OPERATIONS_WORKBOOK_TITLE}
              sheetLabel={
                loadingOps
                  ? 'Caricamento…'
                  : opsRows.length > 0
                    ? `${opsRows.length} operazioni`
                    : 'Nessuna operazione'
              }
              columns={VNE_OPERATIONS_COLUMNS}
              rows={opsRows}
              cellValue={vneOperationCellValue}
              totalsLabel={vneOperationsTotalsLabel}
              totals={operationsTotals}
              gridClassName="vne-operations-grid"
              loading={loadingOps}
              emptyMessage={
                !selected?.sel_operazioni_url
                  ? 'Operazioni non configurate per questo modello.'
                  : 'Nessuna operazione caricata. Imposta i filtri e premi «Cerca operazioni».'
              }
            />
          )}
        </div>
      </section>
      )}

      {activeSection === SECTION_CHIUSURE && (
      <section className="card vne-chiusure-style vne-closings-style">
        <div className="vne-legacy-header">
          <h2 className="page-subheader" style={{ margin: 0 }}>Chiusure di cassa</h2>
          <div className="vne-legacy-logo" aria-hidden />
        </div>
        <div className="vne-legacy-shell">
          <VneFilterWorkbook
            title="Filtri chiusure di cassa"
            sheetLabel={`Macchina: ${selectedDisplayName} · formato dd-mm-yyyy hh:mm`}
            gridClassName="vne-closings-filter-grid"
            fields={[
              {
                id: 'from',
                label: 'Data inizio',
                width: 16,
                fluid: true,
                render: () => (
                  <input
                    type="date"
                    className="excel-cell vne-filter-input"
                    value={closingFrom}
                    onChange={(e) => setClosingFrom(e.target.value)}
                    aria-label="Data inizio"
                  />
                ),
              },
              {
                id: 'to',
                label: 'Data fine',
                width: 16,
                fluid: true,
                render: () => (
                  <input
                    type="date"
                    className="excel-cell vne-filter-input"
                    value={closingTo}
                    onChange={(e) => setClosingTo(e.target.value)}
                    aria-label="Data fine"
                  />
                ),
              },
              {
                id: 'operator',
                label: 'Operatore',
                width: 24,
                fluid: true,
                render: () => (
                  <select
                    className="excel-cell vne-filter-input vne-filter-select"
                    multiple
                    value={closingOperators}
                    onChange={(e) => setClosingOperators(Array.from(e.target.selectedOptions).map((o) => o.value))}
                    aria-label="Operatore"
                    disabled={closingFilters.operators.length === 0}
                  >
                    {closingFilters.operators.map((o) => (
                      <option key={o || 'blank-opr'} value={o}>{o || '(vuoto)'}</option>
                    ))}
                  </select>
                ),
              },
              {
                id: 'home',
                label: 'Home',
                width: 11,
                fluid: true,
                action: true,
                render: () => (
                  <button type="button" className="btn btn-secondary btn-sm vne-filter-btn" onClick={() => setActiveSection(SECTION_HOME)}>
                    Home
                  </button>
                ),
              },
              {
                id: 'search',
                label: 'Cerca chiusure',
                width: 14,
                fluid: true,
                action: true,
                render: () => (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm vne-filter-btn"
                    onClick={() => runCashClosingQuery(selectedId)}
                    disabled={loadingClosings || !selectedId || !selected?.sel_chiusure_url}
                  >
                    {loadingClosings ? 'Ricerca…' : 'Cerca chiusure'}
                  </button>
                ),
              },
              {
                id: 'auto',
                label: 'Auto OFF',
                width: 12,
                fluid: true,
                action: true,
                render: () => (
                  <button
                    type="button"
                    className={closingsAutoRefreshEnabled ? 'btn btn-primary btn-sm vne-filter-btn' : 'btn btn-secondary btn-sm vne-filter-btn'}
                    onClick={() => setClosingsAutoRefreshEnabled((v) => !v)}
                    disabled={!autoRefreshEnabled}
                    title={!autoRefreshEnabled ? 'Attiva prima auto-refresh globale' : 'Aggiorna automaticamente questa tabella ai prossimi tick'}
                  >
                    {closingsAutoRefreshEnabled ? 'Auto ON' : 'Auto OFF'}
                  </button>
                ),
              },
            ]}
          />
          {!selected?.sel_chiusure_url && (
            <p className="empty-state">Chiusure non configurate per questo modello.</p>
          )}
          {(loadingClosings || closingRows.length > 0 || selected?.sel_chiusure_url) && (
            <VneWorkbookGrid
              title={VNE_CLOSINGS_WORKBOOK_TITLE}
              sheetLabel={
                loadingClosings
                  ? 'Caricamento…'
                  : closingRows.length > 0
                    ? `${closingRows.length} chiusure`
                    : 'Nessuna chiusura'
              }
              columns={VNE_CLOSINGS_COLUMNS}
              rows={closingRows}
              cellValue={vneClosingCellValue}
              totalsLabel={vneClosingsTotalsLabel}
              totals={closingsTotals}
              gridClassName="vne-closings-grid"
              loading={loadingClosings}
              emptyMessage={
                !selected?.sel_chiusure_url
                  ? 'Chiusure non configurate per questo modello.'
                  : 'Nessuna chiusura caricata. Imposta i filtri e premi «Cerca chiusure».'
              }
            />
          )}
        </div>
      </section>
      )}
    </div>
  )
}
