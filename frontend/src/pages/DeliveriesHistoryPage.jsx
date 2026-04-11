import React, { useEffect, useState } from 'react'
import { fetchDeliveries, deleteAllDeliveries, fetchPriceAnalytics } from '../services/deliveriesService'
import { fetchSuppliers } from '../services/suppliersService'

function formatDate(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString('it-IT')
}

function formatAmount(value) {
  if (value == null) return ''
  return Number(value).toFixed(2)
}

function qtyCell(d) {
  const w = d.weight_kg != null && Number(d.weight_kg) > 0
  const p = d.pieces != null && Number(d.pieces) > 0
  if (w && p) return `${Number(d.weight_kg)} kg + ${d.pieces} pz`
  if (w) return `${Number(d.weight_kg)} kg`
  if (p) return `${d.pieces} pz`
  return '–'
}

function PriceTrendChart({ series }) {
  if (!series?.length) {
    return <p className="empty-state" style={{ margin: 0 }}>Nessun punto per il grafico.</p>
  }

  const w = 720
  const h = 240
  const padL = 52
  const padR = 24
  const padT = 20
  const padB = 44
  const innerW = w - padL - padR
  const innerH = h - padT - padB

  const prices = series.map((s) => Number(s.unit_price))
  const minP = Math.min(...prices)
  const maxP = Math.max(...prices)
  const span = maxP - minP || 1

  const pts = series.map((s, i) => {
    const x =
      series.length <= 1 ? padL + innerW / 2 : padL + (i / (series.length - 1)) * innerW
    const y = padT + innerH - ((Number(s.unit_price) - minP) / span) * innerH
    return { x, y, s }
  })

  const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')

  const firstDate = formatDate(series[0].delivery_date)
  const lastDate = formatDate(series[series.length - 1].delivery_date)
  const midDate =
    series.length > 2 ? formatDate(series[Math.floor(series.length / 2)].delivery_date) : ''

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
      >
        <rect x="0" y="0" width={w} height={h} fill="var(--card-bg, #1a1d23)" rx="6" />
        <text x={padL} y={padT - 4} fill="var(--text-muted, #9aa4b2)" fontSize="12">
          Andamento prezzo unitario (€)
        </text>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const val = minP + span * (1 - t)
          const y = padT + innerH * t
          return (
            <g key={t}>
              <line
                x1={padL}
                y1={y}
                x2={padL + innerW}
                y2={y}
                stroke="var(--border, #333)"
                strokeOpacity="0.35"
              />
              <text x={8} y={y + 4} fill="var(--text-muted, #9aa4b2)" fontSize="11">
                {val.toFixed(2)}
              </text>
            </g>
          )
        })}
        <path
          d={pathD}
          fill="none"
          stroke="var(--accent, #5dade2)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="4" fill="var(--accent, #5dade2)" stroke="#fff" strokeWidth="1" />
        ))}
        <text x={padL} y={h - 12} fill="var(--text-muted, #9aa4b2)" fontSize="11">
          {firstDate}
        </text>
        {midDate && series.length > 2 && (
          <text x={w / 2 - 30} y={h - 12} fill="var(--text-muted, #9aa4b2)" fontSize="11">
            {midDate}
          </text>
        )}
        <text x={w - padR - 72} y={h - 12} fill="var(--text-muted, #9aa4b2)" fontSize="11" textAnchor="end">
          {lastDate}
        </text>
      </svg>
    </div>
  )
}

export default function DeliveriesHistoryPage() {
  const [deliveries, setDeliveries] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [supplierId, setSupplierId] = useState('')
  const [productQuery, setProductQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [deletingAll, setDeletingAll] = useState(false)

  const [anSupplierId, setAnSupplierId] = useState('')
  const [anProduct, setAnProduct] = useState('')
  const [analytics, setAnalytics] = useState(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [analyticsError, setAnalyticsError] = useState('')

  useEffect(() => {
    loadSuppliers()
    loadDeliveries()
  }, [])

  async function loadSuppliers() {
    try {
      const data = await fetchSuppliers()
      setSuppliers(data)
    } catch {
      // non bloccare
    }
  }

  async function loadDeliveries() {
    try {
      setLoading(true)
      setError('')
      const data = await fetchDeliveries({
        supplier_id: supplierId || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        product_query: productQuery?.trim() || undefined,
      })
      setDeliveries(data)
    } catch (e) {
      setError('Errore nel caricamento delle consegne')
    } finally {
      setLoading(false)
    }
  }

  function handleFilterSubmit(e) {
    e.preventDefault()
    loadDeliveries()
  }

  async function handleDeleteAllHistory() {
    if (
      !window.confirm(
        'Eliminare tutto lo storico delle consegne? Questa operazione non si può annullare.'
      )
    )
      return
    try {
      setDeletingAll(true)
      setError('')
      setSuccess('')
      await deleteAllDeliveries()
      setSuccess('Storico eliminato')
      await loadDeliveries()
    } catch (e) {
      setError("Errore nell'eliminazione dello storico")
    } finally {
      setDeletingAll(false)
    }
  }

  async function handleLoadAnalytics(e) {
    e.preventDefault()
    setAnalyticsError('')
    setAnalytics(null)
    if (!anSupplierId || !anProduct.trim()) {
      setAnalyticsError('Seleziona fornitore e inserisci il nome prodotto come nelle consegne.')
      return
    }
    try {
      setAnalyticsLoading(true)
      const data = await fetchPriceAnalytics({
        supplier_id: Number(anSupplierId),
        product_description: anProduct.trim(),
      })
      setAnalytics(data)
      if (data.delivery_count === 0) {
        setAnalyticsError(
          'Nessuna consegna trovata per questa coppia fornitore/prodotto. Verifica il testo esatto della merce.'
        )
      }
    } catch (err) {
      setAnalyticsError('Impossibile caricare le statistiche.')
    } finally {
      setAnalyticsLoading(false)
    }
  }

  return (
    <div>
      <h1 className="page-header">Storico consegne</h1>
      <p style={{ color: 'var(--text-muted)', marginTop: '-0.5rem', marginBottom: '1rem', maxWidth: '52rem' }}>
        Cerca per fornitore, prodotto (testo libero) e periodo. Confronta prezzi nel tempo nella sezione analisi: ultimo
        prezzo, media, min/max e grafico.
      </p>

      {error && <div className="alert alert-danger">{error}</div>}
      {success && <div className="alert alert-success">{success}</div>}

      <section className="card">
        <h2 className="page-subheader" style={{ marginTop: 0 }}>
          Filtri elenco
        </h2>
        <form onSubmit={handleFilterSubmit} className="filter-bar">
          <div className="form-group">
            <label>Fornitore</label>
            <select
              className="form-control"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              style={{ minWidth: 200 }}
            >
              <option value="">Tutti</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>Cerca prodotto / note</label>
            <input
              className="form-control"
              value={productQuery}
              onChange={(e) => setProductQuery(e.target.value)}
              placeholder="es. carciofi, DDT…"
              style={{ minWidth: 200 }}
            />
          </div>
          <div className="form-group">
            <label>Dal</label>
            <input type="date" className="form-control" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="form-group">
            <label>Al</label>
            <input type="date" className="form-control" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary">
            Cerca
          </button>
          <button
            type="button"
            className="btn btn-outline-danger"
            onClick={handleDeleteAllHistory}
            disabled={deletingAll}
          >
            {deletingAll ? 'Eliminazione...' : 'Elimina tutto lo storico'}
          </button>
        </form>

        {loading && <p className="loading">Caricamento...</p>}
        {!loading && !error && (
          <div className="table-wrap">
            <table className="app-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>DDT</th>
                  <th>Fornitore</th>
                  <th>Prodotto</th>
                  <th>Quantità</th>
                  <th className="text-end">Prezzo unit.</th>
                  <th className="text-end">Listino</th>
                  <th className="text-end">Diff.</th>
                  <th className="text-end">Imponibile</th>
                  <th className="text-end">IVA</th>
                  <th className="text-end">Totale</th>
                  <th>Note doc.</th>
                  <th>Anomalie</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td>{formatDate(d.delivery_date)}</td>
                    <td>{d.ddt_number || '–'}</td>
                    <td>{d.supplier_name || d.supplier_id}</td>
                    <td>{d.product_description || '–'}</td>
                    <td>{qtyCell(d)}</td>
                    <td className="text-end amount">{formatAmount(d.unit_price)}</td>
                    <td className="text-end amount">{d.list_unit_price != null ? formatAmount(d.list_unit_price) : '–'}</td>
                    <td
                      className="text-end amount"
                      style={{
                        color:
                          d.price_diff_vs_list != null && Number(d.price_diff_vs_list) > 0
                            ? 'var(--danger, #c0392b)'
                            : d.price_diff_vs_list != null && Number(d.price_diff_vs_list) < 0
                              ? 'var(--success, #1e8449)'
                              : undefined,
                      }}
                    >
                      {d.price_diff_vs_list != null
                        ? `${Number(d.price_diff_vs_list) > 0 ? '+' : ''}${formatAmount(d.price_diff_vs_list)}`
                        : '–'}
                    </td>
                    <td className="text-end amount">{formatAmount(d.imponibile)}</td>
                    <td className="text-end amount">{formatAmount(d.vat_amount)}</td>
                    <td className="text-end amount">{formatAmount(d.total)}</td>
                    <td style={{ maxWidth: 140 }}>{d.note || '–'}</td>
                    <td style={{ maxWidth: 160 }}>{d.anomaly_note || '–'}</td>
                  </tr>
                ))}
                {deliveries.length === 0 && (
                  <tr>
                    <td colSpan={13} className="empty-state">
                      Nessuna consegna registrata.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" style={{ marginTop: '1.5rem' }}>
        <h2 className="page-subheader" style={{ marginTop: 0 }}>
          Analisi prezzi nel tempo
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
          Il nome prodotto deve coincidere con quello registrato in consegna (stesso testo, senza distinzione maiuscole).
        </p>
        <form onSubmit={handleLoadAnalytics} className="filter-bar" style={{ flexWrap: 'wrap' }}>
          <div className="form-group">
            <label>Fornitore</label>
            <select
              className="form-control"
              value={anSupplierId}
              onChange={(e) => setAnSupplierId(e.target.value)}
              style={{ minWidth: 220 }}
            >
              <option value="">Seleziona...</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ flex: '1 1 260px' }}>
            <label>Prodotto (testo consegna)</label>
            <input
              className="form-control"
              value={anProduct}
              onChange={(e) => setAnProduct(e.target.value)}
              placeholder="es. carciofi"
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={analyticsLoading}>
            {analyticsLoading ? 'Calcolo...' : 'Carica analisi'}
          </button>
        </form>
        {analyticsError && <div className="alert alert-danger">{analyticsError}</div>}
        {analytics && analytics.delivery_count > 0 && (
          <div style={{ marginTop: '1rem' }}>
            <p style={{ marginBottom: '0.75rem' }}>
              <strong>{analytics.product_description}</strong>
              {analytics.supplier_name ? ` — ${analytics.supplier_name}` : ''}
            </p>
            <div className="form-row" style={{ gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <div className="card" style={{ padding: '0.75rem 1rem', margin: 0, flex: '1 1 140px' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Ultimo prezzo</div>
                <div style={{ fontSize: '1.25rem' }}>{formatAmount(analytics.last_unit_price)} €</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {formatDate(analytics.last_delivery_date)}
                </div>
              </div>
              <div className="card" style={{ padding: '0.75rem 1rem', margin: 0, flex: '1 1 140px' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Prezzo medio</div>
                <div style={{ fontSize: '1.25rem' }}>{formatAmount(analytics.avg_unit_price)} €</div>
              </div>
              <div className="card" style={{ padding: '0.75rem 1rem', margin: 0, flex: '1 1 140px' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Min / Max</div>
                <div style={{ fontSize: '1.05rem' }}>
                  {formatAmount(analytics.min_unit_price)} / {formatAmount(analytics.max_unit_price)} €
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                  {analytics.delivery_count} consegne
                </div>
              </div>
            </div>
            <PriceTrendChart series={analytics.series} />
          </div>
        )}
      </section>
    </div>
  )
}
