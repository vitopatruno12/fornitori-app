import React, { useEffect, useMemo, useState } from 'react'
import { fetchDeliveries, deleteAllDeliveries, fetchPriceAnalytics, updateDeliveryNotes, deleteDelivery } from '../services/deliveriesService'
import { fetchSuppliers } from '../services/suppliersService'
import { AnalisiLoadingBar } from '../components/AnalisiShared.jsx'
import {
  DELIVERIES_HISTORY_WORKBOOK_COLUMNS,
  DELIVERIES_HISTORY_WORKBOOK_TITLE,
  deliveryHistoryDiffTone,
  deliveryHistoryWorkbookCellValue,
  deliveryHistoryWorkbookTotals,
  deliveryHistoryWorkbookTotalsLabel,
  splitDeliveryNote,
} from '../utils/deliveriesHistoryWorkbook.js'

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

export default function DeliveriesHistoryPage({ operatorMode = false }) {
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
  const [selectedDeliveryId, setSelectedDeliveryId] = useState('')
  const [editingDeliveryId, setEditingDeliveryId] = useState(null)
  const [editDestinationNote, setEditDestinationNote] = useState('')
  const [editDocumentNote, setEditDocumentNote] = useState('')
  const [editAnomalyNote, setEditAnomalyNote] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)

  const [anSupplierId, setAnSupplierId] = useState('')
  const [anProduct, setAnProduct] = useState('')
  const [analytics, setAnalytics] = useState(null)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [analyticsError, setAnalyticsError] = useState('')

  const deliveryList = Array.isArray(deliveries) ? deliveries : []
  const deliveryTotals = useMemo(() => deliveryHistoryWorkbookTotals(deliveryList), [deliveryList])

  useEffect(() => {
    loadSuppliers()
    loadDeliveries()
  }, [])

  async function loadSuppliers() {
    try {
      const data = await fetchSuppliers()
      setSuppliers(Array.isArray(data) ? data : [])
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
      const list = Array.isArray(data) ? data : []
      setDeliveries(list)
      setSelectedDeliveryId((prev) => {
        if (list.length === 0) return ''
        return list.some((d) => String(d.id) === String(prev)) ? String(prev) : String(list[0].id)
      })
    } catch {
      setDeliveries([])
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
      setAnalytics(data && typeof data === 'object' ? data : null)
      if (!data || data.delivery_count === 0) {
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

  function openEditNotes(row) {
    const parsed = splitDeliveryNote(row?.note)
    setEditingDeliveryId(row?.id ?? null)
    setEditDestinationNote(parsed.destination || '')
    setEditDocumentNote(parsed.documentNote || '')
    setEditAnomalyNote(row?.anomaly_note || '')
  }

  function closeEditNotes() {
    setEditingDeliveryId(null)
    setEditDestinationNote('')
    setEditDocumentNote('')
    setEditAnomalyNote('')
  }

  async function handleSaveNotes() {
    if (!editingDeliveryId) return
    try {
      setSavingNotes(true)
      setError('')
      setSuccess('')
      const updated = await updateDeliveryNotes(editingDeliveryId, {
        destination_note: editDestinationNote.trim() || null,
        note: editDocumentNote.trim() || null,
        anomaly_note: editAnomalyNote.trim() || null,
      })
      setDeliveries((prev) =>
        (Array.isArray(prev) ? prev : []).map((d) =>
          d.id === editingDeliveryId ? { ...d, ...updated } : d,
        ),
      )
      setSuccess('Note consegna aggiornate')
      closeEditNotes()
    } catch (e) {
      setError('Errore nel salvataggio delle note consegna')
    } finally {
      setSavingNotes(false)
    }
  }

  async function handleDeleteDeliveryRow(row) {
    if (!row?.id) return
    const label = row?.product_description ? ` (${row.product_description})` : ''
    if (!window.confirm(`Eliminare questa riga consegna${label}?`)) return
    try {
      setError('')
      setSuccess('')
      await deleteDelivery(row.id)
      setDeliveries((prev) => (Array.isArray(prev) ? prev : []).filter((d) => d.id !== row.id))
      if (editingDeliveryId === row.id) closeEditNotes()
      setSuccess('Riga consegna eliminata')
    } catch {
      setError('Errore nell’eliminazione della riga consegna')
    }
  }

  function handleOpenSelectedNotes() {
    if (!selectedDeliveryId) {
      setError('Seleziona una riga consegna prima di modificare le note')
      return
    }
    const row = deliveryList.find((d) => String(d.id) === String(selectedDeliveryId))
    if (!row) {
      setError('Riga consegna non trovata')
      return
    }
    openEditNotes(row)
  }

  async function handleDeleteSelectedRow() {
    if (!selectedDeliveryId) {
      setError('Seleziona una riga consegna prima di eliminare')
      return
    }
    const row = deliveryList.find((d) => String(d.id) === String(selectedDeliveryId))
    if (!row) {
      setError('Riga consegna non trovata')
      return
    }
    await handleDeleteDeliveryRow(row)
  }

  return (
    <div>
      <section className="staff-page-hero">
      <h1 className="page-header staff-page-title">Storico consegne</h1>
      <p className="staff-page-lead">
        {operatorMode ? (
          <>
            Consulta e filtra le consegne registrate. Per inserire un nuovo scarico usa la scheda{' '}
            <strong>Nuova consegna</strong> in alto.
          </>
        ) : (
          <>
            Cerca per fornitore, prodotto (testo libero) e periodo. L&apos;elenco usa un foglio Excel con una colonna per ogni attributo;
            in fondo compaiono i totali. Confronta prezzi nel tempo nella sezione analisi.
          </>
        )}
      </p>
      </section>

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
          {!operatorMode && (
            <button
              type="button"
              className="btn btn-outline-danger"
              onClick={handleDeleteAllHistory}
              disabled={deletingAll}
            >
              {deletingAll ? 'Eliminazione...' : 'Elimina tutto lo storico'}
            </button>
          )}
        </form>
        <div className="filter-bar" style={{ marginTop: '0.55rem', alignItems: 'flex-end' }}>
          <div className="form-group">
            <label>Riga selezionata</label>
            <select
              className="form-control"
              value={selectedDeliveryId}
              onChange={(e) => setSelectedDeliveryId(e.target.value)}
              style={{ minWidth: 320 }}
            >
              {deliveryList.length === 0 && <option value="">Nessuna riga disponibile</option>}
              {deliveryList.map((d) => (
                <option key={d.id} value={d.id}>
                  {formatDate(d.delivery_date)} · DDT {d.ddt_number || '—'} · {d.product_description || '—'}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={!deliveryList.length}
            onClick={handleOpenSelectedNotes}
          >
            Modifica note
          </button>
          <button
            type="button"
            className="btn btn-outline-danger"
            disabled={!deliveryList.length}
            onClick={handleDeleteSelectedRow}
          >
            Elimina riga
          </button>
        </div>

        {editingDeliveryId != null && (
          <div className="card" style={{ marginTop: '0.85rem', marginBottom: '0.4rem', padding: '0.85rem' }}>
            <h3 className="page-subheader" style={{ marginTop: 0 }}>Modifica note consegna #{editingDeliveryId}</h3>
            <div className="form-row">
              <div className="form-group" style={{ flex: '1 1 260px' }}>
                <label>Destinazione</label>
                <input
                  className="form-control"
                  value={editDestinationNote}
                  onChange={(e) => setEditDestinationNote(e.target.value)}
                  placeholder="es. Via Roma 10, magazzino"
                />
              </div>
              <div className="form-group" style={{ flex: '2 1 340px' }}>
                <label>Note documento</label>
                <textarea
                  className="form-control"
                  value={editDocumentNote}
                  onChange={(e) => setEditDocumentNote(e.target.value)}
                  rows={2}
                />
              </div>
              <div className="form-group" style={{ flex: '2 1 340px' }}>
                <label>Note anomalie</label>
                <textarea
                  className="form-control"
                  value={editAnomalyNote}
                  onChange={(e) => setEditAnomalyNote(e.target.value)}
                  rows={2}
                />
              </div>
            </div>
            <div className="btn-group">
              <button type="button" className="btn btn-primary" onClick={handleSaveNotes} disabled={savingNotes}>
                {savingNotes ? 'Salvataggio...' : 'Salva note'}
              </button>
              <button type="button" className="btn btn-secondary" onClick={closeEditNotes} disabled={savingNotes}>
                Annulla
              </button>
            </div>
          </div>
        )}

      </section>

      <section className="card pagamenti-workbook-card suppliers-workbook-card">
        <div className="pagamenti-workbook-toolbar">
          <div className="pagamenti-workbook-toolbar-left">
            <span className="pagamenti-workbook-title">{DELIVERIES_HISTORY_WORKBOOK_TITLE}</span>
            <span className="pagamenti-workbook-sheet-label">
              {deliveryList.length} righe
            </span>
          </div>
        </div>
        {loading && <AnalisiLoadingBar active label="Caricamento storico consegne" variant="subtle" />}
        {!loading && !error && (
          <div className="pagamenti-grid-wrap excel-wrap workbook-grid-wrap deliveries-grid-wrap">
            <table className="app-table excel-table pagamenti-grid workbook-grid deliveries-grid">
              <colgroup>
                {DELIVERIES_HISTORY_WORKBOOK_COLUMNS.map((col) => (
                  <col key={col.id} style={{ minWidth: col.width }} />
                ))}
                <col style={{ minWidth: 110 }} />
              </colgroup>
              <thead>
                <tr>
                  {DELIVERIES_HISTORY_WORKBOOK_COLUMNS.map((col) => (
                    <th
                      key={col.id}
                      className={[
                        col.numeric ? 'text-end' : '',
                        col.sticky === 'left' ? 'workbook-col-sticky-left' : '',
                      ].filter(Boolean).join(' ')}
                    >
                      {col.label}
                    </th>
                  ))}
                  <th className="sup-actions-col">Stato</th>
                </tr>
              </thead>
              <tbody>
                {deliveryList.map((d, rowIndex) => (
                  <tr
                    key={d.id}
                    className={[
                      'workbook-grid-row',
                      'pn-row-click',
                      String(selectedDeliveryId) === String(d.id) ? 'workbook-row-selected' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => setSelectedDeliveryId(String(d.id))}
                    title="Seleziona riga consegna"
                  >
                    {DELIVERIES_HISTORY_WORKBOOK_COLUMNS.map((col) => {
                      const diffTone = col.id === 'price_diff_vs_list' ? deliveryHistoryDiffTone(d) : ''
                      return (
                        <td
                          key={col.id}
                          className={col.sticky === 'left' ? 'workbook-col-sticky-left' : ''}
                        >
                          <input
                            className={[
                              'excel-cell',
                              'pagamenti-cell-readonly',
                              col.numeric ? 'excel-cell-num' : '',
                              col.emphasis ? 'workbook-cell-emphasis' : '',
                              diffTone,
                            ].filter(Boolean).join(' ')}
                            value={deliveryHistoryWorkbookCellValue(d, col, { rowIndex })}
                            readOnly
                            tabIndex={-1}
                            aria-label={`${col.label} riga ${rowIndex + 1}`}
                          />
                        </td>
                      )
                    })}
                    <td className="sup-actions-col">
                      <input
                        className="excel-cell pagamenti-cell-readonly"
                        value={String(selectedDeliveryId) === String(d.id) ? 'Selezionata' : ''}
                        readOnly
                        tabIndex={-1}
                      />
                    </td>
                  </tr>
                ))}
                {deliveryList.length === 0 ? (
                  <tr>
                    <td colSpan={DELIVERIES_HISTORY_WORKBOOK_COLUMNS.length + 1} className="empty-state">
                      Nessuna consegna registrata.
                    </td>
                  </tr>
                ) : (
                  <tr className="workbook-row-totals">
                    {DELIVERIES_HISTORY_WORKBOOK_COLUMNS.map((col) => (
                      <td
                        key={`tot-${col.id}`}
                        className={col.sticky === 'left' ? 'workbook-col-sticky-left' : ''}
                      >
                        <input
                          className={[
                            'excel-cell',
                            'pagamenti-cell-readonly',
                            col.numeric ? 'excel-cell-num' : '',
                            'workbook-cell-total',
                          ].filter(Boolean).join(' ')}
                          value={deliveryHistoryWorkbookTotalsLabel(col.id, deliveryTotals)}
                          readOnly
                          tabIndex={-1}
                        />
                      </td>
                    ))}
                    <td className="sup-actions-col" />
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
        {analytics && analytics.delivery_count > 0 && Array.isArray(analytics.series) && (
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
