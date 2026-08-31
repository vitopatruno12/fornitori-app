import React, { useEffect, useState } from 'react'
import {
  fetchPosPaymentSummary,
  fetchPosReceiptStats,
  fetchPosReceiptSyncStatus,
  importPosReceiptsCsv,
  posReceiptsTemplateUrl,
  triggerPosReceiptsGdbSync,
} from '../services/analyticsService'

const MODEL_OPTIONS = [
  { id: '', label: 'Auto (colonna Negozio/Cassa nel CSV)' },
  { id: 'model-1', label: 'La Risacca' },
  { id: 'model-2', label: 'Mani in Pasta (Via Abba)' },
  { id: 'model-3', label: 'Le Mucche Volanti (Via Lattea)' },
  { id: 'model-4', label: 'Gazza Ladra (POS Poste)' },
]

/** Import / sync scontrini EasyRetail → visite per Orari di punta. */
export function EasyRetailPosImportPanel({ onImported } = {}) {
  const [stats, setStats] = useState(null)
  const [paymentSummary, setPaymentSummary] = useState(null)
  const [syncStatus, setSyncStatus] = useState(null)
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
    try {
      const pay = await fetchPosPaymentSummary({ modelId: modelId || undefined })
      setPaymentSummary(pay)
    } catch {
      setPaymentSummary(null)
    }
    try {
      const st = await fetchPosReceiptSyncStatus()
      setSyncStatus(st)
    } catch {
      setSyncStatus(null)
    }
  }

  useEffect(() => {
    void refreshStats()
  }, [modelId])

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

  async function onSyncGdb() {
    setBusy(true)
    setError('')
    setMessage('')
    try {
      const res = await triggerPosReceiptsGdbSync({
        modelId: modelId || undefined,
      })
      setMessage(
        `Sync GDB: ${res?.parsed || 0} letti (nuovi ${res?.inserted || 0}, aggiornati ${res?.updated || 0})` +
          (res?.gdb?.table ? ` · tabella ${res.gdb.table}` : ''),
      )
      await refreshStats()
      onImported?.(res)
    } catch (err) {
      setError(err?.message || 'Sync GDB fallita (di solito va lanciata dal PC cassa con l’agent)')
    } finally {
      setBusy(false)
    }
  }

  const byStore = stats?.by_store && typeof stats.by_store === 'object' ? stats.by_store : {}
  const byPayment = stats?.by_payment_type && typeof stats.by_payment_type === 'object' ? stats.by_payment_type : {}
  const payTotals = paymentSummary?.totals && typeof paymentSummary.totals === 'object' ? paymentSummary.totals : null
  const mode = syncStatus?.mode || 'agent-push'

  return (
    <section className="card analisi-panel" style={{ marginBottom: '1rem' }}>
      <h2 className="analisi-panel-title">Scontrini EasyRetail (visite e pagamenti)</h2>
      <p className="analisi-machine-scope">
        Sul <strong>PC cassa</strong> l’agent legge il database Firebird EasyRetail (<code>DBRETAIL.GDB</code>) ogni
        pochi minuti e invia gli scontrini ad ATLAS, includendo la ripartizione <strong>contanti</strong> vs{' '}
        <strong>carta/POS</strong> quando il GDB espone le forme di pagamento. Resta disponibile anche l’import CSV
        manuale.
      </p>
      <p className="analisi-machine-scope" role="status">
        Modalità sync:{' '}
        <strong>{mode === 'server-gdb' ? 'server legge GDB' : 'agent PC cassa → ATLAS'}</strong>
        {syncStatus?.sync_token_configured ? ' · token configurato' : ' · token sync non configurato sul server'}
        {syncStatus?.gdb_sync_enabled ? ` · intervallo ${syncStatus.gdb_interval_sec || '—'}s` : ''}
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
        {syncStatus?.gdb_dsn_configured ? (
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={onSyncGdb}>
            Sync GDB ora
          </button>
        ) : null}
      </div>
      {message ? <p className="analisi-note">{message}</p> : null}
      {error ? <div className="alert alert-danger">{error}</div> : null}
      <p className="analisi-machine-scope" role="status">
        In archivio: <strong>{stats?.total ?? 0}</strong> scontrini
        {stats?.from && stats?.to ? ` · dal ${String(stats.from).slice(0, 10)} al ${String(stats.to).slice(0, 10)}` : ''}
        {typeof stats?.with_payment_type === 'number'
          ? ` · ${stats.with_payment_type} con tipo pagamento`
          : ''}
      </p>
      {payTotals ? (
        <p className="analisi-machine-scope" role="status">
          Incassi classificati: contanti <strong>{Number(payTotals.cash_eur || 0).toFixed(2)} €</strong>
          {' · '}
          carta/POS <strong>{Number(payTotals.card_eur || 0).toFixed(2)} €</strong>
          {Number(payTotals.unknown_eur || 0) > 0
            ? ` · non classificati ${Number(payTotals.unknown_eur).toFixed(2)} €`
            : ''}
        </p>
      ) : null}
      {Object.keys(byPayment).length > 0 ? (
        <ul className="analisi-suggestions">
          {Object.entries(byPayment).map(([ptype, n]) => (
            <li key={ptype}>
              {ptype}: {n} scontrini
            </li>
          ))}
        </ul>
      ) : null}
      {Object.keys(byStore).length > 0 ? (
        <ul className="analisi-suggestions">
          {Object.entries(byStore).map(([label, n]) => (
            <li key={label}>
              {label}: {n}
            </li>
          ))}
        </ul>
      ) : null}
      <details style={{ marginTop: '0.75rem' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Come attivare la sync automatica (PC cassa)</summary>
        <ol style={{ margin: '0.5rem 0 0', paddingLeft: '1.2rem', fontSize: '0.9rem' }}>
          <li>
            Sul server ATLAS imposta <code>EASYRETAIL_SYNC_TOKEN</code> (token segreto) e fai restart API.
          </li>
          <li>
            Sul PC EasyRetail installa Python + <code>pip install fdb</code>, copia{' '}
            <code>backend/scripts/easyretail_gdb_sync_agent.py</code> e la cartella <code>backend/app</code> (o tutto il
            repo).
          </li>
          <li>
            Crea un <code>.env</code> accanto all’agent con percorso GDB, <code>fbclient.dll</code>, token e{' '}
            <code>ATLAS_API_BASE=https://www.atlass.it/api</code>.
          </li>
          <li>
            Pianifica l’esecuzione ogni 2–5 minuti con Utilità di pianificazione Windows.
          </li>
          <li>
            Per verificare come il GDB espone contanti/carta sul PC cassa:{' '}
            <code>python easyretail_gdb_sync_agent.py --probe</code>
          </li>
        </ol>
      </details>
    </section>
  )
}
