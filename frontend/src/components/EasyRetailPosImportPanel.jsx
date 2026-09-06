import React, { useEffect, useState } from 'react'
import { eur } from './AnalisiShared'
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
  { id: 'model-4', label: 'Mani in Pasta (Via Zanardelli)' },
  { id: 'model-5', label: 'Gazza Ladra (POS Poste)' },
]

const PAY_COLORS = {
  cash: '#059669',
  card: '#2563eb',
  unknown: '#94a3b8',
}

const PAY_LABELS = {
  cash: 'Contanti',
  card: 'Carta/POS',
  unknown: 'Non classificati',
}

const STORE_COLORS = ['#2563eb', '#0891b2', '#d97706', '#7c3aed', '#059669', '#db2777']

function _polar(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180
  return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
}

function _donutPath(cx, cy, rOuter, rInner, startDeg, sweepDeg) {
  if (sweepDeg <= 0) return ''
  const sweep = Math.min(359.999, sweepDeg)
  const large = sweep > 180 ? 1 : 0
  const [x1, y1] = _polar(cx, cy, rOuter, startDeg)
  const [x2, y2] = _polar(cx, cy, rOuter, startDeg + sweep)
  const [x3, y3] = _polar(cx, cy, rInner, startDeg + sweep)
  const [x4, y4] = _polar(cx, cy, rInner, startDeg)
  return [
    `M ${x1} ${y1}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2}`,
    `L ${x3} ${y3}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${x4} ${y4}`,
    'Z',
  ].join(' ')
}

function PaymentIncassiDonut({ payTotals }) {
  const rows = [
    { id: 'cash', label: PAY_LABELS.cash, value: Number(payTotals?.cash_eur || 0), color: PAY_COLORS.cash },
    { id: 'card', label: PAY_LABELS.card, value: Number(payTotals?.card_eur || 0), color: PAY_COLORS.card },
    { id: 'unknown', label: PAY_LABELS.unknown, value: Number(payTotals?.unknown_eur || 0), color: PAY_COLORS.unknown },
  ].filter((r) => r.value > 0)

  const total = rows.reduce((acc, r) => acc + r.value, 0)
  if (total <= 0) return null

  let angle = -90
  const slices = rows.map((r) => {
    const sweep = (r.value / total) * 360
    const start = angle
    angle += sweep
    return { ...r, pct: (r.value / total) * 100, start, sweep }
  })

  return (
    <div className="analisi-compare-card">
      <h3 className="analisi-machine-subtitle" style={{ marginTop: 0 }}>
        Incassi classificati
      </h3>
      <div className="analisi-donut-wrap">
        <svg className="analisi-donut" viewBox="0 0 120 120" role="img" aria-label="Incassi contanti, carta e non classificati">
          {slices.map((s) => (
            <path key={s.id} d={_donutPath(60, 60, 52, 30, s.start, s.sweep)} fill={s.color} />
          ))}
          <text x="60" y="56" textAnchor="middle" className="analisi-donut-total-label">
            Totale
          </text>
          <text x="60" y="72" textAnchor="middle" className="analisi-donut-total-value">
            {eur(total)}
          </text>
        </svg>
        <ul className="analisi-donut-legend">
          {slices.map((s) => (
            <li key={s.id}>
              <span className="analisi-donut-swatch" style={{ background: s.color }} />
              <span>
                {s.label} · {eur(s.value)} ({Math.round(s.pct)}%)
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function CountBars({ title, entries, colorFor, labelFor }) {
  const rows = entries
    .map(([key, n]) => ({
      key: String(key),
      label: labelFor ? labelFor(key) : String(key),
      value: Number(n) || 0,
    }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .map((r, idx) => ({
      ...r,
      color: colorFor ? colorFor(r.key, idx) : '#2563eb',
    }))

  if (!rows.length) return null
  const max = Math.max(1, ...rows.map((r) => r.value))

  return (
    <div className="analisi-compare-card">
      <h3 className="analisi-machine-subtitle" style={{ marginTop: 0 }}>
        {title}
      </h3>
      <div className="analisi-bars" role="img" aria-label={title}>
        {rows.map((r) => (
          <div key={r.key} className="analisi-bar-row" title={`${r.label}: ${r.value}`}>
            <div className="analisi-bar-label" title={r.label}>
              {r.label}
            </div>
            <div className="analisi-bar-track">
              <div
                className="analisi-bar-fill"
                style={{ width: `${Math.max(4, (r.value / max) * 100)}%`, background: r.color }}
              />
            </div>
            <div className="analisi-bar-value">{r.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PosReceiptCharts({ payTotals, byPayment, byStore }) {
  const paymentEntries = Object.entries(byPayment || {})
  const storeEntries = Object.entries(byStore || {})
  const hasPay = payTotals && (Number(payTotals.cash_eur) || Number(payTotals.card_eur) || Number(payTotals.unknown_eur))
  const hasCharts = hasPay || paymentEntries.length > 0 || storeEntries.length > 0
  if (!hasCharts) return null

  return (
    <div className="analisi-compare-grid" style={{ marginTop: '0.75rem' }}>
      {hasPay ? <PaymentIncassiDonut payTotals={payTotals} /> : null}
      <CountBars
        title="Scontrini per pagamento"
        entries={paymentEntries}
        labelFor={(k) => PAY_LABELS[k] || String(k)}
        colorFor={(k) => PAY_COLORS[k] || '#64748b'}
      />
      <CountBars
        title="Scontrini per locale"
        entries={storeEntries}
        labelFor={(k) => (k === '0' || k === '' ? 'Non assegnato' : String(k))}
        colorFor={(_, idx) => STORE_COLORS[idx % STORE_COLORS.length]}
      />
    </div>
  )
}

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
      <PosReceiptCharts payTotals={payTotals} byPayment={byPayment} byStore={byStore} />
    </section>
  )
}
