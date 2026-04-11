import React, { useEffect, useMemo, useState } from 'react'
import { fetchDashboardSummary } from '../services/dashboardService'

function eur(n) {
  if (n == null || n === '') return '—'
  return new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(Number(n))
}

function formatDt(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })
}

function formatDateShort(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return d.toLocaleDateString('it-IT')
}

function MonthlyFlowChart({ rows, onOpenPrimaNota, onOpenInvoices }) {
  if (!rows?.length) return <p className="empty-state">Nessun dato disponibile.</p>
  const max = Math.max(1, ...rows.flatMap((r) => [Number(r.entrate || 0), Number(r.uscite || 0)]))
  return (
    <div className="dash-chart-vbars">
      {rows.map((r) => {
        const e = Number(r.entrate || 0)
        const u = Number(r.uscite || 0)
        return (
          <div key={r.month_key} className="dash-chart-vbar-group">
            <div className="dash-chart-vbar-stack">
              <button
                type="button"
                className="dash-chart-vbar-btn"
                title={`Entrate ${eur(e)} — apri Prima Nota`}
                onClick={() => onOpenPrimaNota?.(r.month_key, 'entrata')}
              >
                <span className="dash-chart-vbar dash-chart-vbar--in" style={{ height: `${(e / max) * 100}%` }} />
              </button>
              <button
                type="button"
                className="dash-chart-vbar-btn"
                title={`Uscite ${eur(u)} — apri Fatture`}
                onClick={() => onOpenInvoices?.(r.month_key)}
              >
                <span className="dash-chart-vbar dash-chart-vbar--out" style={{ height: `${(u / max) * 100}%` }} />
              </button>
            </div>
            <div className="dash-chart-vbar-label">{r.month_label}</div>
          </div>
        )
      })}
    </div>
  )
}

function BreakdownBars({ rows, onSelect }) {
  if (!rows?.length) return <p className="empty-state">Nessun dato disponibile.</p>
  const max = Math.max(1, ...rows.map((r) => Number(r.amount || 0)))
  return (
    <div className="dash-hbars">
      {rows.map((r, i) => {
        const v = Number(r.amount || 0)
        return (
          <button key={`${r.label}-${i}`} type="button" className="dash-hbar-row dash-hbar-btn" onClick={() => onSelect?.(r)}>
            <div className="dash-hbar-label" title={r.label}>{r.label}</div>
            <div className="dash-hbar-track">
              <div className="dash-hbar-fill" style={{ width: `${(v / max) * 100}%` }} />
            </div>
            <div className="dash-hbar-value">{eur(v)}</div>
          </button>
        )
      })}
    </div>
  )
}

function DashboardSkeleton() {
  return (
    <div className="dashboard-skeleton" aria-busy="true" aria-label="Caricamento dashboard">
      <div className="dashboard-kpi-grid">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="dashboard-kpi dashboard-skeleton-block" style={{ minHeight: 118 }} />
        ))}
      </div>
      <div className="dashboard-two-col" style={{ marginTop: '1rem' }}>
        <div className="card dashboard-panel dashboard-skeleton-block" style={{ minHeight: 260 }} />
        <div className="card dashboard-panel dashboard-skeleton-block" style={{ minHeight: 260 }} />
      </div>
    </div>
  )
}

function Last6MonthsTrend({ rows, onOpenInvoices }) {
  if (!rows?.length) return <p className="empty-state">Nessun dato disponibile.</p>
  const w = 680
  const h = 220
  const padL = 42
  const padR = 20
  const padT = 16
  const padB = 40
  const innerW = w - padL - padR
  const innerH = h - padT - padB
  const values = rows.map((r) => Number(r.amount || 0))
  const max = Math.max(1, ...values)
  const pts = rows.map((r, i) => ({
    x: rows.length <= 1 ? padL + innerW / 2 : padL + (i / (rows.length - 1)) * innerW,
    y: padT + innerH - (Number(r.amount || 0) / max) * innerH,
    label: r.label,
    monthKey: r.monthKey,
    val: Number(r.amount || 0),
  }))
  const path = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="dash-line-svg">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padT + innerH * t
          return <line key={t} x1={padL} y1={y} x2={padL + innerW} y2={y} className="dash-line-grid" />
        })}
        <path d={path} className="dash-line-path" />
        {pts.map((p, i) => (
          <g key={i} className="dash-line-node" onClick={() => onOpenInvoices?.(p.monthKey)}>
            <circle cx={p.x} cy={p.y} r="3.5" className="dash-line-point" />
            <text x={p.x} y={h - 14} textAnchor="middle" className="dash-line-label">{p.label}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}

export default function HomePage({ onNavigate }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [windowMonths, setWindowMonths] = useState('6')

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        setLoading(true)
        setError('')
        const res = await fetchDashboardSummary()
        if (!cancelled) setData(res)
      } catch (e) {
        if (!cancelled) setError('Impossibile caricare la dashboard. Verifica che il server sia attivo.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const monthlyRows = useMemo(() => {
    const all = data?.flussi_mensili || []
    const n = Number(windowMonths) || 6
    return all.slice(-n)
  }, [data, windowMonths])

  const spendTrendRows = useMemo(() => {
    return monthlyRows.map((r) => ({ label: r.month_label, monthKey: r.month_key, amount: r.uscite }))
  }, [monthlyRows])

  const latestMonthKey = monthlyRows.length ? monthlyRows[monthlyRows.length - 1].month_key : null

  function openInvoicesWithFilter(monthKey, supplierLabel = '') {
    if (!monthKey) return
    sessionStorage.setItem('dashboardInvoicesFilter', JSON.stringify({ monthKey, supplierLabel }))
    onNavigate?.('invoices')
  }

  function openInvoicesOverdue() {
    onNavigate?.('invoices')
    window.setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent('ai-invoices-filter', {
          detail: { dueFilter: 'overdue', message: 'Filtro: fatture scadute (non saldate)' },
        }),
      )
    }, 0)
  }

  function openPrimaNotaWithFilter(monthKey, movementKind = 'all', search = '') {
    if (!monthKey) return
    sessionStorage.setItem('primaNotaDashboardFilter', JSON.stringify({ monthKey, movementKind, search }))
    onNavigate?.('prima-nota')
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <h1 className="page-header" style={{ marginBottom: '0.25rem' }}>
          Panoramica
        </h1>
        <p className="dashboard-subtitle">
          Situazione al volo: cassa, banca, flussi del mese, fatture e attività recenti.
        </p>
      </header>

      {loading && <DashboardSkeleton />}
      {error && <div className="alert alert-danger">{error}</div>}

      {data && !loading && (
        <>
          <p className="dashboard-month-pill">Mese in corso: {data.month_label}</p>

          <section className="dashboard-kpi-grid">
            <div className="dashboard-kpi dashboard-kpi--primary">
              <div className="dashboard-kpi-label">Saldo cassa</div>
              <div className="dashboard-kpi-value">{eur(data.saldo_cassa)}</div>
              <div className="dashboard-kpi-hint">Movimenti non bancari (cassa / contanti default)</div>
            </div>
            <div className="dashboard-kpi dashboard-kpi--secondary">
              <div className="dashboard-kpi-label">Saldo banca</div>
              <div className="dashboard-kpi-value">{eur(data.saldo_banca)}</div>
              <div className="dashboard-kpi-hint">Conti con banca, bonifico, IBAN, ecc.</div>
            </div>
            <div className="dashboard-kpi">
              <div className="dashboard-kpi-label">Entrate del mese</div>
              <div className="dashboard-kpi-value dashboard-kpi-value--pos">{eur(data.entrate_mese)}</div>
            </div>
            <div className="dashboard-kpi">
              <div className="dashboard-kpi-label">Uscite del mese</div>
              <div className="dashboard-kpi-value dashboard-kpi-value--neg">{eur(data.uscite_mese)}</div>
            </div>
            <div className="dashboard-kpi dashboard-kpi--warn">
              <div className="dashboard-kpi-label">Fatture da pagare</div>
              <div className="dashboard-kpi-value">{data.fatture_da_pagare_count}</div>
              <div className="dashboard-kpi-sub">{eur(data.fatture_da_pagare_residuo)} residuo</div>
              <button type="button" className="btn btn-secondary btn-sm dashboard-kpi-link" onClick={() => onNavigate?.('invoices')}>
                Apri fatture
              </button>
            </div>
            <div className="dashboard-kpi dashboard-kpi--danger">
              <div className="dashboard-kpi-label">Fatture scadute</div>
              <div className="dashboard-kpi-value">{data.fatture_scadute_count}</div>
              <div className="dashboard-kpi-sub">{eur(data.fatture_scadute_residuo)} residuo</div>
              <button type="button" className="btn btn-secondary btn-sm dashboard-kpi-link" onClick={openInvoicesOverdue}>
                Apri fatture scadute
              </button>
            </div>
          </section>

          {(data.ordini_consegna_in_ritardo || []).length > 0 && (
            <section
              className="card dashboard-panel"
              style={{ marginBottom: '1rem', borderLeft: '4px solid var(--danger, #c0392b)' }}
            >
              <h2 className="page-subheader" style={{ marginTop: 0 }}>
                Ordini in sospeso: consegna prevista superata
              </h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginTop: '-0.35rem' }}>
                Promemoria: questi ordini sono ancora &quot;in sospeso&quot; ma la data consegna indicata è nel passato.
              </p>
              <button
                type="button"
                className="btn btn-secondary btn-sm dashboard-panel-action"
                onClick={() => onNavigate?.('new-order')}
              >
                Nuovo ordine
              </button>
              <div className="table-wrap">
                <table className="app-table app-table--compact">
                  <thead>
                    <tr>
                      <th>N.</th>
                      <th>Fornitore</th>
                      <th>Data ordine</th>
                      <th>Consegna prev.</th>
                      <th>Merce</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.ordini_consegna_in_ritardo || []).map((o) => (
                      <tr key={o.id}>
                        <td>#{o.id}</td>
                        <td>{o.supplier_name}</td>
                        <td>{formatDateShort(o.order_date)}</td>
                        <td>{formatDateShort(o.expected_delivery_date)}</td>
                        <td title={o.merchandise_summary || ''}>{o.merchandise_summary || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="card" style={{ marginBottom: '1rem' }}>
            <div className="ui-toolbar-one" style={{ marginBottom: 0 }}>
              <div className="form-group">
                <label>Periodo grafici</label>
                <select className="form-control" value={windowMonths} onChange={(e) => setWindowMonths(e.target.value)} style={{ minWidth: 140 }}>
                  <option value="3">Ultimi 3 mesi</option>
                  <option value="6">Ultimi 6 mesi</option>
                  <option value="12">Ultimi 12 mesi</option>
                </select>
              </div>
            </div>
          </section>

          <div className="dashboard-two-col">
            <section className="card dashboard-panel">
              <h2 className="page-subheader">Entrate vs uscite mese per mese</h2>
              <MonthlyFlowChart
                rows={monthlyRows}
                onOpenPrimaNota={(monthKey, kind) => openPrimaNotaWithFilter(monthKey, kind)}
                onOpenInvoices={(monthKey) => openInvoicesWithFilter(monthKey)}
              />
            </section>
            <section className="card dashboard-panel">
              <h2 className="page-subheader">Andamento spese ultimi {windowMonths} mesi</h2>
              <Last6MonthsTrend rows={spendTrendRows} onOpenInvoices={(monthKey) => openInvoicesWithFilter(monthKey)} />
            </section>
          </div>

          <div className="dashboard-two-col">
            <section className="card dashboard-panel">
              <h2 className="page-subheader">Costi per categoria</h2>
              <BreakdownBars
                rows={data.costi_per_categoria || []}
                onSelect={(r) => openPrimaNotaWithFilter(latestMonthKey, 'uscita', r.label)}
              />
            </section>
            <section className="card dashboard-panel">
              <h2 className="page-subheader">Costi per fornitore</h2>
              <BreakdownBars
                rows={data.costi_per_fornitore || []}
                onSelect={(r) => openInvoicesWithFilter(latestMonthKey, r.label)}
              />
            </section>
          </div>

          <div className="dashboard-two-col">
            <section className="card dashboard-panel">
              <h2 className="page-subheader">Ultimi movimenti cassa</h2>
              <button type="button" className="btn btn-secondary btn-sm dashboard-panel-action" onClick={() => onNavigate?.('prima-nota')}>
                Prima Nota
              </button>
              <div className="table-wrap">
                <table className="app-table app-table--compact">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Tipo</th>
                      <th className="text-end">Importo</th>
                      <th>Descrizione</th>
                      <th>Conto</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.ultimi_movimenti || []).map((m) => (
                      <tr key={m.id}>
                        <td>{formatDt(m.entry_date)}</td>
                        <td>{m.type === 'entrata' ? 'Entrata' : 'Uscita'}</td>
                        <td className={`text-end amount ${m.type === 'entrata' ? 'text-pos' : 'text-neg'}`}>
                          {m.type === 'entrata' ? '+' : '−'}
                          {eur(m.amount)}
                        </td>
                        <td>{m.description || '—'}</td>
                        <td>{m.conto || '—'}</td>
                      </tr>
                    ))}
                    {(!data.ultimi_movimenti || data.ultimi_movimenti.length === 0) && (
                      <tr>
                        <td colSpan={5} className="empty-state">
                          Nessun movimento registrato.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="card dashboard-panel">
              <h2 className="page-subheader">Consegne recenti</h2>
              <button type="button" className="btn btn-secondary btn-sm dashboard-panel-action" onClick={() => onNavigate?.('history')}>
                Storico consegne
              </button>
              <div className="table-wrap">
                <table className="app-table app-table--compact">
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Fornitore</th>
                      <th>Merce</th>
                      <th className="text-end">Tot.</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.consegne_recenti || []).map((c) => (
                      <tr key={c.id}>
                        <td>{formatDateShort(c.delivery_date)}</td>
                        <td>{c.supplier_name}</td>
                        <td>{c.product_description || '—'}</td>
                        <td className="text-end amount">{eur(c.total)}</td>
                      </tr>
                    ))}
                    {(!data.consegne_recenti || data.consegne_recenti.length === 0) && (
                      <tr>
                        <td colSpan={4} className="empty-state">
                          Nessuna consegna.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <div className="dashboard-two-col">
            <section className="card dashboard-panel">
              <div
                className="ui-toolbar-one"
                style={{ marginBottom: '0.75rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}
              >
                <h2 className="page-subheader" style={{ marginTop: 0, marginBottom: 0 }}>
                  Fatture scadute (dettaglio)
                </h2>
                <button type="button" className="btn btn-secondary btn-sm dashboard-panel-action" onClick={openInvoicesOverdue}>
                  Apri fatture scadute
                </button>
              </div>
              <div className="table-wrap">
                <table className="app-table app-table--compact">
                  <thead>
                    <tr>
                      <th>Fornitore</th>
                      <th>N. fattura</th>
                      <th>Scadenza</th>
                      <th className="text-end">Residuo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.fatture_scadute_elenco || []).map((f) => (
                      <tr key={f.id}>
                        <td>{f.supplier_name}</td>
                        <td>{f.invoice_number}</td>
                        <td>{formatDateShort(f.due_date)}</td>
                        <td className="text-end amount">{eur(f.residual)}</td>
                      </tr>
                    ))}
                    {(!data.fatture_scadute_elenco || data.fatture_scadute_elenco.length === 0) && (
                      <tr>
                        <td colSpan={4} className="empty-state">
                          Nessuna fattura scaduta (o tutto saldato).
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="card dashboard-panel">
              <h2 className="page-subheader">Fornitori con aumento prezzi</h2>
              <p className="dashboard-hint">
                Confronto tra le ultime due consegne dello stesso prodotto (stesso fornitore): prezzo unitario in aumento.
              </p>
              <div className="table-wrap">
                <table className="app-table app-table--compact">
                  <thead>
                    <tr>
                      <th>Fornitore</th>
                      <th>Prodotto</th>
                      <th className="text-end">Prima</th>
                      <th className="text-end">Ultima</th>
                      <th>Ultima consegna</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data.fornitori_prezzi_in_aumento || []).map((row, i) => (
                      <tr key={`${row.supplier_name}-${row.product_description}-${i}`}>
                        <td>{row.supplier_name}</td>
                        <td>{row.product_description}</td>
                        <td className="text-end amount">{eur(row.previous_unit_price)}</td>
                        <td className="text-end amount">{eur(row.latest_unit_price)}</td>
                        <td>{formatDateShort(row.latest_date)}</td>
                      </tr>
                    ))}
                    {(!data.fornitori_prezzi_in_aumento || data.fornitori_prezzi_in_aumento.length === 0) && (
                      <tr>
                        <td colSpan={5} className="empty-state">
                          Nessun aumento rilevato (servono almeno due consegne per prodotto).
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
