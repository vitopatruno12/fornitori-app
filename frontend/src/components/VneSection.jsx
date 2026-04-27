import React, { useEffect, useMemo, useState } from 'react'
import {
  fetchVneModels,
  fetchVneModelStatus,
  fetchVneOperationFilters,
  queryVneOperations,
  fetchVneCashClosingFilters,
  queryVneCashClosings,
  fetchVneContabilita,
} from '../services/vneService'

function eur(v) {
  if (v == null || Number.isNaN(Number(v))) return '—'
  return Number(v).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function localInputToVneDate(value) {
  const v = String(value || '').trim()
  if (!v) return null
  const [y, m, d] = v.split('-')
  if (!y || !m || !d) return null
  return `${d}-${m}-${y} 00:00`
}

function sectionLabel(k) {
  const map = {
    monete: 'Monete',
    banconote: 'Banconote',
    pagamenti: 'Pagamenti',
    pagamento_manuale: 'Pagamento manuale',
    rimborso: 'Rimborso',
    riepilogo: 'Riepilogo',
    prelievi: 'Prelievi',
  }
  return map[k] || k
}

export default function VneSection({ embedded = false }) {
  const SECTION_HOME = 'home'
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

  const selected = useMemo(() => models.find((m) => m.id === selectedId) || null, [models, selectedId])

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
        setError(`VNE: impossibile accedere alla macchina per ${selected?.label || mid}. Verifica disponibilità macchina/connessione sul portale remoto.`)
        return
      }
      setStatus(data)
      setModelConnectivity((prev) => ({ ...prev, [mid]: hasStatusData ? 'online' : 'offline' }))
    } catch (e) {
      setStatus(null)
      setModelConnectivity((prev) => ({ ...prev, [mid]: 'offline' }))
      setError(e?.message || 'Errore lettura stato VNE')
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
      (Array.isArray(data?.cassette) && data.cassette.length > 0) ||
      data?.hopper?.smart_hopper_1_eur ||
      data?.hopper?.firmware,
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
      if (opsAutoRefreshEnabled) runOperationsQuery(selectedId)
      if (closingsAutoRefreshEnabled) runCashClosingQuery(selectedId)
      loadContabilita(selectedId)
    }
    const timer = window.setInterval(tick, autoRefreshMs)
    return () => window.clearInterval(timer)
  }, [selectedId, autoRefreshEnabled, autoRefreshMs, opsAutoRefreshEnabled, closingsAutoRefreshEnabled])

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
                  <span className="support-tech-role">{m.configured ? 'Configurato' : 'Da configurare'}</span>
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
                <div className="support-tech-phone" style={{ wordBreak: 'break-all' }}>
                  {m.status_url || 'Nessun URL impostato'}
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
              Modello attivo: <strong>{selected?.label || selectedId}</strong>. Clicca una sezione per aprire la relativa scheda.
            </p>
          )}
        </div>
      </section>

      {activeSection === SECTION_CONTABILITA && (
      <section className="card vne-chiusure-style">
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
            <table className="vne-contabilita-table">
              <tbody>
                {Object.entries(contabilita.sections || {}).map(([sectionKey, items]) => {
                  const normalizedItems = Array.isArray(items) ? items : []
                  return (
                    <React.Fragment key={sectionKey}>
                      <tr>
                        <td className="vne-contabilita-title" colSpan={2}>{sectionLabel(sectionKey)}</td>
                      </tr>
                      {normalizedItems.length === 0 ? (
                        <tr>
                          <td className="vne-contabilita-col" colSpan={2}>—</td>
                        </tr>
                      ) : (
                        normalizedItems.map((item, idx) => (
                          <tr key={`${sectionKey}-${item.label}-${idx}`}>
                            <td className="vne-contabilita-col">{item.label || '—'}</td>
                            <td className="vne-contabilita-col vne-contabilita-amount">
                              {item.value_eur != null ? `${eur(item.value_eur)} €` : (item.raw_value || '—')}
                            </td>
                          </tr>
                        ))
                      )}
                    </React.Fragment>
                  )
                })}
                <tr>
                  <td className="vne-contabilita-footer" colSpan={2}>
                    V.N.E. Sistema di controllo remoto
                    <br />
                    {contabilita.updated_at_text || '—'}
                    <br />
                    Modello: {selected?.label || selectedId}
                  </td>
                </tr>
              </tbody>
            </table>
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
            Modello: <strong>{selected?.label || selectedId}</strong>
          </p>
          {!status && !loadingStatus && <p className="empty-state">Nessun dato disponibile.</p>}
          {loadingStatus && <p className="loading">Lettura stato da VNE…</p>}

          {status && (
            <table className="vne-contabilita-table vne-status-table">
              <tbody>
                <tr>
                  <td className="vne-contabilita-title" colSpan={2}>{status.title || 'Stato'}</td>
                </tr>
                <tr>
                  <td className="vne-contabilita-col">Totale</td>
                  <td className="vne-contabilita-col vne-contabilita-amount">{eur(status.totale_eur)} €</td>
                </tr>
                <tr>
                  <td className="vne-contabilita-col">Banconote</td>
                  <td className="vne-contabilita-col vne-contabilita-amount">{eur(status.banconote_eur)} €</td>
                </tr>
                <tr>
                  <td className="vne-contabilita-col">Monete</td>
                  <td className="vne-contabilita-col vne-contabilita-amount">{eur(status.monete_eur)} €</td>
                </tr>
                <tr>
                  <td className="vne-contabilita-col">Contenuto stacker</td>
                  <td className="vne-contabilita-col vne-contabilita-amount">{eur(status.contenuto_stacker_eur)} €</td>
                </tr>
                <tr>
                  <td className="vne-contabilita-col">Totale cassa</td>
                  <td className="vne-contabilita-col vne-contabilita-amount">{eur(status.totale_cassa_eur)} €</td>
                </tr>
                <tr>
                  <td className="vne-contabilita-title" colSpan={2}>Cassette</td>
                </tr>
                {status.cassette?.length ? status.cassette.map((c, idx) => (
                  <tr key={`${c.cassetta}-${idx}`}>
                    <td className="vne-contabilita-col">
                      Cassetta {c.cassetta} ({c.presente}) - Taglio {c.taglio_eur} €
                    </td>
                    <td className="vne-contabilita-col vne-contabilita-amount">
                      {c.banconote} banconote - {c.totale_eur} €
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td className="vne-contabilita-col" colSpan={2}>Nessuna cassetta rilevata nel parsing.</td>
                  </tr>
                )}
                <tr>
                  <td className="vne-contabilita-title" colSpan={2}>Smart Hopper</td>
                </tr>
                <tr>
                  <td className="vne-contabilita-col">Smart Hopper 1</td>
                  <td className="vne-contabilita-col vne-contabilita-amount">{status.hopper?.smart_hopper_1_eur || '—'} €</td>
                </tr>
                <tr>
                  <td className="vne-contabilita-col">Firmware</td>
                  <td className="vne-contabilita-col">{status.hopper?.firmware || '—'}</td>
                </tr>
                <tr>
                  <td className="vne-contabilita-footer" colSpan={2}>
                    V.N.E. Sistema di controllo remoto
                    <br />
                    {status.updated_at_text || '—'}
                  </td>
                </tr>
              </tbody>
            </table>
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
          <div className="vne-legacy-menu-row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setActiveSection(SECTION_HOME)}>
              Home
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => runOperationsQuery(selectedId)} disabled={loadingOps || !selectedId}>
              {loadingOps ? 'Ricerca…' : 'Cerca operazioni'}
            </button>
            <button
              type="button"
              className={opsAutoRefreshEnabled ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
              onClick={() => setOpsAutoRefreshEnabled((v) => !v)}
              disabled={!autoRefreshEnabled}
              title={!autoRefreshEnabled ? 'Attiva prima auto-refresh globale' : 'Aggiorna automaticamente questa tabella ai prossimi tick'}
            >
              {opsAutoRefreshEnabled ? 'Auto ON' : 'Auto OFF'}
            </button>
          </div>
          <p className="vne-chiusure-hint" style={{ marginTop: '0.35rem' }}>
            Modello: <strong>{selected?.label || selectedId}</strong> — formato data <strong>dd-mm-yyyy hh:mm</strong>.
          </p>
          {!selected?.sel_operazioni_url && (
            <p className="empty-state">Operazioni non configurate per questo modello.</p>
          )}
          <div className="form-row">
            <div className="form-group">
              <label>Data inizio</label>
              <input type="date" className="form-control" value={opsFrom} onChange={(e) => setOpsFrom(e.target.value)} style={{ minWidth: 170 }} />
            </div>
            <div className="form-group">
              <label>Data fine</label>
              <input type="date" className="form-control" value={opsTo} onChange={(e) => setOpsTo(e.target.value)} style={{ minWidth: 170 }} />
            </div>
          </div>
          {(opsFilters.operations.length > 0 || opsFilters.users.length > 0) && (
            <div className="form-row">
              <div className="form-group" style={{ flex: '1 1 280px' }}>
                <label>Tipo operazione</label>
                <select
                  className="form-control"
                  multiple
                  value={opsSelectedTypes}
                  onChange={(e) => setOpsSelectedTypes(Array.from(e.target.selectedOptions).map((o) => o.value))}
                  style={{ minHeight: 96 }}
                >
                  {opsFilters.operations.map((v) => (
                    <option key={v || 'blank-op'} value={v}>{v || '(vuoto)'}</option>
                  ))}
                </select>
              </div>
              <div className="form-group" style={{ flex: '1 1 240px' }}>
                <label>Utente</label>
                <select
                  className="form-control"
                  multiple
                  value={opsSelectedUsers}
                  onChange={(e) => setOpsSelectedUsers(Array.from(e.target.selectedOptions).map((o) => o.value))}
                  style={{ minHeight: 96 }}
                >
                  {opsFilters.users.map((u) => (
                    <option key={u || 'blank-user'} value={u}>{u || '(vuoto)'}</option>
                  ))}
                </select>
              </div>
            </div>
          )}
          {loadingOps && <p className="loading">Caricamento operazioni…</p>}
          {!loadingOps && opsRows.length === 0 && (
            !selected?.sel_operazioni_url ? null :
            <p className="empty-state">Nessuna operazione caricata. Imposta i filtri e premi «Cerca operazioni».</p>
          )}
          {!loadingOps && opsRows.length > 0 && (
            <div className="vne-operations-legacy-list">
              {opsRows.map((r, idx) => (
                <div key={`${r.when_text}-${idx}`} className="vne-operations-legacy-item">
                  <div><strong>Operazione del:</strong> {r.when_text || '—'}</div>
                  <div><strong>Tipo operazione:</strong> {r.operation_type || '—'}</div>
                  <div><strong>Valore:</strong> {r.value_eur != null ? `${eur(r.value_eur)} €` : '—'}</div>
                  <div><strong>Commento:</strong> {r.comment || '—'}</div>
                  <div><strong>Eseguita da:</strong> {r.executed_by || '—'}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
      )}

      {activeSection === SECTION_CHIUSURE && (
      <section className="card vne-chiusure-style">
        <div className="vne-legacy-header">
          <h2 className="page-subheader" style={{ margin: 0 }}>Chiusure di cassa</h2>
          <div className="vne-legacy-logo" aria-hidden />
        </div>
        <div className="vne-legacy-shell">
          <div className="vne-legacy-menu-row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setActiveSection(SECTION_HOME)}>
              Home
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => runCashClosingQuery(selectedId)} disabled={loadingClosings || !selectedId}>
              {loadingClosings ? 'Ricerca…' : 'Cerca chiusure'}
            </button>
            <button
              type="button"
              className={closingsAutoRefreshEnabled ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm'}
              onClick={() => setClosingsAutoRefreshEnabled((v) => !v)}
              disabled={!autoRefreshEnabled}
              title={!autoRefreshEnabled ? 'Attiva prima auto-refresh globale' : 'Aggiorna automaticamente questa tabella ai prossimi tick'}
            >
              {closingsAutoRefreshEnabled ? 'Auto ON' : 'Auto OFF'}
            </button>
          </div>
          <p className="vne-chiusure-hint" style={{ color: 'var(--text-muted)', fontSize: '0.86rem', marginTop: '0.35rem' }}>
            Modello: <strong>{selected?.label || selectedId}</strong> — formato data <strong>dd-mm-yyyy hh:mm</strong>.
          </p>
          {!selected?.sel_chiusure_url && (
            <p className="empty-state">Chiusure non configurate per questo modello.</p>
          )}
          <div className="form-row">
          <div className="form-group">
            <label>Data inizio</label>
            <input type="date" className="form-control" value={closingFrom} onChange={(e) => setClosingFrom(e.target.value)} style={{ minWidth: 170 }} />
          </div>
          <div className="form-group">
            <label>Data fine</label>
            <input type="date" className="form-control" value={closingTo} onChange={(e) => setClosingTo(e.target.value)} style={{ minWidth: 170 }} />
          </div>
          <div className="form-group" style={{ flex: '1 1 260px' }}>
            <label>Operatore</label>
            <select
              className="form-control"
              multiple
              value={closingOperators}
              onChange={(e) => setClosingOperators(Array.from(e.target.selectedOptions).map((o) => o.value))}
              style={{ minHeight: 88 }}
            >
              {closingFilters.operators.map((o) => (
                <option key={o || 'blank-opr'} value={o}>{o || '(vuoto)'}</option>
              ))}
            </select>
          </div>
          </div>
          {loadingClosings && <p className="loading">Caricamento chiusure…</p>}
          {!loadingClosings && closingRows.length === 0 && (
            !selected?.sel_chiusure_url ? null :
            <p className="empty-state">Nessuna chiusura caricata. Imposta i filtri e premi «Cerca chiusure».</p>
          )}
          {!loadingClosings && closingRows.length > 0 && (
            <div className="table-wrap vne-chiusure-table-wrap">
              <table className="app-table app-table--compact vne-chiusure-table">
                <thead>
                  <tr>
                    <th>Data / ora</th>
                    <th>Operatore</th>
                    <th className="text-end">Totale €</th>
                    <th>Dettaglio</th>
                  </tr>
                </thead>
                <tbody>
                  {closingRows.map((r, idx) => (
                    <tr key={`${r.when_text}-${idx}`}>
                      <td>{r.when_text || '—'}</td>
                      <td>{r.operator || '—'}</td>
                      <td className="text-end">{r.total_eur != null ? eur(r.total_eur) : '—'}</td>
                    <td className="vne-chiusure-dettaglio">{r.raw_block || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          </div>
      </section>
      )}
    </div>
  )
}
