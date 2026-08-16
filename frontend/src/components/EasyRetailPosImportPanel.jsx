import React, { useEffect, useState } from 'react'
import {
  fetchPosReceiptStats,
  importPosReceiptsCsv,
  posReceiptsTemplateUrl,
} from '../services/analyticsService'

const MODEL_OPTIONS = [
  { id: '', label: 'Auto (colonna Negozio/Cassa nel CSV)' },
  { id: 'model-1', label: 'La Risacca' },
  { id: 'model-2', label: 'Mani in Pasta' },
  { id: 'model-3', label: 'Le Mucche Volanti' },
]

/** Import scontrini EasyRetail → visite per Orari di punta. */
export function EasyRetailPosImportPanel({ onImported } = {}) {
  const [stats, setStats] = useState(null)
  const [modelId, setModelId] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function refreshStats() {
    try {
      const s = await fetchPosReceiptStats()
      setStats(s)
    } catch {
      setStats(null)
    }
  }

  useEffect(() => {
    void refreshStats()
  }, [])

  async function onFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const res = await importPosReceiptsCsv(file, { modelId: modelId || undefined })
      const warns = Array.isArray(res?.warnings) && res.warnings.length ? ` · ${res.warnings.join(' · ')}` : ''
      setMessage(
        `Importati ${res?.parsed || 0} scontrini (nuovi ${res?.inserted || 0}, aggiornati ${res?.updated || 0})${warns}`,
      )
      await refreshStats()
      onImported?.(res)
    } catch (err) {
      setError(err?.message || 'Import fallito')
    } finally {
      setBusy(false)
    }
  }

  const byStore = stats?.by_store && typeof stats.by_store === 'object' ? stats.by_store : {}

  return (
    <section className="card analisi-panel" style={{ marginBottom: '1rem' }}>
      <h2 className="analisi-panel-title">Scontrini EasyRetail (visite)</h2>
      <p className="analisi-machine-scope">
        Esporta da EasyRetail il dettaglio scontrini in CSV (colonne consigliate:{' '}
        <strong>DataOra</strong>, <strong>Negozio</strong>, <strong>NumeroScontrino</strong>, <strong>Totale</strong>
        ). Gli Orari di punta useranno questi dati al posto delle sole operazioni VNE.
      </p>
      <div className="btn-group" style={{ flexWrap: 'wrap', gap: '0.5rem', marginBottom: '0.65rem' }}>
        <label className="analisi-popular-day" style={{ margin: 0 }}>
          <span className="analisi-popular-day-label">Locale</span>
          <select value={modelId} onChange={(ev) => setModelId(ev.target.value)} disabled={busy}>
            {MODEL_OPTIONS.map((o) => (
              <option key={o.id || 'auto'} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className={`btn btn-primary btn-sm${busy ? ' is-disabled' : ''}`} style={{ margin: 0, cursor: busy ? 'wait' : 'pointer' }}>
          {busy ? 'Importo…' : 'Carica CSV scontrini'}
          <input type="file" accept=".csv,.tsv,.txt,text/csv" hidden disabled={busy} onChange={onFileChange} />
        </label>
        <a className="btn btn-secondary btn-sm" href={posReceiptsTemplateUrl()} download>
          Scarica modello CSV
        </a>
      </div>
      {message ? <p className="analisi-note">{message}</p> : null}
      {error ? <div className="alert alert-danger">{error}</div> : null}
      <p className="analisi-machine-scope" role="status">
        In archivio: <strong>{stats?.total ?? 0}</strong> scontrini
        {stats?.from && stats?.to ? ` · dal ${String(stats.from).slice(0, 10)} al ${String(stats.to).slice(0, 10)}` : ''}
      </p>
      {Object.keys(byStore).length > 0 ? (
        <ul className="analisi-suggestions">
          {Object.entries(byStore).map(([label, n]) => (
            <li key={label}>
              {label}: {n}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
